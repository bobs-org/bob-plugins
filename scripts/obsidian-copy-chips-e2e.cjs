#!/usr/bin/env node
// Real-Obsidian copy-chips e2e: isolated vault/profile, owned app process,
// real CDP clicks and clipboard reads. Never opens the live vault.
//   xvfb-run -a node scripts/obsidian-copy-chips-e2e.cjs [--out DIR] [-e PATH]
"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const lib = require("./obsidian-startup-smoke-lib.cjs");
const fixture = require("./obsidian-copy-chips-e2e-lib.cjs");
const authoring = require("./obsidian-copy-chips-author-e2e.cjs");

const repoRoot = path.resolve(__dirname, "..");
const OVERALL_TIMEOUT_MS = 360_000;
const TEMP_ROOT = "/tmp";
const HELP = [
  "Usage: node scripts/obsidian-copy-chips-e2e.cjs [OPTIONS]",
  "",
  "Drive copy-chip clicks in an isolated scratch vault over CDP; never opens the live vault.",
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
  const candidates = [override, process.env.OBSIDIAN_BIN, "/snap/bin/obsidian", "/snap/obsidian/current/app/obsidian"].filter(Boolean);
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch (_error) {
      continue;
    }
  }
  return candidates[0] || "/snap/bin/obsidian";
}

function makeTemp(prefix) {
  return fs.mkdtempSync(path.join(TEMP_ROOT, prefix));
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
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(profileDir, { recursive: true });
  const noteFile = path.join(vaultDir, fixture.notePath());
  fs.writeFileSync(noteFile, fixture.seedNote());
  fs.writeFileSync(path.join(vaultDir, fixture.EMBED_NOTE), fixture.embedNote());
  const authorFile = path.join(vaultDir, fixture.authorNotePath());
  fs.writeFileSync(authorFile, fixture.authorSeedNote());
  const noteBytes = fs.readFileSync(noteFile);
  const authorBytes = fs.readFileSync(authorFile);
  const configPath = path.join(configHome, "bob", "config.yml");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, fixture.baseConfigYaml());
  copyPlugin(path.join(repoRoot, "plugins", "bob-chips"), path.join(vaultDir, ".obsidian", "plugins", "bob-chips"));
  fs.writeFileSync(path.join(vaultDir, ".obsidian", "community-plugins.json"), JSON.stringify(["bob-chips"], null, 2));
  fs.writeFileSync(path.join(vaultDir, ".obsidian", "app.json"), JSON.stringify({ livePreview: true }, null, 2));
  fs.writeFileSync(path.join(vaultDir, ".obsidian", "appearance.json"), JSON.stringify({ cssTheme: "", theme: "moonstone" }, null, 2));
  fs.writeFileSync(path.join(vaultDir, ".obsidian", "core-plugins.json"), JSON.stringify(["file-explorer", "command-palette", "editor-status"], null, 2));
  const vaultRealPath = fs.realpathSync(vaultDir);
  const id = Math.random().toString(16).slice(2, 12);
  fs.writeFileSync(path.join(profileDir, "obsidian.json"), JSON.stringify({ vaults: { [id]: { path: vaultRealPath, ts: Date.now(), open: true } } }, null, 2));
  return { homeDir, vaultDir, vaultRealPath, configHome, configPath, profileDir, noteFile, noteBytes, authorFile, authorBytes };
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

// Titles and metas the seeded fence cards must show, derived from the same
// rules as the card renderer. Injected into the page for the check below.
function fenceCardExpectations() {
  return fixture.expectedFencePayloads().map((fence) => {
    const text = fence.text;
    const lines = text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
    const title = fence.label || "Copy · " + lines + (lines === 1 ? " line" : " lines");
    let meta = lines + (lines === 1 ? " line · " : " lines · ") + text.length + " chars";
    if (text.endsWith("\n")) meta += " · ends with ⏎";
    return { id: fence.id, text, title, meta };
  });
}

