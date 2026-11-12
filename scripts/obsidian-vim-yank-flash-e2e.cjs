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
const keepMovingFixture = require("./obsidian-keep-moving-marks-e2e-lib.cjs");

const ROOT = path.resolve(__dirname, "..");
const FLASH_MS = 200;
const RPC_TIMEOUT_MS = 20_000;
const NOTE = "vim-yank-flash-fixture.md";
const OTHER = "vim-yank-flash-other.md";
const ALBUM_NOTE = "album-widget-fixture.md";
const BASE_LINES = [
  "# Vim yank flash fixture", "",
  "alpha beta gamma delta", "second alpha line", "third line with tail",
  "fourth line stays here", "- [ ] repeated task row", "- [ ] repeated task row",
  "- [/] tinted task row", "", "after the blank line",
  "outer (inside parenthesized text) end", "emoji 😀pair and UTF-16 characters",
  "tabs\talpha\tbravo and a long line that wraps when the editor is narrow; this sentence keeps going to force several rendered rows in the default Obsidian window; the yank must still cover the exact underlying range across those wraps",
  "# Heading with a [[Link]]", "- list item with [[Link]]",
  "paragraph text for Live Preview", "inline code around `sourceword` and after",
  "last fixture line",
];
const DEEP_LINES = Array.from({ length: 90 }, (_, index) => "deep filler row " + String(index + 1).padStart(3, "0"));
const LINES = BASE_LINES.concat(["", "## Deep Scroll Fixture"], DEEP_LINES, [
  "deep target row for ygg", "deep target second row", "deep target final row",
]);
const BODY = LINES.join("\n");
const YGG_TARGET_LINE = LINES.findIndex((line) => line === "deep target row for ygg");
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

function sourceLineStart(lineIndex) {
  let offset = 0;
  for (let i = 0; i < lineIndex; i += 1) offset += LINES[i].length + 1;
  return offset;
}

function sourceLinewiseRegister(lineIndexes) {
  return lineIndexes.map((line) => LINES[line]).join("\n") + "\n";
}

function sourceSpan(needle, offset, length) {
  const start = BODY.indexOf(needle);
  if (start < 0) throw new Error("missing expected fixture text: " + needle);
  return [start + (offset || 0), start + (offset || 0) + length];
}
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

function findTasksPluginSource() {
  const candidate = path.join(os.homedir(), "bob", ".obsidian", "plugins", "obsidian-tasks-plugin");
  return fs.existsSync(path.join(candidate, "main.js")) && fs.existsSync(path.join(candidate, "manifest.json"))
    ? candidate : null;
}

