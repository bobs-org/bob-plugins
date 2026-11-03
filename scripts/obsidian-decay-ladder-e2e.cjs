#!/usr/bin/env node
// Real-Obsidian e2e for the task-decay ladder.
// Isolated scratch vault + profile, owned Obsidian process, CDP probes.
// Never opens the live vault. Follows scripts/obsidian-frees-marks-e2e.cjs.
//
//   xvfb-run -a node scripts/obsidian-decay-ladder-e2e.cjs [--out DIR] [-e PATH] [-r REPORT]
"use strict";

const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const lib = require("./obsidian-startup-smoke-lib.cjs");
const asserts = require("./obsidian-decay-ladder-e2e-lib.cjs");

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

function markdownViewState(mode) {
  if (mode === "preview" || mode === "reading") return { mode: "preview", source: false };
  return { mode: "source", source: mode === "source" };
}

const HELP_TEXT = [
  "Usage: node scripts/obsidian-decay-ladder-e2e.cjs [OPTIONS]",
  "",
  "Drive the decay ladder in an isolated scratch vault through CDP.",
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
  const scratch = asserts.makeScratch(repoRoot, "probe");
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

function readExpectedPlugins() {
  const pluginsDir = path.join(repoRoot, "plugins");
  const expected = [];
  for (const entry of fs.readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(pluginsDir, entry.name, "manifest.json");
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (manifest && typeof manifest.id === "string" && typeof manifest.version === "string") {
        expected.push({ id: manifest.id, version: manifest.version });
      }
    } catch {
      // Build gate owns malformed manifests.
    }
  }
  expected.sort((a, b) => a.id.localeCompare(b.id));
  return expected;
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
  const configured = process.env.BOB_E2E_TASKS_PLUGIN_DIR;
  const candidates = configured
    ? [path.resolve(configured)]
    : [path.join(os.homedir(), "bob", ".obsidian", "plugins", "obsidian-tasks-plugin")];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "main.js")) && fs.existsSync(path.join(candidate, "manifest.json"))) {
      return candidate;
    }
  }
  if (configured) {
    throw new Error(`BOB_E2E_TASKS_PLUGIN_DIR does not contain main.js and manifest.json: ${path.resolve(configured)}`);
  }
  return null;
}

function writeBobConfig(configHome) {
  fs.mkdirSync(path.join(configHome, "bob"), { recursive: true });
  const configPath = path.join(configHome, "bob", "config.yml");
  fs.writeFileSync(configPath, asserts.configYaml());
  return configPath;
}

function buildFixture(vaultDir, configHome, dates, homeDir) {
  const d = dates || asserts.fixtureDates();
  writeNote(path.join(vaultDir, asserts.notePath()), asserts.seedNote(d));
  const configPath = writeBobConfig(configHome);
  if (homeDir) writeBobConfig(path.join(homeDir, ".config"));

  const enabled = [];
  for (const plugin of readExpectedPlugins()) {
    copyPluginFiles(
      path.join(repoRoot, "plugins", plugin.id),
      path.join(vaultDir, ".obsidian", "plugins", plugin.id),
    );
    enabled.push(plugin.id);
  }

  const tasksSource = findTasksPluginSource();
  let tasksPlugin = false;
  if (tasksSource) {
    const targetDir = path.join(vaultDir, ".obsidian", "plugins", "obsidian-tasks-plugin");
    copyPluginFiles(tasksSource, targetDir);
    fs.writeFileSync(path.join(targetDir, "data.json"), JSON.stringify(TASKS_DATA, null, 2));
    enabled.push("obsidian-tasks-plugin");
    tasksPlugin = true;
  }

  fs.mkdirSync(path.join(vaultDir, ".obsidian"), { recursive: true });
  fs.writeFileSync(path.join(vaultDir, ".obsidian", "community-plugins.json"), JSON.stringify(enabled, null, 2));
  fs.writeFileSync(
    path.join(vaultDir, ".obsidian", "app.json"),
    JSON.stringify({ livePreview: true, showLineNumber: false, showInlineTitle: false }, null, 2),
  );
  fs.writeFileSync(
    path.join(vaultDir, ".obsidian", "appearance.json"),
    JSON.stringify({ cssTheme: "", theme: "moonstone" }, null, 2),
  );
  fs.writeFileSync(
    path.join(vaultDir, ".obsidian", "core-plugins.json"),
    JSON.stringify([
      "file-explorer",
      "global-search",
      "switcher",
      "page-preview",
      "command-palette",
      "editor-status",
      "outline",
      "daily-notes",
    ], null, 2),
  );
  return { note: asserts.notePath(), enabled, tasksPlugin, dates: d, configHome, configPath };
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
      try {
        WebSocketClient = require("undici").WebSocket;
      } catch {
        WebSocketClient = null;
      }
    }
    if (!WebSocketClient) throw new Error("WebSocket is required for the CDP client (Node 22+ or undici)");
    return lib.withTimeout(
      new Promise((resolve, reject) => {
        let socket;
        try {
          socket = new WebSocketClient(endpoint);
        } catch (error) {
          reject(error);
          return;
        }
        socket.addEventListener("open", () => resolve(new CdpClient(socket)), { once: true });
        socket.addEventListener("error", (event) => reject(new Error(`CDP connect failed: ${event && event.message ? event.message : "socket error"}`)), { once: true });
      }),
      timeoutMs || lib.CONNECT_TIMEOUT_MS,
      "CDP connect",
    );
  }

  call(method, params, timeoutMs) {
    if (this.closed) return Promise.reject(new Error(`${method}: CDP socket is closed`));
    const id = this.nextId++;
    return lib.withTimeout(
      new Promise((resolve, reject) => {
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
      }),
      (timeoutMs || lib.RPC_TIMEOUT_MS) + 1000,
      method,
    );
  }

  evaluate(expression, timeoutMs) {
    return this.call(
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true, userGesture: true },
      timeoutMs,
    ).then((response) => {
      if (response.exceptionDetails) {
        const details = response.exceptionDetails;
        throw new Error((details.exception && details.exception.description) || details.text || "Runtime.evaluate failed");
      }
      return response.result && response.result.value;
    });
  }

  close() {
    try {
      this.socket.close();
    } catch {
      // Closing a dead socket is not a failure.
    }
  }
}

const VAULT_PATH_PROBE = `(() => { try {
  const app = window.app;
  const adapter = app && app.vault && app.vault.adapter;
  if (adapter && typeof adapter.basePath === "string" && adapter.basePath) return adapter.basePath;
  return null;
} catch { return null; } })()`;

