#!/usr/bin/env node
// Real-Obsidian Copy card e2e: isolated vault/profile, owned app process,
// real CDP keyboard input and clipboard reads. It never opens the live vault.
//   xvfb-run -a node scripts/obsidian-copy-card-e2e.cjs [--out DIR] [-e PATH]
"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const lib = require("./obsidian-startup-smoke-lib.cjs");
const fixture = require("./obsidian-copy-card-e2e-lib.cjs");

const repoRoot = path.resolve(__dirname, "..");
const OVERALL_TIMEOUT_MS = 240_000;
const TEMP_ROOT = "/tmp";
const HELP = [
  "Usage: node scripts/obsidian-copy-card-e2e.cjs [OPTIONS]",
  "",
  "Drive Cmd+Y in an isolated scratch vault over CDP; never opens the live vault.",
  "Run under xvfb-run -a on Linux.",
  "",
  "Options:",
  "  -e, --executable PATH   Obsidian executable (default: /snap/bin/obsidian)",
  "  -o, --out DIRECTORY     Screenshot output directory outside this repo",
  "  -r, --report PATH       Write the structured JSON report",
  "  -s, --self-test         Run offline self-tests (no Obsidian needed)",
  "  -h, --help              Print this help and exit",
].join("\n");

function parseArgs(argv) {
  const args = { executable: null, out: null, report: null, selfTest: false, help: false };
  const list = Array.isArray(argv) ? argv.slice() : [];
  for (let i = 0; i < list.length; i += 1) {
    const token = list[i];
    if (token === "-e" || token === "--executable") {
      const value = list[++i];
      if (!value || value.startsWith("-")) throw new Error("--executable requires a PATH value");
      args.executable = value;
    } else if (token === "-o" || token === "--out") {
      const value = list[++i];
      if (!value || value.startsWith("-")) throw new Error("--out requires a DIRECTORY value");
      args.out = value;
    } else if (token === "-r" || token === "--report") {
      const value = list[++i];
      if (!value || value.startsWith("-")) throw new Error("--report requires a PATH value");
      args.report = value;
    } else if (token === "-s" || token === "--self-test") {
      args.selfTest = true;
    } else if (token === "-h" || token === "--help") {
      args.help = true;
    } else {
      throw new Error("Unknown argument: " + token);
    }
  }
  return args;
}

function fail(message, exitCode) {
  const error = new Error(message);
  error.exitCode = exitCode || 1;
  throw error;
}

function findExecutable(override) {
  const candidates = [
    override,
    process.env.OBSIDIAN_BIN,
    "/snap/bin/obsidian",
    "/snap/obsidian/current/app/obsidian",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch (_error) {
      // Keep looking.
    }
  }
  return candidates[0] || "/snap/bin/obsidian";
}

function makeTemp(prefix) {
  return fs.mkdtempSync(path.join(TEMP_ROOT, prefix));
}

function writeConfig(configHome, yaml) {
  const configPath = path.join(configHome, "bob", "config.yml");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, yaml);
  return configPath;
}

function copyPlugin(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const name of ["manifest.json", "main.js", "styles.css"]) {
    const source = path.join(sourceDir, name);
    if (!fs.existsSync(source)) throw new Error("missing built plugin file " + source);
    fs.copyFileSync(source, path.join(targetDir, name));
  }
}