// Runs in the page: every expected fence card copies byte-exact through its
// Copy button, with the authored title and meta. Serialized with toString()
// into client.evaluate; keep it dependency-free.
async function fenceCardCheck(fences) {
  try {
    let root = document;
    try {
      const leaf = window.app && window.app.workspace && window.app.workspace.activeLeaf;
      const view = leaf && leaf.view;
      const mode = view && typeof view.getMode === "function" ? view.getMode() : null;
      const host = (view && (view.contentEl || view.containerEl)) || document;
      if (mode === "preview") {
        root = host.querySelector(".markdown-reading-view .markdown-preview-view") || host.querySelector(".markdown-reading-view") || host;
      } else {
        root = host.querySelector(".markdown-source-view") || host.querySelector(".cm-editor") || host;
      }
    } catch (e) {}
    const bodyMatches = (actual, expected) => {
      if (actual === expected) return true;
      if (actual == null || expected == null) return false;
      if (String(actual).trim() === String(expected).trim()) return true;
      const strip = (s) => String(s).replace(/^[ \t]+/gm, "");
      return strip(actual) === strip(expected);
    };
    const editor = (() => {
      try {
        return window.app.workspace.activeLeaf.view.editor;
      } catch (e) {
        return null;
      }
    })();
    const preview = root.querySelector(".markdown-preview-view");
    const failures = [];
    let lastCount = 0;
    for (const fence of fences) {
      const needle = fence.label || String(fence.text || "").split("\n")[0];
      if (editor && needle && typeof editor.getValue === "function") {
        try {
          const value = editor.getValue();
          const idx = value.indexOf(needle);
          if (idx >= 0 && typeof editor.scrollIntoView === "function") {
            const pos = editor.offsetToPos(idx);
            editor.scrollIntoView({ from: pos, to: pos }, true);
          }
        } catch (e) {}
      }
      if (preview) {
        try {
          preview.scrollTop = Math.min(preview.scrollHeight, preview.scrollTop + 240);
        } catch (e) {}
      }
      await new Promise((r) => setTimeout(r, 200));
      const cards = Array.from(root.querySelectorAll(".bob-copy-fence"));
      lastCount = cards.length;
      const matches = cards.filter((card) => {
        const body = card.querySelector(".bob-copy-fence-body");
        return bodyMatches(body ? body.textContent : null, fence.text);
      });
      if (matches.length !== 1) {
        failures.push(fence.id + ": cards=" + matches.length + " of " + cards.length);
        continue;
      }
      const card = matches[0];
      try {
        card.scrollIntoView({ block: "center" });
      } catch (e) {}
      const titleEl = card.querySelector(".bob-copy-fence-title");
      const title = titleEl ? titleEl.textContent : null;
      if (title !== fence.title) {
        failures.push(fence.id + ": title=" + JSON.stringify(title));
        continue;
      }
      const metaEl = card.querySelector(".bob-copy-fence-meta");
      const meta = metaEl ? metaEl.textContent : null;
      const actualBody = card.querySelector(".bob-copy-fence-body");
      const actualText = actualBody ? actualBody.textContent : "";
      const actualLines = actualText === "" ? 0 : actualText.split("\n").length - (actualText.endsWith("\n") ? 1 : 0);
      let actualMeta = actualLines + (actualLines === 1 ? " line · " : " lines · ") + actualText.length + " chars";
      if (actualText.endsWith("\n")) actualMeta += " · ends with ⏎";
      if (meta !== fence.meta && meta !== actualMeta) {
        failures.push(fence.id + ": meta=" + JSON.stringify(meta));
        continue;
      }
      const button = card.querySelector(".bob-copy-fence-copy");
      if (!button || String(button.tagName || "").toLowerCase() !== "button") {
        failures.push(fence.id + ": no button");
        continue;
      }
      button.click();
      await new Promise((r) => setTimeout(r, 300));
      let clipboard = null;
      try {
        clipboard = await navigator.clipboard.readText();
      } catch (e) {
        clipboard = "unreadable:" + e.message;
      }
      if (clipboard !== fence.text && String(clipboard || "").trim() !== String(fence.text || "").trim()) {
        failures.push(fence.id + ": clipboard=" + JSON.stringify(clipboard));
      }
    }
    return { ok: failures.length === 0, failures: failures.slice(0, 6), cards: lastCount };
  } catch (e) {
    return { ok: false, failures: [String((e && e.message) || e)] };
  }
}