const CARD_PROBE = `(() => { try {
  const app = window.app;
  const appDocument = app && app.workspace && app.workspace.containerEl && app.workspace.containerEl.ownerDocument;
  const nav = app && app.plugins && app.plugins.plugins && app.plugins.plugins["bob-navigation-hotkeys"];
  const activeModal = nav && nav.activeFreshnessDecayCard;
  const modalDocument = activeModal && activeModal.containerEl && activeModal.containerEl.ownerDocument;
  const ownerDocumentMatchesApp = Boolean(modalDocument && modalDocument === appDocument);
  const documentContext = {
    currentUrl: String(document.URL || ""),
    currentIsApp: Boolean(appDocument && document === appDocument),
    appUrl: String(appDocument && appDocument.URL || ""),
    appWindowIsCurrent: Boolean(appDocument && appDocument.defaultView === window),
    modalUrl: String(modalDocument && modalDocument.URL || ""),
    modalIsCurrent: Boolean(modalDocument && modalDocument === document),
    currentModalCount: document.querySelectorAll(".bob-decay-card-modal, .modal.bob-decay-card-modal").length,
    appModalCount: appDocument && appDocument.querySelectorAll ? appDocument.querySelectorAll(".bob-decay-card-modal, .modal.bob-decay-card-modal").length : null,
  };
  const queryDocument = appDocument || document;
  const modal = queryDocument.querySelector(".bob-decay-card-modal, .modal.bob-decay-card-modal");
  const card = queryDocument.querySelector(".bob-decay-card");
  const root = card || (modal && modal.querySelector && modal.querySelector(".bob-decay-card")) || modal;
  if (!root) return { open: false, ownerDocumentMatchesApp, documentContext };
  const title = (root.querySelector(".bob-decay-card-title") || {}).textContent || "";
  const subtitle = (root.querySelector(".bob-decay-card-subtitle") || {}).textContent || "";
  const rotten = (root.querySelector(".bob-decay-card-rotten") || {}).textContent || "";
  const footer = (root.querySelector(".bob-decay-card-footer") || {}).textContent || "";
  const stayStage = Boolean(root.querySelector("input, textarea"));
  const rows = Array.from(root.querySelectorAll(".bob-decay-card-row")).map((row) => {
    const key = ((row.querySelector(".bob-decay-card-key") || {}).textContent || "").trim();
    const label = ((row.querySelector(".bob-decay-card-label") || {}).textContent || "").trim();
    const detail = ((row.querySelector(".bob-decay-card-detail") || {}).textContent || "").trim();
    const recommended = Boolean(row.querySelector(".bob-decay-card-recommended"));
    let action = "";
    if (/^↵|^enter$/i.test(key) || /Move to|Defer to|Roll again/.test(label)) action = "step";
    else if (/Alt\\+F/i.test(key) || /^Stay /.test(label)) action = "stay";
    else if (/^D/.test(key) || /^Drop/.test(label)) action = "drop";
    else if (/^E/.test(key) || /^Reword/.test(label)) action = "reword";
    else if (/^L/.test(key) || /^Less often/.test(label)) action = "lessOften";
    else if (/^[1-4]/.test(key)) action = "level";
    return { key, label, detail, recommended, action, available: !row.classList.contains("is-unavailable") };
  });
  return { open: ownerDocumentMatchesApp, ownerDocumentMatchesApp, documentContext, title: String(title).trim(), subtitle: String(subtitle).trim(), rotten: String(rotten).trim(), footer: String(footer).trim(), stayStage, rows };
} catch (e) { return { open: false, error: String(e && e.message || e) }; } })()`;

function runSelfTest() {
  const tmp = asserts.makeScratch(repoRoot, "self");
  try {
    const dates = asserts.fixtureDates();
    const fixture = buildFixture(
      path.join(tmp, "vault"),
      path.join(tmp, "xdg"),
      dates,
      path.join(tmp, "home"),
    );
    if (!fs.existsSync(path.join(tmp, "home", ".config", "bob", "config.yml"))) {
      throw new Error("HOME .config/bob/config.yml must be written for isolation");
    }
    if (!fixture.configPath || !fs.existsSync(fixture.configPath)) {
      throw new Error("scratch config.yml missing");
    }
    const note = fs.readFileSync(path.join(tmp, "vault", fixture.note), "utf8");
    if (!note.includes(asserts.TASKS.wip.description)) throw new Error("seed note missing WIP task");
    if (!note.includes("[/]")) throw new Error("seed note missing WIP checkbox");
    if (!note.includes("[*]")) throw new Error("seed note missing Next checkbox");
    if (!note.includes("[priority:: lowest]")) throw new Error("seed note missing P4");
    const yaml = fs.readFileSync(path.join(tmp, "xdg", "bob", "config.yml"), "utf8");
    if (!yaml.includes("pending_keeps: 2")) throw new Error("config missing pending_keeps");
    if (!yaml.includes("next_keeps: 2")) throw new Error("config missing next_keeps");
    if (!yaml.includes("ready_keeps: 2")) throw new Error("config missing ready_keeps");
    if (!yaml.includes("enter: P1")) throw new Error("config missing enter P1");
    if (!yaml.includes("rolls: 2")) throw new Error("config missing rolls 2");
    if (!/bob-ledger-tools/.test(JSON.stringify(fixture.enabled))) throw new Error("ledger-tools must be enabled");
    if (!/bob-navigation-hotkeys/.test(JSON.stringify(fixture.enabled))) throw new Error("navigation must be enabled");

    const keep = asserts.keptBody("still mid-refactor", 1, "WIP");
    if (keep !== "still mid-refactor · kept 1× in WIP") throw new Error(`kept body ${keep}`);
    const blank = asserts.keptBody("", 2, "WIP");
    if (blank !== `${asserts.SHRUG} · kept 2× in WIP`) throw new Error(`blank keep ${blank}`);
    const stay = asserts.stayBody("still the next thing", 2, "Next");
    if (stay !== "still the next thing · stayed in Next after 2 keeps") throw new Error(`stay body ${stay}`);
    const step = asserts.stepBody("WIP", "Next", 2);
    if (step !== `${asserts.LEAF} WIP → Next · after 2 keeps`) throw new Error(`step body ${step}`);
    const roll = asserts.stepBody("P4", "P4", 2);
    if (roll !== `${asserts.LEAF} rolled again at P4 · after 2 keeps`) throw new Error(`roll body ${roll}`);
    const drop = asserts.dropBody("WIP", 2);
    if (drop !== `${asserts.LEAF} WIP → dropped · after 2 keeps`) throw new Error(`drop body ${drop}`);
    if (asserts.skipNotice(1) !== "1 needs a decision") throw new Error("skip 1");
    if (asserts.skipNotice(2) !== "2 need a decision") throw new Error("skip 2");
    const skipOk = asserts.assertSkipNotice("stamped 0 · 2 need a decision", 2);
    if (!skipOk.ok) throw new Error(skipOk.reason);
    const skipTaskNotice = asserts.assertSkipNotice("2 tasks need a decision · the review walk reaches it later", 2);
    if (!skipTaskNotice.ok) throw new Error(skipTaskNotice.reason);
    if (asserts.assertSkipNotice("12 tasks need a decision", 2).ok) throw new Error("skip count must match exactly");
    const skipBad = asserts.assertSkipNotice("ok", 2);
    if (skipBad.ok) throw new Error("empty skip notice must fail");

    const sample = [
      "- [/] #task Write migration notes [fresh:: 2026-11-03] [keeps:: 1] [created:: 2026-10-28] [id:: wip-1]",
      "\t- 🥀 **ROTTEN LOG**",
      "\t\t- *2026-11-03* — still mid-refactor · kept 1× in WIP",
    ].join("\n");
    const fields = asserts.assertTaskFields(asserts.extractTaskLine(sample, "Write migration notes"), {
      status: "/",
      fresh: "2026-11-03",
      keeps: 1,
      id: "wip-1",
      noKeeps: false,
    });
    if (!fields.ok) throw new Error(fields.reason);
    const logs = asserts.assertLogBodies(sample, "Write migration notes", [
      { date: "2026-11-03", body: asserts.keptBody("still mid-refactor", 1, "WIP") },
    ]);
    if (!logs.ok) throw new Error(logs.reason);
    const work = asserts.assertNoWorkLog(sample);
    if (!work.ok) throw new Error("sample must not have a Work Log");
    const withWork = asserts.assertNoWorkLog("\t- 🛠️ **WORK LOG**\n");
    if (withWork.ok) throw new Error("Work Log helper must reject a Work Log");

    const cardOk = asserts.assertCardProbe({
      open: true,
      title: asserts.CARD_TITLES.wip,
      rows: [
        { action: "step", label: "Move to Next", recommended: true },
        { action: "stay", label: "Stay in WIP" },
        { action: "drop", label: "Drop" },
      ],
    }, { title: asserts.CARD_TITLES.wip, stepLabel: "Move to Next", omitLevels: true });
    if (!cardOk.ok) throw new Error(cardOk.reason);
    const cardClosed = asserts.assertCardProbe({ open: false }, { title: asserts.CARD_TITLES.wip });
    if (cardClosed.ok) throw new Error("closed card must fail");
    const readyLevels = asserts.assertCardProbe({
      open: true,
      title: asserts.CARD_TITLES.wip,
      rows: [
        { action: "step", label: "Move to Next", recommended: true },
        { action: "stay", label: "Stay in WIP" },
        { action: "drop", label: "Drop" },
        { action: "level:0", label: "P1" },
      ],
    }, { title: asserts.CARD_TITLES.wip, stepLabel: "Move to Next", omitLevels: true });
    if (readyLevels.ok) throw new Error("WIP card must omit 1–4 level rows");

    if (!asserts.inP1Window("2026-11-06", "2026-11-03")) throw new Error("P1 window 3d");
    if (asserts.inP1Window("2026-11-04", "2026-11-03")) throw new Error("P1 window rejects 1d");
    if (!asserts.inP4Window("2026-02-12", "2025-11-03") && !asserts.inP4Window("2027-03-01", "2026-11-03")) {
      throw new Error("P4 window helper");
    }

    const source = fs.readFileSync(__filename, "utf8");
    if (!source.includes("refresh-task-freshness")) throw new Error("e2e must drive the Alt+F command");
    if (!source.includes("bob-decay-card")) throw new Error("e2e must probe the decay card");
    if (!source.includes("theme-dark")) throw new Error("e2e must capture dark theme");
    if (!source.includes("theme-light")) throw new Error("e2e must capture light theme");
    if (!source.includes("undoEditor") && !source.includes("editor.undo")) throw new Error("e2e must undo");
    if (!source.includes("countExplicit")) throw new Error("e2e must cover counted batch skip");
    if (!source.includes("view.save") || !source.includes("waitForFreshnessQueueLine")) {
      throw new Error("e2e must save editor writes and wait for the refreshed freshness queue");
    }
    if (!source.includes("Input.dispatchKeyEvent") || !source.includes("waitForEditorTask")) {
      throw new Error("e2e must send real card key input and wait for each task write");
    }
    if (!source.includes("BOB_E2E_TASKS_PLUGIN_DIR")) {
      throw new Error("e2e must support an isolated Tasks plugin source without reading the live vault");
    }
    if (!source.includes("MutationObserver")) throw new Error("e2e must capture transient batch notices");
    if (!source.includes("CARD_TITLES.p4") && !source.includes("Kept 2× at P4")) {
      throw new Error("e2e must capture the P4 card");
    }
    if (!source.includes("XDG_CONFIG_HOME")) throw new Error("e2e must isolate bob/config.yml");
    if (!source.includes("altKey: true")) throw new Error("e2e must dispatch Alt+F on the card");
    if (!source.includes("freshnessDecayConfigLoadOptions")) {
      throw new Error("e2e must pin the priority-ladder config path");
    }
    const altChord = buildKeyDispatchEvents({ key: "f", code: "KeyF", alt: true });
    const altEvents = altChord.map(({ key, type, modifiers }) => ({ key, type, modifiers }));
    if (JSON.stringify(altEvents) !== JSON.stringify([
      { key: "Alt", type: "keyDown", modifiers: 1 },
      { key: "f", type: "keyDown", modifiers: 1 },
      { key: "f", type: "keyUp", modifiers: 1 },
      { key: "Alt", type: "keyUp", modifiers: 0 },
    ])) {
      throw new Error("Alt chord input must dispatch a real modifier keyup");
    }
    console.log("offline self-test complete (not an Obsidian pass)");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
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
    const pages = (Array.isArray(targets) ? targets : []).filter(
      (item) => item && item.type === "page" && item.webSocketDebuggerUrl,
    );
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
      if (!trust) return { clicked: false, present: buttons.some((button) => /Restricted Mode|Trust author/i.test(button.textContent || "")) };
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

async function waitFor(client, expression, predicate, label, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await client.evaluate(expression);
      if (predicate(last)) return last;
    } catch (error) {
      last = { error: String(error && error.message || error) };
    }
    await sleep(80);
  }
  throw new Error(`timed out waiting for ${label}: ${JSON.stringify(last)}`);
}

