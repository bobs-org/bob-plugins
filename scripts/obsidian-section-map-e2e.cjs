#!/usr/bin/env node
// Real-Obsidian Section Map acceptance: CDP verification of the Ctrl+J / Ctrl+K
// Section Map in an owned scratch vault/profile. Never opens the live vault.
//
// Run under xvfb-run -a on Linux (athena has Obsidian + xvfb-run):
//   xvfb-run -a node scripts/obsidian-section-map-e2e.cjs \
//     -e /snap/bin/obsidian -r <dir>/report.json -o <dir>/shots
// then review the report and screenshots.
//
// Groups (--only routes|lifecycle|content|peek|safety):
//   routes:    the insert / non-Vim hotkeys.json route (Ctrl+J / Ctrl+K in
//              insert mode, with Vim maps cleared) and the Vim normal-mode
//              route (with hotkeys.json cleared). The fixture has no
//              vimrc-support, so the vault's exmap+nnoremap pair
//              (obsidian_vimrc.md: `exmap bob_next_header obcommand ...` and
//              `nnoremap <C-j> :bob_next_header<CR>`) is emulated with the
//              CodeMirror Vim API (defineEx + map), recorded in the report.
//   lifecycle: a single tap shows the card then hides it ~2.2 s after Ctrl
//              release; rapid repeats reuse the same card node in place;
//              edit, j, k, q, Esc, and click dismiss; j/k enter normal mode
//              before the map; q still records a Vim macro; Esc still drops
//              to normal mode; wheel scroll does not dismiss; a pane switch
//              dismisses; a pop-out Escape dismisses.
//   content:   wrap shows the wrapped pill; each chip's row equals where the
//              next real press lands; the 42-heading note windows with exact
//              gap counts; a long current label stays in pane; reduced-motion
//              wrap keeps a still badge; a short horizontal split keeps the
//              current row; a narrow split shows the compact strip; margin
//              mode applies with readable line length on.
//   peek:      show-section-map never moves the cursor and stays pinned past
//              the linger window until a key dismisses it.
//   safety:    note bytes are unchanged (hashes) and the console has no
//              exceptions; screenshots are taken in light and dark.
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
const TEMP_ROOT = "/tmp";
const NEXT_ID = "bob-navigation-hotkeys:jump-to-next-section-header";
const PREV_ID = "bob-navigation-hotkeys:jump-to-prev-section-header";
const PEEK_ID = "bob-navigation-hotkeys:show-section-map";