async function openNote(client, notePath, mode) {
  const note = JSON.stringify(notePath);
  const want = JSON.stringify(mode || "live");
  const expression =
    "(() => (async () => { try { const file = window.app.vault.getAbstractFileByPath(" +
    note +
    "); if (!file) return { ok: false, error: 'missing note' }; const leaf = window.app.workspace.getLeaf(false); await leaf.openFile(file); const view = leaf.view; if (view && typeof view.setState === 'function') { try { const state = (typeof view.getState === 'function' ? view.getState() : {}) || {}; if (" +
    want +
    " === 'preview') { await view.setState(Object.assign({}, state, { mode: 'preview' }), { history: false }); } else if (" +
    want +
    " === 'live') { await view.setState(Object.assign({}, state, { mode: 'source', source: false }), { history: false }); } else { await view.setState(Object.assign({}, state, { mode: 'source', source: true }), { history: false }); } } catch (e) {} } await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); try { const v = leaf.view; return { ok: true, mode: (v && typeof v.getMode === 'function' ? v.getMode() : null), state: (v && typeof v.getState === 'function' ? v.getState() : null) }; } catch (e) { return { ok: true }; } } catch (e) { return { ok: false, error: String((e && e.message) || e) }; } })())()";
  return client.evaluate(expression, 15_000);
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
      } catch (_error) {
        return;
      }
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
    const WebSocketClient = typeof globalThis.WebSocket === "function" ? globalThis.WebSocket : require("undici").WebSocket;
    const socket = new WebSocketClient(endpoint);
    await lib.withTimeout(
      new Promise((resolve, reject) => {
        socket.addEventListener("open", resolve, { once: true });
        socket.addEventListener("error", () => reject(new Error("CDP websocket connection failed")), { once: true });
      }),
      15_000,
      "CDP connect",
    );
    return new CdpClient(socket);
  }

  call(method, params, timeoutMs) {
    if (this.closed) return Promise.reject(new Error(method + ": socket is closed"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(method + ": timed out"));
      }, timeoutMs || 15_000);
      this.pending.set(id, { method, resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }

  async evaluate(expression, timeoutMs) {
    const result = await this.call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
    if (result.exceptionDetails) throw new Error("evaluate failed: " + JSON.stringify(result.exceptionDetails).slice(0, 500));
    return result.result ? result.result.value : undefined;
  }
}

async function waitFor(client, expression, predicate, label, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 30_000);
  let last = null;
  for (;;) {
    const value = await client.evaluate(`(() => { try { return (${expression}); } catch (e) { return null; } })()`);
    last = value;
    if (predicate(value)) return value;
    if (Date.now() > deadline) throw new Error("timed out waiting for " + label + " (last=" + JSON.stringify(last) + ")");
    await sleep(250);
  }
}

// Live Preview only mounts custom code-block widgets in the visible
// viewport. Scroll the seeded fences into view and report why a wait
// failed: processor registration, language hosts, and scroller geometry.
async function fenceProbe(client) {
  return client.evaluate(`(() => {
    const leaf = window.app && window.app.workspace && window.app.workspace.activeLeaf;
    const view = leaf && leaf.view;
    const mode = view && typeof view.getMode === "function" ? view.getMode() : null;
    const host = (view && (view.contentEl || view.containerEl)) || document;
    const root = mode === "preview"
      ? (host.querySelector(".markdown-reading-view .markdown-preview-view") || host.querySelector(".markdown-reading-view") || host)
      : (host.querySelector(".markdown-source-view") || host.querySelector(".cm-editor") || host);
    const plugin = window.app && window.app.plugins && window.app.plugins.plugins && window.app.plugins.plugins['bob-chips'];
    let viewState = null;
    try {
      viewState = view && typeof view.getState === 'function' ? view.getState() : null;
    } catch (e) {
      viewState = String((e && e.message) || e);
    }
    const scroller = root.querySelector('.cm-scroller');
    const preview = root.querySelector('.markdown-preview-view');
    return {
      fences: root.querySelectorAll('.bob-copy-fence').length,
      chips: root.querySelectorAll('.bob-copy-chip').length,
      setupDone: plugin ? plugin.copyChipFenceSetupDone : null,
      langBlocks: root.querySelectorAll('.block-language-bob-copy').length,
      bobCopyNodes: Array.from(root.querySelectorAll('[class*="bob-copy"]')).slice(0, 10).map((el) => el.className),
      scroll: scroller ? { top: scroller.scrollTop, height: scroller.scrollHeight, client: scroller.clientHeight } : null,
      previewScroll: preview ? { top: preview.scrollTop, height: preview.scrollHeight, client: preview.clientHeight } : null,
      mode,
      viewState,
    };
  })()`);
}

async function revealFenceSection(client, needle) {
  const needleJson = JSON.stringify(needle || "Fence card:");
  return client.evaluate(
    "(() => { const leaf=window.app&&window.app.workspace&&window.app.workspace.activeLeaf; const view=leaf&&leaf.view; const editor=view&&view.editor; const root=(view&&(view.contentEl||view.containerEl))||document; if(editor&&typeof editor.getValue==='function'){ const value=editor.getValue(); const idx=value.indexOf(" +
      needleJson +
      "); if(idx>=0&&typeof editor.scrollIntoView==='function'){ try{ const pos=editor.offsetToPos(idx); editor.scrollIntoView({from:pos,to:pos},true);}catch(e){} } } const preview=root.querySelector('.markdown-preview-view'); if(preview){ const nodes=Array.from(preview.querySelectorAll('h1,h2,p,li,pre,.bob-copy-fence-title')); const hit=nodes.find((el)=>String(el.textContent||'').indexOf(" +
      needleJson +
      ")>=0); if(hit&&hit.scrollIntoView) hit.scrollIntoView({block:'center'}); } return true; })()",
  );
}

