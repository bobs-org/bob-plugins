#!/usr/bin/env node
// Real-Obsidian e2e for block-ID renames: one undo must be one undo.
// Isolated scratch vault + profile, owned Obsidian process, CDP key events.
// Never opens the live vault. Reuses scripts/obsidian-startup-smoke-lib.cjs.
//
// Reproduces the 2026-11-09 split undo (plan 202611/lost_task_guards.md):
// the plugin renames ^old to ^new through its real rename modal, the user
// presses one undo, and every note must be back on ^old (no link may dangle).
//
//   xvfb-run -a node scripts/obsidian-block-id-rename-e2e.cjs [--out DIR] [-e PATH] [-r REPORT]
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

const HELP_TEXT = [
  "Usage: node scripts/obsidian-block-id-rename-e2e.cjs [OPTIONS]",
  "",
  "Drive a block-ID rename and one undo in an isolated scratch vault through CDP.",
  "Never opens the live vault. Run under xvfb-run -a on Linux.",
  "",
  "Options:",
  "  -e, --executable PATH   Obsidian executable (default: /snap/bin/obsidian)",
  "  -h, --help              Print this help and exit",
  "  -o, --out DIRECTORY     Screenshot output directory",
  "      --only NAME         Run only the named scenario (vim-undo, api-undo-open-split, ambiguous-undo)",
  "  -r, --report PATH       Write the structured JSON report to PATH",
  "  -s, --self-test         Run offline self-tests (no Obsidian needed)",
].join("\n");

const BOB_PATH = "bob.md";
const DAILY_PATH = "2026/20261109.md";
const DONE_PATH = "done/bob_done.md";
const ALL_PATHS = [BOB_PATH, DAILY_PATH, DONE_PATH];

// The 2026-11-09 shape: the destination (and active) note links to its own
// task from a BLOCKS line far above the task line, and two other notes link
// to it too. Edits on far-apart lines are separate CM6 history events.
function bobNote(id) {
  const filler = [];
  for (let index = 1; index <= 12; index += 1) filler.push(`Filler paragraph ${index}.`, "");
  return [
    "# Bob",
    "",
    "- [ ] #task Sync Gmail ^gmail-sync",
    `  - 🧱 **BLOCKS:** [[bob#^${id}]]`,
    "",
    ...filler,
    `- [*] #task Auto-label Kelly's emails with Bob. ^${id}`,
    "  - a child note",
    "",
  ].join("\n");
}

function dailyNote(id) {
  return [
    "# 2026-11-09",
    "",
    "## Pomodoros",
    "- [ ] BUILD (10:00-10:30)",
    `  - [[bob#^${id}]]`,
    "",
  ].join("\n");
}

function doneNote(id) {
  return [
    "# Bob done",
    "",
    "- [x] #task Untracked poms ^untracked-poms",
    `  - 🧱 **BLOCKS:** [[bob#^${id}]]`,
    "",
  ].join("\n");
}

