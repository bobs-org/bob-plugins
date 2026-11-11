#!/usr/bin/env node
// Real-Obsidian CDP verification in an owned scratch vault/profile.
"use strict";
const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const lib = require("./obsidian-startup-smoke-lib.cjs");

const ROOT = path.resolve(__dirname, "..");
const FLASH_MS = 200;
const RPC_TIMEOUT_MS = 20_000;
const NOTE = "vim-yank-flash-fixture.md";
const OTHER = "vim-yank-flash-other.md";
const LINES = [
  "# Vim yank flash fixture", "",
  "alpha beta gamma delta", "second alpha line", "third line with tail",
  "fourth line stays here", "- [ ] repeated task row", "- [ ] repeated task row",
  "- [/] tinted task row", "", "after the blank line",
  "outer (inside parenthesized text) end", "emoji 😀pair and UTF-16 characters",
  "tabs\talpha\tbravo and a long line that wraps when the editor is narrow; this sentence keeps going to force several rendered rows in the default Obsidian window; the yank must still cover the exact underlying range across those wraps",
  "# Heading with a [[Link]]", "- list item with [[Link]]",
  "paragraph text for Live Preview", "last fixture line",
];
const BODY = LINES.join("\n");
const HELP = [
  "Usage: node scripts/obsidian-vim-yank-flash-e2e.cjs [OPTIONS]",
  "", "Verify Bob Vim Yank Flash in an isolated real Obsidian vault through CDP.",
  "Never opens the live vault. Run under xvfb-run -a on Linux.", "",
  "  -e, --executable PATH   Obsidian executable (default: /snap/bin/obsidian)",
  "  -h, --help              Print help",
  "  -o, --out DIRECTORY     Screenshot output directory",
  "      --only NAME         Run only a named group",
  "  -r, --report PATH       Write the structured JSON report",
  "  -s, --self-test         Run offline self-tests",
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
  fs.writeFileSync(path.join(vault, NOTE), BODY);
  fs.writeFileSync(path.join(vault, OTHER), "# Other note\n\nA second tab.\n");
  const obsidian = path.join(vault, ".obsidian");
  fs.mkdirSync(path.join(obsidian, "snippets"), { recursive: true });
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
    livePreview: false, vimMode: true, showLineNumber: false, enabledCssSnippets: ["task-statuses"],
  }, null, 2));
  fs.writeFileSync(path.join(obsidian, "appearance.json"), JSON.stringify({
    cssTheme: "", theme: "moonstone", enabledCssSnippets: ["task-statuses"],
  }, null, 2));
  fs.writeFileSync(path.join(obsidian, "snippets", "task-statuses.css"),
    '.markdown-source-view.mod-cm6 .HyperMD-task-line:is([data-task="/"]) { background: rgba(20, 120, 60, 0.55); }\n');
  const profile = profilePath || path.join(vault, "..", "profile");
  const id = crypto.randomBytes(8).toString("hex");
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(profile, "obsidian.json"), JSON.stringify({
    vaults: { [id]: { path: fs.realpathSync(vault), ts: Date.now(), open: true } },
  }, null, 2));
  return { enabled, profile };
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
  if (key === '"') return "Quote";
  return key;
}