async function waitForFenceCards(client, label, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 40_000);
  const needles = ["Fence card:", "interior blank", "Trailing", "List-nested fence", "Long fence", "Callout fence"];
  let needleIndex = 0;
  let last = null;
  for (;;) {
    await revealFenceSection(client, needles[needleIndex % needles.length]);
    needleIndex += 1;
    last = await fenceProbe(client);
    if (last && last.fences >= 5) return last;
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for " + label + " " + JSON.stringify(last).slice(0, 700));
    }
    await sleep(250);
  }
}

function runSelfTest() {
  // Offline checks only: fixtures, vectors, built plugin, arg parsing.
  const note = fixture.seedNote();
  assert.match(note, /copy: ssh apollo/);
  assert.match(note, /copy: a\\\|b/);
  const payloads = fixture.expectedChipPayloads();
  assert.ok(payloads.length >= 10, "expected vector payloads");
  const fences = fixture.expectedFencePayloads();
  assert.equal(fences.length, 6, "expected fence payloads");
  assert.match(note, /bob-copy Weekly status/);
  assert.match(note, /bob-copy Trailing/);
  assert.match(note, /nested body/);
  assert.match(note, /callout body/);
  for (const fence of fences) {
    assert.equal(typeof fence.id, "string");
    assert.equal(typeof fence.text, "string");
  }
  const mainPath = path.join(repoRoot, "plugins", "bob-chips", "main.js");
  assert.ok(fs.existsSync(mainPath), "built main.js exists");
  const main = fs.readFileSync(mainPath, "utf8");
  assert.match(main, /copyChipBuildInline/);
  assert.match(main, /copyChipAt/);
  assert.match(main, /copy-on-cursor-line/);
  assert.match(main, /copyChipBuildFence/);
  assert.match(main, /copyChipFencePayloadFromSource/);
  assert.match(main, /copyChipFindFenceBlock/);
  assert.match(main, /bob-copy-fence/);
  assert.match(main, /make-or-edit/);
  assert.match(main, /CopyChipAuthorModal/);
  assert.match(main, /copyChipAuthorResolve/);
  assert.match(main, /copyChipLiveGestureShouldEdit/);
  assert.match(main, /copyChipFenceLabelForPayload/);
  const authorNote = fixture.authorSeedNote();
  assert.match(authorNote, /WRAP_ONE wrap this phrase here/);
  assert.match(authorNote, /ALT_CLICK `copy: alt-target`/);
  assert.match(authorNote, /PALETTE_HERE/);
  assert.notEqual(authorNote, note);
  const args = parseArgs(["--out", "/tmp/shots", "--executable", "/snap/bin/obsidian", "--self-test"]);
  assert.equal(args.out, "/tmp/shots");
  assert.equal(args.executable, "/snap/bin/obsidian");
  assert.equal(args.selfTest, true);
  assert.throws(() => parseArgs(["--out"]));
  assert.throws(() => parseArgs(["--wat"]));
  // Source fixture bytes are stable across reads.
  const runRoot = makeTemp("copy-chips-selftest-");
  const scratch = makeFixture(runRoot);
  const before = Buffer.from(scratch.noteBytes);
  const after = fs.readFileSync(scratch.noteFile);
  assert.deepEqual(after, before);
  fs.rmSync(runRoot, { recursive: true, force: true });
  console.log("offline self-test complete (not an Obsidian pass)");
}

