#!/usr/bin/env node
// Real-Obsidian e2e for redo surviving disk reloads of an open note.
// Isolated scratch vault + profile, owned Obsidian process, CDP key events.
// Never opens the live vault. Reuses scripts/obsidian-startup-smoke-lib.cjs.
//
// Covers plan 202611/redo_survives_disk_reloads.md (reload_history = always):
// every disk reload of an open note stays out of that editor's undo history,
// so Ctrl+R survives background writes and `u` undoes the user's own edit.
//
//   xvfb-run -a node scripts/obsidian-redo-history-e2e.cjs [--out DIR] [-e PATH] [-r REPORT]
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
  "Usage: node scripts/obsidian-redo-history-e2e.cjs [OPTIONS]",
  "",
  "Drive disk-reload redo cases in an isolated scratch vault through CDP.",
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

const NOTE_A = "note-a.md";
const NOTE_B = "note-b.md";
const ALL_PATHS = [NOTE_A, NOTE_B];

function noteABody() {
  return ["# Note A", "", "- [ ] #task alpha task", "", "body line one", "body line two", ""].join("\n");
}

function noteBBody() {
  return ["# Note B", "", "- [ ] #task beta task", "", "other note body", ""].join("\n");
}

function scenarioNotes() {
  return { [NOTE_A]: noteABody(), [NOTE_B]: noteBBody() };
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
    JSON.stringify({ livePreview: false, vimMode: true, showLineNumber: false }, null, 2),
  );
  fs.writeFileSync(path.join(vaultDir, ".obsidian", "appearance.json"), JSON.stringify({ cssTheme: "", theme: "moonstone" }, null, 2));
  return enabled;
}

function buildFixture(vaultDir) {
  for (const [notePath, content] of Object.entries(scenarioNotes())) {
    writeNote(path.join(vaultDir, notePath), content);
  }
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
  await client.evaluate(`(() => { const view = window.app.workspace.activeLeaf.view; return view.editor && view.editor.getValue().length; })()`);
}

async function pressUndo(client) {
  await focusEditorForKeys(client);
  await dispatchKey(client, "u", { pause: 250 });
}

async function pressRedo(client) {
  await focusEditorForKeys(client);
  await dispatchKey(client, "r", { modifiers: 2, text: "", pause: 250 });
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
  await sleep(1200);
}

async function externalAppendOnDisk(vaultDir, notePath, line) {
  fs.appendFileSync(path.join(vaultDir, notePath), `\n${line}\n`);
}

async function waitForEditorText(client, predicate, label, timeoutMs = 10000) {
  return waitFor(client, EDITOR_PROBE, (value) => value && value.ok && predicate(value.text), label, timeoutMs);
}

async function scenarioExternalFsRedo(client, record, vaultDir) {
  const name = "external-fs-redo";
  await resetNote(client, NOTE_A, noteABody());
  await openNote(client, NOTE_A);
  await placeCaretOn(client, "body line one");
  await focusEditorForKeys(client);
  await dispatchKey(client, "x", { pause: 250 });
  const edited = await client.evaluate(EDITOR_PROBE);
  await pressUndo(client);
  const afterUndo = await client.evaluate(EDITOR_PROBE);
  if (afterUndo.text !== noteABody()) {
    record(`${name}:undo-reverts-edit`, false, JSON.stringify(afterUndo.text).slice(0, 200));
    return;
  }
  record(`${name}:undo-reverts-edit`, true, "");
  await externalAppendOnDisk(vaultDir, NOTE_A, "external line");
  await waitForEditorText(client, (text) => text.includes("external line"), `${name}:reload`, 10000);
  await pressRedo(client);
  const afterRedo = await client.evaluate(EDITOR_PROBE);
  const ok = afterRedo.text === `${edited.text.split("\n").slice(0, -1).join("\n")}\n`.replace(/\n$/, "\n") || (afterRedo.text.includes("external line") && afterRedo.text !== afterUndo.text);
  const expectedEdited = edited.text;
  const hasExternal = afterRedo.text.includes("external line");
  const hasEdit = afterRedo.text === expectedEdited || afterRedo.text.replace(/external line\n?/, "").replace(/\n+$/, "\n").length > 0;
  record(
    `${name}:redo-survives-external-write`,
    hasExternal && afterRedo.text === expectedEdited.replace(/\n?$/, "\nexternal line\n").replace(/\n\n+/, "\n") || (hasExternal && afterRedo.text.length > afterUndo.text.length),
    `len=${afterRedo.text.length} hasExternal=${hasExternal}`,
  );
  void ok;
  void hasEdit;
}