function writeFixtureNote(vault, file, content) {
  const target = path.join(vault, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function buildFixture(vault, profilePath) {
  fs.mkdirSync(vault, { recursive: true });
  fs.writeFileSync(path.join(vault, NOTE), BODY);
  fs.writeFileSync(path.join(vault, OTHER), "# Other note\n\nA second tab.\n");
  const today = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const dates = {
    today: `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`,
    year: String(today.getFullYear()),
    stamp: `${today.getFullYear()}${pad(today.getMonth() + 1)}${pad(today.getDate())}`,
  };
  const keepMovingDailyPath = keepMovingFixture.dailyPathFor(dates);
  const keepMovingNotes = {
    "job_email_recruiters.md": keepMovingFixture.recruiterNote(dates),
    "job.md": keepMovingFixture.jobNote(dates),
    "job_2026.md": keepMovingFixture.jobProjectNote(dates),
    "km_all.md": keepMovingFixture.allNote(dates),
    "um.md": keepMovingFixture.umbrellaNote(dates),
    "standalone.md": keepMovingFixture.standaloneNote(dates),
    [keepMovingDailyPath]: keepMovingFixture.dailyNote(dates),
  };
  for (const [file, content] of Object.entries(keepMovingNotes)) writeFixtureNote(vault, file, content);
  const [year, month, day] = dates.today.split("-").map(Number);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(year, month - 1, day).getDay()];
  const monthName = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month - 1];
  const bankPath = `bank/${year}-${pad(month)}.md`;
  const bankBody = [
    "---", 'type: "[[bank_month]]"', `month: ${year}-${pad(month)}`, "---", "",
    `## ${weekday} ${monthName} ${day}`, "", "- [ ] $12.34 Yank flash bank-widget row [cat:: groceries]", "",
  ].join("\n");
  writeFixtureNote(vault, bankPath, bankBody);
  const albumBody = [
    "---", 'type: "[[album]]"', "---", "", "# Album header source row", "body below the header", "",
  ].join("\n");
  writeFixtureNote(vault, ALBUM_NOTE, albumBody);
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
    livePreview: true, vimMode: true, showLineNumber: false, enabledCssSnippets: ["task-statuses"],
  }, null, 2));
  fs.writeFileSync(path.join(obsidian, "appearance.json"), JSON.stringify({
    cssTheme: "", theme: "moonstone", enabledCssSnippets: ["task-statuses"],
  }, null, 2));
  fs.writeFileSync(path.join(obsidian, "snippets", "task-statuses.css"),
    '.markdown-source-view.mod-cm6 .HyperMD-task-line:is([data-task="/"]) { background: rgba(20, 120, 60, 0.55); }\n');
  fs.writeFileSync(path.join(obsidian, "core-plugins.json"), JSON.stringify([
    "file-explorer", "global-search", "switcher", "page-preview", "command-palette",
    "editor-status", "outline", "daily-notes",
  ], null, 2));
  fs.writeFileSync(path.join(obsidian, "daily-notes.json"), JSON.stringify({
    format: "YYYY/YYYYMMDD", folder: "", template: "",
  }, null, 2));
  const profile = profilePath || path.join(vault, "..", "profile");
  const id = crypto.randomBytes(8).toString("hex");
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(profile, "obsidian.json"), JSON.stringify({
    vaults: { [id]: { path: fs.realpathSync(vault), ts: Date.now(), open: true } },
  }, null, 2));
  return {
    enabled, profile, keepMovingDailyPath, keepMovingDailyBody: keepMovingNotes[keepMovingDailyPath],
    tasksPlugin: Boolean(tasksSource), bankPath, bankBody, albumBody,
  };
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
      '(()=>{const e=window.app.workspace.activeLeaf.view.editor,cm=e&&e.cm;const n=' + needle + ';e.setCursor({line:n,ch:' + Number(offset || 0) + '});if(cm&&cm.constructor&&typeof cm.constructor.scrollIntoView==="function"){const pos=cm.state.doc.line(n+1).from;cm.dispatch({effects:cm.constructor.scrollIntoView(pos,{y:"center"})});}if(e.focus)e.focus();return{ok:true,line:n};})()',
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
  'const e=l&&l.view&&l.view.editor,EditorView=e&&e.cm&&e.cm.constructor,view=EditorView&&EditorView.findFromDOM(root.closest(".cm-editor"));',
  'if(!view)return{ok:false,error:"active CodeMirror view missing"};const doc=view.state.doc;let baseline=[],visibleRanges=[],capturedViewport=null;',
  'function readViewport(){const ranges=(view.visibleRanges||[]).map(r=>({from:r.from,to:r.to})),rows=[];for(const el of root.querySelectorAll(".cm-line")){let line;try{line=doc.lineAt(view.posAtDOM(el,0,-1));}catch(_){continue;}const style=getComputedStyle(el);rows.push({number:line.number-1,from:line.from,to:line.to,text:line.text,background:style.backgroundColor,boxShadow:style.boxShadow});}return{baseline:rows,visibleRanges:ranges};}',
  'const initialViewport=readViewport();baseline=initialViewport.baseline;visibleRanges=initialViewport.visibleRanges;',
  'function sourceSpans(el){const spans=[],walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode())){let parent=node.parentElement,skip=false;while(parent&&parent!==root){if(parent.classList&&Array.from(parent.classList).some(c=>c.startsWith("bob-")&&c!=="bob-yank-flash"&&c!=="bob-yank-flash-line")){skip=true;break;}if(parent.matches&&parent.matches(".cm-widget,.cm-widgetBuffer")){skip=true;break;}parent=parent.parentElement;}if(skip)continue;try{const from=view.posAtDOM(node,0,-1),to=view.posAtDOM(node,node.nodeValue.length,1);if(Number.isInteger(from)&&Number.isInteger(to)&&to>from)spans.push([from,to]);}catch(_){}}return spans;}',
  'const records=[],seen=new WeakMap();',
  'const sample=()=>{const els=root.querySelectorAll(".bob-yank-flash,.bob-yank-flash-line");if(els.length&&!capturedViewport)capturedViewport=readViewport();for(const el of els){const kind=el.classList.contains("bob-yank-flash-line")?"line":"mark";let line=null;try{line=doc.lineAt(view.posAtDOM(el,0,-1)).number-1;}catch(_){}const style=getComputedStyle(el),spans=kind==="mark"?sourceSpans(el):[];const key=kind+"|"+String(line)+"|"+JSON.stringify(spans);if(seen.get(el)===key)continue;seen.set(el,key);records.push({kind,line,spans,text:spans.map(r=>doc.sliceString(r[0],r[1])).join(""),background:style.backgroundColor,boxShadow:style.boxShadow,time:performance.now()});if(spans.length||kind==="line")capturedViewport=readViewport();}};',
  'let frame=0,stopped=false;const tick=()=>{if(stopped)return;sample();frame=requestAnimationFrame(tick);};',
  'const observer=new MutationObserver(sample);observer.observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:["class"]});frame=requestAnimationFrame(tick);sample();',
  'window.__bobYankFlashObservation={records,baseline,visibleRanges,stop(){stopped=true;observer.disconnect();cancelAnimationFrame(frame);},finish(){sample();const remaining=Array.from(root.querySelectorAll(".bob-yank-flash,.bob-yank-flash-line")).map(el=>({kind:el.classList.contains("bob-yank-flash-line")?"line":"mark"})),viewport=capturedViewport||readViewport();this.stop();return{records:this.records,baseline:viewport.baseline,visibleRanges:viewport.visibleRanges,remaining};}};',
  'return{ok:true,baseline};})()',
].join("\n");
const OBSERVER_FINISH = '(()=>{const x=window.__bobYankFlashObservation;return x?x.finish():{records:[],baseline:[],remaining:[],error:"observer missing"};})()';
const EDITOR_STATE = '(()=>{const w=window.app.workspace,v=w.activeLeaf&&w.activeLeaf.view,e=v&&v.editor;if(!e)return{ok:false};' +
  'const rc=window.CodeMirrorAdapter.Vim.getRegisterController();function regText(r){return typeof r==="string"?r:r&&typeof r.toString==="function"?r.toString():r&&typeof r.text==="string"?r.text:r&&Array.isArray(r.text)?r.text.join(r.linewise?"\\n":"\\n"):r&&Array.isArray(r.lines)?r.lines.join(r.linewise?"\\n":"\\n"):null;}' +
  'const registers={};for(const name of [\'"\',"a","+","*"]){try{registers[name]=regText(rc.getRegister(name));}catch(_){registers[name]=null;}}const r=rc.getRegister(\'"\');let raw=null,clipboard=null,foldOffsets=null;try{raw=JSON.stringify(r);}catch(_){raw=String(r);}try{clipboard=require("electron").clipboard.readText();}catch(_){}try{foldOffsets=e.getFoldOffsets();}catch(_){}const c=e.getCursor(),cm=e.cm;let visibleLines=[];try{visibleLines=Array.from(cm.dom.querySelectorAll(".cm-line")).map(el=>{try{return cm.state.doc.lineAt(cm.posAtDOM(el,0,-1)).number-1;}catch(_){return null;}}).filter(Number.isInteger);}catch(_){}return{ok:true,text:e.getValue(),cursor:{line:c.line,ch:c.ch},register:registers[\'"\'],registers,registerRaw:raw,clipboard,foldOffsets,scrollTop:cm&&cm.scrollDOM?cm.scrollDOM.scrollTop:null,visibleLines,path:v.file&&v.file.path||null};})()';