async function key(client, input) {
  const spec = typeof input === "string" ? { key: input } : input;
  const modifiers = spec.modifiers || 0;
  const text = Object.prototype.hasOwnProperty.call(spec, "text")
    ? spec.text : (!modifiers && spec.key.length === 1 ? spec.key : spec.key === "Enter" ? "\r" : "");
  const payload = { key: spec.key, code: spec.code || codeFor(spec.key), modifiers, windowsVirtualKeyCode: 0, nativeVirtualKeyCode: 0 };
  if (text) { payload.text = text; payload.unmodifiedText = text; }
  await client.call("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...payload });
  await client.call("Input.dispatchKeyEvent", { type: "keyUp", ...payload });
  if (spec.pause !== 0) await sleep(spec.pause == null ? 24 : spec.pause);
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

function stateFor(mode) { return { mode: "source", source: mode === "source" }; }

async function openNote(client, file, mode) {
  const state = stateFor(mode || "source");
  return client.evaluate(
    '(() => (async()=>{const f=window.app.vault.getAbstractFileByPath(' + JSON.stringify(file) +
    ');if(!f)return{ok:false};const w=window.app.workspace;const l=w.getLeaf(false);await l.openFile(f,{state:' +
    JSON.stringify(state) + '});if(l.view&&l.view.setState)await l.view.setState(' + JSON.stringify(state) +
    ',{history:false});w.setActiveLeaf(l,{focus:true});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));' +
    'const v=l.view;if(v&&v.editor&&v.editor.focus)v.editor.focus();return{ok:!!(v&&v.editor)};})())()',
    RPC_TIMEOUT_MS,
  );
}

async function resetNote(client) {
  await client.evaluate(
    '(() => (async()=>{const w=window.app.workspace,f=window.app.vault.getAbstractFileByPath(' + JSON.stringify(NOTE) +
    '),leaf=w.activeLeaf,view=leaf&&leaf.view;if(view&&view.file&&view.file.path===' + JSON.stringify(NOTE) +
    '&&view.editor){view.editor.setValue(' + JSON.stringify(BODY) + ');if(view.save)await view.save();}else await window.app.vault.modify(f,' + JSON.stringify(BODY) + ');return true;})())()',
    RPC_TIMEOUT_MS,
  );
  await sleep(250);
}

async function caret(client, needle, offset) {
  if (typeof needle === "number") {
    const atLine = await client.evaluate(
      '(()=>{const e=window.app.workspace.activeLeaf.view.editor;const n=' + needle + ';e.setCursor({line:n,ch:' + Number(offset || 0) + '});if(e.focus)e.focus();return{ok:true,line:n};})()',
    );
    if (!atLine || !atLine.ok) throw new Error("could not place caret on line " + needle);
    return atLine;
  }
  const result = await client.evaluate(
    '(()=>{const v=window.app.workspace.activeLeaf.view,e=v&&v.editor;if(!e)return{ok:false};' +
    'const a=String(e.getValue()).split("\\n"),i=a.findIndex(x=>x.includes(' + JSON.stringify(needle) + '));' +
    'if(i<0)return{ok:false,error:"missing line"};const j=a[i].indexOf(' + JSON.stringify(needle) +
    ');const ch=Math.max(0,j+' + Number(offset || 0) + ');e.setCursor({line:i,ch});if(e.focus)e.focus();return{ok:true,line:i,ch};})()',
  );
  if (!result || !result.ok) throw new Error("could not place caret: " + JSON.stringify(result));
  return result;
}

const OBSERVER_START = [
  '(()=>{',
  'const w=window.app&&window.app.workspace,l=w&&w.activeLeaf,root=l&&l.view&&l.view.containerEl&&l.view.containerEl.querySelector(".cm-content");',
  'if(!root)return{ok:false,error:"active .cm-content missing"};',
  'if(window.__bobYankFlashObservation)window.__bobYankFlashObservation.stop();',
  'const e=l&&l.view&&l.view.editor,EditorView=e&&e.cm&&e.cm.constructor,view=EditorView&&EditorView.findFromDOM(root.closest(".cm-editor")),baseline=[];',
  'if(view)for(const range of view.visibleRanges||[]){let line=view.state.doc.lineAt(range.from);while(line.from<=range.to){const el=root.querySelectorAll(".cm-line")[line.number-1];if(el){const s=getComputedStyle(el);baseline.push({number:line.number,text:el.textContent||"",background:s.backgroundColor,boxShadow:s.boxShadow});}if(line.to>=range.to||line.to>=view.state.doc.length)break;line=view.state.doc.lineAt(line.to+1);}}',
  'const records=[],seen=new WeakMap();',
  'const sample=()=>{for(const el of root.querySelectorAll(".bob-yank-flash,.bob-yank-flash-line")){const kind=el.classList.contains("bob-yank-flash-line")?"line":"mark";if(seen.get(el)===kind)continue;seen.set(el,kind);let n=null;try{if(view)n=view.state.doc.lineAt(view.posAtDOM(el)).number;}catch(_){}const s=getComputedStyle(el);records.push({kind,line:n,text:el.textContent||"",background:s.backgroundColor,boxShadow:s.boxShadow,time:performance.now()});}};',
  'let frame=0,stopped=false;const tick=()=>{if(stopped)return;sample();frame=requestAnimationFrame(tick);};',
  'const observer=new MutationObserver(sample);observer.observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:["class"]});frame=requestAnimationFrame(tick);sample();',
  'window.__bobYankFlashObservation={records,baseline,stop(){stopped=true;observer.disconnect();cancelAnimationFrame(frame);},finish(){sample();const remaining=Array.from(root.querySelectorAll(".bob-yank-flash,.bob-yank-flash-line")).map(el=>({kind:el.classList.contains("bob-yank-flash-line")?"line":"mark",text:el.textContent||""}));this.stop();return{records:this.records,baseline:this.baseline,remaining};}};',
  'return{ok:true,baseline};})()',
].join("\n");
const OBSERVER_FINISH = '(()=>{const x=window.__bobYankFlashObservation;return x?x.finish():{records:[],baseline:[],remaining:[],error:"observer missing"};})()';
const EDITOR_STATE = '(()=>{const w=window.app.workspace,v=w.activeLeaf&&w.activeLeaf.view,e=v&&v.editor;if(!e)return{ok:false};' +
  'const rc=window.CodeMirrorAdapter.Vim.getRegisterController(),r=rc.getRegister(\'"\');let text=typeof r==="string"?r:r&&typeof r.toString==="function"?r.toString():r&&typeof r.text==="string"?r.text:r&&Array.isArray(r.text)?r.text.join(r.linewise?"\\n":""):r&&Array.isArray(r.lines)?r.lines.join(r.linewise?"\\n":""):null;' +
  'let raw=null,clipboard=null,foldOffsets=null;try{raw=JSON.stringify(r);}catch(_){raw=String(r);}try{clipboard=require("electron").clipboard.readText();}catch(_){}try{foldOffsets=e.getFoldOffsets();}catch(_){}const c=e.getCursor();return{ok:true,text:e.getValue(),cursor:{line:c.line,ch:c.ch},register:text,registerRaw:raw,clipboard,foldOffsets,path:v.file&&v.file.path||null};})()';

async function observed(client, options) {
  await resetNote(client);
  const opened = await openNote(client, NOTE, options.mode || "source");
  if (!opened || !opened.ok) throw new Error("could not open scratch note");
  await caret(client, options.line == null ? options.needle : options.line, options.offset || 0);
  if (options.beforeKeys) await options.beforeKeys();
  const armed = await client.evaluate(OBSERVER_START);
  if (!armed || !armed.ok) throw new Error("could not arm flash observer: " + JSON.stringify(armed));
  await keys(client, options.keys);
  if (options.afterKeys) await options.afterKeys();
  await sleep(options.waitMs == null ? FLASH_MS + 180 : options.waitMs);
  const observation = await client.evaluate(OBSERVER_FINISH);
  const state = await client.evaluate(EDITOR_STATE);
  return { observation, state };
}

function lineAt(needle) { return LINES.findIndex((line) => line.includes(needle)); }

function assertFlash(result, expected, label) {
  const records = result.observation.records || [];
  const lines = records.filter((x) => x.kind === "line");
  const marks = records.filter((x) => x.kind === "mark");
  if (expected.lines) {
    const visible = new Set((result.observation.baseline || []).map((x) => x.number));
    const want = expected.lines.map((x) => x + 1).filter((x) => visible.has(x)).sort((a, b) => a - b);
    const got = Array.from(new Set(lines.map((x) => x.line))).sort((a, b) => a - b);
    if (!want.length || JSON.stringify(want) !== JSON.stringify(got)) {
      throw new Error(label + ": flashed lines " + JSON.stringify(got) + ", expected visible " + JSON.stringify(want));
    }
  } else if ((expected.minMarks || 0) > marks.length) {
    throw new Error(label + ": observed " + marks.length + " marks, expected at least " + expected.minMarks);
  } else if (!lines.length && !marks.length) throw new Error(label + ": no flash class sampled");
  if (expected.text && !marks.map((x) => x.text).join("\n").includes(expected.text)) {
    throw new Error(label + ": observed marks did not contain " + JSON.stringify(expected.text));
  }
  if (!result.state || !result.state.ok || result.state.register == null) {
    throw new Error(label + ": unnamed register could not be read");
  }
  if ((result.observation.remaining || []).length) throw new Error(label + ": flash remained after timer");
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

async function mustFlash(client, record) {
  const cases = [
    ["yy", "alpha beta", 0, ["y", "y"], { lines: [lineAt("alpha beta")] }],
    ["3yy", "after the blank line", 0, ["3", "y", "y"], { lines: [10, 11, 12] }],
    ["yw", "alpha beta", 0, ["y", "w"], { minMarks: 1 }],
    ["y$", "alpha beta", 6, ["y", "$"], { minMarks: 1 }],
    ["yiw", "alpha beta", 0, ["y", "i", "w"], { minMarks: 1, text: "alpha" }],
    ["yi(", "parenthesized", 0, ["y", "i", "("], { minMarks: 1, text: "inside parenthesized text" }],
    ["yap", "alpha beta", 0, ["y", "a", "p"], { lines: [2, 3, 4, 5, 6, 7, 8, 9] }],
    ["yb", "alpha beta", 15, ["y", "b"], { minMarks: 1 }],
    ["yG", "third line with tail", 0, ["y", "G"], { lines: Array.from({ length: LINES.length - 4 }, (_, i) => i + 4) }],
    ["ygg", "paragraph text", 0, ["y", "g", "g"], { lines: Array.from({ length: 17 }, (_, i) => i) }],
    ["Y", "alpha beta", 0, [{ key: "Y", modifiers: 8, text: "Y" }], { lines: [lineAt("alpha beta")] }],
    ['"ayy', "second alpha", 0, ['"', "a", "y", "y"], { lines: [3] }],
    ['"Ayy', "third line", 0, ['"', { key: "A", modifiers: 8, text: "A" }, "y", "y"], { lines: [4] }],
    ["Vjy", "alpha beta", 0, ["V", "j", "y"], { lines: [lineAt("alpha beta"), lineAt("alpha beta") + 1] }],
    ["vey", "alpha beta", 0, ["v", "e", "y"], { minMarks: 1, text: "alpha" }],
    ["Ctrl-V j l y", "alpha beta", 0, [{ key: "v", modifiers: 2, text: "" }, "j", "l", "y"], { minMarks: 2 }],
    ["blank-line yy", "after the blank line", 0, ["y", "y"], { lines: [9] }],
  ];
  for (const [label, needle, offset, sequence, expected] of cases) {
    await runCase(record, "must-flash/" + label, async () => {
      const result = await observed(client, { needle: label === "blank-line yy" ? undefined : needle, line: label === "blank-line yy" ? 9 : undefined, offset, keys: sequence });
      assertFlash(result, expected, label);
      return "register=" + JSON.stringify(result.state.register);
    });
  }
  await runCase(record, "must-flash/repeated identical yy", async () => {
    await resetNote(client); await openNote(client, NOTE, "source"); await caret(client, "alpha beta", 0);
    const armed = await client.evaluate(OBSERVER_START); if (!armed.ok) throw new Error("observer failed");
    await keys(client, ["y", "y"]); await sleep(150); await keys(client, ["y", "y"]); await sleep(100);
    const live = await client.evaluate('Boolean(document.querySelector(".bob-yank-flash,.bob-yank-flash-line"))');
    if (!live) throw new Error("second yank did not reset the flash timer");
    await sleep(180);
    const remaining = await client.evaluate('document.querySelectorAll(".bob-yank-flash,.bob-yank-flash-line").length');
    const obs = await client.evaluate(OBSERVER_FINISH);
    if (remaining || !obs.records.length) throw new Error("repeated flash did not clear or was not sampled");
    return "second identical yank reset the timer";
  });
}

async function mustNotFlash(client, record) {
  const cases = [
    ["dd", "alpha beta", ["d", "d"]], ["dw", "alpha beta", ["d", "w"]],
    ["cw Escape", "alpha beta", ["c", "w", "Escape"]], ["x", "alpha beta", ["x"]],
    ['"_yy', "alpha beta", ['"', "_", "y", "y"]],
    [":yank", "alpha beta", [{ key: ":", modifiers: 8, text: ":" }, "y", "a", "n", "k", "Enter"]],
    ["fy", "alpha beta", ["f", "y"]], ["ty", "alpha beta", ["t", "y"]],
    ["ry", "alpha beta", ["r", "y"]], ['"yp', "alpha beta", ['"', "y", "p"]],
  ];
  for (const [label, needle, sequence] of cases) {
    await runCase(record, "must-not-flash/" + label, async () => {
      const result = await observed(client, { needle, keys: sequence, waitMs: FLASH_MS + 80 });
      if ((result.observation.records || []).length || (result.observation.remaining || []).length) {
        throw new Error("unexpected flash " + JSON.stringify(result.observation.records));
      }
      return "no flash class";
    });
  }
  await runCase(record, "must-not-flash/ysiw) still surrounds", async () => {
    const result = await observed(client, { needle: "alpha beta", keys: ["y", "s", "i", "w", ")"], waitMs: FLASH_MS + 80 });
    if (result.observation.records.length) throw new Error("surround unexpectedly flashed");
    if (!result.state.text.includes("(alpha)")) throw new Error("Bob Vim Surround did not wrap the word");
    return "surround still works without a flash";
  });
  await runCase(record, "must-not-flash/yank-relative-path command", async () => {
    await resetNote(client); await openNote(client, NOTE, "source"); await caret(client, "alpha beta");
    const armed = await client.evaluate(OBSERVER_START); if (!armed.ok) throw new Error("observer failed");
    const outcome = await client.evaluate(
      '(()=>{const all=window.app.commands.commands||{};const id=Object.keys(all).find(x=>/bob-navigation-hotkeys:yank-relative-path$/.test(x));' +
      'return id?{ok:!!window.app.commands.executeCommandById(id),id}:{ok:false,error:"command missing"};})()',
    );
    if (!outcome.ok) throw new Error("path yank command failed: " + JSON.stringify(outcome));
    await sleep(FLASH_MS + 80);
    const result = await client.evaluate(OBSERVER_FINISH);
    if (result.records.length) throw new Error("path-yank command created a Vim flash");
    return outcome.id + " ran without a flash";
  });
}

async function noticeStart(client) {
  return client.evaluate([
    '(()=>{if(window.__bobNoticeObserver)window.__bobNoticeObserver.disconnect();',
    'const seen=[];const observer=new MutationObserver(rs=>{for(const r of rs){const t=String(r.target&&(r.target.textContent||r.target.nodeValue)||"");',
    'if(/\\d+\\s+lines?\\s+yanked/i.test(t)&&!seen.includes(t))seen.push(t);}});',
    'observer.observe(document.body,{subtree:true,childList:true,characterData:true});',
    'window.__bobNoticeObserver=observer;window.__bobNoticeTexts=seen;return true;})()',
  ].join("\n"));
}
async function noticeRead(client) {
  return client.evaluate('(()=>{if(window.__bobNoticeObserver)window.__bobNoticeObserver.disconnect();return window.__bobNoticeTexts||[];})()');
}

async function togglePlugin(client, enabled) {
  const method = enabled ? "enablePlugin" : "disablePlugin";
  await client.evaluate('(()=>window.app.plugins.' + method + '("bob-vim-yank-flash"))()', RPC_TIMEOUT_MS);
  const state = await waitFor(client,
    'Boolean(window.app.plugins.plugins&&window.app.plugins.plugins["bob-vim-yank-flash"])',
    (value) => Boolean(value) === enabled, enabled ? "plugin enabled" : "plugin disabled", 15_000);
  if (Boolean(state) !== enabled) throw new Error("plugin toggle did not settle");
}

async function behavior(client, record) {
  await runCase(record, "behavior/3yy parity disabled and enabled", async () => {
    const snapshots = {};
    for (const enabled of [false, true]) {
      await togglePlugin(client, enabled);
      await resetNote(client); await openNote(client, NOTE, "source"); await caret(client, "alpha beta");
      await noticeStart(client); await keys(client, ["3", "y", "y"]); await sleep(100);
      snapshots[enabled ? "on" : "off"] = await client.evaluate(EDITOR_STATE);
      snapshots[enabled ? "on" : "off"].notices = await noticeRead(client);
      await sleep(230);
    }
    const a = snapshots.off, b = snapshots.on;
    if (a.text !== b.text || JSON.stringify(a.cursor) !== JSON.stringify(b.cursor) || a.register !== b.register || a.clipboard !== b.clipboard) {
      throw new Error("document, cursor, register, or clipboard differs: " + JSON.stringify({ a, b }));
    }
    const notice = (b.notices || []).join(" ");
    if (!/3\s+lines?\s+yanked/i.test(notice)) throw new Error("3 lines yanked notice not observed: " + JSON.stringify(b.notices));
    const match = notice.match(/\d+\s+lines?\s+yanked/i);
    return "document, cursor, register, clipboard, and notice match (" + (match ? match[0] : notice) + ")";
  });
  for (const paste of ["p", "P"]) {
    await runCase(record, "behavior/yy" + paste, async () => {
      const result = await observed(client, { needle: "alpha beta", keys: ["y", "y", paste], waitMs: FLASH_MS + 80 });
      if (!result.state.text.includes("alpha beta")) throw new Error("yank/paste did not preserve the line");
      if (result.observation.remaining.length) throw new Error("paste left the flash after document change");
      return "paste completed and document change cleared flash";
    });
  }
  await runCase(record, "behavior/undo", async () => {
    await resetNote(client); await openNote(client, NOTE, "source");
    const before = await client.evaluate(EDITOR_STATE); await caret(client, "alpha beta");
    await keys(client, ["x", "u"]);
    const after = await client.evaluate(EDITOR_STATE);
    if (before.text !== after.text) throw new Error("x then u did not restore the document");
    return "undo restored the original text";
  });
  for (const [label, sequence] of [
    ["dot-repeat", ["y", "y", "p", "."]],
    ["macro", ["q", "a", "y", "y", "q", "@", "a"]],
  ]) {
    await runCase(record, "behavior/" + label + " parity disabled and enabled", async () => {
      const snapshots = {};
      const observations = {};
      let stage = "start";
      try {
      for (const enabled of [false, true]) {
        stage = enabled ? "enable plugin" : "disable plugin";
        await togglePlugin(client, enabled);
        stage = "reset fixture";
        await resetNote(client); await openNote(client, NOTE, "source"); await caret(client, "alpha beta");
        stage = "arm observer";
        const armed = await client.evaluate(OBSERVER_START);
        if (!armed.ok) throw new Error("observer failed");
        stage = "dispatch keys " + sequence.join(" ");
        await keys(client, sequence); await sleep(FLASH_MS + 100);
        stage = "read observation";
        observations[enabled ? "on" : "off"] = await client.evaluate(OBSERVER_FINISH);
        stage = "read editor state";
        snapshots[enabled ? "on" : "off"] = await client.evaluate(EDITOR_STATE);
      }
      const off = snapshots.off, on = snapshots.on;
      if (off.text !== on.text || JSON.stringify(off.cursor) !== JSON.stringify(on.cursor) || off.register !== on.register || off.clipboard !== on.clipboard) {
        throw new Error(label + " changed document, cursor, register, or clipboard: " + JSON.stringify({ off, on }));
      }
      if (!(observations.on.records || []).length) throw new Error(label + " did not flash during its yank");
      if ((observations.on.remaining || []).length) throw new Error(label + " left a flash after the wait");
      return "plugin enabled and disabled states match";
      } catch (error) {
        throw new Error(stage + ": " + (error && error.message ? error.message : String(error)));
      }
    });
  }
}

async function lifetime(client, record) {
  await runCase(record, "lifetime/tab switch", async () => {
    await resetNote(client); await openNote(client, NOTE, "source"); await caret(client, "alpha beta");
    const armed = await client.evaluate(OBSERVER_START); if (!armed.ok) throw new Error("observer failed");
    await keys(client, ["y", "y"]);
    await client.evaluate(
      '(()=> (async()=>{const f=window.app.vault.getAbstractFileByPath(' + JSON.stringify(OTHER) +
      '),w=window.app.workspace,l=w.getLeaf("tab");await l.openFile(f,{state:{mode:"source",source:true}});w.setActiveLeaf(l,{focus:true});return true;})())()',
    );
    await sleep(FLASH_MS + 120);
    const remaining = await client.evaluate('document.querySelectorAll(".bob-yank-flash,.bob-yank-flash-line").length');
    if (remaining) throw new Error("flash remained after tab switch");
    return "flash cleared after opening another tab";
  });
  await runCase(record, "lifetime/split pane", async () => {
    const state = await client.evaluate(
      '(()=> (async()=>{const w=window.app.workspace,f=window.app.vault.getAbstractFileByPath(' + JSON.stringify(NOTE) +
      '),l=w.getLeaf("split","vertical");await l.openFile(f,{state:{mode:"source",source:true}});w.setActiveLeaf(l,{focus:true});' +
      'await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const rc=window.CodeMirrorAdapter.Vim.getRegisterController();' +
      'return{ok:!!(l.view&&l.view.editor),marker:!!rc.pushText.__bobVimYankFlashWrapped};})())()',
    );
    if (!state.ok || !state.marker) throw new Error("split pane did not keep hook: " + JSON.stringify(state));
    const result = await observed(client, { needle: "alpha beta", keys: ["y", "y"] });
    assertFlash(result, { lines: [lineAt("alpha beta")] }, "split pane");
    return "new split editor flashed";
  });
  await runCase(record, "lifetime/pop-out best effort", async () => {
    const available = await client.evaluate('typeof window.app.workspace.openPopoutLeaf==="function"');
    if (!available) {
      record("lifetime/pop-out", "skipped", "Obsidian 1.15.0 exposes no workspace.openPopoutLeaf API");
      return "__skip__";
    }
    record("lifetime/pop-out", "skipped", "a pop-out uses a separate CDP renderer that this harness cannot safely target");
    return "__skip__";
  });
  await runCase(record, "lifetime/unload restore and reload", async () => {
    await togglePlugin(client, false);
    const off = await client.evaluate(
      '(()=>{const rc=window.CodeMirrorAdapter.Vim.getRegisterController();return{own:Object.prototype.hasOwnProperty.call(rc,"pushText"),marker:!!rc.pushText.__bobVimYankFlashWrapped};})()',
    );
    if (off.own || off.marker) throw new Error("unload left an own property or marker: " + JSON.stringify(off));
    await togglePlugin(client, true);
    const marker = await client.evaluate('(()=>{const rc=window.CodeMirrorAdapter.Vim.getRegisterController();return !!rc.pushText.__bobVimYankFlashWrapped;})()');
    if (!marker) throw new Error("re-enable did not install hook");
    const result = await observed(client, { needle: "alpha beta", keys: ["y", "y"] });
    assertFlash(result, { lines: [lineAt("alpha beta")] }, "re-enabled plugin");
    return "prototype pushText restored on unload and hook reinstalled";
  });
}

async function visibleLineStyle(client, needle) {
  const result = await observed(client, { needle, keys: ["y", "y"] });
  assertFlash(result, { lines: [lineAt(needle)] }, "line style");
  const line = result.observation.records.find((x) => x.kind === "line");
  const baseline = result.observation.baseline.find((x) => x.number === line.line);
  if (!line || !baseline || (line.boxShadow === baseline.boxShadow && line.background === baseline.background)) {
    throw new Error("computed style did not change on the flashed line");
  }
  return "line " + line.line + " computed style changed";
}

async function screenshot(client, outDir, label, theme, needle, sequence) {
  await resetNote(client); await openNote(client, NOTE, "source");
  await client.evaluate('(()=>{const d=' + JSON.stringify(theme === "obsidian") +
    ';document.body.classList.toggle("theme-dark",d);document.body.classList.toggle("theme-light",!d);return true;})()');
  await caret(client, needle);
  const armed = await client.evaluate(OBSERVER_START); if (!armed.ok) throw new Error("screenshot observer failed");
  await keys(client, sequence);
  const image = await client.call("Page.captureScreenshot", { format: "png", fromSurface: true });
  const file = path.join(outDir, label + "-" + theme + ".png");
  fs.writeFileSync(file, Buffer.from(image.data, "base64"));
  await sleep(FLASH_MS + 100);
  const result = await client.evaluate(OBSERVER_FINISH);
  if (!result.records.length) throw new Error("no flash sampled for screenshot");
  return file;
}

async function geometry(client, record, outDir) {
  await runCase(record, "geometry/repeated task row exact position", async () => {
    const row = lineAt("- [ ] repeated task row");
    const result = await observed(client, { needle: "- [ ] repeated task row", offset: 2, keys: ["y", "y"] });
    assertFlash(result, { lines: [row] }, "repeated task row");
    return "only line " + (row + 1) + " flashed";
  });
  await runCase(record, "geometry/emoji UTF-16", async () => {
    const result = await observed(client, { needle: "emoji 😀pair", offset: 6, keys: ["v", "y"] });
    assertFlash(result, { minMarks: 1, text: "😀" }, "emoji");
    return "emoji range flashed";
  });
  await runCase(record, "geometry/tabs and wrapped line", async () => {
    const result = await observed(client, { needle: "tabs\talpha", offset: 5, keys: ["y", "$"] });
    assertFlash(result, { minMarks: 1 }, "tab and wrapped line");
    const geometry = await client.evaluate('(()=>{const e=window.app.workspace.activeLeaf.view.editor,v=e.cm,root=v.dom.querySelector(".cm-content");const el=Array.from(root.querySelectorAll(".cm-line")).find(x=>{try{return v.state.doc.lineAt(v.posAtDOM(x)).text.startsWith("tabs") }catch(_){return false}});if(!el)return{ok:false};const r=document.createRange();r.selectNodeContents(el);return{ok:true,rects:r.getClientRects().length};})()');
    if (!geometry.ok || geometry.rects < 2) throw new Error("fixture line did not wrap: " + JSON.stringify(geometry));
    return "tabbed line wrapped into " + geometry.rects + " rendered rows";
  });
  await runCase(record, "geometry/folded heading", async () => {
    const result = await observed(client, {
      needle: "# Heading with",
      keys: ["y", "y"],
      beforeKeys: async () => {
        await client.evaluate('(()=>{const e=window.app.workspace.activeLeaf.view.editor;if(e&&typeof e.foldMore==="function")e.foldMore();return true;})()');
        await sleep(80);
      },
    });
    const folded = Array.isArray(result.state.foldOffsets) ? result.state.foldOffsets.length > 0 : Boolean(result.state.foldOffsets && Object.keys(result.state.foldOffsets).length);
    if (!folded) {
      record("geometry/folded heading", "skipped", "Obsidian 1.15.0 did not expose an active heading fold through Editor.foldMore");
      return "__skip__";
    }
    assertFlash(result, { lines: [lineAt("# Heading with")] }, "folded heading");
    return "folded heading line flashed";
  });
  for (const [name, needle] of [
    ["paragraph", "paragraph text for Live Preview"],
    ["list", "- list item with"],
    ["heading", "# Heading with"],
    ["link", "Link"],
  ]) {
    await runCase(record, "geometry/Live Preview " + name, async () => {
      const result = await observed(client, { mode: "live", needle, keys: ["y", "y"] });
      assertFlash(result, { lines: [lineAt(needle)] }, name);
      return "cursor line flashed";
    });
  }
  await runCase(record, "geometry/search match stays visible", async () => {
    const result = await observed(client, {
      needle: "alpha beta",
      keys: ["y", "y"],
      beforeKeys: async () => {
        await key(client, { key: "f", modifiers: 2, text: "" });
        const setup = await client.evaluate('(()=>{const a=document.activeElement,inputs=Array.from(document.querySelectorAll("input"));const i=a&&a.tagName==="INPUT"?a:inputs.find(x=>/search|find/i.test((x.placeholder||"")+" "+(x.className||"")+" "+(x.getAttribute("aria-label")||"")));if(!i)return{ok:false,active:a&&a.outerHTML,inputs:inputs.map(x=>x.outerHTML),search:document.querySelector(".cm-search")&&document.querySelector(".cm-search").outerHTML};i.focus();return{ok:true,active:i.outerHTML};})()');
        if (!setup.ok) throw new Error("editor find input not found: " + JSON.stringify(setup));
        await keys(client, ["a", "l", "p", "h", "a"]);
        await sleep(100);
        const active = await client.evaluate('(()=>{const e=window.app.workspace.activeLeaf.view.editor.cm,all=Array.from(e.dom.querySelectorAll("*"));return{match:!!e.dom.querySelector(".obsidian-search-match-highlight"),value:document.activeElement&&document.activeElement.value,classes:all.flatMap(x=>Array.from(x.classList||[])).filter(x=>/search|match/i.test(x)).slice(0,30)};})()');
        if (!active.match) throw new Error("search did not leave an active match: " + JSON.stringify({ setup, active }));
        await caret(client, "alpha beta");
      },
    });
    assertFlash(result, { lines: [lineAt("alpha beta")] }, "search match");
    const flash = result.observation.records.find((x) => x.kind === "line");
    const baseline = result.observation.baseline.find((x) => x.number === flash.line);
    if (!flash || !baseline || (flash.boxShadow === baseline.boxShadow && flash.background === baseline.background)) {
      throw new Error("flash style was hidden by the search match");
    }
    return "line flash style changed while a search match was active";
  });
  for (const theme of ["moonstone", "obsidian"]) {
    for (const [label, needle, sequence] of [
      ["linewise", "alpha beta", ["y", "y"]],
      ["charwise", "alpha beta", ["y", "w"]],
      ["blockwise", "alpha beta", [{ key: "v", modifiers: 2, text: "" }, "j", "l", "y"]],
      ["tinted-row", "- [/] tinted task row", ["y", "y"]],
    ]) {
      await runCase(record, "screenshot/" + theme + "/" + label, async () => {
        return await screenshot(client, outDir, label, theme, needle, sequence);
      });
    }
  }
  await runCase(record, "geometry/tinted row style", async () => {
    return await visibleLineStyle(client, "- [/] tinted task row");
  });
}

function selfTest() {
  const parsed = parseArgs(["--self-test", "--only", "must-flash", "--report", "/tmp/flash.json"]);
  if (!parsed.selfTest || parsed.only !== "must-flash") throw new Error("argument parsing failed");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bob-vim-yank-e2e-self-"));
  try {
    const built = buildFixture(temp, path.join(temp, "profile"));
    if (!built.enabled.includes("bob-vim-yank-flash") || !built.enabled.includes("bob-vim-surround")) {
      throw new Error("scratch vault does not enable the flash and surround plugins");
    }
    const app = JSON.parse(fs.readFileSync(path.join(temp, ".obsidian", "app.json"), "utf8"));
    if (app.vimMode !== true || !app.enabledCssSnippets.includes("task-statuses")) throw new Error("fixture settings missing Vim or tinted-row snippet");
    if (!fs.readFileSync(path.join(temp, NOTE), "utf8").includes("emoji 😀pair")) throw new Error("fixture UTF-16 row missing");
    const source = fs.readFileSync(__filename, "utf8");
    for (const token of ["MutationObserver", "requestAnimationFrame", "posAtDOM", "Input.dispatchKeyEvent", "getRegister", "theme-dark", "openPopoutLeaf"]) {
      if (!source.includes(token)) throw new Error("e2e is missing " + token);
    }
    if (lineAt("alpha beta") !== 2) throw new Error("fixture line mapping changed");
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
  const groups = ["must-flash", "must-not-flash", "behavior", "lifetime", "geometry"];
  if (args.only && !groups.includes(args.only)) fail("--only must be one of " + groups.join(", "), 2);
  const outDir = args.out ? path.resolve(args.out) : fs.mkdtempSync(path.join(os.tmpdir(), "bob-yank-flash-shots-"));
  fs.mkdirSync(outDir, { recursive: true });
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bob-yank-flash-e2e-"));
  const vault = path.join(runRoot, "vault");
  const profile = path.join(runRoot, "profile");
  buildFixture(vault, profile);
  const fixturePath = fs.realpathSync(vault);
  const port = await freePort();
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
    expectedPlugins: expectedPlugins(), cases, skipped: [], screenshots: [], pass: false,
  };
  try {
    const target = await selectTarget(port, fixturePath, () => exited);
    client = await Cdp.connect(target.webSocketDebuggerUrl, lib.CONNECT_TIMEOUT_MS);
    await client.call("Page.enable", {}); await client.call("Runtime.enable", {});
    await waitFor(client, "Boolean(window.app&&window.app.workspace&&window.app.workspace.layoutReady)", Boolean, "layout-ready", lib.LAYOUT_READY_TIMEOUT_MS);
    await dismissTrust(client);
    await waitFor(client,
      'Boolean(window.app.plugins.plugins&&window.app.plugins.plugins["bob-vim-yank-flash"]&&window.app.plugins.plugins["bob-vim-surround"])',
      Boolean, "flash and surround plugins", 30_000);
    await sleep(1000);
    report.appVersion = await client.evaluate("window.app.version||null").catch(() => null);
    const hook = await client.evaluate(
      '(()=>{const r=window.CodeMirrorAdapter.Vim.getRegisterController();return{ok:!!r,marker:!!r.pushText.__bobVimYankFlashWrapped};})()',
    );
    record("hook/installed", hook.ok && hook.marker ? "pass" : "fail", JSON.stringify(hook));
    if (!hook.ok || !hook.marker) throw new Error("pushText hook not installed");
    const runners = {
      "must-flash": () => mustFlash(client, record),
      "must-not-flash": () => mustNotFlash(client, record),
      behavior: () => behavior(client, record),
      lifetime: () => lifetime(client, record),
      geometry: () => geometry(client, record, outDir),
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
main().catch((error) => {
  console.error((error && error.stack) || error);
  process.exitCode = error && error.exitCode ? error.exitCode : 1;
});