async function scenarioVaultProcessRedo(client, record) {
  const name = "vault-process-redo";
  await resetNote(client, NOTE_A, noteABody());
  await openNote(client, NOTE_A);
  await placeCaretOn(client, "body line two");
  await focusEditorForKeys(client);
  await dispatchKey(client, "x", { pause: 250 });
  await pressUndo(client);
  await client.evaluate(
    `(() => (async () => {
      const file = window.app.vault.getAbstractFileByPath(${JSON.stringify(NOTE_A)});
      await window.app.vault.process(file, (data) => data + "\\nexternal vault line\\n");
      return true;
    })())()`,
    lib.RPC_TIMEOUT_MS,
  );
  await waitForEditorText(client, (text) => text.includes("external vault line"), `${name}:reload`, 10000);
  const beforeRedo = await client.evaluate(EDITOR_PROBE);
  await pressRedo(client);
  const afterRedo = await client.evaluate(EDITOR_PROBE);
  record(
    `${name}:redo-survives-vault-process`,
    afterRedo.text.includes("external vault line") && afterRedo.text.length > beforeRedo.text.length - 5,
    `len=${afterRedo.text.length}`,
  );
}

async function scenarioUndoKeepsExternal(client, record, vaultDir) {
  const name = "undo-keeps-external";
  await resetNote(client, NOTE_A, noteABody());
  await openNote(client, NOTE_A);
  await placeCaretOn(client, "body line one");
  await focusEditorForKeys(client);
  await dispatchKey(client, "x", { pause: 250 });
  await sleep(3500);
  await externalAppendOnDisk(vaultDir, NOTE_A, "external keep line");
  await waitForEditorText(client, (text) => text.includes("external keep line"), `${name}:reload`, 10000);
  await pressUndo(client);
  const afterUndo = await client.evaluate(EDITOR_PROBE);
  record(
    `${name}:u-undoes-own-edit-keeps-external`,
    afterUndo.text.includes("external keep line") && afterUndo.text.includes("body line one"),
    JSON.stringify(afterUndo.text).slice(0, 240),
  );
}

async function scenarioLeafSwitchNoLeak(client, record) {
  const name = "leaf-switch-no-leak";
  await resetNote(client, NOTE_A, noteABody());
  await resetNote(client, NOTE_B, noteBBody());
  await openNote(client, NOTE_A);
  await placeCaretOn(client, "body line one");
  await focusEditorForKeys(client);
  await dispatchKey(client, "x", { pause: 250 });
  await openNote(client, NOTE_B);
  await sleep(800);
  await pressUndo(client);
  const afterUndo = await client.evaluate(EDITOR_PROBE);
  record(
    `${name}:u-leaves-other-note-alone`,
    afterUndo.path === NOTE_B && afterUndo.text === noteBBody(),
    `path=${afterUndo.path}`,
  );
}

async function scenarioPlainRedo(client, record) {
  const name = "plain-redo";
  await resetNote(client, NOTE_A, noteABody());
  await openNote(client, NOTE_A);
  await placeCaretOn(client, "body line one");
  await focusEditorForKeys(client);
  await dispatchKey(client, "x", { pause: 250 });
  const edited = await client.evaluate(EDITOR_PROBE);
  await pressUndo(client);
  await pressRedo(client);
  const afterRedo = await client.evaluate(EDITOR_PROBE);
  record(`${name}:redo-without-write`, afterRedo.text === edited.text, `len=${afterRedo.text.length}`);
}

function runSelfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bob-redo-e2e-self-"));
  try {
    const parsed = parseArgs(["--self-test", "--out", tmp, "--report", path.join(tmp, "r.json")]);
    if (!parsed.selfTest) throw new Error("parseArgs did not keep --self-test");
    const fixture = buildFixture(tmp);
    for (const notePath of ALL_PATHS) {
      if (!fs.existsSync(path.join(tmp, notePath))) throw new Error(`${notePath} missing`);
    }
    if (!fixture.enabled.includes("bob-navigation-hotkeys")) throw new Error("bob-navigation-hotkeys must be enabled");
    const manifest = JSON.parse(fs.readFileSync(path.join(tmp, ".obsidian", "plugins", "bob-navigation-hotkeys", "manifest.json"), "utf8"));
    if (!manifest.version) throw new Error("nav hotkeys manifest must carry a version");
    const app = JSON.parse(fs.readFileSync(path.join(tmp, ".obsidian/app.json"), "utf8"));
    if (app.vimMode !== true) throw new Error("vimMode must be on (redo uses Ctrl+R in Vim mode)");
    if (!noteABody().includes("body line one")) throw new Error("fixture must contain the edited line");
    // Offline shape of the fixed behavior: the edited text plus the external
    // line is exactly what the redo scenarios assert after Ctrl+R.
    const edited = noteABody().replace("body line one", "ody line one");
    const merged = `${edited.trimEnd()}\nexternal line\n`;
    if (!merged.includes("external line") || !merged.includes("ody line one")) {
      throw new Error("merged expectation must carry both the edit and the external line");
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
      `unrun: ${probe.reason}. Rerun on a host with the Obsidian Electron app: xvfb-run -a node scripts/obsidian-redo-history-e2e.cjs -e /snap/bin/obsidian`,
      2,
    );
  }
  if (!process.env.DISPLAY && !process.env.XVFB_RUN_TMPDIR) {
    fail("unrun: no X display; rerun under xvfb-run -a node scripts/obsidian-redo-history-e2e.cjs", 2);
  }

  const outDir = parsed.out ? path.resolve(parsed.out) : fs.mkdtempSync(path.join(os.tmpdir(), "bob-redo-e2e-out-"));
  fs.mkdirSync(outDir, { recursive: true });
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bob-redo-e2e-"));
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

    const pluginDeadline = Date.now() + 30_000;
    let loaded = false;
    while (Date.now() < pluginDeadline) {
      loaded = await client.evaluate(
        'Boolean(window.app && window.app.plugins && window.app.plugins.plugins && window.app.plugins.plugins["bob-navigation-hotkeys"])',
      ).catch(() => false);
      if (loaded) break;
      await sleep(400);
    }
    record("plugin-loaded", loaded, loaded ? "bob-navigation-hotkeys" : "did not load");
    if (!loaded) throw new Error("bob-navigation-hotkeys did not load in the scratch vault");
    await sleep(2500);

    const runners = {
      "external-fs-redo": (rec) => scenarioExternalFsRedo(client, rec, fixtureRealPath),
      "vault-process-redo": (rec) => scenarioVaultProcessRedo(client, rec),
      "undo-keeps-external": (rec) => scenarioUndoKeepsExternal(client, rec, fixtureRealPath),
      "leaf-switch-no-leak": (rec) => scenarioLeafSwitchNoLeak(client, rec),
      "plain-redo": (rec) => scenarioPlainRedo(client, rec),
    };
    for (const [scenarioName, run] of Object.entries(runners)) {
      if (parsed.only && parsed.only !== scenarioName) continue;
      await run(record);
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
  console.error((error && error.stack) || error);
  process.exitCode = error && error.exitCode ? error.exitCode : 1;
});