function scenarioNotes(id) {
  return { [BOB_PATH]: bobNote(id), [DAILY_PATH]: dailyNote(id), [DONE_PATH]: doneNote(id) };
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Offline-checkable dangling scan: every `[[note#^id]]` (or same-note
// `[[#^id]]`) link in `notes` must point at a note that still has `^id`.
function danglingLinks(notes) {
  const byStem = new Map();
  for (const notePath of Object.keys(notes)) {
    byStem.set(notePath.replace(/\.md$/u, ""), notePath);
    byStem.set(path.basename(notePath, ".md"), notePath);
  }
  const dangling = [];
  for (const [notePath, content] of Object.entries(notes)) {
    const re = /\[\[([^\]|#]*)#\^([A-Za-z0-9-]+)(?:\|[^\]]*)?\]\]/gu;
    let match;
    while ((match = re.exec(String(content))) !== null) {
      const target = match[1] === "" ? notePath : byStem.get(match[1].replace(/\.md$/u, ""));
      const id = match[2];
      const targetContent = target ? notes[target] : null;
      const present =
        typeof targetContent === "string" &&
        new RegExp(`(^|[ \\t])\\^${escapeRegExp(id)}(?=$|[ \\t\\r\\n])`, "mu").test(targetContent);
      if (!present) dangling.push({ note: notePath, link: match[0], id, target: target || match[1] });
    }
  }
  return dangling;
}

function noteIds(notes) {
  const ids = {};
  for (const [notePath, content] of Object.entries(notes)) {
    ids[notePath] = Array.from(
      new Set(Array.from(String(content).matchAll(/\^((?:old|new)-id[A-Za-z0-9-]*)/gu), (match) => match[1])),
    ).sort();
  }
  return ids;
}

function installPlugins(vaultDir) {
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
    JSON.stringify({ livePreview: true, vimMode: true, showLineNumber: false }, null, 2),
  );
  fs.writeFileSync(path.join(vaultDir, ".obsidian", "appearance.json"), JSON.stringify({ cssTheme: "", theme: "moonstone" }, null, 2));
  return enabled;
}

function buildFixture(vaultDir) {
  for (const [notePath, content] of Object.entries(scenarioNotes("old-id"))) {
    writeNote(path.join(vaultDir, notePath), content);
  }
  return { enabled: installPlugins(vaultDir), bob: BOB_PATH, daily: DAILY_PATH, done: DONE_PATH };
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
  };
} catch (e) { return { ok: false, error: String(e && e.message || e) }; } })()`;

const NOTICE_PROBE = `(() => Array.from(document.querySelectorAll(".notice")).map((el) => el.textContent || ""))()`;

const SNAPSHOT_EXPRESSION = `(() => (async () => {
  const out = {};
  const leaves = window.app.workspace.getLeavesOfType("markdown");
  for (const notePath of ${JSON.stringify(ALL_PATHS)}) {
    const leaf = leaves.find((item) => item.view && item.view.file && item.view.file.path === notePath && item.view.editor);
    out[notePath] = leaf ? leaf.view.editor.getValue() : await window.app.vault.adapter.read(notePath);
  }
  return out;
})())()`;

function markdownViewState(mode) {
  return { mode: "source", source: mode === "source" };
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
      window.app.workspace.setActiveLeaf(leaf, { focus: true });
      const view = leaf.view;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const cm = view && view.containerEl && view.containerEl.querySelector && view.containerEl.querySelector(".cm-content");
      if (!cm) await new Promise((resolve) => setTimeout(resolve, 300));
      if (view && view.editor && typeof view.editor.focus === "function") view.editor.focus();
      return { ok: Boolean(view && view.editor), path: view && view.file && view.file.path };
    })())()`,
    lib.RPC_TIMEOUT_MS,
  );
}

async function openSplitNote(client, file) {
  return client.evaluate(
    `(() => (async () => {
      const abstract = window.app.vault.getAbstractFileByPath(${JSON.stringify(file)});
      if (!abstract) return { ok: false, error: "missing" };
      const leaf = window.app.workspace.getLeaf("split");
      await leaf.openFile(abstract, { state: ${JSON.stringify(markdownViewState("source"))} });
      await new Promise((resolve) => setTimeout(resolve, 400));
      return { ok: Boolean(leaf.view && leaf.view.editor), path: leaf.view && leaf.view.file && leaf.view.file.path };
    })())()`,
    lib.RPC_TIMEOUT_MS,
  );
}

async function activateNote(client, file) {
  return client.evaluate(
    `(() => {
      const leaf = window.app.workspace.getLeavesOfType("markdown").find((item) => item.view && item.view.file && item.view.file.path === ${JSON.stringify(file)});
      if (!leaf) return { ok: false };
      window.app.workspace.setActiveLeaf(leaf, { focus: true });
      if (leaf.view.editor && typeof leaf.view.editor.focus === "function") leaf.view.editor.focus();
      return { ok: true };
    })()`,
  );
}

