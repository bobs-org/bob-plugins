#!/usr/bin/env node
// Real-Obsidian e2e for the Task Wikilink Picker.
// Isolated scratch vault + profile, owned Obsidian process, CDP key events.
// Never opens the live vault. Reuses scripts/obsidian-startup-smoke-lib.cjs.
//
//   xvfb-run -a node scripts/obsidian-task-wikilink-e2e.cjs [--out DIR] [-e PATH] [-r REPORT]
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

const DAILY_NOTE = [
  "# 2026-10-30",
  "",
  "## Pomodoros",
  "- [ ] FIX (09:20-09:50)",
  "  - ",
  "- [ ] BUILD (10:00-10:30)",
  "  - [[Tasks#|alias]]",
  "",
  "## Notes",
  "Type here: ",
  "- [ ] Follow up",
  "",
].join("\n");

function markdownViewState(mode) {
  return { mode: "source", source: mode === "source" };
}
const HELP_TEXT = [
  "Usage: node scripts/obsidian-task-wikilink-e2e.cjs [OPTIONS]",
  "",
  "Drive the Task Wikilink Picker in an isolated scratch vault through CDP.",
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

function buildFixture(vaultDir) {
  writeNote(path.join(vaultDir, "2026/20261030.md"), DAILY_NOTE);
  writeNote(
    path.join(vaultDir, "sase_cleanup.md"),
    [
      "# sase_cleanup",
      "",
      "- [ ] #task Stop idling when no agents run ^no-idle",
      "- [ ] #task Keep the walk parked after a move ^park-walk",
      "",
    ].join("\n"),
  );
  writeNote(
    path.join(vaultDir, "mac_inbox.md"),
    [
      "# Inbox",
      "",
      "- [ ] #task Try Opus with Blender.",
      "",
    ].join("\n"),
  );
  writeNote(
    path.join(vaultDir, "Tasks.md"),
    [
      "# Tasks",
      "",
      "- [ ] #task Ship opus blender demo ^opus-demo",
      "- [ ] #task Ready work for today [scheduled:: 2026-11-04] ^ready-work",
      "  - 🗓️ **SCHEDULE LOG**",
      "",
    ].join("\n"),
  );
  writeNote(
    path.join(vaultDir, "notes/fenced.md"),
    [
      "# Fenced",
      "",
      "```js",
      "const pair = ((hidden));",
      "```",
      "",
      "After the fence: ",
      "",
    ].join("\n"),
  );
  writeNote(
    path.join(vaultDir, "notes/depends.md"),
    [
      "# Depends",
      "",
      "- [ ] #task Parent task ^parent",
      "  - ⛓️ **DEPENDS ON:** ",
      "",
    ].join("\n"),
  );
  const enabled = [];
  for (const plugin of readExpectedPlugins()) {
    const sourceDir = path.join(repoRoot, "plugins", plugin.id);
    const targetDir = path.join(vaultDir, ".obsidian", "plugins", plugin.id);
    fs.mkdirSync(targetDir, { recursive: true });
    for (const file of ["manifest.json", "main.js", "styles.css"]) {
      const source = path.join(sourceDir, file);
      if (fs.existsSync(source)) fs.copyFileSync(source, path.join(targetDir, file));
    }
    enabled.push(plugin.id);
  }
  fs.mkdirSync(path.join(vaultDir, ".obsidian"), { recursive: true });
  fs.writeFileSync(path.join(vaultDir, ".obsidian", "community-plugins.json"), JSON.stringify(enabled, null, 2));
  fs.writeFileSync(
    path.join(vaultDir, ".obsidian", "app.json"),
    JSON.stringify({
      livePreview: true,
      vimMode: true,
      showLineNumber: false,
    }, null, 2),
  );
  fs.writeFileSync(path.join(vaultDir, ".obsidian", "appearance.json"), JSON.stringify({ cssTheme: "", theme: "moonstone" }, null, 2));
  return {
    daily: "2026/20261030.md",
    cleanup: "sase_cleanup.md",
    inbox: "mac_inbox.md",
    tasks: "Tasks.md",
    fenced: "notes/fenced.md",
    depends: "notes/depends.md",
    enabled,
  };
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
      : key === "(" || key === ")" ? "Digit9"
        : key
  );
  const vk = options.vk || (
    key === "Enter" ? 13
      : key === "Escape" ? 27
        : key === "Backspace" ? 8
          : key === "(" || key === ")" ? 57
            : key.length === 1 ? key.toUpperCase().charCodeAt(0)
              : 0
  );
  const payload = {
    key,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
    modifiers,
  };
  if (text) payload.text = text;
  if (text) payload.unmodifiedText = text;
  await client.call("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...payload });
  await client.call("Input.dispatchKeyEvent", { type: "keyUp", ...payload });
  await sleep(options.pause == null ? 40 : options.pause);
}

async function typeText(client, value) {
  for (const char of value) {
    if (char === "(") await dispatchKey(client, "(", { code: "Digit9", vk: 57, modifiers: 8, text: "(" });
    else if (char === ")") await dispatchKey(client, ")", { code: "Digit0", vk: 48, modifiers: 8, text: ")" });
    else await dispatchKey(client, char);
  }
}

async function typeTextFast(client, value) {
  for (const char of value) {
    if (char === "(") await dispatchKey(client, "(", { code: "Digit9", vk: 57, modifiers: 8, text: "(", pause: 0 });
    else if (char === ")") await dispatchKey(client, ")", { code: "Digit0", vk: 48, modifiers: 8, text: ")", pause: 0 });
    else await dispatchKey(client, char, { pause: 0 });
  }
}

async function waitForFast(client, expression, predicate, label, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await client.evaluate(expression);
    if (predicate(last)) return last;
    await sleep(10);
  }
  throw new Error(`timed out waiting for ${label}: ${JSON.stringify(last)}`);
}

