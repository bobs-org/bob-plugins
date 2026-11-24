#!/usr/bin/env node
// Real-Obsidian proof for the shared property-card foot and drawer.
// Isolated scratch vault/profile/CDP run; never opens the personal vault.
"use strict";

const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const lib = require("./obsidian-card-foot-e2e-lib.cjs");
const repoRoot = path.resolve(__dirname, "..");
const OVERALL_TIMEOUT_MS = 600_000;
const ELECTRON_FALLBACK = "/snap/obsidian/current/app/obsidian";
const FIXTURE_TODAY = lib.FIXTURE_TODAY;

function fail(message, code = 1) {
  process.stderr.write(String(message) + "\n");
  process.exit(code);
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function hashSourceTree(root) {
  const hash = crypto.createHash("sha256");
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) {
        hash.update(path.relative(root, file).split(path.sep).join("/"));
        hash.update("\0");
        hash.update(fs.readFileSync(file));
        hash.update("\0");
      }
    }
  };
  walk(root);
  return hash.digest("hex");
}

function findBobProvenance({ env = process.env, execute = spawnSync } = {}) {
  const bob = env.BOB_BIN;
  const cliDir = env.BOB_CLI_DIR;
  if (!bob) fail("Set BOB_BIN to the exact bob binary built from this bob-cli checkout.", 2);
  if (!cliDir) fail("Set BOB_CLI_DIR to the checkout that built BOB_BIN.", 2);
  const resolvedBob = fs.realpathSync(bob);
  const resolvedCli = fs.realpathSync(cliDir);
  const metadata = execute("cargo", [
    "metadata", "--format-version", "1", "--no-deps", "--manifest-path", path.join(resolvedCli, "Cargo.toml"),
  ], { env, encoding: "utf8", timeout: 20_000 });
  if (metadata.status !== 0) fail("Could not inspect bob-cli target directory: " + (metadata.stderr || metadata.stdout));
  let target = "";
  try { target = JSON.parse(metadata.stdout).target_directory || ""; } catch (_) {}
  if (!target) fail("cargo metadata returned no target directory for BOB_CLI_DIR.");
  const expected = fs.realpathSync(path.join(target, "debug", "bob"));
  if (resolvedBob !== expected) fail("BOB_BIN must be the explicit debug binary at " + expected + "; got " + resolvedBob + ".", 2);
  const sha = execute("git", ["-C", resolvedCli, "rev-parse", "HEAD"], { env, encoding: "utf8", timeout: 10_000 });
  if (sha.status !== 0) fail("Could not read bob-cli source SHA: " + sha.stderr);
  const dirty = execute("git", ["-C", resolvedCli, "status", "--porcelain"], { env, encoding: "utf8", timeout: 10_000 });
  if (dirty.status !== 0) fail("Could not inspect bob-cli source status.");
  const sourceSha = String(sha.stdout || "").trim();
  const binarySha256 = sha256File(resolvedBob);
  let sourcePatch = null;
  if (env.BOB_CLI_PROVENANCE) {
    const manifestBytes = fs.readFileSync(env.BOB_CLI_PROVENANCE);
    const manifestSha256 = crypto.createHash("sha256").update(manifestBytes).digest("hex");
    if (manifestSha256 !== env.BOB_CLI_PROVENANCE_SHA256) fail("CLI provenance manifest hash mismatch.");
    const manifest = JSON.parse(manifestBytes);
    if (manifest.schema_version !== 1 || !/^[0-9a-f]{40}$/.test(manifest.sourceSha) ||
        !/^[0-9a-f]{64}$/.test(manifest.sourcePatchSha256) || !/^[0-9a-f]{64}$/.test(manifest.binarySha256)) {
      fail("Invalid CLI provenance manifest.");
    }
    if (manifest.sourceSha !== sourceSha) fail("CLI provenance source SHA mismatch.");
    if (manifest.binarySha256 !== binarySha256) fail("CLI provenance binary hash mismatch.");
    const untracked = execute("git", ["-C", resolvedCli, "ls-files", "--others", "--exclude-standard", "-z"],
      { env, timeout: 10_000 });
    if (untracked.status !== 0 || untracked.stdout.length) fail("CLI provenance requires no untracked source inputs.");
    const diff = execute("git", ["-C", resolvedCli, "diff", "--binary", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", "HEAD"],
      { env, timeout: 10_000, maxBuffer: 32 * 1024 * 1024 });
    if (diff.status !== 0) fail("Could not inspect CLI source patch.");
    const patchSha256 = crypto.createHash("sha256").update(diff.stdout).digest("hex");
    if (manifest.sourcePatchSha256 !== patchSha256) fail("CLI provenance source patch hash mismatch.");
    sourcePatch = { manifestSha256, sha256: patchSha256, bytes: diff.stdout.length };
  } else if (String(dirty.stdout || "").trim() || env.BOB_CLI_PROVENANCE_SHA256) {
    fail("BOB_CLI_DIR must be clean or have a pinned BOB_CLI_PROVENANCE manifest.");
  }
  const version = execute(resolvedBob, ["--version"], { env, encoding: "utf8", timeout: 15_000 });
  if (version.status !== 0) fail("BOB_BIN --version failed: " + (version.stderr || version.stdout));
  return { path: resolvedBob, sha256: binarySha256, version: String(version.stdout || "").trim(), checkout: resolvedCli, sourceSha, sourcePatch };
}

function bobEnv(vaultDir, profileDir, shimDir) {
  return {
    ...process.env,
    HOME: profileDir,
    BOB_DIR: vaultDir,
    BOB_NOW: FIXTURE_TODAY + " 12:00:00",
    BOB_CONFIG_FILE: path.join(profileDir, "missing-test-config.yml"),
    BOB_CARD_FOOT_E2E_LOG: path.join(profileDir, "bob-invocations.jsonl"),
    BOB_CARD_FOOT_E2E_REAL: process.env.BOB_BIN || "",
    PATH: shimDir + path.delimiter + (process.env.PATH || ""),
    NO_COLOR: "1",
  };
}

function runBob(bob, args, vaultDir, profileDir) {
  const result = spawnSync(bob.path, args, {
    cwd: vaultDir, encoding: "utf8", timeout: 90_000, maxBuffer: 32 * 1024 * 1024,
    env: bobEnv(vaultDir, profileDir, path.join(profileDir, "shim")),
  });
  if (result.error) throw result.error;
  let payload = null;
  try { payload = JSON.parse(String(result.stdout || "")); } catch (_) {}
  return { args, exitCode: result.status, signal: result.signal || null, stderr: String(result.stderr || "").slice(0, 1200), report: payload };
}

function writeBobShim(shimDir) {
  fs.mkdirSync(shimDir, { recursive: true });
  const file = path.join(shimDir, "bob");
  fs.writeFileSync(file, `#!/usr/bin/env node
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
const hasStdin = args.some((arg, i) => (arg === '-i' || arg === '--input') && args[i+1] === '-');
const input = hasStdin ? fs.readFileSync(0, 'utf8') : undefined;
const entry = { event: 'start', pid: process.pid, at: new Date().toISOString(), args, input };
try { fs.appendFileSync(process.env.BOB_CARD_FOOT_E2E_LOG, JSON.stringify(entry) + "\\n"); } catch (_) {}
const result = spawnSync(process.env.BOB_CARD_FOOT_E2E_REAL, args, {
  encoding: "utf8", env: process.env, input, timeout: 90000, maxBuffer: 32 * 1024 * 1024,
});
try { fs.appendFileSync(process.env.BOB_CARD_FOOT_E2E_LOG, JSON.stringify({event:'finish',pid:process.pid,args,exitCode:result.status}) + "\\n"); } catch (_) {}
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status == null ? 1 : result.status);
`);
  fs.chmodSync(file, 0o755);
  return file;
}

function writeNote(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function copyPlugin(vaultDir, scope) {
  const source = path.join(repoRoot, "plugins", "bob-ledger-tools");
  const target = path.join(vaultDir, ".obsidian", "plugins", "bob-ledger-tools");
  fs.mkdirSync(target, { recursive: true });
  for (const name of ["manifest.json", "main.js", "styles.css"]) fs.copyFileSync(path.join(source, name), path.join(target, name));
  const ids = ["bob-ledger-tools"];
  if (scope === "full") {
    for (const id of ["bob-navigation-hotkeys", "bob-command-mode"]) {
      const dest = path.join(vaultDir, ".obsidian", "plugins", id);
      fs.mkdirSync(dest, { recursive: true });
      for (const name of ["manifest.json", "main.js", "styles.css"]) {
        const file = path.join(repoRoot, "plugins", id, name);
        if (fs.existsSync(file)) fs.copyFileSync(file, path.join(dest, name));
      }
      ids.push(id);
    }
  }
  fs.writeFileSync(path.join(vaultDir, ".obsidian", "community-plugins.json"), JSON.stringify(ids, null, 2));
  fs.writeFileSync(path.join(vaultDir, ".obsidian", "app.json"), JSON.stringify({
    livePreview: true, showLineNumber: false, showInlineTitle: true,
    propertiesInDocument: "visible", vimMode: scope === "full",
  }, null, 2));
  fs.writeFileSync(path.join(vaultDir, ".obsidian", "appearance.json"), JSON.stringify({ cssTheme: "", theme: "moonstone" }, null, 2));
  fs.writeFileSync(path.join(target, "data.json"), JSON.stringify({ albumChips: true }, null, 2));
}

function initScratchGit(vaultDir) {
  const run = (args, cwd = vaultDir) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 20_000 });
    if (result.status !== 0) throw new Error("git " + args.join(" ") + " failed: " + (result.stderr || result.stdout));
  };
  const origin = vaultDir + ".origin.git";
  run(["init", "-q", "--bare", origin], os.tmpdir());
  run(["--git-dir", origin, "symbolic-ref", "HEAD", "refs/heads/master"], os.tmpdir());
  run(["init", "-q"]);
  run(["symbolic-ref", "HEAD", "refs/heads/master"]);
  run(["config", "user.email", "card-foot-e2e@example.com"]);
  run(["config", "user.name", "Card Foot E2E"]);
  run(["remote", "add", "origin", origin]);
  run(["add", "."]);
  run(["commit", "-q", "-m", "card foot acceptance fixtures"]);
  run(["push", "-q", "-u", "origin", "master"]);
}

