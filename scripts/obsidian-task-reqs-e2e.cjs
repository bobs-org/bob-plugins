#!/usr/bin/env node
// Real-Obsidian CDP verification of the requirement gestures (typing assist,
// Ctrl+] toggle) in an owned scratch vault/profile. Never opens the live vault.
"use strict";
const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const lib = require("./obsidian-startup-smoke-lib.cjs");

const ROOT = path.resolve(__dirname, "..");
const RPC_TIMEOUT_MS = 20_000;
const NOTE = "task-reqs-fixture.md";
const CYCLER = "task-status-cycler";
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
const HOTKEYS = {
  "task-status-cycler:toggle-task-checkbox-marker": [{ modifiers: ["Ctrl"], key: "]" }],
};
const GROUPS = ["typing", "vim", "toggle"];
const HELP = [
  "Usage: node scripts/obsidian-task-reqs-e2e.cjs [OPTIONS]",
  "",
  "Verify the requirement gestures in an isolated real Obsidian vault through CDP.",
  "Never opens the live vault. Starts Obsidian in its own xvfb-run display.",
  "",
  "  -e, --executable PATH   Obsidian executable (default: /snap/bin/obsidian)",
  "  -h, --help              Print help",
  "      --only NAME         Run only a named group (" + GROUPS.join(", ") + ")",
  "  -r, --report PATH       Write the structured JSON report",
  "  -s, --self-test         Run offline self-tests",
].join("\n");

// Virtual key codes Chromium needs for chords and non-text keys.
const KEY_CODES = {
  Backspace: { code: "Backspace", vk: 8 },
  Escape: { code: "Escape", vk: 27 },
  Enter: { code: "Enter", vk: 13 },
  " ": { code: "Space", vk: 32 },
  "[": { code: "BracketLeft", vk: 219 },
  "]": { code: "BracketRight", vk: 221 },
  "-": { code: "Minus", vk: 189 },
};
const CTRL = 2;

