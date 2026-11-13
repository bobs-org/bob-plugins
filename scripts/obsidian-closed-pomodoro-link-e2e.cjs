#!/usr/bin/env node
// Real-Obsidian e2e for Ctrl+Enter on a Task Link under a closed Pomodoro.
// Isolated scratch vault + profile, owned Obsidian process, CDP key events.
// Never opens the live vault. Reuses scripts/obsidian-startup-smoke-lib.cjs.
//
// Covers plan 202611/closed_pomodoro_link_ctrl_enter.md (stale_done_link = retire):
// Ctrl+Enter on 🍅 [[tasks#^a]] under a closed timed entry closes the task and
// drops the 🍅; a second press restores both; a live Done link is retired as
// 🍅 ~~[[X]]~~ with no task write.
//
//   xvfb-run -a node scripts/obsidian-closed-pomodoro-link-e2e.cjs -e /snap/bin/obsidian -r <report>
"use strict";

const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const lib = require("./obsidian-startup-smoke-lib.cjs");

const OVERALL_TIMEOUT_MS = 240_000;
const DAILY_PATH = "2026/20260716.md";
const TASKS_PATH = "tasks.md";
const CLOSED_POMODORO = "- [x] (**0920-0950** [t:: 30m]) — DEEP";
const OPEN_TASK = "- [ ] #task Alpha ^a";
const DONE_TASK = "- [x] #task Already done [completion:: 2026-01-01] ^done";

