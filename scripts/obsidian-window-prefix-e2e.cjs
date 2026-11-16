#!/usr/bin/env node
// Real-Obsidian window-prefix spike: CDP verification of lossless cross-group
// tab moves, split create/collapse, and keyboard precedence in an owned
// scratch vault/profile. Never opens the live vault.
//
// Run under xvfb-run -a on Linux (athena has Obsidian + xvfb-run; apollo has
// neither, so copy this working tree without .git/node_modules to a fresh
// mktemp directory on athena over the athena Tailscale SSH alias and run:
//   xvfb-run -a node scripts/obsidian-window-prefix-e2e.cjs \
//     -e /snap/bin/obsidian -r <dir>/report.json -o <dir>/shots
// then copy the report and screenshots back and review them).
//
// Groups: --only spike runs the finding probes (1-5 below). --only actions,
// --only prefix, and --only visual are reserved for their phases and report
// skipped until those phases land their runners.
"use strict";
const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const lib = require("./obsidian-startup-smoke-lib.cjs");
const wplib = require("./obsidian-window-prefix-e2e-lib.cjs");

const ROOT = path.resolve(__dirname, "..");
const RPC_TIMEOUT_MS = 20_000;
const TEMP_ROOT = "/tmp";
const HELP = [
  "Usage: node scripts/obsidian-window-prefix-e2e.cjs [OPTIONS]",
  "",
  "Verify the window-prefix spike in an isolated real Obsidian vault through",
  "CDP. Never opens the live vault. Run under xvfb-run -a on Linux.",
  "",
  "  -e, --executable PATH   Obsidian executable (default: /snap/bin/obsidian)",
  "      --obsidian-bin PATH Alias for --executable",
  "  -h, --help              Print help",
  "  -o, --out DIRECTORY     Screenshot output directory",
  "      --only NAME         Run only a named group: spike, actions, prefix, visual",
  "  -r, --report PATH       Write the structured JSON report",
  "  -s, --self-test         Run offline self-tests (no Obsidian needed)",
  "",
  "Finding groups (--only spike):",
  "  1. removeChild/insertChild/selectTab (+ recomputeChildrenDimensions,",
  "     onLayoutChange, setActiveLeaf, requestSaveLayout) keeps the same leaf",
  "     and editor: type, move, then u undoes; cursor, scroll, folds, pin,",
  "     and back/forward history survive; reading-view and PDF/image leaves",
  "     still render after the move.",
  "  2. Removing a split's last tab collapses that split (or the explicit",
  "     call that does), width is redistributed, layout survives a reload.",
  "  3. createLeafBySplit(leaf, 'vertical', true) placement and",
  "     duplicateLeaf(leaf, 'split', 'vertical') landing + focus.",
  "  4. Keyboard precedence: (a) unbound Ctrl+W reaches a window capture",
  "     listener before CodeMirror, not defaultPrevented; (b) with the",
  "     default Linux binding, Close runs first and the listener sees",
  "     defaultPrevented; (c) a pushed catch-all Scope intercepts a bound",
  "     suffix chord before its command runs and keeps plain letters from",
  "     Vim; (d) popScope removes a scope that is no longer on top;",
  "     (e) insert-mode Ctrl+W still deletes a word on pass-through;",
  "     (f) for the record, whether app.scope.register(['Ctrl'], 'w')",
  "     would preempt a bound Close.",
  "  5. Later-phase facts: bundled Vim idle <C-w> entry; native focus-split",
  "     command IDs; .workspace-tabs.mod-active; getMostRecentLeaf(group);",
  "     deferred background-leaf behavior on focus/move.",
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

function buildFixture(vault, profilePath, hotkeys) {
  fs.mkdirSync(vault, { recursive: true });
  const written = wplib.writeFixtureFiles(vault, hotkeys);
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
    livePreview: true, vimMode: true, showLineNumber: false,
  }, null, 2));
  fs.writeFileSync(path.join(obsidian, "appearance.json"), JSON.stringify({
    cssTheme: "", theme: "moonstone",
  }, null, 2));
  fs.writeFileSync(path.join(obsidian, "core-plugins.json"), JSON.stringify([
    "file-explorer", "global-search", "switcher", "command-palette",
    "editor-status", "outline",
  ], null, 2));
  const profile = profilePath || path.join(vault, "..", "profile");
  const id = crypto.randomBytes(8).toString("hex");
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(profile, "obsidian.json"), JSON.stringify({
    vaults: { [id]: { path: fs.realpathSync(vault), ts: Date.now(), open: true } },
  }, null, 2));
  return { enabled, profile, notes: written.notes, media: written.media };
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
  if (key === "[") return "BracketLeft";
  if (key === "]") return "BracketRight";
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

