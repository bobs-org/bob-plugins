#!/usr/bin/env node
// Real-Obsidian Alt+P regression e2e. Uses an isolated vault and profile only.
// Run with: xvfb-run -a node scripts/obsidian-quick-roll-e2e.cjs
"use strict";

const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const startup = require("./obsidian-startup-smoke-lib.cjs");
const quickRoll = require("./obsidian-quick-roll-e2e-lib.cjs");
const OVERALL_TIMEOUT_MS = 180_000;

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
  "Usage: xvfb-run -a node scripts/obsidian-quick-roll-e2e.cjs [OPTIONS]",
  "",
  "Drive Alt+P in an isolated real Obsidian vault through CDP.",
  "The script never opens the live vault.",
  "",
  "Options:",
  "  -e, --executable PATH   Obsidian executable (default: /snap/bin/obsidian)",
  "  -r, --report PATH       Write the structured JSON report to PATH",
  "  -s, --self-test         Run offline fixture and assertion tests",
  "  -h, --help              Print this help and exit",
].join("\n");

function parseArgs(argv) {
  const args = { executable: null, report: null, selfTest: false, help: false };
  const list = Array.isArray(argv) ? argv.slice() : [];
  for (let index = 0; index < list.length; index += 1) {
    const token = list[index];
    if (token === "-e" || token === "--executable") {
      const value = list[++index];
      if (!value || value.startsWith("-")) throw new Error("--executable requires a PATH value");
      args.executable = value;
    } else if (token === "-r" || token === "--report") {
      const value = list[++index];
      if (!value || value.startsWith("-")) throw new Error("--report requires a PATH value");
      args.report = value;
    } else if (token === "-s" || token === "--self-test") {
      args.selfTest = true;
    } else if (token === "-h" || token === "--help") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

function findExecutable(override) {
  const candidates = [override, process.env.OBSIDIAN_BIN, "/snap/bin/obsidian"].filter(Boolean);
  for (const candidate of candidates) {
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
  const scratch = quickRoll.makeScratch(repoRoot, "probe");
  try {
    const result = spawnSync(executable, ["--no-sandbox", `--user-data-dir=${scratch}`, "--help"], {
      encoding: "utf8",
      timeout: 20_000,
    });
    const combined = String((result.stdout || "") + (result.stderr || ""));
    if (/unable to find Obsidian/i.test(combined)) {
      return { ok: false, reason: `executable ${executable} is the Obsidian CLI shim, not the Electron app` };
    }
    return { ok: true };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function readExpectedPlugins() {
  const result = [];
  for (const entry of fs.readdirSync(path.join(repoRoot, "plugins"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(repoRoot, "plugins", entry.name, "manifest.json");
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (manifest && typeof manifest.id === "string" && typeof manifest.version === "string") {
        result.push({ id: manifest.id, version: manifest.version });
      }
    } catch {
      // The build and manifest gates report invalid plugin metadata.
    }
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
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
  if (configured) throw new Error(`Tasks plugin source is incomplete: ${path.resolve(configured)}`);
  return null;
}

function writeFixture(vaultDir, configHome, homeDir, dates) {
  fs.mkdirSync(path.dirname(path.join(vaultDir, quickRoll.notePath())), { recursive: true });
  fs.writeFileSync(path.join(vaultDir, quickRoll.notePath()), quickRoll.seedNote(dates));
  for (const configRoot of [path.join(configHome, "bob"), path.join(homeDir, ".config", "bob")]) {
    fs.mkdirSync(configRoot, { recursive: true });
    fs.writeFileSync(path.join(configRoot, "config.yml"), quickRoll.configYaml());
  }

  const enabled = [];
  for (const plugin of readExpectedPlugins()) {
    copyPluginFiles(path.join(repoRoot, "plugins", plugin.id), path.join(vaultDir, ".obsidian", "plugins", plugin.id));
    enabled.push(plugin.id);
  }
  const tasksSource = findTasksPluginSource();
  if (tasksSource) {
    const target = path.join(vaultDir, ".obsidian", "plugins", "obsidian-tasks-plugin");
    copyPluginFiles(tasksSource, target);
    fs.writeFileSync(path.join(target, "data.json"), JSON.stringify(TASKS_DATA, null, 2));
    enabled.push("obsidian-tasks-plugin");
  }
  const obsidian = path.join(vaultDir, ".obsidian");
  fs.mkdirSync(obsidian, { recursive: true });
  fs.writeFileSync(path.join(obsidian, "community-plugins.json"), JSON.stringify(enabled, null, 2));
  fs.writeFileSync(path.join(obsidian, "app.json"), JSON.stringify({ livePreview: true, showLineNumber: false, showInlineTitle: false }, null, 2));
  fs.writeFileSync(path.join(obsidian, "appearance.json"), JSON.stringify({ cssTheme: "", theme: "moonstone" }, null, 2));
  fs.writeFileSync(path.join(obsidian, "core-plugins.json"), JSON.stringify([
    "file-explorer", "global-search", "switcher", "page-preview", "command-palette",
    "editor-status", "outline", "daily-notes",
  ], null, 2));
  return { enabled, tasksPlugin: Boolean(tasksSource), configPath: path.join(configHome, "bob", "config.yml") };
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
      const pending = message.id && this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message || JSON.stringify(message.error)}`));
      else pending.resolve(message.result || {});
    });
    socket.addEventListener("close", () => {
      this.closed = true;
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`${pending.method}: CDP socket closed`));
      }
      this.pending.clear();
    });
  }

  static connect(endpoint) {
    const WebSocketClient = globalThis.WebSocket || require("undici").WebSocket;
    return startup.withTimeout(new Promise((resolve, reject) => {
      const socket = new WebSocketClient(endpoint);
      socket.addEventListener("open", () => resolve(new CdpClient(socket)), { once: true });
      socket.addEventListener("error", (event) => reject(new Error(event.message || "CDP connect failed")), { once: true });
    }), startup.CONNECT_TIMEOUT_MS, "CDP connect");
  }

  call(method, params, timeoutMs) {
    if (this.closed) return Promise.reject(new Error(`${method}: CDP socket is closed`));
    const id = this.nextId++;
    return startup.withTimeout(new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs || startup.RPC_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, method, timer });
      this.socket.send(JSON.stringify({ id, method, params: params || {} }));
    }), (timeoutMs || startup.RPC_TIMEOUT_MS) + 1000, method);
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
    try { this.socket.close(); } catch { /* already closed */ }
  }
}

const VAULT_PATH_PROBE = `(() => {
  const adapter = window.app && window.app.vault && window.app.vault.adapter;
  return adapter && typeof adapter.basePath === "string" ? adapter.basePath : null;
})()`;

const QUICK_ROLL_PROBE = `(() => {
  const app = window.app;
  const nav = app && app.plugins && app.plugins.plugins && app.plugins.plugins["bob-navigation-hotkeys"];
  const picker = nav && nav.activeBulletPropertyPicker;
  const leaf = app && app.workspace && app.workspace.activeLeaf;
  const editor = leaf && leaf.view && leaf.view.editor;
  const line = editor && editor.getCursor ? editor.getCursor().line : -1;
  const lines = editor && editor.getValue ? editor.getValue().split(/\\r?\\n/) : [];
  const modal = picker && picker.modalEl;
  return {
    pickerOpen: Boolean(picker && picker.pickerOpen),
    stage: picker && picker.stage || null,
    quickPending: Boolean(modal && modal.classList.contains("bob-task-card-quick-pending")),
    visibility: modal ? getComputedStyle(modal).visibility : null,
    editorLine: lines[line] || "",
    editorValue: editor && editor.getValue ? editor.getValue() : "",
    lockBusy: Boolean(nav && nav.reviewWalkBusy && nav.reviewWalkBusy()),
    notices: Array.isArray(window.__quickRollNotices) ? window.__quickRollNotices.slice() : [],
  };
})()`;

async function selectOwnedTarget(port, fixtureRealPath, shouldStop) {
  const deadline = Date.now() + startup.CONNECT_TIMEOUT_MS * 2;
  let lastError = "";
  while (Date.now() < deadline) {
    if (shouldStop()) throw new Error("owned Obsidian process exited before the fixture window appeared");
    let pages = [];
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) pages = await response.json();
    } catch (error) {
      lastError = error.message || String(error);
    }
    for (const page of Array.isArray(pages) ? pages : []) {
      if (!page || page.type !== "page" || !page.webSocketDebuggerUrl) continue;
      let client = null;
      try {
        client = await CdpClient.connect(page.webSocketDebuggerUrl);
        const reported = await client.evaluate(VAULT_PATH_PROBE, 5000);
        if (startup.verifyVaultPath(reported, fixtureRealPath)) return page;
      } catch (error) {
        lastError = error.message || String(error);
      } finally {
        client?.close();
      }
    }
    await sleep(300);
  }
  throw new Error(`no CDP page reports the scratch vault${lastError ? `: ${lastError}` : ""}`);
}

async function dismissTrustModal(client) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await client.evaluate(`(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const trust = buttons.find((button) => /Trust author and enable plugins/i.test(button.textContent || ""));
      if (!trust) return false;
      trust.click();
      return true;
    })()`).catch(() => false);
    if (result) return;
    await sleep(200);
  }
}

async function waitFor(client, predicate, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await client.evaluate(QUICK_ROLL_PROBE).catch((error) => ({ error: error.message || String(error) }));
    if (predicate(last)) return last;
    await sleep(35);
  }
  throw new Error(`timed out waiting for ${label}: ${JSON.stringify(last)}`);
}

async function openFixtureNote(client) {
  return client.evaluate(`(() => (async () => {
    const file = window.app.vault.getAbstractFileByPath(${JSON.stringify(quickRoll.notePath())});
    if (!file) return { ok: false, error: "fixture note missing" };
    const leaf = window.app.workspace.getLeaf(false);
    await leaf.openFile(file, { state: { mode: "source", source: true } });
    const view = leaf.view;
    if (view && view.setState) await view.setState({ mode: "source", source: true }, { history: false });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { ok: true, path: view.file && view.file.path };
  })())()`);
}

async function setCursorOnTask(client, description) {
  return client.evaluate(`(() => {
    const view = window.app.workspace.activeLeaf && window.app.workspace.activeLeaf.view;
    const editor = view && view.editor;
    if (!editor || !editor.getValue) return { ok: false, error: "no editor" };
    const lines = editor.getValue().split(/\\r?\\n/);
    const line = lines.findIndex((item) => item.includes(${JSON.stringify(`#task ${description}`)}));
    if (line < 0) return { ok: false, error: "task line missing" };
    editor.setCursor({ line, ch: 0 });
    editor.focus();
    return { ok: true, line, text: lines[line] };
  })()`);
}

function altPEvents() {
  return [
    { type: "keyDown", key: "Alt", code: "AltLeft", modifiers: 1, windowsVirtualKeyCode: 18, nativeVirtualKeyCode: 18 },
    { type: "keyDown", key: "π", code: "KeyP", modifiers: 1, windowsVirtualKeyCode: 80, nativeVirtualKeyCode: 80 },
    { type: "keyUp", key: "π", code: "KeyP", modifiers: 1, windowsVirtualKeyCode: 80, nativeVirtualKeyCode: 80 },
    { type: "keyUp", key: "Alt", code: "AltLeft", modifiers: 0, windowsVirtualKeyCode: 18, nativeVirtualKeyCode: 18 },
  ];
}

async function pressAltP(client, targetModal) {
  if (targetModal) {
    const focus = await client.evaluate(`(() => {
      const nav = window.app.plugins.plugins["bob-navigation-hotkeys"];
      const picker = nav && nav.activeBulletPropertyPicker;
      const modal = picker && picker.modalEl;
      const input = picker && (picker.scheduleReviewSummaryEl || picker.inputEl);
      if (!modal || !input) return { ok: false, reason: "Task Card summary input is missing" };
      input.focus();
      return {
        ok: document.activeElement === input && modal.contains(input),
        stage: picker.stage,
        inputTag: input.tagName || "",
      };
    })()`);
    if (!focus || focus.ok !== true) throw new Error(`could not focus Task Card modal: ${JSON.stringify(focus)}`);
  }
  for (const event of altPEvents()) await client.call("Input.dispatchKeyEvent", event, 5000);
}

async function currentTaskLine(client, description) {
  const probe = await client.evaluate(QUICK_ROLL_PROBE);
  return quickRoll.extractTaskLine(probe.editorValue, description);
}

async function saveEditor(client) {
  const result = await client.evaluate(`(() => (async () => {
    const view = window.app.workspace.activeLeaf && window.app.workspace.activeLeaf.view;
    if (!view || typeof view.save !== "function") return { ok: false };
    await view.save();
    return { ok: true };
  })())()`);
  if (!result || result.ok !== true) throw new Error("could not save fixture editor");
}

async function markScenarioTasksDone(client) {
  const descriptions = [quickRoll.TASKS.ready, quickRoll.TASKS.pending];
  const result = await client.evaluate(`(() => {
    const view = window.app.workspace.activeLeaf && window.app.workspace.activeLeaf.view;
    const editor = view && view.editor;
    if (!editor || !editor.getValue || !editor.setValue) return { ok: false };
    const descriptions = ${JSON.stringify(descriptions)};
    const content = editor.getValue().split(/\\r?\\n/).map((line) =>
      descriptions.some((description) => line.includes("#task " + description))
        ? line.replace(/^- \\[[^\\]]\\]/, "- [x]")
        : line,
    ).join("\\n");
    editor.setValue(content);
    const nav = window.app.plugins.plugins["bob-navigation-hotkeys"];
    if (nav) {
      nav.reviewLanding = null;
      nav.reviewAnchor = null;
      nav.reviewWalkCurrent = null;
      nav.reviewAnsweredKeys = [];
      nav.reviewWalkLock = null;
    }
    return { ok: true };
  })()`);
  if (!result || result.ok !== true) throw new Error("could not prepare the settle-lock fixture rows");
  await saveEditor(client);
}

async function pinToday(client, dateText, configPath) {
  return client.evaluate(`(() => {
    const day = ${JSON.stringify(dateText)};
    const configPath = ${JSON.stringify(configPath)};
    const plugins = window.app.plugins.plugins;
    const ledger = plugins["bob-ledger-tools"];
    const nav = plugins["bob-navigation-hotkeys"];
    const freshness = Object.freeze({
      interval: 1, pendingInterval: 1, nextInterval: 1, projectInterval: null,
      rottenDailyBudget: null, intervalFromConfig: true, invalid: false,
      deprecatedStaleBudget: false,
      decay: Object.freeze({ enabled: true, keeps: 2, pending: 2, next: 2, ready: 2, enter: "P1" }),
    });
    if (ledger) {
      ledger.freshnessTodayText = () => day;
      ledger.freshnessMemo = null;
      ledger.freshnessConfigCache = null;
      ledger.apiFreshnessConfig = () => freshness;
      if (typeof ledger.refreshFreshnessConfig === "function") ledger.refreshFreshnessConfig();
    }
    if (nav) {
      nav.laneReleaseDateText = (options) => options && options.dateText || day;
      nav.getFreshnessDateText = () => day;
      nav.freshnessDecayConfigLoadOptions = { configPath };
    }
    Math.random = () => 0;
    return { ok: Boolean(ledger && nav), day };
  })()`);
}

async function installNoticeCapture(client) {
  return client.evaluate(`(() => {
    window.__quickRollNotices = [];
    const collect = (root) => {
      if (!root || root.nodeType !== 1) return;
      const nodes = [];
      if (root.matches && root.matches(".notice")) nodes.push(root);
      if (root.querySelectorAll) nodes.push(...root.querySelectorAll(".notice"));
      for (const node of nodes) {
        const text = String(node.textContent || "").trim();
        if (text) window.__quickRollNotices.push(text);
      }
    };
    window.__quickRollObserver = new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes || []) collect(node);
    });
    window.__quickRollObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    return true;
  })()`);
}

async function runSelfTest() {
  const scratch = quickRoll.makeScratch(repoRoot, "self-test");
  try {
    const dates = quickRoll.fixtureDates(new Date(2026, 10, 5));
    const note = quickRoll.seedNote(dates);
    assert.match(note, /- \[ \] #task Quick roll ready task/);
    assert.match(note, /- \[\/\] #task Quick roll pending task/);
    assert.match(note, /Quick roll walk three/);
    assert.match(quickRoll.configYaml(), /max_days: 8/);
    assert.equal(quickRoll.assertP1TaskLine("- [ ] #task X [priority:: high] [scheduled:: 2026-11-09]", "2026-11-05").ok, true);
    assert.equal(quickRoll.assertP1TaskLine("- [ ] #task X [priority:: high] [scheduled:: 2026-11-06]", "2026-11-05").ok, false);
    assert.equal(quickRoll.assertVisiblePendingCard({ open: true, stage: "schedule-work-log", visibility: "visible", quickPending: false }).ok, true);
    assert.equal(quickRoll.assertBusyNotice(["Review walk still settling — press Alt+P again"]).ok, true);
    const events = altPEvents();
    assert.deepEqual(events.map(({ type, key, code, modifiers, windowsVirtualKeyCode }) => ({ type, key, code, modifiers, windowsVirtualKeyCode })), [
      { type: "keyDown", key: "Alt", code: "AltLeft", modifiers: 1, windowsVirtualKeyCode: 18 },
      { type: "keyDown", key: "π", code: "KeyP", modifiers: 1, windowsVirtualKeyCode: 80 },
      { type: "keyUp", key: "π", code: "KeyP", modifiers: 1, windowsVirtualKeyCode: 80 },
      { type: "keyUp", key: "Alt", code: "AltLeft", modifiers: 0, windowsVirtualKeyCode: 18 },
    ]);
    assert.equal(fs.existsSync(scratch), true);
    console.log("offline self-test complete (not an Obsidian pass)");
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

async function runE2e(parsed) {
  const executable = findExecutable(parsed.executable);
  const probe = probeExecutable(executable);
  if (!probe.ok) throw Object.assign(new Error(`unrun: ${probe.reason}; rerun on a host with the Obsidian Electron app`), { exitCode: 2 });
  if (!process.env.DISPLAY && !process.env.XVFB_RUN_TMPDIR) {
    throw Object.assign(new Error("unrun: no X display; rerun under xvfb-run -a"), { exitCode: 2 });
  }

  const runRoot = quickRoll.makeScratch(repoRoot, "run");
  const vaultDir = path.join(runRoot, "vault");
  const profileDir = path.join(runRoot, "profile");
  const configHome = path.join(runRoot, "xdg");
  const homeDir = path.join(runRoot, "home");
  fs.mkdirSync(vaultDir, { recursive: true });
  const dates = quickRoll.fixtureDates();
  const fixture = writeFixture(vaultDir, configHome, homeDir, dates);
  const fixtureRealPath = fs.realpathSync(vaultDir);
  seedProfileVault(profileDir, fixtureRealPath);
  if (!fixture.tasksPlugin) throw new Error("Tasks plugin source missing; set BOB_E2E_TASKS_PLUGIN_DIR to an installed plugin directory");

  const port = await freePort();
  const child = spawn(executable, [
    "--no-sandbox", `--user-data-dir=${profileDir}`, `--remote-debugging-port=${port}`,
    "--remote-allow-origins=http://127.0.0.1/*", fixtureRealPath,
  ], {
    cwd: fixtureRealPath,
    env: {
      ...process.env,
      HOME: homeDir,
      BOB_DIR: fixtureRealPath,
      XDG_CONFIG_HOME: configHome,
      TMPDIR: os.tmpdir(),
    },
    stdio: "ignore",
  });
  let processExit = null;
  child.once("exit", (code, signal) => { processExit = `code=${code} signal=${signal || "none"}`; });
  let client = null;
  const cases = [];
  const report = { executable, vault: fixtureRealPath, today: dates.today, cases, pass: false };
  const record = (name, ok, detail) => {
    cases.push({ name, ok: Boolean(ok), detail: detail || "" });
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  };

  try {
    const target = await selectOwnedTarget(port, fixtureRealPath, () => Boolean(processExit));
    client = await CdpClient.connect(target.webSocketDebuggerUrl);
    await client.call("Page.enable");
    await client.call("Runtime.enable");
    await client.call("Input.enable").catch(() => ({}));
    const appDeadline = Date.now() + 30_000;
    let appReady = false;
    while (Date.now() < appDeadline) {
      appReady = await client.evaluate("Boolean(window.app && window.app.workspace && window.app.workspace.layoutReady)").catch(() => false);
      if (appReady) break;
      await sleep(250);
    }
    if (!appReady) throw new Error("Obsidian workspace did not become layout-ready");
    await client.evaluate(`(() => (async () => {
      const plugins = window.app && window.app.plugins;
      if (plugins && typeof plugins.isEnabled === "function" && !plugins.isEnabled()) await plugins.setEnable(true);
      return Boolean(plugins && plugins.isEnabled && plugins.isEnabled());
    })())()`);
    await dismissTrustModal(client);

    const pluginDeadline = Date.now() + 30_000;
    let pluginsLoaded = false;
    while (Date.now() < pluginDeadline) {
      pluginsLoaded = await client.evaluate(`(() => {
        const plugins = window.app && window.app.plugins && window.app.plugins.plugins;
        return Boolean(plugins && plugins["bob-navigation-hotkeys"] && plugins["bob-ledger-tools"] && plugins["obsidian-tasks-plugin"]);
      })()`).catch(() => false);
      if (pluginsLoaded) break;
      await sleep(250);
    }
    record("plugins-loaded", pluginsLoaded, pluginsLoaded ? "navigation, ledger, Tasks" : "required plugin missing");
    if (!pluginsLoaded) throw new Error("required Bob or Tasks plugin did not load in the scratch vault");

    const opened = await openFixtureNote(client);
    record("fixture-note-open", Boolean(opened && opened.ok), JSON.stringify(opened));
    if (!opened || !opened.ok) throw new Error("could not open quick-roll fixture note");
    const pinned = await pinToday(client, dates.today, fixture.configPath);
    record("clock-pinned", Boolean(pinned && pinned.ok), JSON.stringify(pinned));
    await installNoticeCapture(client);

    const readyCursor = await setCursorOnTask(client, quickRoll.TASKS.ready);
    if (!readyCursor.ok) throw new Error(`ready cursor: ${readyCursor.error}`);
    await pressAltP(client, false);
    const readyProbe = await waitFor(client, (value) => {
      const line = quickRoll.extractTaskLine(value.editorValue, quickRoll.TASKS.ready);
      return quickRoll.assertP1TaskLine(line, dates.today).ok && value.pickerOpen === false;
    }, "Ready task P1 write");
    await saveEditor(client);
    const readyLine = quickRoll.extractTaskLine(readyProbe.editorValue, quickRoll.TASKS.ready);
    const readyResult = quickRoll.assertP1TaskLine(readyLine, dates.today);
    record("ready-no-priority-writes-p1-without-card", readyResult.ok && readyProbe.pickerOpen === false, JSON.stringify(readyResult));

    const pendingCursor = await setCursorOnTask(client, quickRoll.TASKS.pending);
    if (!pendingCursor.ok) throw new Error(`pending cursor: ${pendingCursor.error}`);
    await pressAltP(client, false);
    const pendingProbe = await waitFor(client, (value) => value.pickerOpen && value.stage === "schedule-work-log", "Pending Work summary stage");
    const visible = quickRoll.assertVisiblePendingCard(pendingProbe);
    record("pending-summary-card-is-computed-visible", visible.ok, JSON.stringify(visible));
    if (!visible.ok) throw new Error(visible.reason);
    await pressAltP(client, true);
    const pendingWritten = await waitFor(client, (value) => {
      const line = quickRoll.extractTaskLine(value.editorValue, quickRoll.TASKS.pending);
      return quickRoll.assertP1TaskLine(line, dates.today).ok && value.pickerOpen === false;
    }, "Pending second Alt+P write");
    await saveEditor(client);
    const pendingResult = quickRoll.assertP1TaskLine(
      quickRoll.extractTaskLine(pendingWritten.editorValue, quickRoll.TASKS.pending),
      dates.today,
    );
    record("pending-second-alt-p-submits", pendingResult.ok && pendingWritten.pickerOpen === false, JSON.stringify(pendingResult));

    await markScenarioTasksDone(client);
    const clockSet = await client.evaluate(`(() => {
      const nav = window.app.plugins.plugins["bob-navigation-hotkeys"];
      window.__quickRollClock = Date.now();
      nav.reviewAdvanceNow = () => window.__quickRollClock;
      return { ok: Boolean(nav && nav.reviewAdvanceNow), now: window.__quickRollClock };
    })()`);
    record("settle-window-clock-controlled", Boolean(clockSet && clockSet.ok), JSON.stringify(clockSet));

    // This is the jump-to-next-due-task callback used by the vault's `]s` mapping.
    const jumped = await client.evaluate(`(() => (async () => {
      const nav = window.app.plugins.plugins["bob-navigation-hotkeys"];
      return await nav.jumpToDueTask(1);
    })())()`);
    if (jumped !== true) throw new Error("review walk did not land on a fixture task");
    const firstLanding = await client.evaluate(QUICK_ROLL_PROBE);
    const sourceDescription = quickRoll.TASKS.walk.find((description) => firstLanding.editorLine.includes(description));
    record("review-walk-lands-on-lock-fixture", Boolean(sourceDescription), firstLanding.editorLine);
    if (!sourceDescription) throw new Error("review walk did not choose a lock fixture task");

    await pressAltP(client, false);
    const advanced = await waitFor(client, (value) =>
      value.pickerOpen === false && value.lockBusy === true &&
      !value.editorLine.includes(sourceDescription),
    "answer advances and enters settle lock");
    const targetDescription = quickRoll.TASKS.walk.find((description) => advanced.editorLine.includes(description));
    if (!targetDescription) throw new Error("review walk did not land on the next lock fixture task");
    const untouchedBefore = quickRoll.extractTaskLine(advanced.editorValue, targetDescription);
    const noticeStart = advanced.notices.length;
    record("answer-lands-next-review-row", true, targetDescription);

    await pressAltP(client, false);
    const busyProbe = await waitFor(client, (value) =>
      value.notices.slice(noticeStart).some((notice) => notice.includes("Review walk still settling — press Alt+P again")),
    "Alt+P settling notice");
    const busyNotice = quickRoll.assertBusyNotice(busyProbe.notices.slice(noticeStart));
    const untouchedAfter = quickRoll.extractTaskLine(busyProbe.editorValue, targetDescription);
    const busyOk = busyNotice.ok && busyProbe.pickerOpen === false && untouchedAfter === untouchedBefore;
    record("settle-lock-shows-one-notice-and-writes-nothing", busyOk, JSON.stringify({ busyNotice, untouched: untouchedAfter === untouchedBefore }));
    if (!busyOk) throw new Error(busyNotice.reason || "settling key opened a picker or wrote the task");

    await client.evaluate("window.__quickRollClock += 351");
    await waitFor(client, (value) => value.lockBusy === false, "settle lock expiry");
    await pressAltP(client, false);
    const resumed = await waitFor(client, (value) => {
      const line = quickRoll.extractTaskLine(value.editorValue, targetDescription);
      return quickRoll.assertP1TaskLine(line, dates.today).ok && value.pickerOpen === false;
    }, "Alt+P after settle window");
    await saveEditor(client);
    const resumedResult = quickRoll.assertP1TaskLine(
      quickRoll.extractTaskLine(resumed.editorValue, targetDescription), dates.today,
    );
    record("alt-p-works-after-settle-window", resumedResult.ok && resumed.pickerOpen === false, JSON.stringify(resumedResult));

    report.pass = cases.every((item) => item.ok);
    report.cases = cases;
    if (parsed.report) {
      fs.mkdirSync(path.dirname(path.resolve(parsed.report)), { recursive: true });
      fs.writeFileSync(path.resolve(parsed.report), JSON.stringify(report, null, 2));
    }
    if (!report.pass) throw new Error(`e2e failed: ${cases.filter((item) => !item.ok).map((item) => item.name).join(", ")}`);
    console.log("quick-roll real-Obsidian e2e complete");
  } catch (error) {
    report.cases = cases;
    report.error = error && error.message ? error.message : String(error);
    if (parsed.report) {
      fs.mkdirSync(path.dirname(path.resolve(parsed.report)), { recursive: true });
      fs.writeFileSync(path.resolve(parsed.report), JSON.stringify(report, null, 2));
    }
    throw error;
  } finally {
    client?.close();
    try { if (child.exitCode == null && child.signalCode == null) child.kill("SIGTERM"); } catch { /* already gone */ }
    await new Promise((resolve) => {
      if (child.exitCode != null || child.signalCode != null) return resolve();
      const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } resolve(); }, 4000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
    fs.rmSync(runRoot, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return void console.log(HELP_TEXT);
  if (args.selfTest) return await runSelfTest();
  const overall = new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error("overall quick-roll e2e watchdog fired")), OVERALL_TIMEOUT_MS);
    timer.unref?.();
  });
  await Promise.race([runE2e(args), overall]);
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = error && error.exitCode ? error.exitCode : 1;
});