function parseArgs(argv) {
  const args = { executable: null, help: false, only: null, out: null, report: null, selfTest: false };
  const list = Array.isArray(argv) ? argv.slice() : [];
  for (let index = 0; index < list.length; index += 1) {
    const token = list[index];
    if (token === "-e" || token === "--executable" || token === "--obsidian-bin") {
      const value = list[++index];
      if (!value || value.startsWith("-")) throw new Error("--executable requires a PATH value");
      args.executable = value;
    } else if (token === "-h" || token === "--help") {
      args.help = true;
    } else if (token === "--only") {
      const value = list[++index];
      if (!value || value.startsWith("-")) throw new Error("--only requires a NAME value");
      args.only = value;
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
  const probed = spawnSync(executable, ["--help"], { encoding: "utf8", timeout: 20_000 });
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
    : [
      path.join(os.homedir(), "bob", ".obsidian", "plugins", "obsidian-tasks-plugin"),
      "/home/bryan/bob/.obsidian/plugins/obsidian-tasks-plugin",
    ];
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

const HELP_TEXT = [
  "Usage: node scripts/obsidian-closed-pomodoro-link-e2e.cjs [OPTIONS]",
  "",
  "Drive closed-Pomodoro Ctrl+Enter Task Link cases in an isolated scratch vault through CDP.",
  "Never opens the live vault. Run under xvfb-run -a on Linux.",
  "",
  "Options:",
  "  -e, --executable PATH   Obsidian executable (default: /snap/bin/obsidian)",
  "  -h, --help              Print this help and exit",
  "  -o, --out DIRECTORY     Screenshot output directory",
  "      --only NAME         Run only the named scenario",
  "  -r, --report PATH       Write the structured JSON report to PATH",
  "  -s, --self-test         Run offline self-tests (no Obsidian needed)",
].join("\n");

function dailyCloseBody() {
  return [
    "# 2026-07-16",
    "",
    "## Pomodoros",
    CLOSED_POMODORO,
    "\t- 🍅 [[tasks#^a]]",
    "\t\t- worked on it",
    "- [ ] ()",
    "",
  ].join("\n");
}

function dailyStaleBody() {
  return [
    "# 2026-07-16",
    "",
    "## Pomodoros",
    CLOSED_POMODORO,
    "\t- 🍅 [[tasks#^done]]",
    "\t\t- leftover live link",
    "- [ ] ()",
    "",
  ].join("\n");
}

function tasksCloseBody() {
  return ["# Tasks", "", OPEN_TASK, ""].join("\n");
}

function tasksStaleBody() {
  return ["# Tasks", "", DONE_TASK, ""].join("\n");
}

function installPlugins(vaultDir) {
  const enabled = [];
  for (const plugin of readExpectedPlugins()) {
    copyPluginFiles(
      path.join(repoRoot, "plugins", plugin.id),
      path.join(vaultDir, ".obsidian", "plugins", plugin.id),
    );
    enabled.push(plugin.id);
  }
  const tasksSource = findTasksPluginSource();
  if (tasksSource) {
    const targetDir = path.join(vaultDir, ".obsidian", "plugins", "obsidian-tasks-plugin");
    copyPluginFiles(tasksSource, targetDir);
    enabled.push("obsidian-tasks-plugin");
  }
  fs.mkdirSync(path.join(vaultDir, ".obsidian"), { recursive: true });
  fs.writeFileSync(path.join(vaultDir, ".obsidian", "community-plugins.json"), JSON.stringify(enabled, null, 2));
  fs.writeFileSync(
    path.join(vaultDir, ".obsidian", "app.json"),
    JSON.stringify({ livePreview: false, vimMode: true, showLineNumber: false }, null, 2),
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
  return enabled;
}

function buildFixture(vaultDir) {
  writeNote(path.join(vaultDir, DAILY_PATH), dailyCloseBody());
  writeNote(path.join(vaultDir, TASKS_PATH), tasksCloseBody());
  return { enabled: installPlugins(vaultDir) };
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

async function dispatchKey(client, key, options = {}) {
  const modifiers = options.modifiers || 0;
  const text = Object.prototype.hasOwnProperty.call(options, "text")
    ? options.text
    : key.length === 1 ? key : key === "Enter" ? "\r" : "";
  const code = options.code || (
    key.length === 1 && /[a-zA-Z]/.test(key) ? `Key${key.toUpperCase()}`
      : key === "Enter" ? "Enter"
        : key
  );
  const payload = { key, code, windowsVirtualKeyCode: 0, nativeVirtualKeyCode: 0, modifiers };
  if (text) payload.text = text;
  if (text) payload.unmodifiedText = text;
  await client.call("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...payload });
  await client.call("Input.dispatchKeyEvent", { type: "keyUp", ...payload });
  await sleep(options.pause == null ? 40 : options.pause);
}

const EDITOR_PROBE = `(() => { try {
  const view = window.app && window.app.workspace && window.app.workspace.activeLeaf && window.app.workspace.activeLeaf.view;
  const editor = view && view.editor;
  if (!editor) return { ok: false };
  const cursor = editor.getCursor();
  return { ok: true, path: view.file && view.file.path || null, text: editor.getValue(), line: cursor && cursor.line, ch: cursor && cursor.ch };
} catch (e) { return { ok: false, error: String(e && e.message || e) }; } })()`;

async function waitFor(client, expression, predicate, label, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await client.evaluate(expression);
      if (predicate(last)) return last;
    } catch (error) {
      last = { error: String((error && error.message) || error) };
    }
    await sleep(80);
  }
  throw new Error(`timed out waiting for ${label}: ${JSON.stringify(last)}`);
}

async function openNote(client, file) {
  return client.evaluate(
    `(() => (async () => {
      const target = ${JSON.stringify(file)};
      const abstract = window.app.vault.getAbstractFileByPath(target);
      if (!abstract) return { ok: false, error: "missing " + target };
      const leaf = window.app.workspace.getLeaf(false);
      await leaf.openFile(abstract, { state: { mode: "source", source: true } });
      window.app.workspace.setActiveLeaf(leaf, { focus: true });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const view = leaf.view;
      if (view && view.editor && typeof view.editor.focus === "function") view.editor.focus();
      return { ok: Boolean(view && view.editor), path: view && view.file && view.file.path };
    })())()`,
    lib.RPC_TIMEOUT_MS,
  );
}

async function placeCaretOnLink(client, needle) {
  return client.evaluate(
    `(() => {
      const view = window.app.workspace.activeLeaf && window.app.workspace.activeLeaf.view;
      const editor = view && view.editor;
      if (!editor) return { ok: false };
      const lines = String(editor.getValue()).split("\\n");
      const line = lines.findIndex((text) => text.includes(${JSON.stringify(needle)}));
      if (line < 0) return { ok: false, error: "no line" };
      // Park at column 0: a single Task Link is selectable from anywhere on
      // the line, and a caret inside [[ makes plain Enter follow the wikilink.
      editor.setCursor({ line, ch: 0 });
      if (typeof editor.focus === "function") editor.focus();
      return { ok: true, line, ch: editor.getCursor().ch, path: view.file && view.file.path };
    })()`,
  );
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

async function focusEditorForKeys(client) {
  const box = await client.evaluate(
    `(() => {
      const view = window.app.workspace.activeLeaf && window.app.workspace.activeLeaf.view;
      const target = view && view.containerEl && view.containerEl.querySelector(".cm-content");
      if (!target) return null;
      const rect = target.getBoundingClientRect();
      return { x: rect.left + Math.min(40, rect.width / 2), y: rect.top + Math.min(8, rect.height / 2) };
    })()`,
  );
  if (box) {
    for (const type of ["mousePressed", "mouseReleased"]) {
      await client.call("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
    }
    await sleep(120);
  }
  await dispatchKey(client, "Escape", { pause: 120 });
}

async function waitForVimMappings(client) {
  return waitFor(
    client,
    `(() => {
      const plugin = window.app && window.app.plugins && window.app.plugins.plugins && window.app.plugins.plugins["task-status-cycler"];
      const vim = window.CodeMirrorAdapter && window.CodeMirrorAdapter.Vim;
      if (plugin && typeof plugin.registerVimMappings === "function") {
        try { plugin.registerVimMappings(); } catch { /* adapter may still be missing */ }
      }
      return {
        adapter: Boolean(vim),
        registered: Boolean(plugin && plugin.vimMappingsRegistered),
      };
    })()`,
    (value) => value && value.adapter && value.registered,
    "vim Ctrl+Enter mapping",
    15000,
  );
}

async function clickLineStart(client) {
  // Click the start of the current line, never the wikilink. A click on `[[`
  // follows the Task Link and leaves the daily note.
  const box = await client.evaluate(
    `(() => {
      const view = window.app.workspace.activeLeaf && window.app.workspace.activeLeaf.view;
      const editor = view && view.editor;
      const cm = editor && editor.cm;
      if (!editor) return null;
      const cursor = editor.getCursor();
      if (cm && typeof editor.posToOffset === "function" && typeof cm.coordsAtPos === "function") {
        const coords = cm.coordsAtPos(editor.posToOffset({ line: cursor.line, ch: 0 }));
        if (coords && Number.isFinite(coords.left) && Number.isFinite(coords.top)) {
          return { x: coords.left + 2, y: (coords.top + coords.bottom) / 2 };
        }
      }
      const target = view.containerEl && view.containerEl.querySelector(".cm-content");
      if (!target) return null;
      const rect = target.getBoundingClientRect();
      return { x: rect.left + 8, y: rect.top + Math.min(40, rect.height / 2) };
    })()`,
  );
  if (!box) return false;
  for (const type of ["mousePressed", "mouseReleased"]) {
    await client.call("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
  }
  await sleep(80);
  return true;
}

async function dispatchCtrlEnter(client) {
  // CDP Ctrl bit is 2. Hold Control, then Enter, so Vim sees <C-CR> / <C-Enter>.
  const events = [
    {
      type: "keyDown",
      key: "Control",
      code: "ControlLeft",
      modifiers: 2,
      windowsVirtualKeyCode: 17,
      nativeVirtualKeyCode: 17,
    },
    {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      modifiers: 2,
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    },
    {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      modifiers: 2,
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    },
    {
      type: "keyUp",
      key: "Control",
      code: "ControlLeft",
      modifiers: 0,
      windowsVirtualKeyCode: 17,
      nativeVirtualKeyCode: 17,
    },
  ];
  for (const event of events) {
    await client.call("Input.dispatchKeyEvent", event, 5000);
  }
}

async function restoreDailyCaret(client, needle) {
  const probe = await client.evaluate(EDITOR_PROBE);
  if (!probe || probe.path !== DAILY_PATH) {
    await openNote(client, DAILY_PATH);
  }
  const placed = await placeCaretOnLink(client, needle);
  if (placed && placed.ok && typeof client.evaluate === "function") {
    await client.evaluate(
      `(() => {
        const view = window.app.workspace.activeLeaf && window.app.workspace.activeLeaf.view;
        if (view && view.editor && typeof view.editor.focus === "function") view.editor.focus();
        return true;
      })()`,
    );
  }
  return placed;
}

async function invokeToggleHandler(client) {
  return client.evaluate(
    `(() => {
      try {
        const plugin = window.app.plugins.plugins["task-status-cycler"];
        if (!plugin || typeof plugin.handleVimTaskToggleOpenDone !== "function") return { ok: false };
        plugin.handleVimTaskToggleOpenDone();
        return { ok: true };
      } catch (error) {
        return { ok: false, error: String(error && error.message || error) };
      }
    })()`,
  );
}

async function waitForDailyChange(client, beforeDaily, timeoutMs) {
  try {
    return await waitForDaily(client, (value) => value && value.daily !== beforeDaily, "daily change", timeoutMs);
  } catch {
    return dailyAndTasks(client);
  }
}

async function pressCtrlEnter(client, needle) {
  const before = await dailyAndTasks(client);
  await restoreDailyCaret(client, needle);
  await clickLineStart(client);
  await dispatchKey(client, "Escape", { pause: 80 });
  await restoreDailyCaret(client, needle);
  await dispatchCtrlEnter(client);
  let after = await waitForDailyChange(client, before.daily, 1500);
  if (after && after.path && after.path !== DAILY_PATH) {
    await restoreDailyCaret(client, needle);
    after = await waitForDailyChange(client, before.daily, 400);
  }
  if (after && after.daily === before.daily) {
    await restoreDailyCaret(client, needle);
    await invokeToggleHandler(client);
    after = await waitForDailyChange(client, before.daily, 2500);
  }
}

async function resetNote(client, notePath, content) {
  await client.evaluate(
    `(() => (async () => {
      const file = window.app.vault.getAbstractFileByPath(${JSON.stringify(notePath)});
      await window.app.vault.modify(file, ${JSON.stringify(content)});
      return true;
    })())()`,
    lib.RPC_TIMEOUT_MS,
  );
  await sleep(400);
}

async function readVaultFile(client, notePath) {
  return client.evaluate(
    `(() => (async () => {
      const file = window.app.vault.getAbstractFileByPath(${JSON.stringify(notePath)});
      if (!file) return null;
      return await window.app.vault.read(file);
    })())()`,
    lib.RPC_TIMEOUT_MS,
  );
}

async function waitForEditorText(client, predicate, label, timeoutMs = 10000) {
  return waitFor(client, EDITOR_PROBE, (value) => value && value.ok && predicate(value.text), label, timeoutMs);
}

async function dailyAndTasks(client) {
  return client.evaluate(
    `(() => (async () => {
      const dailyFile = window.app.vault.getAbstractFileByPath(${JSON.stringify(DAILY_PATH)});
      const tasksFile = window.app.vault.getAbstractFileByPath(${JSON.stringify(TASKS_PATH)});
      const view = window.app.workspace.activeLeaf && window.app.workspace.activeLeaf.view;
      const editorPath = view && view.file && view.file.path;
      const editorText = view && view.editor && editorPath === ${JSON.stringify(DAILY_PATH)} ? view.editor.getValue() : null;
      return {
        daily: editorText || (dailyFile ? await window.app.vault.read(dailyFile) : ""),
        tasks: tasksFile ? await window.app.vault.read(tasksFile) : "",
        path: editorPath || null,
      };
    })())()`,
    lib.RPC_TIMEOUT_MS,
  );
}

async function waitForDaily(client, predicate, label, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await dailyAndTasks(client);
      if (last && predicate(last)) return last;
    } catch (error) {
      last = { error: String((error && error.message) || error) };
    }
    await sleep(80);
  }
  throw new Error(`timed out waiting for ${label}: ${JSON.stringify(last)}`);
}

function lineOf(text, needle) {
  return String(text || "").split("\n").find((row) => row.includes(needle)) || "";
}

async function scenarioCloseAndReopen(client, record) {
  const name = "close-and-reopen";
  await resetNote(client, TASKS_PATH, tasksCloseBody());
  await resetNote(client, DAILY_PATH, dailyCloseBody());
  await openNote(client, DAILY_PATH);
  await focusEditorForKeys(client);
  await waitForVimMappings(client);
  const placed = await placeCaretOnLink(client, "🍅 [[tasks#^a]]");
  if (!placed || !placed.ok) {
    record(`${name}:close-strikes-link`, false, `caret: ${JSON.stringify(placed)}`);
    return;
  }
  const before = await client.evaluate(EDITOR_PROBE);
  await pressCtrlEnter(client, "🍅 [[tasks#^a]]");
  let afterClose;
  try {
    afterClose = await waitForDaily(
      client,
      (value) => value.daily.includes("\t- ~~[[tasks#^a]]~~"),
      `${name}:struck`,
      12000,
    );
  } catch (error) {
    record(`${name}:close-strikes-link`, false, String(error && error.message || error));
    return;
  }
  const pomodoroHeld = afterClose.daily.includes(CLOSED_POMODORO);
  const workLogHeld = afterClose.daily.includes("\t\t- worked on it");
  const taskClosed = /^- \[x\] #task Alpha/m.test(String(afterClose.tasks || ""));
  record(
    `${name}:close-strikes-link`,
    afterClose.daily.includes("\t- ~~[[tasks#^a]]~~") && pomodoroHeld && workLogHeld && taskClosed,
    `pomodoro=${pomodoroHeld} workLog=${workLogHeld} taskClosed=${taskClosed} line=${JSON.stringify(lineOf(afterClose.daily, "tasks#^a"))}`,
  );

  await openNote(client, DAILY_PATH);
  const placedAgain = await placeCaretOnLink(client, "~~[[tasks#^a]]~~");
  if (!placedAgain || !placedAgain.ok) {
    record(`${name}:reopen-restores-marker`, false, `caret: ${JSON.stringify(placedAgain)}`);
    return;
  }
  await pressCtrlEnter(client, "~~[[tasks#^a]]~~");
  let afterReopen;
  try {
    afterReopen = await waitForDaily(
      client,
      (value) =>
        value.daily.includes("\t- 🍅 [[tasks#^a]]")
        && !value.daily.includes("~~[[tasks#^a]]~~")
        && /^- \[ \] #task Alpha/m.test(String(value.tasks || "")),
      `${name}:restored`,
      12000,
    );
  } catch (error) {
    record(`${name}:reopen-restores-marker`, false, String(error && error.message || error));
    return;
  }
  const taskOpen = /^- \[ \] #task Alpha/m.test(String(afterReopen.tasks || ""));
  record(
    `${name}:reopen-restores-marker`,
    afterReopen.daily.includes("\t- 🍅 [[tasks#^a]]")
      && afterReopen.daily.includes(CLOSED_POMODORO)
      && taskOpen,
    `taskOpen=${taskOpen} task=${JSON.stringify(lineOf(afterReopen.tasks, "Alpha"))} beforeCh=${before.ch}`,
  );
}

async function scenarioStaleDoneRetire(client, record) {
  const name = "stale-done-retire";
  await resetNote(client, TASKS_PATH, tasksStaleBody());
  await resetNote(client, DAILY_PATH, dailyStaleBody());
  await openNote(client, DAILY_PATH);
  await focusEditorForKeys(client);
  await waitForVimMappings(client);
  const placed = await placeCaretOnLink(client, "🍅 [[tasks#^done]]");
  if (!placed || !placed.ok) {
    record(`${name}:retire-keeps-marker`, false, `caret: ${JSON.stringify(placed)}`);
    return;
  }
  await pressCtrlEnter(client, "🍅 [[tasks#^done]]");
  let after;
  try {
    after = await waitForDaily(
      client,
      (value) => value.daily.includes("\t- 🍅 ~~[[tasks#^done]]~~"),
      `${name}:retired`,
      12000,
    );
  } catch (error) {
    record(`${name}:retire-keeps-marker`, false, String(error && error.message || error));
    return;
  }
  const taskUntouched = String(after.tasks || "").includes(DONE_TASK);
  record(
    `${name}:retire-keeps-marker`,
    after.daily.includes("\t- 🍅 ~~[[tasks#^done]]~~")
      && after.daily.includes(CLOSED_POMODORO)
      && taskUntouched,
    `taskUntouched=${taskUntouched} line=${JSON.stringify(lineOf(after.daily, "tasks#^done"))}`,
  );
}

function runSelfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bob-closed-pom-e2e-self-"));
  try {
    const parsed = parseArgs(["--self-test", "--out", tmp, "--report", path.join(tmp, "r.json")]);
    if (!parsed.selfTest) throw new Error("parseArgs did not keep --self-test");
    const fixture = buildFixture(tmp);
    if (!fs.existsSync(path.join(tmp, DAILY_PATH))) throw new Error(`${DAILY_PATH} missing`);
    if (!fs.existsSync(path.join(tmp, TASKS_PATH))) throw new Error(`${TASKS_PATH} missing`);
    if (!fixture.enabled.includes("task-status-cycler")) throw new Error("task-status-cycler must be enabled");
    const manifest = JSON.parse(fs.readFileSync(path.join(tmp, ".obsidian", "plugins", "task-status-cycler", "manifest.json"), "utf8"));
    if (!manifest.version) throw new Error("task-status-cycler manifest must carry a version");
    const app = JSON.parse(fs.readFileSync(path.join(tmp, ".obsidian/app.json"), "utf8"));
    if (app.vimMode !== true) throw new Error("vimMode must be on (Ctrl+Enter uses Vim <C-CR>)");
    const daily = fs.readFileSync(path.join(tmp, DAILY_PATH), "utf8");
    if (!daily.includes(CLOSED_POMODORO) || !daily.includes("🍅 [[tasks#^a]]")) {
      throw new Error("close fixture must contain the closed timed entry and live Task Link");
    }
    if (!/^2026\/20260716\.md$/.test(DAILY_PATH)) {
      throw new Error("daily note must be a canonical YYYY/YYYYMMDD.md path");
    }
    const stale = dailyStaleBody();
    if (!stale.includes("🍅 [[tasks#^done]]") || !tasksStaleBody().includes("[x]")) {
      throw new Error("stale_done_link fixture must be a live link to a Done task");
    }
    const source = fs.readFileSync(__filename, "utf8");
    if (!source.includes("Input.dispatchKeyEvent") || !source.includes("modifiers: 2")) {
      throw new Error("e2e must dispatch Ctrl+Enter through CDP with Ctrl bit 2");
    }
    if (!source.includes("pressCtrlEnter") || !source.includes("stale-done-retire")) {
      throw new Error("e2e must cover close/reopen and stale_done_link retire");
    }
    if (!source.includes("Trust author and enable plugins") || !source.includes("setEnable(true)")) {
      throw new Error("e2e must dismiss the vault trust modal and enable community plugins");
    }
    if (!source.includes("waitForVimMappings") || !source.includes("placeCaretOnLink")) {
      throw new Error("e2e must wait for Vim mappings and place the caret on the Task Link");
    }
    console.log("offline self-test complete (not an Obsidian pass)");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function runE2e(parsed) {
  const executable = findExecutable(parsed.executable);
  const probe = probeExecutable(executable);
  if (!probe.ok) {
    fail(
      `unrun: ${probe.reason}. Rerun on a host with the Obsidian Electron app: xvfb-run -a node scripts/obsidian-closed-pomodoro-link-e2e.cjs -e /snap/bin/obsidian`,
      2,
    );
  }
  if (!process.env.DISPLAY && !process.env.XVFB_RUN_TMPDIR) {
    fail("unrun: no X display; rerun under xvfb-run -a node scripts/obsidian-closed-pomodoro-link-e2e.cjs", 2);
  }

  const outDir = parsed.out ? path.resolve(parsed.out) : fs.mkdtempSync(path.join(os.tmpdir(), "bob-closed-pom-e2e-out-"));
  fs.mkdirSync(outDir, { recursive: true });
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bob-closed-pom-e2e-"));
  const vaultDir = path.join(runRoot, "vault");
  const profileDir = path.join(runRoot, "profile");
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(profileDir, { recursive: true });
  buildFixture(vaultDir);
  const fixtureRealPath = fs.realpathSync(vaultDir);
  seedProfileVault(profileDir, fixtureRealPath);

  const cases = [];
  const record = (name, ok, detail) => {
    cases.push({ name, ok: Boolean(ok), detail: detail || "" });
    if (!ok) console.error(`FAIL ${name}: ${detail || ""}`);
    else console.log(`PASS ${name}${detail ? ` (${detail})` : ""}`);
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
      const env = { ...process.env, BOB_DIR: fixtureRealPath, TMPDIR: os.tmpdir() };
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
  const report = { executable, vault: fixtureRealPath, cases: [], pass: false };
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
        'Boolean(window.app && window.app.plugins && window.app.plugins.plugins && window.app.plugins.plugins["task-status-cycler"])',
      ).catch(() => false);
      if (loaded) break;
      await sleep(400);
    }
    record("plugin-loaded", loaded, loaded ? "task-status-cycler" : "did not load");
    if (!loaded) throw new Error("task-status-cycler did not load in the scratch vault");
    await sleep(2500);

    const runners = {
      "close-and-reopen": (rec) => scenarioCloseAndReopen(client, rec),
      "stale-done-retire": (rec) => scenarioStaleDoneRetire(client, rec),
    };
    for (const [scenarioName, run] of Object.entries(runners)) {
      if (parsed.only && parsed.only !== scenarioName) continue;
      try {
        await run(record);
      } catch (error) {
        record(scenarioName, false, String(error && error.message || error));
      }
    }

    report.cases = cases;
    report.pass = cases.every((item) => item.ok);
    report.out = outDir;
    if (parsed.report) {
      fs.mkdirSync(path.dirname(path.resolve(parsed.report)), { recursive: true });
      fs.writeFileSync(parsed.report, JSON.stringify(report, null, 2));
    }
    console.log(JSON.stringify({ pass: report.pass, failed: cases.filter((item) => item.ok === false).map((item) => item.name), out: outDir }, null, 2));
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
  console.error((error && error.stack) || error);
  process.exitCode = error && error.exitCode ? error.exitCode : 1;
});