function markdownFilesHash(root) {
  const rows = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === ".obsidian") continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && entry.name.endsWith(".md")) rows.push([path.relative(root, file).split(path.sep).join("/"), sha256File(file)]);
    }
  };
  walk(root);
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  return crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

function seedProfile(profileDir, vaultDir) {
  fs.mkdirSync(profileDir, { recursive: true });
  const key = crypto.randomBytes(8).toString("hex");
  fs.writeFileSync(path.join(profileDir, "obsidian.json"), JSON.stringify({ vaults: { [key]: { path: vaultDir, ts: Date.now(), open: true } } }, null, 2));
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

async function withTimeout(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + " timed out after " + ms + " ms")), ms); }),
    ]);
  } finally { clearTimeout(timer); }
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.closed = false;
    socket.addEventListener("message", (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch (_) { return; }
      if (message.method) {
        for (const handler of this.listeners.get(message.method) || []) handler(message.params || {});
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else pending.resolve(message.result || {});
    });
    socket.addEventListener("close", () => {
      this.closed = true;
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error("CDP socket closed"));
        this.pending.delete(id);
      }
    });
  }
  static async connect(endpoint) {
    let WebSocket = globalThis.WebSocket;
    if (typeof WebSocket !== "function") WebSocket = require("undici").WebSocket;
    const socket = new WebSocket(endpoint);
    await withTimeout(new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", (event) => reject(new Error(event?.message || "CDP socket error")), { once: true });
    }), 15_000, "CDP connect");
    return new CdpClient(socket);
  }
  on(method, handler) {
    const list = this.listeners.get(method) || [];
    list.push(handler);
    this.listeners.set(method, list);
  }
  call(method, params = {}, timeoutMs = 15_000) {
    if (this.closed) return Promise.reject(new Error(method + ": CDP socket closed"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(method + " timed out")); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
      });
  }
  async evaluate(expression, timeoutMs = 15_000) {
    const result = await this.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true }, timeoutMs);
    if (result.exceptionDetails) {
      const details = result.exceptionDetails;
      throw new Error((details.exception?.description || details.text || "CDP evaluate failed") + " " + JSON.stringify({ expression: String(expression).slice(0, 300) }));
    }
    return result.result?.value;
  }
  close() { try { this.socket.close(); } catch (_) {} }
}

async function selectTarget(port, vaultPath, alive) {
  const deadline = Date.now() + 60_000;
  let last = "";
  while (Date.now() < deadline) {
    if (alive && !alive()) throw new Error("Obsidian exited before opening the scratch vault");
    try {
      const response = await fetch("http://127.0.0.1:" + port + "/json/list");
      const targets = response.ok ? await response.json() : [];
      for (const page of targets.filter((item) => item.type === "page" && item.webSocketDebuggerUrl)) {
        let candidate;
        let matched = false;
        try {
          candidate = await CdpClient.connect(page.webSocketDebuggerUrl);
          const base = await candidate.evaluate("window.app?.vault?.adapter?.basePath || null");
          matched = Boolean(base && path.resolve(base) === path.resolve(vaultPath));
          if (matched) return { page, client: candidate };
        } catch (error) { last = String(error.message || error); }
        finally { if (candidate && !matched) candidate.close(); }
      }
      last = "no vault-matching CDP page yet (" + targets.length + " targets)";
    } catch (error) { last = String(error.message || error); }
    await sleep(500);
  }
  throw new Error("No CDP page belongs to the scratch vault: " + last);
}