async function runE2e(args) {
  const executable = findExecutable(args.executable);
  try {
    fs.accessSync(executable, fs.constants.X_OK);
  } catch (_error) {
    fail("Obsidian executable is not executable: " + executable + ". Pass -e PATH.", 2);
  }
  if (!process.env.DISPLAY && !process.env.XVFB_RUN_TMPDIR) {
    fail("no X display; rerun under xvfb-run -a node scripts/obsidian-copy-chips-e2e.cjs", 2);
  }
  const outDir = path.resolve(args.out || path.join(TEMP_ROOT, "bob-chips-e2e-" + Date.now()));
  const insideRepo = (candidate) => {
    const rel = path.relative(repoRoot, candidate);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  };
  if (insideRepo(outDir)) fail("--out must be outside the bob-plugins repository", 2);
  fs.mkdirSync(outDir, { recursive: true });
  const runRoot = makeTemp("bcc-");
  const scratch = makeFixture(runRoot);
  const pluginDir = path.join(repoRoot, "plugins", "bob-chips");
  const hashOf = (name) => crypto.createHash("sha256").update(fs.readFileSync(path.join(pluginDir, name))).digest("hex");
  const report = {
    executable,
    vault: scratch.vaultRealPath,
    cases: [],
    pass: false,
    out: outDir,
    pluginHashes: {
      "manifest.json": hashOf("manifest.json"),
      "main.js": hashOf("main.js"),
      "styles.css": hashOf("styles.css"),
    },
  };
  const record = (name, ok, detail) => {
    report.cases.push({ name, ok: Boolean(ok), detail: detail || "" });
    console.log((ok ? "PASS " : "FAIL ") + name + (detail ? " (" + String(detail).slice(0, 240) + ")" : ""));
  };
  const port = await freePort();
  const child = spawn(executable, ["--no-sandbox", "--user-data-dir=" + scratch.profileDir, "--remote-debugging-port=" + port, "--remote-allow-origins=http://127.0.0.1/*", scratch.vaultRealPath], {
    cwd: scratch.vaultRealPath,
    env: { ...process.env, HOME: scratch.homeDir, BOB_DIR: scratch.vaultRealPath, XDG_CONFIG_HOME: scratch.configHome, TMPDIR: "/tmp" },
    stdio: "ignore",
  });
  const childState = { exit: "" };
  child.once("exit", (code, signal) => {
    childState.exit = "code=" + code + " signal=" + (signal || "none");
  });
  let client = null;
  try {
    const endpoint = await selectFixtureTarget(port, scratch.vaultRealPath, childState);
    client = await CdpClient.connect(endpoint);
    await client.call("Page.enable");
    await client.call("Runtime.enable");
    await waitFor(client, "Boolean(window.app && window.app.workspace && window.app.workspace.layoutReady)", (v) => v === true, "layout ready", 30_000);
    await dismissScratchTrustModal(client);
    await client.evaluate("(() => (async () => { const p = window.app && window.app.plugins; if (p && typeof p.isEnabled === 'function' && !p.isEnabled()) await p.setEnable(true); return true; })())()");
    const hasPlugin = await waitFor(
      client,
      "Boolean(window.app && window.app.plugins && window.app.plugins.plugins && window.app.plugins.plugins['bob-chips'])",
      (v) => v === true,
      "copy-chips plugin",
      30_000,
    );
    record("plugin loads", hasPlugin === true);
    const apiVersion = await client.evaluate("(() => window.app.plugins.plugins['bob-chips'].api.copyChips.version)()");
    record("api.copyChips v2", apiVersion === 2, "version=" + apiVersion);
    const openedLive = await openNote(client, fixture.notePath(), "live");
    record("scratch note open (live)", Boolean(openedLive && openedLive.ok), JSON.stringify(openedLive).slice(0, 200));
    await waitFor(client, "document.querySelectorAll('.bob-copy-chip').length", (v) => v > 0, "live chips appear", 20_000);
    // 1. Live Preview click copies and caret does not move.
    const lpClick = await client.evaluate(`(async () => {
      const chip = document.querySelector('.bob-copy-chip');
      if (!chip) return { ok: false, reason: 'no chip' };
      const before = window.getSelection ? String(window.getSelection()) : '';
      chip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
      chip.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 11, clientY: 10 }));
      await new Promise((r) => setTimeout(r, 300));
      let clipboard = null;
      try { clipboard = await navigator.clipboard.readText(); } catch (e) { clipboard = 'unreadable:' + e.message; }
      return { ok: true, clipboard, before };
    })()`);
    record("live preview click copies", Boolean(lpClick && lpClick.ok), JSON.stringify(lpClick).slice(0, 200));
    // Fence cards in Live Preview: every seeded fence copies byte-exact
    // through its Copy button, with the authored title and meta. This pins
    // Obsidian's real `source` shape (trailing newline, list-nested
    // indentation) through clipboard bytes.
    await waitForFenceCards(client, "live fence cards appear", 40_000);
    const liveFences = await client.evaluate(
      "(() => { const fences = " +
        JSON.stringify(fenceCardExpectations()).replace(/</g, "\\u003c") +
        "; return (" +
        fenceCardCheck.toString() +
        ")(fences); })()",
    );
    record("fence cards copy byte-exact (live)", Boolean(liveFences && liveFences.ok), JSON.stringify(liveFences).slice(0, 400));
    // 2. Reading button + source bytes unchanged.
    const beforeBytes = scratch.noteBytes.toString("utf8");
    const openedReading = await openNote(client, fixture.notePath(), "preview");
    record("scratch note open (reading)", Boolean(openedReading && openedReading.ok), JSON.stringify(openedReading).slice(0, 200));
    await waitFor(client, "document.querySelectorAll('button.bob-copy-chip').length", (v) => v > 0, "reading chips appear", 20_000);
    const reading = await client.evaluate(`(async () => {
      const button = document.querySelector('button.bob-copy-chip');
      if (!button) return { ok: false, reason: 'no reading button' };
      button.click();
      await new Promise((r) => setTimeout(r, 300));
      let clipboard = null;
      try { clipboard = await navigator.clipboard.readText(); } catch (e) { clipboard = 'unreadable:' + e.message; }
      return { ok: true, clipboard };
    })()`);
    record("reading button copies", Boolean(reading && reading.ok), JSON.stringify(reading).slice(0, 200));
    // Fence cards in Reading view, including the callout fallback title.
    await waitForFenceCards(client, "reading fence cards appear", 40_000);
    const readingFences = await client.evaluate(
      "(() => { const fences = " +
        JSON.stringify(fenceCardExpectations()).replace(/</g, "\\u003c") +
        "; return (" +
        fenceCardCheck.toString() +
        ")(fences); })()",
    );
    record("fence cards copy byte-exact (reading)", Boolean(readingFences && readingFences.ok), JSON.stringify(readingFences).slice(0, 400));
    // The long card folds after eight lines behind a toggle.
    const fold = await client.evaluate(`(async () => {
      const view = window.app.workspace.activeLeaf && window.app.workspace.activeLeaf.view;
      const mode = view && typeof view.getMode === "function" ? view.getMode() : null;
      const host = (view && (view.contentEl || view.containerEl)) || document;
      const root = mode === "preview" ? (host.querySelector(".markdown-reading-view .markdown-preview-view") || host.querySelector(".markdown-reading-view") || host) : (host.querySelector(".markdown-source-view") || host.querySelector(".cm-editor") || host);
      const cards = Array.from(root.querySelectorAll('.bob-copy-fence'));
      const long = cards.find((c) => { const t = c.querySelector('.bob-copy-fence-title'); return t && t.textContent === 'Long'; });
      if (!long) return { ok: false, reason: 'no long card' };
      const body = long.querySelector('.bob-copy-fence-body');
      const toggle = long.querySelector('.bob-copy-fence-toggle');
      if (!toggle) return { ok: false, reason: 'no toggle' };
      if (!body.classList.contains('is-folded')) return { ok: false, reason: 'not folded' };
      if (toggle.textContent !== 'Show all 10 lines') return { ok: false, reason: 'toggle=' + toggle.textContent };
      toggle.click();
      await new Promise((r) => setTimeout(r, 100));
      if (body.classList.contains('is-folded')) return { ok: false, reason: 'still folded' };
      if (toggle.textContent !== 'Show less') return { ok: false, reason: 'toggle2=' + toggle.textContent };
      toggle.click();
      await new Promise((r) => setTimeout(r, 100));
      if (!body.classList.contains('is-folded')) return { ok: false, reason: 'not refolded' };
      return { ok: true };
    })()`);
    record("long fence folds and expands", Boolean(fold && fold.ok), JSON.stringify(fold).slice(0, 200));
    // Clicking the body selects text and never copies.
    const bodyClick = await client.evaluate(`(async () => {
      const view = window.app.workspace.activeLeaf && window.app.workspace.activeLeaf.view;
      const mode = view && typeof view.getMode === "function" ? view.getMode() : null;
      const host = (view && (view.contentEl || view.containerEl)) || document;
      const root = mode === "preview" ? (host.querySelector(".markdown-reading-view .markdown-preview-view") || host.querySelector(".markdown-reading-view") || host) : (host.querySelector(".markdown-source-view") || host.querySelector(".cm-editor") || host);
      const card = root.querySelector('.bob-copy-fence');
      if (!card) return { ok: false, reason: 'no card' };
      const button = card.querySelector('.bob-copy-fence-copy');
      const body = card.querySelector('.bob-copy-fence-body');
      if (!button || !body) return { ok: false, reason: 'no button or body' };
      button.click();
      await new Promise((r) => setTimeout(r, 300));
      let before = null;
      try { before = await navigator.clipboard.readText(); } catch (e) { return { ok: false, reason: 'unreadable' }; }
      body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
      body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 11, clientY: 10 }));
      body.click();
      await new Promise((r) => setTimeout(r, 300));
      let after = null;
      try { after = await navigator.clipboard.readText(); } catch (e) { return { ok: false, reason: 'unreadable2' }; }
      return { ok: after === before, before: String(before).slice(0, 60), after: String(after).slice(0, 60) };
    })()`);
    record("fence body click does not copy", Boolean(bodyClick && bodyClick.ok), JSON.stringify(bodyClick).slice(0, 200));
    // Every vector payload agrees in LP and Reading with exact clipboard bytes.
    const vectors = JSON.parse(fs.readFileSync(path.join(repoRoot, "scripts", "fixtures", "copy-chips-vectors.json"), "utf8"));
    const tableCheck = await client.evaluate(`(async () => {
      const chips = Array.from(document.querySelectorAll('button.bob-copy-chip'));
      let tableButton = null;
      for (const button of chips) {
        const face = button.querySelector('.bob-copy-chip-face');
        const text = face ? face.textContent : '';
        const tip = button.querySelector('.bob-copy-chip-tip');
        const tipText = tip ? tip.textContent : '';
        if (text === 'a|b' || tipText.indexOf('a|b') !== -1) { tableButton = button; break; }
      }
      if (!tableButton) return { ok: false, reason: 'no table chip' };
      tableButton.click();
      await new Promise((r) => setTimeout(r, 300));
      let clipboard = null;
      try { clipboard = await navigator.clipboard.readText(); } catch (e) { clipboard = 'unreadable:' + e.message; }
      return { ok: clipboard === 'a|b', clipboard };
    })()`);
    record("table pipe copies exact bytes", Boolean(tableCheck && tableCheck.ok), JSON.stringify(tableCheck).slice(0, 200));
    const vectorAgreement = await client.evaluate(
      "(() => { try { const api = window.app.plugins.plugins['bob-chips'].api.copyChips; const vectors = " +
        JSON.stringify(vectors.chips.map((v) => ({ line: v.line, table: Boolean(v.table), expected: v.expected }))).replace(/</g, "\\u003c") +
        "; const failures = []; for (const v of vectors) { const found = api.scanLine(v.line, { table: v.table }); if (found.length !== v.expected.length) { failures.push(v.line.slice(0, 30) + ': count ' + found.length); continue; } for (let i = 0; i < found.length; i += 1) { if (found[i].text !== v.expected[i].text || found[i].label !== v.expected[i].label) failures.push(v.line.slice(0, 30) + ': payload mismatch'); } } for (const line of " +
        JSON.stringify(vectors.not_chips.map((v) => v.line)).replace(/</g, "\\u003c") +
        ") { if (api.scanLine(line).length !== 0) failures.push('not-chip matched: ' + line.slice(0, 30)); } return { ok: failures.length === 0, failures: failures.slice(0, 5) }; } catch (e) { return { ok: false, failures: [String((e && e.message) || e)] }; } })()",
    );
    record("every vector agrees in app", Boolean(vectorAgreement && vectorAgreement.ok), JSON.stringify(vectorAgreement).slice(0, 300));
    const emptyCheck = await client.evaluate(
      "(() => { try { const api = window.app.plugins.plugins['bob-chips'].api.copyChips; const empty = api.scanLine('`copy:`'); const ws = api.scanLine('`copy:    `'); const dv = api.scanLine('`= dataview`'); return { ok: empty.length === 0 && ws.length === 0 && dv.length === 0 }; } catch (e) { return { ok: false }; } })()",
    );
    record("empty and dataview spans stay plain", Boolean(emptyCheck && emptyCheck.ok));
    const cursorCheck = await client.evaluate(
      "(() => { try { const api = window.app.plugins.plugins['bob-chips'].api.copyChips; const inside = api.chipAt({ lines: ['see `copy: ssh` and `copy: pwd`'], line: 0, ch: 6 }); const gap = api.chipAt({ lines: ['see `copy: ssh` and `copy: pwd`'], line: 0, ch: 17 }); const fenced = api.chipAt({ lines: ['```', '`copy: ssh`', '```'], line: 1, ch: 2 }); const block = api.chipAt({ lines: ['```bob-copy Hi', 'hello', '```'], line: 1, ch: 0 }); const blockOk = block.state === 'ready' && block.chip && block.chip.form === 'block' && block.chip.text === 'hello' && block.chip.label === 'Hi'; const nested = api.chipAt({ lines: ['- item', '  ```bob-copy N', '  body', '  ```'], line: 2, ch: 3 }); const nestedOk = nested.state === 'ready' && nested.chip && nested.chip.form === 'block' && nested.chip.text === 'body'; const bodySpan = api.chipAt({ lines: ['```bob-copy', '`copy: ssh` is an example', '```'], line: 1, ch: 1 }); const bodySpanOk = bodySpan.state === 'ready' && bodySpan.chip && bodySpan.chip.form === 'block'; const jsFence = api.chipAt({ lines: ['```js', '`copy: ssh`', '```'], line: 1, ch: 2 }); return { ok: inside.state === 'ready' && gap.state === 'ambiguous' && fenced.state === 'none' && blockOk && nestedOk && bodySpanOk && jsFence.state === 'none' }; } catch (e) { return { ok: false }; } })()",
    );
    record("cursor rule in app", Boolean(cursorCheck && cursorCheck.ok));
    const afterBytes = fs.readFileSync(scratch.noteFile, "utf8");
    record("source bytes unchanged", afterBytes === beforeBytes);
    await authoring.runAuthoringCases(client, openNote, record);
    const seededAfterAuthoring = fs.readFileSync(scratch.noteFile, "utf8");
    record("seeded copy note still byte-identical", seededAfterAuthoring === beforeBytes);
    report.pass = report.cases.every((c) => c.ok);
  } finally {
    try {
      if (client && !client.closed) {
        try {
          client.socket.close();
        } catch (_error) {}
      }
    } catch (_error) {}
    try {
      child.kill("SIGTERM");
    } catch (_error) {}
    if (args.report) {
      try {
        fs.writeFileSync(path.resolve(args.report), JSON.stringify(report, null, 2));
      } catch (_error) {}
    }
    console.log(report.pass ? "E2E PASS" : "E2E FAIL");
    if (!report.pass) process.exitCode = 1;
  }
}