function makeFixture(runRoot) {
  const homeDir = path.join(runRoot, "home");
  const vaultDir = path.join(homeDir, "bob");
  const configHome = path.join(runRoot, "xdg");
  const profileDir = path.join(runRoot, "profile");
  const pluginDir = path.join(vaultDir, ".obsidian", "plugins", "bob-navigation-hotkeys");
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(profileDir, { recursive: true });
  const noteFile = path.join(vaultDir, fixture.notePath());
  fs.writeFileSync(noteFile, fixture.seedNote());
  const otherFile = path.join(vaultDir, "Other note.md");
  fs.writeFileSync(otherFile, "# Other note\n\nSwitched-to file for the frozen Copy card.\n");
  const noteBytes = fs.readFileSync(noteFile);
  const configPath = writeConfig(configHome, fixture.baseConfigYaml());
  copyPlugin(path.join(repoRoot, "plugins", "bob-navigation-hotkeys"), pluginDir);
  fs.writeFileSync(
    path.join(vaultDir, ".obsidian", "community-plugins.json"),
    JSON.stringify(["bob-navigation-hotkeys"], null, 2),
  );
  fs.writeFileSync(
    path.join(vaultDir, ".obsidian", "app.json"),
    JSON.stringify({ livePreview: false, showLineNumber: false, showInlineTitle: false }, null, 2),
  );
  fs.writeFileSync(
    path.join(vaultDir, ".obsidian", "appearance.json"),
    JSON.stringify({ cssTheme: "", theme: "moonstone" }, null, 2),
  );
  fs.writeFileSync(
    path.join(vaultDir, ".obsidian", "core-plugins.json"),
    JSON.stringify(["file-explorer", "command-palette", "editor-status"], null, 2),
  );
  const vaultRealPath = fs.realpathSync(vaultDir);
  const id = Math.random().toString(16).slice(2, 12);
  fs.writeFileSync(
    path.join(profileDir, "obsidian.json"),
    JSON.stringify({ vaults: { [id]: { path: vaultRealPath, ts: Date.now(), open: true } } }, null, 2),
  );
  return { homeDir, vaultDir, vaultRealPath, configHome, configPath, profileDir, noteFile, noteBytes };
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
      try { message = JSON.parse(event.data); } catch (_error) { return; }
      const item = this.pending.get(message.id);
      if (!item) return;
      this.pending.delete(message.id);
      clearTimeout(item.timer);
      if (message.error) item.reject(new Error(item.method + ": " + message.error.message));
      else item.resolve(message.result || {});
    });
    socket.addEventListener("close", () => {
      this.closed = true;
      for (const item of this.pending.values()) {
        clearTimeout(item.timer);
        item.reject(new Error(item.method + ": CDP socket closed"));
      }
      this.pending.clear();
    });
  }

  static async connect(endpoint) {
    const WebSocketClient = typeof globalThis.WebSocket === "function"
      ? globalThis.WebSocket
      : require("undici").WebSocket;
    const socket = new WebSocketClient(endpoint);
    await lib.withTimeout(new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new Error("CDP websocket connection failed")), { once: true });
    }), 15_000, "CDP connect");
    return new CdpClient(socket);
  }

  call(method, params, timeoutMs) {
    if (this.closed) return Promise.reject(new Error(method + ": socket is closed"));
    const id = this.nextId++;
    return lib.withTimeout(new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(method + " timed out"));
      }, timeoutMs || 10_000);
      this.pending.set(id, { resolve, reject, method, timer });
      try {
        this.socket.send(JSON.stringify({ id, method, params: params || {} }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    }), (timeoutMs || 10_000) + 1000, method);
  }

  async evaluate(expression, timeoutMs) {
    const response = await this.call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    }, timeoutMs);
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || "evaluate failed");
    }
    return response.result?.value;
  }

  close() {
    try { this.socket.close(); } catch (_error) { /* already closed */ }
  }
}

const VAULT_PROBE = "(() => { const a=window.app&&window.app.vault&&window.app.vault.adapter; return a&&typeof a.basePath==='string'?a.basePath:null; })()";

async function selectFixtureTarget(port, vaultRealPath, childState) {
  const deadline = Date.now() + 45_000;
  let lastError = "";
  while (Date.now() < deadline) {
    if (childState.exit) throw new Error("owned Obsidian exited before opening fixture: " + childState.exit);
    let targets = [];
    try {
      const response = await fetch("http://127.0.0.1:" + port + "/json/list");
      if (response.ok) targets = await response.json();
    } catch (error) {
      lastError = String(error && error.message || error);
    }
    for (const target of Array.isArray(targets) ? targets : []) {
      if (target.type !== "page" || !target.webSocketDebuggerUrl) continue;
      let client = null;
      try {
        client = await CdpClient.connect(target.webSocketDebuggerUrl);
        const reported = await client.evaluate(VAULT_PROBE, 5000);
        if (lib.verifyVaultPath(reported, vaultRealPath)) return target;
      } catch (error) {
        lastError = String(error && error.message || error);
      } finally {
        if (client) client.close();
      }
    }
    await sleep(350);
  }
  throw new Error("no CDP page reports the scratch vault" + (lastError ? ": " + lastError.slice(0, 180) : ""));
}

async function dismissScratchTrustModal(client) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const result = await client.evaluate("(() => { const doc=" + appDocProbe() + "; const buttons=Array.from(doc.querySelectorAll('button')); const trust=buttons.find(button=>/Trust author and enable plugins/i.test(button.textContent||'')); if(!trust)return {clicked:false,restricted:buttons.some(button=>/Browse vault in Restricted Mode/i.test(button.textContent||''))}; trust.click(); return {clicked:true}; })()").catch(() => ({ clicked: false }));
    if (result && result.clicked) {
      await sleep(500);
      return true;
    }
    await sleep(200);
  }
  return false;
}

function appDocProbe() {
  return "(() => { const app=window.app; return app&&app.workspace&&app.workspace.containerEl&&app.workspace.containerEl.ownerDocument||document; })()";
}