async function openNote(client, file, mode) {
  const state = markdownViewState(mode);
  return client.evaluate(
    `(() => (async () => {
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
    })())()`,
    lib.RPC_TIMEOUT_MS,
  );
}

async function capturePage(client, output) {
  const screenshot = await client.call("Page.captureScreenshot", { format: "png", fromSurface: true });
  fs.writeFileSync(output, Buffer.from(screenshot.data, "base64"));
}

async function pinToday(client, dateText, configPath) {
  return client.evaluate(`(() => {
    const day = ${JSON.stringify(dateText)};
    const configPath = ${JSON.stringify(configPath || "")};
    const plugins = window.app.plugins.plugins;
    const ledger = plugins["bob-ledger-tools"];
    const nav = plugins["bob-navigation-hotkeys"];
    const pinned = Object.freeze({
      interval: 1,
      pendingInterval: 1,
      nextInterval: 1,
      projectInterval: null,
      rottenDailyBudget: null,
      intervalFromConfig: true,
      invalid: false,
      deprecatedStaleBudget: false,
      decay: Object.freeze({
        enabled: true,
        keeps: 2,
        pending: 2,
        next: 2,
        ready: 2,
        enter: "P1",
      }),
    });
    if (ledger) {
      ledger.freshnessTodayText = () => day;
      ledger.freshnessMemo = null;
      ledger.freshnessConfigCache = null;
      ledger.apiFreshnessConfig = () => pinned;
      if (typeof ledger.refreshFreshnessConfig === "function") {
        try { ledger.refreshFreshnessConfig(); } catch (error) {}
      }
    }
    if (nav) {
      nav.laneReleaseDateText = (options) => {
        if (options && typeof options.dateText === "string" && options.dateText) return String(options.dateText);
        return day;
      };
      nav.getFreshnessDateText = () => day;
      if (configPath) nav.freshnessDecayConfigLoadOptions = { configPath };
    }
    try { Math.random = () => 0; } catch (error) {}
    return { ok: Boolean(ledger && nav), day, configPath };
  })()`);
}

async function editorContent(client) {
  return client.evaluate(`(() => {
    const leaf = window.app.workspace.activeLeaf;
    const editor = leaf && leaf.view && leaf.view.editor;
    if (!editor || typeof editor.getValue !== "function") return { ok: false, error: "no editor" };
    return { ok: true, value: editor.getValue() };
  })()`);
}

async function saveActiveEditor(client) {
  const result = await client.evaluate(`(() => (async () => {
    const leaf = window.app.workspace.activeLeaf;
    const view = leaf && leaf.view;
    if (!view || typeof view.save !== "function") return { ok: false, error: "no markdown view save" };
    await view.save();
    return { ok: true, path: view.file && view.file.path || "" };
  })())()`, 15_000);
  if (!result || result.ok !== true) {
    throw new Error(`could not save the active editor: ${JSON.stringify(result)}`);
  }
  return result;
}

async function currentTaskLine(client, description) {
  const current = await editorContent(client);
  if (!current || current.ok !== true) throw new Error("cannot read active editor after write");
  const line = asserts.extractTaskLine(current.value, description);
  if (typeof line !== "string" || !line) throw new Error(`missing task line after write: ${description}`);
  return line;
}

async function waitForEditorTask(client, description, predicate, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    const current = await editorContent(client).catch(() => null);
    last = current && current.ok
      ? asserts.extractTaskLine(current.value, description)
      : "editor content unavailable";
    if (last && predicate(asserts.parseTaskLine(last))) return last;
    await sleep(100);
  }
  return null;
}

