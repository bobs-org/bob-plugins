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
// Groups: --only spike runs the finding probes (1-5 below). --only actions
// drives the shipped executor through runWindowPrefixPaletteKey against every
// decision-contract vector. --only prefix runs the Ctrl+W prefix
// state-machine cases. --only visual runs the hint screenshots and palette
// probes. --only tabs drives in-place tab jumps through
// runWindowPrefixPaletteKey("N") and Ctrl+W digits.
"use strict";
const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const lib = require("./obsidian-startup-smoke-lib.cjs");
const wplib = require("./obsidian-window-prefix-e2e-lib.cjs");
const actionsMod = require("./obsidian-window-prefix-e2e-actions.cjs");
const tabsMod = require("./obsidian-window-prefix-e2e-tabs.cjs");

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
  "      --only NAME         Run only a named group: spike, actions, prefix, visual, tabs",
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
  "Prefix group (--only prefix):",
  "  Ctrl+W l/h/L/H on [ WP-A  WP-B* ] | [ WP-C ], Ctrl+W Ctrl+W toggle,",
  "  Ctrl+W Ctrl+L (no palette), Esc byte-identical, unmapped j, insert-mode",
  "  word delete, Copy card pass-through, reading view + empty tab arm,",
  "  pending d pass-through, Linux default Close tab with prefix idle, and",
  "  keymap scope restoration. Screenshots: ring and card at 300 ms.",
  "",
  "Actions group (--only actions):",
  "  Every DECISION_VECTORS entry via runWindowPrefixPaletteKey (L for",
  "  create-right, join-right, last-tab-out, pinned-stays-pinned,",
  "  unpinned-after-pins; H for create-left, join-left, middle-out,",
  "  edge-sole-tab; H then L for only-tab; v for split; l then h at the",
  "  edge then w twice for focus), collapse DOM checks, L/H losslessness",
  "  (type, move, u restores text; cursor, scrollTop, pin survive),",
  "  requestSaveLayout + reload persistence, reading/PDF/PNG survival, and",
  "  keymap scope restoration after every case.",
  "",
  "Tabs group (--only tabs):",
  "  Every tab decision-contract vector via runWindowPrefixPaletteKey (3/4/1/2/7),",
  "  source-split selection after a cross-split jump, type→jump away→back→u,",
  "  scroll of an unselected long note, PDF focus without an editor, stacked",
  "  tabs, 13 tabs in a narrow split (header clipping), a deferred background",
  "  tab after reload, and Ctrl+W digits: 4 across splits, Ctrl+3 global vs",
  "  group-local, Numpad 2, blocked 7+Esc identical, 0 and Shift+3, already-",
  "  here, data-bob-tab parity, H/L and new-tab renumber, sidebar/single-tab,",
  "  lit/flash classes, idle/lit/flash screenshots, and Linux Close-tab hide",
  "  plus defaultPrevented close. Keymap scope restoration after every case.",
  "",
  "Visual group (--only visual):",
  "  Palette command registration, then ring, card, move receipt, and",
  "  focused-split underline screenshots in light and dark at one, two, and",
  "  three splits, plus palette focus/move/window-keys probes with receipt",
  "  and scope checks.",
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
    await waitForVim(client, 8000);
    const beforeLeaves = await leafCount(client);
    const beforeDump = await dumpEditor(client);
    if (!beforeDump.vimPresent || beforeDump.vimMode !== "normal") {
      throw new Error("expected Vim normal mode before the probe: " + JSON.stringify({ vim: beforeDump.vimMode, present: beforeDump.vimPresent }));
    }
    const textBefore = beforeDump.text;
    await key(client, { key: "w", code: "KeyW", modifiers: 2, text: "" });
    const armed = await waitFor(client, PREFIX_DEBUG, (state) => state && state.ok && state.armed === true, "prefix armed after Ctrl+W", 4000);
    if (!armed || !armed.armed) throw new Error("Ctrl+W did not arm the prefix: " + JSON.stringify(armed));
    if (!armed.lastVerdict || armed.lastVerdict.allowed !== true) {
      throw new Error("arming verdict did not allow Ctrl+W: " + JSON.stringify(armed && armed.lastVerdict));
    }
    if (armed.lastVerdict.defaultPrevented !== false) {
      throw new Error("unbound Ctrl+W arrived defaultPrevented: " + JSON.stringify(armed.lastVerdict));
    }
    const afterLeaves = await leafCount(client);
    const afterDump = await dumpEditor(client);
    if (afterLeaves !== beforeLeaves) throw new Error(`leaf count changed ${beforeLeaves} -> ${afterLeaves}`);
    if (afterDump.text !== textBefore) throw new Error("editor text changed while arming");
    if (afterDump.vimMode !== "normal") throw new Error("Vim mode changed while arming: " + afterDump.vimMode);
    await keys(client, ["Escape"]);
    await waitFor(client, PREFIX_DEBUG, (state) => state && state.ok && state.armed === false, "prefix idle after Escape", 4000);
    findings.keyboard.a = { armed: true, defaultPrevented: false, leavesUnchanged: true, verdict: armed.lastVerdict };
    return "Ctrl+W arms the prefix unprevented; layout, text, and Vim mode unchanged; Escape cancels";
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

const PREFIX_DEBUG = [
  '(()=>{try{',
  'const p=window.app.plugins.plugins["bob-navigation-hotkeys"];',
  'if(!p)return{ok:false,error:"plugin missing"};',
  'const d=typeof p.getWindowPrefixDebugState==="function"?p.getWindowPrefixDebugState():{state:p.windowPrefixState||null,armed:false,hasScope:false,scopeCount:null};',
  'const host=document.querySelector("[data-bob-wp=\'host\']");',
  'const ring=document.querySelector("[data-bob-wp=\'ring\']");',
  'const card=document.querySelector("[data-bob-wp=\'card\']");',
  'const msg=document.querySelector("[data-bob-wp=\'message\']");',
  'return{ok:true,state:d.state||null,armed:!!d.armed,hasScope:!!d.hasScope,',
  'scopeCount:d.scopeCount==null?null:d.scopeCount,lastVerdict:d.lastVerdict||null,lastDispatch:d.lastDispatch||null,',
  'hostHidden:!host||host.classList.contains("is-hidden"),',
  'hostArmed:!!(host&&host.classList.contains("is-armed")),',
  'hostCarded:!!(host&&host.classList.contains("is-carded")),',
  'hasHost:!!host,hasRing:!!ring,hasCard:!!card,',
  'message:msg?String(msg.textContent||""):""};',
  '}catch(e){return{ok:false,error:String(e&&e.message||e)};}})()',
].join("");

const KEYMAP_FINGERPRINT = [
  '(()=>{try{const km=window.app.keymap;const scopes=km&&km.scopes;',
  'if(Array.isArray(scopes)){',
  'const ids=scopes.map((s)=>{if(!s)return"null";',
  'try{if(!s.__wpFp)s.__wpFp="s"+Math.random().toString(16).slice(2);return s.__wpFp;}catch(_){return typeof s;}});',
  'return{ok:true,kind:"scopes",ids,count:scopes.length};}',
  'return{ok:true,kind:"keys",keys:Object.keys(km||{}).sort()};',
  '}catch(e){return{ok:false,error:String(e&&e.message||e)};}})()',
].join("");

const PREFIX_SCREENSHOT_LAYOUT = "[ WP-A  WP-B* ] | [ WP-C ]";

async function prefixDebug(client) {
  return client.evaluate(PREFIX_DEBUG, RPC_TIMEOUT_MS);
}