function cardProbeExpression() {
  return "(() => { try { const app=window.app; const doc=app&&app.workspace&&app.workspace.containerEl&&app.workspace.containerEl.ownerDocument||document; const notice=Array.from(doc.querySelectorAll('.notice')).map(el=>String(el.textContent||'').trim()).slice(-1)[0]||''; const root=doc.querySelector('.bob-copy-card'); const modal=doc.querySelector('.modal.bob-copy-card-modal'); if(!root||!modal)return {open:false,notice}; const rows=Array.from(root.querySelectorAll('.bob-copy-card-row')).map(row=>{ const key=row.querySelector('.bob-copy-card-key'); const value=row.querySelector('.bob-copy-card-value'); const reason=row.querySelector('.bob-copy-card-reason,.bob-copy-card-reason-text'); const id=String(row.id||'').replace(/^bob-copy-card-row-/,''); const state=['unavailable','error','collision'].find(name=>row.classList.contains('is-'+name))||'ready'; return {id,key:String(key&&key.textContent||'').trim().toLowerCase(),label:String((row.querySelector('.bob-copy-card-label')||{}).textContent||'').trim(),value:String(value&&value.textContent||'').trim(),reason:String(reason&&reason.textContent||'').trim(),state,disabled:row.getAttribute('aria-disabled')==='true',selected:row.getAttribute('aria-selected')==='true'}; }); const divider=root.querySelector('.bob-copy-card-divider'); const block=rows.find(row=>row.id==='block-id'); const taskState=!divider?'none':block&&block.state==='unavailable'?'no-id':'ready'; return {open:true,title:String((root.querySelector('.bob-copy-card-title')||{}).textContent||'').trim(),subtitle:String((root.querySelector('.bob-copy-card-subtitle')||{}).textContent||'').trim(),rows,taskDivider:Boolean(divider),taskState,taskTitle:String((divider&&divider.querySelector('.bob-copy-card-divider-title')||{}).textContent||'').trim(),footer:String((root.querySelector('.bob-copy-card-footer')||{}).textContent||'').trim(),live:String((root.querySelector('.bob-copy-card-live')||{}).textContent||'').trim(),notice}; } catch(e) { return {open:false,error:String(e&&e.message||e)}; } })()";
}

async function waitFor(client, expression, predicate, label, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 8000);
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
  throw new Error("timed out waiting for " + label + ": " + JSON.stringify(last));
}

async function openNote(client, notePath, options) {
  const note = JSON.stringify(notePath);
  const livePreview = options && options.livePreview === true;
  const sourceFlag = livePreview ? "false" : "true";
  const expression = "(() => (async()=>{ const file=window.app.vault.getAbstractFileByPath(" + note + "); if(!file)return {ok:false,error:'missing note'}; const leaf=window.app.workspace.getLeaf(false); await leaf.openFile(file,{state:{mode:'source',source:" + sourceFlag + "}}); const view=leaf.view; if(view&&view.setState){ const state=view.getState?view.getState():{}; await view.setState(Object.assign({},state,{mode:'source',source:" + sourceFlag + "}),{history:false}); } await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); return {ok:true,mode:view&&view.getMode?view.getMode():null,livePreview:" + (livePreview ? "true" : "false") + ",state:view&&view.getState?view.getState():null}; })())()";
  return client.evaluate(expression, 15_000);
}

async function setCursor(client, needle) {
  const text = JSON.stringify(needle);
  return client.evaluate("(() => { const leaf=window.app.workspace.activeLeaf; const editor=leaf&&leaf.view&&leaf.view.editor; if(!editor)return {ok:false,error:'no editor'}; const lines=editor.getValue().split(/\\r?\\n/); const line=lines.findIndex(value=>value.includes(" + text + ")); if(line<0)return {ok:false,error:'missing line: '+ " + text + "}; editor.setCursor({line,ch:Math.max(0,lines[line].indexOf('-'))}); editor.focus(); return {ok:true,line,text:lines[line],selections:editor.listSelections().length}; })()");
}