// Each case: a start document with the caret, the keystrokes, and the
// document and caret expected afterwards. `autopair` is the vault setting.
const TYPING_CASES = [];
for (const autopair of [true, false]) {
  const tag = autopair ? "autopair on" : "autopair off";
  TYPING_CASES.push(
    { name: `expand ${tag}`, autopair, doc: "- ", caret: [0, 2], keys: ["[", " "], expect: { doc: "- [ ] ", caret: [0, 6] } },
    { name: `expand nested ${tag}`, autopair, doc: "- [ ] #task Ship\n\t- ", caret: [1, 3], keys: ["[", " "], expect: { doc: "- [ ] #task Ship\n\t- [ ] ", caret: [1, 7] } },
    { name: `absorb ] and space ${tag}`, autopair, doc: "- ", caret: [0, 2], keys: ["[", " ", "]", " "], expect: { doc: "- [ ] ", caret: [0, 6] } },
    { name: `absorb ] only ${tag}`, autopair, doc: "- ", caret: [0, 2], keys: ["[", " ", "]"], expect: { doc: "- [ ] ", caret: [0, 6] } },
    { name: `other key disarms ${tag}`, autopair, doc: "- ", caret: [0, 2], keys: ["[", " ", "x", "]"], expect: { doc: "- [ ] x]", caret: [0, 8] } },
    { name: `atomic Backspace ${tag}`, autopair, doc: "- ", caret: [0, 2], keys: ["[", " ", "Backspace"], expect: { doc: "- ", caret: [0, 2] } },
    { name: `no expansion on [x ${tag}`, autopair, doc: "- ", caret: [0, 2], keys: ["[", "x", " "], expect: { doc: autopair ? "- [x ]" : "- [x ", caret: [0, 5] } },
    { name: `no expansion in a fence ${tag}`, autopair, doc: "```\n- ", caret: [1, 2], keys: ["[", " "], expect: { doc: autopair ? "```\n- [ ]" : "```\n- [ ", caret: [1, 4] } },
    { name: `one Undo returns the plain space ${tag}`, autopair, doc: "- ", caret: [0, 2], keys: ["[", " ", { key: "z", modifiers: CTRL, vk: 90 }], expect: { doc: autopair ? "- [ ]" : "- [ ", caret: [0, 4] } },
  );
}
TYPING_CASES.push(
  { name: "Backspace keeps trailing text", autopair: true, doc: "- [ ] keep", caret: [0, 6], keys: ["Backspace"], expect: { doc: "- keep", caret: [0, 2] } },
  { name: "Backspace elsewhere is default", autopair: true, doc: "- [ ] keep", caret: [0, 8], keys: ["Backspace"], expect: { doc: "- [ ] kep", caret: [0, 7] } },
);
// Vim insert mode: start in normal mode, enter insert at the end of the line.
const VIM_CASES = [
  { name: "vim insert expansion", autopair: true, doc: "- ", caret: [0, 2], keys: ["Escape", "A", "[", " "], expect: { doc: "- [ ] ", caret: [0, 6] } },
  { name: "vim insert expansion autopair off", autopair: false, doc: "- ", caret: [0, 2], keys: ["Escape", "A", "[", " "], expect: { doc: "- [ ] ", caret: [0, 6] } },
  { name: "vim insert absorption", autopair: true, doc: "- ", caret: [0, 2], keys: ["Escape", "A", "[", " ", "]", " "], expect: { doc: "- [ ] ", caret: [0, 6] } },
  { name: "vim insert atomic Backspace", autopair: true, doc: "- [ ] ", caret: [0, 6], keys: ["Escape", "A", "Backspace"], expect: { doc: "- ", caret: [0, 2] } },
  {
    name: "vim o continues a dropped req with an open box",
    autopair: true,
    doc: "- [ ] #task Ship\n\t- [-] dropped req",
    caret: [1, 4],
    keys: ["Escape", "o"],
    expect: { doc: "- [ ] #task Ship\n\t- [-] dropped req\n\t- [ ] ", caret: [2, 7] },
  },
  {
    name: "vim O continues a req with an open box",
    autopair: true,
    doc: "- [ ] #task Ship\n\t- [>] carried [[#^abc|A]]",
    caret: [1, 4],
    keys: ["Escape", "O"],
    expect: { doc: "- [ ] #task Ship\n\t- [ ] \n\t- [>] carried [[#^abc|A]]", caret: [1, 7] },
  },
];
const TOGGLE_START = "- [ ] #task Ship\n\t- loose a\n\t- note to req";
const TOGGLE_DONE = "- [ ] #task Ship\n\t- [ ] note to req\n\t- NOTES\n\t\t- loose a";
const TOGGLE_CASES = [
  {
    name: "Ctrl+] files the first req and scoops notes, one Undo",
    doc: TOGGLE_START,
    caret: [2, 8],
    keys: [{ key: "]", modifiers: CTRL }],
    expect: { doc: TOGGLE_DONE, caret: [1, 12], notice: "⌗⌗ First requirement · filed 1 note under NOTES" },
    thenUndo: TOGGLE_START,
  },
  {
    name: "Ctrl+] on a depth-1 req files it into NOTES",
    doc: "- [ ] #task Ship\n\t- [ ] req one\n\t- [ ] req two",
    caret: [1, 8],
    keys: [{ key: "]", modifiers: CTRL }],
    expect: { doc: "- [ ] #task Ship\n\t- [ ] req two\n\t- NOTES\n\t\t- req one", caret: [3, 5] },
    thenUndo: "- [ ] #task Ship\n\t- [ ] req one\n\t- [ ] req two",
  },
  {
    name: "Ctrl+] on a note under a note refuses",
    doc: "- [ ] #task Ship\n\t- note\n\t\t- deeper",
    caret: [2, 4],
    keys: [{ key: "]", modifiers: CTRL }],
    expect: { doc: "- [ ] #task Ship\n\t- note\n\t\t- deeper", caret: [2, 4], notice: "A requirement needs a task or requirement directly above it" },
  },
  {
    name: "Ctrl+] outside a task block keeps the legacy toggle",
    doc: "- plain\n- other",
    caret: [0, 4],
    keys: [{ key: "]", modifiers: CTRL }],
    expect: { doc: "- [ ] plain\n- other", caret: [0, 8] },
  },
  {
    name: "vim normal Ctrl+] files the first req",
    vim: true,
    doc: TOGGLE_START,
    caret: [2, 8],
    keys: ["Escape", { key: "]", modifiers: CTRL }],
    expect: { doc: TOGGLE_DONE, caret: [1, 12] },
  },
];