async function resetScenario(client, notes) {
  await client.evaluate(
    `(() => (async () => {
      window.app.workspace.detachLeavesOfType("markdown");
      document.querySelectorAll(".notice").forEach((el) => el.remove());
      await new Promise((resolve) => setTimeout(resolve, 300));
      const notes = ${JSON.stringify(notes)};
      for (const [notePath, content] of Object.entries(notes)) {
        const abstract = window.app.vault.getAbstractFileByPath(notePath);
        if (!abstract) return { ok: false, error: "missing " + notePath };
        await window.app.vault.modify(abstract, content);
      }
      return { ok: true };
    })())()`,
    lib.RPC_TIMEOUT_MS,
  );
  // Let the metadata cache re-index the restored fixture before a rename.
  await sleep(1500);
}

async function snapshotNotes(client) {
  return client.evaluate(SNAPSHOT_EXPRESSION, lib.RPC_TIMEOUT_MS);
}

async function placeCaretOn(client, needle) {
  return client.evaluate(
    `(() => {
      const view = window.app.workspace.activeLeaf && window.app.workspace.activeLeaf.view;
      const editor = view && view.editor;
      if (!editor) return { ok: false };
      const lines = String(editor.getValue()).split("\\n");
      const line = lines.findIndex((text) => text.includes(${JSON.stringify(needle)}));
      if (line < 0) return { ok: false, error: "no line" };
      editor.setCursor({ line, ch: 4 });
      if (typeof editor.focus === "function") editor.focus();
      return { ok: true, line, path: view.file && view.file.path };
    })()`,
  );
}

// The real submit path: the rename command opens BlockIdPromptModal on the
// task's ^id, and Enter in its input runs the modal's submit().
async function renameThroughModal(client, newId) {
  await client.evaluate(
    `(() => window.app.commands.executeCommandById("block-id-prompt:rename-selected-block-id"))()`,
  );
  await waitFor(
    client,
    `(() => { const input = document.querySelector(".modal input[type=text]"); return { open: Boolean(input), value: input && input.value }; })()`,
    (value) => value && value.open,
    "rename modal",
    6000,
  );
  await client.evaluate(
    `(() => {
      const input = document.querySelector(".modal input[type=text]");
      input.focus();
      input.value = ${JSON.stringify(newId)};
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      return true;
    })()`,
  );
  await waitFor(
    client,
    `(() => ({ open: Boolean(document.querySelector(".modal input[type=text]")) }))()`,
    (value) => value && value.open === false,
    "rename modal closes",
    6000,
  );
}

// Focus the active editor like a real click would, then leave vim Insert
// mode, so the next key is a Normal-mode command.
async function focusEditorForKeys(client) {
  await activateNote(client, BOB_PATH);
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
  await client.evaluate(
    `(() => { const view = window.app.workspace.activeLeaf.view; return view.editor && view.editor.getValue().length; })()`,
  );
}

async function pressUndo(client, how) {
  if (how === "api") {
    return client.evaluate(
      `(() => { const editor = window.app.workspace.activeLeaf.view.editor; editor.undo(); return true; })()`,
    );
  }
  await focusEditorForKeys(client);
  await dispatchKey(client, "u", { pause: 200 });
  return true;
}

async function pressRedo(client, how) {
  if (how === "api") {
    return client.evaluate(
      `(() => { const editor = window.app.workspace.activeLeaf.view.editor; editor.redo(); return true; })()`,
    );
  }
  await focusEditorForKeys(client);
  await dispatchKey(client, "r", { modifiers: 2, text: "", pause: 200 });
  return true;
}

function coherent(notes, wantId) {
  const ids = noteIds(notes);
  return Object.values(ids).every((list) => list.length === 1 && list[0] === wantId);
}

// Poll until every note carries exactly `wantId`, or the budget is spent.
async function settle(client, wantId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let notes = await snapshotNotes(client);
  while (Date.now() < deadline && !coherent(notes, wantId)) {
    await sleep(200);
    notes = await snapshotNotes(client);
  }
  return notes;
}