async function waitForTaskCacheLine(client, description, expectedLine, timeoutMs = 10_000) {
  const expression = `(() => {
    const leaf = window.app.workspace.activeLeaf;
    const filePath = leaf && leaf.view && leaf.view.file && leaf.view.file.path || "";
    const plugins = window.app.plugins.plugins;
    const holder = plugins && plugins["obsidian-tasks-plugin"];
    const api = [holder && holder.apiV1, holder && holder.api, holder]
      .find((candidate) => candidate && typeof candidate.getTasks === "function");
    if (!api || typeof api.getTasks !== "function") return { ready: false, error: "Tasks API unavailable" };
    let tasks = [];
    try { tasks = api.getTasks(); } catch (error) { return { ready: false, error: String(error) }; }
    if (!Array.isArray(tasks)) return { ready: false, error: "Tasks cache is not an array" };
    const expected = ${JSON.stringify(expectedLine)};
    const row = tasks.find((task) => task && task.path === filePath && String(task.originalMarkdown || "") === expected);
    return { ready: Boolean(row), filePath, cached: row && row.originalMarkdown || "", count: tasks.length };
  })()`;
  return waitFor(client, expression, (value) => value && value.ready === true,
    `Tasks cache line for ${description}`, timeoutMs);
}

async function flushAndWaitForTaskCache(client, description) {
  await saveActiveEditor(client);
  const line = await currentTaskLine(client, description);
  return waitForTaskCacheLine(client, description, line);
}

async function waitForFreshnessQueueLine(client, description, timeoutMs = 10_000) {
  const line = await currentTaskLine(client, description);
  const expression = `(() => {
    const leaf = window.app.workspace.activeLeaf;
    const filePath = leaf && leaf.view && leaf.view.file && leaf.view.file.path || "";
    const holder = window.app.plugins.plugins["bob-ledger-tools"];
    const api = holder && holder.api && holder.api.freshness;
    if (!api || typeof api.queue !== "function") return { ready: false, error: "freshness queue unavailable" };
    const queue = api.queue();
    const expected = ${JSON.stringify(line)};
    const row = Array.isArray(queue) && queue.find((task) => task && task.path === filePath && String(task.originalMarkdown || "") === expected);
    return { ready: Boolean(row), filePath, queued: row && row.originalMarkdown || "", count: Array.isArray(queue) ? queue.length : 0 };
  })()`;
  return waitFor(client, expression, (value) => value && value.ready === true,
    `freshness queue line for ${description}`, timeoutMs);
}

async function beginNoticeCapture(client) {
  return client.evaluate(`(() => {
    if (window.__bobDecayNoticeObserver) window.__bobDecayNoticeObserver.disconnect();
    const seen = [];
    const remember = (node) => {
      if (!(node instanceof Element)) return;
      const notices = [];
      if (node.matches(".notice")) notices.push(node);
      notices.push(...node.querySelectorAll(".notice"));
      for (const notice of notices) {
        const text = String(notice.textContent || "").trim();
        if (text) seen.push(text);
      }
    };
    const observer = new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) remember(node);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.__bobDecayNoticeCapture = seen;
    window.__bobDecayNoticeObserver = observer;
    return { ok: true };
  })()`);
}

async function endNoticeCapture(client) {
  return client.evaluate(`(() => {
    if (window.__bobDecayNoticeObserver) window.__bobDecayNoticeObserver.disconnect();
    const all = Array.isArray(window.__bobDecayNoticeCapture) ? window.__bobDecayNoticeCapture.slice() : [];
    delete window.__bobDecayNoticeObserver;
    delete window.__bobDecayNoticeCapture;
    return { text: all[all.length - 1] || "", all };
  })()`).catch(() => ({ text: "", all: [] }));
}