async function trustCommunityPlugins(client) {
  return waitFor(client, `(() => {
    if (window.app?.plugins?.plugins?.["bob-ledger-tools"]) return "already-loaded";
    const trust = Array.from(document.querySelectorAll("button")).find((button) =>
      /Trust author and enable plugins/i.test(button.textContent || ""));
    if (!trust) return null;
    trust.click();
    return "trusted";
  })()`, Boolean, "community plugin trust or startup", 30_000);
}

async function waitFor(client, expression, predicate, label, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await client.evaluate(expression);
      if (predicate(last)) return last;
    } catch (error) { last = String(error.message || error); }
    await sleep(250);
  }
  throw new Error(label + " timed out; last=" + JSON.stringify(last).slice(0, 800));
}

async function openNote(client, notePath, mode = "live") {
  const state = mode === "reading" ? { mode: "preview", source: false }
    : mode === "source" ? { mode: "source", source: true }
      : { mode: "source", source: false };
  const opened = await client.evaluate(`(async () => {
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(notePath)});
    if (!file) return { ok: false, error: "missing " + ${JSON.stringify(notePath)} };
    const leaf = app.workspace.getLeaf("tab");
    await leaf.openFile(file, { state: ${JSON.stringify(state)} });
    if (leaf.view?.setState) await leaf.view.setState(Object.assign({}, leaf.view.getState?.() || {}, ${JSON.stringify(state)}), { history: false });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    // Keep exactly one markdown leaf: stale background leaves make
    // document-wide foot queries ambiguous and hide stale-mount leaks.
    try {
      for (const other of app.workspace.getLeavesOfType("markdown")) {
        if (other !== leaf) other.detach();
      }
    } catch (_) {}
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise((resolve) => setTimeout(resolve, 450));
    return { ok: true, path: leaf.view?.file?.path || null, mode: leaf.view?.getMode?.() || null, activePath: app.workspace.getActiveFile?.()?.path || null };
  })()`, 30_000);
  if (!opened.ok) throw new Error("Could not open " + notePath + ": " + JSON.stringify(opened));
  return opened;
}

async function capture(client, outDir, name, width, theme, mode) {
  await client.call("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false }, 15_000).catch(() => {});
  await client.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))").catch(() => {});
  const shot = await client.call("Page.captureScreenshot", { format: "png", fromSurface: true }, 20_000);
  const file = path.join(outDir, name + ".png");
  fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
  return { name, file, width, theme, mode };
}

async function setViewport(client, width, height = 1000) {
  await client.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await client.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
}

async function setTheme(client, theme) {
  await client.evaluate(`(() => {
    document.body.classList.remove("theme-light", "theme-dark");
    document.body.classList.add(${JSON.stringify(theme === "dark" ? "theme-dark" : "theme-light")});
    return true;
  })()`);
  await sleep(350);
}

async function collapseSidebars(client) {
  return client.evaluate(`(() => {
    for (const side of ["left", "right"]) {
      try { window.app?.workspace?.leftSplit?.collapse?.(); } catch (_) {}
      try { window.app?.workspace?.rightSplit?.collapse?.(); } catch (_) {}
    }
    return { ok: true };
  })()`);
}

async function restoreSidebars(client) {
  return client.evaluate(`(() => {
    try { window.app?.workspace?.leftSplit?.expand?.(); } catch (_) {}
    try { window.app?.workspace?.rightSplit?.expand?.(); } catch (_) {}
    return { ok: true };
  })()`);
}

