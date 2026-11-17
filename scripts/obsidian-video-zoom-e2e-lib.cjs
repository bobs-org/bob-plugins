"use strict";

const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const smoke = require("./obsidian-startup-smoke-lib.cjs");

const CONNECT_TIMEOUT_MS = 20_000;
const RPC_TIMEOUT_MS = 15_000;
const HELP_TEXT = [
  "Usage: xvfb-run -a node scripts/obsidian-video-zoom-e2e.cjs [OPTIONS]",
  "",
  "Drive video embeds and the Z media viewer in an isolated Obsidian vault.",
  "The harness owns its Obsidian process and scratch files; it never opens ~/bob.",
  "",
  "Options:",
  "  -e, --executable PATH   Obsidian Electron executable",
  "  -h, --help              Print this help and exit",
  "  -r, --report PATH       Write a JSON scenario report",
  "      --self-test         Run offline harness checks",
].join("\n");

function parseArgs(argv) {
  const args = { executable: null, help: false, report: null, selfTest: false };
  const list = Array.isArray(argv) ? argv.slice() : [];
  for (let index = 0; index < list.length; index += 1) {
    const token = list[index];
    if (token === "-e" || token === "--executable" || token === "--obsidian-bin") {
      const value = list[++index];
      if (!value || value.startsWith("-")) throw new Error("--executable requires a PATH value");
      args.executable = value;
    } else if (token === "-h" || token === "--help") {
      args.help = true;
    } else if (token === "-r" || token === "--report") {
      const value = list[++index];
      if (!value || value.startsWith("-")) throw new Error("--report requires a PATH value");
      args.report = value;
    } else if (token === "--self-test") {
      args.selfTest = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

function fail(message, exitCode = 1) {
  const error = new Error(message);
  error.exitCode = exitCode;
  throw error;
}

function findExecutable(override, envName, fallback) {
  const candidates = [];
  if (override) candidates.push(override);
  if (process.env[envName]) candidates.push(process.env[envName]);
  if (fallback) candidates.push(fallback);
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Try the next configured path.
    }
  }
  return candidates[0] || fallback || "";
}

function probeObsidian(executable) {
  try {
    fs.accessSync(executable, fs.constants.X_OK);
  } catch {
    return { ok: false, reason: `Obsidian executable is not executable: ${executable}` };
  }
  const probe = spawnSync(executable, ["--help"], { encoding: "utf8", timeout: 20_000 });
  const output = String((probe.stdout || "") + (probe.stderr || ""));
  if (/unable to find Obsidian/i.test(output)) {
    return { ok: false, reason: `executable ${executable} is an Obsidian CLI shim, not the Electron app` };
  }
  if (probe.error && probe.error.code !== "ETIMEDOUT") {
    return { ok: false, reason: probe.error.message };
  }
  return { ok: true };
}

function videoZoomNote(importPath) {
  return [
    "# Video zoom e2e",
    "",
    "Inline width: ![[vid/silent.mp4|400]]",
    "Silent: ![[vid/silent.mp4|400]]",
    "Audible: ![[vid/audible.mp4|400]]",
    "WebM: ![[vid/clip.webm]]",
    "Legacy: [[file/legacy.mp4]]",
    "Corrupt: ![[vid/corrupt.mp4]]",
    `- ${importPath}`,
    "",
  ].join("\n");
}

function generateMediaFixtures(ffmpeg, vaultDir, importSourcePath) {
  const videoDir = path.join(vaultDir, "vid");
  const fileDir = path.join(vaultDir, "file");
  fs.mkdirSync(videoDir, { recursive: true });
  fs.mkdirSync(fileDir, { recursive: true });
  const encode = (args, label) => {
    const result = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...args], {
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) {
      throw new Error(`${label}: ${String(result.stderr || result.error || `ffmpeg exited ${result.status}`).trim()}`);
    }
  };
  const color = "color=c=0x334c80:s=640x360:r=30:d=6";
  const silentPath = path.join(videoDir, "silent.mp4");
  encode([
    "-f", "lavfi", "-i", color, "-t", "6", "-an",
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", silentPath,
  ], "generate silent H.264 mp4");
  const audiblePath = path.join(videoDir, "audible.mp4");
  encode([
    "-f", "lavfi", "-i", color,
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=6",
    "-t", "6", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-movflags", "+faststart", audiblePath,
  ], "generate H.264 plus AAC mp4");
  const webmPath = path.join(videoDir, "clip.webm");
  encode([
    "-f", "lavfi", "-i", color, "-t", "6", "-an",
    "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8",
    "-pix_fmt", "yuv420p", webmPath,
  ], "generate VP9 webm");
  fs.copyFileSync(silentPath, path.join(fileDir, "legacy.mp4"));
  fs.writeFileSync(path.join(videoDir, "corrupt.mp4"), Buffer.from("not a playable video"));
  if (importSourcePath) {
    fs.mkdirSync(path.dirname(importSourcePath), { recursive: true });
    fs.copyFileSync(silentPath, importSourcePath);
  }
  return { silentPath, audiblePath, webmPath, importSourcePath };
}