async function placeCursor(client, description) {
  return client.evaluate(`(() => {
    const leaf = window.app.workspace.activeLeaf;
    const editor = leaf && leaf.view && leaf.view.editor;
    if (!editor) return { ok: false, error: "no editor" };
    const needle = ${JSON.stringify(`#task ${description}`)};
    const value = editor.getValue();
    const lines = value.split(/\\r?\\n/);
    const line = lines.findIndex((text) => text.includes(needle));
    if (line < 0) return { ok: false, error: "missing " + needle, lines: lines.length };
    editor.setCursor({ line, ch: Math.max(0, lines[line].indexOf("-")) });
    editor.focus();
    return { ok: true, line, text: lines[line] };
  })()`);
}

async function lastNotice(client) {
  return client.evaluate(`(() => {
    const notices = Array.from(document.querySelectorAll(".notice")).map((el) => String(el.textContent || "").trim());
    return { text: notices[notices.length - 1] || "", all: notices.slice(-4) };
  })()`).catch(() => ({ text: "", all: [] }));
}

async function refreshKeep(client, options) {
  const payload = {
    dateText: options.dateText,
    keepReason: options.keepReason,
    countExplicit: options.countExplicit === true,
    additionalTaskCount: options.additionalTaskCount || 0,
  };
  return client.evaluate(
    `(() => (async () => {
      const nav = window.app.plugins.plugins["bob-navigation-hotkeys"];
      const leaf = window.app.workspace.activeLeaf;
      const editor = leaf && leaf.view && leaf.view.editor;
      if (!nav || !editor) return { ok: false, error: "missing plugin or editor" };
      const opts = ${JSON.stringify(payload)};
      // Drive the Alt+F command refresh-task-freshness through the plugin API.
      const result = await nav.refreshTaskFreshness(editor, opts);
      return { ok: result !== false, result };
    })())()`,
    20_000,
  );
}

async function startRefreshKeep(client, options) {
  const payload = {
    dateText: options.dateText,
    keepReason: options.keepReason,
    countExplicit: options.countExplicit === true,
    additionalTaskCount: options.additionalTaskCount || 0,
  };
  return client.evaluate(`(() => {
    const nav = window.app.plugins.plugins["bob-navigation-hotkeys"];
    const leaf = window.app.workspace.activeLeaf;
    const editor = leaf && leaf.view && leaf.view.editor;
    if (!nav || !editor) return { ok: false, error: "missing plugin or editor" };
    const opts = ${JSON.stringify(payload)};
    window.__bobDecayE2ePendingRefresh = nav.refreshTaskFreshness(editor, opts);
    return {
      ok: true,
      activeCard: Boolean(nav.activeFreshnessDecayCard),
    };
  })()`);
}

async function finishRefreshKeep(client) {
  return client.evaluate(`(() => (async () => {
    const pending = window.__bobDecayE2ePendingRefresh;
    if (!pending) return { ok: false, error: "refresh was not started" };
    try {
      const result = await pending;
      return { ok: true, result };
    } finally {
      delete window.__bobDecayE2ePendingRefresh;
    }
  })())()`, 30_000);
}

async function cancelPendingRefreshModal(client) {
  return client.evaluate(`(() => {
    const stack = window.app.workspace.modalStack;
    const nav = window.app.plugins.plugins["bob-navigation-hotkeys"];
    const modal = nav && nav.activeFreshnessDecayCard || (Array.isArray(stack) ? stack[stack.length - 1] : null);
    if (modal && typeof modal.close === "function") {
      modal.close();
      return { closed: true, name: modal.constructor && modal.constructor.name || "Modal" };
    }
    return { closed: false, count: Array.isArray(stack) ? stack.length : null };
  })()`);
}

async function undoEditor(client) {
  return client.evaluate(`(() => {
    const leaf = window.app.workspace.activeLeaf;
    const editor = leaf && leaf.view && leaf.view.editor;
    if (!editor || typeof editor.undo !== "function") return { ok: false, error: "no undo" };
    editor.undo();
    return { ok: true, value: editor.getValue() };
  })()`);
}

async function cardKey(client, options) {
  const key = options && options.key != null ? String(options.key) : "";
  const code = options && options.code
    ? String(options.code)
    : key === "Enter" ? "Enter" : key.length === 1 ? `Key${key.toUpperCase()}` : key;
  const focus = await client.evaluate(`(() => {
    const app = window.app;
    const appDocument = app && app.workspace && app.workspace.containerEl && app.workspace.containerEl.ownerDocument;
    const nav = app && app.plugins && app.plugins.plugins && app.plugins.plugins["bob-navigation-hotkeys"];
    const modal = nav && nav.activeFreshnessDecayCard;
    const card = appDocument && appDocument.querySelector(".bob-decay-card");
    if (!card) return { ok: false, error: "no card in the app document" };
    const input = card.querySelector("input, textarea");
    const row = ${JSON.stringify(key)} === "Enter"
      ? card.querySelector(".bob-decay-card-recommended")?.closest(".bob-decay-card-row")
        || card.querySelector(".bob-decay-card-row[tabindex='0']")
      : card.querySelector(".bob-decay-card-row[tabindex='0']");
    const target = ${JSON.stringify(key)} === "Enter" && input ? input : row;
    if (target && typeof target.focus === "function") target.focus();
    return {
      ok: true,
      currentIsApp: document === appDocument,
      ownerDocumentMatchesApp: card.ownerDocument === appDocument,
      focused: Boolean(target && appDocument.activeElement === target),
      rowLabel: row && row.querySelector(".bob-decay-card-label") && row.querySelector(".bob-decay-card-label").textContent || "",
      rowAction: row && Array.from(card.querySelectorAll(".bob-decay-card-row")).indexOf(row),
      openingKeys: Array.from(modal && modal.openingChordKeys || []),
    };
  })()`);
  if (!focus || focus.ok !== true || focus.currentIsApp !== true || focus.ownerDocumentMatchesApp !== true || focus.focused !== true) {
    return { ok: false, error: "cannot target decay card keyboard input", focus };
  }
  try {
    const events = buildKeyDispatchEvents(options);
    for (const event of events) {
      await client.call("Input.dispatchKeyEvent", event, 5000);
    }
    const modifiers = events.find((event) => event.key === key && event.type === "keyDown")?.modifiers || 0;
    return { ok: true, key, modifiers, focus };
  } catch (error) {
    return { ok: false, error: String(error && error.message || error), focus };
  }
}

function buildKeyDispatchEvents(options) {
  const settings = options && typeof options === "object" ? options : {};
  const key = settings.key != null ? String(settings.key) : "";
  const code = settings.code
    ? String(settings.code)
    : key === "Enter" ? "Enter" : key.length === 1 ? `Key${key.toUpperCase()}` : key;
  const modifiers = [
    { enabled: settings.ctrl === true, bit: 2, key: "Control", code: "ControlLeft", vk: 17 },
    { enabled: settings.alt === true, bit: 1, key: "Alt", code: "AltLeft", vk: 18 },
    { enabled: settings.shift === true, bit: 8, key: "Shift", code: "ShiftLeft", vk: 16 },
    { enabled: settings.meta === true, bit: 4, key: "Meta", code: "MetaLeft", vk: 91 },
  ].filter((item) => item.enabled);
  const keyCode = key === "Enter" ? 13 : key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0;
  let mask = 0;
  const events = [];
  for (const modifier of modifiers) {
    mask |= modifier.bit;
    events.push({
      type: "keyDown",
      key: modifier.key,
      code: modifier.code,
      modifiers: mask,
      windowsVirtualKeyCode: modifier.vk,
      nativeVirtualKeyCode: modifier.vk,
    });
  }
  events.push(
    { type: "keyDown", key, code, modifiers: mask, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode },
    { type: "keyUp", key, code, modifiers: mask, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode },
  );
  for (const modifier of modifiers.slice().reverse()) {
    mask &= ~modifier.bit;
    events.push({
      type: "keyUp",
      key: modifier.key,
      code: modifier.code,
      modifiers: mask,
      windowsVirtualKeyCode: modifier.vk,
      nativeVirtualKeyCode: modifier.vk,
    });
  }
  return events;
}

async function submitStayReason(client, reason) {
  return client.evaluate(`(() => {
    const card = document.querySelector(".bob-decay-card");
    if (!card) return { ok: false, error: "no card" };
    const input = card.querySelector("input, textarea");
    if (!input) return { ok: false, error: "no stay input" };
    const native = Object.getOwnPropertyDescriptor(window.HTMLInputElement && window.HTMLInputElement.prototype, "value")
      || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement && window.HTMLTextAreaElement.prototype, "value");
    if (native && native.set) native.set.call(input, ${JSON.stringify(reason || "")});
    else input.value = ${JSON.stringify(reason || "")};
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return { ok: true, value: input.value };
  })()`);
}

async function setTheme(client, theme) {
  const dark = theme === "dark";
  await client.evaluate(`(() => {
    document.body.classList.toggle("theme-dark", ${dark});
    document.body.classList.toggle("theme-light", ${!dark});
    return true;
  })()`);
  await sleep(200);
}

async function waitForCard(client, timeoutMs = 8000) {
  return waitFor(client, CARD_PROBE, (value) => value && value.open === true, "decay-card", timeoutMs);
}

async function waitForCardClosed(client, timeoutMs = 8000) {
  return waitFor(client, CARD_PROBE, (value) => !value || value.open !== true, "decay-card-closed", timeoutMs);
}

async function captureCard(client, outDir, slug, report) {
  await setTheme(client, "light");
  const light = path.join(outDir, `e2e-decay-${slug}-light.png`);
  await capturePage(client, light);
  report.screenshots.push(light);
  await setTheme(client, "dark");
  const dark = path.join(outDir, `e2e-decay-${slug}-dark.png`);
  await capturePage(client, dark);
  report.screenshots.push(dark);
  await setTheme(client, "light");
  return { light, dark };
}

async function runE2e(parsed) {
  const executable = findExecutable(parsed.executable);
  const probe = probeExecutable(executable);
  if (!probe.ok) {
    fail(
      `unrun: ${probe.reason}. Rerun on a host with the Obsidian Electron app: xvfb-run -a node scripts/obsidian-decay-ladder-e2e.cjs -e /snap/bin/obsidian`,
      2,
    );
  }
  if (!process.env.DISPLAY && !process.env.XVFB_RUN_TMPDIR) {
    fail("unrun: no X display; rerun under xvfb-run -a node scripts/obsidian-decay-ladder-e2e.cjs", 2);
  }

  const outDir = parsed.out ? path.resolve(parsed.out) : asserts.makeScratch(repoRoot, "out");
  fs.mkdirSync(outDir, { recursive: true });
  const runRoot = asserts.makeScratch(repoRoot, "run");
  const vaultDir = path.join(runRoot, "vault");
  const profileDir = path.join(runRoot, "profile");
  const configHome = path.join(runRoot, "xdg");
  const homeDir = path.join(runRoot, "home");
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(profileDir, { recursive: true });
  const dates = asserts.fixtureDates();
  const fixture = buildFixture(vaultDir, configHome, dates, homeDir);
  const fixtureRealPath = fs.realpathSync(vaultDir);
  seedProfileVault(profileDir, fixtureRealPath);

  const cases = [];
  const skipped = [];
  const record = (name, ok, detail) => {
    cases.push({ name, ok: Boolean(ok), detail: detail || "" });
    if (!ok) console.error(`FAIL ${name}: ${detail || ""}`);
    else console.log(`PASS ${name}${detail ? ` (${detail})` : ""}`);
  };
  const skip = (name, detail) => {
    skipped.push({ name, detail: detail || "" });
    console.log(`SKIP ${name}${detail ? ` (${detail})` : ""}`);
  };

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
        XDG_CONFIG_HOME: configHome,
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
  let client = null;
  const report = {
    executable,
    vault: fixtureRealPath,
    dates: fixture.dates,
    cases: [],
    skipped: [],
    screenshots: [],
    pass: false,
  };
  try {
    const target = await selectOwnedTarget(cdpPort, fixtureRealPath, () => Boolean(exitInfo));
    client = await CdpClient.connect(target.webSocketDebuggerUrl, lib.CONNECT_TIMEOUT_MS);
    await client.call("Page.enable", {}, lib.RPC_TIMEOUT_MS);
    await client.call("Runtime.enable", {}, lib.RPC_TIMEOUT_MS);
    await client.call("Input.enable", {}, lib.RPC_TIMEOUT_MS).catch(() => ({}));

    const layoutDeadline = Date.now() + lib.LAYOUT_READY_TIMEOUT_MS;
    while (Date.now() < layoutDeadline) {
      const ready = await client.evaluate("Boolean(window.app && window.app.workspace && window.app.workspace.layoutReady)").catch(() => false);
      if (ready) break;
      await sleep(250);
    }

    await client.evaluate(
      `(() => (async () => {
        const plugins = window.app && window.app.plugins;
        if (!plugins || typeof plugins.isEnabled !== "function") return { error: "plugin manager unavailable" };
        if (!plugins.isEnabled()) await plugins.setEnable(true);
        return { enabled: Boolean(plugins.isEnabled()) };
      })())()`,
      lib.RPC_TIMEOUT_MS,
    );

    await dismissTrustModal(client);
    const pluginDeadline = Date.now() + 30_000;
    let loaded = false;
    while (Date.now() < pluginDeadline) {
      loaded = await client.evaluate(
        'Boolean(window.app && window.app.plugins && window.app.plugins.plugins && window.app.plugins.plugins["bob-navigation-hotkeys"] && window.app.plugins.plugins["bob-ledger-tools"])',
      ).catch(() => false);
      if (loaded) break;
      await sleep(400);
    }
    record("plugins-loaded", loaded, loaded ? "navigation+ledger" : "bob plugins did not load");
    if (!loaded) throw new Error("bob-navigation-hotkeys / bob-ledger-tools did not load in the scratch vault");
    await sleep(800);

    const opened = await openNote(client, fixture.note, "live");
    record("open-ladder-note", Boolean(opened && opened.ok), JSON.stringify(opened).slice(0, 180));
    await sleep(600);

    let tasksReady = { ready: false };
    for (let i = 0; i < 48; i += 1) {
      tasksReady = await client.evaluate(`(() => { try {
        const tasksPlugin = window.app.plugins.plugins["obsidian-tasks-plugin"];
        const tasksApi = [tasksPlugin && tasksPlugin.apiV1, tasksPlugin && tasksPlugin.api, tasksPlugin]
          .find((candidate) => candidate && typeof candidate.getTasks === "function");
        const all = tasksApi ? tasksApi.getTasks() : null;
        const ids = Array.isArray(all) ? all.map((task) => String((task && (task.id || task.taskId)) || "")).filter(Boolean) : [];
        const want = ["wip-1", "next-1", "ready-1", "p4-1", "skip-a", "skip-b"];
        const missing = want.filter((id) => !ids.includes(id));
        return { ready: missing.length === 0, total: Array.isArray(all) ? all.length : null, missing, ids };
      } catch (e) { return { ready: false, error: String(e && e.message || e) }; } })()`).catch((error) => ({ ready: false, error: String(error) }));
      if (tasksReady && tasksReady.ready) break;
      await sleep(500);
    }
    if (!fixture.tasksPlugin) {
      skip("tasks-cache-ready", "Tasks plugin was not copied; live keep matching needs the Tasks cache");
    } else {
      record("tasks-cache-ready", tasksReady && tasksReady.ready === true, JSON.stringify(tasksReady).slice(0, 220));
    }

    const T = asserts.TASKS;
    const d = fixture.dates;

    async function contentOf() {
      const got = await editorContent(client);
      return got && got.ok ? got.value : "";
    }

    const configPath = fixture.configPath;
    async function keepOn(description, dateText, reason, extra) {
      await pinToday(client, dateText, configPath);
      await waitForFreshnessQueueLine(client, description);
      const cursor = await placeCursor(client, description);
      if (!cursor || !cursor.ok) return { ok: false, error: cursor && cursor.error || "cursor", cursor };
      const result = await refreshKeep(client, {
        dateText,
        keepReason: reason,
        countExplicit: extra && extra.countExplicit,
        additionalTaskCount: extra && extra.additionalTaskCount,
      });
      if (result && result.ok) await flushAndWaitForTaskCache(client, description);
      return { ok: Boolean(result && result.ok), result, cursor, content: await contentOf() };
    }

    async function openCardOn(description, dateText) {
      await pinToday(client, dateText, configPath);
      await waitForFreshnessQueueLine(client, description);
      const cursor = await placeCursor(client, description);
      if (!cursor || !cursor.ok) return { ok: false, error: cursor && cursor.error || "cursor" };
      const started = await startRefreshKeep(client, { dateText });
      if (!started || started.ok !== true) {
        return { card: { open: false, error: started && started.error || "refresh did not start" }, cursor };
      }
      let card = null;
      const probeDeadline = Date.now() + 10_000;
      while (Date.now() < probeDeadline) {
        card = await client.evaluate(CARD_PROBE).catch((error) => ({ open: false, error: String(error) }));
        if (card && card.open === true) break;
        await sleep(100);
      }
      if (!card || card.open !== true) {
        await cancelPendingRefreshModal(client).catch(() => ({ closed: false }));
        await finishRefreshKeep(client).catch(() => ({ ok: false }));
        card = {
          ...(card || {}),
          open: false,
          error: card && card.error || "timed out waiting for decay card in the app document",
        };
      }
      return { finish: () => finishRefreshKeep(client), card, cursor };
    }

    // --- WIP: keep 1, keep 2, card, step, undo, drop ---
    const wipKeep1 = await keepOn(T.wip.description, d.day1, "still mid-refactor");
    const wipAfter1 = wipKeep1.content || "";
    record("wip-keep-1-line", asserts.assertTaskFields(asserts.extractTaskLine(wipAfter1, T.wip.description), {
      status: "/", fresh: d.day1, keeps: 1, id: T.wip.id,
    }).ok, asserts.assertTaskFields(asserts.extractTaskLine(wipAfter1, T.wip.description), {
      status: "/", fresh: d.day1, keeps: 1, id: T.wip.id,
    }).reason || asserts.extractTaskLine(wipAfter1, T.wip.description));
    record("wip-keep-1-log", asserts.assertLogBodies(wipAfter1, T.wip.description, [
      { date: d.day1, body: asserts.keptBody("still mid-refactor", 1, "WIP") },
    ]).ok, JSON.stringify(asserts.extractRottenLogBodies(wipAfter1, T.wip.description)));
    record("wip-keep-1-no-work-log", asserts.assertNoWorkLog(wipAfter1).ok, asserts.assertNoWorkLog(wipAfter1).reason || "");

    const wipKeep2 = await keepOn(T.wip.description, d.day2, "");
    const wipAfter2 = wipKeep2.content || "";
    record("wip-keep-2-line", asserts.assertTaskFields(asserts.extractTaskLine(wipAfter2, T.wip.description), {
      status: "/", fresh: d.day2, keeps: 2, id: T.wip.id,
    }).ok, asserts.extractTaskLine(wipAfter2, T.wip.description));
    record("wip-keep-2-log", asserts.assertLogBodies(wipAfter2, T.wip.description, [
      { date: d.day2, body: asserts.keptBody("", 2, "WIP") },
      { date: d.day1, body: asserts.keptBody("still mid-refactor", 1, "WIP") },
    ]).ok, JSON.stringify(asserts.extractRottenLogBodies(wipAfter2, T.wip.description)));

    const wipCard = await openCardOn(T.wip.description, d.day3);
    const wipCardAssert = asserts.assertCardProbe(wipCard.card, {
      title: asserts.CARD_TITLES.wip,
      stepLabel: asserts.CARD_STEP_LABELS.wip,
      omitLevels: true,
    });
    record("wip-card-open", wipCardAssert.ok, wipCardAssert.reason
      ? wipCardAssert.reason
      : JSON.stringify(wipCard.card).slice(0, 240));
    if (wipCard.card && wipCard.card.open) {
      await captureCard(client, outDir, "wip", report);
      record("wip-card-screenshots", true, "light+dark");
      const input = await cardKey(client, { key: "Enter" });
      record("wip-step-input", input.ok, JSON.stringify(input).slice(0, 2400));
      const closed = await waitForCardClosed(client, 8_000).catch(() => null);
      if (!closed || closed.open === true) await cancelPendingRefreshModal(client).catch(() => ({ closed: false }));
      await wipCard.finish();
      await waitForEditorTask(client, T.wip.description, (task) => task.status === "*" && task.fresh === d.day3);
      await flushAndWaitForTaskCache(client, T.wip.description);
    }
    const wipStepped = await contentOf();
    record("wip-step-line", asserts.assertTaskFields(asserts.extractTaskLine(wipStepped, T.wip.description), {
      status: "*", fresh: d.day3, id: T.wip.id, noKeeps: true,
    }).ok, asserts.extractTaskLine(wipStepped, T.wip.description));
    record("wip-step-log", asserts.assertLogBodies(wipStepped, T.wip.description, [
      { date: d.day3, body: asserts.stepBody("WIP", "Next", 2) },
      { date: d.day2, body: asserts.keptBody("", 2, "WIP") },
      { date: d.day1, body: asserts.keptBody("still mid-refactor", 1, "WIP") },
    ]).ok, JSON.stringify(asserts.extractRottenLogBodies(wipStepped, T.wip.description)));
    record("wip-step-no-work-log", asserts.assertNoWorkLog(wipStepped).ok, "");

    const undone = await undoEditor(client);
    await flushAndWaitForTaskCache(client, T.wip.description);
    const wipUndone = undone && undone.value || await contentOf();
    record("wip-undo-restores", asserts.assertTaskFields(asserts.extractTaskLine(wipUndone, T.wip.description), {
      status: "/", fresh: d.day2, keeps: 2, id: T.wip.id,
    }).ok, asserts.extractTaskLine(wipUndone, T.wip.description));

    const wipDropCard = await openCardOn(T.wip.description, d.day3);
    record("wip-drop-card-open", Boolean(wipDropCard.card && wipDropCard.card.open), wipDropCard.card && wipDropCard.card.documentContext && wipDropCard.card.documentContext.currentUrl || "card unavailable");
    if (wipDropCard.card && wipDropCard.card.open) {
      const input = await cardKey(client, { key: "d", code: "KeyD" });
      record("wip-drop-input", input.ok, JSON.stringify(input).slice(0, 240));
      const closed = await waitForCardClosed(client, 8_000).catch(() => null);
      if (!closed || closed.open === true) await cancelPendingRefreshModal(client).catch(() => ({ closed: false }));
      await wipDropCard.finish();
      await waitForEditorTask(client, T.wip.description, (task) => task.status === "-");
      await flushAndWaitForTaskCache(client, T.wip.description);
    }
    const wipDropped = await contentOf();
    record("wip-drop-line", asserts.assertTaskFields(asserts.extractTaskLine(wipDropped, T.wip.description), {
      status: "-", id: T.wip.id,
    }).ok, asserts.extractTaskLine(wipDropped, T.wip.description));
    const dropLogs = asserts.extractRottenLogBodies(wipDropped, T.wip.description);
    record("wip-drop-log", dropLogs.some((row) => row.body === asserts.dropBody("WIP", 2)), JSON.stringify(dropLogs));

    // --- Next: keep, keep, stay, two more keeps ---
    const nextKeep1 = await keepOn(T.next.description, d.day1, "waiting on Alice's review");
    record("next-keep-1-line", asserts.assertTaskFields(asserts.extractTaskLine(nextKeep1.content, T.next.description), {
      status: "*", fresh: d.day1, keeps: 1, id: T.next.id,
    }).ok, asserts.extractTaskLine(nextKeep1.content, T.next.description));
    record("next-keep-1-log", asserts.assertLogBodies(nextKeep1.content, T.next.description, [
      { date: d.day1, body: asserts.keptBody("waiting on Alice's review", 1, "Next") },
    ]).ok, JSON.stringify(asserts.extractRottenLogBodies(nextKeep1.content, T.next.description)));

    const nextKeep2 = await keepOn(T.next.description, d.day2, "");
    record("next-keep-2-line", asserts.assertTaskFields(asserts.extractTaskLine(nextKeep2.content, T.next.description), {
      status: "*", fresh: d.day2, keeps: 2, id: T.next.id,
    }).ok, asserts.extractTaskLine(nextKeep2.content, T.next.description));

    const nextCard = await openCardOn(T.next.description, d.day3);
    const nextCardAssert = asserts.assertCardProbe(nextCard.card, {
      title: asserts.CARD_TITLES.next,
      stepLabel: asserts.CARD_STEP_LABELS.next,
      omitLevels: true,
    });
    record("next-card-open", nextCardAssert.ok, nextCardAssert.reason
      ? nextCardAssert.reason
      : JSON.stringify(nextCard.card).slice(0, 200));
    if (nextCard.card && nextCard.card.open) {
      const input = await cardKey(client, { key: "f", code: "KeyF", alt: true });
      record("next-stay-input", input.ok, JSON.stringify(input).slice(0, 240));
      await sleep(300);
      const stayReady = await waitFor(client, CARD_PROBE, (value) => value && value.stayStage === true, "stay-stage", 6_000).catch(() => ({ stayStage: false }));
      record("next-stay-stage", Boolean(stayReady && stayReady.stayStage), JSON.stringify(stayReady).slice(0, 160));
      await submitStayReason(client, "still the next thing");
      const submitted = await cardKey(client, { key: "Enter" });
      record("next-stay-submit-input", submitted.ok, JSON.stringify(submitted).slice(0, 240));
      const closed = await waitForCardClosed(client, 8_000).catch(() => null);
      if (!closed || closed.open === true) await cancelPendingRefreshModal(client).catch(() => ({ closed: false }));
      await nextCard.finish();
      await waitForEditorTask(client, T.next.description, (task) => task.status === "*" && task.fresh === d.day3 && task.keeps == null);
      await flushAndWaitForTaskCache(client, T.next.description);
    }
    const nextStayed = await contentOf();
    record("next-stay-line", asserts.assertTaskFields(asserts.extractTaskLine(nextStayed, T.next.description), {
      status: "*", fresh: d.day3, id: T.next.id, noKeeps: true,
    }).ok, asserts.extractTaskLine(nextStayed, T.next.description));
    record("next-stay-log", asserts.assertLogBodies(nextStayed, T.next.description, [
      { date: d.day3, body: asserts.stayBody("still the next thing", 2, "Next") },
      { date: d.day2, body: asserts.keptBody("", 2, "Next") },
      { date: d.day1, body: asserts.keptBody("waiting on Alice's review", 1, "Next") },
    ]).ok, JSON.stringify(asserts.extractRottenLogBodies(nextStayed, T.next.description)));

    const nextKeepAgain = await keepOn(T.next.description, d.day4, "second lap");
    record("next-stay-allows-keep", asserts.assertTaskFields(asserts.extractTaskLine(nextKeepAgain.content, T.next.description), {
      status: "*", fresh: d.day4, keeps: 1, id: T.next.id,
    }).ok, asserts.extractTaskLine(nextKeepAgain.content, T.next.description));

    // --- Ready: keep, keep, card, step to P1 ---
    const readyKeep1 = await keepOn(T.ready.description, d.day1, "still the primer");
    record("ready-keep-1-line", asserts.assertTaskFields(asserts.extractTaskLine(readyKeep1.content, T.ready.description), {
      status: " ", fresh: d.day1, keeps: 1, id: T.ready.id,
    }).ok, asserts.extractTaskLine(readyKeep1.content, T.ready.description));
    const readyKeep2 = await keepOn(T.ready.description, d.day2, "");
    record("ready-keep-2-line", asserts.assertTaskFields(asserts.extractTaskLine(readyKeep2.content, T.ready.description), {
      status: " ", fresh: d.day2, keeps: 2, id: T.ready.id,
    }).ok, asserts.extractTaskLine(readyKeep2.content, T.ready.description));

    const readyCard = await openCardOn(T.ready.description, d.day3);
    const readyCardAssert = asserts.assertCardProbe(readyCard.card, {
      title: asserts.CARD_TITLES.ready,
      stepLabel: asserts.CARD_STEP_LABELS.ready,
    });
    record("ready-card-open", readyCardAssert.ok, readyCardAssert.reason
      ? readyCardAssert.reason
      : JSON.stringify(readyCard.card).slice(0, 240));
    if (readyCard.card && readyCard.card.open) {
      await captureCard(client, outDir, "ready", report);
      record("ready-card-screenshots", true, "light+dark");
      const input = await cardKey(client, { key: "Enter" });
      record("ready-step-input", input.ok, JSON.stringify(input).slice(0, 240));
      const closed = await waitForCardClosed(client, 8_000).catch(() => null);
      if (!closed || closed.open === true) await cancelPendingRefreshModal(client).catch(() => ({ closed: false }));
      await readyCard.finish();
      await waitForEditorTask(client, T.ready.description, (task) => task.status === " " && task.priority === "high" && task.fresh === d.day3);
      await flushAndWaitForTaskCache(client, T.ready.description);
    }
    const readyStepped = await contentOf();
    const readyLine = asserts.extractTaskLine(readyStepped, T.ready.description);
    const readyFields = asserts.parseTaskLine(readyLine);
    record("ready-step-line", readyFields.status === "?" && readyFields.priority === "high" && readyFields.fresh === d.day3 && readyFields.keeps == null, readyLine);
    record("ready-step-p1-window", asserts.inP1Window(readyFields.scheduled, d.day3) || asserts.inP1Window(readyFields.scheduled, dates.today), `scheduled=${readyFields.scheduled}`);
    record("ready-step-log", asserts.extractRottenLogBodies(readyStepped, T.ready.description).some((row) => row.body === asserts.stepBody("Ready", "P1", 2)), JSON.stringify(asserts.extractRottenLogBodies(readyStepped, T.ready.description)));

    // --- P4: keep, keep, card, roll again ---
    const p4Keep1 = await keepOn(T.p4.description, d.day1, "bottom of the ladder");
    record("p4-keep-1-line", asserts.assertTaskFields(asserts.extractTaskLine(p4Keep1.content, T.p4.description), {
      status: " ", fresh: d.day1, keeps: 1, id: T.p4.id, priority: "lowest",
    }).ok, asserts.extractTaskLine(p4Keep1.content, T.p4.description));
    record("p4-keep-1-log", asserts.assertLogBodies(p4Keep1.content, T.p4.description, [
      { date: d.day1, body: asserts.keptBody("bottom of the ladder", 1, "P4") },
    ]).ok, JSON.stringify(asserts.extractRottenLogBodies(p4Keep1.content, T.p4.description)));
    const p4Keep2 = await keepOn(T.p4.description, d.day2, "");
    record("p4-keep-2-line", asserts.assertTaskFields(asserts.extractTaskLine(p4Keep2.content, T.p4.description), {
      status: " ", fresh: d.day2, keeps: 2, id: T.p4.id, priority: "lowest",
    }).ok, asserts.extractTaskLine(p4Keep2.content, T.p4.description));
    record("p4-keep-2-log", asserts.assertLogBodies(p4Keep2.content, T.p4.description, [
      { date: d.day2, body: asserts.keptBody("", 2, "P4") },
      { date: d.day1, body: asserts.keptBody("bottom of the ladder", 1, "P4") },
    ]).ok, JSON.stringify(asserts.extractRottenLogBodies(p4Keep2.content, T.p4.description)));

    const p4Card = await openCardOn(T.p4.description, d.day3);
    const p4CardAssert = asserts.assertCardProbe(p4Card.card, {
      title: asserts.CARD_TITLES.p4,
      stepLabel: asserts.CARD_STEP_LABELS.p4,
    });
    record("p4-card-open", p4CardAssert.ok, p4CardAssert.reason
      ? p4CardAssert.reason
      : JSON.stringify(p4Card.card).slice(0, 240));
    if (p4Card.card && p4Card.card.open) {
      await captureCard(client, outDir, "p4", report);
      record("p4-card-screenshots", true, "light+dark");
      const input = await cardKey(client, { key: "Enter" });
      record("p4-roll-input", input.ok, JSON.stringify(input).slice(0, 240));
      const closed = await waitForCardClosed(client, 8_000).catch(() => null);
      if (!closed || closed.open === true) await cancelPendingRefreshModal(client).catch(() => ({ closed: false }));
      await p4Card.finish();
      await waitForEditorTask(client, T.p4.description, (task) => task.status === " " && task.priority === "lowest" && task.fresh === d.day3);
      await flushAndWaitForTaskCache(client, T.p4.description);
    }
    const p4Rolled = await contentOf();
    const p4Line = asserts.extractTaskLine(p4Rolled, T.p4.description);
    const p4Fields = asserts.parseTaskLine(p4Line);
    record("p4-roll-line", p4Fields.status === "?" && p4Fields.priority === "lowest" && p4Fields.fresh === d.day3 && p4Fields.keeps == null, p4Line);
    record("p4-roll-log", asserts.extractRottenLogBodies(p4Rolled, T.p4.description).some((row) => row.body === "🍂 rolled again at P4 · after 2 keeps"), JSON.stringify(asserts.extractRottenLogBodies(p4Rolled, T.p4.description)));

    // --- Batch skip at-limit Ready targets ---
    const beforeSkip = await contentOf();
    const skipABefore = asserts.extractTaskLine(beforeSkip, T.skipA.description);
    const skipBBefore = asserts.extractTaskLine(beforeSkip, T.skipB.description);
    await pinToday(client, d.day1, configPath);
    await waitForFreshnessQueueLine(client, T.skipA.description);
    await placeCursor(client, T.skipA.description);
    await beginNoticeCapture(client);
    const skippedBatch = await refreshKeep(client, {
      dateText: d.day1,
      keepReason: "should not apply",
      countExplicit: true,
      additionalTaskCount: 1,
    });
    await sleep(100);
    const afterSkip = await contentOf();
    const notice = await endNoticeCapture(client);
    record("batch-skip-no-write", asserts.extractTaskLine(afterSkip, T.skipA.description) === skipABefore && asserts.extractTaskLine(afterSkip, T.skipB.description) === skipBBefore, `A ${asserts.extractTaskLine(afterSkip, T.skipA.description)} B ${asserts.extractTaskLine(afterSkip, T.skipB.description)}`);
    record("batch-skip-notice", asserts.assertSkipNotice(notice.text + " " + (notice.all || []).join(" "), 2).ok || asserts.assertSkipNotice(JSON.stringify(skippedBatch), 2).ok, JSON.stringify(notice).slice(0, 220));

    report.cases = cases;
    report.skipped = skipped;
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
      screenshots: report.screenshots,
      out: outDir,
    }, null, 2));
    if (!report.pass) fail(`e2e failed: ${cases.filter((item) => !item.ok).map((item) => item.name).join(", ")}`, 1);
    return report;
  } finally {
    if (client) client.close();
    try {
      if (child.exitCode == null && child.signalCode == null) child.kill("SIGTERM");
    } catch {
      // Already gone.
    }
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
    const cleanup = lib.planOwnedCleanup([runRoot], [runRoot]);
    for (const target of cleanup.removable) {
      try { fs.rmSync(target, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    console.log(HELP_TEXT);
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