function parseArgs(argv) {
  const args = { executable: null, help: false, only: null, report: null, selfTest: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const value = () => {
      const next = argv[++i];
      if (!next || next.startsWith("-")) throw new Error(token + " requires a value");
      return next;
    };
    if (token === "-e" || token === "--executable" || token === "--obsidian-bin") args.executable = value();
    else if (token === "--only") args.only = value();
    else if (token === "-r" || token === "--report") args.report = value();
    else if (token === "-s" || token === "--self-test") args.selfTest = true;
    else if (token === "-h" || token === "--help") args.help = true;
    else throw new Error("Unknown argument: " + token);
  }
  return args;
}

function progress(message) { console.log("[task-reqs-e2e] " + message); }

function fail(message, code) {
  const error = new Error(message);
  error.exitCode = code || 1;
  throw error;
}

function findExecutable(override) {
  for (const candidate of [override, process.env.OBSIDIAN_BIN, "/snap/bin/obsidian"].filter(Boolean)) {
    try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch (_) {}
  }
  return override || "/snap/bin/obsidian";
}

// Environment for every Obsidian launch. The scratch app never talks to a
// session bus: the user's real bus makes Electron's main thread stall on
// portal and keyring lookups (the update check never finishes and DevTools
// never answers), and isolation means it must not touch the desktop anyway.
function launchEnv(extra) {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  env.DBUS_SESSION_BUS_ADDRESS = "disabled:";
  return env;
}

// Short scratch base: Chromium's SingletonSocket path must fit in 108 bytes,
// and agent hosts set a very long TMPDIR.
function scratchBase() {
  return process.platform === "linux" ? "/tmp" : os.tmpdir();
}

async function probeExecutable(executable) {
  try { fs.accessSync(executable, fs.constants.X_OK); } catch (_) {
    return { ok: false, reason: "Obsidian executable is not executable: " + executable };
  }
  // A private empty profile keeps the probe off the user's real one. Output
  // goes to a file, and the process group is killed, because under a display
  // `--help` starts the app and its children outlive the wrapper.
  const scratch = fs.mkdtempSync(path.join(scratchBase(), "bob-reqs-probe-"));
  const outFile = path.join(scratch, "help.txt");
  const fd = fs.openSync(outFile, "w");
  const child = spawn(executable, ["--user-data-dir=" + path.join(scratch, "profile"), "--help"], {
    detached: true, stdio: ["ignore", fd, fd], env: launchEnv({ TMPDIR: scratchBase() }),
  });
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 6_000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
  });
  try { process.kill(-child.pid, "SIGKILL"); } catch (_) {}
  fs.closeSync(fd);
  const output = fs.readFileSync(outFile, "utf8");
  fs.rmSync(scratch, { recursive: true, force: true });
  if (/unable to find Obsidian/i.test(output)) {
    return { ok: false, reason: "executable " + executable + " is the Obsidian CLI shim, not Electron" };
  }
  return { ok: true };
}

// Plugins the scenarios exercise. Later phases add the nav and Block ID
// Prompt gestures to this list; unrelated plugins stay out so their startup
// work cannot stall the editor under test.
const SCENARIO_PLUGINS = [CYCLER];