const EDITOR_PROBE = `(() => { try {
  const view = window.app && window.app.workspace && window.app.workspace.activeLeaf && window.app.workspace.activeLeaf.view;
  const editor = view && view.editor;
  if (!editor) return { ok: false };
  const cursor = editor.getCursor();
  return {
    ok: true,
    path: view.file && view.file.path || null,
    text: editor.getValue(),
    line: cursor && cursor.line,
    ch: cursor && cursor.ch,
    lineText: editor.getLine(cursor.line),
  };
} catch (e) { return { ok: false, error: String(e && e.message || e) }; } })()`;

const PICKER_PROBE = `(() => { try {
  const modal = document.querySelector(".modal.bid-twl-modal, .bid-twl-modal");
  const prompt = document.querySelector(".modal h2");
  const promptTitle = prompt && prompt.textContent || "";
  const naming = /Name this task to link it/.test(promptTitle);
  if (!modal && !naming) return { open: false, naming: false };
  const title = modal && modal.querySelector(".bid-tlp-title");
  const input = modal && modal.querySelector(".bid-twl-input, .bid-tlp-input");
  const count = modal && modal.querySelector(".bid-twl-count");
  const selected = modal && modal.querySelector(".bid-twl-row.is-selected");
  const action = modal && modal.querySelector(".bid-twl-detail-action");
  const live = modal && modal.querySelector(".bid-twl-live");
  const actionText = action && action.textContent || "";
  const liveText = live && live.textContent || "";
  return {
    open: Boolean(modal),
    naming,
    title: title && title.textContent || promptTitle || "",
    query: input && input.value || "",
    count: count && count.textContent || "",
    pomodoro: Boolean(modal && modal.classList.contains("is-pomodoro")),
    selected: selected && selected.textContent || "",
    action: actionText,
    checking: /checking|unavailable/i.test(actionText + " " + liveText),
  };
} catch (e) { return { open: false, error: String(e && e.message || e) }; } })()`;

const TASK_PICKER_PROBE = `(() => { try {
  const modal = document.querySelector(".modal.bid-tlp-modal, .bid-tlp-modal");
  const input = modal && modal.querySelector("input");
  const selected = modal && modal.querySelector(".bid-tlp-row.is-selected");
  return {
    open: Boolean(modal),
    query: input && input.value || "",
    selected: selected && selected.textContent || "",
  };
} catch (e) { return { open: false, error: String(e && e.message || e) }; } })()`;

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

function runSelfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bob-twl-e2e-self-"));
  try {
    const parsed = parseArgs(["--self-test", "--out", tmp, "--report", path.join(tmp, "r.json")]);
    if (!parsed.selfTest) throw new Error("parseArgs did not keep --self-test");
    const fixture = buildFixture(tmp);
    if (!fs.existsSync(path.join(tmp, fixture.daily))) throw new Error("daily note missing");
    if (!fs.existsSync(path.join(tmp, fixture.cleanup))) throw new Error("cleanup note missing");
    const daily = fs.readFileSync(path.join(tmp, fixture.daily), "utf8");
    if (!daily.includes("## Pomodoros")) throw new Error("daily note missing Pomodoros");
    const app = JSON.parse(fs.readFileSync(path.join(tmp, ".obsidian/app.json"), "utf8"));
    if (app.vimMode !== true) throw new Error("vimMode must be on");
    if (app.autoPairBrackets === false) throw new Error("bracket auto-pair must stay at its default");
    const liveState = markdownViewState("live");
    if (liveState.mode !== "source" || liveState.source !== false) {
      throw new Error("Live Preview must open as Markdown source:false, not Reading view");
    }
    const sourceState = markdownViewState("source");
    if (sourceState.mode !== "source" || sourceState.source !== true) {
      throw new Error("Source mode must open as Markdown source:true");
    }
    console.log("offline self-test complete (not an Obsidian pass)");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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
      const ready = view && view.editor && view.containerEl && view.containerEl.querySelector && view.containerEl.querySelector(".cm-content");
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 250));
      if (view && view.editor && typeof view.editor.focus === "function") view.editor.focus();
      const cm = view && view.containerEl && view.containerEl.querySelector && view.containerEl.querySelector(".cm-content");
      if (cm && typeof cm.focus === "function") cm.focus();
      const next = view && view.getState && view.getState() || {};
      return {
        ok: Boolean(cm),
        path: view && view.file && view.file.path,
        mode: next.mode || null,
        source: next.source,
        hasCm: Boolean(cm),
      };
    })())()`,
    lib.RPC_TIMEOUT_MS,
  );
}

async function findLineContaining(client, needle, exact) {
  return client.evaluate(
    `(() => {
      const view = window.app.workspace.activeLeaf && window.app.workspace.activeLeaf.view;
      const editor = view && view.editor;
      if (!editor || typeof editor.getValue !== "function") return { ok: false };
      const lines = String(editor.getValue()).split("\\n");
      const needle = ${JSON.stringify(needle)};
      const exact = ${JSON.stringify(Boolean(exact))};
      const line = lines.findIndex((text) => exact ? text === needle : text.includes(needle));
      if (line < 0) return { ok: false, line: -1, ch: 0, lineText: null, path: view.file && view.file.path || null };
      return { ok: true, line, ch: lines[line].length, lineText: lines[line], path: view.file && view.file.path || null };
    })()`,
  );
}

async function placeCaret(client, line, ch) {
  return client.evaluate(
    `(() => {
      const view = window.app.workspace.activeLeaf.view;
      const editor = view && view.editor;
      if (!editor) return { ok: false };
      editor.setCursor({ line: ${line}, ch: ${ch} });
      if (typeof editor.focus === "function") editor.focus();
      const cm = view.containerEl && view.containerEl.querySelector(".cm-content");
      if (cm) cm.focus();
      const active = view.containerEl && view.containerEl.querySelector(".cm-activeLine, .cm-content");
      if (active && typeof active.focus === "function") active.focus();
      return { ok: true, cursor: editor.getCursor() };
    })()`,
  );
}

async function clickEditor(client) {
  const box = await client.evaluate(
    `(() => {
      const view = window.app.workspace.activeLeaf && window.app.workspace.activeLeaf.view;
      const active = view && view.containerEl && (view.containerEl.querySelector(".cm-activeLine") || view.containerEl.querySelector(".cm-content"));
      if (!active) return null;
      const rect = active.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      return { x: Math.max(rect.left + 4, rect.right - 8), y: rect.top + Math.max(2, rect.height / 2) };
    })()`,
  );
  if (!box) return;
  await client.call("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: box.x,
    y: box.y,
    button: "left",
    clickCount: 1,
  });
  await client.call("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: box.x,
    y: box.y,
    button: "left",
    clickCount: 1,
  });
  await sleep(80);
}

async function enterInsertMode(client, options = {}) {
  await client.evaluate(
    `(() => {
      const view = window.app.workspace.activeLeaf && window.app.workspace.activeLeaf.view;
      if (view && view.editor && typeof view.editor.focus === "function") view.editor.focus();
      const cm = view && view.containerEl && view.containerEl.querySelector(".cm-content");
      if (cm && typeof cm.focus === "function") cm.focus();
      return Boolean(cm);
    })()`,
  );
  if (options.click) await clickEditor(client);
  await dispatchKey(client, "Escape");
  await sleep(60);
  await dispatchKey(client, "A");
  await sleep(120);
}

async function dismissOverlays(client) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const probe = await client.evaluate(PICKER_PROBE);
    if (!probe || (!probe.open && !probe.naming)) return;
    await dispatchKey(client, "Escape");
    await sleep(80);
  }
}

async function resetDaily(client, dailyPath) {
  await dismissOverlays(client);
  await client.evaluate(
    `(() => (async () => {
      const target = ${JSON.stringify(dailyPath)};
      const content = ${JSON.stringify(DAILY_NOTE)};
      const view = window.app.workspace.activeLeaf && window.app.workspace.activeLeaf.view;
      if (view && view.file && view.file.path === target && view.editor && typeof view.editor.setValue === "function") {
        view.editor.setValue(content);
        return { ok: true, via: "editor" };
      }
      const abstract = window.app.vault.getAbstractFileByPath(target);
      if (!abstract) return { ok: false, error: "missing " + target };
      await window.app.vault.modify(abstract, content);
      return { ok: true, via: "vault" };
    })())()`,
    lib.RPC_TIMEOUT_MS,
  );
  await sleep(200);
}

async function capturePage(client, output) {
  const screenshot = await client.call("Page.captureScreenshot", { format: "png", fromSurface: true });
  fs.writeFileSync(output, Buffer.from(screenshot.data, "base64"));
}

async function runE2e(parsed) {
  const executable = findExecutable(parsed.executable);
  const probe = probeExecutable(executable);
  if (!probe.ok) {
    fail(
      `unrun: ${probe.reason}. Rerun on a host with the Obsidian Electron app: xvfb-run -a node scripts/obsidian-task-wikilink-e2e.cjs -e /snap/bin/obsidian`,
      2,
    );
  }
  if (!process.env.DISPLAY && !process.env.XVFB_RUN_TMPDIR) {
    fail("unrun: no X display; rerun under xvfb-run -a node scripts/obsidian-task-wikilink-e2e.cjs", 2);
  }

  const outDir = parsed.out ? path.resolve(parsed.out) : fs.mkdtempSync(path.join(os.tmpdir(), "bob-twl-e2e-out-"));
  fs.mkdirSync(outDir, { recursive: true });
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bob-twl-e2e-"));
  const vaultDir = path.join(runRoot, "vault");
  const profileDir = path.join(runRoot, "profile");
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(profileDir, { recursive: true });
  const fixture = buildFixture(vaultDir);
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
  const report = {
    executable,
    vault: fixtureRealPath,
    cases: [],
    screenshots: [],
    pass: false,
  };
  try {
    const target = await selectOwnedTarget(cdpPort, fixtureRealPath, () => Boolean(exitInfo));
    client = await CdpClient.connect(target.webSocketDebuggerUrl, lib.CONNECT_TIMEOUT_MS);
    await client.call("Page.enable", {}, lib.RPC_TIMEOUT_MS);
    await client.call("Runtime.enable", {}, lib.RPC_TIMEOUT_MS);

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

    const pluginDeadline = Date.now() + 30_000;
    let loaded = false;
    while (Date.now() < pluginDeadline) {
      loaded = await client.evaluate(
        'Boolean(window.app && window.app.plugins && window.app.plugins.plugins && window.app.plugins.plugins["block-id-prompt"])',
      ).catch(() => false);
      if (loaded) break;
      await sleep(400);
    }
    record("plugin-loaded", loaded, loaded ? "block-id-prompt" : "block-id-prompt did not load");
    if (!loaded) throw new Error("block-id-prompt did not load in the scratch vault");
    await sleep(1500);

    async function assertPicker(open, label) {
      const probe = await waitFor(
        client,
        PICKER_PROBE,
        (value) => Boolean(value) && Boolean(value.open) === Boolean(open),
        label,
        open ? 6000 : 2500,
      ).catch((error) => ({ open: !open, error: error.message }));
      record(label, Boolean(probe.open) === Boolean(open), probe.title || probe.error || "");
      return probe;
    }

    async function prepareTyping(file, mode, needle, exact) {
      await dismissOverlays(client);
      const opened = await openNote(client, file, mode);
      await waitFor(
        client,
        EDITOR_PROBE,
        (value) => value && value.ok && value.path === file,
        `editor-${mode}-${file}`,
        8000,
      ).catch(() => null);
      if (file === fixture.daily) await resetDaily(client, fixture.daily);
      let located = { ok: false };
      if (needle) {
        const deadline = Date.now() + 4000;
        while (Date.now() < deadline) {
          located = await findLineContaining(client, needle, exact);
          if (located && located.ok) break;
          await sleep(80);
        }
      }
      if (located && located.ok) {
        await placeCaret(client, located.line, located.ch);
        await sleep(80);
      }
      await enterInsertMode(client, { click: mode === "live" });
      return { opened, located };
    }

    async function runAutoOpen(mode) {
      const prepared = await prepareTyping(fixture.daily, mode, "Type here:");
      record(
        `open-daily-${mode}`,
        prepared.opened && prepared.opened.ok && prepared.opened.hasCm !== false,
        prepared.opened && `${prepared.opened.path} source=${prepared.opened.source}`,
      );
      await typeText(client, "((");
      const picker = await assertPicker(true, `auto-open-${mode}`);
      const editor = await client.evaluate(EDITOR_PROBE);
      const paired = editor && typeof editor.lineText === "string" && editor.lineText.includes("((");
      record(`auto-pair-token-${mode}`, paired, editor && editor.lineText);
      await dispatchKey(client, "Escape");
      await assertPicker(false, `escape-closes-${mode}`);
      const afterEsc = await client.evaluate(EDITOR_PROBE);
      record(`escape-leaves-text-${mode}`, afterEsc && String(afterEsc.lineText).includes("(("), afterEsc && afterEsc.lineText);
      await enterInsertMode(client, { click: mode === "live" });
      await typeText(client, "x");
      const stayedClosed = await client.evaluate(PICKER_PROBE);
      record(`no-reopen-after-escape-${mode}`, stayedClosed && stayedClosed.open === false, stayedClosed && stayedClosed.title);
      return picker;
    }

    await runAutoOpen("live");
    await runAutoOpen("source");

    const burstPrep = await prepareTyping(fixture.daily, "source", "Type here:");
    record("open-burst", burstPrep.opened && burstPrep.opened.ok);
    await typeText(client, "((opus");
    const burst = await assertPicker(true, "burst-seeds-filter");
    record("burst-query", burst && /opus/i.test(String(burst.query || "")), burst && burst.query);
    const shotLight = path.join(outDir, "e2e-picker-light.png");
    await capturePage(client, shotLight);
    report.screenshots.push(path.basename(shotLight));

    await client.evaluate(`(() => {
      document.body.classList.remove("theme-light");
      document.body.classList.add("theme-dark");
      document.body.addClass && document.body.addClass("theme-dark");
      return true;
    })()`);
    await sleep(200);
    const shotDark = path.join(outDir, "e2e-picker-dark.png");
    await capturePage(client, shotDark);
    report.screenshots.push(path.basename(shotDark));
    await client.evaluate(`(() => {
      document.body.classList.remove("theme-dark");
      document.body.classList.add("theme-light");
      return true;
    })()`);

    await dispatchKey(client, "Enter", { text: "\r", vk: 13, code: "Enter" });
    await sleep(400);
    await assertPicker(false, "enter-closes-picker");
    const linked = await client.evaluate(EDITOR_PROBE);
    const hasLink = linked && /\[\[.+#\^[A-Za-z0-9-]+\]\]/.test(String(linked.lineText || linked.text || ""));
    record("enter-inserts-link", hasLink, linked && linked.lineText);
    const caretAfter = hasLink && linked.lineText && linked.ch === linked.lineText.indexOf("]]") + 2;
    record("caret-after-link", caretAfter, linked && `ch=${linked.ch} line=${linked.lineText}`);
    await dispatchKey(client, "z", { modifiers: 2, code: "KeyZ", vk: 90, text: "" });
    await sleep(200);
    const undone = await client.evaluate(EDITOR_PROBE);
    record("undo-restores-token", undone && String(undone.lineText || undone.text || "").includes("(("), undone && undone.lineText);

    const fastPrep = await prepareTyping(fixture.daily, "source", "Type here:");
    record("open-fast-burst", fastPrep.opened && fastPrep.opened.ok);
    await typeTextFast(client, "((opus");
    const fastPicker = await waitForFast(
      client,
      PICKER_PROBE,
      (value) => value && value.open && /opus/i.test(String(value.query || "")),
      "fast-burst-picker",
    );
    const readyAt = Date.now();
    await dispatchKey(client, "Enter", { text: "\r", vk: 13, code: "Enter", pause: 0 });
    const enterDelayMs = Date.now() - readyAt;
    record("fast-burst-enter", fastPicker.open && enterDelayMs <= 150, `${enterDelayMs} ms after picker became ready`);
    await waitFor(client, PICKER_PROBE, (value) => value && value.open === false, "fast-burst-closes");
    await dispatchKey(client, "z", { modifiers: 2, code: "KeyZ", vk: 90, text: "", pause: 0 });
    await sleep(120);
    const fastUndo = await client.evaluate(EDITOR_PROBE);
    record("fast-burst-one-undo", fastUndo && String(fastUndo.lineText || "").includes("((opus))"), fastUndo && fastUndo.lineText);

    const escapePrep = await prepareTyping(fixture.daily, "source", "Type here:");
    record("open-escape-filter", escapePrep.opened && escapePrep.opened.ok);
    await typeText(client, "((opus");
    await assertPicker(true, "escape-filter-picker");
    await dispatchKey(client, "Escape");
    const clearedFilter = await waitFor(
      client,
      PICKER_PROBE,
      (value) => value && value.open && value.query === "",
      "escape-clears-filter",
    );
    record("escape-clears-keeps-open", clearedFilter.open && clearedFilter.query === "");
    await dispatchKey(client, "Escape");
    await assertPicker(false, "escape-closes-after-clear");
    const escapeText = await client.evaluate(EDITOR_PROBE);
    record("second-escape-leaves-text", escapeText && String(escapeText.lineText || "").includes("((opus))"), escapeText && escapeText.lineText);

    const taskLinePrep = await prepareTyping(fixture.daily, "source", "Follow up");
    record("open-top-level-task-line", taskLinePrep.opened && taskLinePrep.opened.ok);
    // The token grammar needs a space before `((`, so separate it from the
    // task text like a user would; the picker then opens on the auto-pair.
    await typeText(client, " ((");
    const topLevelPicker = await assertPicker(true, "top-level-task-auto-pair-opens");
    const topLevelEditor = await client.evaluate(EDITOR_PROBE);
    record(
      "top-level-task-auto-pair",
      topLevelPicker && topLevelEditor && String(topLevelEditor.lineText || "").includes("(())"),
      topLevelEditor && topLevelEditor.lineText,
    );
    await dispatchKey(client, "Escape");
    await assertPicker(false, "top-level-task-escape");

    await dispatchKey(client, "Escape");
    await sleep(80);
    const reopen = await prepareTyping(fixture.daily, "source", "Type here:");
    record("reopen-for-backspace", reopen.opened && reopen.opened.ok);
    await typeText(client, "((");
    await assertPicker(true, "backspace-open");
    await dispatchKey(client, "Backspace", { vk: 8, code: "Backspace", text: "" });
    await sleep(200);
    await assertPicker(false, "backspace-closes");
    const afterBs = await client.evaluate(EDITOR_PROBE);
    record("backspace-leaves-parens", afterBs && /\(\)/.test(String(afterBs.lineText || "")), afterBs && afterBs.lineText);

    const inboxOpen = await prepareTyping(fixture.daily, "source", "Type here:");
    record("open-for-naming", inboxOpen.opened && inboxOpen.opened.ok);
    await typeText(client, "((try opus");
    await assertPicker(true, "naming-picker-open");
    await dispatchKey(client, "Enter", { text: "\r", vk: 13, code: "Enter" });
    const naming = await waitFor(
      client,
      PICKER_PROBE,
      (value) => value && value.naming === true,
      "naming-prompt",
      6000,
    ).catch((error) => ({ naming: false, error: error.message }));
    record("idless-opens-prompt", naming && naming.naming, naming && (naming.title || naming.error));
    await dispatchKey(client, "Enter", { text: "\r", vk: 13, code: "Enter" });
    await sleep(600);
    const named = await client.evaluate(EDITOR_PROBE);
    record("idless-inserts-link", named && /\[\[mac_inbox#\^[A-Za-z0-9-]+\]\]/.test(String(named.text || "")), named && named.lineText);
    const inboxText = await client.evaluate(
      `(() => (async () => window.app.vault.cachedRead(window.app.vault.getAbstractFileByPath("mac_inbox.md")))())()`,
    );
    record("idless-names-target", typeof inboxText === "string" && /\^[A-Za-z0-9-]+/.test(inboxText), String(inboxText).slice(0, 160));

    const pomOpen = await prepareTyping(fixture.daily, "source", "  - ", true);
    record("open-pomodoro", pomOpen.opened && pomOpen.opened.ok);
    await typeText(client, "((ready work");
    const pomPicker = await assertPicker(true, "pomodoro-picker-open");
    record("pomodoro-header", pomPicker && (pomPicker.pomodoro || /Pomodoro/i.test(pomPicker.title || "")), pomPicker && pomPicker.title);
    const pomQuery = await waitFor(
      client,
      PICKER_PROBE,
      (value) => value && value.open && /ready work/i.test(String(value.query || "")) && /↵ links it here/i.test(String(value.action || "")) && !/names it/i.test(String(value.action || "")),
      "pomodoro-query",
      8000,
    ).catch((error) => ({ query: "", error: error.message, action: "", selected: "" }));
    record(
      "pomodoro-query",
      /ready work/i.test(String(pomQuery.query || "")) && /↵ links it here/i.test(String(pomQuery.action || "")),
      pomQuery.action || pomQuery.error || pomQuery.selected,
    );
    await client.evaluate(
      `(() => {
        const rows = Array.from(document.querySelectorAll(".bid-twl-row"));
        const row = rows.find((item) => /Ready work for today/i.test(item.textContent || "")) || document.querySelector(".bid-twl-row.is-selected");
        const input = document.querySelector(".bid-twl-input, .bid-tlp-input");
        if (input && typeof input.focus === "function") input.focus();
        if (row) row.click();
        if (input) {
          input.dispatchEvent(new KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true,
          }));
        }
        return true;
      })()`,
    );
    await dispatchKey(client, "Enter", { text: "\r", vk: 13, code: "Enter" });
    await waitFor(
      client,
      PICKER_PROBE,
      (value) => value && value.open === false,
      "pomodoro-closes",
      6000,
    ).catch(() => null);
    const pomDump = await client.evaluate(
      `(() => {
        const rows = Array.from(document.querySelectorAll(".bid-twl-row")).map((item) => ({
          text: String(item.textContent || "").slice(0, 90),
          disabled: item.getAttribute("aria-disabled"),
          selected: item.classList.contains("is-selected"),
        }));
        const notices = Array.from(document.querySelectorAll(".notice, .notice-content")).map((item) => String(item.textContent || "").slice(0, 160));
        return { rows, notices };
      })()`,
    );
    await sleep(400);
    const pomNote = await client.evaluate(EDITOR_PROBE);
    record(
      "pomodoro-inserts-link",
      pomNote && /\[\[.+#\^ready-work\]\]/.test(String(pomNote.text || "")),
      `${pomNote && pomNote.lineText} dump=${JSON.stringify(pomDump).slice(0, 400)}`,
    );
    const tasksText = await client.evaluate(
      `(() => (async () => window.app.vault.cachedRead(window.app.vault.getAbstractFileByPath("Tasks.md")))())()`,
    );
    record(
      "pomodoro-promotes-and-retypes",
      typeof tasksText === "string" && /\[\*\] #task Ready work/.test(tasksText),
      String(tasksText).slice(0, 220),
    );

    const rapidPrep = await prepareTyping(fixture.daily, "source", "[[Tasks#|alias]]");
    record("open-pomodoro-rapid-marker", rapidPrep.opened && rapidPrep.opened.ok);
    await client.evaluate(`(() => {
      const view = window.app.workspace.activeLeaf && window.app.workspace.activeLeaf.view;
      const editor = view && view.editor;
      if (!editor) return false;
      const line = editor.getLine(editor.getCursor().line) || "";
      const ch = line.indexOf("#") + 1;
      editor.setCursor({ line: editor.getCursor().line, ch });
      if (typeof editor.focus === "function") editor.focus();
      const cm = view.containerEl && view.containerEl.querySelector(".cm-content");
      if (cm && typeof cm.focus === "function") cm.focus();
      return true;
    })()`);
    await typeText(client, "^^");
    const rapidPicker = await waitFor(
      client,
      TASK_PICKER_PROBE,
      (value) => value && value.open,
      "pomodoro-rapid-picker",
      6000,
    );
    await typeText(client, "Ship opus");
    const rapidSelection = await waitFor(
      client,
      TASK_PICKER_PROBE,
      (value) => value && value.open && /Ship opus/i.test(String(value.selected || "")),
      "pomodoro-rapid-selected-task",
      6000,
    );
    await dispatchKey(client, "Enter", { text: "\r", vk: 13, code: "Enter" });
    await waitFor(client, TASK_PICKER_PROBE, (value) => value && !value.open, "pomodoro-rapid-closes", 6000);
    await sleep(300);
    const rapidLinked = await client.evaluate(EDITOR_PROBE);
    record(
      "pomodoro-rapid-links-existing-id",
      rapidPicker.open && rapidSelection.open && rapidLinked && String(rapidLinked.text || "").includes("[[Tasks#^opus-demo|alias]]"),
      rapidLinked && rapidLinked.lineText,
    );
    const rapidTasksText = await client.evaluate(
      `(() => (async () => window.app.vault.cachedRead(window.app.vault.getAbstractFileByPath("Tasks.md")))())()`,
    );
    record(
      "pomodoro-rapid-promotes-existing-task",
      typeof rapidTasksText === "string" && /\[\*\] #task Ship opus blender demo/.test(rapidTasksText),
      String(rapidTasksText).slice(0, 180),
    );

    const fencedOpen = await prepareTyping(fixture.fenced, "source", "const pair = ");
    record("open-fenced", fencedOpen.opened && fencedOpen.opened.ok);
    await typeText(client, "((");
    await sleep(300);
    const fencedPicker = await client.evaluate(PICKER_PROBE);
    record("fenced-code-never-opens", fencedPicker && fencedPicker.open === false, fencedPicker && fencedPicker.title);

    const depOpen = await prepareTyping(fixture.depends, "source", "DEPENDS ON:");
    record("open-depends", depOpen.opened && depOpen.opened.ok);
    await typeText(client, "((");
    await sleep(300);
    const depPicker = await client.evaluate(PICKER_PROBE);
    record("depends-on-never-opens", depPicker && depPicker.open === false, depPicker && depPicker.title);

    report.cases = cases;
    report.pass = cases.every((item) => item.ok);
    report.out = outDir;
    if (parsed.report) {
      fs.mkdirSync(path.dirname(path.resolve(parsed.report)), { recursive: true });
      fs.writeFileSync(parsed.report, JSON.stringify(report, null, 2));
    }
    console.log(JSON.stringify({ pass: report.pass, failed: cases.filter((item) => !item.ok).map((item) => item.name), screenshots: report.screenshots, out: outDir }, null, 2));
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