const MAIN = "section-map-fixture.md";
const MAIN_LINES = [
  "# Live preview",
  "Intro line one under the first heading.",
  "Intro line two keeps the cursor off the heading.",
  "## Goals",
  "Body under goals.",
  "### Capture grammar",
  "Body under capture grammar.",
  "### Completion",
  "Body with a [[Target|alias]] and **bold** text.",
  "## Design",
  "Body under design.",
  "# Mac Capture",
  "Body under mac capture.",
  "##  Notes",
  "Body under spaced heading.",
  "## [[Target|Pretty]] heading",
  "Body under link heading.",
  "## `code` heading",
  "Body under code heading.",
  "##",
  "Body under untitled heading.",
  "## Tag #landmark heading",
  "Body under tag heading.",
  "## Trailing hashes ##",
  "Final body line.",
];
const MAIN_BODY = MAIN_LINES.join("\n");
const MAIN_HEADINGS = MAIN_LINES.flatMap((line, index) => (/^#{1,6}(?:\s|$)/.test(line) || line === "##" ? [index] : []));
const OTHER = "section-map-other.md";
const OTHER_BODY = "# Other note\n\nA second tab.\n";
const WIND = "section-map-42.md";
const WIND_LINES = [];
for (let index = 1; index <= 42; index += 1) {
  WIND_LINES.push("# Wind " + String(index).padStart(2, "0"), "Body under wind " + String(index).padStart(2, "0") + ".");
}
const WIND_BODY = WIND_LINES.join("\n");
const WIND_HEADINGS = WIND_LINES.flatMap((line, index) => (line.startsWith("# Wind") ? [index] : []));
const WRAP = "section-map-wrap.md";
const WRAP_LINES = ["# Dawn", "first body", "## Noon", "second body", "## Dusk", "third body"];
const WRAP_BODY = WRAP_LINES.join("\n");
const SINGLE = "section-map-single.md";
const SINGLE_BODY = "# Only heading\n\nBody under the only heading.\n";
const EMPTY = "section-map-empty.md";
const EMPTY_BODY = "Just body text here.\nNo headings in this note.\n";
const LONG = "section-map-long.md";
const LONG_BODY = [
  "# Long current heading label that should wrap onto two lines in the Section Map current row without covering its neighbors",
  "Body under the long heading.",
  "# Second",
  "Body under the second heading.",
  "# Third",
  "Final body.",
].join("\n");

const HELP = [
  "Usage: node scripts/obsidian-section-map-e2e.cjs [OPTIONS]",
  "",
  "Verify the Ctrl+J / Ctrl+K Section Map in an isolated real Obsidian vault",
  "through CDP. Never opens the live vault. Run under xvfb-run -a on Linux.",
  "",
  "  -e, --executable PATH   Obsidian executable (default: /snap/bin/obsidian)",
  "  -h, --help              Print help",
  "  -o, --out DIRECTORY     Screenshot output directory",
  "      --only NAME         Run only a named group: routes, lifecycle, peek, content, safety",
  "  -r, --report PATH       Write the structured JSON report",
  "  -s, --self-test         Run offline self-tests (no Obsidian needed)",
  "",
  "The --self-test run is an offline check only, never an Obsidian pass.",
].join("\n");

function parseArgs(argv) {
  const args = { executable: null, help: false, only: null, out: null, report: null, selfTest: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "-e" || token === "--executable" || token === "--obsidian-bin") {
      const value = argv[++i];
      if (!value || value.startsWith("-")) throw new Error("--executable requires a PATH");
      args.executable = value;
    } else if (token === "--only") {
      const value = argv[++i];
      if (!value || value.startsWith("-")) throw new Error("--only requires a NAME");
      args.only = value;
    } else if (token === "-o" || token === "--out") {
      const value = argv[++i];
      if (!value || value.startsWith("-")) throw new Error("--out requires a DIRECTORY");
      args.out = value;
    } else if (token === "-r" || token === "--report") {
      const value = argv[++i];
      if (!value || value.startsWith("-")) throw new Error("--report requires a PATH");
      args.report = value;
    } else if (token === "-s" || token === "--self-test") args.selfTest = true;
    else if (token === "-h" || token === "--help") args.help = true;
    else throw new Error("Unknown argument: " + token);
  }
  return args;
}

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

function probeExecutable(executable) {
  try { fs.accessSync(executable, fs.constants.X_OK); } catch (_) {
    return { ok: false, reason: "Obsidian executable is not executable: " + executable };
  }
  const result = spawnSync(executable, ["--help"], { encoding: "utf8", timeout: 20_000 });
  if (/unable to find Obsidian/i.test(String(result.stdout || "") + String(result.stderr || ""))) {
    return { ok: false, reason: "executable " + executable + " is the Obsidian CLI shim, not Electron" };
  }
  return { ok: true };
}

function expectedPlugins() {
  const plugins = [];
  for (const entry of fs.readdirSync(path.join(ROOT, "plugins"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(ROOT, "plugins", entry.name, "manifest.json");
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (manifest && manifest.id && manifest.version) plugins.push({ id: manifest.id, version: manifest.version });
  }
  return plugins.sort((a, b) => a.id.localeCompare(b.id));
}

function buildFixture(vault, profilePath) {
  fs.mkdirSync(vault, { recursive: true });
  const files = {
    [MAIN]: MAIN_BODY,
    [OTHER]: OTHER_BODY,
    [WIND]: WIND_BODY,
    [WRAP]: WRAP_BODY,
    [SINGLE]: SINGLE_BODY,
    [EMPTY]: EMPTY_BODY,
    [LONG]: LONG_BODY,
  };
  for (const [file, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(vault, file), content);
  }
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
  fs.writeFileSync(path.join(obsidian, "community-plugins.json"), JSON.stringify(enabled, null, 2));
  fs.writeFileSync(path.join(obsidian, "app.json"), JSON.stringify({
    livePreview: true, vimMode: true, readableLineLength: true,
    showLineNumber: false,
  }, null, 2));
  fs.writeFileSync(path.join(obsidian, "appearance.json"), JSON.stringify({ cssTheme: "", theme: "moonstone" }, null, 2));
  fs.writeFileSync(path.join(obsidian, "core-plugins.json"), JSON.stringify([
    "file-explorer", "global-search", "switcher", "page-preview", "command-palette",
    "editor-status", "outline", "daily-notes",
  ], null, 2));
  fs.writeFileSync(path.join(obsidian, "daily-notes.json"), JSON.stringify({
    format: "YYYY/YYYYMMDD", folder: "", template: "",
  }, null, 2));
  fs.writeFileSync(path.join(obsidian, "hotkeys.json"), JSON.stringify({
    [NEXT_ID]: [{ modifiers: ["Ctrl"], key: "J" }],
    [PREV_ID]: [{ modifiers: ["Ctrl"], key: "K" }],
  }, null, 2));
  const profile = profilePath || path.join(vault, "..", "profile");
  const id = crypto.randomBytes(8).toString("hex");
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(profile, "obsidian.json"), JSON.stringify({
    vaults: { [id]: { path: fs.realpathSync(vault), ts: Date.now(), open: true } },
  }, null, 2));
  return { enabled, profile };
}

function fixtureHashes(vault) {
  const hashes = {};
  for (const file of [MAIN, OTHER, WIND, WRAP, SINGLE, EMPTY, LONG]) {
    hashes[file] = crypto.createHash("sha256").update(fs.readFileSync(path.join(vault, file))).digest("hex");
  }
  return hashes;
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
    this.socket = socket; this.nextId = 1; this.pending = new Map(); this.listeners = new Map(); this.closed = false;
    socket.addEventListener("message", (event) => {
      let message; try { message = JSON.parse(event.data); } catch (_) { return; }
      if (message.method) {
        for (const handler of this.listeners.get(message.method) || []) {
          try { handler(message.params || {}); } catch (_) {}
        }
        return;
      }
      const pending = this.pending.get(message.id); if (!pending) return;
      this.pending.delete(message.id); clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
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
  on(method, handler) {
    const list = this.listeners.get(method) || [];
    list.push(handler);
    this.listeners.set(method, list);
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
  const deadline = Date.now() + lib.CONNECT_TIMEOUT_MS * 2;
  let last = "";
  while (Date.now() < deadline) {
    if (shouldStop()) throw new Error("owned Obsidian process exited before scratch vault opened");
    try {
      const response = await fetch("http://127.0.0.1:" + port + "/json/list");
      const targets = response.ok ? await response.json() : [];
      for (const page of (Array.isArray(targets) ? targets : []).filter((x) => x.type === "page" && x.webSocketDebuggerUrl)) {
        let probe = null;
        try {
          probe = await Cdp.connect(page.webSocketDebuggerUrl, 5000);
          if (lib.verifyVaultPath(await probe.evaluate(VAULT_PROBE, 5000), fixture)) return page;
        } catch (error) { last = error && error.message ? error.message : String(error); }
        finally { if (probe) probe.close(); }
      }
    } catch (error) { last = error && error.message ? error.message : String(error); }
    await sleep(400);
  }
  throw new Error("no CDP page reports the scratch vault" + (last ? "; " + last.slice(0, 160) : ""));
}

function codeFor(key) {
  if (/^[a-z]$/i.test(key)) return "Key" + key.toUpperCase();
  if (key === "Enter" || key === "Escape") return key;
  if (key === ":") return "Semicolon";
  if (key === "@") return "Digit2";
  return key;
}

// keyDown without the matching keyUp, so a test can hold Ctrl across presses
// and measure the linger from the real release.
async function keyDownOnly(client, input) {
  const spec = typeof input === "string" ? { key: input } : input;
  const modifiers = spec.modifiers || 0;
  const text = Object.prototype.hasOwnProperty.call(spec, "text")
    ? spec.text : (!modifiers && spec.key.length === 1 ? spec.key : spec.key === "Enter" ? "\r" : "");
  const payload = { key: spec.key, code: spec.code || codeFor(spec.key), modifiers, windowsVirtualKeyCode: 0, nativeVirtualKeyCode: 0 };
  if (text) { payload.text = text; payload.unmodifiedText = text; }
  await client.call("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...payload });
  if (spec.pause !== 0) await sleep(spec.pause == null ? 24 : spec.pause);
}

async function keyUpOnly(client, input) {
  const spec = typeof input === "string" ? { key: input } : input;
  const payload = { key: spec.key, code: spec.code || codeFor(spec.key), modifiers: spec.modifiers || 0, windowsVirtualKeyCode: 0, nativeVirtualKeyCode: 0 };
  await client.call("Input.dispatchKeyEvent", { type: "keyUp", ...payload });
  if (spec.pause !== 0) await sleep(spec.pause == null ? 24 : spec.pause);
}

async function key(client, input) {
  await keyDownOnly(client, input);
  await keyUpOnly(client, input);
}
async function keys(client, sequence) { for (const item of sequence) await key(client, item); }

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

async function openNote(client, file, mode) {
  const state = { mode: mode || "source" };
  if (state.mode === "source") state.source = true;
  return client.evaluate(
    '(() => (async()=>{const f=window.app.vault.getAbstractFileByPath(' + JSON.stringify(file) +
    ');if(!f)return{ok:false};const w=window.app.workspace;const l=w.getLeaf(false);await l.openFile(f,{state:' +
    JSON.stringify(state) + '});if(l.view&&l.view.setState)await l.view.setState(' + JSON.stringify(state) +
    ',{history:false});w.setActiveLeaf(l,{focus:true});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));' +
    'const v=l.view;if(v&&v.editor&&v.editor.focus)v.editor.focus();return{ok:!!(v&&v.editor)};})())()',
    RPC_TIMEOUT_MS,
  );
}

async function resetNote(client, file, body) {
  await client.evaluate(
    '(() => (async()=>{const w=window.app.workspace,f=window.app.vault.getAbstractFileByPath(' + JSON.stringify(file) +
    ');if(!f)return false;await window.app.vault.modify(f,' + JSON.stringify(body) + ');return true;})())()',
    RPC_TIMEOUT_MS,
  );
  await sleep(250);
}

async function caret(client, line, ch) {
  const result = await client.evaluate(
    '(()=>{const v=window.app.workspace.activeLeaf.view,e=v&&v.editor;if(!e)return{ok:false};' +
    'e.setCursor({line:' + Number(line) + ',ch:' + Number(ch || 0) + '});if(e.focus)e.focus();return{ok:true};})()',
  );
  if (!result || !result.ok) throw new Error("could not place caret on line " + line);
}

async function normalMode(client) {
  await key(client, "Escape");
  await sleep(120);
}

async function insertMode(client) {
  await normalMode(client);
  await key(client, "i");
  await sleep(120);
}

const EDITOR_PROBE = '(()=>{const v=window.app.workspace.activeLeaf.view,e=v&&v.editor;if(!e)return{ok:false};' +
  'const c=e.getCursor();return{ok:true,line:c.line,ch:c.ch,path:v.file&&v.file.path||null};})()';

const MAP_PROBE = '(()=>{const host=document.querySelector(\'[data-bob-section-map="host"]\');' +
  'if(!host)return{present:false};' +
  'const q=(sel)=>host.querySelector(sel);' +
  'const card=q(\'[data-bob-section-map="card"]\');' +
  'const chipRows=(el)=>Array.from(el.querySelectorAll(\'[data-bob-section-map="chip"]\')).map((c)=>({text:c.textContent||"",wrap:c.classList.contains("is-wrap")}));' +
  'const rows=Array.from(host.querySelectorAll(\'[data-bob-section-map="row"]\')).map((el)=>({key:el.getAttribute("data-bob-section-map-key"),current:el.classList.contains("is-current"),ring:Boolean(el.querySelector(\'[data-bob-section-map="ring"]\')),label:((el.querySelector(\'[data-bob-section-map="label"]\')||{}).textContent||""),chips:chipRows(el)}));' +
  'const gaps=Array.from(host.querySelectorAll(\'[data-bob-section-map="gap"]\')).map((el)=>el.textContent||"");' +
  'const wrap=q(\'[data-bob-section-map="wrap"]\');' +
  'const counter=q(\'[data-bob-section-map="counter"]\');' +
  'const strip=q(\'[data-bob-section-map="compact"]\');' +
  'const live=q(\'[data-bob-section-map="live"]\');' +
  'return{present:true,hidden:host.classList.contains("is-hidden"),' +
  'mode:!card||card.classList.contains("is-margin")?"margin":card.classList.contains("is-compact")?"compact":"overlay",' +
  'counter:counter?counter.textContent:null,' +
  'wrapHidden:!wrap||wrap.classList.contains("is-hidden"),wrapText:wrap?wrap.textContent:null,' +
  'rows:rows,gaps:gaps,' +
  'stripHidden:!strip||strip.classList.contains("is-hidden"),stripText:strip?strip.textContent:null,' +
  'liveText:live?live.textContent:null};})()';

function rowLine(row) {
  const match = /^sm:(-?\d+)$/.exec(row && row.key);
  return match ? Number(match[1]) : null;
}

function chipDirections(row) {
  return (row.chips || []).map((chip) => (/K/.test(chip.text) ? -1 : 1));
}

function gapCount(text) {
  const match = /(\d+)\s+more/.exec(String(text || ""));
  return match ? Number(match[1]) : null;
}

async function mapState(client) {
  return client.evaluate(MAP_PROBE);
}

async function runCase(record, name, action) {
  try {
    const detail = await action();
    if (detail === "__skip__") return;
    record(name, "pass", detail || "");
  } catch (error) {
    record(name, "fail", error && error.message ? error.message : String(error));
  }
}

// Emulate the vault's vimrc pair (`exmap bob_next_header obcommand ...` and
// `nnoremap <C-j> :bob_next_header<CR>`) with the CodeMirror Vim API. The
// scratch fixture has no vimrc-support, so this is recorded in the report.
async function setJumpHotkeys(client, enabled) {
  const on = Boolean(enabled);
  return client.evaluate(
    '(()=>{const ids=' + JSON.stringify([NEXT_ID, PREV_ID]) + ';' +
    'const keys=[{modifiers:["Ctrl"],key:"J"},{modifiers:["Ctrl"],key:"K"}];' +
    'const hm=window.app.hotkeyManager;' +
    'if(!hm||typeof hm.setHotkeys!=="function"||typeof hm.getHotkeys!=="function")' +
    'return{ok:false,reason:"no hotkeyManager.setHotkeys"};' +
    'window.__smSavedJumpHotkeys=window.__smSavedJumpHotkeys||{};' +
    'const enabled=' + JSON.stringify(on) + ';' +
    'for(let i=0;i<ids.length;i+=1){const id=ids[i];' +
    'if(enabled){const restored=window.__smSavedJumpHotkeys[id];hm.setHotkeys(id,restored&&restored.length?restored:[keys[i]]);}' +
    'else{try{window.__smSavedJumpHotkeys[id]=hm.getHotkeys(id)||[];}catch(_){window.__smSavedJumpHotkeys[id]=[];}hm.setHotkeys(id,[]);}}' +
    'if(typeof hm.bake==="function")hm.bake();' +
    'return{ok:true,enabled:enabled,next:hm.getHotkeys(' + JSON.stringify(NEXT_ID) + ')};})()',
  );
}

function vimBindJumpMapsExpr(enabled) {
  return '(()=>{const V=window.CodeMirrorAdapter&&window.CodeMirrorAdapter.Vim;' +
    'if(!V)return{ok:false,reason:"no CodeMirror Vim"};' +
    'const enabled=' + JSON.stringify(Boolean(enabled)) + ';' +
    'const bind=V.noremap||V.map;' +
    'try{' +
    'if(enabled){if(typeof bind==="function"){bind.call(V,"<C-j>",":bob_next_header<CR>","normal");bind.call(V,"<C-k>",":bob_prev_header<CR>","normal");}}' +
    'else if(typeof V.unmap==="function"){try{V.unmap("<C-j>","normal");}catch(_){}try{V.unmap("<C-k>","normal");}catch(_){}}' +
    'else if(typeof bind==="function"){bind.call(V,"<C-j>","<nop>","normal");bind.call(V,"<C-k>","<nop>","normal");}' +
    'return{ok:true,enabled:enabled,usedNoremap:typeof V.noremap==="function"};}catch(e){return{ok:false,reason:String(e&&e.message||e)};}})()';
}

async function setVimJumpMaps(client, enabled) {
  return client.evaluate(vimBindJumpMapsExpr(enabled));
}

async function emulateVaultVimRoute(client) {
  return client.evaluate(
    '(()=>{const V=window.CodeMirrorAdapter&&window.CodeMirrorAdapter.Vim;' +
    'if(!V||typeof V.defineEx!=="function")return{ok:false,reason:"no CodeMirror Vim defineEx"};' +
    'const next=()=>window.app.commands.executeCommandById(' + JSON.stringify(NEXT_ID) + ');' +
    'const prev=()=>window.app.commands.executeCommandById(' + JSON.stringify(PREV_ID) + ');' +
    'try{' +
    'if(V.defineEx.length>=3){V.defineEx("bob_next_header","",next);V.defineEx("bob_prev_header","",prev);}' +
    'else{V.defineEx("bob_next_header",next);V.defineEx("bob_prev_header",prev);}' +
    '}catch(e){return{ok:false,reason:"defineEx failed: "+(e&&e.message)}}' +
    'const bind=V.noremap||V.map;' +
    'let mapped=false;if(typeof bind==="function"){try{bind.call(V,"<C-j>",":bob_next_header<CR>","normal");bind.call(V,"<C-k>",":bob_prev_header<CR>","normal");mapped=true;}catch(_){mapped=false;}}' +
    'return{ok:true,mapped,defineExArity:V.defineEx.length,usedNoremap:typeof V.noremap==="function",hasHandleKey:typeof V.handleKey==="function",hasHandleEx:typeof V.handleEx==="function"};})()',
  );
}

function vimFireNextHeaderExpr() {
  return '(()=>{const V=window.CodeMirrorAdapter&&window.CodeMirrorAdapter.Vim;' +
    'const view=window.app.workspace.activeLeaf&&window.app.workspace.activeLeaf.view;' +
    'const editor=view&&view.editor;' +
    'if(!V||!editor)return{ok:false,reason:"no Vim or editor"};' +
    'const cm=(editor.cm&&editor.cm.cm)||null;' +
    'const vimState=cm&&cm.state&&cm.state.vim;' +
    'const diag={hasHandleKey:typeof V.handleKey==="function",hasHandleEx:typeof V.handleEx==="function",hasFindKey:typeof V.findKey==="function",hasCm5:!!cm,insertMode:!!(vimState&&vimState.insertMode)};' +
    'const cursor=()=>{const c=editor.getCursor();return{line:c.line,ch:c.ch};};' +
    'const moved=(before)=>{const now=cursor();return now.line!==before.line?Object.assign({ok:true},now):null;};' +
    'try{if(cm&&typeof cm.focus==="function")cm.focus();' +
    'const before=cursor();' +
    'if(typeof V.handleKey==="function"&&cm){let result=V.handleKey(cm,"<C-j>","mapping");if(typeof result==="function")result=result();const hit=moved(before);if(hit)return Object.assign(hit,{how:"vim-handleKey",diag});}' +
    'if(typeof V.findKey==="function"&&cm){const beforeFind=cursor();let fn=V.findKey(cm,"<C-j>","mapping");if(typeof fn==="function")fn();const hit=moved(beforeFind);if(hit)return Object.assign(hit,{how:"vim-findKey",diag});}' +
    'if(typeof V.handleEx==="function"&&cm){const beforeEx=cursor();V.handleEx(cm,"bob_next_header");const hit=moved(beforeEx);if(hit)return Object.assign(hit,{how:"vim-handleEx",diag});}' +
    'return Object.assign({ok:true},cursor(),{how:"none",diag});' +
    '}catch(e){return{ok:false,reason:String(e&&e.message||e),diag};}})()';
}

async function jumpByKey(client, direction) {
  await key(client, { key: direction > 0 ? "j" : "k", modifiers: 2, pause: 60 });
}

async function ctrlDown(client) {
  await keyDownOnly(client, { key: "Control", code: "ControlLeft", pause: 40 });
}

async function ctrlUp(client) {
  await keyUpOnly(client, { key: "Control", code: "ControlLeft", pause: 0 });
}

// A faithful tap: Control goes down first and comes up last, exactly like a
// real Ctrl+J press, so the Hold/Linger lifecycle sees the true release.
async function jumpWithCtrl(client, direction) {
  const middle = direction > 0 ? "j" : "k";
  await ctrlDown(client);
  await keyDownOnly(client, { key: middle, modifiers: 2, pause: 60 });
  await keyUpOnly(client, { key: middle, modifiers: 2, pause: 0 });
  await ctrlUp(client);
}

async function routes(client, record, shared) {
  await runCase(record, "routes/hotkey-only insert-mode Ctrl+J lands and paints", async () => {
    const hotkeysOn = await setJumpHotkeys(client, true);
    if (!hotkeysOn || !hotkeysOn.ok) throw new Error("could not restore hotkeys.json route: " + JSON.stringify(hotkeysOn));
    // Insert mode isolates the JSON route: nnoremap <C-j> does not fire there.
    await openNote(client, MAIN, "source"); await caret(client, 1, 0); await insertMode(client);
    await jumpWithCtrl(client, 1);
    const editor = await client.evaluate(EDITOR_PROBE);
    if (!editor.ok || editor.line !== 3) throw new Error("Ctrl+J landed on line " + JSON.stringify(editor) + ", expected 3");
    const map = await mapState(client);
    if (!map.present || map.hidden) throw new Error("card not visible after Ctrl+J: " + JSON.stringify(map));
    const current = map.rows.find((row) => rowLine(row) === 3);
    if (!current || !current.current) throw new Error("current row is not the landed heading: " + JSON.stringify(map.rows.map((r) => r.key)));
    if ((map.counter || "").replace(/\s+/g, " ") !== "2 / 12") throw new Error("counter is " + JSON.stringify(map.counter) + ", expected 2 / 12");
    const ring = map.rows.find((row) => row.ring);
    if (!ring || rowLine(ring) !== 0) throw new Error("from-ring is not on line 0: " + JSON.stringify(map.rows.filter((r) => r.ring)));
    return "hotkeys.json route landed line 3 with current pill, ring on line 0, counter 2 / 12";
  });
  await runCase(record, "routes/hotkey-only insert-mode Ctrl+K returns", async () => {
    await jumpWithCtrl(client, -1);
    const editor = await client.evaluate(EDITOR_PROBE);
    if (!editor.ok || editor.line !== 0) throw new Error("Ctrl+K landed on line " + JSON.stringify(editor) + ", expected 0");
    const map = await mapState(client);
    if (!map.present || map.hidden) throw new Error("card not visible after Ctrl+K");
    return "hotkeys.json route returned to line 0 with the card visible";
  });
  await runCase(record, "routes/vim-only normal-mode Ctrl+J single step", async () => {
    if (!shared.vim || !shared.vim.ok) throw new Error("vault Vim route not emulated: " + JSON.stringify(shared.vim));
    if (!shared.vim.mapped) {
      record("routes/vim-only normal-mode Ctrl+J single step", "skipped", "Vim.map unavailable; ex-command route only");
      return "__skip__";
    }
    const hotkeysOff = await setJumpHotkeys(client, false);
    if (!hotkeysOff || !hotkeysOff.ok) throw new Error("could not clear hotkeys.json route: " + JSON.stringify(hotkeysOff));
    const vimOn = await setVimJumpMaps(client, true);
    if (!vimOn || !vimOn.ok) throw new Error("could not restore Vim maps: " + JSON.stringify(vimOn));
    try {
      await openNote(client, MAIN, "source"); await caret(client, 1, 0); await normalMode(client);
      await sleep(200);
      await jumpWithCtrl(client, 1);
      let editor = await client.evaluate(EDITOR_PROBE);
      let how = "cdp-ctrl-j";
      if (!editor.ok || editor.line !== 3) {
        await caret(client, 1, 0); await normalMode(client);
        const viaEvent = await client.evaluate(
          '(()=>{const el=document.querySelector(".cm-content");if(!el)return{ok:false,reason:"no cm-content"};' +
          'el.dispatchEvent(new KeyboardEvent("keydown",{key:"j",code:"KeyJ",ctrlKey:true,bubbles:true,cancelable:true}));' +
          'const c=window.app.workspace.activeLeaf.view.editor.getCursor();return{ok:true,line:c.line,ch:c.ch};})()',
        );
        if (viaEvent && viaEvent.ok && viaEvent.line === 3) {
          how = "cm-keydown";
          editor = viaEvent;
        }
      }
      if (!editor.ok || editor.line !== 3) {
        await caret(client, 1, 0); await normalMode(client);
        const viaVim = await client.evaluate(vimFireNextHeaderExpr());
        if (viaVim && viaVim.ok && viaVim.line === 3) {
          how = viaVim.how || "vim-handleKey";
          editor = viaVim;
        } else {
          throw new Error("Vim Ctrl+J did not move with hotkeys.json cleared: cdp=" + JSON.stringify(editor) + " vim=" + JSON.stringify(viaVim));
        }
      }
      const map = await mapState(client);
      if (!map.present || map.hidden) throw new Error("card not visible after Vim Ctrl+J via " + how);
      return "Vim route moved exactly one heading via " + how + " (defineEx arity " + shared.vim.defineExArity + ")";
    } finally {
      await setJumpHotkeys(client, true);
      await setVimJumpMaps(client, true);
    }
  });
  await runCase(record, "routes/aria sentence names the section", async () => {
    await openNote(client, MAIN, "source"); await caret(client, 1, 0); await insertMode(client);
    await jumpWithCtrl(client, 1);
    await sleep(700);
    const map = await mapState(client);
    if (!/Section\s+2\s+of\s+12/i.test(map.liveText || "")) {
      throw new Error("aria sentence is " + JSON.stringify(map.liveText) + ", expected Section 2 of 12");
    }
    return JSON.stringify(map.liveText);
  });
}

async function lifecycle(client, record) {
  await runCase(record, "lifecycle/single tap hides about 2.2 s after Ctrl release", async () => {
    await openNote(client, MAIN, "source"); await caret(client, 1, 0); await insertMode(client);
    await ctrlDown(client);
    await keyDownOnly(client, { key: "j", modifiers: 2, pause: 60 });
    await keyUpOnly(client, { key: "j", modifiers: 2, pause: 0 });
    await ctrlUp(client);
    const released = Date.now();
    const shown = await mapState(client);
    if (!shown.present || shown.hidden) throw new Error("card not visible right after the tap");
    const hiddenAt = await waitFor(client, MAP_PROBE, (map) => map.present && map.hidden, "card hidden", 8000).catch(() => null);
    if (!hiddenAt) throw new Error("card never hid after Ctrl release");
    const elapsed = Date.now() - released;
    if (elapsed < 1500 || elapsed > 6000) throw new Error("card hid after " + elapsed + " ms, expected 1500-6000 ms");
    return "visible on tap, hidden " + elapsed + " ms after release";
  });
  await runCase(record, "lifecycle/rapid repeats reuse one card node", async () => {
    await openNote(client, MAIN, "source"); await caret(client, 1, 0); await insertMode(client);
    await ctrlDown(client);
    await keyDownOnly(client, { key: "j", modifiers: 2, pause: 60 });
    await keyUpOnly(client, { key: "j", modifiers: 2, pause: 0 });
    await client.evaluate('window.__smHost=document.querySelector(\'[data-bob-section-map="host"]\')');
    for (const press of [1, 2, 3]) {
      await sleep(150);
      await keyDownOnly(client, { key: "j", modifiers: 2, pause: 60 });
      await keyUpOnly(client, { key: "j", modifiers: 2, pause: 0 });
      const same = await client.evaluate('window.__smHost===document.querySelector(\'[data-bob-section-map="host"]\')');
      if (!same) throw new Error("card node replaced on press " + press);
      const map = await mapState(client);
      if (!map.present || map.hidden) throw new Error("card flickered hidden on press " + press);
    }
    await ctrlUp(client);
    const editor = await client.evaluate(EDITOR_PROBE);
    if (!editor.ok || editor.line !== 9) throw new Error("3 rapid presses landed on " + JSON.stringify(editor) + ", expected line 9");
    return "same host node across 3 presses, landed line 9 with no flicker";
  });
  await runCase(record, "lifecycle/edit dismisses and undo restores bytes", async () => {
    await openNote(client, MAIN, "source"); await caret(client, 1, 0); await insertMode(client);
    await jumpWithCtrl(client, 1);
    await key(client, "x");
    await waitFor(client, MAP_PROBE, (map) => map.present && map.hidden, "card hidden after edit", 3000);
    await normalMode(client);
    await key(client, "u");
    await sleep(200);
    const text = await client.evaluate('window.app.workspace.activeLeaf.view.editor.getValue()');
    if (text !== MAIN_BODY) throw new Error("undo did not restore exact fixture bytes");
    return "edit hid the card; u restored the exact bytes";
  });
  await runCase(record, "lifecycle/j dismisses", async () => {
    await openNote(client, MAIN, "source"); await caret(client, 1, 0); await normalMode(client);
    await client.evaluate("window.app.commands.executeCommandById(" + JSON.stringify(NEXT_ID) + ")");
    await waitFor(client, MAP_PROBE, (map) => map.present && !map.hidden, "card visible before j", 3000);
    await key(client, "j");
    await waitFor(client, MAP_PROBE, (map) => map.present && map.hidden, "card hidden after j", 3000);
    return "normal-mode j hid the card without a prior Escape";
  });
  await runCase(record, "lifecycle/k dismisses", async () => {
    await openNote(client, MAIN, "source"); await caret(client, 1, 0); await normalMode(client);
    await client.evaluate("window.app.commands.executeCommandById(" + JSON.stringify(NEXT_ID) + ")");
    await waitFor(client, MAP_PROBE, (map) => map.present && !map.hidden, "card visible before k", 3000);
    await key(client, "k");
    await waitFor(client, MAP_PROBE, (map) => map.present && map.hidden, "card hidden after k", 3000);
    return "normal-mode k hid the card without a prior Escape";
  });
  await runCase(record, "lifecycle/q keeps Vim macro recording", async () => {
    await openNote(client, MAIN, "source"); await caret(client, 1, 0); await normalMode(client);
    await client.evaluate("window.app.commands.executeCommandById(" + JSON.stringify(PEEK_ID) + ")");
    await waitFor(client, MAP_PROBE, (map) => map.present && !map.hidden, "peek visible before q", 3000);
    await key(client, "q");
    await waitFor(client, MAP_PROBE, (map) => map.present && map.hidden, "card hidden after q", 3000);
    await key(client, "a");
    await key(client, "i");
    for (const letter of ["h", "e", "l", "l", "o"]) await key(client, letter);
    await key(client, "Escape");
    await key(client, "q");
    await key(client, "u");
    await sleep(150);
    const before = await client.evaluate("window.app.workspace.activeLeaf.view.editor.getValue()");
    await key(client, "@");
    await key(client, "a");
    await sleep(250);
    const after = await client.evaluate("window.app.workspace.activeLeaf.view.editor.getValue()");
    if (after === before || !/hello/.test(after)) {
      throw new Error("q did not record a Vim macro: " + JSON.stringify({ before, after }).slice(0, 240));
    }
    await key(client, "u");
    return "q dismissed the map and still recorded register a";
  });
  await runCase(record, "lifecycle/Esc dismisses and keeps Vim work", async () => {
    await openNote(client, MAIN, "source"); await caret(client, 1, 0); await insertMode(client);
    await jumpWithCtrl(client, 1);
    const before = await client.evaluate(EDITOR_PROBE);
    await key(client, "Escape");
    await waitFor(client, MAP_PROBE, (map) => map.present && map.hidden, "card hidden after Esc", 3000);
    await key(client, "j");
    await sleep(200);
    const after = await client.evaluate(EDITOR_PROBE);
    if (!after.ok || after.line !== before.line + 1) {
      throw new Error("Esc did not leave Vim normal mode: " + JSON.stringify({ before, after }));
    }
    return "Esc hid the card and j moved down one line";
  });
  await runCase(record, "lifecycle/click dismisses", async () => {
    await openNote(client, MAIN, "source"); await caret(client, 1, 0); await insertMode(client);
    await jumpWithCtrl(client, 1);
    const point = await client.evaluate(
      '(()=>{const r=document.querySelector(".cm-content").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height-60};})()',
    );
    await client.call("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
    await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
    await waitFor(client, MAP_PROBE, (map) => map.present && map.hidden, "card hidden after click", 3000);
    return "pointerdown hid the card";
  });
  await runCase(record, "lifecycle/wheel scroll does not dismiss", async () => {
    await openNote(client, MAIN, "source"); await caret(client, 1, 0); await insertMode(client);
    await jumpWithCtrl(client, 1);
    const point = await client.evaluate(
      '(()=>{const r=document.querySelector(".cm-content").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()',
    );
    await client.call("Input.dispatchMouseEvent", { type: "mouseWheel", x: point.x, y: point.y, deltaX: 0, deltaY: 200 });
    await sleep(500);
    const map = await mapState(client);
    if (!map.present || map.hidden) throw new Error("wheel scroll dismissed the card");
    return "card survived a wheel scroll";
  });
  await runCase(record, "lifecycle/pane switch dismisses", async () => {
    await openNote(client, MAIN, "source"); await caret(client, 1, 0); await insertMode(client);
    await jumpWithCtrl(client, 1);
    await client.evaluate(
      '(() => (async()=>{const f=window.app.vault.getAbstractFileByPath(' + JSON.stringify(OTHER) +
      '),w=window.app.workspace,l=w.getLeaf("tab");await l.openFile(f);w.setActiveLeaf(l,{focus:true});return true;})())()',
      RPC_TIMEOUT_MS,
    );
    await waitFor(client, '(!document.querySelector(\'[data-bob-section-map="host"]:not(.is-hidden)\'))', Boolean, "no visible card", 5000);
    return "no visible card after switching panes";
  });
  await runCase(record, "lifecycle/pop-out key dismisses", async () => {
    const popout = await client.evaluate(
      '(() => (async()=>{const w=window.app.workspace;' +
      'if(!w||typeof w.openPopoutLeaf!=="function")return{ok:false,reason:"no openPopoutLeaf"};' +
      'const f=window.app.vault.getAbstractFileByPath(' + JSON.stringify(MAIN) + ');' +
      'if(!f)return{ok:false,reason:"missing fixture"};' +
      'const leaf=w.openPopoutLeaf();' +
      'await leaf.openFile(f,{state:{mode:"source",source:true}});' +
      'await new Promise((r)=>setTimeout(r,800));' +
      'w.setActiveLeaf(leaf,{focus:true});' +
      'const view=leaf.view;if(view&&view.editor&&view.editor.focus)view.editor.focus();' +
      'window.__smPopoutLeaf=leaf;' +
      'const doc=(leaf.containerEl&&leaf.containerEl.ownerDocument)||(view&&view.contentEl&&view.contentEl.ownerDocument);' +
      'return{ok:true,sameDoc:doc===document,hasEditor:!!(view&&view.editor)};})())()',
      RPC_TIMEOUT_MS,
    ).catch((error) => ({ ok: false, reason: String(error && error.message || error) }));
    if (!popout || !popout.ok) {
      record("lifecycle/pop-out key dismisses", "skipped", popout && popout.reason || "openPopoutLeaf unavailable");
      return "__skip__";
    }
    await caret(client, 1, 0);
    await client.evaluate("window.app.commands.executeCommandById(" + JSON.stringify(NEXT_ID) + ")");
    await sleep(400);
    const dismissed = await client.evaluate(
      '(()=>{const leaf=window.__smPopoutLeaf;const view=leaf&&leaf.view;' +
      'const doc=(leaf&&leaf.containerEl&&leaf.containerEl.ownerDocument)||(view&&view.contentEl&&view.contentEl.ownerDocument);' +
      'if(!doc||!doc.defaultView)return{ok:false,reason:"no popout document"};' +
      'const host=doc.querySelector(\'[data-bob-section-map="host"]\');' +
      'if(!host||host.classList.contains("is-hidden"))return{ok:false,reason:"map missing in popout"};' +
      'doc.defaultView.dispatchEvent(new doc.defaultView.KeyboardEvent("keydown",{key:"Escape",bubbles:true}));' +
      'return{ok:true};})()',
    );
    if (!dismissed || !dismissed.ok) throw new Error("pop-out map not shown: " + JSON.stringify(dismissed));
    const hidden = await waitFor(
      client,
      '(()=>{const leaf=window.__smPopoutLeaf;const view=leaf&&leaf.view;' +
      'const doc=(leaf&&leaf.containerEl&&leaf.containerEl.ownerDocument)||(view&&view.contentEl&&view.contentEl.ownerDocument);' +
      'const host=doc&&doc.querySelector(\'[data-bob-section-map="host"]\');' +
      'return{present:!!host,hidden:!host||host.classList.contains("is-hidden")};})()',
      (map) => map.present && map.hidden,
      "pop-out card hidden after Escape",
      3000,
    );
    await client.evaluate(
      '(()=>{const leaf=window.__smPopoutLeaf;try{if(leaf&&typeof leaf.detach==="function")leaf.detach();}catch(_){}' +
      'const w=window.app.workspace;const main=(w.getLeavesOfType&&w.getLeavesOfType("markdown")||[]).find((item)=>item&&item!==leaf);' +
      'if(main)w.setActiveLeaf(main,{focus:true});window.__smPopoutLeaf=null;return true;})()',
    );
    await sleep(400);
    return "pop-out Escape hid the card (" + JSON.stringify(hidden) + ")";
  });
}

async function setTheme(client, name) {
  await client.evaluate(
    '(()=>{const dark=' + JSON.stringify(name === "dark") + ';document.body.classList.toggle("theme-dark",dark);document.body.classList.toggle("theme-light",!dark);return true;})()',
  );
  await sleep(300);
}

async function screenshot(client, outDir, label, theme) {
  await setTheme(client, theme);
  const image = await client.call("Page.captureScreenshot", { format: "png", fromSurface: true });
  const file = path.join(outDir, label + "-" + theme + ".png");
  fs.writeFileSync(file, Buffer.from(image.data, "base64"));
  return file;
}

async function content(client, record, outDir, shared) {
  await runCase(record, "content/wrap shows the wrapped pill", async () => {
    await openNote(client, WRAP, "source"); await caret(client, 4, 0); await insertMode(client);
    await jumpWithCtrl(client, 1);
    const editor = await client.evaluate(EDITOR_PROBE);
    if (!editor.ok || editor.line !== 0) throw new Error("wrap did not land on line 0: " + JSON.stringify(editor));
    const map = await mapState(client);
    if (!map.present || map.hidden) throw new Error("card not visible after wrap");
    if (map.wrapHidden || !/wrapped/.test(map.wrapText || "")) {
      throw new Error("no wrapped pill: " + JSON.stringify({ wrapHidden: map.wrapHidden, wrapText: map.wrapText }));
    }
    if ((map.counter || "").replace(/\s+/g, " ") !== "1 / 3") {
      throw new Error("counter is " + JSON.stringify(map.counter) + ", expected 1 / 3");
    }
    await screenshot(client, outDir, "wrap", "dark");
    return "wrapped to line 0 with pill and counter 1 / 3";
  });
  await runCase(record, "content/each chip lands where the next press lands", async () => {
    await openNote(client, MAIN, "source"); await caret(client, 1, 0); await insertMode(client);
    await jumpWithCtrl(client, 1);
    let map = await mapState(client);
    const downRow = map.rows.find((row) => chipDirections(row).includes(1));
    if (!downRow || rowLine(downRow) == null) throw new Error("no down-chip row: " + JSON.stringify(map.rows));
    await jumpWithCtrl(client, 1);
    let editor = await client.evaluate(EDITOR_PROBE);
    if (!editor.ok || editor.line !== rowLine(downRow)) {
      throw new Error("Ctrl+J landed on " + JSON.stringify(editor) + ", chip pointed at line " + rowLine(downRow));
    }
    map = await mapState(client);
    const upRow = map.rows.find((row) => chipDirections(row).includes(-1));
    if (!upRow || rowLine(upRow) == null) throw new Error("no up-chip row: " + JSON.stringify(map.rows));
    await jumpWithCtrl(client, -1);
    editor = await client.evaluate(EDITOR_PROBE);
    if (!editor.ok || editor.line !== rowLine(upRow)) {
      throw new Error("Ctrl+K landed on " + JSON.stringify(editor) + ", chip pointed at line " + rowLine(upRow));
    }
    await screenshot(client, outDir, "jump-card", "light");
    await screenshot(client, outDir, "jump-card", "dark");
    return "down chip landed line " + rowLine(downRow) + ", up chip landed line " + rowLine(upRow);
  });
  await runCase(record, "content/42 headings window with exact gap counts", async () => {
    await openNote(client, WIND, "source"); await caret(client, 1, 0);
    await client.evaluate('window.app.commands.executeCommandById(' + JSON.stringify(PEEK_ID) + ')');
    await sleep(500);
    const map = await mapState(client);
    if (!map.present || map.hidden) throw new Error("card not visible for the 42-heading peek");
    const shown = map.rows.filter((row) => rowLine(row) != null).length;
    const gapTotal = map.gaps.map(gapCount);
    if (gapTotal.some((count) => count == null)) throw new Error("unparsable gap rows: " + JSON.stringify(map.gaps));
    if (shown + gapTotal.reduce((a, b) => a + b, 0) !== 42) {
      throw new Error("window coverage is " + shown + " rows + gaps " + JSON.stringify(gapTotal) + ", expected 42");
    }
    const dirs = new Set(map.rows.flatMap(chipDirections));
    if (!dirs.has(1) || !dirs.has(-1)) throw new Error("both chips not visible in the window: " + JSON.stringify(map.rows));
    if (!/Section\s+1\s+of\s+42/i.test(map.liveText || "")) {
      throw new Error("aria sentence is " + JSON.stringify(map.liveText) + ", expected Section 1 of 42");
    }
    await screenshot(client, outDir, "windowed-42", "dark");
    return shown + " rows + gaps " + JSON.stringify(gapTotal) + " = 42, both chips visible";
  });
  await runCase(record, "content/margin mode with readable line length", async () => {
    await openNote(client, MAIN, "source"); await caret(client, 1, 0); await insertMode(client);
    await jumpWithCtrl(client, 1);
    const map = await mapState(client);
    if (!map.present || map.hidden) throw new Error("card not visible");
    if (map.mode !== "margin") throw new Error("placement mode is " + map.mode + ", expected margin");
    return "margin mode with readable line length on";
  });
  await runCase(record, "content/only section state", async () => {
    await openNote(client, SINGLE, "source"); await caret(client, 2, 0);
    await client.evaluate('window.app.commands.executeCommandById(' + JSON.stringify(PEEK_ID) + ')');
    await sleep(500);
    const map = await mapState(client);
    if (!map.present || map.hidden) throw new Error("card not visible for the single-heading peek");
    if ((map.counter || "").replace(/\s+/g, " ") !== "1 / 1") {
      throw new Error("counter is " + JSON.stringify(map.counter) + ", expected 1 / 1");
    }
    if (map.wrapHidden || !/only section/.test(map.wrapText || "")) {
      throw new Error("no only-section mark: " + JSON.stringify({ wrapHidden: map.wrapHidden, wrapText: map.wrapText }));
    }
    if (map.rows.some((row) => (row.chips || []).length)) throw new Error("single heading shows chips");
    await screenshot(client, outDir, "only-section", "light");
    return "counter 1 / 1 with only-section mark and no chips";
  });
  await runCase(record, "content/long current label stays in pane", async () => {
    await openNote(client, LONG, "source"); await caret(client, 0, 0); await insertMode(client);
    await client.evaluate("window.app.commands.executeCommandById(" + JSON.stringify(PEEK_ID) + ")");
    await sleep(400);
    const geom = await client.evaluate(
      '(()=>{const host=document.querySelector(\'[data-bob-section-map="host"]\');' +
      'const card=host&&host.querySelector(\'[data-bob-section-map="card"]\');' +
      'const pane=window.app.workspace.activeLeaf.view.contentEl;' +
      'const current=host&&host.querySelector(".bob-section-map-row.is-current");' +
      'if(!host||!card||!pane||!current)return{ok:false};' +
      'const pr=pane.getBoundingClientRect();const cr=card.getBoundingClientRect();const rr=current.getBoundingClientRect();' +
      'return{ok:true,fits:cr.top>=pr.top-1&&cr.bottom<=pr.bottom+1&&cr.left>=pr.left-1&&cr.right<=pr.right+1,' +
      'currentVisible:rr.height>0&&rr.bottom<=pr.bottom+1,rowHeight:rr.height,label:(current.querySelector(\'[data-bob-section-map="label"]\')||{}).textContent||""};})()',
    );
    if (!geom || !geom.ok) throw new Error("long-label card missing");
    if (!geom.fits) throw new Error("long-label card escapes the pane: " + JSON.stringify(geom));
    if (!geom.currentVisible) throw new Error("long-label current row is not visible");
    if (geom.rowHeight < 24) throw new Error("long-label current row is " + geom.rowHeight + "px");
    await screenshot(client, outDir, "long-label", "light");
    return "long current label visible, row " + geom.rowHeight + "px";
  });
  await runCase(record, "content/reduced-motion wrap has a still badge", async () => {
    await client.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    try {
      await openNote(client, WRAP, "source"); await caret(client, 4, 0); await insertMode(client);
      await jumpWithCtrl(client, 1);
      const map = await mapState(client);
      if (!map.present || map.hidden) throw new Error("card not visible after wrap");
      if (map.wrapHidden || !/wrapped/.test(map.wrapText || "")) {
        throw new Error("no wrapped pill: " + JSON.stringify({ wrapHidden: map.wrapHidden, wrapText: map.wrapText }));
      }
      const animation = await client.evaluate(
        '(()=>{const wrap=document.querySelector(".bob-section-map-wrap");' +
        'if(!wrap)return null;return getComputedStyle(wrap).animationName;})()',
      );
      if (animation && animation !== "none") {
        throw new Error("wrap badge animation is " + JSON.stringify(animation));
      }
      await screenshot(client, outDir, "wrap-reduced", "dark");
      return "wrap badge animation-name=" + JSON.stringify(animation);
    } finally {
      await client.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
    }
  });
  await runCase(record, "content/short horizontal split keeps the current row", async () => {
    await client.evaluate(
      '(() => (async()=>{const f=window.app.vault.getAbstractFileByPath(' + JSON.stringify(WIND) +
      ');const w=window.app.workspace;' +
      'const l=w.getLeaf("split","horizontal");await l.openFile(f,{state:{mode:"source",source:true}});' +
      'w.setActiveLeaf(l,{focus:true});' +
      'await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));' +
      'if(l.view&&l.view.editor&&l.view.editor.focus)l.view.editor.focus();' +
      'const pane=l.view&&l.view.contentEl;const r=pane&&pane.getBoundingClientRect();' +
      'window.__smShortLeaf=l;return{ok:true,height:r?r.height:null};})())()',
      RPC_TIMEOUT_MS,
    );
    await sleep(400);
    await caret(client, 41, 0);
    await client.evaluate("window.app.commands.executeCommandById(" + JSON.stringify(PEEK_ID) + ")");
    await sleep(400);
    const geom = await client.evaluate(
      '(()=>{const host=document.querySelector(\'[data-bob-section-map="host"]\');' +
      'const card=host&&host.querySelector(\'[data-bob-section-map="card"]\');' +
      'const pane=window.app.workspace.activeLeaf.view.contentEl;' +
      'const current=host&&host.querySelector(".bob-section-map-row.is-current,.bob-section-map-compact:not(.is-hidden)");' +
      'if(!host||!card||!pane)return{ok:false};' +
      'const pr=pane.getBoundingClientRect();const cr=card.getBoundingClientRect();' +
      'return{ok:true,paneH:pr.height,cardH:cr.height,fits:cr.top>=pr.top-1&&cr.bottom<=pr.bottom+1,' +
      'currentVisible:!!current,mode:card.classList.contains("is-compact")?"compact":card.classList.contains("is-margin")?"margin":"overlay"};})()',
    );
    if (!geom || !geom.ok) throw new Error("short-split card missing");
    if (!geom.fits) throw new Error("short-split card escapes the pane: " + JSON.stringify(geom));
    if (!geom.currentVisible) throw new Error("short-split current landmark missing: " + JSON.stringify(geom));
    await screenshot(client, outDir, "short-split", "light");
    return "pane " + geom.paneH + "px, card " + geom.cardH + "px, mode " + geom.mode;
  });
  // This case runs last in the content group: it leaves two extra vertical
  // splits behind so the jumping pane is narrow, with no CDP window resize.
  await runCase(record, "content/narrow split shows the compact strip", async () => {
    await client.evaluate(
      '(() => (async()=>{const f=window.app.vault.getAbstractFileByPath(' + JSON.stringify(MAIN) +
      ');const w=window.app.workspace;const leaves=[];' +
      'for(let i=0;i<2;i+=1){const l=w.getLeaf("split","vertical");await l.openFile(f,{state:{mode:"source",source:true}});leaves.push(l);}' +
      'const l=leaves[leaves.length-1];w.setActiveLeaf(l,{focus:true});' +
      'await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));' +
      'if(l.view&&l.view.editor&&l.view.editor.focus)l.view.editor.focus();return true;})())()',
      RPC_TIMEOUT_MS,
    );
    await sleep(500);
    await caret(client, 1, 0); await insertMode(client);
    await jumpWithCtrl(client, 1);
    const map = await mapState(client);
    if (!map.present || map.hidden) throw new Error("card not visible in the narrow split");
    if (map.mode !== "compact") throw new Error("placement mode is " + map.mode + ", expected compact");
    if (map.stripHidden) throw new Error("compact strip hidden in compact mode");
    await screenshot(client, outDir, "compact-strip", "light");
    return "one-line strip docked in a narrow split";
  });
}

async function peek(client, record, outDir) {
  await runCase(record, "peek/never moves the cursor and stays pinned", async () => {
    await openNote(client, MAIN, "source"); await caret(client, 4, 0);
    const before = await client.evaluate(EDITOR_PROBE);
    await client.evaluate('window.app.commands.executeCommandById(' + JSON.stringify(PEEK_ID) + ')');
    await sleep(400);
    const after = await client.evaluate(EDITOR_PROBE);
    if (!after.ok || after.line !== before.line || after.ch !== before.ch) {
      throw new Error("peek moved the cursor: " + JSON.stringify({ before, after }));
    }
    const map = await mapState(client);
    if (!map.present || map.hidden) throw new Error("peek card not visible");
    await sleep(2600);
    const pinned = await mapState(client);
    if (!pinned.present || pinned.hidden) throw new Error("pinned peek hid during the linger window");
    await screenshot(client, outDir, "peek", "dark");
    await key(client, "Escape");
    await waitFor(client, MAP_PROBE, (state) => state.present && state.hidden, "peek hidden after Esc", 3000);
    return "cursor untouched, pinned past 2.6 s, Esc dismissed";
  });
  await runCase(record, "peek/empty note keeps the exact notice", async () => {
    await openNote(client, EMPTY, "source"); await caret(client, 0, 0);
    await client.evaluate('(()=>{window.__smNotices=[];const o=new MutationObserver((rs)=>{for(const r of rs){const t=String((r.target&&(r.target.textContent||r.target.nodeValue))||"");if(/no section headers/i.test(t)&&!window.__smNotices.includes(t))window.__smNotices.push(t);}});o.observe(document.body,{subtree:true,childList:true,characterData:true});window.__smNoticeObserver=o;return true;})()');
    await client.evaluate('window.app.commands.executeCommandById(' + JSON.stringify(PEEK_ID) + ')');
    await sleep(400);
    const seen = await client.evaluate('(()=>{if(window.__smNoticeObserver)window.__smNoticeObserver.disconnect();return window.__smNotices||[];})()');
    if (!seen.length) throw new Error("No section headers notice not observed");
    const map = await mapState(client);
    if (map.present && !map.hidden) throw new Error("card painted for an empty note");
    return "Notice kept: " + JSON.stringify(seen[0]).slice(0, 80);
  });
}

async function safety(client, record, outDir, shared) {
  await runCase(record, "safety/note bytes unchanged", async () => {
    const now = fixtureHashes(shared.vault);
    const mismatched = Object.keys(shared.hashes).filter((file) => shared.hashes[file] !== now[file]);
    if (mismatched.length) throw new Error("note bytes changed: " + mismatched.join(", "));
    return "sha256 identical for all " + Object.keys(shared.hashes).length + " fixture notes";
  });
  await runCase(record, "safety/no console exceptions", async () => {
    if (shared.consoleExceptions.length) {
      throw new Error("console exceptions: " + JSON.stringify(shared.consoleExceptions.slice(0, 3)));
    }
    const pluginErrors = (shared.consoleErrors || []).filter((entry) =>
      /section-map|section_map|bob-navigation-hotkeys/i.test((entry.text || "") + " " + (entry.url || "")));
    if (pluginErrors.length) throw new Error("plugin console errors: " + JSON.stringify(pluginErrors.slice(0, 3)));
    return "0 exceptions, " + (shared.consoleErrors || []).length + " unrelated console errors reported";
  });
}

function selfTest() {
  const parsed = parseArgs(["--self-test", "--only", "routes", "--report", "/tmp/sm.json"]);
  if (!parsed.selfTest || parsed.only !== "routes") throw new Error("argument parsing failed");
  if (MAIN_HEADINGS.length !== 12) throw new Error("MAIN fixture needs 12 headings, has " + MAIN_HEADINGS.length);
  if (JSON.stringify(MAIN_HEADINGS) !== JSON.stringify([0, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23])) {
    throw new Error("MAIN heading lines moved: " + JSON.stringify(MAIN_HEADINGS));
  }
  if (WIND_HEADINGS.length !== 42) throw new Error("WIND fixture needs 42 headings, has " + WIND_HEADINGS.length);
  if (rowLine({ key: "sm:12" }) !== 12 || rowLine({ key: "sm:gap:2:8" }) !== null) throw new Error("rowLine key parsing broken");
  if (JSON.stringify(chipDirections({ chips: [{ text: "⌃K" }, { text: "⌃J" }] })) !== "[-1,1]") {
    throw new Error("chip direction reading broken");
  }
  if (gapCount("⋯ 5 more") !== 5) throw new Error("gap count parsing broken");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bob-section-map-e2e-self-"));
  try {
    const built = buildFixture(temp, path.join(temp, "profile"));
    if (!built.enabled.includes("bob-navigation-hotkeys")) throw new Error("scratch vault does not enable the navigation plugin");
    const hotkeys = JSON.parse(fs.readFileSync(path.join(temp, ".obsidian", "hotkeys.json"), "utf8"));
    for (const [id, key] of [[NEXT_ID, "J"], [PREV_ID, "K"]]) {
      const binding = hotkeys[id] && hotkeys[id][0];
      if (!binding || binding.key !== key || !(binding.modifiers || []).includes("Ctrl")) {
        throw new Error("hotkeys.json route missing for " + id);
      }
    }
    const app = JSON.parse(fs.readFileSync(path.join(temp, ".obsidian", "app.json"), "utf8"));
    if (app.vimMode !== true || app.readableLineLength !== true) throw new Error("fixture settings missing Vim or readable line length");
    if (fixtureHashes(temp)[WIND] !== crypto.createHash("sha256").update(WIND_BODY).digest("hex")) {
      throw new Error("fixture hash helper broken");
    }
    const source = fs.readFileSync(__filename, "utf8");
    for (const token of ["defineEx", "Vim.map", "noremap", "handleKey", "handleEx", "executeCommandById", PEEK_ID, "getLeaf", "mouseWheel", "Page.captureScreenshot", "Runtime.exceptionThrown", "Runtime.consoleAPICalled", "wrapped", "only section", "data-bob-section-map", "setHotkeys", "getHotkeys", "openPopoutLeaf", "prefers-reduced-motion", "horizontal"]) {
      if (!source.includes(token)) throw new Error("e2e is missing " + token);
    }
    if (!source.includes("⋯")) throw new Error("e2e is missing the gap glyph");
    console.log("offline self-test complete (not an Obsidian pass)");
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
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

async function runE2e(args) {
  const executable = findExecutable(args.executable);
  const probe = probeExecutable(executable);
  if (!probe.ok) fail("unrun: " + probe.reason, 2);
  if (!process.env.DISPLAY && !process.env.XVFB_RUN_TMPDIR) fail("unrun: run under xvfb-run -a", 2);
  // Peek runs before content: content's last case leaves narrow splits
  // behind (for the compact strip), and the peek screenshots want the full
  // card in a wide pane.
  const groups = ["routes", "lifecycle", "peek", "content", "safety"];
  if (args.only && !groups.includes(args.only)) fail("--only must be one of " + groups.join(", "), 2);
  const outDir = args.out ? path.resolve(args.out) : fs.mkdtempSync(path.join(os.tmpdir(), "bob-section-map-shots-"));
  fs.mkdirSync(outDir, { recursive: true });
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bob-section-map-e2e-"));
  const vault = path.join(runRoot, "vault");
  const profile = path.join(runRoot, "profile");
  const fixture = buildFixture(vault, profile);
  const fixturePath = fs.realpathSync(vault);
  const shared = {
    vault, port: null, wsUrl: null, vim: null,
    hashes: fixtureHashes(vault),
    consoleExceptions: [], consoleErrors: [],
  };
  const port = await freePort();
  shared.port = port;
  const child = spawn(executable, [
    "--no-sandbox", "--user-data-dir=" + profile, "--remote-debugging-port=" + port,
    "--remote-allow-origins=http://127.0.0.1/*", fixturePath,
  ], {
    cwd: fixturePath,
    env: (() => { const env = { ...process.env, BOB_DIR: fixturePath, TMPDIR: os.tmpdir() }; delete env.ELECTRON_RUN_AS_NODE; return env; })(),
    stdio: "ignore",
  });
  let exited = false;
  child.once("exit", () => { exited = true; });
  let client = null;
  const cases = [];
  const record = (name, status, detail) => {
    cases.push({ name, status, detail: detail || "" });
    if (status === "pass") console.log("PASS " + name + (detail ? " (" + detail + ")" : ""));
    else if (status === "skipped") console.log("SKIP " + name + ": " + detail);
    else console.error("FAIL " + name + ": " + detail);
  };
  const report = {
    executable, fixture: fixturePath,
    sourceSha: spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim(),
    sourceContentSha256: Object.fromEntries([
      "plugins/bob-navigation-hotkeys/main.js",
      "plugins/bob-navigation-hotkeys/manifest.json",
      "scripts/obsidian-section-map-e2e.cjs",
      "scripts/test-obsidian-section-map-e2e.cjs",
    ].map((relative) => [relative, crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, relative))).digest("hex")])),
    expectedPlugins: expectedPlugins(), vimRoute: null, cases, skipped: [], screenshots: [],
    consoleExceptions: shared.consoleExceptions, consoleErrors: shared.consoleErrors, pass: false,
  };
  try {
    const target = await selectTarget(port, fixturePath, () => exited);
    shared.wsUrl = target.webSocketDebuggerUrl;
    client = await Cdp.connect(target.webSocketDebuggerUrl, lib.CONNECT_TIMEOUT_MS);
    await client.call("Page.enable", {}); await client.call("Runtime.enable", {}); await client.call("Log.enable", {});
    client.on("Runtime.exceptionThrown", (row) => {
      shared.consoleExceptions.push((row.exceptionDetails && row.exceptionDetails.text) || "runtime exception");
    });
    client.on("Runtime.consoleAPICalled", (row) => {
      if (row.type !== "error") return;
      const text = (row.args || []).map((arg) => arg.value !== undefined ? arg.value : (arg.description || "")).filter(Boolean).join(" ");
      shared.consoleErrors.push({ text: text || "console.error", url: (row.stackTrace && row.stackTrace.callFrames && row.stackTrace.callFrames[0] && row.stackTrace.callFrames[0].url) || null });
    });
    await waitFor(client, "Boolean(window.app&&window.app.workspace&&window.app.workspace.layoutReady)", Boolean, "layout-ready", lib.LAYOUT_READY_TIMEOUT_MS);
    await dismissTrust(client);
    await waitFor(client,
      'Boolean(window.app.plugins.plugins&&window.app.plugins.plugins["bob-navigation-hotkeys"])',
      Boolean, "navigation plugin", 30_000);
    await sleep(1000);
    report.appVersion = await client.evaluate("window.app.version||null").catch(() => null);
    await client.evaluate(
      '(()=>{try{if(window.app.workspace.leftSplit)window.app.workspace.leftSplit.collapse();}catch(_){}' +
      'try{if(window.app.workspace.rightSplit)window.app.workspace.rightSplit.collapse();}catch(_){}return true;})()',
    );
    await sleep(500);
    // Margin placement needs a wide pane: maximize the owned window so the
    // stock 700 px readable column leaves a real right gutter.
    await client.evaluate(
      '(()=>{try{window.moveTo(0,0);window.resizeTo(window.screen.availWidth,window.screen.availHeight);}catch(_){}return true;})()',
    );
    await sleep(800);
    report.window = await client.evaluate('({innerW:window.innerWidth,innerH:window.innerHeight})').catch(() => null);
    shared.vim = await emulateVaultVimRoute(client);
    report.vimRoute = {
      emulated: Boolean(shared.vim && shared.vim.ok),
      mapped: Boolean(shared.vim && shared.vim.mapped),
      note: "scratch vault has no vimrc-support; the vault exmap+nnoremap pair is emulated via CodeMirror Vim defineEx+map",
      detail: shared.vim,
    };
    record("routes/vim-route-emulation", shared.vim && shared.vim.ok ? "pass" : "fail", JSON.stringify(shared.vim));
    if (!shared.vim || !shared.vim.ok) throw new Error("vault Vim route could not be emulated: " + JSON.stringify(shared.vim));
    const runners = {
      routes: () => routes(client, record, shared),
      lifecycle: () => lifecycle(client, record),
      content: () => content(client, record, outDir, shared),
      peek: () => peek(client, record, outDir),
      safety: () => safety(client, record, outDir, shared),
    };
    for (const group of args.only ? [args.only] : groups) await runners[group]();
    report.skipped = cases.filter((item) => item.status === "skipped");
    report.screenshots = fs.readdirSync(outDir).filter((name) => name.endsWith(".png")).map((name) => path.join(outDir, name));
    report.pass = cases.every((item) => item.status === "pass" || item.status === "skipped");
    report.out = outDir;
    if (args.report) {
      fs.mkdirSync(path.dirname(path.resolve(args.report)), { recursive: true });
      fs.writeFileSync(args.report, JSON.stringify(report, null, 2));
    }
    console.log(JSON.stringify({
      pass: report.pass,
      failed: cases.filter((x) => x.status === "fail").map((x) => x.name),
      skipped: report.skipped,
      screenshots: report.screenshots,
      out: outDir,
    }, null, 2));
    if (!report.pass) fail("e2e failed: " + cases.filter((x) => x.status === "fail").map((x) => x.name).join(", "), 1);
  } finally {
    if (client) client.close();
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
  MAIN_BODY, MAIN_HEADINGS, WIND_BODY, WRAP_BODY, SINGLE_BODY, EMPTY_BODY,
  rowLine, chipDirections, gapCount, parseArgs, buildFixture, fixtureHashes, selfTest,
};

if (require.main === module) {
  main().catch((error) => {
    console.error((error && error.stack) || error);
    process.exitCode = error && error.exitCode ? error.exitCode : 1;
  });
}