function keyDispatchEvents(options) {
  const settings = options || {};
  const key = String(settings.key || "");
  const code = settings.code || (key === "Enter" ? "Enter" : key.length === 1 ? "Key" + key.toUpperCase() : key);
  const modifier = settings.ctrl === true ? { key: "Control", code: "ControlLeft", bit: 2, vk: 17 } : null;
  const events = [];
  if (modifier) events.push({ type: "keyDown", key: modifier.key, code: modifier.code, modifiers: modifier.bit, windowsVirtualKeyCode: modifier.vk, nativeVirtualKeyCode: modifier.vk });
  const mask = modifier ? modifier.bit : 0;
  const vk = key === "Enter" ? 13 : key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0;
  events.push({
    type: "keyDown",
    key,
    code,
    modifiers: mask,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
    ...(settings.autoRepeat ? { autoRepeat: true } : {}),
  });
  if (!settings.hold) {
    events.push({ type: "keyUp", key, code, modifiers: mask, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    if (modifier) events.push({ type: "keyUp", key: modifier.key, code: modifier.code, modifiers: 0, windowsVirtualKeyCode: modifier.vk, nativeVirtualKeyCode: modifier.vk });
  }
  return events;
}

async function dispatchKey(client, options) {
  const events = keyDispatchEvents(options);
  for (const event of events) await client.call("Input.dispatchKeyEvent", event, 5000);
  return events;
}

async function dispatchHeldModYThenRepeat(client) {
  const events = [
    { type: "keyDown", key: "Control", code: "ControlLeft", modifiers: 2, windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17 },
    { type: "keyDown", key: "y", code: "KeyY", modifiers: 2, windowsVirtualKeyCode: 89, nativeVirtualKeyCode: 89 },
    { type: "keyDown", key: "y", code: "KeyY", modifiers: 2, windowsVirtualKeyCode: 89, nativeVirtualKeyCode: 89, autoRepeat: true },
    { type: "keyUp", key: "y", code: "KeyY", modifiers: 2, windowsVirtualKeyCode: 89, nativeVirtualKeyCode: 89 },
    { type: "keyUp", key: "Control", code: "ControlLeft", modifiers: 0, windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17 },
  ];
  for (const event of events) await client.call("Input.dispatchKeyEvent", event, 5000);
}

async function readClipboard(client) {
  return client.evaluate("(() => (async()=>{ const nav=navigator.clipboard; if(nav&&typeof nav.readText==='function'){ try{return {ok:true,value:await nav.readText(),source:'navigator.clipboard'};}catch(e){return {ok:false,error:String(e&&e.message||e)};} } try{ const req=window.require||require; const electron=req('electron'); if(electron&&electron.clipboard)return {ok:true,value:electron.clipboard.readText(),source:'electron.clipboard'}; }catch(e){} return {ok:false,error:'clipboard read API unavailable'}; })())()");
}

async function writeClipboard(client, value) {
  const text = JSON.stringify(value);
  return client.evaluate("(() => (async()=>{ try{ if(navigator.clipboard&&typeof navigator.clipboard.writeText==='function'){ await navigator.clipboard.writeText(" + text + "); return {ok:true}; } const req=window.require||require; const electron=req('electron'); if(electron&&electron.clipboard){electron.clipboard.writeText(" + text + ");return {ok:true};} return {ok:false,error:'clipboard write API unavailable'}; }catch(e){return {ok:false,error:String(e&&e.message||e)};} })())()");
}

async function openCardAt(client, needle, ctrlY) {
  const cursor = await setCursor(client, needle);
  if (!cursor || cursor.ok !== true) throw new Error("could not position cursor: " + JSON.stringify(cursor));
  await client.evaluate("(() => { const doc=" + appDocProbe() + "; window.__copyCardKeyEvents=[]; doc.addEventListener('keydown',event=>window.__copyCardKeyEvents.push({key:event.key,code:event.code,ctrl:event.ctrlKey,meta:event.metaKey,repeat:event.repeat}),true); return true; })()");
  await dispatchKey(client, { key: "y", ctrl: true });
  let card;
  try {
    card = await waitFor(client, cardProbeExpression(), (value) => value && value.open, "Copy card open");
  } catch (error) {
    const diagnostic = await client.evaluate("(() => { const app=window.app; let command=null; try{command=app.commands.findCommand('bob-navigation-hotkeys:copy-active-file-path');}catch(e){} return {events:window.__copyCardKeyEvents||[],command:command&&{id:command.id,hotkeys:command.hotkeys},platform:navigator.platform,userAgent:navigator.userAgent,active:String((app.workspace.containerEl.ownerDocument.activeElement||{}).outerHTML||'').slice(0,120)}; })()").catch(() => null);
    throw new Error(error.message + "; key diagnostic " + JSON.stringify(diagnostic));
  }
  if (ctrlY === false) return card;
  return card;
}

async function closeCard(client) {
  await dispatchKey(client, { key: "Escape" });
  return waitFor(client, cardProbeExpression(), (value) => !value || !value.open, "Copy card closed");
}

async function captureScreenshot(client, output) {
  const result = await client.call("Page.captureScreenshot", { format: "png", fromSurface: true });
  fs.writeFileSync(output, Buffer.from(result.data, "base64"));
}

async function setTheme(client, theme) {
  const dark = theme === "dark";
  await client.evaluate("(() => { const doc=" + appDocProbe() + "; doc.body.classList.toggle('theme-dark'," + dark + "); doc.body.classList.toggle('theme-light'," + !dark + "); return true; })()");
  await sleep(180);
}

async function dismissNotices(client) {
  await client.evaluate("(() => { const doc=" + appDocProbe() + "; Array.from(doc.querySelectorAll('.notice')).forEach((el) => el.remove()); return true; })()").catch(() => true);
}

async function capturePair(client, outDir, slug, report) {
  await dismissNotices(client);
  for (const theme of ["light", "dark"]) {
    await setTheme(client, theme);
    const output = path.join(outDir, "copy-card-" + slug + "-" + theme + ".png");
    await captureScreenshot(client, output);
    report.screenshots.push(output);
  }
  await setTheme(client, "light");
}

async function setViewportWidth(client, width) {
  await client.call("Emulation.setDeviceMetricsOverride", {
    width,
    height: 820,
    deviceScaleFactor: 1,
    mobile: false,
  });
}

function inside(directory, candidate) {
  const base = path.resolve(directory) + path.sep;
  const target = path.resolve(candidate);
  return target === path.resolve(directory) || target.startsWith(base);
}

function runSelfTest() {
  const text = fixture.seedNote();
  assert.ok(text.includes("^" + fixture.TASKS.id.blockId));
  assert.ok(text.includes("- [ ] #task " + fixture.TASKS.noId.title));
  assert.ok(text.includes("- [x] #task " + fixture.TASKS.closed.title));
  assert.ok(text.includes("[[Copy card e2e#^" + fixture.TASKS.id.blockId));
  assert.ok(text.includes("Plain prose"));
  assert.ok(text.includes("Fence example"));
  assert.ok(text.includes("Four-space example"));
  assert.ok(text.includes("Tilde example"));
  assert.ok(text.includes("- [ ] 2026-11-01 grocery store"));
  const base = fixture.baseConfigYaml();
  const full = fixture.fullConfigYaml();
  const overflow = fixture.overflowConfigYaml();
  assert.match(base, /template: "\[\[\{note_name\}\]\]"/);
  assert.match(full, /the \^\{block_id\} task in the \{path\} file/);
  assert.match(full, /template: \{ path: value \}/);
  assert.match(full, /key: p/);
  assert.match(overflow, /Overflow 12/);
  const values = fixture.expectedValues("/tmp/home/bob", "/tmp/home");
  assert.equal(values.path, "~/bob/Copy card e2e.md");
  assert.equal(values.taskRef, "the ^bank-records task in the ~/bob/Copy card e2e.md file");
  assert.equal(values.absolute, "/tmp/home/bob/Copy card e2e.md");
  const probe = {
    open: true,
    title: "Copy",
    taskDivider: true,
    taskState: "ready",
    taskTitle: fixture.TASKS.id.title,
    rows: [
      { id: "path", state: "ready" },
      { id: "block-id", state: "ready" },
      { id: "template-3", state: "error", disabled: true },
      { id: "template-4", state: "error", disabled: true },
      { id: "template-5", state: "collision", key: "", disabled: false },
    ],
  };
  assert.equal(fixture.assertProbe(probe, {
    rows: ["path", "block-id"],
    taskDivider: true,
    taskState: "ready",
    taskTitle: fixture.TASKS.id.title,
    errorRows: ["template-3", "template-4"],
    collisionRows: ["template-5"],
  }).ok, true);
  assert.deepEqual(fixture.assertScreenshotList(fixture.expectedScreenshotNames()), { ok: true, missing: [] });
  const args = parseArgs(["--out", "/tmp/shots", "--executable", "/snap/bin/obsidian", "--self-test"]);
  assert.equal(args.out, "/tmp/shots");
  assert.equal(args.executable, "/snap/bin/obsidian");
  assert.equal(args.selfTest, true);
  assert.throws(() => parseArgs(["--out"]));
  assert.throws(() => parseArgs(["--wat"]));
  const events = keyDispatchEvents({ key: "y", ctrl: true });
  assert.deepEqual(events.map((event) => event.type), ["keyDown", "keyDown", "keyUp", "keyUp"]);
  assert.ok(events[1].modifiers & 2);
  console.log("offline self-test complete (not an Obsidian pass)");
}

async function runE2e(args) {
  const executable = findExecutable(args.executable);
  try { fs.accessSync(executable, fs.constants.X_OK); } catch (_error) {
    fail("Obsidian executable is not executable: " + executable + ". Pass -e PATH.", 2);
  }
  if (!process.env.DISPLAY && !process.env.XVFB_RUN_TMPDIR) {
    fail("no X display; rerun under xvfb-run -a node scripts/obsidian-copy-card-e2e.cjs", 2);
  }
  const outDir = path.resolve(args.out || path.join(TEMP_ROOT, "bob-copy-card-e2e-" + Date.now()));
  if (inside(repoRoot, outDir)) fail("--out must be outside the bob-plugins repository", 2);
  fs.mkdirSync(outDir, { recursive: true });
  const runRoot = makeTemp("bcc-");
  const scratch = makeFixture(runRoot);
  const report = {
    executable,
    vault: scratch.vaultRealPath,
    screenshots: [],
    cases: [],
    pass: false,
    out: outDir,
  };
  const record = (name, ok, detail) => {
    report.cases.push({ name, ok: Boolean(ok), detail: detail || "" });
    console.log((ok ? "PASS " : "FAIL ") + name + (detail ? " (" + String(detail).slice(0, 240) + ")" : ""));
  };
  const port = await freePort();
  const child = spawn(executable, [
    "--no-sandbox",
    "--user-data-dir=" + scratch.profileDir,
    "--remote-debugging-port=" + port,
    "--remote-allow-origins=http://127.0.0.1/*",
    scratch.vaultRealPath,
  ], {
    cwd: scratch.vaultRealPath,
    env: {
      ...process.env,
      HOME: scratch.homeDir,
      BOB_DIR: scratch.vaultRealPath,
      XDG_CONFIG_HOME: scratch.configHome,
      TMPDIR: "/tmp",
    },
    stdio: "ignore",
  });
  const childState = { exit: "" };
  child.once("exit", (code, signal) => {
    childState.exit = "code=" + code + " signal=" + (signal || "none");
  });
  let client = null;
  try {
    const target = await selectFixtureTarget(port, scratch.vaultRealPath, childState);
    client = await CdpClient.connect(target.webSocketDebuggerUrl);
    await client.call("Page.enable");
    await client.call("Runtime.enable");
    await client.call("Input.enable").catch(() => ({}));
    await waitFor(client, "Boolean(window.app&&window.app.workspace&&window.app.workspace.layoutReady)", (value) => value === true, "Obsidian layout ready", 30_000);
    await dismissScratchTrustModal(client);
    await client.evaluate("(() => (async()=>{ const p=window.app&&window.app.plugins; if(p&&typeof p.isEnabled==='function'&&!p.isEnabled())await p.setEnable(true); return true; })())()");
    const plugin = await waitFor(client,
      "Boolean(window.app&&window.app.plugins&&window.app.plugins.plugins&&window.app.plugins.plugins['bob-navigation-hotkeys'])",
      (value) => value === true,
      "bob-navigation-hotkeys plugin",
      30_000,
    );
    record("plugin-loaded", plugin === true);

    const opened = await openNote(client, fixture.notePath());
    record("scratch-note-open", Boolean(opened && opened.ok), JSON.stringify(opened));
    await sleep(300);
    const expected = fixture.expectedValues(scratch.vaultDir, scratch.homeDir);

    // Clean config yields the prose and identified-task states without diagnostics.
    let card = await openCardAt(client, "Plain prose for the file-only", true);
    let check = fixture.assertProbe(card, {
      rows: ["path", "absolute", "file", "note", "template-1"],
      noRows: ["block-id"],
      taskDivider: false,
      taskState: "none",
    });
    record("prose-file-only-state", check.ok, check.failures.join("; "));
    await capturePair(client, outDir, "prose", report);
    await closeCard(client);

    card = await openCardAt(client, fixture.TASKS.id.title, true);
    check = fixture.assertProbe(card, {
      rows: ["path", "absolute", "file", "note", "block-id", "template-1"],
      taskDivider: true,
      taskState: "ready",
      taskTitle: fixture.TASKS.id.title,
    });
    record("identified-task-state", check.ok, check.failures.join("; "));
    await capturePair(client, outDir, "identified-task", report);
    await closeCard(client);

    // Expand the scratch-only config. The next Cmd+Y must read it immediately.
    fs.writeFileSync(scratch.configPath, fixture.fullConfigYaml());
    await sleep(30);

    card = await openCardAt(client, fixture.TASKS.id.title, true);
    check = fixture.assertProbe(card, {
      rows: ["block-id", "template-1", "template-2", "template-3", "template-4", "template-5"],
      taskDivider: true,
      taskState: "ready",
      taskTitle: fixture.TASKS.id.title,
      errorRows: ["template-3", "template-4"],
      collisionRows: ["template-5"],
    });
    record("broken-and-collision-rows", check.ok, check.failures.join("; "));
    record("reserved-key-p-keeps-path", check.rows.get("path")?.key === "p");
    record("template-key-t", check.rows.get("template-1")?.key === "t");
    record("positional-key-2", check.rows.get("template-2")?.key === "2");
    await capturePair(client, outDir, "broken-collision", report);
    await closeCard(client);

    card = await openCardAt(client, fixture.TASKS.noId.title, true);
    check = fixture.assertProbe(card, {
      rows: ["block-id", "template-1", "template-2", "template-3", "template-4", "template-5"],
      taskDivider: true,
      taskState: "no-id",
      taskTitle: fixture.TASKS.noId.title,
      unavailableRows: ["block-id", "template-1"],
      errorRows: ["template-3", "template-4"],
      collisionRows: ["template-5"],
    });
    record("no-id-task-state", check.ok, check.failures.join("; "));
    await capturePair(client, outDir, "no-id", report);
    await closeCard(client);

    card = await openCardAt(client, fixture.TASKS.id.title, true);
    await setViewportWidth(client, 460);
    record("narrow-card-open", card && card.open === true);
    await capturePair(client, outDir, "narrow-460", report);
    await client.call("Emulation.clearDeviceMetricsOverride").catch(() => ({}));
    await closeCard(client);

    async function seedClipboard(name) {
      const sentinel = "copy-card-sentinel-" + name + "-" + Date.now() + "-" + Math.random().toString(16).slice(2, 8);
      const result = await writeClipboard(client, sentinel);
      return { sentinel, ok: Boolean(result && result.ok) };
    }

    const initialClip = await seedClipboard("start");
    record("clipboard-seed", initialClip.ok === true, initialClip.sentinel);

    async function copyByKey(name, needle, key, value, options) {
      const seeded = await seedClipboard(name);
      await openCardAt(client, needle, true);
      await dispatchKey(client, { key, ctrl: options && options.ctrl === true });
      const closed = await waitFor(client, cardProbeExpression(), (state) => !state || !state.open, "card close after " + key);
      const copied = await readClipboard(client);
      const ok = Boolean(
        closed &&
        copied &&
        copied.ok &&
        copied.value === value &&
        copied.value !== seeded.sentinel,
      );
      record(name, ok, copied && copied.ok ? copied.value : copied && copied.error || "clipboard unavailable");
      record(name + "-notice", Boolean(closed && /^Copied /.test(closed.notice || "")), closed && closed.notice || "");
    }

    await copyByKey("copy-path-P", fixture.TASKS.id.title, "p", expected.path);
    await copyByKey("copy-absolute-A", fixture.TASKS.id.title, "a", expected.absolute);
    await copyByKey("copy-file-F", fixture.TASKS.id.title, "f", expected.fileName);
    await copyByKey("copy-note-N", fixture.TASKS.id.title, "n", expected.noteName);
    await copyByKey("copy-block-id-I", fixture.TASKS.id.title, "i", expected.blockId);
    await copyByKey("copy-task-ref-T", fixture.TASKS.id.title, "t", expected.taskRef);
    await copyByKey("copy-positional-template-2", fixture.TASKS.id.title, "2", expected.noteLink);
    await copyByKey("collision-row-does-not-steal-P", fixture.TASKS.id.title, "p", expected.path);
    await copyByKey("closed-task-block-id-I", fixture.TASKS.closed.title, "i", expected.closedBlockId);

    const enterSeed = await seedClipboard("enter");
    await openCardAt(client, fixture.TASKS.id.title, true);
    await dispatchKey(client, { key: "Enter" });
    await waitFor(client, cardProbeExpression(), (state) => !state || !state.open, "Enter copy");
    const enterClip = await readClipboard(client);
    record("copy-enter-default-path", Boolean(enterClip && enterClip.ok && enterClip.value === expected.path && enterClip.value !== enterSeed.sentinel), enterClip && enterClip.value || "");

    const downSeed = await seedClipboard("arrow-down-enter");
    await openCardAt(client, fixture.TASKS.id.title, true);
    await dispatchKey(client, { key: "ArrowDown" });
    await dispatchKey(client, { key: "Enter" });
    await waitFor(client, cardProbeExpression(), (state) => !state || !state.open, "ArrowDown Enter copy");
    const downClip = await readClipboard(client);
    record("copy-arrow-down-enter", Boolean(downClip && downClip.ok && downClip.value === expected.absolute && downClip.value !== downSeed.sentinel), downClip && downClip.value || "");

    const ctrlNSeed = await seedClipboard("ctrl-n-enter");
    await openCardAt(client, fixture.TASKS.id.title, true);
    await dispatchKey(client, { key: "n", ctrl: true });
    await dispatchKey(client, { key: "Enter" });
    await waitFor(client, cardProbeExpression(), (state) => !state || !state.open, "Ctrl+N Enter copy");
    const ctrlNClip = await readClipboard(client);
    record("copy-ctrl-n-enter", Boolean(ctrlNClip && ctrlNClip.ok && ctrlNClip.value === expected.absolute && ctrlNClip.value !== ctrlNSeed.sentinel), ctrlNClip && ctrlNClip.value || "");

    const escapeSeed = await seedClipboard("escape");
    await openCardAt(client, fixture.TASKS.id.title, true);
    await closeCard(client);
    const escapeClip = await readClipboard(client);
    record("escape-closes-without-copy", Boolean(escapeClip && escapeClip.ok && escapeClip.value === escapeSeed.sentinel), escapeClip && escapeClip.value || "");

    const twiceSeed = await seedClipboard("mod-y-twice");
    await openCardAt(client, fixture.TASKS.id.title, true);
    await dispatchKey(client, { key: "y", ctrl: true });
    const twiceClosed = await waitFor(client, cardProbeExpression(), (state) => !state || !state.open, "Cmd+Y Cmd+Y copy");
    const twiceClip = await readClipboard(client);
    record("fresh-mod-y-copies-highlight", Boolean(twiceClosed && twiceClip && twiceClip.ok && twiceClip.value === expected.path && twiceClip.value !== twiceSeed.sentinel), twiceClip && twiceClip.value || "");

    await writeClipboard(client, "copy-card-repeat-sentinel");
    await dispatchHeldModYThenRepeat(client);
    card = await waitFor(client, cardProbeExpression(), (state) => state && state.open, "held Mod+Y card");
    const repeatClip = await readClipboard(client);
    record("held-mod-y-repeat-does-not-copy", Boolean(card && repeatClip && repeatClip.ok && repeatClip.value === "copy-card-repeat-sentinel"), repeatClip && repeatClip.value || "");
    await closeCard(client);

    await writeClipboard(client, "copy-card-refusal-sentinel");
    await openCardAt(client, fixture.TASKS.noId.title, true);
    await dispatchKey(client, { key: "i" });
    card = await waitFor(client, cardProbeExpression(), (state) => state && state.open && /Ctrl\+6/.test(state.live), "refused Block ID");
    const refusedClip = await readClipboard(client);
    record("no-id-I-refuses-and-explains", Boolean(card && card.live.includes("Ctrl+6") && card.rows.some((row) => row.id === "block-id" && row.selected) && refusedClip && refusedClip.ok && refusedClip.value === "copy-card-refusal-sentinel"), JSON.stringify({ live: card && card.live, copied: refusedClip && refusedClip.value }));
    await closeCard(client);

    await openCardAt(client, "Copy card e2e#^" + fixture.TASKS.id.blockId, true);
    card = await client.evaluate(cardProbeExpression());
    record("pomodoro-task-link-has-no-task-group", card && card.open && !card.taskDivider && card.taskState === "none", JSON.stringify(card && { divider: card.taskDivider, state: card.taskState }));
    await writeClipboard(client, "copy-card-hidden-I-sentinel");
    await dispatchKey(client, { key: "i" });
    card = await client.evaluate(cardProbeExpression());
    const hiddenClip = await readClipboard(client);
    record("hidden-reserved-I-is-consumed", Boolean(card && card.open && !card.taskDivider && hiddenClip && hiddenClip.ok && hiddenClip.value === "copy-card-hidden-I-sentinel"), hiddenClip && hiddenClip.value || "");
    await closeCard(client);

    async function assertFenceHasNoTask(name, needle) {
      card = await openCardAt(client, needle, true);
      record(name, Boolean(card && card.open && !card.taskDivider && card.taskState === "none"), JSON.stringify(card && { divider: card.taskDivider, state: card.taskState, title: card.taskTitle }));
      await closeCard(client);
    }
    await assertFenceHasNoTask("source-nested-backtick-fence-is-file-only", "Fence example");
    await assertFenceHasNoTask("source-four-space-fence-is-file-only", "Four-space example");
    await assertFenceHasNoTask("source-nested-tilde-fence-is-file-only", "Tilde example");
    await assertFenceHasNoTask("bank-checkbox-without-task-is-file-only", "2026-11-01 grocery store");

    const liveOpened = await openNote(client, fixture.notePath(), { livePreview: true });
    record("live-preview-open", Boolean(liveOpened && liveOpened.ok && liveOpened.mode === "source"), JSON.stringify(liveOpened));
    await assertFenceHasNoTask("live-preview-nested-fence-is-file-only", "Fence example");
    await openNote(client, fixture.notePath());

    card = await openCardAt(client, fixture.TASKS.id.title, true);
    const frozenPath = (card.rows || []).find((row) => row.id === "path");
    const switched = await openNote(client, "Other note.md");
    const stillOpen = await client.evaluate(cardProbeExpression());
    record("file-switch-while-open-keeps-snapshot", Boolean(
      switched &&
      switched.ok &&
      stillOpen &&
      stillOpen.open &&
      frozenPath &&
      (stillOpen.rows || []).some((row) => row.id === "path" && row.value === frozenPath.value),
    ), JSON.stringify({ switched, path: stillOpen && (stillOpen.rows || []).find((row) => row.id === "path") }));
    if (stillOpen && stillOpen.open) await closeCard(client);
    await openNote(client, fixture.notePath());

    fs.writeFileSync(scratch.configPath, fixture.overflowConfigYaml());
    await sleep(30);
    card = await openCardAt(client, "Plain prose for the file-only", true);
    record("long-list-open", Boolean(card && card.open && (card.rows || []).some((row) => row.label === "Overflow 12")), JSON.stringify(card && { count: (card.rows || []).length }));
    await capturePair(client, outDir, "long-list", report);
    await dispatchKey(client, { key: "ArrowUp" });
    card = await client.evaluate(cardProbeExpression());
    record("long-list-wraps-to-last-copyable", Boolean(card && card.open && (card.rows || []).some((row) => row.selected && /Overflow 12/.test(row.label || ""))), JSON.stringify(card && { selected: (card.rows || []).find((row) => row.selected) }));
    await closeCard(client);

    card = await openCardAt(client, fixture.TASKS.noId.title, true);
    await dispatchKey(client, { key: "i" });
    card = await waitFor(client, cardProbeExpression(), (state) => state && state.open && /Ctrl\+6/.test(state.live), "overflow refused Block ID");
    record("visible-refusal-on-overflow", Boolean(card && card.live.includes("Ctrl+6") && (card.rows || []).some((row) => row.id === "block-id" && row.selected)), JSON.stringify({ live: card && card.live }));
    await capturePair(client, outDir, "visible-refusal", report);
    await closeCard(client);

    const afterBytes = fs.readFileSync(scratch.noteFile);
    record("scratch-note-bytes-unchanged", Buffer.compare(scratch.noteBytes, afterBytes) === 0);
    const screenshots = fixture.assertScreenshotList(report.screenshots);
    record("light-dark-screenshot-coverage", screenshots.ok, screenshots.missing.join(", "));
    report.pass = report.cases.every((item) => item.ok);
    if (args.report) {
      fs.mkdirSync(path.dirname(path.resolve(args.report)), { recursive: true });
      fs.writeFileSync(path.resolve(args.report), JSON.stringify(report, null, 2));
    }
    console.log(JSON.stringify({
      pass: report.pass,
      failed: report.cases.filter((item) => !item.ok).map((item) => item.name),
      screenshots: report.screenshots,
      out: report.out,
    }, null, 2));
    if (!report.pass) fail("Copy card e2e failed: " + report.cases.filter((item) => !item.ok).map((item) => item.name).join(", "));
    return report;
  } finally {
    if (client) client.close();
    try { if (child.exitCode == null && child.signalCode == null) child.kill("SIGTERM"); } catch (_error) { /* owned child */ }
    await new Promise((resolve) => {
      if (child.exitCode != null || child.signalCode != null) return resolve();
      const timer = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch (_error) { /* exited */ }
        resolve();
      }, 4000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
    fs.rmSync(runRoot, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }
  if (args.selfTest) {
    runSelfTest();
    return;
  }
  await Promise.race([
    runE2e(args),
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error("overall Copy card e2e watchdog fired")), OVERALL_TIMEOUT_MS);
      if (timer.unref) timer.unref();
    }),
  ]);
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = error && error.exitCode ? error.exitCode : 1;
});