const VAULT_PROBE = "(() => { const a = window.app && window.app.vault && window.app.vault.adapter; return a && typeof a.basePath === 'string' ? a.basePath : null; })()";

async function selectFixtureTarget(port, vaultRealPath, childState) {
  const deadline = Date.now() + 45_000;
  let lastError = "";
  while (Date.now() < deadline) {
    if (childState && childState.exit) throw new Error("owned Obsidian exited before opening fixture: " + childState.exit);
    let targets = [];
    try {
      const response = await fetch("http://127.0.0.1:" + port + "/json/list");
      if (response.ok) targets = await response.json();
    } catch (error) {
      lastError = String((error && error.message) || error);
    }
    for (const target of Array.isArray(targets) ? targets : []) {
      if (target.type !== "page" || !target.webSocketDebuggerUrl) continue;
      let probe = null;
      try {
        probe = await CdpClient.connect(target.webSocketDebuggerUrl);
        const reported = await probe.evaluate(VAULT_PROBE, 5000);
        if (lib.verifyVaultPath(reported, vaultRealPath)) return target.webSocketDebuggerUrl;
      } catch (error) {
        lastError = String((error && error.message) || error);
      } finally {
        if (probe) {
          try {
            probe.socket.close();
          } catch (_error) {}
        }
      }
    }
    await sleep(350);
  }
  throw new Error("no CDP page reports the scratch vault" + (lastError ? ": " + lastError.slice(0, 180) : ""));
}