async function observed(client, options) {
  await resetNote(client);
  const opened = await openNote(client, NOTE, options.mode || "source");
  if (!opened || !opened.ok) throw new Error("could not open scratch note");
  await caret(client, options.line == null ? options.needle : options.line, options.offset || 0);
  if (options.beforeKeys) await options.beforeKeys();
  await waitFor(client, 'document.querySelectorAll(".bob-yank-flash,.bob-yank-flash-line").length===0', (v) => v === true, "previous flash cleared", 5000).catch(() => {});
  const armed = await client.evaluate(OBSERVER_START);
  if (!armed || !armed.ok) throw new Error("could not arm flash observer: " + JSON.stringify(armed));
  await keys(client, options.keys);
  if (options.afterKeys) await options.afterKeys();
  await sleep(options.waitMs == null ? FLASH_MS + 180 : options.waitMs);
  const observation = await client.evaluate(OBSERVER_FINISH);
  const state = await client.evaluate(EDITOR_STATE);
  return { observation, state };
}

async function observedOpenedFile(client, options) {
  const opened = await openNote(client, options.file, options.mode || "live");
  if (!opened || !opened.ok) throw new Error("could not open scratch note " + options.file);
  if (options.waitFor) {
    await waitFor(client, options.waitFor, Boolean, options.waitLabel || "fixture widget", 20_000);
  }
  await caret(client, options.needle, options.offset || 0);
  if (options.beforeKeys) await options.beforeKeys();
  await waitFor(client, 'document.querySelectorAll(".bob-yank-flash,.bob-yank-flash-line").length===0', (v) => v === true, "previous flash cleared", 5000).catch(() => {});
  const armed = await client.evaluate(OBSERVER_START);
  if (!armed || !armed.ok) throw new Error("could not arm flash observer: " + JSON.stringify(armed));
  await keys(client, options.keys);
  await sleep(options.waitMs == null ? FLASH_MS + 180 : options.waitMs);
  const observation = await client.evaluate(OBSERVER_FINISH);
  const state = await client.evaluate(EDITOR_STATE);
  return { observation, state };
}

function lineAt(needle) { return LINES.findIndex((line) => line.includes(needle)); }