function installPlugins(vaultDir, repoRoot, withLedgerTools) {
  const ids = ["bob-navigation-hotkeys"];
  if (withLedgerTools) ids.push("bob-ledger-tools");
  for (const id of ids) {
    const source = path.join(repoRoot, "plugins", id);
    const target = path.join(vaultDir, ".obsidian", "plugins", id);
    fs.mkdirSync(target, { recursive: true });
    for (const name of ["manifest.json", "main.js", "styles.css"]) {
      const from = path.join(source, name);
      if (fs.existsSync(from)) fs.copyFileSync(from, path.join(target, name));
    }
    if (!fs.existsSync(path.join(target, "main.js"))) throw new Error(`missing built plugin entrypoint: ${id}`);
  }
  fs.mkdirSync(path.join(vaultDir, ".obsidian"), { recursive: true });
  fs.writeFileSync(
    path.join(vaultDir, ".obsidian", "community-plugins.json"),
    JSON.stringify(ids, null, 2),
  );
  fs.writeFileSync(
    path.join(vaultDir, ".obsidian", "app.json"),
    JSON.stringify({ livePreview: false, vimMode: true, showLineNumber: false }, null, 2),
  );
  fs.writeFileSync(
    path.join(vaultDir, ".obsidian", "appearance.json"),
    JSON.stringify({ cssTheme: "", theme: "moonstone" }, null, 2),
  );
  return ids;
}