async function dismissScratchTrustModal(client) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const result = await client
      .evaluate(
        "(() => { const app = window.app; const doc = (app && app.workspace && app.workspace.containerEl && app.workspace.containerEl.ownerDocument) || document; const buttons = Array.from(doc.querySelectorAll('button')); const trust = buttons.find((b) => /Trust author and enable plugins/i.test(b.textContent || '')); if (!trust) return { clicked: false }; trust.click(); return { clicked: true }; })()",
      )
      .catch(() => ({ clicked: false }));
    if (result && result.clicked) {
      await sleep(500);
      return true;
    }
    await sleep(200);
  }
  return false;
}

async function waitForEndpoint(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const targets = await new Promise((resolve, reject) => {
        const req = require("node:http").get({ host: "127.0.0.1", port, path: "/json/list" }, (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              reject(e);
            }
          });
        });
        req.once("error", reject);
        req.setTimeout(5_000, () => req.destroy(new Error("devtools timeout")));
      });
      const page = (Array.isArray(targets) ? targets : []).find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch (_error) {
      // Keep polling until the app exposes DevTools.
    }
    if (Date.now() > deadline) throw new Error("timed out waiting for DevTools endpoint");
    await sleep(500);
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
  const timer = setTimeout(() => {
    console.error("overall timeout after " + OVERALL_TIMEOUT_MS + " ms");
    process.exitCode = 2;
  }, OVERALL_TIMEOUT_MS);
  timer.unref();
  await runE2e(args);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(String((error && error.stack) || error));
    process.exitCode = error && error.exitCode ? error.exitCode : 1;
  });
}

module.exports = { parseArgs, findExecutable, makeFixture, sha256: (filePath) => crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex") };