function expectedPlugins() {
  const plugins = [];
  for (const entry of fs.readdirSync(path.join(ROOT, "plugins"), { withFileTypes: true })) {
    if (!entry.isDirectory() || !SCENARIO_PLUGINS.includes(entry.name)) continue;
    const manifestPath = path.join(ROOT, "plugins", entry.name, "manifest.json");
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (manifest && manifest.id && manifest.version) plugins.push({ id: manifest.id, version: manifest.version });
  }
  return plugins.sort((a, b) => a.id.localeCompare(b.id));
}

function findTasksPluginSource() {
  const candidate = path.join(os.homedir(), "bob", ".obsidian", "plugins", "obsidian-tasks-plugin");
  return fs.existsSync(path.join(candidate, "main.js")) && fs.existsSync(path.join(candidate, "manifest.json"))
    ? candidate : null;
}

function buildFixture(vault, profilePath) {
  fs.mkdirSync(vault, { recursive: true });
  fs.writeFileSync(path.join(vault, NOTE), "# Task requirements fixture\n");
  const obsidian = path.join(vault, ".obsidian");
  fs.mkdirSync(obsidian, { recursive: true });
  const enabled = [];
  for (const plugin of expectedPlugins()) {
    const sourceDir = path.join(ROOT, "plugins", plugin.id);
    const targetDir = path.join(obsidian, "plugins", plugin.id);
    fs.mkdirSync(targetDir, { recursive: true });
    for (const file of ["manifest.json", "main.js", "styles.css"]) {
      const source = path.join(sourceDir, file);
      if (fs.existsSync(source)) fs.copyFileSync(source, path.join(targetDir, file));
    }
    enabled.push(plugin.id);
  }
  const tasksSource = findTasksPluginSource();
  if (tasksSource) {
    const targetDir = path.join(obsidian, "plugins", "obsidian-tasks-plugin");
    fs.mkdirSync(targetDir, { recursive: true });
    for (const file of ["manifest.json", "main.js", "styles.css"]) {
      const source = path.join(tasksSource, file);
      if (fs.existsSync(source)) fs.copyFileSync(source, path.join(targetDir, file));
    }
    fs.writeFileSync(path.join(targetDir, "data.json"), JSON.stringify(TASKS_DATA, null, 2));
    enabled.push("obsidian-tasks-plugin");
  }
  fs.writeFileSync(path.join(obsidian, "community-plugins.json"), JSON.stringify(enabled, null, 2));
  fs.writeFileSync(path.join(obsidian, "app.json"), JSON.stringify({
    livePreview: true, vimMode: false, autoPairBrackets: true, showLineNumber: false,
  }, null, 2));
  fs.writeFileSync(path.join(obsidian, "hotkeys.json"), JSON.stringify(HOTKEYS, null, 2));
  fs.writeFileSync(path.join(obsidian, "core-plugins.json"), JSON.stringify([
    "file-explorer", "global-search", "switcher", "page-preview", "command-palette",
    "editor-status", "outline", "daily-notes",
  ], null, 2));
  const profile = profilePath || path.join(vault, "..", "profile");
  const id = crypto.randomBytes(8).toString("hex");
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(profile, "obsidian.json"), JSON.stringify({
    vaults: { [id]: { path: fs.realpathSync(vault), ts: Date.now(), open: true } },
  }, null, 2));
  return { enabled, profile, tasksPlugin: Boolean(tasksSource) };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