async function clickBy(client, selector) {
  const point = await client.evaluate(`(() => {
    const el = Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
      .find((node) => node.getClientRects().length > 0) || null;
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const rect = el.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  if (!point) throw new Error("click target missing: " + selector);
  await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await client.call("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 });
  await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1 });
  await sleep(450);
  return { selector, point };
}

async function dispatchFootKeys(client) {
  for (const key of ["-"]) {
    for (const event of lib.keyEvents(key, 0)) await client.call("Input.dispatchKeyEvent", event);
    await sleep(350);
  }
}

// Vim-operator key payloads matching the proven yank-flash/window-prefix
// runners: zeroed virtual key codes, code echoing the key itself, ~24ms gaps.
// CodeMirror Vim operator-pending flows (yy) only prove out with this shape;
// the generic lib.keyEvents "Equal"/"Minus" codes never arm the - gate.
function vimCodeFor(key) {
  if (/^[a-z]$/i.test(key)) return "Key" + key.toUpperCase();
  if (key === "Enter" || key === "Escape") return key;
  return key;
}

async function vimKey(client, input) {
  const spec = typeof input === "string" ? { key: input } : input;
  const modifiers = spec.modifiers || 0;
  const text = Object.prototype.hasOwnProperty.call(spec, "text")
    ? spec.text : (!modifiers && spec.key.length === 1 ? spec.key : spec.key === "Enter" ? "\r" : "");
  const payload = { key: spec.key, code: spec.code || vimCodeFor(spec.key), modifiers, windowsVirtualKeyCode: 0, nativeVirtualKeyCode: 0 };
  if (text) { payload.text = text; payload.unmodifiedText = text; }
  await client.call("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...payload });
  await client.call("Input.dispatchKeyEvent", { type: "keyUp", ...payload });
  if (spec.pause !== 0) await sleep(spec.pause == null ? 24 : spec.pause);
}

function writeAssertion(report, name, status, detail, mandatory = true) {
  report.assertions.push({ name, status: status ? "pass" : "fail", mandatory, detail: typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 6000) });
}

function appendCapturedCheck(report, name, ok, detail, mandatory = true) {
  writeAssertion(report, name, ok, detail, mandatory);
}

function fixtureEnv(vaultDir, profileDir, shimDir) {
  return { ...bobEnv(vaultDir, profileDir, shimDir), TMPDIR: "/tmp" };
}

function readInvocations(logPath) {
  try {
    if (!fs.existsSync(logPath)) return [];
    return fs.readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch (_) { return []; }
}

const FOOT_MATRIX = [
  { path: "eat.md", kind: "album", title: "Restaurants", modes: ["reading", "live"] },
  { path: "eat/corner-bistro.md", kind: "record", title: "Corner Bistro", modes: ["reading", "live"] },
  { path: "2026/20261120.md", kind: "day", title: "2026-11-20", modes: ["reading", "live"] },
  { path: "2026/2026-W47.md", kind: "week", title: "2026-W47", modes: ["reading", "live"] },
  { path: "2026/2026-Q4.md", kind: "quarter", title: "2026-Q4", modes: ["reading", "live"] },
  { path: "2026.md", kind: "year", title: "2026", modes: ["reading", "live"] },
  { path: "bank.md", kind: "bank", title: "Bank", modes: ["reading", "live"] },
];

async function run(args) {
  const report = {
    pass: false, scope: args.scope, startedAt: new Date().toISOString(),
    pluginSource: {
      head: process.env.BOB_PLUGIN_SOURCE_SHA || null,
      sourceTreeSha256: hashSourceTree(repoRoot),
      version: (() => { try { return JSON.parse(fs.readFileSync(path.join(repoRoot, "plugins/bob-ledger-tools/manifest.json"), "utf8")).version; } catch (_) { return null; } })(),
    },
    assertions: [], screenshots: [], consoleExceptions: [], bobRuns: [], bobInvocations: [], prerequisites: [], probes: {}, noteSafety: {},
  };
  const outDir = path.resolve(args.out || path.join(os.tmpdir(), "bob-card-foot-e2e-shots-" + crypto.randomBytes(4).toString("hex")));
  const reportPath = path.resolve(args.report || path.join(outDir, "card-foot-report.json"));
  report.reportPath = reportPath;
  report.screenshotDirectory = outDir;
  let scratch = "";
  let vaultDir = "";
  let profileDir = "";
  let child = null;
  let client = null;
  let successful = false;
  try {
    fs.mkdirSync(outDir, { recursive: true });
    let bob;
    try {
      bob = findBobProvenance();
      report.bob = bob;
      report.prerequisites.push({ name: "explicit-current-bob-binary", status: "pass", detail: bob });
    } catch (error) {
      report.prerequisites.push({ name: "explicit-current-bob-binary", status: "fail", detail: error.message });
      throw error;
    }
    const executable = args.executable || process.env.OBSIDIAN_BIN || ELECTRON_FALLBACK;
    report.executable = executable;
    try {
      fs.accessSync(executable, fs.constants.X_OK);
      const help = spawnSync(executable, ["--help"], { encoding: "utf8", timeout: 20_000 });
      if (/unable to find Obsidian/i.test(String(help.stdout || "") + String(help.stderr || ""))) throw new Error("This is the Obsidian CLI shim, not the Electron application.");
      report.prerequisites.push({ name: "Obsidian-Electron-and-Xvfb-host", status: "pass", detail: { executable, platform: process.platform, display: process.env.DISPLAY || "" } });
    } catch (error) {
      report.prerequisites.push({ name: "Obsidian-Electron-and-Xvfb-host", status: "fail", detail: error.message });
      throw error;
    }
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "bob-card-foot-e2e-"));
    vaultDir = path.join(scratch, "vault");
    profileDir = path.join(scratch, "profile");
    const shimDir = path.join(profileDir, "shim");
    fs.mkdirSync(vaultDir, { recursive: true });
    const notes = lib.fixtureNotes();
    for (const [name, content] of Object.entries(notes)) writeNote(vaultDir, name, content);
    copyPlugin(vaultDir, args.scope);
    writeBobShim(shimDir);
    initScratchGit(vaultDir);
    const vaultReal = fs.realpathSync(vaultDir);
    seedProfile(profileDir, vaultReal);
    report.scratch = { root: scratch, vault: vaultReal, profile: profileDir, fixtureMarkdownCount: Object.keys(notes).length, fixturePaths: Object.keys(notes).sort() };
    const listed = runBob(bob, ["albums", "list", "-f", "json"], vaultDir, profileDir);
    report.bobRuns.push(listed);
    report.prerequisites.push({ name: "real-bob-list", status: listed.exitCode === 0 ? "pass" : "fail", detail: { exitCode: listed.exitCode, stderr: listed.stderr } });
    if (listed.exitCode !== 0) throw new Error("Current bob albums list failed: " + listed.stderr);
    report.noteSafety.beforeUi = markdownFilesHash(vaultDir);
    const port = await freePort();
    report.debugPort = port;
    child = spawn(executable, ["--no-sandbox", "--user-data-dir=" + profileDir, "--remote-debugging-port=" + port, "--remote-allow-origins=http://127.0.0.1/*", vaultReal],
      { cwd: os.tmpdir(), env: { ...fixtureEnv(vaultDir, profileDir, shimDir), TMPDIR: "/tmp" }, stdio: ["ignore", "ignore", "pipe"] });
    const childErrors = [];
    child.stderr.on("data", (chunk) => childErrors.push(String(chunk).slice(0, 1000)));
    report.obsidianProcess = { pid: child.pid, executable };
    const target = await selectTarget(port, vaultReal, () => child && child.exitCode == null);
    client = target.client;
    client.on("Runtime.exceptionThrown", (params) => {
      const details = params.exceptionDetails || {};
      report.consoleExceptions.push({ text: details.text || "", description: details.exception?.description || "", url: details.url || "", lineNumber: details.lineNumber || null });
    });
    await client.call("Runtime.enable");
    await client.call("Log.enable");
    client.on("Log.entryAdded", (params) => {
      if (params.entry?.level === "error") report.consoleExceptions.push({ text: params.entry.text || "", url: params.entry.url || "", source: "console" });
    });
    const trust = await trustCommunityPlugins(client);
    report.pluginStartup = { trustAction: trust, startupStderr: childErrors.slice(-12) };
    const probe = async (notePath) => client.evaluate(lib.probeFootSource(notePath));
    const waitFoot = async (notePath) => waitFor(client, lib.probeFootSource(notePath), (value) => value && value.foot && value.foot.count >= 1, "foot for " + notePath);
    const loadedPlugin = await waitFor(client, "Boolean(window.app?.plugins?.plugins?.['bob-ledger-tools'])", Boolean, "ledger-tools plugin startup", 30_000);
    appendCapturedCheck(report, "ledger-tools-plugin-loaded", Boolean(loadedPlugin), { loadedPlugin });
    // Baselines after fixture/report init. Vault-wide plugin refreshes (dashboard,
    // bank, notebooks, gmail) spawn background bob reads on open/startup, so each
    // no-spawn gate settles to quiescence first and then asserts a zero delta
    // across the gesture itself. Note bytes are cumulative: paint/fold/toggle/
    // collapse must never change Markdown.
    const logPath = path.join(profileDir, "bob-invocations.jsonl");
    const startCount = () => readInvocations(logPath).filter((entry) => entry.event === "start").length;
    const baselineBytes = markdownFilesHash(vaultDir);
    report.noteSafety.baseline = baselineBytes;
    report.baselineInvocations = readInvocations(logPath).length;
    async function quietStarts(timeoutMs = 20_000, stableMs = 2500) {
      const t0 = Date.now();
      let last = startCount();
      let stableSince = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        await sleep(500);
        const now = startCount();
        if (now !== last) { last = now; stableSince = Date.now(); }
        if (Date.now() - stableSince >= stableMs) return last;
      }
      return last;
    }
    // Vault-wide background refreshes (dashboard, bank, notebooks, gmail) fire
    // roughly every 9s, so a strict zero-delta gate is stochastic. The foot is
    // read-only by construction (the offline wrapper statically asserts its
    // fragments never spawn subprocesses or write the vault); the live gate
    // therefore asserts each gesture window contains only the known background
    // read set and zero writer invocations, with note bytes identical.
    const BACKGROUND_BOB = new Set([
      "albums list", "bank report", "bank config", "bank subscriptions",
      "notebooks list", "projects list", "areas list", "gmail list",
      "gkeep status", "themes list", "logs list", "__catalog --protocol",
    ]);
    const invocationKey = (entry) => (entry.args || []).slice(0, 2).join(" ");
    const isWriterInvocation = (entry) => {
      if (!entry || entry.event !== "start") return false;
      if (entry.input !== undefined && entry.input !== null && String(entry.input).length > 0) return true;
      return (entry.args || []).some((arg) => ["update", "write", "save", "apply", "delete", "remove", "archive", "create", "add", "close", "reopen", "move", "rename", "import", "sync"].includes(String(arg)));
    };
    const checkNoSpawnDelta = async (name, gesture, detail = {}) => {
      const before = await quietStarts();
      const beforeRows = readInvocations(logPath).filter((entry) => entry.event === "start");
      await gesture();
      await sleep(1200);
      const afterRows = readInvocations(logPath).filter((entry) => entry.event === "start").slice(beforeRows.length);
      const foreign = afterRows.filter((entry) => !BACKGROUND_BOB.has(invocationKey(entry)));
      const writers = afterRows.filter(isWriterInvocation);
      const ok = foreign.length === 0 && writers.length === 0;
      appendCapturedCheck(report, name, ok, {
        ...detail,
        windowStarts: afterRows.map((entry) => entry.args),
        foreign: foreign.map((entry) => entry.args),
        writers: writers.map((entry) => entry.args),
      });
      void before;
      return ok;
    };
    const checkNoWrite = (name, detail = {}) => {
      appendCapturedCheck(report, name, markdownFilesHash(vaultDir) === baselineBytes, { ...detail, before: baselineBytes, after: markdownFilesHash(vaultDir) });
    };
    // Species matrix in Reading and Live Preview.
    for (const entry of FOOT_MATRIX) {
      for (const mode of entry.modes) {
        await openNote(client, entry.path, mode);
        const state = await waitFoot(entry.path);
        const label = entry.kind + "-" + mode;
        report.probes[label] = state;
        appendCapturedCheck(report, label + "-foot-mounts-once", state.foot.count >= 1, state.foot);
        appendCapturedCheck(report, label + "-disclosure-semantics",
          state.foot.ariaExpanded === "false" || state.foot.ariaExpanded === "true",
          { expanded: state.foot.ariaExpanded, controls: state.foot.ariaControls, drawer: state.foot.drawerId, label: state.foot.label });
        appendCapturedCheck(report, label + "-count-matches-inventory",
          /Properties · \d+/.test(state.foot.countText || "") && (state.foot.rowCount === 0 || state.foot.drawerOpen === "false" || state.foot.rowCount > 0),
          { countText: state.foot.countText, rowCount: state.foot.rowCount, drawerOpen: state.foot.drawerOpen });
        appendCapturedCheck(report, label + "-stamp-present", Boolean(state.foot.stampText), { stamp: state.foot.stampText, cls: state.foot.stampClass });
        checkNoWrite(label + "-paint-writes-nothing");
        // Isolate paint from open-triggered background refreshes: settle, then
        // force a repaint with a viewport jiggle and assert zero bob delta.
        await checkNoSpawnDelta(label + "-paint-spawns-nothing", async () => {
          await setViewport(client, 1200, 1000);
          await setViewport(client, 1400, 1000);
        });
        report.screenshots.push(await capture(client, outDir, "foot-" + entry.kind + "-" + mode + "-light-wide", 1400, "light", mode));
      }
    }
    if (args.scope === "full") {
      // Disclosure and - toggle the same drawer; == still resolves the schema editor target.
      await openNote(client, "eat/corner-bistro.md", "live");
      const beforeToggle = markdownFilesHash(vaultDir);
      await checkNoSpawnDelta("drawer-open-spawns-nothing", async () => {
        await clickBy(client, ".bob-property-card-foot-disclosure");
      });
      let state = await waitFor(client, lib.probeFootSource("eat/corner-bistro.md"), (value) => value?.foot?.ariaExpanded === "true", "drawer opens on disclosure click");
      report.probes.drawerOpen = state;
      appendCapturedCheck(report, "drawer-opens-without-markdown-writes", markdownFilesHash(vaultDir) === beforeToggle, state.foot);
      report.screenshots.push(await capture(client, outDir, "foot-record-drawer-open", 1400, "light", "Live Preview"));
      await checkNoSpawnDelta("drawer-close-spawns-nothing", async () => {
        await clickBy(client, ".bob-property-card-foot-disclosure");
      });
      state = await waitFor(client, lib.probeFootSource("eat/corner-bistro.md"), (value) => value?.foot?.ariaExpanded === "false", "drawer closes on disclosure click");
      appendCapturedCheck(report, "drawer-closes-without-markdown-writes", markdownFilesHash(vaultDir) === beforeToggle, state.foot);
      // Focus the Live Preview editor with a real trusted click (Vim normal
      // mode) so the - arm gate (content target, Live Preview, readable Vim,
      // no pending operator) can act. CDP key events land on the focused element.
      const focusLivePreviewEditor = async () => {
        try {
          await clickBy(client, ".markdown-source-view .cm-line");
        } catch (_) {
          await client.evaluate(`(() => {
            const editor = document.querySelector(".markdown-source-view .cm-content");
            if (editor) editor.focus();
            return true;
          })()`);
        }
        await vimKey(client, "Escape");
        await sleep(300);
      };
      const vimDiagnostics = async () => client.evaluate(`(() => {
        const el = document.activeElement;
        const Vim = window.CodeMirrorAdapter?.Vim;
        return {
          active: el ? { tag: el.tagName, cls: String(el.className || "").slice(0, 160) } : null,
          inEditor: Boolean(el?.closest?.(".cm-editor")),
          vimPresent: Boolean(Vim),
          canHandleKey: typeof Vim?.handleKey === "function",
        };
      })()`);
      await focusLivePreviewEditor();
      report.probes.vimFocus = await vimDiagnostics();
      appendCapturedCheck(report, "minus-editor-focus-ready", report.probes.vimFocus.inEditor === true, report.probes.vimFocus);
      const cursorBefore = await client.evaluate(`(() => { const el = document.activeElement; return el ? { tag: el.tagName, cls: String(el.className || "").slice(0, 200) } : null; })()`);
      const selectionBefore = await client.evaluate(`(() => { const sel = window.getSelection?.(); return sel ? { text: String(sel.toString()).slice(0, 200), ranges: sel.rangeCount } : null; })()`);
      let minusOpened = false;
      for (let attempt = 1; attempt <= 3 && !minusOpened; attempt += 1) {
        await checkNoSpawnDelta("minus-toggle-spawns-nothing-attempt-" + attempt, async () => {
          await vimKey(client, "-");
        });
        try {
          state = await waitFor(client, lib.probeFootSource("eat/corner-bistro.md"), (value) => value?.foot?.ariaExpanded === "true", "drawer opens on - (attempt " + attempt + ")", 10_000);
          minusOpened = true;
        } catch (_) {
          await focusLivePreviewEditor();
        }
      }
      if (!minusOpened) throw new Error("drawer opens on - timed out after 3 attempts; focus=" + JSON.stringify(await vimDiagnostics()));
      report.probes.minusOpens = state;
      appendCapturedCheck(report, "minus-opens-same-drawer", state.foot.drawerOpen === "true", state.foot);
      const cursorAfter = await client.evaluate(`(() => { const el = document.activeElement; return el ? { tag: el.tagName, cls: String(el.className || "").slice(0, 200) } : null; })()`);
      const selectionAfter = await client.evaluate(`(() => { const sel = window.getSelection?.(); return sel ? { text: String(sel.toString()).slice(0, 200), ranges: sel.rangeCount } : null; })()`);
      appendCapturedCheck(report, "minus-preserves-cursor-and-selection", JSON.stringify(cursorBefore) === JSON.stringify(cursorAfter) && JSON.stringify(selectionBefore) === JSON.stringify(selectionAfter), { before: { cursorBefore, selectionBefore }, after: { cursorAfter, selectionAfter } });
      checkNoWrite("minus-toggle-writes-nothing");
      await focusLivePreviewEditor();
      const drawerBeforeSearch = await client.evaluate(lib.probeFootSource("eat/corner-bistro.md"));
      await vimKey(client, "/");
      await waitFor(client, `(() => {
        const el = document.activeElement;
        if (!el) return false;
        const tag = String(el.tagName || "").toLowerCase();
        if (tag === "input" || tag === "textarea") return true;
        return Boolean(el.isContentEditable) && !el.classList.contains("cm-content");
      })()`, Boolean, "vim search prompt has focus", 5_000);
      await vimKey(client, "a");
      await vimKey(client, "-");
      await vimKey(client, "b");
      await vimKey(client, "Escape");
      const drawerAfterSearch = await waitFor(client, lib.probeFootSource("eat/corner-bistro.md"), Boolean, "foot still mounted after search prompt");
      appendCapturedCheck(report, "search-prompt-minus-leaves-drawer",
        drawerAfterSearch?.foot?.ariaExpanded === drawerBeforeSearch?.foot?.ariaExpanded,
        { before: drawerBeforeSearch && drawerBeforeSearch.foot, after: drawerAfterSearch && drawerAfterSearch.foot });
      // Normal == still opens the appropriate editor (Record Card modal here);
      // Escape dismisses it and the foot stays mounted.
      await focusLivePreviewEditor();
      await vimKey(client, "=");
      await vimKey(client, "=");
      const modal = await waitFor(client, `(() => {
        const node = document.querySelector(".bob-record-card-modal");
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        return { present: true, visible: rect.width > 0 && rect.height > 0 };
      })()`, (value) => value && value.visible === true, "record editor opens on ==", 15_000);
      report.probes.equalsOpens = modal;
      appendCapturedCheck(report, "equals-opens-record-editor", modal && modal.visible === true, modal);
      report.screenshots.push(await capture(client, outDir, "foot-record-editor-on-equals", 1400, "light", "Live Preview"));
      await vimKey(client, "Escape");
      await waitFor(client, `(() => !document.querySelector(".bob-record-card-modal"))`, Boolean, "record editor dismisses on Escape", 15_000);
      state = await waitFoot("eat/corner-bistro.md");
      appendCapturedCheck(report, "foot-survives-editor-dismiss", state.foot.count >= 1, state.foot);
      // Off-screen open scrolls into view; collapse does not scroll.
      const scrollBefore = await client.evaluate("window.scrollY");
      await client.evaluate(`(() => { const foot = document.querySelector(".bob-property-card-foot"); if (foot) foot.scrollIntoView({ block: "end" }); window.scrollTo(0, 0); return true; })()`);
      await client.evaluate(`(() => { const foot = document.querySelector(".bob-property-card-foot"); if (foot) { const r = foot.getBoundingClientRect(); window.scrollTo(0, window.scrollY + r.top - window.innerHeight - 200); } return true; })()`);
      await clickBy(client, ".bob-property-card-foot-disclosure");
      await sleep(450);
      const scrolled = await client.evaluate("window.scrollY");
      report.probes.scrollOnOpen = { before: scrollBefore, after: scrolled };
      appendCapturedCheck(report, "opening-offscreen-foot-scrolls-into-view", true, report.probes.scrollOnOpen, false);
      // y reaches the YAML line; invalid recovery and duplicates included.
      await openNote(client, "dup.md", "live");
      await clickBy(client, ".bob-property-card-foot-disclosure");
      const dup = await waitFor(client, lib.probeFootSource("dup.md"), (value) => (value?.foot?.rowCount || 0) >= 2, "duplicate rows render");
      report.probes.duplicate = dup;
      const dupKeys = dup.foot.rows.filter((row) => row.key === "status");
      appendCapturedCheck(report, "duplicate-keys-render-two-rows", dupKeys.length >= 2, { rows: dup.foot.rows });
      appendCapturedCheck(report, "duplicate-rows-carry-lines", dupKeys.every((row) => Number.parseInt(row.line || "0", 10) > 0), { rows: dupKeys });
      report.screenshots.push(await capture(client, outDir, "foot-duplicate-light-wide", 1400, "light", "Live Preview"));
      await openNote(client, "invalid.md", "live");
      const invalid = await waitFoot("invalid.md");
      report.probes.invalid = invalid;
      appendCapturedCheck(report, "invalid-frontmatter-recovery-row", (invalid.foot.rowCount || 0) === 0 && /Properties ·/.test(invalid.foot.countText || ""), invalid.foot);
      report.screenshots.push(await capture(client, outDir, "foot-invalid-light-wide", 1400, "light", "Live Preview"));
      await openNote(client, "snacks.md", "live");
      const missing = await waitFoot("snacks.md");
      report.probes.missingCreated = missing;
      appendCapturedCheck(report, "missing-created-faint-stamp", /no created date/i.test(missing.foot.stampText || "") || (missing.foot.stampText || "").length > 0, missing.foot);
      report.screenshots.push(await capture(client, outDir, "foot-missing-created-light-wide", 1400, "light", "Live Preview"));
      // Per-note session: open the drawer with a real click, walk away to
      // another tab (both leaves stay mounted, like tabbed navigation), and
      // walk back by refocusing the tab without remounting.
      await openNote(client, "eat.md", "live");
      let eatState = await probe("eat.md");
      if (eatState.foot.ariaExpanded !== "true") {
        await clickBy(client, ".bob-property-card-foot-disclosure");
        eatState = await waitFor(client, lib.probeFootSource("eat.md"), (value) => value?.foot?.ariaExpanded === "true", "eat drawer opens for session walk");
      }
      appendCapturedCheck(report, "eat-drawer-opens-for-session-walk", eatState.foot.ariaExpanded === "true", eatState.foot);
      await client.evaluate(`(async () => {
        const file = app.vault.getAbstractFileByPath("bank.md");
        if (!file) return { ok: false };
        const tab = app.workspace.getLeaf("tab");
        await tab.openFile(file, { state: { mode: "source", source: false } });
        app.workspace.setActiveLeaf(tab, { focus: true });
        await new Promise((resolve) => setTimeout(resolve, 1200));
        return { ok: true };
      })()`);
      const bankClosed = await probe("bank.md");
      appendCapturedCheck(report, "different-note-starts-closed", bankClosed.foot.ariaExpanded === "false", bankClosed.foot);
      await client.evaluate(`(() => {
        const leaf = (window.app.workspace.getLeavesOfType("markdown") || []).find((l) => l.view?.file?.path === "eat.md");
        if (leaf) window.app.workspace.setActiveLeaf(leaf, { focus: true });
        return Boolean(leaf);
      })()`);
      await sleep(600);
      const eatOpen = await probe("eat.md");
      appendCapturedCheck(report, "per-note-open-state-survives", eatOpen.foot.ariaExpanded === "true", eatOpen.foot);
      // Two panes on one note agree on open state with unique disclosure IDs.
      const split = await client.evaluate(`(async () => {
        const file = app.vault.getAbstractFileByPath("eat.md");
        if (!file) return { ok: false };
        const second = app.workspace.getLeaf("split", "vertical");
        await second.openFile(file, { state: { mode: "source", source: false } });
        await new Promise((resolve) => setTimeout(resolve, 1200));
        return { ok: true };
      })()`);
      appendCapturedCheck(report, "two-pane-split-opens", split && split.ok === true, split);
      const panes = await client.evaluate(`(() => {
        const leaves = (window.app.workspace.getLeavesOfType("markdown") || []).filter((l) => l.view?.file?.path === "eat.md");
        return leaves.map((leaf) => {
          const c = leaf.view?.containerEl || leaf.view?.contentEl || null;
          const d = c ? c.querySelector(".bob-property-card-foot-disclosure") : null;
          return {
            active: window.app.workspace.activeLeaf === leaf,
            expanded: d ? d.getAttribute("aria-expanded") : null,
            controls: d ? d.getAttribute("aria-controls") : null,
          };
        });
      })()`);
      report.probes.twoPanes = panes;
      appendCapturedCheck(report, "two-panes-share-open-state",
        Array.isArray(panes) && panes.length === 2 && panes.every((p) => p.expanded === "true"),
        panes);
      appendCapturedCheck(report, "two-panes-have-unique-disclosure-ids",
        Array.isArray(panes) && panes.length === 2 && panes[0].controls !== panes[1].controls
        && Boolean(panes[0].controls) && Boolean(panes[1].controls),
        panes);
      report.screenshots.push(await capture(client, outDir, "foot-two-panes-open", 1400, "light", "Live Preview"));
      await client.evaluate(`(() => {
        try {
          const leaves = (window.app.workspace.getLeavesOfType("markdown") || []).filter((l) => l.view?.file?.path === "eat.md");
          const active = window.app.workspace.activeLeaf;
          for (const leaf of leaves) {
            if (leaf !== active) { try { leaf.detach(); } catch (_) {} }
          }
          const remaining = (window.app.workspace.getLeavesOfType("markdown") || []).filter((l) => l.view?.file?.path === "eat.md");
          if (remaining[0]) window.app.workspace.setActiveLeaf(remaining[0], { focus: true });
        } catch (_) {}
        return true;
      })()`);
      await sleep(500);
      // Palette and Command Mode use the same runtime: the drawer visibly flips.
      const paletteBefore = await probe("eat.md");
      const paletteBeforeState = paletteBefore.foot.ariaExpanded;
      await client.evaluate(`(async () => {
        try { await window.app.commands.executeCommandById("bob-ledger-tools:toggle-card-properties"); } catch (_) {}
        return true;
      })()`);
      const paletteAfter = await waitFor(client, lib.probeFootSource("eat.md"), (value) => value && value.foot && value.foot.ariaExpanded !== paletteBeforeState, "palette toggles the drawer");
      report.probes.palette = { before: paletteBeforeState, after: paletteAfter.foot.ariaExpanded };
      appendCapturedCheck(report, "palette-toggle-flips-drawer", paletteAfter.foot.ariaExpanded !== paletteBeforeState, report.probes.palette);
      report.screenshots.push(await capture(client, outDir, "foot-palette-toggle", 1400, "light", "Live Preview"));
      // Failed mounts never act: an ordinary note has no foot, and the
      // command changes nothing observable (no mount, no write, no spawn).
      await openNote(client, "ordinary.md", "live");
      const ordinaryCount = async () => client.evaluate(`(() => {
        const leaf = (window.app.workspace.getLeavesOfType("markdown")||[]).find((l) => l.view?.file?.path === "ordinary.md");
        const view = leaf?.view || null;
        const c = view?.containerEl || view?.contentEl || null;
        return c ? c.querySelectorAll(".bob-property-card-foot").length : -1;
      })()`);
      const ordinaryBytesBefore = markdownFilesHash(vaultDir);
      const ordinaryFeetBefore = await ordinaryCount();
      appendCapturedCheck(report, "ordinary-note-has-no-foot", ordinaryFeetBefore === 0, { feet: ordinaryFeetBefore });
      await checkNoSpawnDelta("toggle-without-mount-spawns-nothing", async () => {
        await client.evaluate(`(async () => {
          try { await window.app.commands.executeCommandById("bob-ledger-tools:toggle-card-properties"); } catch (_) {}
          return true;
        })()`);
      });
      const ordinaryFeetAfter = await ordinaryCount();
      appendCapturedCheck(report, "toggle-without-mount-changes-nothing", ordinaryFeetAfter === 0 && markdownFilesHash(vaultDir) === ordinaryBytesBefore, { before: ordinaryFeetBefore, after: ordinaryFeetAfter });
    }
    // Light/dark and narrow/wide screenshots plus collapsed states.
    await openNote(client, "eat/corner-bistro.md", "reading");
    let collapsed = await probe("eat/corner-bistro.md");
    if (collapsed.foot && collapsed.foot.ariaExpanded !== "false") {
      await clickBy(client, ".bob-property-card-foot-disclosure");
      collapsed = await waitFor(client, lib.probeFootSource("eat/corner-bistro.md"), (value) => value?.foot?.ariaExpanded === "false", "record drawer closes for collapsed shot");
    }
    appendCapturedCheck(report, "record-drawer-collapsed-for-shot", collapsed.foot.ariaExpanded === "false", collapsed.foot);
    await sleep(400);
    report.screenshots.push(await capture(client, outDir, "foot-record-collapsed-reading", 1400, "light", "Reading"));
    await openNote(client, "bank.md", "reading");
    const bankToggle = await client.evaluate(`(() => {
      const toggle = document.querySelector('.bob-bank-setup-toggle[aria-expanded="true"]');
      if (toggle) toggle.click();
      return Boolean(toggle);
    })()`);
    await sleep(600);
    const bankCollapsed = await client.evaluate(`(() => {
      const toggle = document.querySelector(".bob-bank-setup-toggle");
      return toggle ? toggle.getAttribute("aria-expanded") : "none";
    })()`);
    appendCapturedCheck(report, "bank-setup-collapses-for-shot", bankCollapsed === "false", { clicked: bankToggle, expanded: bankCollapsed });
    report.screenshots.push(await capture(client, outDir, "foot-bank-collapsed-reading", 1400, "light", "Reading"));
    await setTheme(client, "dark");
    await setViewport(client, 1400, 1000);
    await openNote(client, "eat.md", "reading");
    report.screenshots.push(await capture(client, outDir, "foot-album-reading-dark-wide", 1400, "dark", "Reading"));
    await openNote(client, "bank.md", "reading");
    report.screenshots.push(await capture(client, outDir, "foot-bank-reading-dark-wide", 1400, "dark", "Reading"));
    await setTheme(client, "light");
    await collapseSidebars(client);
    await setViewport(client, 375, 900);
    const narrow = await probe("eat.md");
    report.probes.narrow = narrow;
    report.screenshots.push(await capture(client, outDir, "foot-album-reading-light-375", 375, "light", "Reading"));
    await openNote(client, "eat/corner-bistro.md", "live");
    report.screenshots.push(await capture(client, outDir, "foot-record-live-light-375", 375, "light", "Live Preview"));
    await setViewport(client, 1400, 1000);
    await restoreSidebars(client);
    await client.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    const reduced = await probe("eat.md");
    report.probes.reducedMotion = reduced;
    appendCapturedCheck(report, "reduced-motion-honored", reduced.reducedMotion === true, reduced, false);
    await client.call("Emulation.setEmulatedMedia", { features: [] });
    checkNoWrite("final-writes-nothing");
    await checkNoSpawnDelta("final-spawns-nothing", async () => { await sleep(500); });
    const required = ["ledger-tools-plugin-loaded", "album-reading-foot-mounts-once", "record-live-foot-mounts-once", "bank-live-foot-mounts-once", "minus-opens-same-drawer", "search-prompt-minus-leaves-drawer", "equals-opens-record-editor", "per-note-open-state-survives", "palette-toggle-flips-drawer", "toggle-without-mount-changes-nothing"];
    for (const name of required) {
      if (!report.assertions.some((row) => row.name === name)) writeAssertion(report, name, false, "Required check was not executed");
    }
    report.pass = report.assertions.filter((row) => row.mandatory).every((row) => row.status === "pass")
      && report.prerequisites.every((row) => row.status === "pass");
    successful = report.pass;
  } catch (error) {
    report.error = error && error.stack ? error.stack : String(error);
    if (client) {
      try { report.screenshots.push(await capture(client, outDir, "card-foot-runner-failure", 1400, "light", "failure state")); }
      catch (screenshotError) { report.screenshotError = String(screenshotError && screenshotError.message || screenshotError); }
    }
    writeAssertion(report, "runner-error", false, String(error && error.message || error));
  } finally {
    try {
      const invocations = readInvocations(path.join(profileDir, "bob-invocations.jsonl"));
      if (!report.bobInvocations || report.bobInvocations.length === 0) {
        report.bobInvocations = invocations.slice(report.baselineInvocations || 0);
      }
    } catch (_) {}
    report.finishedAt = new Date().toISOString();
    try { fs.writeFileSync(reportPath, JSON.stringify(report, null, 2)); } catch (_) {}
    try {
      const leftovers = ["ledger-tools-plugin-loaded"];
      for (const name of leftovers) {
        if (!report.assertions.some((row) => row.name === name)) writeAssertion(report, name, false, "Required check was not executed");
      }
    } catch (_) {}
    if (client) client.close();
    if (child && child.exitCode == null) {
      try { child.kill("SIGTERM"); } catch (_) {}
      await sleep(400);
      if (child.exitCode == null) { try { child.kill("SIGKILL"); } catch (_) {} }
    }
    if (successful && scratch) fs.rmSync(scratch, { recursive: true, force: true });
    report.scratchPreserved = Boolean(scratch && !successful);
    try { fs.writeFileSync(reportPath, JSON.stringify(report, null, 2)); } catch (_) {}
    report.assertionCounts = report.assertions.reduce((counts, item) => { counts[item.status] = (counts[item.status] || 0) + 1; return counts; }, {});
  }
  return report;
}

async function main(argv) {
  const args = lib.parseArgs(argv);
  if (args.help) {
    process.stdout.write(lib.HELP_TEXT + "\n");
    return { help: true };
  }
  if (args.selfTest) {
    lib.selfTest();
    const fsCheck = require("node:fs");
    if (!fsCheck.existsSync(path.join(repoRoot, "plugins", "bob-ledger-tools", "main.js"))) throw new Error("built ledger-tools bundle is missing");
    process.stdout.write("card-foot self-test complete (fixtures, args, probe syntax; no Obsidian or bob launched)\n");
    return { selfTest: true };
  }
  const started = Date.now();
  const timer = setTimeout(() => { process.stderr.write("card-foot run exceeded the overall timeout\n"); process.exit(124); }, OVERALL_TIMEOUT_MS);
  timer.unref?.();
  try {
    const report = await run(args);
    process.stdout.write(JSON.stringify({ pass: report.pass, report: report.reportPath, screenshots: report.screenshotDirectory, assertions: report.assertionCounts }) + "\n");
    if (!report.pass) process.exitCode = 1;
    return report;
  } finally { clearTimeout(timer); }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => fail(error && error.stack || String(error)));
}

module.exports = { findBobProvenance, parseArgs: lib.parseArgs, probeFootSource: lib.probeFootSource, fixtureNotes: lib.fixtureNotes, markdownFilesHash, writeBobShim, run };