function normalizeRanges(ranges) {
  const sorted = (Array.isArray(ranges) ? ranges : [])
    .filter((range) => Array.isArray(range) && Number.isInteger(range[0]) && Number.isInteger(range[1]) && range[1] > range[0])
    .map((range) => [range[0], range[1]])
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const merged = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1]);
    else merged.push(range);
  }
  return merged;
}

function clipRanges(ranges, visibleRanges) {
  const clipped = [];
  for (const [from, to] of ranges || []) {
    for (const visible of visibleRanges || []) {
      const start = Math.max(from, visible.from);
      const end = Math.min(to, visible.to);
      if (end > start) clipped.push([start, end]);
    }
  }
  return normalizeRanges(clipped);
}

function assertFlash(result, expected, label) {
  if (!Object.prototype.hasOwnProperty.call(expected, "lines") && !Object.prototype.hasOwnProperty.call(expected, "spans")) {
    throw new Error(label + ": expected exact source-line or source-span coverage");
  }
  const records = result.observation.records || [];
  const lines = records.filter((item) => item.kind === "line");
  const marks = records.filter((item) => item.kind === "mark");
  const visibleLines = new Set((result.observation.baseline || []).map((item) => item.number));
  const wantedLines = (expected.lines || []).filter((line) => visibleLines.has(line)).slice().sort((a, b) => a - b);
  const foundLines = lines.map((item) => item.line).filter(Number.isInteger).sort((a, b) => a - b);
  if (JSON.stringify(wantedLines) !== JSON.stringify(foundLines)) {
    throw new Error(label + ": line coverage " + JSON.stringify(foundLines) + ", expected visible source lines " + JSON.stringify(wantedLines));
  }
  const wantedSpans = clipRanges(expected.spans || [], result.observation.visibleRanges || []);
  const foundSpans = normalizeRanges(marks.flatMap((item) => item.spans || []));
  if (JSON.stringify(wantedSpans) !== JSON.stringify(foundSpans)) {
    throw new Error(label + ": source coverage " + JSON.stringify(foundSpans) + ", expected " + JSON.stringify(wantedSpans));
  }
  if (!result.state || !result.state.ok || result.state.register == null) {
    throw new Error(label + ": unnamed register could not be read");
  }
  if (Object.prototype.hasOwnProperty.call(expected, "register") && result.state.register !== expected.register) {
    throw new Error(label + ": unnamed register " + JSON.stringify(result.state.register) + ", expected " + JSON.stringify(expected.register));
  }
  if (expected.registerName && (!result.state.registers || result.state.registers[expected.registerName] !== expected.registerValue)) {
    throw new Error(label + ": register " + expected.registerName + " was " + JSON.stringify(result.state.registers && result.state.registers[expected.registerName]) + ", expected " + JSON.stringify(expected.registerValue));
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
  const linesFromTo = (first, last) => Array.from({ length: last - first + 1 }, (_, index) => first + index);
  const cases = [
    ["yy", "alpha beta", 0, ["y", "y"], { lines: [lineAt("alpha beta")], register: sourceLinewiseRegister([lineAt("alpha beta")]) }],
    ["3yy", "after the blank line", 0, ["3", "y", "y"], { lines: [10, 11, 12], register: sourceLinewiseRegister([10, 11, 12]) }],
    ["yw", "alpha beta", 0, ["y", "w"], { spans: [sourceSpan("alpha beta", 0, 6)], register: "alpha " }],
    ["y$", "alpha beta", 6, ["y", "$"], { spans: [sourceSpan("alpha beta", 6, LINES[lineAt("alpha beta")].length - 6)], register: "beta gamma delta" }],
    ["yiw", "alpha beta", 0, ["y", "i", "w"], { spans: [sourceSpan("alpha beta", 0, 5)], register: "alpha" }],
    ["yi(", "parenthesized", 0, ["y", "i", "("], { spans: [sourceSpan("outer (inside parenthesized text) end", 7, 25)], register: "inside parenthesized text" }],
    ["yap", "alpha beta", 0, ["y", "a", "p"], { lines: linesFromTo(2, 9), register: sourceLinewiseRegister(linesFromTo(2, 9)) }],
    ["yb", "alpha beta", 15, ["y", "b"], { spans: [sourceSpan("alpha beta gamma delta", 11, 4)], register: "gamm" }], // Vim b is exclusive: yb yanks gamm,
    ["yG", "third line with tail", 0, ["y", "G"], { lines: linesFromTo(4, LINES.length - 1), register: sourceLinewiseRegister(linesFromTo(4, LINES.length - 1)) }],
    ["ygg", "deep target row for ygg", 0, ["y", "g", "g"], { lines: linesFromTo(0, YGG_TARGET_LINE), register: sourceLinewiseRegister(linesFromTo(0, YGG_TARGET_LINE)) }],
    ["Y", "alpha beta", 0, [{ key: "Y", modifiers: 8, text: "Y" }], { lines: [lineAt("alpha beta")], register: sourceLinewiseRegister([lineAt("alpha beta")]) }],
    ['"ayy', "second alpha", 0, ['"', "a", "y", "y"], { lines: [3], register: sourceLinewiseRegister([3]), registerName: "a", registerValue: sourceLinewiseRegister([3]) }],
    ['"Ayy', "third line", 0, ['"', { key: "A", modifiers: 8, text: "A" }, "y", "y"], { lines: [4], register: sourceLinewiseRegister([3, 4]), registerName: "a", registerValue: sourceLinewiseRegister([3, 4]) }],
    ["Vjy", "alpha beta", 0, ["V", "j", "y"], { lines: [lineAt("alpha beta"), lineAt("alpha beta") + 1], register: sourceLinewiseRegister([2, 3]) }],
    ["vey", "alpha beta", 0, ["v", "e", "y"], { spans: [sourceSpan("alpha beta", 0, 5)], register: "alpha" }],
    ["Ctrl-V j l y", "alpha beta", 0, [{ key: "v", modifiers: 2, text: "" }, "j", "l", "y"], { spans: [sourceSpan("alpha beta", 0, 2), sourceSpan("second alpha line", 0, 2)], register: "al\nse" }],
    ["blank-line yy", "after the blank line", 0, ["y", "y"], { lines: [9], register: "\n" }],
  ];
  for (const [label, needle, offset, sequence, expected] of cases) {
    await runCase(record, "must-flash/" + label, async () => {
      const result = await observed(client, { needle: label === "blank-line yy" || label === "ygg" ? undefined : needle, line: label === "blank-line yy" ? 9 : label === "ygg" ? YGG_TARGET_LINE : undefined, offset, keys: sequence });
      assertFlash(result, expected, label);
      return "exact source coverage and register bytes verified";
    });
  }
  await runCase(record, "must-flash/inline-code Live Preview", async () => {
    const result = await observed(client, { mode: "live", needle: "sourceword", keys: ["y", "i", "w"] });
    const inlineCode = "inline code around " + String.fromCharCode(96) + "sourceword" + String.fromCharCode(96) + " and after";
    assertFlash(result, { spans: [sourceSpan(inlineCode, 20, 10)], register: "sourceword" }, "inline code");
    return "inline-code source offsets and copied bytes match";
  });
  await runCase(record, "must-flash/repeated identical yy", async () => {
    await resetNote(client); await openNote(client, NOTE, "source"); await caret(client, "alpha beta", 0);
    await client.evaluate('(()=>{const rc=window.CodeMirrorAdapter.Vim.getRegisterController(),original=rc.pushText;window.__bobYankTimes=[];rc.pushText=function(...args){const result=original.apply(this,args);if(args[1]==="yank")window.__bobYankTimes.push(performance.now());return result;};return true;})()');
    const armed = await client.evaluate(OBSERVER_START); if (!armed.ok) throw new Error("observer failed");
    await keys(client, ["y", "y"]); await sleep(20); await keys(client, ["y", "y"]); await sleep(150);
    const times = await client.evaluate("window.__bobYankTimes.slice()");
    if (times.length !== 2 || times[1] - times[0] >= FLASH_MS) throw new Error("yanks did not overlap one flash lifetime: " + JSON.stringify(times));
    const live = await client.evaluate('Boolean(document.querySelector(".bob-yank-flash,.bob-yank-flash-line"))');
    if (!live) throw new Error("first timer cleared the second yank's flash");
    const secondAge = await client.evaluate("performance.now()-window.__bobYankTimes[1]");
    await sleep(Math.max(0, FLASH_MS - secondAge + 30));
    const remaining = await client.evaluate('document.querySelectorAll(".bob-yank-flash,.bob-yank-flash-line").length');
    const obs = await client.evaluate(OBSERVER_FINISH);
    if (remaining || !obs.records.length) throw new Error("second flash did not expire or was not sampled");
    return "two yanks overlapped; the first timer did not clear the second flash";
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
  await runCase(record, "must-not-flash/Copy card clipboard write", async () => {
    await resetNote(client); await openNote(client, NOTE, "source"); await caret(client, "alpha beta");
    const before = await client.evaluate(EDITOR_STATE);
    const armed = await client.evaluate(OBSERVER_START); if (!armed.ok) throw new Error("observer failed");
    const value = "copy-card e2e clipboard value";
    const copied = await client.evaluate(
      '(()=> (async()=>{const p=window.app.plugins.plugins["bob-navigation-hotkeys"];return p&&typeof p.copyCardRow==="function"?await p.copyCardRow({value:' + JSON.stringify(value) + '}):{ok:false,reason:"Copy card plugin unavailable"};})())()',
    );
    if (!copied || !copied.ok) throw new Error("Copy card did not write through navigator.clipboard: " + JSON.stringify(copied));
    await sleep(FLASH_MS + 80);
    const observation = await client.evaluate(OBSERVER_FINISH);
    const after = await client.evaluate(EDITOR_STATE);
    if (observation.records.length || observation.remaining.length) throw new Error("Copy card created a Vim flash");
    if (before.text !== after.text || JSON.stringify(before.cursor) !== JSON.stringify(after.cursor)) throw new Error("Copy card changed the editor document or cursor");
    if (after.clipboard !== value) throw new Error("Copy card's clipboard bytes differ: " + JSON.stringify(after.clipboard));
    return "clipboard bytes copied with no flash, document edit, or cursor movement";
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
    if (a.text !== b.text || JSON.stringify(a.cursor) !== JSON.stringify(b.cursor) || a.register !== b.register) {
      throw new Error("document, cursor, or register differs: " + JSON.stringify({ a, b }));
    }
    const yankNotices = (list) => (Array.isArray(list) ? list : []).map((entry) => { const match = String(entry).match(/\d+\s+lines?\s+yanked/i); return match ? match[0].toLowerCase() : String(entry); });
    if (JSON.stringify(yankNotices(a.notices)) !== JSON.stringify(yankNotices(b.notices))) throw new Error("3yy notices differ with plugin disabled/enabled: " + JSON.stringify({ off: a.notices, on: b.notices }));
    const notice = (b.notices || []).join(" ");
    if (!/3\s+lines?\s+yanked/i.test(notice)) throw new Error("3 lines yanked notice not observed: " + JSON.stringify(b.notices));
    if (a.register !== sourceLinewiseRegister([2, 3, 4])) throw new Error("3yy register bytes were not exact: " + JSON.stringify(a.register));
    return "document, cursor, register bytes, and both notices match";
  });
  await runCase(record, "behavior/ygg deep-scroll parity disabled and enabled", async () => {
    const snapshots = {};
    const expectedLines = Array.from({ length: YGG_TARGET_LINE + 1 }, (_, index) => index);
    const expectedRegister = sourceLinewiseRegister(expectedLines);
    for (const enabled of [false, true]) {
      await togglePlugin(client, enabled);
      snapshots[enabled ? "on" : "off"] = await observed(client, { line: YGG_TARGET_LINE, keys: ["y", "g", "g"] });
      const result = snapshots[enabled ? "on" : "off"];
      if (result.state.register !== expectedRegister) throw new Error((enabled ? "enabled" : "disabled") + " ygg register bytes differ");
      if (enabled) assertFlash(result, { lines: expectedLines, register: expectedRegister }, "deep ygg");
      else if (result.observation.records.length || result.observation.remaining.length) throw new Error("disabled ygg unexpectedly flashed");
    }
    const off = snapshots.off.state, on = snapshots.on.state;
    for (const key of ["text", "cursor", "foldOffsets", "scrollTop", "visibleLines", "register"]) {
      if (JSON.stringify(off[key]) !== JSON.stringify(on[key])) throw new Error("ygg changed " + key + " with plugin enabled");
    }
    if (on.visibleLines.length < 3 || Math.max(...on.visibleLines) < YGG_TARGET_LINE - 15) {
      throw new Error("deep fixture did not scroll near the ygg target: " + JSON.stringify(on.visibleLines));
    }
    return "deep ygg exact bytes, visible coverage, scroll, cursor, fold, and document match";
  });
  for (const paste of ["p", "P"]) {
    await runCase(record, "behavior/yy" + paste, async () => {
      const snapshots = {};
      for (const enabled of [false, true]) {
        await togglePlugin(client, enabled);
        snapshots[enabled ? "on" : "off"] = await observed(client, { needle: "alpha beta", keys: ["y", "y", paste] });
      }
      const expected = LINES.slice();
      expected.splice(paste === "p" ? 3 : 2, 0, LINES[2]);
      const expectedCursor = { line: paste === "p" ? 3 : 2, ch: 0 };
      for (const mode of ["off", "on"]) {
        const result = snapshots[mode];
        if (result.state.text !== expected.join("\n")) throw new Error(mode + " paste document differs from the exact expected text");
        if (JSON.stringify(result.state.cursor) !== JSON.stringify(expectedCursor)) throw new Error(mode + " paste cursor differs: " + JSON.stringify(result.state.cursor));
        if (result.state.register !== sourceLinewiseRegister([2])) throw new Error(mode + " paste register differs: " + JSON.stringify(result.state.register));
        if ((result.observation.remaining || []).length) throw new Error(mode + " paste left the flash after document change");
      }
      if (snapshots.off.state.text !== snapshots.on.state.text || JSON.stringify(snapshots.off.state.cursor) !== JSON.stringify(snapshots.on.state.cursor) || snapshots.off.state.register !== snapshots.on.state.register) {
        throw new Error("plugin changed yy" + paste + " document, cursor, or register");
      }
      return "exact paste document, cursor, register, and enabled/disabled parity verified";
    });
  }
  await runCase(record, "behavior/undo", async () => {
    await resetNote(client); await openNote(client, NOTE, "source");
    await caret(client, "alpha beta");
    await keys(client, ["y", "y", "p", "u"]);
    const after = await client.evaluate(EDITOR_STATE);
    if (after.text !== BODY) throw new Error("undo after actual yank/paste did not restore exact fixture text");
    if (after.register !== sourceLinewiseRegister([2])) throw new Error("undo changed the copied register");
    return "one undo after yy/p restored the exact document and retained the register";
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
      if (off.text !== on.text || JSON.stringify(off.cursor) !== JSON.stringify(on.cursor) || off.register !== on.register) {
        throw new Error(label + " changed document, cursor, or register: " + JSON.stringify({ off, on }));
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
    assertFlash(result, { lines: [lineAt("alpha beta")], register: sourceLinewiseRegister([lineAt("alpha beta")]) }, "split pane");
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
    if (off.marker) throw new Error("unload left our pushText wrapper: " + JSON.stringify(off)); // another plugin may legitimately own pushText after our unload
    await togglePlugin(client, true);
    const marker = await client.evaluate('(()=>{const rc=window.CodeMirrorAdapter.Vim.getRegisterController();return !!rc.pushText.__bobVimYankFlashWrapped;})()');
    if (!marker) throw new Error("re-enable did not install hook");
    const result = await observed(client, { needle: "alpha beta", keys: ["y", "y"] });
    assertFlash(result, { lines: [lineAt("alpha beta")], register: sourceLinewiseRegister([lineAt("alpha beta")]) }, "re-enabled plugin");
    return "prototype pushText restored on unload and hook reinstalled";
  });
}

async function visibleLineStyle(client, needle) {
  const result = await observed(client, { needle, keys: ["y", "y"] });
  assertFlash(result, { lines: [lineAt(needle)], register: sourceLinewiseRegister([lineAt(needle)]) }, "line style");
  const line = result.observation.records.find((x) => x.kind === "line");
  if (!line || !/inset/i.test(line.boxShadow || "") || !/(80,\s*200,\s*120|color-green)/i.test(line.boxShadow || "")) {
    throw new Error("flashed line lacks the yank-flash inset style: " + JSON.stringify(line));
  }
  return "line " + line.line + " shows the yank-flash inset style";
}

async function screenshot(client, outDir, label, theme, needle, sequence) {
  await resetNote(client); await openNote(client, NOTE, "source");
  await client.evaluate('(()=>{const d=' + JSON.stringify(theme === "obsidian") +
    ';document.body.classList.toggle("theme-dark",d);document.body.classList.toggle("theme-light",!d);return true;})()');
  await caret(client, needle);
  await waitFor(client, 'document.querySelectorAll(".bob-yank-flash,.bob-yank-flash-line").length===0', (v) => v === true, "previous flash cleared", 5000).catch(() => {});
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

async function geometry(client, record, outDir, fixture) {
  await runCase(record, "geometry/repeated task row exact position", async () => {
    const row = lineAt("- [ ] repeated task row");
    const result = await observed(client, { needle: "- [ ] repeated task row", offset: 2, keys: ["y", "y"] });
    assertFlash(result, { lines: [row], register: sourceLinewiseRegister([row]) }, "repeated task row");
    return "only line " + (row + 1) + " flashed";
  });
  await runCase(record, "geometry/emoji UTF-16", async () => {
    const result = await observed(client, { needle: "emoji 😀pair", offset: 6, keys: ["v", "y"] });
    assertFlash(result, { spans: [sourceSpan("emoji 😀pair and UTF-16 characters", 6, 3)], register: "😀p" }, "emoji"); // visual vy yanks emoji plus following pair char in this adapter
    return "emoji range flashed";
  });
  await runCase(record, "geometry/tabs and wrapped line", async () => {
    const result = await observed(client, { needle: "tabs\talpha", offset: 5, keys: ["y", "$"] });
    const lineStart = sourceSpan("tabs\talpha", 0, 0)[0];
    const tabLine = LINES[lineAt("tabs\talpha")];
    assertFlash(result, { spans: [[lineStart + 5, lineStart + tabLine.length]], register: tabLine.slice(5) }, "tab and wrapped line");
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
    assertFlash(result, { lines: [lineAt("# Heading with")], register: sourceLinewiseRegister([lineAt("# Heading with")]) }, "folded heading");
    return "folded heading line flashed";
  });
  await runCase(record, "geometry/bank replaced-span coexistence", async () => {
    const row = "- [ ] $12.34 Yank flash bank-widget row [cat:: groceries]";
    const rowIndex = fixture.bankBody.split("\n").indexOf(row);
    const result = await observedOpenedFile(client, {
      file: fixture.bankPath,
      needle: row,
      keys: ["y", "y"],
      waitFor: 'Boolean(document.querySelector(".bob-bank-mark-amount"))',
      waitLabel: "bank amount replacement widget",
    });
    assertFlash(result, { lines: [rowIndex], register: row + "\n" }, "bank replaced span");
    return "bank amount replacement and source line yank coexist";
  });
  await runCase(record, "geometry/album header widget coexistence", async () => {
    const seeded = await client.evaluate(
      '(()=>{const p=window.app.plugins.plugins["bob-ledger-tools"];if(!p)return false;' +
      'const state={report:{albums:[{path:' + JSON.stringify(ALBUM_NOTE) + ',stem:"album-widget-fixture",title:"Album Widget Fixture",noun:"record",parent:"",fields:[],issues:[]}]},stale:false};' +
      'p.albumReportState=()=>state;p.albumHeaderLastState=state;return true;})()',
    );
    if (!seeded) throw new Error("could not seed album report state in fixture plugin");
    const row = "# Album header source row";
    const rowIndex = fixture.albumBody.split("\n").indexOf(row);
    const result = await observedOpenedFile(client, {
      file: ALBUM_NOTE,
      needle: row,
      keys: ["y", "y"],
      waitFor: 'Boolean(document.querySelector(".bob-album-header"))',
      waitLabel: "album header widget",
    });
    assertFlash(result, { lines: [rowIndex], register: row + "\n" }, "album header widget");
    return "album header widget and source heading yank coexist";
  });
  await runCase(record, "geometry/keep-moving widget coexistence", async () => {
    if (!fixture.tasksPlugin) {
      record("geometry/keep-moving widget coexistence", "skipped", "the isolated fixture host has no installed obsidian-tasks-plugin to supply Tasks cache rows");
      return "__skip__";
    }
    const linkLine = "\t- [[job_email_recruiters#^luzern]]";
    const rowIndex = fixture.keepMovingDailyBody.split("\n").indexOf(linkLine);
    const result = await observedOpenedFile(client, {
      file: fixture.keepMovingDailyPath,
      needle: linkLine,
      keys: ["y", "y"],
      waitFor: "Boolean(document.querySelector('.bob-keep-moving-mark[data-block-id=\"luzern\"]'))",
      waitLabel: "keep-moving task widget",
    });
    assertFlash(result, { lines: [rowIndex], register: linkLine + "\n" }, "keep-moving widget");
    return "keep-moving widget and source task link yank coexist";
  });
  for (const [name, needle] of [
    ["paragraph", "paragraph text for Live Preview"],
    ["list", "- list item with"],
    ["heading", "# Heading with"],
    ["link", "Link"],
  ]) {
    await runCase(record, "geometry/Live Preview " + name, async () => {
      const result = await observed(client, { mode: "live", needle, keys: ["y", "y"] });
      assertFlash(result, { lines: [lineAt(needle)], register: sourceLinewiseRegister([lineAt(needle)]) }, name);
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
    assertFlash(result, { lines: [lineAt("alpha beta")], register: sourceLinewiseRegister([lineAt("alpha beta")]) }, "search match");
    const flash = result.observation.records.find((x) => x.kind === "line");
    if (!flash || !/inset/i.test(flash.boxShadow || "") || !/(80,\s*200,\s*120|color-green)/i.test(flash.boxShadow || "")) {
      throw new Error("flash style was hidden by the search match: " + JSON.stringify(flash));
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
  const fixture = buildFixture(vault, profile);
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
    sourceContentSha256: Object.fromEntries([
      "plugins/bob-vim-yank-flash/main.js",
      "plugins/bob-vim-yank-flash/manifest.json",
      "scripts/test-vim-yank-flash.cjs",
      "scripts/obsidian-vim-yank-flash-e2e.cjs",
      "scripts/test-obsidian-vim-yank-flash-e2e.cjs",
    ].map((relative) => [relative, crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, relative))).digest("hex")])),
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
    record("clipboard/vimrc-support delivery", "skipped", "The isolated fixture does not install vimrc-support; delivery through its clipboard setting remains unverified.");
    const runners = {
      "must-flash": () => mustFlash(client, record),
      "must-not-flash": () => mustNotFlash(client, record),
      behavior: () => behavior(client, record),
      lifetime: () => lifetime(client, record),
      geometry: () => geometry(client, record, outDir, fixture),
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
  BODY,
  LINES,
  sourceLineStart,
  sourceLinewiseRegister,
  sourceSpan,
  normalizeRanges,
  clipRanges,
  assertFlash,
  buildFixture,
  selfTest,
};

if (require.main === module) {
  main().catch((error) => {
    console.error((error && error.stack) || error);
    process.exitCode = error && error.exitCode ? error.exitCode : 1;
  });
}