async function openNote(client, file, mode) {
  const state = mode === "preview" ? { mode: "preview", source: false } : { mode: "source", source: true };
  return client.evaluate(
    '(() => (async()=>{const f=window.app.vault.getAbstractFileByPath(' + JSON.stringify(file) +
    ');if(!f)return{ok:false,error:"missing file"};const w=window.app.workspace;const l=w.getLeaf(false);await l.openFile(f,{state:' +
    JSON.stringify(state) + '});w.setActiveLeaf(l,{focus:true});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));' +
    'const v=l.view;if(v&&v.editor&&v.editor.focus)v.editor.focus();return{ok:!!(v&&(v.editor||v.getViewType()==="preview")),viewType:v?v.getViewType():null};})())()',
    RPC_TIMEOUT_MS,
  );
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

async function screenshot(client, outDir, label) {
  const image = await client.call("Page.captureScreenshot", { format: "png", fromSurface: true });
  const file = path.join(outDir, label + ".png");
  fs.writeFileSync(file, Buffer.from(image.data, "base64"));
  return file;
}

async function setTheme(client, dark) {
  await client.evaluate(
    '(()=>{document.body.classList.toggle("theme-dark",' + (dark ? "true" : "false") +
    ');document.body.classList.toggle("theme-light",' + (dark ? "false" : "true") + ');return true;})()',
  );
  await sleep(300);
}

// Read the live main-area layout back as a signature. `mark` is `*` for the
// tab in the group holding the active leaf and a best-effort `'` for other
// groups' selected tabs; `meta` records HOW selected/pinned were determined
// so the verdict can weight them.
const READ_SIGNATURE = [
  '(() => {',
  'const w=window.app.workspace,seen=new Map(),order=[];',
  'w.iterateRootLeaves((leaf)=>{const p=leaf.parent;if(!p)return;',
  'if(!seen.has(p)){seen.set(p,[]);order.push(p);}seen.get(p).push(leaf);});',
  'const active=w.activeLeaf;',
  'const indexed=order.map((parent)=>{let rect=null;',
  'try{const r=parent.containerEl&&parent.containerEl.getBoundingClientRect();',
  'if(r)rect={left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};}catch(_){}',
  'const tabs=seen.get(parent).map((leaf)=>{let title=null,viewType=null,filePath=null;',
  'try{title=typeof leaf.getDisplayText==="function"?leaf.getDisplayText():null;}catch(_){}',
  'try{viewType=leaf.view&&typeof leaf.view.getViewType==="function"?leaf.view.getViewType():null;}catch(_){}',
  'try{filePath=leaf.view&&leaf.view.file?leaf.view.file.path:null;}catch(_){}',
  'if(!title&&filePath)title=filePath.replace(/\\.md$/,"").split("/").pop();',
  'let pinned=null;try{pinned=leaf.pinned===true;}catch(_){}',
  'return{title:title||"?",viewType,filePath,pinned};});',
  'let selected=null,selectedMethod="none";',
  'try{if(parent.selectedTab){const found=seen.get(parent).indexOf(parent.selectedTab);',
  'if(found>=0){selected=found;selectedMethod="api:selectedTab";}}}catch(_){}',
  'if(selected==null){try{const recent=w.getMostRecentLeaf&&w.getMostRecentLeaf(parent);',
  'if(recent){const found=seen.get(parent).indexOf(recent);',
  'if(found>=0){selected=found;selectedMethod="api:getMostRecentLeaf";}}}catch(_){}}',
  'const hasActive=seen.get(parent).indexOf(active)>=0;',
  'const pinKeys=(()=>{try{return Object.keys(seen.get(parent)[0]||{}).filter((k)=>/pin/i.test(k));}catch(_){return[];}})();',
  'return{rect,tabs,selected,selectedMethod,hasActive,pinKeys};});',
  'indexed.sort((a,b)=>((a.rect&&a.rect.left)||0)-((b.rect&&b.rect.left)||0));',
  'const pinMethod=(()=>{try{const l=w.activeLeaf;return l&&"pinned" in Object(l)?"api:leaf.pinned":"missing:leaf.pinned";}catch(_){return"error";}})();',
  'return{groups:indexed,pinMethod,activePath:(()=>{try{return active&&active.view&&active.view.file?active.view.file.path:null;}catch(_){return null;}})()};',
  '})()',
].join("\n");

function signatureFromLive(live) {
  const groups = live.groups.map((group) => ({
    tabs: group.tabs.map((tab, index) => {
      let mark = null;
      if (group.hasActive && live.activePath != null && tab.filePath === live.activePath) mark = "*";
      else if (group.hasActive && live.activePath == null) mark = index === 0 ? "*" : null;
      else if (index === group.selected) mark = "'";
      return { title: tab.title, pinned: tab.pinned === true, mark };
    }),
  }));
  // Exactly one active tab: if the active leaf is a non-file leaf (PDF/image
  // have files too, so this is only a fallback), mark the first tab of the
  // active group.
  if (!groups.some((group) => group.tabs.some((tab) => tab.mark === "*"))) {
    const fallback = live.groups.findIndex((group) => group.hasActive);
    if (fallback >= 0 && groups[fallback].tabs.length) groups[fallback].tabs[0].mark = "*";
  }
  return wplib.formatLayoutSignature({ groups });
}

async function readLive(client) {
  const live = await client.evaluate(READ_SIGNATURE, RPC_TIMEOUT_MS);
  return { live, signature: signatureFromLive(live) };
}

// Build a main-area layout from a signature: first tab of the first group
// reuses a fresh leaf, later tabs in a group use getLeaf('tab'), and each
// further group starts with getLeaf('split', 'vertical').
const BUILD_FROM_SIGNATURE = [
  '((groups) => (async()=>{const w=window.app.workspace;const parsed={groups};',
  'const existing=[];w.iterateRootLeaves((l)=>existing.push(l));',
  'const clearCalls=[];let clearError=null;',
  'try{for(const l of existing)l.detach();clearCalls.push("leaf.detach");}catch(e){clearError=String(e&&e.message||e);}',
  'await new Promise((r)=>setTimeout(r,400));',
  'let left=0;w.iterateRootLeaves(()=>{left+=1;});',
  'const soleEmpty=()=>{const ks=[];w.iterateRootLeaves((l)=>ks.push(l));if(ks.length!==1)return false;try{return!(ks[0].view&&ks[0].view.file);}catch(_){return false;}};',
  'if(left>0&&!soleEmpty()){',
  'const types={};w.iterateRootLeaves((l)=>{try{types[l.view?l.view.getViewType():"?"]=true;}catch(_){}});',
  'for(const t of Object.keys(types)){if(t==="empty")continue;try{if(typeof w.detachLeavesOfType==="function"){w.detachLeavesOfType(t);clearCalls.push("detachLeavesOfType:"+t);}}catch(e){clearError=String(e&&e.message||e);}}',
  'await new Promise((r)=>setTimeout(r,400));',
  'left=0;w.iterateRootLeaves(()=>{left+=1;});}',
  'if(left>0&&!soleEmpty()){try{let guard=0;while(guard<8){let n=0;w.iterateRootLeaves(()=>{n+=1;});if(n<=1)break;',
  'const one=[];w.iterateRootLeaves((l)=>one.push(l));',
  'try{w.setActiveLeaf(one[0],{focus:true});}catch(_){}',
  'let closed=null;try{closed=await window.app.commands.executeCommandById("workspace:close");}catch(e){clearError=String(e&&e.message||e);break;}',
  'clearCalls.push("workspace:close:"+String(closed));guard+=1;',
  'await new Promise((r)=>setTimeout(r,400));',
  'n=0;w.iterateRootLeaves(()=>{n+=1;});if(n<=1)break;}}catch(e){clearError=String(e&&e.message||e);}',
  'left=0;w.iterateRootLeaves(()=>{left+=1;});}',
  'const kept=[];w.iterateRootLeaves((l)=>kept.push(l));',
  'let reuse=null;try{if(kept.length===1&&!(kept[0].view&&kept[0].view.file))reuse=kept[0];}catch(_){}',
  'if(kept.length>0&&!reuse){let closeCmds=[];try{closeCmds=Object.keys(window.app.commands.commands||{}).filter((id)=>/close/i.test(id));}catch(_){}',
  'let remaining=[];try{for(const l of kept){try{remaining.push({viewType:l.view?l.view.getViewType():null,hasFile:!!(l.view&&l.view.file)});}catch(_){}}}catch(_){}',
  'return{ok:false,error:"clear failed: "+kept.length+" leaves remain",clearCalls,clearError,closeCmds,remaining};}',
  'const byPath={};let first=true,activeLeaf=null;',
  'for(const group of parsed.groups){let groupStarted=false;',
  'for(const tab of group.tabs){const f=window.app.vault.getAbstractFileByPath(tab.title+".md");',
  'if(!f)return{ok:false,error:"missing fixture file "+tab.title};',
  'let leaf;try{if(first){if(reuse){leaf=reuse;}else{leaf=w.getLeaf(true);}first=false;}',
  'else if(!groupStarted){leaf=w.getLeaf("split","vertical");}else{leaf=w.getLeaf("tab");}}',
  'catch(e){return{ok:false,error:"getLeaf failed: "+(e&&e.message||e)}}',
  'try{await leaf.openFile(f,{state:{mode:"source",source:true}});}catch(e){return{ok:false,error:"openFile failed: "+(e&&e.message||e)}}',
  'groupStarted=true;byPath[tab.title]=byPath[tab.title]||[];byPath[tab.title].push(leaf);',
  'if(tab.mark==="*")activeLeaf=leaf;}}',
  'if(activeLeaf){w.setActiveLeaf(activeLeaf,{focus:true});}',
  'await (async()=>{const deadline=Date.now()+8000;while(Date.now()<deadline){let pending=0;',
  'w.iterateRootLeaves((l)=>{try{if(!(l.view&&l.view.file))pending+=1;}catch(_){pending+=1;}});',
  'if(pending===0)return;await new Promise((r)=>setTimeout(r,150));}})();',
  'let unattached=0;w.iterateRootLeaves((l)=>{try{if(!(l.view&&l.view.file))unattached+=1;}catch(_){unattached+=1;}});',
  'if(unattached>0)return{ok:false,error:"views did not attach files: "+unattached,clearCalls};',
  'await new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(r)));',
  'if(w.requestSaveLayout){try{w.requestSaveLayout();}catch(_){}}',
  'return{ok:true,clearCalls};})())',
].join("\n");

function buildInvoke(groups) {
  return BUILD_FROM_SIGNATURE + "(" + JSON.stringify(groups) + ")";
}

async function buildFromSignature(client, signature) {
  const parsed = wplib.parseLayoutSignature(signature);
  const result = await client.evaluate(buildInvoke(parsed.groups), RPC_TIMEOUT_MS);
  if (!result || !result.ok) throw new Error("buildFromSignature failed: " + JSON.stringify(result));
  await sleep(400);
  return result;
}

// The exact move sequence under test for finding 1: reparent the SAME leaf.
const SPIKE_MOVE = [
  '((args) => (async()=>{const w=window.app.workspace;',
  'const found=[];w.iterateRootLeaves((l)=>{if(l.__wpSpikeTag===args.tag)found.push(l);});',
  'if(found.length!==1)return{ok:false,error:"source tag matches "+found.length+" leaves"};',
  'const source=found[0],sourceGroup=source.parent;',
  'if(!sourceGroup||!Array.isArray(sourceGroup.children))return{ok:false,error:"source has no tab group"};',
  'const ordered=[];const seen=new Set();',
  'w.iterateRootLeaves((l)=>{const p=l.parent;if(p&&!seen.has(p)){seen.add(p);ordered.push(p);}});',
  'ordered.sort((a,b)=>{let al=0,bl=0;',
  'try{al=a.containerEl.getBoundingClientRect().left;}catch(_){}',
  'try{bl=b.containerEl.getBoundingClientRect().left;}catch(_){}return al-bl;});',
  'const dest=ordered[args.destGroup];',
  'if(!dest)return{ok:false,error:"no destination group "+args.destGroup};',
  'const srcIndex=sourceGroup.children.indexOf(source);',
  'const srcCount=sourceGroup.children.length;',
  'const calls=[];const note=(n)=>calls.push(n);',
  'try{sourceGroup.removeChild(source);note("removeChild");}catch(e){return{ok:false,error:"removeChild: "+(e&&e.message||e),calls};}',
  'try{dest.insertChild(args.destIndex,source);note("insertChild");}catch(e){return{ok:false,error:"insertChild: "+(e&&e.message||e),calls};}',
  'try{dest.selectTab(source);note("selectTab");}catch(e){return{ok:false,error:"selectTab: "+(e&&e.message||e),calls};}',
  'try{if(dest.recomputeChildrenDimensions){dest.recomputeChildrenDimensions();note("recompute(dest)");}}catch(e){return{ok:false,error:"recompute(dest): "+(e&&e.message||e),calls};}',
  'try{if(sourceGroup!==dest&&sourceGroup.recomputeChildrenDimensions){sourceGroup.recomputeChildrenDimensions();note("recompute(source)");}}catch(e){return{ok:false,error:"recompute(source): "+(e&&e.message||e),calls};}',
  'try{if(w.onLayoutChange){w.onLayoutChange();note("onLayoutChange");}}catch(e){return{ok:false,error:"onLayoutChange: "+(e&&e.message||e),calls};}',
  'try{w.setActiveLeaf(source,{focus:true});note("setActiveLeaf");}catch(e){return{ok:false,error:"setActiveLeaf: "+(e&&e.message||e),calls};}',
  'try{if(w.requestSaveLayout){w.requestSaveLayout();note("requestSaveLayout");}}catch(e){return{ok:false,error:"requestSaveLayout: "+(e&&e.message||e),calls};}',
  'return{ok:true,calls,srcIndex,srcCount};})())',
].join("\n");

function moveInvoke(args) {
  return SPIKE_MOVE + "(" + JSON.stringify(args) + ")";
}

async function spikeMove(client, tag, destGroup, destIndex) {
  const result = await client.evaluate(moveInvoke({ tag, destGroup, destIndex }), RPC_TIMEOUT_MS);
  if (!result || !result.ok) throw new Error("spikeMove failed: " + JSON.stringify(result));
  await sleep(400);
  return result;
}

// Hoisted probe snippets. Every one is a complete invoked expression in the
// `(() => (async () => {...})())()` shape (sync probes use `(()=>{...})()`),
// so the offline self-test can vm-compile each of them verbatim.
const HIST_BACK = [
  '(() => (async () => {',
  'const w = window.app.workspace;',
  'const leaf = w.activeLeaf;',
  'const A = window.app.vault.getAbstractFileByPath("WP-A.md");',
  'const C = window.app.vault.getAbstractFileByPath("WP-C.md");',
  'await leaf.openFile(A); await leaf.openFile(C);',
  'await new Promise((r) => setTimeout(r, 400));',
  'leaf.__wpSpikeTag = "move-hist";',
  'await window.app.commands.executeCommandById("app:go-back");',
  'await new Promise((r) => setTimeout(r, 400));',
  'const afterBack = leaf.view && leaf.view.file ? leaf.view.file.path : null;',
  'await window.app.commands.executeCommandById("app:go-forward");',
  'await new Promise((r) => setTimeout(r, 400));',
  'const afterForward = leaf.view && leaf.view.file ? leaf.view.file.path : null;',
  'const activeStillLeaf = w.activeLeaf === leaf;',
  'return { afterBack, afterForward, activeStillLeaf };',
  '})())()',
].join("\n");

const HIST_FWD = [
  '(() => (async () => {',
  'const w = window.app.workspace;',
  'await window.app.commands.executeCommandById("app:go-back");',
  'await new Promise((r) => setTimeout(r, 400));',
  'const back = w.activeLeaf.view && w.activeLeaf.view.file ? w.activeLeaf.view.file.path : null;',
  'await window.app.commands.executeCommandById("app:go-forward");',
  'await new Promise((r) => setTimeout(r, 400));',
  'const fwd = w.activeLeaf.view && w.activeLeaf.view.file ? w.activeLeaf.view.file.path : null;',
  'return { back, fwd };',
  '})())()',
].join("\n");

const CREATE_PROBE_BEFORE_FALSE = [
  '(() => {',
  'const w = window.app.workspace; const found = [];',
  'w.iterateRootLeaves((l) => { if (l.__wpSpikeTag === "create-src2") found.push(l); });',
  'if (found.length !== 1) return { ok: false, count: found.length };',
  'const leaf = found[0]; const srcRect = leaf.parent.containerEl.getBoundingClientRect().toJSON();',
  'let newLeaf = null, error = null;',
  'try { newLeaf = w.createLeafBySplit(leaf, "vertical", false); } catch (e) { error = e && e.message || String(e); }',
  'if (error) return { ok: false, error };',
  'const groups = []; const seen = new Set();',
  'w.iterateRootLeaves((l) => { const p = l.parent; if (p && !seen.has(p)) { seen.add(p); groups.push(p); } });',
  'const rects = groups.map((g) => { try { return g.containerEl.getBoundingClientRect().toJSON(); } catch (_) { return null; } });',
  'let placeholder = null; try { const kids = newLeaf.parent.children.map((c) => { try { return c.view && c.view.file ? c.view.file.path : (c.view ? c.view.getViewType() : "?"); } catch (_) { return "?"; } }); placeholder = kids; } catch (_) {}',
  'return { ok: true, srcRect, rects, placeholder };',
  '})()',
].join("\n");

const DUP_VERIFY = [
  '(() => {',
  'const w = window.app.workspace;',
  'const tagged = []; const sameFile = [];',
  'w.iterateRootLeaves((l) => { if (l.__wpSpikeTag === "dup-src") tagged.push(l); });',
  'w.iterateRootLeaves((l) => { try { if (l.view && l.view.file && l.view.file.path === "WP-A.md") sameFile.push(l.__wpSpikeTag === "dup-src" ? "source" : "other"); } catch (_) {} });',
  'let activePath = null, activeIsSource = null;',
  'try { activePath = w.activeLeaf.view && w.activeLeaf.view.file ? w.activeLeaf.view.file.path : null; activeIsSource = w.activeLeaf.__wpSpikeTag === "dup-src"; } catch (_) {}',
  'return { tagged: tagged.length, sameFile, activePath, activeIsSource };',
  '})()',
].join("\n");

const READ_OPEN = [
  '(() => (async () => {',
  'const w = window.app.workspace; const out = {};',
  'const openAs = (file, state) => (async () => { const f = window.app.vault.getAbstractFileByPath(file);',
  'const l = w.getLeaf(true); await l.openFile(f, state ? { state } : undefined); return l; })();',
  'const reading = await openAs("WP-D.md", { mode: "preview", source: false });',
  'out.reading = { viewType: reading.view.getViewType(), mode: typeof reading.view.getMode === "function" ? reading.view.getMode() : null,',
  'hasText: (reading.view.containerEl.textContent || "").includes("reading-view delta") };',
  'reading.__wpSpikeTag = "move-reading";',
  'const pdf = await openAs("tiny.pdf");',
  'out.pdf = { viewType: pdf.view.getViewType(), html: (pdf.view.containerEl.innerHTML || "").length };',
  'pdf.__wpSpikeTag = "move-pdf";',
  'const img = await openAs("pixel.png");',
  'const el = img.view.containerEl.querySelector("img");',
  'out.image = { viewType: img.view.getViewType(), complete: el ? el.complete : null, naturalWidth: el ? el.naturalWidth : null };',
  'img.__wpSpikeTag = "move-image";',
  'return out;',
  '})())()',
].join("\n");

const READ_CHECK = [
  '(() => {',
  'const w = window.app.workspace; const out = {};',
  'for (const tag of ["move-reading", "move-pdf", "move-image"]) { const found = [];',
  'w.iterateRootLeaves((l) => { if (l.__wpSpikeTag === tag) found.push(l); });',
  'if (found.length !== 1) { out[tag] = { ok: false, count: found.length }; continue; }',
  'const leaf = found[0]; let extra = {};',
  'try { if (tag === "move-reading") extra = { viewType: leaf.view.getViewType(), hasText: (leaf.view.containerEl.textContent || "").includes("reading-view delta") };',
  'else if (tag === "move-pdf") extra = { viewType: leaf.view.getViewType(), html: (leaf.view.containerEl.innerHTML || "").length };',
  'else { const img = leaf.view.containerEl.querySelector("img"); extra = { viewType: leaf.view.getViewType(), complete: img ? img.complete : null, naturalWidth: img ? img.naturalWidth : null }; } } catch (e) { extra = { error: String(e && e.message || e) }; }',
  'out[tag] = { ok: true, ...extra }; } return out;',
  '})()',
].join("\n");

const POP_NON_TOP = [
  '(() => (async () => {',
  'const out = {};',
  'let Ctor = null;',
  'try { if (typeof Scope !== "undefined") Ctor = Scope; } catch (_) {}',
  'if (!Ctor) Ctor = window.app.scope.constructor;',
  'const s = new Ctor(window.app.scope);',
  'window.__wpScopeFired2 = [];',
  's.register(null, null, (evt) => { try { window.__wpScopeFired2.push(evt && evt.key); } catch (_) {} return false; });',
  'window.app.keymap.pushScope(s);',
  'window.__wpScope2 = s;',
  'out.pushed = true;',
  'await window.app.commands.executeCommandById("command-palette:open");',
  'out.palette = true;',
  'await new Promise((r) => setTimeout(r, 300));',
  'out.modalOpen = !!document.querySelector(".prompt");',
  'try { window.app.keymap.popScope(s); out.popped = true; } catch (e) { out.popError = String(e && e.message || e); }',
  'return out;',
  '})())()',
].join("\n");

const ITERATE_BISECT = [
  '(() => {',
  'const w = window.app.workspace; const out = [];',
  'for (let i = 0; i < 3; i++) {',
  'const a = []; w.iterateRootLeaves((l) => a.push(l));',
  'const b = []; w.iterateRootLeaves((l) => { b.push(l); });',
  'const c = []; w.iterateRootLeaves((l) => { if (l) c.push(l); });',
  'out.push({ exprUncond: a.length, blockUncond: b.length, blockCond: c.length });',
  '}',
  'return out;',
  '})()',
].join("\n");

const DEFERRED_PROBE = [
  '(() => (async () => {',
  'const w = window.app.workspace; const out = {};',
  'const leaves = [];',
  'w.iterateRootLeaves((l) => { leaves.push(l); });',
  'out.allLeaves = leaves.map((l) => { try { return { path: l.view && l.view.file ? l.view.file.path : null, viewType: l.view ? l.view.getViewType() : null }; } catch (_) { return "?"; } });',
  'const bg = leaves.find((l) => l.view && l.view.file && l.view.file.path === "WP-C.md");',
  'if (!bg) return { error: "WP-C leaf missing", allLeaves: out.allLeaves };',
  'out.loadIfDeferred = typeof bg.loadIfDeferred;',
  'try { out.deferredField = ("deferred" in bg) ? bg.deferred : "no-field"; } catch (e) { out.deferredField = "error"; }',
  'try { out.hasView = !!bg.view; out.viewType = bg.view ? bg.view.getViewType() : null; } catch (e) { out.viewProbe = "error"; }',
  'w.setActiveLeaf(bg, { focus: true });',
  'await new Promise((r) => setTimeout(r, 300));',
  'try { out.focusedEditor = !!(bg.view && bg.view.editor); } catch (e) { out.focusedEditor = false; }',
  'bg.__wpSpikeTag = "move-deferred";',
  'return out;',
  '})())()',
].join("\n");

const FACTS_DUMP = [
  '(() => {',
  'const w = window.app.workspace; const out = {};',
  'let cmds = []; try { cmds = Object.keys(window.app.commands.commands || {}); } catch (_) {}',
  'out.allCommands = cmds.slice().sort();',
  'out.focusSplitCommands = cmds.filter((id) => /focus/i.test(id) && /split|tab|group|column/i.test(id));',
  'out.splitCommands = cmds.filter((id) => /split/i.test(id)).slice(0, 40);',
  'out.closeCommands = cmds.filter((id) => /close/i.test(id) && /tab|leaf|pane|split/i.test(id));',
  'out.pinCommands = cmds.filter((id) => /pin/i.test(id));',
  'out.foldCommands = cmds.filter((id) => /fold/i.test(id));',
  'out.historyCommands = { back: cmds.includes("app:go-back"), forward: cmds.includes("app:go-forward") };',
  'out.modActiveTabs = !!document.querySelector(".workspace-tabs.mod-active");',
  'out.modActiveCount = document.querySelectorAll(".workspace-tabs.mod-active").length;',
  'out.getMostRecentLeaf = typeof w.getMostRecentLeaf;',
  'try { const A = window.CodeMirrorAdapter || {}; const Vim = A.Vim || {};',
  'out.adapterKeys = Object.keys(A).slice(0, 50);',
  'out.vimKeys = Object.keys(Vim).slice(0, 120);',
  'out.vimMap = typeof Vim.map; out.vimNmap = typeof Vim.nmap; out.vimNunmap = typeof Vim.unmap;',
  'try { const v = w.activeLeaf.view; const e = v && v.editor;',
  'const cm = (e && e.cm && e.cm.cm) || (v && v.editMode && v.editMode.editor && v.editMode.editor.cm && v.editMode.editor.cm.cm) || null;',
  'const st = cm && cm.state && cm.state.vim;',
  'out.vimState = st ? JSON.stringify(st).slice(0, 2000) : null; } catch (e) { out.vimState = "error:" + (e && e.message || e); } } catch (e) { out.vimProbe = "error:" + (e && e.message || e); }',
  'out.keymapKeys = (() => { try { return Object.keys(window.app.keymap || {}); } catch (_) { return []; } })();',
  'out.pushScope = typeof window.app.keymap.pushScope;',
  'out.hotkeyManager = (() => { try { const h = window.app.hotkeyManager || {}; return { getHotkeys: typeof h.getHotkeys, setHotkeys: typeof h.setHotkeys, getDefaultHotkeys: typeof h.getDefaultHotkeys }; } catch (_) { return "error"; } })();',
  'out.versionProbe = (() => { try { return { appVersion: window.app.version || null, electron: window.process && window.process.versions ? window.process.versions.electron : null }; } catch (e) { return { error: String(e && e.message || e) }; } })();',
  'return out;',
  '})()',
].join("\n");

const CREATE_PROBE = [
  '(() => {',
  'const w = window.app.workspace; const found = [];',
  'w.iterateRootLeaves((l) => { if (l.__wpSpikeTag === "create-src") found.push(l); });',
  'if (found.length !== 1) return { ok: false, count: found.length };',
  'const leaf = found[0]; const srcRect = leaf.parent.containerEl.getBoundingClientRect().toJSON();',
  'let newLeaf = null, error = null;',
  'try { newLeaf = w.createLeafBySplit(leaf, "vertical", true); } catch (e) { error = e && e.message || String(e); }',
  'if (error) return { ok: false, error };',
  'const groups = []; const seen = new Set();',
  'w.iterateRootLeaves((l) => { const p = l.parent; if (p && !seen.has(p)) { seen.add(p); groups.push(p); } });',
  'const rects = groups.map((g) => { try { return g.containerEl.getBoundingClientRect().toJSON(); } catch (_) { return null; } });',
  'let placeholder = null; try { const kids = newLeaf.parent.children.map((c) => { try { return c.view && c.view.file ? c.view.file.path : (c.view ? c.view.getViewType() : "?"); } catch (_) { return "?"; } }); placeholder = kids; } catch (_) {}',
  'let newLeafView = null; try { newLeafView = newLeaf.view ? newLeaf.view.getViewType() : null; } catch (_) {}',
  'return { ok: true, srcRect, rects, placeholder, newLeafView };',
  '})()',
].join("\n");

const DUP_PROBE = [
  '(() => {',
  'const w = window.app.workspace; const found = [];',
  'w.iterateRootLeaves((l) => { if (l.__wpSpikeTag === "dup-src") found.push(l); });',
  'if (found.length !== 1) return { ok: false, count: found.length };',
  'const leaf = found[0]; const srcRect = leaf.parent.containerEl.getBoundingClientRect().toJSON();',
  'let dup = null, error = null;',
  'try { dup = w.duplicateLeaf(leaf, "split", "vertical"); } catch (e) { error = e && e.message || String(e); }',
  'if (error) return { ok: false, error };',
  'const groups = []; const seen = new Set();',
  'w.iterateRootLeaves((l) => { if (l.parent && !seen.has(l.parent)) { seen.add(l.parent); groups.push(l.parent); } });',
  'const rects = groups.map((g) => { try { return g.containerEl.getBoundingClientRect().toJSON(); } catch (_) { return null; } });',
  'let activePath = null, activeTagged = false; try { activePath = w.activeLeaf.view && w.activeLeaf.view.file ? w.activeLeaf.view.file.path : null; activeTagged = w.activeLeaf.__wpSpikeTag === "dup-src"; } catch (_) {}',
  'let dupPath = null; try { dupPath = dup.view && dup.view.file ? dup.view.file.path : null; } catch (_) {}',
  'return { ok: true, srcRect, rects, groupCount: groups.length, activePath, activeTagged, dupPath };',
  '})()',
].join("\n");

// Stepwise scroll diagnostic: which move call resets scrollTop?
const SCROLL_STEPS = [
  '(() => (async () => {',
  'const w = window.app.workspace;',
  'const out = { steps: [] };',
  'const found = [];',
  'w.iterateRootLeaves((l) => { if (l.__wpSpikeTag === "move-scroll") found.push(l); });',
  'if (found.length !== 1) return { ok: false, count: found.length };',
  'const leaf = found[0];',
  'const e = leaf.view.editor;',
  'const cm = e.cm;',
  'const snap = (label) => { try { out.steps.push({ label, scrollTop: cm.scrollDOM.scrollTop }); } catch (err) { out.steps.push({ label, error: String(err && err.message || err) }); } };',
  'snap("before");',
  'const src = leaf.parent;',
  'const ordered = []; const seen = new Set();',
  'w.iterateRootLeaves((l) => { const p = l.parent; if (p && !seen.has(p)) { seen.add(p); ordered.push(p); } });',
  'ordered.sort((a, b) => { let al = 0, bl = 0;',
  'try { al = a.containerEl.getBoundingClientRect().left; } catch (_) {}',
  'try { bl = b.containerEl.getBoundingClientRect().left; } catch (_) {} return al - bl; });',
  'const dest = ordered[1];',
  'if (!dest) return { ok: false, error: "no destination group" };',
  'src.removeChild(leaf); snap("after-removeChild");',
  'dest.insertChild(0, leaf); snap("after-insertChild");',
  'dest.selectTab(leaf); snap("after-selectTab");',
  'if (dest.recomputeChildrenDimensions) dest.recomputeChildrenDimensions(); snap("after-recompute");',
  'if (w.onLayoutChange) w.onLayoutChange(); snap("after-onLayoutChange");',
  'w.setActiveLeaf(leaf, { focus: true }); snap("after-setActiveLeaf");',
  'if (w.requestSaveLayout) w.requestSaveLayout(); snap("after-requestSaveLayout");',
  'out.cursor = { line: e.getCursor().line, ch: e.getCursor().ch };',
  'return { ok: true, steps: out.steps, cursor: out.cursor };',
  '})())()',
].join("\n");

// PROBE_SNIPPETS is defined at the end of this file, after every snippet
// const it references.

async function reloadAndReconnect(port, fixturePath, shouldStop, priorClient) {
  if (priorClient) priorClient.close();
  // A reload kills the CDP socket; re-select the target and reconnect.
  await sleep(1500);
  const target = await selectTarget(port, fixturePath, shouldStop);
  const client = await Cdp.connect(target.webSocketDebuggerUrl, lib.CONNECT_TIMEOUT_MS);
  await client.call("Page.enable", {});
  await client.call("Runtime.enable", {});
  await waitFor(client, "Boolean(window.app&&window.app.workspace&&window.app.workspace.layoutReady)", Boolean, "layout-ready after reload", lib.LAYOUT_READY_TIMEOUT_MS);
  await sleep(1000);
  return client;
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

function tagSnippet(argsJson) {
  return [
    '((args) => {const w=window.app.workspace;const found=[];',
    'w.iterateRootLeaves((l)=>{if(l.view&&l.view.file&&l.view.file.path===args.path)found.push(l);});',
    'if(found.length!==1)return{ok:false,count:found.length,path:args.path};',
    'const leaf=found[0];leaf.__wpSpikeTag=args.tag;',
    'try{if(leaf.view&&leaf.view.editor)leaf.view.editor.__wpSpikeEditorTag=args.tag;}catch(_){}',
    'return{ok:true};})(' + argsJson + ')',
  ].join("\n");
}

async function tagLeafByPath(client, filePath, tag) {
  const result = await client.evaluate(tagSnippet(JSON.stringify({ path: filePath, tag })), RPC_TIMEOUT_MS);
  if (!result || !result.ok) throw new Error("tagLeafByPath failed: " + JSON.stringify(result));
  return result;
}

const DUMP_EDITOR = [
  '(()=>{const v=window.app.workspace.activeLeaf.view,e=v&&v.editor;',
  'if(!e)return{ok:false,error:"no active editor"};',
  'const outerCm=e.cm;let scrollTop=null,scrollMethod="missing";',
  'try{if(outerCm&&outerCm.scrollDOM){scrollTop=outerCm.scrollDOM.scrollTop;scrollMethod="cm.scrollDOM.scrollTop";}}catch(_){scrollMethod="error";}',
  'let folds=null,foldsMethod="missing";',
  'try{if(typeof e.getFoldOffsets==="function"){folds=e.getFoldOffsets();foldsMethod="editor.getFoldOffsets";}}catch(_){foldsMethod="error";}',
  'let vimPresent=false,vimMode=null;',
  'try{const cm=(e&&e.cm&&e.cm.cm)||(v&&v.editMode&&v.editMode.editor&&v.editMode.editor.cm&&v.editMode.editor.cm.cm)||null;',
  'const st=cm&&cm.state&&cm.state.vim;vimPresent=!!st;',
  'if(st){if(st.insertMode===true)vimMode="insert";else if(st.visualMode===true)vimMode="visual";else if(st.replaceMode===true)vimMode="replace";else if(typeof st.mode==="string")vimMode=st.mode;else vimMode="normal";}}catch(_){}',
  'return{ok:true,text:e.getValue(),cursor:e.getCursor(),scrollTop,scrollMethod,folds,foldsMethod,vimPresent,vimMode};})()',
].join("\n");

async function dumpEditor(client) {
  const result = await client.evaluate(DUMP_EDITOR, RPC_TIMEOUT_MS);
  if (!result || !result.ok) throw new Error("dumpEditor failed: " + JSON.stringify(result));
  return result;
}

async function placeCursor(client, line, ch) {
  await client.evaluate(
    '(()=>{const e=window.app.workspace.activeLeaf.view.editor;e.setCursor({line:' + line + ',ch:' + ch + '});if(e.focus)e.focus();return true;})()',
    RPC_TIMEOUT_MS,
  );
}

const VIM_PROBE = [
  '(() => {',
  'try { const l = window.app.workspace.activeLeaf;',
  'const v = l && l.view; const e = v && v.editor;',
  'const cm = (e && e.cm && e.cm.cm) || (v && v.editMode && v.editMode.editor && v.editMode.editor.cm && v.editMode.editor.cm.cm) || null;',
  'const st = cm && cm.state && cm.state.vim;',
  'let vimMode = null;',
  'try { if (st) { if (st.insertMode === true) vimMode = "insert"; else if (st.visualMode === true) vimMode = "visual"; else if (st.replaceMode === true) vimMode = "replace"; else if (typeof st.mode === "string") vimMode = st.mode; else vimMode = "normal"; } } catch (_) {}',
  'return { activePath: v && v.file ? v.file.path : null, viewType: v && typeof v.getViewType === "function" ? v.getViewType() : null,',
  'hasEditor: !!e, hasCm: !!cm, vimPresent: !!st, vimMode,',
  'outerHasStateVim: !!(e && e.cm && e.cm.state && e.cm.state.vim) };',
  '} catch (err) { return { error: String(err && err.message || err) }; }',
  '})()',
].join("\n");

async function vimProbe(client) {
  return client.evaluate(VIM_PROBE, RPC_TIMEOUT_MS);
}

// Views attach their editor (and the Vim state) asynchronously after
// openFile resolves; poll instead of assuming a fixed sleep is enough.
async function waitForVim(client, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 8000);
  let last = null;
  while (Date.now() < deadline) {
    last = await vimProbe(client);
    if (last && last.vimPresent) return last;
    await sleep(200);
  }
  return last;
}

// Finding 1 core: same leaf + editor, undo, cursor, scroll survive the move.
async function spikeMoveLossless(client, record, findings) {
  await runCase(record, "spike/move-lossless", async () => {
    await buildFromSignature(client, "[ WP-A  WP-B* ] | [ WP-C  WP-D ]");
    const before = await readLive(client);
    const titlesBefore = before.live.groups.map((group) => group.tabs.map((tab) => tab.title));
    if (JSON.stringify(titlesBefore) !== JSON.stringify([["WP-A", "WP-B"], ["WP-C", "WP-D"]])) {
      throw new Error("build did not produce the join fixture: " + before.signature);
    }
    if (before.live.activePath !== "WP-B.md") throw new Error("WP-B is not active: " + before.signature);
    await tagLeafByPath(client, "WP-B.md", "move-core");
    const expectedBody = wplib.seedNotes().get("WP-B.md");
    await keys(client, ["Escape"]);
    const sane = await dumpEditor(client);
    if (sane.text !== expectedBody) throw new Error("editor text does not match the fixture body");
    await placeCursor(client, 2, 0);
    await keys(client, ["i"]);
    await client.call("Input.insertText", { text: "SPIKE " });
    await keys(client, ["Escape"]);
    const typed = await dumpEditor(client);
    if (!typed.text.includes("SPIKE spike cursor line bravo")) {
      throw new Error("typed text did not land: " + JSON.stringify(typed.text.slice(0, 120)));
    }
    const move = await spikeMove(client, "move-core", 1, 1);
    const after = await readLive(client);
    const titlesAfter = after.live.groups.map((group) => group.tabs.map((tab) => tab.title));
    if (JSON.stringify(titlesAfter) !== JSON.stringify([["WP-A"], ["WP-C", "WP-B", "WP-D"]])) {
      throw new Error("post-move layout is wrong: " + after.signature);
    }
    if (after.live.activePath !== "WP-B.md") throw new Error("moved tab is not active: " + after.signature);
    const check = await client.evaluate(
      [
        '(()=>{const w=window.app.workspace;const found=[];',
        'w.iterateRootLeaves((l)=>{if(l.__wpSpikeTag==="move-core")found.push(l);});',
        'if(found.length!==1)return{ok:false,count:found.length};',
        'const leaf=found[0];let editorTag=null;try{editorTag=leaf.view&&leaf.view.editor?leaf.view.editor.__wpSpikeEditorTag||null:null;}catch(_){}',
        'let groupSize=null,destTitles=[];try{groupSize=leaf.parent.children.length;',
        'destTitles=leaf.parent.children.map((c)=>{try{return c.view&&c.view.file?c.view.file.basename:"?";}catch(_){return"?";}});}catch(_){}',
        'return{ok:true,editorTag,groupSize,destTitles,activeIsMoved:w.activeLeaf===leaf};})()',
      ].join("\n"),
      RPC_TIMEOUT_MS,
    );
    if (!check || !check.ok) throw new Error("moved leaf is missing or duplicated: " + JSON.stringify(check));
    if (check.editorTag !== "move-core") throw new Error("editor instance changed across the move");
    if (!check.activeIsMoved) throw new Error("active leaf is not the moved leaf");
    const moved = await dumpEditor(client);
    if (moved.text !== typed.text) throw new Error("move changed the document text");
    if (moved.cursor.line !== typed.cursor.line || moved.cursor.ch !== typed.cursor.ch) {
      throw new Error(`cursor moved: ${JSON.stringify(typed.cursor)} -> ${JSON.stringify(moved.cursor)}`);
    }
    await keys(client, ["u"]);
    await sleep(150);
    const undone = await dumpEditor(client);
    if (undone.text !== expectedBody) throw new Error("u after the move did not restore the fixture text");
    findings.move = {
      lossless: true,
      sequence: move.calls,
      srcIndex: move.srcIndex,
      srcCount: move.srcCount,
      sameLeaf: check.ok,
      sameEditor: check.editorTag === "move-core",
      undo: true,
      cursor: true,
      note: "removeChild/insertChild/selectTab + recompute/onLayoutChange/setActiveLeaf/requestSaveLayout; source had siblings so no collapse here",
    };
    return "same leaf+editor, undo, cursor verified; calls=" + move.calls.join(",");
  });

  await runCase(record, "spike/move-scroll", async () => {
    const lines = Array.from({ length: 200 }, (_, i) => `tall filler row ${i + 1}`);
    await client.evaluate(
      '(() => (async () => { await window.app.vault.create("WP-TALL.md", ' + JSON.stringify(lines.join("\n")) + '); return true; })())()',
      RPC_TIMEOUT_MS,
    );
    await buildFromSignature(client, "[ WP-TALL*  WP-A ] | [ WP-B  WP-C ]");
    await tagLeafByPath(client, "WP-TALL.md", "move-scroll");
    // Cursor on line 8 stays visible at scrollTop 120, so a focus-driven
    // scroll-into-view has no reason to move the viewport.
    await placeCursor(client, 8, 0);
    const set = await client.evaluate(
      '(()=>{const e=window.app.workspace.activeLeaf.view.editor;if(!e||!e.cm||!e.cm.scrollDOM)return{ok:false};e.cm.scrollDOM.scrollTop=120;return{ok:true,read:e.cm.scrollDOM.scrollTop};})()',
      RPC_TIMEOUT_MS,
    );
    if (!set || !set.ok || set.read !== 120) {
      record("spike/move-scroll", "skipped", "scrollDOM missing or clamped: " + JSON.stringify(set));
      findings.move.scroll = "skipped: no settable scrollDOM";
      return "__skip__";
    }
    const steps = await client.evaluate(SCROLL_STEPS, RPC_TIMEOUT_MS);
    if (!steps || !steps.ok) throw new Error("stepwise move failed: " + JSON.stringify(steps));
    const first = steps.steps.find((step, index) => index > 0 && step.scrollTop !== steps.steps[0].scrollTop);
    findings.move.scrollSteps = steps.steps;
    findings.move.scrollResetAt = first ? first.label : null;
    if (steps.cursor.line !== 8) throw new Error("cursor moved mid-move: " + JSON.stringify(steps.cursor));
    if (steps.steps[steps.steps.length - 1].scrollTop === 120) {
      findings.move.scroll = true;
      return "scrollTop 120 preserved across every move call";
    }
    // selectTab resets the viewport (diagnostic above names the call), so the
    // executor must restore it: prove the restore sticks post-move.
    const restored = await client.evaluate(
      '(()=>{const w=window.app.workspace;const found=[];w.iterateRootLeaves((l)=>{if(l.__wpSpikeTag==="move-scroll")found.push(l);});if(found.length!==1)return{ok:false};const e=found[0].view.editor;e.cm.scrollDOM.scrollTop=120;return{ok:true,read:e.cm.scrollDOM.scrollTop,cursor:{line:e.getCursor().line,ch:e.getCursor().ch}};})()',
      RPC_TIMEOUT_MS,
    );
    if (!restored || !restored.ok || restored.read !== 120 || restored.cursor.line !== 8) {
      throw new Error("scroll restore does not stick post-move: " + JSON.stringify({ steps: steps.steps, restored }));
    }
    findings.move.scroll = { selectTabResets: true, restoreWorks: true };
    return "selectTab resets scrollTop 120->0; manual restore post-move sticks";
  });

  await runCase(record, "spike/move-folds-pin-history", async () => {
    const commands = await client.evaluate(
      '(()=>Object.keys(window.app.commands.commands||{}))()',
      RPC_TIMEOUT_MS,
    );
    const foldCmds = commands.filter((id) => /fold/i.test(id));
    const pinCmds = commands.filter((id) => /pin/i.test(id));
    const hasBack = commands.includes("app:go-back");
    const hasForward = commands.includes("app:go-forward");
    findings.move.foldCommands = foldCmds;
    findings.move.pinCommands = pinCmds;
    findings.move.historyCommands = { back: hasBack, forward: hasForward };
    const notes = [];
    await buildFromSignature(client, "[ WP-A  WP-B* ] | [ WP-C  WP-D ]");
    await tagLeafByPath(client, "WP-B.md", "move-aux");
    // Drive the leaf API directly: the nav plugin's own toggleCurrentTabPin
    // calls leaf.togglePinned().
    const pinToggle = await client.evaluate(
      '(()=>{const w=window.app.workspace;const found=[];w.iterateRootLeaves((l)=>{if(l.__wpSpikeTag==="move-aux")found.push(l);});if(!found.length)return{ok:false};const leaf=found[0];const out={togglePinned:typeof leaf.togglePinned,pinnedBefore:leaf.pinned===true};try{if(typeof leaf.togglePinned==="function")leaf.togglePinned();}catch(e){out.toggleError=String(e&&e.message||e);}return{ok:true,...out};})()',
      RPC_TIMEOUT_MS,
    );
    await sleep(300);
    const pinBefore = await client.evaluate(
      '(()=>{const w=window.app.workspace;const found=[];w.iterateRootLeaves((l)=>{if(l.__wpSpikeTag==="move-aux")found.push(l);});if(!found.length)return{ok:false};const leaf=found[0];return{ok:true,pinned:leaf.pinned===true,pinKeys:Object.keys(leaf).filter((k)=>/pin/i.test(k)),via:leaf.__wpSpikeTag};})()',
      RPC_TIMEOUT_MS,
    );
    findings.move.pinToggle = pinToggle;
    let foldsBefore = { foldsMethod: "missing" };
    if (foldCmds.length) {
      await placeCursor(client, 5, 0);
      await client.evaluate(
        '(() => (async()=>window.app.commands.executeCommandById(' + JSON.stringify(foldCmds[0]) + ')))()',
        RPC_TIMEOUT_MS,
      );
      await sleep(200);
      foldsBefore = await dumpEditor(client);
    } else {
      notes.push("no fold command found; fold sub-probe skipped");
    }
    await spikeMove(client, "move-aux", 1, 1);
    const pinAfter = await client.evaluate(
      '(()=>{const w=window.app.workspace;const found=[];w.iterateRootLeaves((l)=>{if(l.__wpSpikeTag==="move-aux")found.push(l);});if(!found.length)return{ok:false};const leaf=found[0];return{ok:true,pinned:leaf.pinned===true,pinKeys:Object.keys(leaf).filter((k)=>/pin/i.test(k))};})()',
      RPC_TIMEOUT_MS,
    );
    const movedDump = await dumpEditor(client);
    if (!pinToggle || !pinToggle.ok) {
      findings.move.pin = "blocked: tagged leaf not found for pin toggle";
      notes.push("pin sub-probe blocked: tagged leaf missing");
    } else if (pinToggle.togglePinned !== "function") {
      findings.move.pin = "blocked: leaf.togglePinned is " + pinToggle.togglePinned;
      notes.push("pin sub-probe blocked: no leaf.togglePinned API");
    } else if (!pinBefore.ok || pinBefore.pinned !== true) {
      findings.move.pin = { pinned: false, toggle: pinToggle, read: pinBefore };
      notes.push("togglePinned() did not pin the leaf; pin survival untested");
    } else if (!pinAfter.ok) {
      findings.move.pin = "blocked: moved leaf unreadable";
      notes.push("pin sub-probe blocked after move");
    } else {
      if (pinAfter.pinned !== true) {
        throw new Error("pin lost across the move: " + JSON.stringify({ before: pinBefore, after: pinAfter }));
      }
      notes.push(`pin survived (keys=${pinAfter.pinKeys.join(",") || "none"})`);
      findings.move.pin = true;
      await client.evaluate(
        '(()=>{const w=window.app.workspace;const found=[];w.iterateRootLeaves((l)=>{if(l.__wpSpikeTag==="move-aux")found.push(l);});try{if(found[0]&&typeof found[0].togglePinned==="function"&&found[0].pinned===true)found[0].togglePinned();}catch(_){}return true;})()',
        RPC_TIMEOUT_MS,
      );
    }
    if (foldCmds.length && foldsBefore.foldsMethod !== "missing") {
      if (JSON.stringify(movedDump.folds) !== JSON.stringify(foldsBefore.folds)) {
        throw new Error("fold offsets changed across the move: " + JSON.stringify({ before: foldsBefore.folds, after: movedDump.folds }));
      }
      notes.push("fold offsets identical across the move");
      findings.move.folds = true;
    } else {
      findings.move.folds = "skipped: " + (foldCmds.length ? "folds unreadable" : "no fold command");
    }
    findings.move.historyCommands = { back: hasBack, forward: hasForward, pending: true };
    notes.push("history moves to its own case");
    return notes.join("; ");
  });

  await runCase(record, "spike/move-history", async () => {
    const commands = await client.evaluate(
      '(()=>Object.keys(window.app.commands.commands||{}))()',
      RPC_TIMEOUT_MS,
    );
    const hasBack = commands.includes("app:go-back");
    const hasForward = commands.includes("app:go-forward");
    if (!hasBack || !hasForward) {
      findings.move.history = "skipped: no app:go-back/app:go-forward commands";
      record("spike/move-history", "skipped", "no go-back/go-forward commands");
      return "__skip__";
    }
    await buildFromSignature(client, "[ WP-A  WP-B* ] | [ WP-C  WP-D ]");
    const history = await client.evaluate(HIST_BACK, RPC_TIMEOUT_MS);
    if (!history || history.afterBack !== "WP-A.md" || !history.activeStillLeaf) {
      findings.move.history = { baselineBack: false, detail: history };
      throw new Error("baseline go-back navigation failed: " + JSON.stringify(history));
    }
    // go-forward is asymmetric at baseline in this build (stays on A after a
    // working go-back); record it and keep it out of the survival gate.
    const forwardWorksAtBaseline = history.afterForward === "WP-C.md";
    await spikeMove(client, "move-hist", 0, 0);
    const survived = await client.evaluate(HIST_FWD, RPC_TIMEOUT_MS);
    if (!survived || survived.back !== "WP-A.md") {
      findings.move.history = { backSurvives: false, detail: survived, forwardWorksAtBaseline };
      throw new Error("go-back did not survive the move: " + JSON.stringify(survived));
    }
    findings.move.history = { backSurvives: true, forwardWorksAtBaseline, forwardAfterMove: survived.fwd };
    return "go-back navigates identically after the move (forward asymmetric at baseline)";
  });

  await runCase(record, "spike/move-reading-pdf-image", async () => {
    await buildFromSignature(client, "[ WP-A  WP-B* ] | [ WP-C  WP-D ]");
    const results = await client.evaluate(READ_OPEN, RPC_TIMEOUT_MS);
    if (!results || !results.reading || !results.pdf || !results.image) {
      throw new Error("non-markdown leaves did not open: " + JSON.stringify(results));
    }
    await spikeMove(client, "move-reading", 0, 0);
    await spikeMove(client, "move-pdf", 0, 0);
    await spikeMove(client, "move-image", 0, 0);
    const check = await client.evaluate(READ_CHECK, RPC_TIMEOUT_MS);
    const problems = [];
    if (results.reading.viewType !== "markdown" || !results.reading.hasText) {
      problems.push("reading leaf did not mount: " + JSON.stringify(results.reading));
    } else if (!check["move-reading"].ok || check["move-reading"].viewType !== "markdown" || !check["move-reading"].hasText) {
      problems.push("reading leaf broke across the move: " + JSON.stringify(check["move-reading"]));
    }
    if (results.pdf.viewType !== "pdf") problems.push("pdf leaf did not mount: " + JSON.stringify(results.pdf));
    else if (!check["move-pdf"].ok || check["move-pdf"].viewType !== "pdf" || !(check["move-pdf"].html > 0)) {
      problems.push("pdf leaf broke across the move: " + JSON.stringify(check["move-pdf"]));
    }
    if (results.image.viewType !== "image") problems.push("image leaf did not mount: " + JSON.stringify(results.image));
    else if (!check["move-image"].ok || check["move-image"].viewType !== "image" || check["move-image"].complete !== true) {
      problems.push("image leaf broke across the move: " + JSON.stringify(check["move-image"]));
    }
    if (problems.length) throw new Error(problems.join(" // "));
    findings.move.nonMarkdown = {
      reading: check["move-reading"],
      pdf: check["move-pdf"],
      image: check["move-image"],
    };
    return "reading, pdf, and image leaves render after reparenting";
  });
}

// Finding 2: last-tab-out collapse, width redistribution, reload survival.
async function spikeCollapse(ctx, record, findings) {
  await runCase(record, "spike/collapse-and-reload", async () => {
    const { client, port, fixturePath, shouldStop } = ctx;
    await buildFromSignature(client, "[ WP-A  WP-B ] | [ WP-C* ]");
    const before = await readLive(client);
    if (before.live.groups.length !== 2) throw new Error("expected two groups: " + before.signature);
    const leftBefore = before.live.groups[0].rect ? before.live.groups[0].rect.width : null;
    const closeCalls = [];
    const detach = await client.evaluate(
      '(()=>{const w=window.app.workspace;const leaf=w.activeLeaf;const parent=leaf.parent;const before=parent.children.length;try{leaf.detach();}catch(e){return{ok:false,error:String(e&&e.message||e),before};}return{ok:true,before};})()',
      RPC_TIMEOUT_MS,
    );
    closeCalls.push("leaf.detach:" + (detach && detach.ok ? "ok" : "fail:" + JSON.stringify(detach)));
    await sleep(600);
    let after = await readLive(client);
    if (after.live.groups.length !== 1) {
      const closed = await client.evaluate(
        '(() => (async () => { try { return { closed: await window.app.commands.executeCommandById("workspace:close") }; } catch (e) { return { error: String(e && e.message || e) }; } })())()',
        RPC_TIMEOUT_MS,
      );
      closeCalls.push("workspace:close:" + JSON.stringify(closed));
      await sleep(600);
      after = await readLive(client);
    }
    const autoCollapsed = after.live.groups.length === 1;
    const leftAfter = autoCollapsed && after.live.groups[0].rect ? after.live.groups[0].rect.width : null;
    const widthGrew = leftBefore != null && leftAfter != null ? leftAfter > leftBefore : null;
    const titles = autoCollapsed ? after.live.groups[0].tabs.map((tab) => tab.title) : null;
    if (!autoCollapsed) {
      findings.collapse = { autoCollapsed: false, closeCalls, note: "last-tab removal left an empty split behind: " + after.signature };
      throw new Error("no auto-collapse; explicit call unknown: " + after.signature);
    }
    if (JSON.stringify(titles) !== JSON.stringify(["WP-A", "WP-B"])) {
      throw new Error("collapsed group has wrong tabs: " + after.signature);
    }
    await client.evaluate('(()=>{if(window.app.workspace.requestSaveLayout)window.app.workspace.requestSaveLayout();return true;})()', RPC_TIMEOUT_MS);
    await sleep(800);
    ctx.client = await reloadAndReconnect(port, fixturePath, shouldStop, client);
    const reloaded = await readLive(ctx.client);
    const reloadedTitles = reloaded.live.groups.length === 1
      ? reloaded.live.groups[0].tabs.map((tab) => tab.title)
      : [];
    if (reloaded.live.groups.length !== 1 || JSON.stringify(reloadedTitles) !== JSON.stringify(["WP-A", "WP-B"])) {
      throw new Error("layout did not survive reload: " + reloaded.signature);
    }
    findings.collapse = {
      autoCollapsed: true,
      closeCalls,
      widthBefore: leftBefore,
      widthAfter: leftAfter,
      widthRedistributed: widthGrew,
      survivedReload: true,
      preSig: before.signature,
      postSig: after.signature,
      reloadedSig: reloaded.signature,
    };
    return `collapsed 2->1 groups, width ${Math.round(leftBefore || 0)}->${Math.round(leftAfter || 0)}, reload-stable`;
  });
}

// Finding 3: createLeafBySplit placement and duplicateLeaf landing.
async function spikeCreate(client, record, findings) {
  await runCase(record, "spike/create-and-duplicate", async () => {
    await buildFromSignature(client, "[ WP-A* ]");
    await tagLeafByPath(client, "WP-A.md", "create-src");
    const created = await client.evaluate(CREATE_PROBE, RPC_TIMEOUT_MS);
    if (!created || !created.ok) throw new Error("createLeafBySplit failed: " + JSON.stringify(created));
    if (!Array.isArray(created.rects) || created.rects.length !== 2) {
      throw new Error("expected two splits after create: " + JSON.stringify(created.rects));
    }
    const [first, second] = created.rects;
    const newOnLeft = first.left < created.srcRect.left - 1 && Math.abs(second.left - created.srcRect.left) < 2;
    const newOnRight = second.left > created.srcRect.left + 1 && Math.abs(first.left - created.srcRect.left) < 2;
    if (!newOnLeft && !newOnRight) {
      throw new Error("create placement is ambiguous: " + JSON.stringify({ src: created.srcRect, rects: created.rects }));
    }
    await buildFromSignature(client, "[ WP-A* ]");
    await tagLeafByPath(client, "WP-A.md", "dup-src");
    const duped = await client.evaluate(DUP_PROBE, RPC_TIMEOUT_MS);
    if (!duped || !duped.ok) throw new Error("duplicateLeaf failed: " + JSON.stringify(duped));
    if (duped.groupCount !== 2) throw new Error("duplicate did not create a split: " + JSON.stringify(duped));
    // The newborn view may mount its file asynchronously; re-read before judging.
    await sleep(800);
    const verified = await client.evaluate(DUP_VERIFY, RPC_TIMEOUT_MS);
    findings.create = {
      beforeTrueOnLeft: newOnLeft,
      beforeTrueOnRight: newOnRight,
      createRects: { src: created.srcRect, splits: created.rects },
      placeholder: created.placeholder,
      duplicateImmediate: { activePath: duped.activePath, dupPath: duped.dupPath, groupCount: duped.groupCount },
      duplicateVerify: verified,
      duplicateRects: { src: duped.srcRect, splits: duped.rects },
    };
    if (!verified || verified.tagged !== 1 || verified.sameFile.length !== 2) {
      throw new Error("duplicate did not leave source + one same-file leaf: " + JSON.stringify(verified));
    }
    if (verified.activePath !== "WP-A.md" || verified.activeIsSource !== false) {
      throw new Error("duplicate did not focus a NEW leaf on the same note: " + JSON.stringify(verified));
    }
    findings.create.duplicateFocusesNewLeaf = true;
    await buildFromSignature(client, "[ WP-A* ]");
    await tagLeafByPath(client, "WP-A.md", "create-src2");
    const createdFalse = await client.evaluate(CREATE_PROBE_BEFORE_FALSE, RPC_TIMEOUT_MS);
    if (!createdFalse || !createdFalse.ok) throw new Error("createLeafBySplit(before=false) failed: " + JSON.stringify(createdFalse));
    if (!Array.isArray(createdFalse.rects) || createdFalse.rects.length !== 2) {
      throw new Error("expected two splits after create(false): " + JSON.stringify(createdFalse.rects));
    }
    const [f0, f1] = createdFalse.rects;
    const falseOnLeft = f0.left < createdFalse.srcRect.left - 1 && Math.abs(f1.left - createdFalse.srcRect.left) < 2;
    const falseOnRight = f1.left > createdFalse.srcRect.left + 1 && Math.abs(f0.left - createdFalse.srcRect.left) < 2;
    findings.create.beforeFalse = {
      onLeft: falseOnLeft,
      onRight: falseOnRight,
      rects: { src: createdFalse.srcRect, splits: createdFalse.rects },
      placeholder: createdFalse.placeholder,
    };
    if (!falseOnLeft && !falseOnRight) {
      throw new Error("create(false) placement is ambiguous: " + JSON.stringify({ src: createdFalse.srcRect, rects: createdFalse.rects }));
    }
    return `createLeafBySplit(before=true) new split on the ${newOnLeft ? "left" : "right"}; before=false on the ${falseOnLeft ? "left" : "right"}; duplicateLeaf focuses a new leaf on the same note`;
  });
}

const RECORDER_INSTALL = [
  '(()=>{window.__wpEvents=[];',
  'window.__wpCap=(e)=>{try{if(e.key==="w"&&e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.repeat)window.__wpEvents.push({phase:"capture",defaultPrevented:!!e.defaultPrevented});}catch(_){}};',
  'window.__wpBub=(e)=>{try{if(e.key==="w"&&e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.repeat)window.__wpEvents.push({phase:"bubble",defaultPrevented:!!e.defaultPrevented});}catch(_){}};',
  'window.addEventListener("keydown",window.__wpCap,true);',
  'document.addEventListener("keydown",window.__wpBub,false);',
  'return true;})()',
].join("\n");
const RECORDER_READ = '(()=>({events:window.__wpEvents||[]}))()';
const RECORDER_REMOVE = '(()=>{try{window.removeEventListener("keydown",window.__wpCap,true);}catch(_){}try{document.removeEventListener("keydown",window.__wpBub,false);}catch(_){}window.__wpEvents=[];return true;})()';
const LEAF_COUNT = '(()=>{let n=0;window.app.workspace.iterateRootLeaves(()=>{n+=1;});return n;})()';
const MODAL_OPEN = '(()=>!!document.querySelector(".prompt"))()';

async function leafCount(client) {
  return client.evaluate(LEAF_COUNT, RPC_TIMEOUT_MS);
}

// Finding 4 (mac side): (a) unbound Ctrl+W order + defaultPrevented,
// (c) pushed catch-all Scope preemption, (d) popScope off the top,
// (e) insert-mode pass-through word delete.
async function spikeKeyboardMac(client, record, findings) {
  findings.keyboard = findings.keyboard || {};
  await runCase(record, "spike/keyboard-unbound-capture", async () => {
    await buildFromSignature(client, "[ WP-A*  WP-B ]");
    await keys(client, ["Escape"]);
    const before = await leafCount(client);
    await client.evaluate(RECORDER_INSTALL, RPC_TIMEOUT_MS);
    await key(client, { key: "w", code: "KeyW", modifiers: 2, text: "" });
    const seen = await client.evaluate(RECORDER_READ, RPC_TIMEOUT_MS);
    const after = await leafCount(client);
    const dump = await dumpEditor(client);
    await client.evaluate(RECORDER_REMOVE, RPC_TIMEOUT_MS);
    if (!seen.events.length || seen.events[0].phase !== "capture") {
      throw new Error("window capture listener did not see Ctrl+W first: " + JSON.stringify(seen));
    }
    if (seen.events.some((event) => event.defaultPrevented)) {
      throw new Error("Ctrl+W was already defaultPrevented at capture: " + JSON.stringify(seen));
    }
    if (after !== before) throw new Error(`leaf count changed ${before} -> ${after}`);
    if (dump.vimMode && dump.vimMode !== "normal") throw new Error("Vim mode changed: " + dump.vimMode);
    findings.keyboard.a = { order: seen.events.map((event) => event.phase), defaultPrevented: false, leavesUnchanged: true };
    return "capture before bubble, not defaultPrevented, no close";
  });

  await runCase(record, "spike/keyboard-scope-preemption", async () => {
    const discovery = await client.evaluate(
      [
        '(()=>{const out={scopeGlobal:typeof Scope,keymapKeys:[],pushScope:false,popScope:false,haveCtor:false,constructed:false,registerCatchAll:false,ctorSource:null,constructError:null};',
        'try{out.keymapKeys=Object.keys(window.app.keymap||{});}catch(_){}',
        'out.pushScope=typeof window.app.keymap.pushScope==="function";',
        'out.popScope=typeof window.app.keymap.popScope==="function";',
        'let Ctor=null;',
        'try{if(typeof Scope!=="undefined")Ctor=Scope;}catch(_){}',
        'if(Ctor)out.ctorSource="global";',
        'if(!Ctor){try{if(window.app.scope&&window.app.scope.constructor){Ctor=window.app.scope.constructor;out.ctorSource="app.scope.constructor";}}catch(_){}}',
        'out.haveCtor=!!Ctor;',
        'if(Ctor){try{const s=new Ctor();out.constructed=true;out.registerCatchAll=typeof s.register==="function";}catch(e){out.constructError=String(e&&e.message||e);',
        'try{const s2=new Ctor(window.app.scope);out.constructed=true;out.registerCatchAll=typeof s2.register==="function";out.ctorSource=(out.ctorSource||"ctor")+"(with-parent-arg)";}catch(e2){out.constructError=String(e2&&e2.message||e2);}}}',
        'return out;})()',
      ].join("\n"),
      RPC_TIMEOUT_MS,
    );
    findings.keyboard.scopeDiscovery = discovery;
    if (!discovery.constructed || !discovery.registerCatchAll || !discovery.pushScope) {
      findings.keyboard.c = { blocked: true, discovery };
      record("spike/keyboard-scope-preemption", "skipped", "no constructible catch-all Scope from the console: " + JSON.stringify(discovery));
      findings.keyboard.d = "skipped: same Scope blocker";
      return "__skip__";
    }
    await buildFromSignature(client, "[ WP-A*  WP-B ]");
    await keys(client, ["Escape"]);
    const textBefore = (await dumpEditor(client)).text;
    const cursorBefore = (await dumpEditor(client)).cursor;
    const installed = await client.evaluate(
      [
        '(()=>{try{let Ctor=null;try{if(typeof Scope!=="undefined")Ctor=Scope;}catch(_){}',
        'if(!Ctor)Ctor=window.app.scope.constructor;',
        'const s=new Ctor(window.app.scope);',
        'window.__wpScopeFired=[];',
        's.register(null,null,(evt)=>{try{window.__wpScopeFired.push(evt&&evt.key);}catch(_){}return false;});',
        'window.app.keymap.pushScope(s);window.__wpScope=s;return{ok:true};}catch(e){return{ok:false,error:String(e&&e.message||e)};}})()',
      ].join("\n"),
      RPC_TIMEOUT_MS,
    );
    if (!installed || !installed.ok) throw new Error("Scope install failed: " + JSON.stringify(installed));
    await key(client, { key: "l", code: "KeyL", modifiers: 2, text: "" });
    await sleep(300);
    const paletteBlocked = await client.evaluate(MODAL_OPEN, RPC_TIMEOUT_MS);
    const fired = await client.evaluate('(()=>window.__wpScopeFired||[])()', RPC_TIMEOUT_MS);
    const textAfter = (await dumpEditor(client)).text;
    const cursorAfter = (await dumpEditor(client)).cursor;
    await key(client, "l");
    await sleep(100);
    const firedPlain = await client.evaluate('(()=>window.__wpScopeFired||[])()', RPC_TIMEOUT_MS);
    const textPlain = (await dumpEditor(client)).text;
    const cursorPlain = (await dumpEditor(client)).cursor;
    await client.evaluate('(()=>{try{window.app.keymap.popScope(window.__wpScope);window.__wpScope=null;}catch(e){return String(e&&e.message||e);}return true;})()', RPC_TIMEOUT_MS);
    if (paletteBlocked) throw new Error("bound Ctrl+L ran its command despite the pushed Scope");
    if (!fired.includes("l")) throw new Error("catch-all Scope did not see Ctrl+L: " + JSON.stringify(fired));
    if (textAfter !== textBefore) throw new Error("Ctrl+L leaked into the note text");
    if (!firedPlain.includes("l")) throw new Error("plain l did not reach the Scope: " + JSON.stringify(firedPlain));
    if (textPlain !== textBefore) throw new Error("plain l leaked into the note text (Vim must never see it)");
    if (cursorPlain.ch !== cursorBefore.ch || cursorPlain.line !== cursorBefore.line) {
      throw new Error("cursor moved under the pushed Scope (Vim saw the key)");
    }
    // The binding itself is live: with the Scope popped, Ctrl+L opens the palette.
    await key(client, { key: "l", code: "KeyL", modifiers: 2, text: "" });
    await sleep(400);
    const paletteOpen = await client.evaluate(MODAL_OPEN, RPC_TIMEOUT_MS);
    await keys(client, ["Escape"]);
    await sleep(200);
    if (!paletteOpen) throw new Error("Ctrl+L did not open the palette with no Scope pushed (fixture binding dead?)");
    findings.keyboard.c = {
      scopeSource: discovery.ctorSource,
      boundChordBlocked: true,
      plainLetterSwallowed: true,
      cursorUnmoved: true,
      bindingLiveWithoutScope: true,
    };
    return "pushed Scope intercepts Ctrl+L and plain l; binding live without it";
  });

  await runCase(record, "spike/keyboard-pop-non-top-scope", async () => {
    const discovery = findings.keyboard.scopeDiscovery || {};
    if (!discovery.constructed) {
      record("spike/keyboard-pop-non-top-scope", "skipped", "no constructible Scope (see preemption case)");
      return "__skip__";
    }
    const result = await client.evaluate(POP_NON_TOP, RPC_TIMEOUT_MS);
    if (!result || result.error || !result.popped) throw new Error("popScope off the top failed: " + JSON.stringify(result));
    await keys(client, ["Escape"]);
    await sleep(200);
    await key(client, { key: "l", code: "KeyL", modifiers: 2, text: "" });
    await sleep(400);
    const reopened = await client.evaluate(MODAL_OPEN, RPC_TIMEOUT_MS);
    const fired = await client.evaluate('(()=>window.__wpScopeFired2||[])()', RPC_TIMEOUT_MS);
    await keys(client, ["Escape"]);
    await sleep(200);
    if (!reopened) throw new Error("palette did not reopen after popping scope A (keyboard may be wedged)");
    if (fired.length) throw new Error("popped scope A still intercepts keys: " + JSON.stringify(fired));
    findings.keyboard.d = { poppedWhileModalOpen: true, reopened: true, staleScopeSilent: true };
    return "popScope off the top removes the scope; keyboard healthy";
  });

  await runCase(record, "spike/keyboard-insert-passthrough", async () => {
    const opened = await openNote(client, "WP-C.md", "source");
    if (!opened || !opened.ok || opened.viewType !== "markdown") {
      throw new Error("WP-C did not open as a markdown editor: " + JSON.stringify(opened));
    }
    const settled = await waitForVim(client, 8000);
    if (!settled || !settled.vimPresent) {
      throw new Error("editor never attached Vim state after open: " + JSON.stringify(settled));
    }
    await keys(client, ["Escape"]);
    const mounted = await dumpEditor(client);
    if (!mounted.vimPresent || mounted.vimMode !== "normal") {
      throw new Error("editor has no normal Vim state before the probe: " + JSON.stringify({ vim: mounted.vimMode, present: mounted.vimPresent }));
    }
    await placeCursor(client, 2, 0);
    await keys(client, ["i"]);
    await sleep(150);
    const inserting = await dumpEditor(client);
    if (!inserting.vimPresent || inserting.vimMode !== "insert") {
      throw new Error("'i' did not enter insert mode: " + JSON.stringify({ vim: inserting.vimMode, present: inserting.vimPresent }));
    }
    await client.call("Input.insertText", { text: "hello world" });
    await client.evaluate(RECORDER_INSTALL, RPC_TIMEOUT_MS);
    await key(client, { key: "w", code: "KeyW", modifiers: 2, text: "" });
    await sleep(200);
    const seen = await client.evaluate(RECORDER_READ, RPC_TIMEOUT_MS);
    const dump = await dumpEditor(client);
    await client.evaluate(RECORDER_REMOVE, RPC_TIMEOUT_MS);
    await keys(client, ["Escape"]);
    const line = dump.text.split("\n")[2];
    if (seen.events.some((event) => event.defaultPrevented)) {
      throw new Error("Ctrl+W was defaultPrevented in insert mode: " + JSON.stringify(seen));
    }
    if (dump.vimMode !== "insert") {
      throw new Error("editor left insert mode around Ctrl+W: " + JSON.stringify({ vim: dump.vimMode, line }));
    }
    if (line !== "hello spike join target charlie") {
      throw new Error("insert-mode Ctrl+W did not delete exactly one word: " + JSON.stringify(line));
    }
    findings.keyboard.e = { insertWordDeleted: true, defaultPrevented: false, vimMode: dump.vimMode };
    return "insert-mode Ctrl+W deletes a word on pass-through";
  });
}

// Finding 5: facts for later phases.
async function spikeFacts(client, record, findings) {
  await runCase(record, "spike/later-phase-facts", async () => {
    const facts = await client.evaluate(FACTS_DUMP, RPC_TIMEOUT_MS);
    findings.factsCommands = {
      focusSplit: facts.focusSplitCommands,
      close: facts.closeCommands,
      pin: facts.pinCommands,
      fold: facts.foldCommands,
      history: facts.historyCommands,
      modActive: facts.modActiveTabs,
      modActiveCount: facts.modActiveCount,
      getMostRecentLeaf: facts.getMostRecentLeaf,
    };
    // Deferred-background probe FIRST: bisect whether the Vim keys below
    // disturb the layout.
    await buildFromSignature(client, "[ WP-A  WP-B*  WP-C ]");
    const threeWay = await readLive(client);
    const threeTitles = threeWay.live.groups.map((group) => group.tabs.map((tab) => tab.title));
    if (JSON.stringify(threeTitles) !== JSON.stringify([["WP-A", "WP-B", "WP-C"]])) {
      throw new Error("three-tab build did not land: " + threeWay.signature);
    }
    const counts = [];
    for (let i = 0; i < 3; i += 1) {
      counts.push(await leafCount(client));
      await sleep(200);
    }
    findings.factsLeafCounts = counts;
    const bisect = await client.evaluate(ITERATE_BISECT, RPC_TIMEOUT_MS);
    findings.factsIterateBisect = bisect;
    const deferred = await client.evaluate(DEFERRED_PROBE, RPC_TIMEOUT_MS);
    if (!deferred || deferred.error) {
      const relive = await readLive(client).catch(() => null);
      throw new Error("deferred probe failed: " + JSON.stringify(deferred) + " relive=" + (relive ? relive.signature : "?"));
    }
    await spikeMove(client, "move-deferred", 0, 0);
    const deferredMoved = await client.evaluate(
      '(()=>{const w=window.app.workspace;const found=[];w.iterateRootLeaves((l)=>{if(l.__wpSpikeTag==="move-deferred")found.push(l);});return{count:found.length,active:w.activeLeaf===found[0]};})()',
      RPC_TIMEOUT_MS,
    );
    if (deferredMoved.count !== 1) throw new Error("deferred leaf lost in the move: " + JSON.stringify(deferredMoved));
    findings.factsDeferred = { ...deferred, deferredMoveOk: deferredMoved.count === 1 };
    let vimBehavior = "not-probed";
    if (facts.vimMap === "function") {
      const buildKeyMapProbe = await client.evaluate(
        '(()=>{try{const V=window.CodeMirrorAdapter.Vim;if(typeof V.buildKeyMap!=="function")return{callable:false};const km=V.buildKeyMap();let s=null;try{s=JSON.stringify(km);}catch(_){}return{callable:true,jsonLen:s?s.length:null,hasCtrlW:typeof s==="string"?s.indexOf("<C-w>")>=0:null,sample:typeof s==="string"?s.slice(0,2000):String(km).slice(0,500)};}catch(e){return{ok:false,error:String(e&&e.message||e)};}})()',
        RPC_TIMEOUT_MS,
      );
      let mapped = await client.evaluate(
        '(()=>{try{window.CodeMirrorAdapter.Vim.map("<C-w>q","l","normal");return{ok:true,ctx:"normal"};}catch(e){return{ok:false,error:String(e&&e.message||e)};}})()',
        RPC_TIMEOUT_MS,
      );
      if (!mapped.ok) {
        mapped = await client.evaluate(
          '(()=>{try{window.CodeMirrorAdapter.Vim.map("<C-w>q","l");return{ok:true,ctx:"default"};}catch(e){return{ok:false,error:String(e&&e.message||e)};}})()',
          RPC_TIMEOUT_MS,
        );
      }
      vimBehavior = { buildKeyMapProbe, mapped };
      if (mapped.ok) {
        await keys(client, ["Escape"]);
        const cursorBefore = (await dumpEditor(client)).cursor;
        await key(client, { key: "w", code: "KeyW", modifiers: 2, text: "" });
        await sleep(150);
        const keyBuffer = await client.evaluate(
          '(()=>{try{const v=window.app.workspace.activeLeaf.view,e=v&&v.editor;const cm=(e&&e.cm&&e.cm.cm)||(v&&v.editMode&&v.editMode.editor&&v.editMode.editor.cm&&v.editMode.editor.cm.cm)||null;const st=cm&&cm.state&&cm.state.vim;return st&&st.inputState?JSON.stringify(st.inputState).slice(0,500):null;}catch(e){return"error";}})()',
          RPC_TIMEOUT_MS,
        );
        await key(client, "q");
        await sleep(150);
        const cursorAfter = (await dumpEditor(client)).cursor;
        const unmapped = await client.evaluate(
          '(()=>{try{window.CodeMirrorAdapter.Vim.unmap("<C-w>q");return{ok:true};}catch(e){return{ok:false,error:String(e&&e.message||e)};}})()',
          RPC_TIMEOUT_MS,
        );
        vimBehavior = {
          buildKeyMapProbe,
          mapped,
          keyBufferAfterCtrlW: keyBuffer,
          cursorMovedRight: cursorAfter.ch === cursorBefore.ch + 1 && cursorAfter.line === cursorBefore.line,
          unmap: unmapped.ok,
        };
      }
    }
    findings.facts = {
      ...facts,
      vimPartialMatch: vimBehavior,
      deferred: findings.factsDeferred,
    };
    return "command IDs, mod-active, getMostRecentLeaf, deferred, and Vim keymap evidence recorded";
  });
}

// Finding 4 (linux side): (b) default-bound Ctrl+W closes first with
// defaultPrevented visible; (f) whether app.scope.register preempts it.
async function spikeKeyboardLinux(client, record, findings) {
  findings.keyboard = findings.keyboard || {};
  await runCase(record, "spike/linux-scope-register-probe", async () => {
    const probe = await client.evaluate(
      [
        '(()=>{const out={hasAppScope:!!window.app.scope,register:typeof (window.app.scope&&window.app.scope.register),unregister:typeof (window.app.scope&&window.app.scope.unregister)};',
        'if(out.register==="function"){try{window.__wpFired=false;',
        'window.app.scope.register(["Ctrl"],"w",()=>{window.__wpFired=true;return false;});',
        'out.registered=true;}catch(e){out.registerError=String(e&&e.message||e);}}',
        'return out;})()',
      ].join("\n"),
      RPC_TIMEOUT_MS,
    );
    findings.keyboard.fProbe = probe;
    if (!probe.registered) {
      findings.keyboard.f = "no app.scope.register; cannot answer (f) from the console";
      record("spike/linux-scope-register-probe", "skipped", JSON.stringify(probe));
      return "__skip__";
    }
    await buildFromSignature(client, "[ WP-A*  WP-B ]");
    await keys(client, ["Escape"]);
    await client.evaluate(RECORDER_INSTALL, RPC_TIMEOUT_MS);
    const leavesBefore = await leafCount(client);
    await key(client, { key: "w", code: "KeyW", modifiers: 2, text: "" });
    await sleep(300);
    const seen = await client.evaluate(RECORDER_READ, RPC_TIMEOUT_MS).catch(() => null);
    const fired = await client.evaluate('(()=>window.__wpFired)()', RPC_TIMEOUT_MS).catch(() => "socket-dead");
    const leavesAfter = await leafCount(client).catch(() => "socket-dead");
    await client.evaluate(
      '(()=>{try{if(window.app.scope&&typeof window.app.scope.unregister==="function")window.app.scope.unregister(["Ctrl"],"w");}catch(_){}return true;})()',
      RPC_TIMEOUT_MS,
    ).catch(() => null);
    await client.evaluate(RECORDER_REMOVE, RPC_TIMEOUT_MS).catch(() => null);
    findings.keyboard.f = { handlerFired: fired === true, leavesBefore, leavesAfter, capture: seen ? seen.events : "unreadable" };
    return `scope handler fired=${fired === true}, leaves ${leavesBefore}->${JSON.stringify(leavesAfter)}`;
  });

  await runCase(record, "spike/linux-default-close-first", async () => {
    const ctx = { dead: false };
    await buildFromSignature(client, "[ WP-A*  WP-B ]");
    await keys(client, ["Escape"]);
    const leavesBefore = await leafCount(client);
    await client.evaluate(RECORDER_INSTALL, RPC_TIMEOUT_MS);
    try {
      await key(client, { key: "w", code: "KeyW", modifiers: 2, text: "" });
      await sleep(500);
    } catch (error) {
      ctx.dead = true;
    }
    let seen = null;
    let leavesAfter = null;
    let activePath = null;
    try {
      seen = await client.evaluate(RECORDER_READ, RPC_TIMEOUT_MS);
      leavesAfter = await leafCount(client);
      const live = await readLive(client);
      activePath = live.live.activePath;
    } catch (error) {
      ctx.dead = true;
    }
    if (ctx.dead) {
      findings.keyboard.b = { outcome: "window-closed-or-socket-dead", leavesBefore };
      return `socket died after Ctrl+W from ${leavesBefore} leaves (window closed, not a tab)`;
    }
    await client.evaluate(RECORDER_REMOVE, RPC_TIMEOUT_MS).catch(() => null);
    const prevented = seen && seen.events.length ? seen.events[0].defaultPrevented === true : null;
    findings.keyboard.b = {
      defaultPreventedAtCapture: prevented,
      captureEvents: seen ? seen.events : null,
      leavesBefore,
      leavesAfter,
      activePath,
    };
    if (leavesAfter !== leavesBefore - 1) {
      throw new Error(`expected one tab to close (${leavesBefore}->${leavesBefore - 1}), got ${leavesAfter}; active=${activePath}`);
    }
    if (prevented !== true) throw new Error("capture listener did not see defaultPrevented: " + JSON.stringify(seen));
    return `tab closed first (${leavesBefore}->${leavesAfter}), capture saw defaultPrevented`;
  });
}

async function launchOwned(hotkeys, executable) {
  const runRoot = fs.mkdtempSync(path.join(TEMP_ROOT, "bob-wp-spike-"));
  const vault = path.join(runRoot, "vault");
  const profile = path.join(runRoot, "profile");
  const fixture = buildFixture(vault, profile, hotkeys);
  const fixturePath = fs.realpathSync(vault);
  const port = await freePort();
  const exe = findExecutable(executable);
  const probe = probeExecutable(exe);
  if (!probe.ok) fail("unrun: " + probe.reason, 2);
  if (!process.env.DISPLAY && !process.env.XVFB_RUN_TMPDIR) fail("unrun: run under xvfb-run -a", 2);
  const child = spawn(exe, [
    "--no-sandbox", "--user-data-dir=" + profile, "--remote-debugging-port=" + port,
    "--remote-allow-origins=http://127.0.0.1/*", fixturePath,
  ], {
    cwd: fixturePath,
    env: (() => { const env = { ...process.env, BOB_DIR: fixturePath, TMPDIR: os.tmpdir() }; delete env.ELECTRON_RUN_AS_NODE; return env; })(),
    stdio: "ignore",
  });
  let exited = false;
  child.once("exit", () => { exited = true; });
  return { runRoot, vault, profile, fixture, fixturePath, port, child, exitedFlag: () => exited };
}

async function connectOwned(launch) {
  const target = await selectTarget(launch.port, launch.fixturePath, launch.exitedFlag);
  const client = await Cdp.connect(target.webSocketDebuggerUrl, lib.CONNECT_TIMEOUT_MS);
  await client.call("Page.enable", {});
  await client.call("Runtime.enable", {});
  await waitFor(client, "Boolean(window.app&&window.app.workspace&&window.app.workspace.layoutReady)", Boolean, "layout-ready", lib.LAYOUT_READY_TIMEOUT_MS);
  await dismissTrust(client);
  await waitFor(client,
    'Boolean(window.app.plugins.plugins&&window.app.plugins.plugins["bob-navigation-hotkeys"])',
    Boolean, "bob-navigation-hotkeys plugin", 30_000);
  await sleep(1000);
  return client;
}

async function shutdownOwned(launch, client) {
  if (client) client.close();
  try {
    const child = launch.child;
    if (child.exitCode == null && child.signalCode == null) child.kill("SIGTERM");
    await new Promise((resolve) => {
      if (child.exitCode != null || child.signalCode != null) return resolve();
      const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch (_) {} resolve(); }, 4000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
  } catch (_) {}
  try {
    const cleanup = lib.planOwnedCleanup([launch.runRoot], [launch.runRoot]);
    for (const item of cleanup.removable) fs.rmSync(item, { recursive: true, force: true });
  } catch (_) {}
}

async function runSpikeMac(args, record, findings, outDir, screenshots) {
  const launch = await launchOwned(wplib.macHotkeys(), args.executable);
  let client = null;
  try {
    client = await connectOwned(launch);
    findings.appVersion = await client.evaluate("window.app.version||null").catch(() => null);
    await buildFromSignature(client, "[ WP-A  WP-B* ] | [ WP-C  WP-D ]");
    screenshots.push(await screenshot(client, outDir, "spike-two-split"));
    const roundtrip = await readLive(client);
    const titles = roundtrip.live.groups.map((group) => group.tabs.map((tab) => tab.title));
    if (JSON.stringify(titles) !== JSON.stringify([["WP-A", "WP-B"], ["WP-C", "WP-D"]])) {
      throw new Error("build/read round-trip failed: " + roundtrip.signature);
    }
    if (roundtrip.live.activePath !== "WP-B.md") throw new Error("active tab mismatch: " + roundtrip.signature);
    findings.roundTrip = {
      signature: roundtrip.signature,
      selectedMethods: roundtrip.live.groups.map((group) => group.selectedMethod),
      pinMethod: roundtrip.live.pinMethod,
    };
    record("spike/build-read-round-trip", "pass", roundtrip.signature);
    await spikeMoveLossless(client, record, findings);
    screenshots.push(await screenshot(client, outDir, "spike-after-move"));
    const ctx = { client, port: launch.port, fixturePath: launch.fixturePath, shouldStop: launch.exitedFlag };
    await spikeCollapse(ctx, record, findings);
    client = ctx.client;
    await spikeCreate(client, record, findings);
    await spikeKeyboardMac(client, record, findings);
    await spikeFacts(client, record, findings);
  } finally {
    await shutdownOwned(launch, client);
  }
}

async function runSpikeLinux(args, record, findings) {
  const launch = await launchOwned(wplib.linuxDefaultHotkeys(), args.executable);
  let client = null;
  try {
    client = await connectOwned(launch);
    findings.linuxAppVersion = await client.evaluate("window.app.version||null").catch(() => null);
    await spikeKeyboardLinux(client, record, findings);
  } finally {
    await shutdownOwned(launch, client);
  }
}

function selfTest() {
  const parsed = parseArgs(["--self-test", "--only", "spike", "--report", "/tmp/wp-spike.json"]);
  if (!parsed.selfTest || parsed.only !== "spike") throw new Error("argument parsing failed");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bob-wp-spike-self-"));
  try {
    const vault = path.join(temp, "vault");
    buildFixture(vault, path.join(temp, "profile"), wplib.macHotkeys());
    const check = wplib.assertFixtureDir(vault, wplib.macHotkeys());
    if (!check.ok) throw new Error("mac fixture: " + check.failures.join("; "));
    const linuxHotkeys = wplib.linuxDefaultHotkeys();
    if ("workspace:close" in linuxHotkeys) throw new Error("linux fixture must not mention workspace:close");
    const linuxVault = path.join(temp, "linux-vault");
    buildFixture(linuxVault, path.join(temp, "linux-profile"), linuxHotkeys);
    const linuxCheck = wplib.assertFixtureDir(linuxVault, linuxHotkeys);
    if (!linuxCheck.ok) throw new Error("linux fixture: " + linuxCheck.failures.join("; "));
    if (wplib.normalizeSignature("[WP-A WP-B*]") !== "[ WP-A  WP-B* ]") {
      throw new Error("signature normalization broke");
    }
    const vectors = wplib.assertDecisionVectorsRoundTrip();
    if (!vectors.ok) throw new Error("decision vectors: " + vectors.failures.join("; "));
    const source = fs.readFileSync(__filename, "utf8");
    for (const token of ["removeChild", "insertChild", "selectTab", "createLeafBySplit", "duplicateLeaf",
      "recomputeChildrenDimensions", "onLayoutChange", "setActiveLeaf", "requestSaveLayout",
      "getMostRecentLeaf", "loadIfDeferred", "pushScope", "popScope", "Input.dispatchKeyEvent",
      "Input.insertText", "--only", "requestSaveLayout", "workspace-tabs.mod-active"]) {
      if (!source.includes(token)) throw new Error("e2e is missing " + token);
    }
    const libSource = fs.readFileSync(path.join(__dirname, "obsidian-window-prefix-e2e-lib.cjs"), "utf8");
    for (const token of ["parseLayoutSignature", "formatLayoutSignature", "DECISION_VECTORS", "macHotkeys", "linuxDefaultHotkeys"]) {
      if (!libSource.includes(token)) throw new Error("lib is missing " + token);
    }
    // Every snippet shipped to Obsidian must be syntactically valid: two
    // uninvoked-IIFE typos once made probes silently no-op, and a .join-again
    // typo once broke the e2e before any probe ran.
    const vm = require("node:vm");
    const harness = require(__filename);
    const buildExpr = harness.buildInvoke([{ tabs: [{ title: "WP-A", mark: "*" }] }]);
    const moveExpr = harness.moveInvoke({ tag: "t", destGroup: 0, destIndex: 0 });
    for (const [label, expr] of [["buildInvoke", buildExpr], ["moveInvoke", moveExpr]]) {
      if (typeof expr !== "string" || !expr.endsWith(")")) throw new Error(label + " is not a call expression");
      new vm.Script(expr, { filename: label + ".cjs" });
    }
    const snippets = harness.PROBE_SNIPPETS || {};
    const names = Object.keys(snippets);
    if (names.length < 10) throw new Error("PROBE_SNIPPETS is missing entries: " + names.join(","));
    for (const label of names) {
      const expr = snippets[label];
      if (typeof expr !== "string" || !expr.length) throw new Error(label + " is not a snippet string");
      try {
        new vm.Script(expr, { filename: label + ".cjs" });
      } catch (error) {
        throw new Error(label + " does not parse: " + (error && error.message ? error.message : error));
      }
    }
    console.log("offline self-test complete (not an Obsidian pass)");
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

async function runE2e(args) {
  if (args.only && !wplib.GROUPS.includes(args.only)) fail("--only must be one of " + wplib.GROUPS.join(", "), 2);
  const group = args.only || "spike";
  const cases = [];
  const record = (name, status, detail) => {
    cases.push({ name, status, detail: detail || "" });
    if (status === "pass") console.log("PASS " + name + (detail ? " (" + detail + ")" : ""));
    else if (status === "skipped") console.log("SKIP " + name + ": " + detail);
    else console.error("FAIL " + name + ": " + detail);
  };
  const outDir = args.out ? path.resolve(args.out) : fs.mkdtempSync(path.join(os.tmpdir(), "bob-wp-spike-shots-"));
  fs.mkdirSync(outDir, { recursive: true });
  const findings = { move: {}, collapse: {}, create: {}, keyboard: {}, facts: {} };
  const screenshots = [];
  if (group !== "spike") {
    record(group + "/reserved", "skipped", "runner lands in the " + group + " phase; spike ships only the harness helpers");
  } else {
    await runSpikeMac(args, record, findings, outDir, screenshots);
    await runSpikeLinux(args, record, findings);
  }
  const executable = findExecutable(args.executable);
  let sourceSha = "";
  try {
    sourceSha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
  } catch (_) {}
  const report = {
    executable,
    group,
    appVersion: findings.appVersion || null,
    linuxAppVersion: findings.linuxAppVersion || null,
    sourceSha: process.env.WP_SOURCE_SHA || sourceSha || "unknown-no-git",
    sourceContentSha256: Object.fromEntries([
      "scripts/obsidian-window-prefix-e2e.cjs",
      "scripts/obsidian-window-prefix-e2e-lib.cjs",
      "scripts/test-obsidian-window-prefix-e2e.cjs",
      "plugins/bob-navigation-hotkeys/manifest.json",
    ].map((relative) => [relative, crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, relative))).digest("hex")])),
    expectedPlugins: expectedPlugins(),
    findings,
    cases,
    skipped: cases.filter((item) => item.status === "skipped"),
    screenshots,
    pass: cases.every((item) => item.status === "pass" || item.status === "skipped"),
    out: outDir,
  };
  if (args.report) {
    fs.mkdirSync(path.dirname(path.resolve(args.report)), { recursive: true });
    fs.writeFileSync(args.report, JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify({
    pass: report.pass,
    failed: cases.filter((x) => x.status === "fail").map((x) => x.name),
    skipped: report.skipped,
    screenshots,
    out: outDir,
  }, null, 2));
  if (!report.pass) fail("e2e failed: " + cases.filter((x) => x.status === "fail").map((x) => x.name).join(", "), 1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(HELP); return; }
  if (args.selfTest) { selfTest(); return; }
  await runE2e(args);
}
const PROBE_SNIPPETS = {
  READ_SIGNATURE,
  BUILD_FROM_SIGNATURE,
  SPIKE_MOVE,
  HIST_BACK,
  HIST_FWD,
  READ_OPEN,
  READ_CHECK,
  POP_NON_TOP,
  DEFERRED_PROBE,
  FACTS_DUMP,
  CREATE_PROBE,
  CREATE_PROBE_BEFORE_FALSE,
  ITERATE_BISECT,
  DUP_PROBE,
  DUP_VERIFY,
  SCROLL_STEPS,
  RECORDER_INSTALL,
  DUMP_EDITOR,
  VIM_PROBE,
};

module.exports = {
  parseArgs,
  buildFixture,
  buildInvoke,
  moveInvoke,
  PROBE_SNIPPETS,
  wplib,
  selfTest,
};

if (require.main === module) {
  main().catch((error) => {
    console.error((error && error.stack) || error);
    process.exitCode = error && error.exitCode ? error.exitCode : 1;
  });
}