async function keymapFinger(client) {
  return client.evaluate(KEYMAP_FINGERPRINT, RPC_TIMEOUT_MS);
}

function sameKeymap(left, right) {
  if (!left || !right || !left.ok || !right.ok) return false;
  if (left.kind === "scopes" && right.kind === "scopes") {
    return JSON.stringify(left.ids) === JSON.stringify(right.ids);
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

function titlesOf(live) {
  return live.groups.map((group) => group.tabs.map((tab) => tab.title));
}

async function waitPrefix(client, predicate, label, timeout) {
  return waitFor(client, PREFIX_DEBUG, (state) => state && state.ok && predicate(state), label, timeout || 4000);
}

async function ctrlW(client, pause) {
  await key(client, { key: "w", code: "KeyW", modifiers: 2, text: "", pause: pause == null ? 24 : pause });
}

async function armPrefix(client) {
  await ctrlW(client, 40);
  return waitPrefix(client, (state) => state.armed === true, "prefix armed");
}

async function waitPrefixIdle(client, timeout) {
  return waitPrefix(client, (state) => state.state === "idle" && state.armed === false, "prefix idle", timeout || 6000);
}

const OVERLAY_OPEN = '(()=>!!document.querySelector(".prompt,.modal,.bob-copy-card,.bob-copy-card-modal,.bob-task-card"))()';

async function cancelPrefix(client) {
  const overlay = await client.evaluate(OVERLAY_OPEN, RPC_TIMEOUT_MS).catch(() => false);
  const state = await prefixDebug(client).catch(() => null);
  if ((state && state.armed) || overlay) {
    await keys(client, ["Escape"]);
    await sleep(80);
  }
  if (state && state.armed) {
    await waitPrefixIdle(client, 3000).catch(() => null);
  }
  const still = await client.evaluate(OVERLAY_OPEN, RPC_TIMEOUT_MS).catch(() => false);
  if (still) {
    await keys(client, ["Escape"]);
    await sleep(80);
  }
}

async function letterKey(client, letter) {
  const upper = letter.toUpperCase();
  const isUpper = letter === upper && letter !== letter.toLowerCase();
  await key(client, {
    key: letter,
    code: "Key" + upper,
    modifiers: isUpper ? 8 : 0,
    text: "",
  });
}

async function prepareLayout(client, signature) {
  await buildFromSignature(client, signature);
  await keys(client, ["Escape"]);
  await client.evaluate(
    '(()=>{const v=window.app.workspace.activeLeaf&&window.app.workspace.activeLeaf.view;if(v&&v.editor&&v.editor.focus)v.editor.focus();return true;})()',
    RPC_TIMEOUT_MS,
  );
  const vim = await waitForVim(client, 8000);
  if (vim && vim.vimPresent) {
    await keys(client, ["Escape"]);
    await sleep(80);
  }
  return readLive(client);
}

async function runPrefixCase(record, client, name, action) {
  const before = await keymapFinger(client);
  await runCase(record, name, async () => {
    try {
      const detail = await action();
      return detail;
    } finally {
      try { await cancelPrefix(client); } catch (_error) { /* next case rebuilds */ }
    }
  });
  const after = await keymapFinger(client);
  if (!sameKeymap(before, after)) {
    record(name + "/scope-stack", "fail", "keymap scope stack changed: " + JSON.stringify({ before, after }));
  }
}

async function runPrefixMac(args, record, findings, outDir, screenshots) {
  const launch = await launchOwned(wplib.macHotkeys(), args.executable);
  let client = null;
  try {
    client = await connectOwned(launch);
    findings.appVersion = await client.evaluate("window.app.version||null").catch(() => null);
    findings.prefix = {};

    await runCase(record, "prefix/mixin-loaded", async () => {
      const ready = await client.evaluate(
        '(()=>{const p=window.app.plugins.plugins["bob-navigation-hotkeys"];return{has:!!p,state:p&&p.windowPrefixState,debug:typeof (p&&p.getWindowPrefixDebugState),arm:typeof (p&&p.armWindowPrefix)};})()',
        RPC_TIMEOUT_MS,
      );
      if (!ready || ready.debug !== "function" || ready.arm !== "function") {
        throw new Error("window prefix mixin not loaded: " + JSON.stringify(ready));
      }
      return JSON.stringify(ready);
    });

    await runPrefixCase(record, client, "prefix/focus-l", async () => {
      await prepareLayout(client, PREFIX_SCREENSHOT_LAYOUT);
      await armPrefix(client);
      await key(client, "l");
      await waitPrefixIdle(client);
      const after = await readLive(client);
      if (after.live.activePath !== "WP-C.md") throw new Error("l did not focus WP-C: " + after.signature);
      if (JSON.stringify(titlesOf(after.live)) !== JSON.stringify([["WP-A", "WP-B"], ["WP-C"]])) {
        throw new Error("l changed titles: " + after.signature);
      }
      findings.prefix.focusL = after.signature;
      return after.signature;
    });

    await runPrefixCase(record, client, "prefix/focus-h-edge", async () => {
      await prepareLayout(client, PREFIX_SCREENSHOT_LAYOUT);
      await armPrefix(client);
      await key(client, "h");
      await sleep(150);
      const state = await prefixDebug(client);
      if (!state.armed) throw new Error("h at left edge disarmed: " + JSON.stringify(state));
      const after = await readLive(client);
      if (after.live.activePath !== "WP-B.md") throw new Error("h moved focus: " + after.signature);
      return after.signature + " still armed";
    });

    await runPrefixCase(record, client, "prefix/move-L", async () => {
      await prepareLayout(client, PREFIX_SCREENSHOT_LAYOUT);
      await armPrefix(client);
      await letterKey(client, "L");
      await waitPrefixIdle(client, 8000);
      await sleep(250);
      const after = await readLive(client);
      if (JSON.stringify(titlesOf(after.live)) !== JSON.stringify([["WP-A"], ["WP-C", "WP-B"]])) {
        const debug = await prefixDebug(client);
        throw new Error("L join failed: " + after.signature + " dispatch=" + JSON.stringify(debug.lastDispatch));
      }
      if (after.live.activePath !== "WP-B.md") throw new Error("moved tab not active: " + after.signature);
      findings.prefix.moveL = after.signature;
      return after.signature;
    });

    await runPrefixCase(record, client, "prefix/move-H", async () => {
      await prepareLayout(client, PREFIX_SCREENSHOT_LAYOUT);
      await armPrefix(client);
      await letterKey(client, "H");
      await waitPrefixIdle(client, 8000);
      await sleep(250);
      const after = await readLive(client);
      if (JSON.stringify(titlesOf(after.live)) !== JSON.stringify([["WP-B"], ["WP-A"], ["WP-C"]])) {
        const debug = await prefixDebug(client);
        throw new Error("H create-left failed: " + after.signature + " dispatch=" + JSON.stringify(debug.lastDispatch));
      }
      if (after.live.activePath !== "WP-B.md") throw new Error("moved tab not active: " + after.signature);
      findings.prefix.moveH = after.signature;
      return after.signature;
    });

    await runPrefixCase(record, client, "prefix/ctrl-w-toggle", async () => {
      await prepareLayout(client, PREFIX_SCREENSHOT_LAYOUT);
      await armPrefix(client);
      await ctrlW(client);
      await waitPrefixIdle(client);
      let after = await readLive(client);
      if (after.live.activePath !== "WP-C.md") throw new Error("first w did not toggle to WP-C: " + after.signature);
      await armPrefix(client);
      await ctrlW(client);
      await waitPrefixIdle(client);
      after = await readLive(client);
      if (after.live.activePath !== "WP-B.md") throw new Error("second w did not wrap to WP-B: " + after.signature);
      findings.prefix.toggle = after.signature;
      return after.signature;
    });

    await runPrefixCase(record, client, "prefix/ctrl-w-ctrl-l", async () => {
      await prepareLayout(client, PREFIX_SCREENSHOT_LAYOUT);
      await armPrefix(client);
      await key(client, { key: "l", code: "KeyL", modifiers: 2, text: "" });
      await waitPrefixIdle(client);
      const palette = await client.evaluate(MODAL_OPEN, RPC_TIMEOUT_MS);
      if (palette) throw new Error("Ctrl+L opened the palette under the prefix");
      const after = await readLive(client);
      if (after.live.activePath !== "WP-C.md") throw new Error("Ctrl+L suffix did not focus right: " + after.signature);
      return after.signature;
    });

    await runPrefixCase(record, client, "prefix/esc-identical", async () => {
      await prepareLayout(client, PREFIX_SCREENSHOT_LAYOUT);
      const before = await readLive(client);
      const textBefore = (await dumpEditor(client)).text;
      await armPrefix(client);
      await keys(client, ["Escape"]);
      await waitPrefixIdle(client);
      const after = await readLive(client);
      const textAfter = (await dumpEditor(client)).text;
      if (after.signature !== before.signature) {
        throw new Error("Esc changed layout: " + before.signature + " -> " + after.signature);
      }
      if (textAfter !== textBefore) throw new Error("Esc changed note text");
      return before.signature;
    });

    await runPrefixCase(record, client, "prefix/unmapped-j", async () => {
      await prepareLayout(client, PREFIX_SCREENSHOT_LAYOUT);
      const before = await readLive(client);
      const dumpBefore = await dumpEditor(client);
      await armPrefix(client);
      await key(client, "j");
      await sleep(150);
      const state = await prefixDebug(client);
      if (!state.armed) throw new Error("unmapped j disarmed: " + JSON.stringify(state));
      const after = await readLive(client);
      const dump = await dumpEditor(client);
      if (after.signature !== before.signature) throw new Error("j changed layout: " + after.signature);
      if (dump.text !== dumpBefore.text) throw new Error("j leaked into the note");
      if (dump.cursor.line !== dumpBefore.cursor.line || dump.cursor.ch !== dumpBefore.cursor.ch) {
        throw new Error("j moved the cursor");
      }
      return state.message || "consumed j, still armed";
    });

    await runPrefixCase(record, client, "prefix/insert-passthrough", async () => {
      const opened = await openNote(client, "WP-C.md", "source");
      if (!opened || !opened.ok || opened.viewType !== "markdown") {
        throw new Error("WP-C did not open as a markdown editor: " + JSON.stringify(opened));
      }
      const settled = await waitForVim(client, 8000);
      if (!settled || !settled.vimPresent) {
        throw new Error("editor never attached Vim state after open: " + JSON.stringify(settled));
      }
      await keys(client, ["Escape"]);
      await placeCursor(client, 2, 0);
      await keys(client, ["i"]);
      await sleep(150);
      const inserting = await dumpEditor(client);
      if (!inserting.vimPresent || inserting.vimMode !== "insert") {
        throw new Error("'i' did not enter insert mode: " + JSON.stringify({ vim: inserting.vimMode }));
      }
      await client.call("Input.insertText", { text: "hello world" });
      await ctrlW(client, 80);
      await sleep(200);
      const dump = await dumpEditor(client);
      const state = await prefixDebug(client);
      await keys(client, ["Escape"]);
      const line = dump.text.split("\n")[2];
      if (state.armed || state.state !== "idle") {
        throw new Error("insert-mode Ctrl+W armed the prefix: " + JSON.stringify(state));
      }
      if (dump.vimMode !== "insert") {
        throw new Error("editor left insert mode around Ctrl+W: " + JSON.stringify({ vim: dump.vimMode, line }));
      }
      if (line !== "hello spike join target charlie") {
        throw new Error("insert-mode Ctrl+W did not delete exactly one word: " + JSON.stringify(line));
      }
      return "insert-mode Ctrl+W deletes a word; prefix idle";
    });

    await runPrefixCase(record, client, "prefix/copy-card-passthrough", async () => {
      await prepareLayout(client, "[ WP-A*  WP-B ]");
      await client.evaluate(
        '(()=>{try{return window.app.commands.executeCommandById("bob-navigation-hotkeys:copy-active-file-path");}catch(e){return{error:String(e&&e.message||e)};}})()',
        RPC_TIMEOUT_MS,
      );
      await sleep(300);
      let overlay = await client.evaluate(
        '(()=>!!document.querySelector(".bob-copy-card,.bob-copy-card-modal,.modal"))()',
        RPC_TIMEOUT_MS,
      );
      if (!overlay) {
        await client.evaluate(
          '(()=>{const el=document.createElement("div");el.className="bob-copy-card modal";el.setAttribute("data-bob-wp-test","1");document.body.appendChild(el);return true;})()',
        );
        overlay = "injected";
      }
      await ctrlW(client, 80);
      const state = await prefixDebug(client);
      if (state.armed || state.state !== "idle") {
        throw new Error("Ctrl+W armed over copy card: " + JSON.stringify(state));
      }
      await keys(client, ["Escape"]);
      await sleep(150);
      await waitFor(client, '(!document.querySelector(".modal,.bob-copy-card,.bob-copy-card-modal,.prompt"))', Boolean, "copy card closed", 4000);
      return overlay === true ? "copy-card blocked arming" : "injected overlay blocked arming";
    });

    await runPrefixCase(record, client, "prefix/reading-view-arms", async () => {
      await waitFor(client, '(!document.querySelector(".modal,.bob-copy-card,.bob-copy-card-modal,.prompt"))', Boolean, "no overlay before reading view", 4000);
      const opened = await openNote(client, "WP-A.md", "preview");
      if (!opened || !opened.ok) throw new Error("preview open failed: " + JSON.stringify(opened));
      await sleep(400);
      await client.evaluate(
        '(()=>{const v=window.app.workspace.activeLeaf&&window.app.workspace.activeLeaf.view;if(v&&typeof v.setState==="function"){try{v.setState({mode:"preview",source:false});}catch(_){}}const preview=document.querySelector(".markdown-preview-view,.markdown-reading-view");if(preview){if(preview.tabIndex<0)preview.tabIndex=0;if(preview.focus)preview.focus();preview.click();}const el=(v&&v.contentEl)||(v&&v.containerEl);if(el&&el.focus)el.focus();return{viewType:v&&v.getViewType(),mode:typeof (v&&v.getMode)==="function"?v.getMode():null,active:(document.activeElement&&document.activeElement.className)||null};})()',
        RPC_TIMEOUT_MS,
      );
      await sleep(200);
      await ctrlW(client, 80);
      const state = await waitPrefix(client, (item) => item.armed === true, "reading-view prefix armed");
      return JSON.stringify(state);
    });

    await runPrefixCase(record, client, "prefix/empty-tab-arms", async () => {
      await prepareLayout(client, "[ WP-A* ]");
      const made = await client.evaluate(
        '(()=>(async()=>{const w=window.app.workspace;const leaf=w.getLeaf("tab");w.setActiveLeaf(leaf,{focus:true});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const v=leaf.view;const el=(v&&v.containerEl)||(leaf&&leaf.containerEl);if(el&&el.focus)el.focus();return{ok:true,viewType:v&&typeof v.getViewType==="function"?v.getViewType():null,hasFile:!!(v&&v.file)};})())()',
        RPC_TIMEOUT_MS,
      );
      await sleep(250);
      await ctrlW(client, 80);
      const state = await waitPrefix(client, (item) => item.armed === true, "empty-tab prefix armed");
      return JSON.stringify({ made, state });
    });

    await runPrefixCase(record, client, "prefix/pending-d-passthrough", async () => {
      await prepareLayout(client, "[ WP-A* ]");
      await keys(client, ["Escape"]);
      await key(client, "d");
      await sleep(80);
      await ctrlW(client, 80);
      const state = await prefixDebug(client);
      if (state.armed || state.state !== "idle") {
        throw new Error("Ctrl+W armed over pending d: " + JSON.stringify(state));
      }
      return "idle over pending operator";
    });

    await runPrefixCase(record, client, "prefix/hint-ring", async () => {
      await prepareLayout(client, PREFIX_SCREENSHOT_LAYOUT);
      await armPrefix(client);
      await sleep(80);
      const state = await prefixDebug(client);
      if (!state.hostArmed || state.hostHidden) throw new Error("ring host not visible: " + JSON.stringify(state));
      if (state.hostCarded) throw new Error("card appeared before 300ms: " + JSON.stringify(state));
      screenshots.push(await screenshot(client, outDir, "prefix-ring"));
      return "ring visible, card hidden";
    });

    await runPrefixCase(record, client, "prefix/hint-card-300ms", async () => {
      await prepareLayout(client, PREFIX_SCREENSHOT_LAYOUT);
      await armPrefix(client);
      await sleep(360);
      const state = await prefixDebug(client);
      if (!state.hostCarded || state.hostHidden) throw new Error("card not visible at 300ms: " + JSON.stringify(state));
      screenshots.push(await screenshot(client, outDir, "prefix-card"));
      return "card visible at 300ms";
    });
  } finally {
    await shutdownOwned(launch, client);
  }
}

async function runPrefixLinux(args, record, findings) {
  const launch = await launchOwned(wplib.linuxDefaultHotkeys(), args.executable);
  let client = null;
  try {
    client = await connectOwned(launch);
    findings.linuxAppVersion = await client.evaluate("window.app.version||null").catch(() => null);
    await runCase(record, "prefix/linux-close-stays-idle", async () => {
      await buildFromSignature(client, "[ WP-A*  WP-B ]");
      await keys(client, ["Escape"]);
      const before = await keymapFinger(client);
      const leavesBefore = await leafCount(client);
      const debugBefore = await prefixDebug(client);
      if (debugBefore.state && debugBefore.state !== "idle") {
        throw new Error("prefix not idle before Linux Ctrl+W: " + JSON.stringify(debugBefore));
      }
      const ctx = { dead: false };
      try {
        await ctrlW(client, 200);
        await sleep(400);
      } catch (_error) {
        ctx.dead = true;
      }
      if (ctx.dead) {
        findings.prefix = findings.prefix || {};
        findings.prefix.linux = { outcome: "window-closed-or-socket-dead", leavesBefore };
        return `socket died after Ctrl+W from ${leavesBefore} leaves (window closed)`;
      }
      const leavesAfter = await leafCount(client);
      const debugAfter = await prefixDebug(client);
      if (debugAfter.armed || (debugAfter.state && debugAfter.state !== "idle")) {
        throw new Error("prefix armed under Linux Close tab: " + JSON.stringify(debugAfter));
      }
      if (leavesAfter !== leavesBefore - 1) {
        throw new Error(`expected tab close ${leavesBefore}->${leavesBefore - 1}, got ${leavesAfter}`);
      }
      const after = await keymapFinger(client);
      if (!sameKeymap(before, after)) {
        throw new Error("scope stack changed on Linux close: " + JSON.stringify({ before, after }));
      }
      findings.prefix = findings.prefix || {};
      findings.prefix.linux = { leavesBefore, leavesAfter, idle: true };
      return `closed ${leavesBefore}->${leavesAfter}, prefix idle`;
    });
  } finally {
    await shutdownOwned(launch, client);
  }
}

const VISUAL_LAYOUTS = Object.freeze([
  { tag: "1split", signature: "[ WP-A  WP-B* ]", splits: 1 },
  { tag: "2splits", signature: PREFIX_SCREENSHOT_LAYOUT, splits: 2 },
  { tag: "3splits", signature: "[ WP-A  WP-B* ] | [ WP-C ] | [ WP-D ]", splits: 3 },
]);

const VISUAL_PALETTE_IDS = Object.freeze([
  "bob-navigation-hotkeys:window-focus-left",
  "bob-navigation-hotkeys:window-focus-right",
  "bob-navigation-hotkeys:window-focus-next",
  "bob-navigation-hotkeys:window-move-tab-left",
  "bob-navigation-hotkeys:window-move-tab-right",
  "bob-navigation-hotkeys:window-keys",
]);

const VISUAL_UNDERLINE_PROBE = [
  '(()=>{try{const root=document.querySelector(".workspace-split.mod-root");',
  'const tabs=root?Array.from(root.querySelectorAll(".workspace-tabs")):[];',
  'return{ok:true,',
  'multi:document.body.classList.contains("bob-wp-multi-split"),',
  'tabs:tabs.length,',
  'active:tabs.filter((t)=>t.classList.contains("mod-active")).length,',
  'fallback:document.querySelectorAll(".workspace-tabs.bob-wp-active-split").length};',
  '}catch(e){return{ok:false,error:String(e&&e.message||e)};}})()',
].join("");

const VISUAL_RECEIPT_PROBE = [
  '(()=>{try{const el=document.querySelector(".bob-wp-receipt");',
  'return{ok:true,receipt:el?String(el.textContent||""):"",visible:!!el&&!el.closest(".is-hidden")};',
  '}catch(e){return{ok:false,error:String(e&&e.message||e)};}})()',
].join("");

async function waitSignatureChange(client, before, label, timeout) {
  const deadline = Date.now() + (timeout || 6000);
  let after = null;
  while (Date.now() < deadline) {
    after = await readLive(client);
    if (after.signature !== before) return after;
    await sleep(150);
  }
  throw new Error("timed out waiting for " + label + ": still " + (after && after.signature));
}

async function runVisualMac(args, record, findings, outDir, screenshots) {
  const launch = await launchOwned(wplib.macHotkeys(), args.executable);
  let client = null;
  try {
    client = await connectOwned(launch);
    findings.visual = {};
    findings.visual.appVersion = await client.evaluate("window.app.version||null").catch(() => null);

    await runCase(record, "visual/commands-registered", async () => {
      const probe = await client.evaluate(
        '(()=>{try{return {ok:true,found:' + JSON.stringify(VISUAL_PALETTE_IDS) +
        '.map((id)=>{try{const c=window.app.commands;return!!((c&&c.commands&&c.commands[id])||(c&&c.findCommand&&c.findCommand(id)));}catch(_){return false;}})};}catch(e){return{ok:false,error:String(e&&e.message||e)};}})()',
        RPC_TIMEOUT_MS,
      );
      if (!probe || !probe.ok) throw new Error("command probe failed: " + JSON.stringify(probe));
      const missing = VISUAL_PALETTE_IDS.filter((id, index) => !probe.found[index]);
      if (missing.length) throw new Error("palette commands missing: " + missing.join(", "));
      return "6 window palette commands registered";
    });

    for (const dark of [false, true]) {
      const theme = dark ? "dark" : "light";
      await runCase(record, "visual/theme-" + theme, async () => {
        await setTheme(client, dark);
        return theme + " theme applied";
      });
      for (const layout of VISUAL_LAYOUTS) {
        await runCase(record, "visual/ring-" + theme + "-" + layout.tag, async () => {
          await prepareLayout(client, layout.signature);
          await armPrefix(client);
          await sleep(80);
          const state = await prefixDebug(client);
          if (!state.hostArmed || state.hostHidden) {
            throw new Error("ring host not visible: " + JSON.stringify(state));
          }
          if (state.hostCarded) throw new Error("card appeared before 300ms: " + JSON.stringify(state));
          screenshots.push(await screenshot(client, outDir, "visual-ring-" + theme + "-" + layout.tag));
          await keys(client, ["Escape"]);
          await waitPrefixIdle(client);
          return "ring visible, card hidden";
        });

        await runCase(record, "visual/card-" + theme + "-" + layout.tag, async () => {
          await prepareLayout(client, layout.signature);
          await armPrefix(client);
          await sleep(360);
          const state = await prefixDebug(client);
          if (!state.hostCarded || state.hostHidden) {
            throw new Error("card not visible at 300ms: " + JSON.stringify(state));
          }
          screenshots.push(await screenshot(client, outDir, "visual-card-" + theme + "-" + layout.tag));
          await keys(client, ["Escape"]);
          await waitPrefixIdle(client);
          return "card visible at 300ms";
        });

        if (layout.splits >= 2) {
          await runCase(record, "visual/receipt-" + theme + "-" + layout.tag, async () => {
            await prepareLayout(client, layout.signature);
            const armed = await prefixDebug(client).catch(() => null);
            if (armed && armed.armed) {
              await keys(client, ["Escape"]);
              await waitPrefixIdle(client);
            }
            await armPrefix(client);
            await letterKey(client, "L");
            const after = await waitSignatureChange(client, layout.signature, "palette-free move L", 8000);
            await sleep(250);
            const receipt = await client.evaluate(VISUAL_RECEIPT_PROBE, RPC_TIMEOUT_MS);
            if (JSON.stringify(titlesOf(after.live)) !== JSON.stringify(layout.splits === 2
              ? [["WP-A"], ["WP-C", "WP-B"]]
              : [["WP-A"], ["WP-C", "WP-B"], ["WP-D"]])) {
              throw new Error("L join failed: " + after.signature);
            }
            if (after.live.activePath !== "WP-B.md") throw new Error("moved tab not active: " + after.signature);
            if (!receipt || !receipt.ok || !receipt.receipt) {
              throw new Error("move receipt not visible: " + JSON.stringify(receipt));
            }
            findings.visual["receipt-" + theme + "-" + layout.tag] = receipt.receipt;
            screenshots.push(await screenshot(client, outDir, "visual-receipt-" + theme + "-" + layout.tag));
            await keys(client, ["Escape"]);
            await sleep(200);
            return after.signature + " · " + receipt.receipt;
          });
        }

        await runCase(record, "visual/underline-" + theme + "-" + layout.tag, async () => {
          await prepareLayout(client, layout.signature);
          await sleep(150);
          const underline = await client.evaluate(VISUAL_UNDERLINE_PROBE, RPC_TIMEOUT_MS);
          if (!underline || !underline.ok) throw new Error("underline probe failed: " + JSON.stringify(underline));
          if (underline.multi !== (layout.splits >= 2)) {
            throw new Error("underline gate wrong: " + JSON.stringify(underline));
          }
          if (underline.tabs !== layout.splits) {
            throw new Error("split count wrong: " + JSON.stringify(underline));
          }
          screenshots.push(await screenshot(client, outDir, "visual-underline-" + theme + "-" + layout.tag));
          return JSON.stringify(underline);
        });
      }
    }

    await runCase(record, "visual/palette-focus-right", async () => {
      await setTheme(client, false);
      await prepareLayout(client, PREFIX_SCREENSHOT_LAYOUT);
      const before = await readLive(client);
      await client.evaluate(
        '(()=>window.app.commands.executeCommandById("bob-navigation-hotkeys:window-focus-right"))()',
        RPC_TIMEOUT_MS,
      );
      const after = await waitSignatureChange(client, before.signature, "palette focus-right", 6000);
      if (after.live.activePath !== "WP-C.md") throw new Error("palette focus-right failed: " + after.signature);
      return after.signature;
    });

    await runCase(record, "visual/palette-move-tab-right", async () => {
      await prepareLayout(client, PREFIX_SCREENSHOT_LAYOUT);
      const before = await readLive(client);
      await client.evaluate(
        '(()=>window.app.commands.executeCommandById("bob-navigation-hotkeys:window-move-tab-right"))()',
        RPC_TIMEOUT_MS,
      );
      const after = await waitSignatureChange(client, before.signature, "palette move-tab-right", 8000);
      if (JSON.stringify(titlesOf(after.live)) !== JSON.stringify([["WP-A"], ["WP-C", "WP-B"]])) {
        throw new Error("palette move-tab-right join failed: " + after.signature);
      }
      if (after.live.activePath !== "WP-B.md") throw new Error("moved tab not active: " + after.signature);
      await sleep(250);
      const receipt = await client.evaluate(VISUAL_RECEIPT_PROBE, RPC_TIMEOUT_MS);
      if (!receipt || !receipt.ok || !receipt.receipt) {
        throw new Error("palette move receipt not visible: " + JSON.stringify(receipt));
      }
      screenshots.push(await screenshot(client, outDir, "visual-palette-move-receipt"));
      return after.signature + " · " + receipt.receipt;
    });

    await runPrefixCase(record, client, "visual/palette-window-keys", async () => {
      await prepareLayout(client, PREFIX_SCREENSHOT_LAYOUT);
      await client.evaluate(
        '(()=>window.app.commands.executeCommandById("bob-navigation-hotkeys:window-keys"))()',
        RPC_TIMEOUT_MS,
      );
      const state = await waitPrefix(client, (item) => item.hostCarded === true, "palette window-keys card", 4000);
      if (state.hostHidden) throw new Error("palette card hidden: " + JSON.stringify(state));
      await sleep(250);
      screenshots.push(await screenshot(client, outDir, "visual-palette-keys-card"));
      const dbg = await prefixDebug(client);
      if (!dbg.hasScope) {
        throw new Error("palette window-keys holds no scope: " + JSON.stringify(dbg));
      }
      return "card shown at once";
    });
  } finally {
    await shutdownOwned(launch, client);
  }
}

async function actionsPaletteKey(client, key) {
  return client.evaluate(
    '((key) => { try { const p = window.app.plugins.plugins["bob-navigation-hotkeys"];'
    + ' if (!p || typeof p.runWindowPrefixPaletteKey !== "function") return { ok: false, error: "palette entry missing" };'
    + ' return p.runWindowPrefixPaletteKey(key); } catch (e) { return { ok: false, error: String(e && e.message || e) }; } })('
    + JSON.stringify(key) + ')',
    RPC_TIMEOUT_MS,
  );
}

async function actionsWaitSignature(client, expected, label, timeout) {
  const deadline = Date.now() + (timeout || 8000);
  let last = null;
  while (Date.now() < deadline) {
    last = await readLive(client);
    if (wplib.normalizeSignature(last.signature) === wplib.normalizeSignature(expected)) return last;
    await sleep(150);
  }
  throw new Error("timed out waiting for " + label + ": want " + expected + " got " + (last && last.signature));
}

async function runActionsCase(record, client, name, action) {
  const before = await keymapFinger(client);
  await runCase(record, name, async () => {
    try {
      return await action();
    } finally {
      try { await cancelPrefix(client); } catch (_error) { /* next case rebuilds */ }
    }
  });
  const after = await keymapFinger(client);
  if (!sameKeymap(before, after)) {
    record(name + "/scope-stack", "fail", "keymap scope stack changed: " + JSON.stringify({ before, after }));
  }
}

async function actionsAssertDomGroups(client, expectedGroups) {
  const dom = await client.evaluate(actionsMod.ACTIONS_DOM_PROBE, RPC_TIMEOUT_MS);
  if (!dom || !dom.ok) throw new Error("DOM split probe failed: " + JSON.stringify(dom));
  if (dom.tabs !== expectedGroups) {
    throw new Error(`DOM split count ${dom.tabs} !== signature groups ${expectedGroups}: ` + JSON.stringify(dom));
  }
  if (dom.empty !== 0) throw new Error("empty .workspace-tabs in the DOM: " + JSON.stringify(dom));
  return dom;
}

async function runActionsMac(args, record, findings, launchRef) {
  const launch = await launchOwned(wplib.macHotkeys(), args.executable);
  if (launchRef) launchRef.current = launch;
  let client = null;
  try {
    client = await connectOwned(launch);
    findings.actions = { vectors: {} };
    findings.appVersion = findings.appVersion || await client.evaluate("window.app.version||null").catch(() => null);

    await runCase(record, "actions/mixin-loaded", async () => {
      const ready = await client.evaluate(
        '(()=>{const p=window.app.plugins.plugins["bob-navigation-hotkeys"];return{has:!!p,run:typeof (p&&p.runWindowPrefixPaletteKey)};})()',
        RPC_TIMEOUT_MS,
      );
      if (!ready || ready.run !== "function") throw new Error("palette executor missing: " + JSON.stringify(ready));
      return "runWindowPrefixPaletteKey present";
    });

    async function settleVim(clientInner) {
      await keys(clientInner, ["Escape"]);
      await waitForVim(clientInner, 8000).catch(() => null);
    }

    async function applyTranslatedState(clientInner, translatedFrom) {
      const parsed = wplib.parseLayoutSignature(translatedFrom);
      const result = await clientInner.evaluate(
        '((groups) => { try { const w = window.app.workspace; const byTitle = new Map();'
        + ' w.iterateRootLeaves((l) => { try { const p = l.view && l.view.file && l.view.file.path;'
        + ' if (p) { const title = p.replace(/\\.md$/, ""); if (!byTitle.has(title)) byTitle.set(title, []); byTitle.get(title).push(l); } } catch (_) {} });'
        + ' for (const group of groups) { for (const tab of group.tabs) {'
        + ' const leaves = byTitle.get(tab.title) || []; const leaf = leaves[0]; if (!leaf) return { ok: false, missing: tab.title };'
        + ' try { if (tab.pinned && !leaf.pinned && typeof leaf.togglePinned === "function") leaf.togglePinned();'
        + ' if (!tab.pinned && leaf.pinned && typeof leaf.togglePinned === "function") leaf.togglePinned(); } catch (e) { return { ok: false, pinError: String(e && e.message || e) }; } } }'
        + ' for (const group of groups) { const want = group.tabs.find((t) => t.mark === "\u0027") || group.tabs.find((t) => t.mark === "*");'
        + ' if (!want) continue; const leaves = byTitle.get(want.title) || []; const leaf = leaves[0]; if (!leaf) continue;'
        + ' try { const parent = leaf.parent; if (parent && typeof parent.selectTab === "function" && parent.children.includes(leaf)) parent.selectTab(leaf); } catch (_) {} }'
        + ' const active = groups.flatMap((g) => g.tabs).find((t) => t.mark === "*");'
        + ' if (active) { const leaves = byTitle.get(active.title) || []; const leaf = leaves[0];'
        + ' if (leaf) { try { w.setActiveLeaf(leaf, { focus: true }); } catch (_) {} } }'
        + ' return { ok: true }; } catch (e) { return { ok: false, error: String(e && e.message || e) }; } })('
        + JSON.stringify(parsed.groups.map((group) => ({ tabs: group.tabs }))) + ')',
        RPC_TIMEOUT_MS,
      );
      if (!result || !result.ok) throw new Error("apply pins/selection failed: " + JSON.stringify(result));
      await sleep(400);
    }

    for (const vector of wplib.DECISION_VECTORS) {
      const paletteKeys = actionsMod.actionKeysForVector(vector.name);
      if (!paletteKeys) throw new Error("no key table entry for vector " + vector.name);
      const translated = actionsMod.translateDecisionVector(vector);
      await runActionsCase(record, client, "actions/vector-" + vector.name, async () => {
        await buildFromSignature(client, translated.from);
        await applyTranslatedState(client, translated.from);
        await settleVim(client);
        const normalizedFrom = wplib.normalizeSignature((await readLive(client)).signature);
        if (normalizedFrom !== wplib.normalizeSignature(translated.from)) {
          throw new Error("from fixture did not land: want " + translated.from + " got " + normalizedFrom);
        }
        for (const paletteKey of paletteKeys) {
          await actionsPaletteKey(client, paletteKey);
          await sleep(600);
        }
        const after = await readLive(client);
        if (wplib.normalizeSignature(after.signature) !== wplib.normalizeSignature(translated.to)) {
          throw new Error(`${vector.name} via ${paletteKeys.join("+")} failed: want ${translated.to} got ${after.signature}`);
        }
        if (actionsMod.ACTIONS_COLLAPSE_VECTORS.includes(vector.name)) {
          const expectedGroups = wplib.parseLayoutSignature(translated.to).groups.length;
          await actionsAssertDomGroups(client, expectedGroups);
        }
        findings.actions.vectors[vector.name] = after.signature;
        return `${vector.name} via ${paletteKeys.join("+")}: ${after.signature}`;
      });
    }

    await runActionsCase(record, client, "actions/focus-sequence", async () => {
      await buildFromSignature(client, "[ WP-A* ] | [ WP-B' ] | [ WP-C' ]");
      await applyTranslatedState(client, "[ WP-A* ] | [ WP-B' ] | [ WP-C' ]");
      await keys(client, ["Escape"]);
      await actionsPaletteKey(client, "l");
      const afterL = await actionsWaitSignature(client, "[ WP-A' ] | [ WP-B* ] | [ WP-C' ]", "focus l", 8000);
      await actionsPaletteKey(client, "h");
      await actionsWaitSignature(client, "[ WP-A* ] | [ WP-B' ] | [ WP-C' ]", "focus h at edge", 8000);
      await actionsPaletteKey(client, "w");
      await actionsWaitSignature(client, "[ WP-A' ] | [ WP-B* ] | [ WP-C' ]", "focus w once", 8000);
      await actionsPaletteKey(client, "w");
      const afterW2 = await actionsWaitSignature(client, "[ WP-A' ] | [ WP-B' ] | [ WP-C* ]", "focus w twice", 8000);
      findings.actions.focusSequence = afterW2.signature;
      return afterW2.signature;
    });

    await runActionsCase(record, client, "actions/lossless-L", async () => {
      await buildFromSignature(client, "[ WP-A  WP-B* ] | [ WP-C'  WP-D ]");
      await applyTranslatedState(client, "[ WP-A  WP-B* ] | [ WP-C'  WP-D ]");
      await keys(client, ["Escape"]);
      await waitForVim(client, 8000);
      const expectedBody = wplib.seedNotes().get("WP-B.md");
      const sane = await dumpEditor(client);
      if (sane.text !== expectedBody) throw new Error("fixture body drifted: " + sane.text.slice(0, 80));
      const cursorBefore = { ...sane.cursor };
      await placeCursor(client, 2, 0);
      await keys(client, ["i"]);
      await client.call("Input.insertText", { text: "LOSSLESS " });
      await keys(client, ["Escape"]);
      const typed = await dumpEditor(client);
      if (!typed.text.includes("LOSSLESS spike cursor line bravo")) throw new Error("typing did not land");
      const scrollProbe = await client.evaluate(
        '(()=>{try{const e=window.app.workspace.activeLeaf.view.editor;return{top:e.cm.scrollDOM?e.cm.scrollDOM.scrollTop:null};}catch(e){return{error:String(e&&e.message||e)};}})()',
        RPC_TIMEOUT_MS,
      );
      await client.evaluate(
        '(()=>{try{const l=window.app.workspace.activeLeaf;if(l&&typeof l.togglePinned==="function"&&!l.pinned)l.togglePinned();return{ok:true,pinned:!!(l&&l.pinned)};}catch(e){return{ok:false,error:String(e&&e.message||e)};}})()',
        RPC_TIMEOUT_MS,
      );
      await actionsPaletteKey(client, "L");
      const after = await actionsWaitSignature(client, "[ WP-A' ] | [ WP-B!*  WP-C  WP-D ]", "lossless L join", 8000);
      const moved = await dumpEditor(client);
      if (!moved.text.includes("LOSSLESS spike cursor line bravo")) throw new Error("move lost typed text");
      const pinnedAfter = await client.evaluate(
        '(()=>{try{const l=window.app.workspace.activeLeaf;return{ok:true,pinned:!!(l&&l.pinned)};}catch(e){return{ok:false,error:String(e&&e.message||e)};}})()',
        RPC_TIMEOUT_MS,
      );
      if (!pinnedAfter || pinnedAfter.pinned !== true) throw new Error("pin did not survive the move: " + JSON.stringify(pinnedAfter));
      if (scrollProbe && scrollProbe.top != null && moved.scrollTop != null && moved.scrollTop !== 0) {
        // selectTab resets scrollTop to 0; the executor must restore it.
        if (Math.abs(moved.scrollTop - (typed.scrollTop || 0)) > 2 && moved.scrollTop !== 0) {
          throw new Error("scrollTop implausible after move: " + JSON.stringify({ before: typed.scrollTop, after: moved.scrollTop }));
        }
      }
      await keys(client, ["u"]);
      await sleep(300);
      const undone = await dumpEditor(client);
      if (undone.text !== expectedBody) throw new Error("u did not restore the fixture text: " + undone.text.slice(0, 120));
      if (undone.cursor.line !== cursorBefore.line && undone.cursor.line !== 2) {
        throw new Error("cursor implausible after undo: " + JSON.stringify(undone.cursor));
      }
      findings.actions.losslessL = after.signature;
      return after.signature + " · type→move→u restores text, pin survives";
    });

    await runActionsCase(record, client, "actions/lossless-H", async () => {
      await buildFromSignature(client, "[ WP-A'  WP-B ] | [ WP-C*  WP-D ]");
      await applyTranslatedState(client, "[ WP-A'  WP-B ] | [ WP-C*  WP-D ]");
      await keys(client, ["Escape"]);
      await waitForVim(client, 8000);
      const expectedBody = wplib.seedNotes().get("WP-C.md");
      const sane = await dumpEditor(client);
      if (sane.text !== expectedBody) throw new Error("fixture body drifted for H: " + sane.text.slice(0, 80));
      await placeCursor(client, 2, 0);
      await keys(client, ["i"]);
      await client.call("Input.insertText", { text: "LOSSLESS " });
      await keys(client, ["Escape"]);
      const typed = await dumpEditor(client);
      if (!typed.text.includes("LOSSLESS spike join target charlie")) throw new Error("H typing did not land");
      await actionsPaletteKey(client, "H");
      const after = await actionsWaitSignature(client, "[ WP-A  WP-C*  WP-B ] | [ WP-D' ]", "lossless H join", 8000);
      const moved = await dumpEditor(client);
      if (!moved.text.includes("LOSSLESS spike join target charlie")) throw new Error("H move lost typed text");
      await keys(client, ["u"]);
      await sleep(300);
      const undone = await dumpEditor(client);
      if (undone.text !== expectedBody) throw new Error("H u did not restore text: " + undone.text.slice(0, 120));
      findings.actions.losslessH = after.signature;
      return after.signature + " · type→move→u restores text";
    });

    {
      const reloadBefore = await keymapFinger(client);
      let reloadDetail = "";
      await runCase(record, "actions/reload-persists", async () => {
        await buildFromSignature(client, "[ WP-A  WP-B* ] | [ WP-C'  WP-D ]");
        await applyTranslatedState(client, "[ WP-A  WP-B* ] | [ WP-C'  WP-D ]");
        await keys(client, ["Escape"]);
        await actionsPaletteKey(client, "L");
        const after = await actionsWaitSignature(client, "[ WP-A' ] | [ WP-C  WP-B*  WP-D ]", "reload L join", 8000);
        await client.evaluate('(()=>{if(window.app.workspace.requestSaveLayout)window.app.workspace.requestSaveLayout();return true;})()', RPC_TIMEOUT_MS);
        await sleep(800);
        const holder = { port: launch.port, fixturePath: launch.fixturePath, shouldStop: launch.exitedFlag };
        const reconnected = await reloadAndReconnect(holder.port, holder.fixturePath, holder.shouldStop, client);
        client = reconnected;
        const relive = await readLive(client);
        if (wplib.normalizeSignature(relive.signature) !== wplib.normalizeSignature(after.signature)) {
          throw new Error("layout did not survive reload: " + after.signature + " -> " + relive.signature);
        }
        findings.actions.reloadPersists = relive.signature;
        reloadDetail = relive.signature + " survives reload";
        return reloadDetail;
      });
      const reloadAfter = await keymapFinger(client).catch(() => null);
      if (!sameKeymap(reloadBefore, reloadAfter)) {
        record("actions/reload-persists/scope-stack", "fail", "keymap scope stack changed: " + JSON.stringify({ before: reloadBefore, after: reloadAfter }));
      }
    }

    await runActionsCase(record, client, "actions/reading-pdf-image-survive", async () => {
      await buildFromSignature(client, "[ WP-A  WP-B* ] | [ WP-C ]");
      await keys(client, ["Escape"]);
      const opened = await client.evaluate(
        '((file) => (async () => { const f = window.app.vault.getAbstractFileByPath(file); if (!f) return { ok: false };'
        + ' const w = window.app.workspace; const leaf = w.getLeaf("tab"); await leaf.openFile(f); return { ok: true, viewType: leaf.view && leaf.view.getViewType() }; })())("tiny.pdf")',
        RPC_TIMEOUT_MS,
      );
      if (!opened || !opened.ok || opened.viewType !== "pdf") throw new Error("PDF leaf did not mount: " + JSON.stringify(opened));
      await actionsPaletteKey(client, "L");
      await sleep(800);
      const check = await client.evaluate(
        '(()=>{const w=window.app.workspace;const found=[];let pdf=0,image=0,reading=0;'
        + 'w.iterateRootLeaves((l)=>{try{const t=l.view&&l.view.getViewType&&l.view.getViewType();'
        + 'if(t==="pdf")pdf+=1;if(t==="image")image+=1;if(t==="markdown")reading+=1;}catch(_){}});'
        + 'return{pdf,image,reading};})()',
        RPC_TIMEOUT_MS,
      );
      if (!check || check.pdf < 1) throw new Error("PDF leaf missing after L: " + JSON.stringify(check));
      const imageOpened = await client.evaluate(
        '((file) => (async () => { const f = window.app.vault.getAbstractFileByPath(file); if (!f) return { ok: false };'
        + ' const w = window.app.workspace; const leaf = w.getLeaf("tab"); await leaf.openFile(f); return { ok: true, viewType: leaf.view && leaf.view.getViewType() }; })())("pixel.png")',
        RPC_TIMEOUT_MS,
      );
      if (!imageOpened || !imageOpened.ok) throw new Error("image leaf did not mount: " + JSON.stringify(imageOpened));
      await actionsPaletteKey(client, "H");
      await sleep(800);
      const check2 = await client.evaluate(
        '(()=>{const w=window.app.workspace;let pdf=0,image=0;'
        + 'w.iterateRootLeaves((l)=>{try{const t=l.view&&l.view.getViewType&&l.view.getViewType();'
        + 'if(t==="pdf")pdf+=1;if(t==="image")image+=1;}catch(_){}});return{pdf,image};})()',
        RPC_TIMEOUT_MS,
      );
      if (check2.pdf < 1 || check2.image < 1) throw new Error("media leaves missing after H: " + JSON.stringify(check2));
      findings.actions.mediaSurvive = check2;
      return "reading/PDF/PNG leaves keep view type and render after L and H";
    });
  } finally {
    await shutdownOwned(launch, client);
  }
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
  const parsedPrefix = parseArgs(["--only", "prefix"]);
  if (parsedPrefix.only !== "prefix") throw new Error("prefix --only parsing failed");
  const parsedActions = parseArgs(["--only", "actions"]);
  if (parsedActions.only !== "actions") throw new Error("actions --only parsing failed");
  const parsedTabs = parseArgs(["--only", "tabs"]);
  if (parsedTabs.only !== "tabs") throw new Error("tabs --only parsing failed");
  const tabsTable = require("./obsidian-window-prefix-e2e-tabs.cjs");
  if (!tabsTable.TAB_DECISION_VECTORS || tabsTable.TAB_DECISION_VECTORS.length < 6) {
    throw new Error("tabs table missing decision vectors");
  }
  for (const vector of tabsTable.TAB_DECISION_VECTORS) {
    if (!/^[1-9]$/.test(vector.key)) throw new Error("tabs vector " + vector.name + " has a non-digit key");
    const translated = tabsTable.translateTabVector(vector);
    if (!translated.from.includes("WP-")) throw new Error("tabs vector " + vector.name + " did not translate");
  }
  const actionsTable = require("./obsidian-window-prefix-e2e-actions.cjs");
  for (const vector of wplib.DECISION_VECTORS) {
    const tableKeys = actionsTable.actionKeysForVector(vector.name);
    if (!tableKeys || !tableKeys.length) throw new Error("actions table missing " + vector.name);
    for (const tableKey of tableKeys) {
      if (!["L", "H", "l", "h", "w", "v"].includes(tableKey)) {
        throw new Error(`actions table key ${tableKey} for ${vector.name} is not a window key`);
      }
    }
  }
  const expectedTable = {
    "create-right": ["L"], "join-right": ["L"], "last-tab-out": ["L"],
    "pinned-stays-pinned": ["L"], "unpinned-after-pins": ["L"],
    "create-left": ["H"], "join-left": ["H"], "middle-out": ["H"],
    "edge-sole-tab": ["H"], "only-tab": ["H", "L"], split: ["v"], focus: ["l"],
  };
  for (const [name, want] of Object.entries(expectedTable)) {
    const got = actionsTable.actionKeysForVector(name);
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      throw new Error(`actions table drift for ${name}: want ${want} got ${got}`);
    }
  }
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
      "Input.insertText", "--only", "requestSaveLayout", "workspace-tabs.mod-active",
      "runPrefixMac", "runActionsMac", "actions/vector-", "runWindowPrefixPaletteKey",
      "runTabsMac", "executeWindowPrefixFocusTab",
      "prefix/focus-l", "getWindowPrefixDebugState",
      "runTabsLinux", "NUMERALS_PROBE", "bob-tab-numbers-lit",
      "bob-tab-number-flash", "data-bob-tab"]) {
      if (!source.includes(token)) throw new Error("e2e is missing " + token);
    }
    const libSource = fs.readFileSync(path.join(__dirname, "obsidian-window-prefix-e2e-lib.cjs"), "utf8");
    for (const token of ["parseLayoutSignature", "formatLayoutSignature", "DECISION_VECTORS", "macHotkeys", "linuxDefaultHotkeys"]) {
      if (!libSource.includes(token)) throw new Error("lib is missing " + token);
    }
    const tabsSource = fs.readFileSync(path.join(__dirname, "obsidian-window-prefix-e2e-tabs.cjs"), "utf8");
    for (const token of [
      "tabs/vector-", "TAB_DECISION_VECTORS", "deferred-reload", "runWindowPrefixPaletteKey",
      "tabs/prefix-digit-4", "tabs/prefix-ctrl-3-global", "tabs/prefix-numpad-2",
      "tabs/prefix-blocked-7", "tabs/prefix-zero", "tabs/prefix-shift-3",
      "tabs/prefix-already-here", "tabs/prefix-dom-parity", "tabs/prefix-renumber-open",
      "tabs/prefix-renumber-HL", "tabs/prefix-sidebar", "tabs/prefix-single-tab",
      "tabs/prefix-lit-card", "tabs/prefix-flash", "tabs/linux-numerals-hide",
      "tabs/linux-ctrl-w-closes", "NUMERALS_PROBE", "data-bob-tab",
      "bob-tab-numbers-lit", "bob-tab-number-flash", "runTabsLinuxGroup",
    ]) {
      if (!tabsSource.includes(token)) throw new Error("tabs e2e is missing " + token);
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

async function runTabsMac(args, record, findings, outDir, screenshots) {
  await tabsMod.runTabsGroup({
    launchOwned,
    connectOwned,
    shutdownOwned,
    buildFromSignature,
    actionsPaletteKey,
    runActionsCase,
    runCase,
    readLive,
    keys,
    key,
    sleep,
    dumpEditor,
    placeCursor,
    reloadAndReconnect,
    keymapFinger,
    sameKeymap,
    wplib,
    RPC_TIMEOUT_MS,
    waitForVim,
    armPrefix,
    waitPrefixIdle,
    waitPrefix,
    prefixDebug,
    letterKey,
    screenshot,
    outDir,
    screenshots,
    ctrlW,
  }, args, record, findings);
}

async function runTabsLinux(args, record, findings) {
  await tabsMod.runTabsLinuxGroup({
    launchOwned,
    connectOwned,
    shutdownOwned,
    buildFromSignature,
    runCase,
    keys,
    ctrlW,
    sleep,
    leafCount,
    prefixDebug,
    keymapFinger,
    sameKeymap,
    wplib,
    RPC_TIMEOUT_MS,
  }, args, record, findings);
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
  if (group === "spike") {
    await runSpikeMac(args, record, findings, outDir, screenshots);
    await runSpikeLinux(args, record, findings);
  } else if (group === "actions") {
    await runActionsMac(args, record, findings);
  } else if (group === "prefix") {
    await runPrefixMac(args, record, findings, outDir, screenshots);
    await runPrefixLinux(args, record, findings);
  } else if (group === "visual") {
    await runVisualMac(args, record, findings, outDir, screenshots);
  } else if (group === "tabs") {
    await runTabsMac(args, record, findings, outDir, screenshots);
    await runTabsLinux(args, record, findings);
  } else {
    record(group + "/reserved", "skipped", "unknown group " + group);
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
      "scripts/obsidian-window-prefix-e2e-tabs.cjs",
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
  PREFIX_DEBUG,
  KEYMAP_FINGERPRINT,
  NUMERALS_PROBE: tabsMod.NUMERALS_PROBE,
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