async function runScenario(client, record, options) {
  const { name, suffix, undo, splitDaily, ambiguous } = options;
  const oldId = `old-id${suffix}`;
  const newId = `new-id${suffix}`;
  await resetScenario(client, scenarioNotes(oldId));
  const opened = await openNote(client, BOB_PATH, "source");
  record(`${name}:open-bob`, opened && opened.ok, opened && opened.path);
  const fresh = await waitFor(client, EDITOR_PROBE, (value) => value && value.ok && value.path === BOB_PATH, "bob editor", 8000);
  record(`${name}:fixture-reset`, fresh.text === bobNote(oldId), `ids=${JSON.stringify(noteIds({ [BOB_PATH]: fresh.text }))}`);
  if (splitDaily) {
    const split = await openSplitNote(client, DAILY_PATH);
    record(`${name}:open-daily-split`, split && split.ok, split && split.path);
    await activateNote(client, BOB_PATH);
    await sleep(200);
  }
  const placed = await placeCaretOn(client, `^${oldId}`);
  record(`${name}:caret-on-task`, placed && placed.ok && placed.path === BOB_PATH, JSON.stringify(placed));

  await renameThroughModal(client, newId);
  await sleep(600);
  const renamed = await snapshotNotes(client);
  record(
    `${name}:rename-applied-everywhere`,
    coherent(renamed, newId) && danglingLinks(renamed).length === 0,
    JSON.stringify(noteIds(renamed)),
  );
  const renameNotices = await client.evaluate(NOTICE_PROBE);
  record(
    `${name}:rename-notice`,
    renameNotices.some((text) => /Renamed block ID and updated 3 links/.test(text)),
    JSON.stringify(renameNotices),
  );

  if (ambiguous) {
    // A recorded note changes so the rewrite would be ambiguous: it gets one
    // more link to the new ID than the rename recorded.
    await client.evaluate(
      `(() => (async () => {
        const file = window.app.vault.getAbstractFileByPath(${JSON.stringify(DAILY_PATH)});
        const text = await window.app.vault.read(file);
        await window.app.vault.modify(file, text + "- see also [[bob#^${newId}]]\\n");
      })())()`,
      lib.RPC_TIMEOUT_MS,
    );
    await sleep(800);
  }

  await client.evaluate(`(() => { document.querySelectorAll(".notice").forEach((el) => el.remove()); return true; })()`);
  await pressUndo(client, undo);
  const inNote = await client.evaluate(EDITOR_PROBE);
  const bobIds = noteIds({ [BOB_PATH]: inNote.text })[BOB_PATH];
  record(
    `${name}:one-undo-reverts-the-whole-note`,
    inNote.path === BOB_PATH && bobIds.length === 1 && bobIds[0] === oldId,
    `bob.md ids after one undo: ${JSON.stringify(bobIds)}`,
  );

  const afterUndo = await settle(client, oldId, ambiguous ? 2500 : 6000);
  const dangling = danglingLinks(afterUndo);
  if (ambiguous) {
    const ids = noteIds(afterUndo);
    record(
      `${name}:ambiguous-note-left-alone`,
      ids[DAILY_PATH].length === 1 && ids[DAILY_PATH][0] === newId && ids[DONE_PATH].join() === oldId,
      JSON.stringify(ids),
    );
    const notices = await client.evaluate(NOTICE_PROBE);
    record(
      `${name}:sticky-notice-names-dangling-note`,
      notices.some((text) => text.includes(DAILY_PATH) && text.includes(newId)),
      JSON.stringify(notices),
    );
    await sleep(3000);
    const stillThere = await client.evaluate(NOTICE_PROBE);
    record(
      `${name}:notice-is-sticky`,
      stillThere.some((text) => text.includes(DAILY_PATH)),
      JSON.stringify(stillThere),
    );
    return;
  }
  record(
    `${name}:one-undo-leaves-no-dangling-link`,
    dangling.length === 0 && coherent(afterUndo, oldId),
    `ids=${JSON.stringify(noteIds(afterUndo))} dangling=${JSON.stringify(dangling.map((item) => `${item.note}->${item.id}`))}`,
  );
  const undoNotices = await client.evaluate(NOTICE_PROBE);
  record(
    `${name}:undo-notice`,
    undoNotices.some((text) => /Undid block ID rename in 2 notes/.test(text)),
    JSON.stringify(undoNotices),
  );

  await pressRedo(client, undo);
  const afterRedo = await settle(client, newId, 6000);
  record(
    `${name}:redo-reapplies-everywhere`,
    coherent(afterRedo, newId) && danglingLinks(afterRedo).length === 0,
    `ids=${JSON.stringify(noteIds(afterRedo))}`,
  );
}

function runSelfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bob-rename-e2e-self-"));
  try {
    const parsed = parseArgs(["--self-test", "--out", tmp, "--report", path.join(tmp, "r.json")]);
    if (!parsed.selfTest) throw new Error("parseArgs did not keep --self-test");
    const fixture = buildFixture(tmp);
    for (const notePath of ALL_PATHS) {
      if (!fs.existsSync(path.join(tmp, notePath))) throw new Error(`${notePath} missing`);
    }
    if (!fixture.enabled.includes("block-id-prompt")) throw new Error("block-id-prompt must be enabled");
    const app = JSON.parse(fs.readFileSync(path.join(tmp, ".obsidian/app.json"), "utf8"));
    if (app.vimMode !== true) throw new Error("vimMode must be on (the incident used vim u)");

    const clean = scenarioNotes("old-id");
    if (danglingLinks(clean).length !== 0) throw new Error("fixture must start with no dangling link");
    if (!coherent(clean, "old-id")) throw new Error("fixture must start on one ID");
    const taskLine = bobNote("old-id").split("\n").findIndex((text) => text.includes("^old-id") && text.includes("#task"));
    const linkLine = bobNote("old-id").split("\n").findIndex((text) => text.includes("[[bob#^old-id]]"));
    if (taskLine - linkLine < 8) throw new Error("same-note link and task line must sit far apart");

    // The observed 2026-11-09 split: only the task's ^id reverted.
    const split = { ...scenarioNotes("new-id"), [BOB_PATH]: bobNote("new-id").replace(/\^new-id$/mu, "^old-id") };
    const splitDangling = danglingLinks(split);
    if (splitDangling.length !== 3) {
      throw new Error(`split undo must leave 3 dangling links, saw ${splitDangling.length}`);
    }
    if (coherent(split, "old-id")) throw new Error("a split state must not read as coherent");
    const renamed = scenarioNotes("new-id");
    if (danglingLinks(renamed).length !== 0 || !coherent(renamed, "new-id")) {
      throw new Error("a fully renamed fixture must be coherent");
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
      `unrun: ${probe.reason}. Rerun on a host with the Obsidian Electron app: xvfb-run -a node scripts/obsidian-block-id-rename-e2e.cjs -e /snap/bin/obsidian`,
      2,
    );
  }
  if (!process.env.DISPLAY && !process.env.XVFB_RUN_TMPDIR) {
    fail("unrun: no X display; rerun under xvfb-run -a node scripts/obsidian-block-id-rename-e2e.cjs", 2);
  }

  const outDir = parsed.out ? path.resolve(parsed.out) : fs.mkdtempSync(path.join(os.tmpdir(), "bob-rename-e2e-out-"));
  fs.mkdirSync(outDir, { recursive: true });
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bob-rename-e2e-"));
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
    const version = await client.evaluate('window.app.plugins.plugins["block-id-prompt"].manifest.version');
    console.log(`block-id-prompt version under test: ${version}`);
    report.pluginVersion = version;
    await sleep(2500);

    const scenarios = [
      { name: "vim-undo", suffix: "", undo: "vim", splitDaily: false },
      { name: "api-undo-open-split", suffix: "-2", undo: "api", splitDaily: true },
      { name: "ambiguous-undo", suffix: "-3", undo: "api", splitDaily: false, ambiguous: true },
    ];
    for (const scenario of scenarios) {
      if (parsed.only && parsed.only !== scenario.name) continue;
      await runScenario(client, record, scenario);
    }

    report.cases = cases;
    report.pass = cases.every((item) => item.ok);
    report.out = outDir;
    if (parsed.report) {
      fs.mkdirSync(path.dirname(path.resolve(parsed.report)), { recursive: true });
      fs.writeFileSync(parsed.report, JSON.stringify(report, null, 2));
    }
    console.log(JSON.stringify({ pass: report.pass, failed: cases.filter((item) => !item.ok).map((item) => item.name), out: outDir }, null, 2));
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