function seedProfile(profileDir, vaultPath) {
  const id = crypto.randomBytes(8).toString("hex");
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(
    path.join(profileDir, "obsidian.json"),
    JSON.stringify({ vaults: { [id]: { path: vaultPath, ts: Date.now(), open: true } } }, null, 2),
  );
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
    this.events = [];
    socket.addEventListener("message", (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (!message.id) {
        if (message.method === "Runtime.exceptionThrown") {
          this.events.push({ method: message.method, detail: message.params && message.params.exceptionDetails && message.params.exceptionDetails.text || "" });
        } else if (message.method === "Runtime.consoleAPICalled" && message.params && message.params.type === "error") {
          this.events.push({ method: message.method, detail: (message.params.args || []).map((arg) => arg && (arg.value || arg.description) || "").join(" ") });
        }
        return;
      }
      if (!message.id || !this.pending.has(message.id)) return;
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message || JSON.stringify(message.error)}`));
      else pending.resolve(message.result || {});
    });
    socket.addEventListener("close", () => {
      this.closed = true;
      for (const [, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`${pending.method}: CDP socket closed`));
      }
      this.pending.clear();
    });
  }

  static async connect(endpoint) {
    let WebSocketClient = typeof globalThis.WebSocket === "function" ? globalThis.WebSocket : null;
    if (!WebSocketClient) {
      try { WebSocketClient = require("undici").WebSocket; } catch { /* report below */ }
    }
    if (!WebSocketClient) throw new Error("WebSocket is required (Node 22+ or undici)");
    return smoke.withTimeout(new Promise((resolve, reject) => {
      let socket;
      try { socket = new WebSocketClient(endpoint); } catch (error) { reject(error); return; }
      socket.addEventListener("open", () => resolve(new CdpClient(socket)), { once: true });
      socket.addEventListener("error", () => reject(new Error("CDP websocket connection failed")), { once: true });
    }), CONNECT_TIMEOUT_MS, "CDP connect");
  }

  call(method, params = {}, timeoutMs = RPC_TIMEOUT_MS) {
    if (this.closed) return Promise.reject(new Error(`${method}: CDP socket is closed`));
    const id = this.nextId++;
    return smoke.withTimeout(new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      if (timer.unref) timer.unref();
      this.pending.set(id, { resolve, reject, method, timer });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    }), timeoutMs + 1000, method);
  }

  async evaluate(expression, timeoutMs = RPC_TIMEOUT_MS) {
    const response = await this.call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    }, timeoutMs);
    if (response.exceptionDetails) {
      const details = response.exceptionDetails;
      throw new Error((details.exception && details.exception.description) || details.text || "Runtime.evaluate failed");
    }
    return response.result && response.result.value;
  }

  close() {
    try { this.socket.close(); } catch { /* already closed */ }
  }
}

const VAULT_PATH_PROBE = `(() => {
  const adapter = window.app && window.app.vault && window.app.vault.adapter;
  return adapter && typeof adapter.basePath === "string" ? adapter.basePath : null;
})()`;

async function selectOwnedTarget(port, vaultPath, shouldStop) {
  const deadline = Date.now() + CONNECT_TIMEOUT_MS * 2;
  let lastError = "";
  while (Date.now() < deadline) {
    if (shouldStop && shouldStop()) throw new Error("Obsidian exited before the scratch vault opened");
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        for (const page of (Array.isArray(targets) ? targets : []).filter((item) => item && item.type === "page" && item.webSocketDebuggerUrl)) {
          let client = null;
          try {
            client = await CdpClient.connect(page.webSocketDebuggerUrl);
            const seen = await client.evaluate(VAULT_PATH_PROBE, 5000);
            if (smoke.verifyVaultPath(seen, vaultPath)) return page;
          } catch (error) {
            lastError = error && error.message ? error.message : String(error);
          } finally {
            if (client) client.close();
          }
        }
      }
    } catch (error) {
      lastError = error && error.message ? error.message : String(error);
    }
    await sleep(350);
  }
  throw new Error(`no CDP page reports the fixture vault${lastError ? `; last probe: ${lastError.slice(0, 160)}` : ""}`);
}

async function waitFor(client, expression, predicate, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await client.evaluate(expression);
      if (predicate(last)) return last;
    } catch (error) {
      last = { error: error && error.message ? error.message : String(error) };
    }
    await sleep(80);
  }
  throw new Error(`timed out waiting for ${label}: ${JSON.stringify(last)}`);
}

async function dispatchKey(client, key, options = {}) {
  const code = options.code || (key === " " ? "Space" : key);
  const keyCode = key === " " ? 32 : key === "ArrowRight" ? 39 : key === "Escape" ? 27 : 0;
  const payload = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers: 0 };
  await client.call("Input.dispatchKeyEvent", { type: "rawKeyDown", ...payload });
  await client.call("Input.dispatchKeyEvent", { type: "keyUp", ...payload });
  await sleep(options.pause == null ? 80 : options.pause);
}

async function openNote(client, filePath, mode = "source") {
  return client.evaluate(`(() => (async () => {
    const target = ${JSON.stringify(filePath)};
    const file = window.app.vault.getAbstractFileByPath(target);
    if (!file) return { ok: false, error: "missing " + target };
    const leaf = window.app.workspace.getLeaf(false);
    await leaf.openFile(file, { state: { mode: ${JSON.stringify(mode)}, source: ${mode === "source"} } });
    window.app.workspace.setActiveLeaf(leaf, { focus: true });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const view = leaf.view;
    if (${JSON.stringify(mode)} === "source" && view && view.editor && typeof view.editor.focus === "function") view.editor.focus();
    return { ok: Boolean(view), mode: view && view.getMode && view.getMode() };
  })())()`);
}

async function placeCaretOn(client, needle, offset = 4) {
  return client.evaluate(`(() => {
    const view = window.app.workspace.activeLeaf && window.app.workspace.activeLeaf.view;
    const editor = view && view.editor;
    if (!editor) return { ok: false, error: "no editor" };
    const lines = String(editor.getValue()).split("\\n");
    const line = lines.findIndex((text) => text.includes(${JSON.stringify(needle)}));
    if (line < 0) return { ok: false, error: "no line containing " + ${JSON.stringify(needle)} };
    const ch = lines[line].indexOf(${JSON.stringify(needle)}) + ${Number(offset)};
    editor.setCursor({ line, ch });
    if (typeof editor.focus === "function") editor.focus();
    return { ok: true, line, ch, path: view.file && view.file.path };
  })()`);
}

async function executeZoomCommand(client) {
  return client.evaluate(`(() => {
    const commands = window.app && window.app.commands;
    if (!commands || typeof commands.executeCommandById !== "function") return { ok: false, error: "command runner unavailable" };
    return { ok: commands.executeCommandById("bob-navigation-hotkeys:zoom-image-on-line") !== false };
  })()`);
}

module.exports = {
  CdpClient,
  HELP_TEXT,
  RPC_TIMEOUT_MS,
  dispatchKey,
  executeZoomCommand,
  fail,
  findExecutable,
  freePort,
  generateMediaFixtures,
  installPlugins,
  openNote,
  parseArgs,
  placeCaretOn,
  probeObsidian,
  seedProfile,
  selectOwnedTarget,
  sleep,
  videoZoomNote,
  waitFor,
};