class Cdp {
  constructor(socket) {
    this.socket = socket; this.nextId = 1; this.pending = new Map(); this.closed = false;
    socket.addEventListener("message", (event) => {
      let message; try { message = JSON.parse(event.data); } catch (_) { return; }
      const pending = this.pending.get(message.id); if (!pending) return;
      this.pending.delete(message.id); clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(pending.method + ": " + message.error.message));
      else pending.resolve(message.result || {});
    });
    socket.addEventListener("close", () => {
      this.closed = true;
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(pending.method + ": socket closed")); }
      this.pending.clear();
    });
  }
  static connect(url, timeout) {
    let WS = globalThis.WebSocket;
    if (typeof WS !== "function") { try { WS = require("undici").WebSocket; } catch (_) {} }
    if (!WS) throw new Error("CDP needs Node 22+ or undici WebSocket");
    return lib.withTimeout(new Promise((resolve, reject) => {
      let socket; try { socket = new WS(url); } catch (error) { reject(error); return; }
      socket.addEventListener("open", () => resolve(new Cdp(socket)), { once: true });
      socket.addEventListener("error", () => reject(new Error("CDP connection failed")), { once: true });
    }), timeout || lib.CONNECT_TIMEOUT_MS, "CDP connect");
  }
  call(method, params, timeout) {
    if (this.closed) return Promise.reject(new Error(method + ": socket is closed"));
    const id = this.nextId++;
    const duration = timeout || RPC_TIMEOUT_MS;
    return lib.withTimeout(new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(method + " timed out")); }, duration);
      this.pending.set(id, { resolve, reject, method, timer });
      try { this.socket.send(JSON.stringify({ id, method, params: params || {} })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    }), duration + 1000, method);
  }
  evaluate(expression, timeout) {
    return this.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true }, timeout)
      .then((response) => {
        if (response.exceptionDetails) {
          const details = response.exceptionDetails;
          throw new Error((details.exception && details.exception.description) || details.text || "Runtime.evaluate failed");
        }
        return response.result && response.result.value;
      });
  }
  close() { try { this.socket.close(); } catch (_) {} }
}

const VAULT_PROBE = '(() => { const a=window.app&&window.app.vault&&window.app.vault.adapter; return a&&a.basePath||null; })()';

async function selectTarget(port, fixture, shouldStop) {
  const deadline = Date.now() + 120_000;
  let last = "";
  while (Date.now() < deadline) {
    if (shouldStop()) throw new Error("owned Obsidian process exited before scratch vault opened");
    try {
      const response = await fetch("http://127.0.0.1:" + port + "/json/list", { signal: AbortSignal.timeout(5000) });
      const targets = response.ok ? await response.json() : [];
      for (const page of (Array.isArray(targets) ? targets : []).filter((x) => x.type === "page" && x.webSocketDebuggerUrl)) {
        let probe = null;
        let matched = false;
        try {
          probe = await Cdp.connect(page.webSocketDebuggerUrl, 5000);
          if (lib.verifyVaultPath(await probe.evaluate(VAULT_PROBE, 5000), fixture)) {
            matched = true;
            return probe;
          }
        } catch (error) { last = error && error.message ? error.message : String(error); }
        finally { if (probe && !matched) probe.close(); }
      }
    } catch (error) { last = error && error.message ? error.message : String(error); }
    await sleep(400);
  }
  throw new Error("no CDP page reports the scratch vault" + (last ? "; " + last.slice(0, 160) : ""));
}

async function dismissTrust(client) {
  const end = Date.now() + 8_000;
  while (Date.now() < end) {
    const clicked = await client.evaluate(
      '(()=>{const b=Array.from(document.querySelectorAll("button")).find(x=>/Trust author and enable plugins/i.test(x.textContent||""));if(b){b.click();return true;}return false;})()',
    ).catch(() => false);
    if (clicked) { await sleep(500); return true; }
    await sleep(200);
  }
  return false;
}

async function waitFor(client, expression, predicate, label, timeout) {
  const deadline = Date.now() + (timeout || 10_000);
  let last = null;
  while (Date.now() < deadline) {
    try { last = await client.evaluate(expression); if (predicate(last)) return last; }
    catch (error) { last = { error: error && error.message ? error.message : String(error) }; }
    await sleep(100);
  }
  throw new Error("timed out waiting for " + label + ": " + JSON.stringify(last));
}

// One keystroke: a bare string is a printable key or a named key; an object
// carries a chord (`key`, `modifiers`, optional `vk`).
function keyPayload(input) {
  const spec = typeof input === "string" ? { key: input } : input;
  const named = KEY_CODES[spec.key] || null;
  const modifiers = spec.modifiers || 0;
  const printable = spec.key.length === 1 && !modifiers;
  const text = printable ? spec.key : "";
  const code = (named && named.code) || (/^[a-z]$/i.test(spec.key) ? "Key" + spec.key.toUpperCase() : spec.key);
  const vk = spec.vk || (named && named.vk) || (spec.key.length === 1 ? spec.key.toUpperCase().charCodeAt(0) : 0);
  const payload = { key: spec.key, code, modifiers, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
  if (text) { payload.text = text; payload.unmodifiedText = text; }
  return payload;
}

async function key(client, input) {
  const payload = keyPayload(input);
  await client.call("Input.dispatchKeyEvent", { type: payload.text ? "keyDown" : "rawKeyDown", ...payload });
  await client.call("Input.dispatchKeyEvent", { type: "keyUp", ...payload });
  await sleep(40);
}

async function openNote(client) {
  return client.evaluate(
    '(() => (async()=>{const f=window.app.vault.getAbstractFileByPath(' + JSON.stringify(NOTE) +
    ');if(!f)return{ok:false};const w=window.app.workspace;const l=w.getLeaf(false);await l.openFile(f,{state:{mode:"source",source:true}});' +
    'w.setActiveLeaf(l,{focus:true});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));' +
    'const v=l.view;if(v&&v.editor&&v.editor.focus)v.editor.focus();return{ok:!!(v&&v.editor)};})())()',
    RPC_TIMEOUT_MS,
  );
}

async function setMode(client, vim, autopair) {
  await client.evaluate(
    '(()=>{const v=window.app.vault;v.setConfig("vimMode",' + JSON.stringify(Boolean(vim)) + ');v.setConfig("autoPairBrackets",' +
    JSON.stringify(autopair !== false) + ');if(window.app.workspace.updateOptions)window.app.workspace.updateOptions();return true;})()',
  );
  await sleep(300);
}

async function setDoc(client, doc, caret) {
  await client.evaluate(
    '(()=>{const w=window.app.workspace,v=w.activeLeaf&&w.activeLeaf.view,e=v&&v.editor;if(!e)return false;' +
    'document.querySelectorAll(".notice").forEach(n=>n.remove());e.setValue(' + JSON.stringify(doc) + ');e.setCursor({line:' + caret[0] +
    ',ch:' + caret[1] + '});e.focus();return true;})()',
  );
  await sleep(700);
}

async function readEditor(client) {
  return client.evaluate(
    '(()=>{const v=window.app.workspace.activeLeaf.view,e=v&&v.editor;if(!e)return null;const c=e.getCursor();' +
    'return{doc:e.getValue(),caret:[c.line,c.ch],notices:Array.from(document.querySelectorAll(".notice")).map(n=>n.textContent)};})()',
  );
}

async function runCase(client, entry) {
  await setMode(client, entry.vim || /^vim /.test(entry.name), entry.autopair !== false);
  await setDoc(client, entry.doc, entry.caret);
  for (const input of entry.keys) await key(client, input);
  await sleep(250);
  const state = await readEditor(client);
  const problems = [];
  if (state.doc !== entry.expect.doc) problems.push("doc " + JSON.stringify(state.doc) + " != " + JSON.stringify(entry.expect.doc));
  if (entry.expect.caret && JSON.stringify(state.caret) !== JSON.stringify(entry.expect.caret)) {
    problems.push("caret " + JSON.stringify(state.caret) + " != " + JSON.stringify(entry.expect.caret));
  }
  if (entry.expect.notice && !state.notices.some((text) => text.includes(entry.expect.notice))) {
    problems.push("notice " + JSON.stringify(state.notices) + " lacks " + JSON.stringify(entry.expect.notice));
  }
  if (!problems.length && entry.thenUndo !== undefined) {
    await key(client, { key: "z", modifiers: CTRL, vk: 90 });
    await sleep(250);
    const undone = await readEditor(client);
    if (undone.doc !== entry.thenUndo) problems.push("one Undo gave " + JSON.stringify(undone.doc) + " != " + JSON.stringify(entry.thenUndo));
  }
  if (problems.length) throw new Error(problems.join("; "));
}

function selfTest() {
  const parsed = parseArgs(["--self-test", "--only", "typing", "--report", "/tmp/reqs.json"]);
  if (!parsed.selfTest || parsed.only !== "typing") throw new Error("argument parsing failed");
  const names = new Set();
  for (const entry of TYPING_CASES.concat(VIM_CASES, TOGGLE_CASES)) {
    if (names.has(entry.name)) throw new Error("duplicate case name: " + entry.name);
    names.add(entry.name);
    if (!entry.keys.length || !entry.expect || typeof entry.expect.doc !== "string") throw new Error("malformed case: " + entry.name);
    for (const input of entry.keys) {
      const payload = keyPayload(input);
      if (!payload.key || payload.windowsVirtualKeyCode === undefined) throw new Error("bad key in " + entry.name);
    }
  }
  const ctrlBracket = keyPayload({ key: "]", modifiers: CTRL });
  if (ctrlBracket.windowsVirtualKeyCode !== 221 || ctrlBracket.text) throw new Error("Ctrl+] chord payload changed");
  if (keyPayload("[").text !== "[" || keyPayload("Backspace").text) throw new Error("text key payload changed");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bob-task-reqs-e2e-self-"));
  try {
    const built = buildFixture(temp, path.join(temp, "profile"));
    if (!built.enabled.includes(CYCLER)) throw new Error("scratch vault does not enable " + CYCLER);
    const app = JSON.parse(fs.readFileSync(path.join(temp, ".obsidian", "app.json"), "utf8"));
    if (app.vimMode !== false || app.autoPairBrackets !== true) throw new Error("fixture settings changed");
    const hotkeys = JSON.parse(fs.readFileSync(path.join(temp, ".obsidian", "hotkeys.json"), "utf8"));
    if (!hotkeys["task-status-cycler:toggle-task-checkbox-marker"]) throw new Error("Ctrl+] hotkey missing");
    const source = fs.readFileSync(__filename, "utf8");
    for (const token of ["Input.dispatchKeyEvent", "autoPairBrackets", "thenUndo", "vimMode"]) {
      if (!source.includes(token)) throw new Error("e2e is missing " + token);
    }
    console.log("offline self-test complete (not an Obsidian pass)");
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

async function runE2e(args) {
  const executable = findExecutable(args.executable);
  progress("probing " + executable);
  const probe = await probeExecutable(executable);
  progress("probe ok=" + probe.ok);
  if (!probe.ok) fail("unrun: " + probe.reason, 2);
  if (spawnSync("xvfb-run", ["--help"], { stdio: "ignore" }).error) fail("unrun: xvfb-run is not installed", 2);
  if (args.only && !GROUPS.includes(args.only)) fail("--only must be one of " + GROUPS.join(", "), 2);
  const runRoot = fs.mkdtempSync(path.join(scratchBase(), "bob-reqs-e2e-"));
  const vault = path.join(runRoot, "vault");
  const profile = path.join(runRoot, "profile");
  buildFixture(vault, profile);
  const fixturePath = fs.realpathSync(vault);
  const port = await freePort();
  // Obsidian gets its own private display: sharing the runner's Xvfb made
  // startup stall intermittently on agent hosts.
  const command = ["xvfb-run", "-a", executable];
  progress("launching " + command.join(" ") + " on port " + port);
  const logFile = path.join(runRoot, "obsidian.log");
  const logFd = fs.openSync(logFile, "w");
  const child = spawn(command[0], command.slice(1).concat([
    "--no-sandbox", "--user-data-dir=" + profile, "--remote-debugging-port=" + port,
    "--remote-allow-origins=http://127.0.0.1/*", fixturePath,
  ]), {
    cwd: fixturePath,
    env: launchEnv({ BOB_DIR: fixturePath, TMPDIR: scratchBase() }),
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  let exited = false;
  child.once("exit", () => { exited = true; });
  let client = null;
  const cases = [];
  const record = (name, status, detail) => {
    cases.push({ name, status, detail: detail || "" });
    if (status === "pass") console.log("PASS " + name);
    else console.error("FAIL " + name + ": " + detail);
  };
  const report = {
    executable,
    sourceSha: spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim(),
    cases, pass: false,
  };
  try {
    client = await selectTarget(port, fixturePath, () => exited);
    progress("scratch vault page found");
    await waitFor(client, "Boolean(window.app&&window.app.workspace&&window.app.workspace.layoutReady)", Boolean, "layout-ready", lib.LAYOUT_READY_TIMEOUT_MS);
    progress("layout ready");
    await dismissTrust(client);
    await waitFor(client, 'Boolean(window.app.plugins.plugins&&window.app.plugins.plugins["' + CYCLER + '"])', Boolean, "cycler plugin", 30_000);
    progress("cycler plugin loaded");
    await sleep(1000);
    report.appVersion = await client.evaluate("window.app.version||null").catch(() => null);
    const opened = await openNote(client);
    if (!opened || !opened.ok) throw new Error("could not open the fixture note");
    const groups = { typing: TYPING_CASES, vim: VIM_CASES, toggle: TOGGLE_CASES };
    for (const group of args.only ? [args.only] : GROUPS) {
      for (const entry of groups[group]) {
        try { await runCase(client, entry); record(entry.name, "pass"); }
        catch (error) { record(entry.name, "fail", error && error.message ? error.message : String(error)); }
      }
    }
    report.pass = cases.every((item) => item.status === "pass");
    if (args.report) {
      fs.mkdirSync(path.dirname(path.resolve(args.report)), { recursive: true });
      fs.writeFileSync(args.report, JSON.stringify(report, null, 2));
    }
    console.log(JSON.stringify({ pass: report.pass, failed: cases.filter((x) => x.status === "fail").map((x) => x.name) }, null, 2));
    if (!report.pass) fail("e2e failed: " + cases.filter((x) => x.status === "fail").map((x) => x.name).join(", "), 1);
  } catch (error) {
    try { console.error("--- obsidian.log tail ---\n" + fs.readFileSync(logFile, "utf8").slice(-1500)); } catch (_) {}
    throw error;
  } finally {
    if (client) client.close();
    try { process.kill(-child.pid, "SIGTERM"); } catch (_) {}
    try { if (child.exitCode == null && child.signalCode == null) child.kill("SIGTERM"); } catch (_) {}
    await new Promise((resolve) => {
      if (child.exitCode != null || child.signalCode != null) return resolve();
      const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch (_) {} resolve(); }, 4000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
    const cleanup = lib.planOwnedCleanup([runRoot], [runRoot]);
    for (const item of cleanup.removable) { try { fs.rmSync(item, { recursive: true, force: true }); } catch (_) {} }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(HELP); return; }
  if (args.selfTest) { selfTest(); return; }
  await runE2e(args);
}

module.exports = {
  Cdp,
  launchEnv,
  GROUPS,
  HOTKEYS,
  KEY_CODES,
  TOGGLE_CASES,
  TYPING_CASES,
  VIM_CASES,
  buildFixture,
  keyPayload,
  parseArgs,
  selfTest,
};

if (require.main === module) {
  main().catch((error) => {
    console.error((error && error.stack) || error);
    process.exitCode = error && error.exitCode ? error.exitCode : 1;
  });
}
