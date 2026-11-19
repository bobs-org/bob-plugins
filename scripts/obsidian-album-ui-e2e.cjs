#!/usr/bin/env node
// Real-Obsidian e2e for album owner cards, record folds, date chips,
// header, property hiding, failure/retry, cleanup, and debounced sync.
// Isolated scratch vault + profile, owned Obsidian process, CDP probes.
// Never opens the live vault.
//
//   xvfb-run -a node scripts/obsidian-album-ui-e2e.cjs [-e PATH] [-o DIR] [-r REPORT]
"use strict";

const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const lib = require("./obsidian-startup-smoke-lib.cjs");
const album = require("./obsidian-album-ui-e2e-lib.cjs");
const properties = require("./obsidian-album-properties-e2e.cjs");

const OVERALL_TIMEOUT_MS = 420_000;
const ELECTRON_FALLBACK = "/snap/obsidian/current/app/obsidian";

function fail(message, code) {
  const error = new Error(message);
  error.exitCode = code || 1;
  throw error;
}

function findExecutable(override) {
  const candidates = [];
  if (override) candidates.push(override);
  if (process.env.OBSIDIAN_BIN) candidates.push(process.env.OBSIDIAN_BIN);
  candidates.push(ELECTRON_FALLBACK, "/snap/bin/obsidian");
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

function findWorkspaceManifest() {
  let dir = repoRoot;
  for (let i = 0; i < 8; i += 1) {
    const candidate = path.join(dir, "Cargo.toml");
    try {
      const content = fs.readFileSync(candidate, "utf8");
      if (/name\s*=\s*"bob(-cli|-obsidian)?"/.test(content) || /\[workspace\]/.test(content)) return candidate;
    } catch {
      // Keep walking up.
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function findRealBob() {
  const candidates = [];
  if (process.env.BOB_BIN) candidates.push(process.env.BOB_BIN);
  if (process.env.BOB_CLI_BIN) candidates.push(process.env.BOB_CLI_BIN);
  const manifest = findWorkspaceManifest();
  if (manifest) {
    try {
      const meta = spawnSync("cargo", ["metadata", "--format-version", "1", "--no-deps", "--manifest-path", manifest], {
        encoding: "utf8",
        timeout: 20_000,
      });
      if (meta.status === 0 && meta.stdout) {
        const parsed = JSON.parse(meta.stdout);
        if (parsed && parsed.target_directory) {
          candidates.push(path.join(parsed.target_directory, "debug", "bob"));
          candidates.push(path.join(parsed.target_directory, "release", "bob"));
        }
      }
    } catch {
      // Fall back to installed bob.
    }
    try {
      const wsRoot = path.dirname(manifest);
      candidates.push(path.join(wsRoot, "target", "debug", "bob"));
    } catch {
      // Ignore.
    }
  }
  candidates.push(
    path.join(os.homedir(), ".cargo", "bin", "bob"),
    path.join(os.homedir(), ".local", "bin", "bob"),
    "bob",
  );
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (candidate === "bob") {
        const which = spawnSync("which", ["bob"], { encoding: "utf8", timeout: 5_000 });
        if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
        continue;
      }
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Keep looking.
    }
  }
  return "";
}

function writeNote(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function copyPluginFiles(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const file of ["manifest.json", "main.js", "styles.css"]) {
    const source = path.join(sourceDir, file);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(targetDir, file));
  }
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

function buildAuthoredFixture(vaultDir) {
  const notes = album.fixtureNotes();
  notes["schema-proof.md"] = properties.ROUNDTRIP_NOTE;
  for (const name of ["First child", "Second child"]) {
    notes[`outside/${name}.md`] = `---\nparent: "[[eat]]"\n---\n\n# ${name}\n`;
  }
  for (const [name, body] of Object.entries(notes)) writeNote(path.join(vaultDir, name), body);
  const enabled = [];
  for (const plugin of readExpectedPlugins()) {
    copyPluginFiles(path.join(repoRoot, "plugins", plugin.id), path.join(vaultDir, ".obsidian", "plugins", plugin.id));
    enabled.push(plugin.id);
  }
  fs.mkdirSync(path.join(vaultDir, ".obsidian"), { recursive: true });
  fs.writeFileSync(path.join(vaultDir, ".obsidian", "community-plugins.json"), JSON.stringify(enabled, null, 2));
  fs.writeFileSync(path.join(vaultDir, ".obsidian", "hotkeys.json"), JSON.stringify({
    "bob-navigation-hotkeys:jump-to-next-section-header": [{ modifiers: ["Ctrl"], key: "J" }],
    "bob-navigation-hotkeys:jump-to-prev-section-header": [{ modifiers: ["Ctrl"], key: "K" }],
  }, null, 2));
  fs.writeFileSync(
    path.join(vaultDir, ".obsidian", "app.json"),
    JSON.stringify({ livePreview: true, showLineNumber: false, showInlineTitle: false }, null, 2),
  );
  fs.writeFileSync(
    path.join(vaultDir, ".obsidian", "appearance.json"),
    JSON.stringify({ cssTheme: "", theme: "moonstone" }, null, 2),
  );
  const ledgerDir = path.join(vaultDir, ".obsidian", "plugins", "bob-ledger-tools");
  fs.mkdirSync(ledgerDir, { recursive: true });
  fs.writeFileSync(path.join(ledgerDir, "data.json"), JSON.stringify({ albumChips: true }, null, 2));
  return { notes: Object.keys(notes), enabled };
}

function ensureGitWorktree(vaultDir) {
  if (fs.existsSync(path.join(vaultDir, ".git"))) return;
  const run = (args, cwd) => spawnSync("git", args, { cwd: cwd || vaultDir, encoding: "utf8", timeout: 20_000 });
  const origin = `${vaultDir}.origin.git`;
  if (!fs.existsSync(origin)) {
    spawnSync("git", ["init", "-q", "--bare", origin], { encoding: "utf8", timeout: 20_000 });
    spawnSync("git", ["--git-dir", origin, "symbolic-ref", "HEAD", "refs/heads/master"], { encoding: "utf8", timeout: 20_000 });
  }
  run(["init", "-q"]);
  run(["symbolic-ref", "HEAD", "refs/heads/master"]);
  run(["config", "user.email", "album-e2e@example.com"]);
  run(["config", "user.name", "Album E2E"]);
  run(["remote", "add", "origin", origin]);
  run(["add", "."]);
  run(["commit", "-q", "-m", "album e2e fixture"]);
  run(["push", "-q", "-u", "origin", "master"]);
}

function bobEnv(vaultDir) {
  const env = { ...process.env };
  env.BOB_DIR = vaultDir;
  env.BOB_NOW = "2026-11-12 12:00:00";
  env.BOB_CONFIG_FILE = "/definitely/missing/bob-cli-test-config.yml";
  env.NO_COLOR = "1";
  return env;
}

function runBobSync(bobBin, vaultDir) {
  ensureGitWorktree(vaultDir);
  return spawnSync(bobBin, ["albums", "sync", "-f", "json"], { encoding: "utf8", env: bobEnv(vaultDir), timeout: 60_000, maxBuffer: 32 * 1024 * 1024 });
}

function runBobList(bobBin, vaultDir) {
  return spawnSync(bobBin, ["albums", "list", "-f", "json"], { encoding: "utf8", env: bobEnv(vaultDir), timeout: 60_000, maxBuffer: 32 * 1024 * 1024 });
}

function selfTest() {
  const notes = album.fixtureNotes();
  for (const name of album.requiredNoteNames()) {
    if (!notes[name] || !String(notes[name]).trim()) throw new Error(`missing fixture note ${name}`);
  }
  const eat = notes["eat.md"];
  if (!notes["body.md"].includes('parent: "[[area]]"') || !notes["area.md"].includes('parent: "[[type]]"')) {
    throw new Error("fixture must exercise the conventional area-to-type ancestry");
  }
  if (!eat.includes('type: "[[album]]"')) throw new Error("eat must be an album note");
  if (!eat.includes("index_by: location")) throw new Error("eat must declare index_by: location for subgroups");
  if (!eat.includes("status:")) throw new Error("eat must declare the status choice group field");
  if (!notes["movies.md"].includes('parent: "[[proj]]"')) throw new Error("movies must sit under the project owner");
  if (!notes["proj.md"].includes('type: "[[project]]"')) throw new Error("proj must be a project owner");
  if (!notes["empty.md"].includes('type: "[[album]]"')) throw new Error("empty must be an album note");
  if (!notes["broken.md"].includes("record: []")) throw new Error("broken must carry the invalid record schema");
  if (!notes["tools.md"].includes('type: "[[notebook]]"')) throw new Error("notebook neighbor missing");
  if (!notes["h1less-album.md"].includes("H1-less")) throw new Error("H1-less album fixture missing");
  if (notes["h1less-album.md"].startsWith("# ") || notes["h1less-album.md"].includes("\n# ")) {
    throw new Error("H1-less album must not carry an H1");
  }
  if (!notes["unrelated.md"].includes("record:")) throw new Error("unrelated note must carry a record property");
  if (notes["unrelated.md"].includes("[[album]]")) throw new Error("unrelated note must not be an album");
  const eatRecords = Object.keys(notes).filter((name) => name.startsWith("eat/"));
  if (eatRecords.length !== 15) throw new Error(`eat fixture must hold 15 records, saw ${eatRecords.length}`);
  const liked = eatRecords.filter((name) => String(notes[name]).includes("status: liked"));
  const toTry = eatRecords.filter((name) => String(notes[name]).includes("status: to_try"));
  if (toTry.length !== 2) throw new Error(`first group must hold 2 records, saw ${toTry.length}`);
  if (liked.length !== 13) throw new Error(`later group must hold 13 records, saw ${liked.length}`);
  const fold = album.assertFoldRule({ firstCount: toTry.length, laterCount: liked.length, laterSubgroups: true });
  if (!fold.ok) throw new Error(fold.reason);
  const both = eatRecords.filter((name) => String(notes[name]).includes("visited:") && String(notes[name]).includes("watched_on:"));
  if (both.length < 1) throw new Error("fixture needs a record with both visited and watched_on");
  const bad = eatRecords.filter((name) => String(notes[name]).includes("not-a-date"));
  if (bad.length < 1) throw new Error("fixture needs an invalid-date record");
  const future = eatRecords.filter((name) => String(notes[name]).includes("2026-12-01"));
  if (future.length < 1) throw new Error("fixture needs a future-date record");
  const parsed = album.parseArgs(["-s", "-o", "/tmp/out", "-r", "/tmp/report.json"]);
  if (!parsed.selfTest || parsed.out !== "/tmp/out" || parsed.report !== "/tmp/report.json") {
    throw new Error("parseArgs failed");
  }
  if (!album.albumUiProbe().includes("bob-album-header")) throw new Error("album probe must cover the header");

  const bobBin = process.env.BOB_BIN ? path.resolve(process.env.BOB_BIN) : "";
  if (!bobBin) {
    process.stdout.write("UNRUN: offline self-test skipped real-bob fixture assertions (set BOB_BIN)\n");
    return;
  }
  try { fs.accessSync(bobBin, fs.constants.X_OK); }
  catch { throw new Error(`BOB_BIN is not executable: ${bobBin}`); }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "bob-album-e2e-self-"));
  try {
    const vaultDir = path.join(scratch, "vault");
    fs.mkdirSync(vaultDir, { recursive: true });
    for (const [name, body] of Object.entries(notes)) writeNote(path.join(vaultDir, name), body);
    const synced = runBobSync(bobBin, vaultDir);
    try {
      const syncReport = JSON.parse(String(synced.stdout || ""));
      if (!syncReport || syncReport.command !== "sync") throw new Error("not a sync report");
    } catch (parseError) {
      throw new Error(`bob albums sync failed: status=${synced.status} stderr=${String(synced.stderr || "").slice(0, 400)}`);
    }
    const eatAfter = fs.readFileSync(path.join(vaultDir, "eat.md"), "utf8");
    const bodyAfter = fs.readFileSync(path.join(vaultDir, "body.md"), "utf8");
    for (const [label, content, callout] of [["eat", eatAfter, "records"], ["body", bodyAfter, "albums"]]) {
      const checked = album.assertHasCallout(content, callout);
      if (!checked.ok) throw new Error(`${label} missing generated [!${callout}] after sync: ${checked.reason}`);
    }
    const listed = runBobList(bobBin, vaultDir);
    if (listed.status !== 0) throw new Error(`bob albums list failed: ${String(listed.stderr || "").slice(0, 400)}`);
    let report;
    try {
      report = JSON.parse(String(listed.stdout || ""));
    } catch {
      throw new Error("bob albums list did not emit JSON");
    }
    const shaped = album.assertListShape(report);
    if (!shaped.ok) throw new Error(`list shape failed: ${shaped.reason}`);
    const eatRow = report.albums.find((entry) => entry && entry.stem === "eat");
    if (!Array.isArray(eatRow.groups) || eatRow.groups.length < 2) {
      throw new Error("eat must report at least two groups after sync");
    }
    const likedGroup = eatRow.groups.find((group) => group.value === "liked");
    if (!likedGroup || likedGroup.count !== 13) throw new Error(`liked group must count 13, saw ${likedGroup ? likedGroup.count : "missing"}`);
    if (!Array.isArray(likedGroup.peek) || likedGroup.peek.length === 0 || likedGroup.peek.length > 3) {
      throw new Error("liked group peek must hold 1-3 titles");
    }
    if (eatRow.last_record == null) throw new Error("eat must report a last_record created date");
    const brokenRow = report.albums.find((entry) => entry && entry.stem === "broken");
    if (!brokenRow) throw new Error("broken album must stay visible in the report");
    if (!brokenRow.index || typeof brokenRow.index.state !== "string") {
      throw new Error("broken index.state must stay an object with a state string");
    }
    if (!Array.isArray(brokenRow.issues) || brokenRow.issues.length === 0) {
      throw new Error("broken album must report issues");
    }
    if (!report.catalogs.find((entry) => entry && entry.host === "body")) {
      throw new Error("report must include the body owner catalog");
    }
    // Missing/stale catalog: remove the generated callout from stale-owner and
    // confirm the report flags it instead of showing zero counts.
    const stalePath = path.join(vaultDir, "stale-owner.md");
    if (fs.existsSync(stalePath)) {
      const before = fs.readFileSync(stalePath, "utf8");
      const stripped = before.replace(/> \[!albums\][\s\S]*?(?=\n## |\n# |\Z)/, "").trimEnd() + "\n";
      fs.writeFileSync(stalePath, stripped);
    }
    const relisted = runBobList(bobBin, vaultDir);
    if (relisted.status === 0) {
      const again = JSON.parse(String(relisted.stdout || ""));
      const reshaped = album.assertListShape(again);
      if (!reshaped.ok) throw new Error(`reshaped list failed: ${reshaped.reason}`);
    }
    const mathLeak = album.assertNoMathLeak({ mathCount: 0 });
    if (!mathLeak.ok) throw new Error(mathLeak.reason);
    const version = spawnSync(bobBin, ["--version"], { encoding: "utf8", timeout: 10_000 });
    process.stdout.write(`offline self-test complete (BOB_BIN=${bobBin}; ${String(version.stdout || version.stderr || "").trim()})\n`);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function seedProfileVault(profileDir, vaultRealPath) {
  const id = crypto.randomBytes(8).toString("hex");
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(
    path.join(profileDir, "obsidian.json"),
    JSON.stringify({ vaults: { [id]: { path: vaultRealPath, ts: Date.now(), open: true } } }, null, 2),
  );
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
    return this.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true }, timeoutMs).then(
      (response) => {
        if (response.exceptionDetails) {
          const details = response.exceptionDetails;
          throw new Error((details.exception && details.exception.description) || details.text || "Runtime.evaluate failed");
        }
        return response.result && response.result.value;
      },
    );
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
  const view = app?.workspace?.activeLeaf?.view;
  return {
    basePath: adapter && typeof adapter.basePath === "string" && adapter.basePath ? adapter.basePath : null,
    url: String(location.href || ""), title: String(document.title || ""),
    appDocumentMatches: app?.document === document,
    workspaceDocumentMatches: app?.workspace?.containerEl?.ownerDocument === document,
    activeViewDocumentMatches: view?.containerEl?.ownerDocument === document,
    activeFile: view?.file?.path || null,
  };
} catch { return null; } })()`;

function markdownViewState(mode) {
  if (mode === "preview" || mode === "reading") return { mode: "preview", source: false };
  if (mode === "source") return { mode: "source", source: true };
  return { mode: "source", source: false };
}

async function selectOwnedTarget(cdpPort, fixtureRealPath, shouldStop) {
  const deadline = Date.now() + lib.CONNECT_TIMEOUT_MS * 2;
  let lastError = "";
  let firstOwnedPage = null;
  let activeViewOwnedPage = null;
  let targetInventory = [];
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
    const pages = (Array.isArray(targets) ? targets : []).filter((item) => item && item.type === "page" && item.webSocketDebuggerUrl);
    targetInventory = [];
    for (const page of pages) {
      let probeClient = null;
      try {
        probeClient = await CdpClient.connect(page.webSocketDebuggerUrl, 5000);
        const context = await probeClient.evaluate(VAULT_PATH_PROBE, 5000);
        targetInventory.push({
          id: page.id || null,
          title: page.title || "",
          url: page.url || "",
          context: context || null,
        });
        if (context && lib.verifyVaultPath(context.basePath, fixtureRealPath)) {
          page.bobAlbumContext = context;
          page.bobAlbumTargetInventory = targetInventory;
          if (!firstOwnedPage) firstOwnedPage = page;
          if (context.activeViewDocumentMatches) {
            activeViewOwnedPage = page;
            if (context.workspaceDocumentMatches && context.appDocumentMatches) {
              page.bobAlbumTargetInventory = targetInventory;
              return page;
            }
          }
        }
      } catch (error) {
        lastError = error && error.message ? error.message : String(error);
      } finally {
        if (probeClient) probeClient.close();
      }
    }
    if (activeViewOwnedPage) {
      activeViewOwnedPage.bobAlbumTargetInventory = targetInventory;
      return activeViewOwnedPage;
    }
    if (firstOwnedPage) {
      firstOwnedPage.bobAlbumTargetInventory = targetInventory;
      return firstOwnedPage;
    }
    await sleep(500);
  }
  if (activeViewOwnedPage) {
    activeViewOwnedPage.bobAlbumTargetInventory = targetInventory;
    return activeViewOwnedPage;
  }
  if (firstOwnedPage) {
    firstOwnedPage.bobAlbumTargetInventory = targetInventory;
    return firstOwnedPage;
  }
  throw new Error(`no CDP page target reports the fixture vault${lastError ? `; last probe: ${lastError.slice(0, 160)}` : ""}`);
}

async function dismissTrustModal(client) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const clicked = await client
      .evaluate(`(() => {
        const buttons = Array.from(document.querySelectorAll("button"));
        const trust = buttons.find((button) => /Trust author and enable plugins/i.test(button.textContent || ""));
        if (!trust) return { clicked: false };
        trust.click();
        return { clicked: true };
      })()`)
      .catch(() => ({ clicked: false }));
    if (clicked && clicked.clicked) {
      await sleep(400);
      return true;
    }
    await sleep(200);
  }
  return false;
}

async function waitFor(client, expression, predicate, label, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await client.evaluate(expression);
      if (predicate(last)) return last;
    } catch (error) {
      last = { error: String((error && error.message) || error) };
    }
    await sleep(120);
  }
  throw new Error(`timed out waiting for ${label}: ${JSON.stringify(last).slice(0, 400)}`);
}

async function openNote(client, file, mode) {
  const state = markdownViewState(mode);
  return client.evaluate(
    `(() => (async () => {
      const target = ${JSON.stringify(file)};
      const wantState = ${JSON.stringify(state)};
      const abstract = window.app.vault.getAbstractFileByPath(target);
      if (!abstract) return { ok: false, error: "missing " + target };
      const leaf = window.app.workspace.getLeaf(false);
      await leaf.openFile(abstract, { state: wantState });
      const view = leaf.view;
      if (view && typeof view.setState === "function") {
        const current = (view.getState && view.getState()) || {};
        await view.setState(Object.assign({}, current, wantState), { history: false });
      }
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await new Promise((resolve) => setTimeout(resolve, 350));
      const next = (view && view.getState && view.getState()) || {};
      return { ok: true, path: view && view.file && view.file.path, mode: next.mode || null, source: next.source };
    })())()`,
    lib.RPC_TIMEOUT_MS,
  );
}

async function capturePage(client, output) {
  const candidatesSeen = [];
  if (Number.isInteger(client?.cdpPort) && client?.vaultPath) {
    try {
      const response = await fetch(`http://127.0.0.1:${client.cdpPort}/json/list`);
      const targets = response.ok ? await response.json() : [];
      for (const target of Array.isArray(targets) ? targets : []) {
        if (!target || target.type !== "page" || !target.webSocketDebuggerUrl) continue;
        let candidate = null;
        try {
          candidate = await CdpClient.connect(target.webSocketDebuggerUrl, 5000);
          await candidate.call("Runtime.enable", {});
          const context = await candidate.evaluate(`(() => {
            const app = window.app;
            const cards = Array.from(document.querySelectorAll(".bob-album-schema-dialog"));
            return { basePath: app?.vault?.adapter?.basePath || null,
              title: document.title || "", url: String(location.href || ""),
              cardCount: cards.length, cardWidth: cards[0]?.getBoundingClientRect?.().width || 0 };
          })()`);
          candidatesSeen.push({ id: target.id || null, context: context || null });
          if (context?.cardCount > 0 && context?.title?.includes("vault")) {
            await candidate.call("Page.enable", {});
            await setViewport(candidate, 375, 812);
            await sleep(180);
            const geometry = await candidate.evaluate(`(() => {
              const card = document.querySelector(".bob-album-schema-dialog");
              return { viewportWidth: innerWidth, cardWidth: card?.getBoundingClientRect().width,
                fontSize: parseFloat(getComputedStyle(card).fontSize),
                scrollWidth: card?.scrollWidth, clientWidth: card?.clientWidth,
                url: location.href, title: document.title,
                overflow: Array.from(card.querySelectorAll("*")).filter((el) => el.getBoundingClientRect().right > card.getBoundingClientRect().right + 1 || el.scrollWidth > el.clientWidth + 1)
                  .slice(0, 12).map((el) => ({ tag: el.tagName, cls: el.className, width: el.getBoundingClientRect().width,
                    text: el.textContent.slice(0, 100), whiteSpace: getComputedStyle(el).whiteSpace })) };
            })()`);
            if (geometry.viewportWidth !== 375 || geometry.cardWidth > 375
                || geometry.fontSize < 12 || geometry.scrollWidth > geometry.clientWidth + 1) {
              const failed = await candidate.call("Page.captureScreenshot", { format: "png", fromSurface: true });
              fs.writeFileSync(output, Buffer.from(failed.data, "base64"));
              throw new Error("Schema screenshot is not a readable 375px layout: " + JSON.stringify(geometry));
            }
            Object.assign(context, geometry);
            await candidate.evaluate(`(() => {
              const selector = ${JSON.stringify(/consequence|stale/.test(output) ? ".bob-album-schema-consequence" : ".bob-album-schema-stage")};
              document.querySelector(selector)?.scrollIntoView({ block: "center" });
            })()`);
            await sleep(120);
            const screenshot = await candidate.call("Page.captureScreenshot", { format: "png", fromSurface: true });
            fs.writeFileSync(output, Buffer.from(screenshot.data, "base64"));
            client.lastScreenshotContext = context;
            if (!Array.isArray(client.screenshotContexts)) client.screenshotContexts = [];
            client.screenshotContexts.push({ output, selected: context, candidates: candidatesSeen });
            return;
          }
        } catch (error) {
          if (String(error?.message).startsWith("Schema screenshot")) throw error;
          // The primary view remains the fallback when no modal-owned target is available.
        } finally {
          if (candidate) candidate.close();
        }
      }
    } catch (error) {
      if (String(error?.message).startsWith("Schema screenshot")) throw error;
      // Keep the screenshot path usable if the target list is temporarily unavailable.
    }
  }
  const screenshot = await client.call("Page.captureScreenshot", { format: "png", fromSurface: true });
  fs.writeFileSync(output, Buffer.from(screenshot.data, "base64"));
  if (!Array.isArray(client.screenshotContexts)) client.screenshotContexts = [];
  client.screenshotContexts.push({ output, selected: null, candidates: candidatesSeen });
}

async function setViewport(client, width, height) {
  await client.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
}

function isMarkdownSource(state) {
  if (!state) return false;
  if (state.source === true) return true;
  return state.mode === "source";
}

function hashNotes(vaultDir) {
  const out = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".obsidian" || entry.name.startsWith(".tmp")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".md")) {
        out[path.relative(vaultDir, full)] = crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex");
      }
    }
  };
  walk(vaultDir);
  return out;
}

function gitHead(vaultDir) {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: vaultDir,
    encoding: "utf8",
    timeout: 10_000,
  });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

function gitCount(vaultDir) {
  const result = spawnSync("git", ["rev-list", "--count", "HEAD"], {
    cwd: vaultDir,
    encoding: "utf8",
    timeout: 10_000,
  });
  return result.status === 0 ? Number(String(result.stdout || "").trim()) : 0;
}

function p95(values) {
  const sorted = (Array.isArray(values) ? values : []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] : null;
}

function writeLoggingShim(shimDir, realBob) {
  fs.mkdirSync(shimDir, { recursive: true });
  const shimPath = path.join(shimDir, "bob");
  const source = `#!/usr/bin/env node
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const root = path.dirname(__filename);
const argv = process.argv.slice(2);
let input = "";
const inputArg = argv.findIndex((arg) => arg === "-i" || arg === "--input");
const expectsInput = inputArg >= 0 && argv[inputArg + 1] === "-";
if (expectsInput) {
  try { input = fs.readFileSync(0, "utf8"); } catch {}
}
let inputJsonValid = false;
try { JSON.parse(input); inputJsonValid = true; } catch {}
fs.appendFileSync(path.join(root, "argv.jsonl"), JSON.stringify({
  t: Date.now(), argv, expectsInput, stdinBytes: Buffer.byteLength(input), inputJsonValid,
}) + "\\n");
let control = { mode: "passthrough" };
try { control = JSON.parse(fs.readFileSync(path.join(root, "control.json"), "utf8")); } catch {}
const mode = (control && control.mode) || "passthrough";
if (mode === "malformed") { process.stdout.write("{not-json"); process.exit(0); }
if (mode === "failure") {
  process.stdout.write(JSON.stringify({ ok: false, schema_version: 1, error: { code: "shim-failure", message: "shim induced failure" } }));
  process.exit(0);
}
const env = { ...process.env, NO_COLOR: "1" };
const spawned = spawnSync(${JSON.stringify(realBob)}, argv, { encoding: "utf8", env, input, timeout: 30000, maxBuffer: 32 * 1024 * 1024 });
if (spawned.stdout) process.stdout.write(spawned.stdout);
if (spawned.stderr) process.stderr.write(spawned.stderr);
process.exit(spawned.status == null ? 1 : spawned.status);
`;
  fs.writeFileSync(shimPath, source, { mode: 0o755 });
  fs.writeFileSync(path.join(shimDir, "control.json"), JSON.stringify({ mode: "passthrough" }));
  fs.writeFileSync(path.join(shimDir, "argv.jsonl"), "");
  return shimPath;
}

function shimSyncCount(shimDir, since) {
  try {
    const lines = fs.readFileSync(path.join(shimDir, "argv.jsonl"), "utf8").split("\n").filter(Boolean);
    return lines.slice(since).filter((line) => {
      try {
        const entry = JSON.parse(line);
        return Array.isArray(entry.argv) && entry.argv[0] === "albums" && entry.argv[1] === "sync";
      } catch {
        return false;
      }
    }).length;
  } catch {
    return 0;
  }
}

function shimLogLength(shimDir) {
  try {
    return fs.readFileSync(path.join(shimDir, "argv.jsonl"), "utf8").split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

function shimEntries(shimDir) {
  try {
    return fs.readFileSync(path.join(shimDir, "argv.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function shimInvocationSummary(shimDir) {
  return shimEntries(shimDir).map((entry) => ({
    argv: entry.argv,
    expectsInput: entry.expectsInput === true,
    stdinBytes: Number(entry.stdinBytes) || 0,
    inputJsonValid: entry.inputJsonValid === true,
  }));
}

async function run(args) {
  const executable = findExecutable(args.executable);
  const probed = probeExecutable(executable);
  if (!probed.ok) {
    const report = { pass: false, unrun: true, reason: probed.reason, executable };
    if (args.report) fs.writeFileSync(args.report, JSON.stringify(report, null, 2));
    fail(probed.reason, 2);
  }
  if (!process.env.DISPLAY && !process.env.XVFB_RUN_TMPDIR) {
    fail("unrun: no X display; rerun under xvfb-run -a node scripts/obsidian-album-ui-e2e.cjs", 2);
  }
  const bobBin = process.env.BOB_BIN ? path.resolve(process.env.BOB_BIN) : "";
  if (!bobBin) fail("unrun: set BOB_BIN to the verified bob binary for this workspace", 2);
  try { fs.accessSync(bobBin, fs.constants.X_OK); }
  catch { fail(`unrun: BOB_BIN is not executable: ${bobBin}`, 2); }

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "bob-album-ui-e2e-"));
  const vaultDir = path.join(scratch, "vault");
  const profileDir = path.join(scratch, "profile");
  const outDir = args.out || path.join(scratch, "shots");
  const configDir = path.join(scratch, "xdg-config");
  const homeDir = path.join(scratch, "home");
  const shimDir = path.join(scratch, "shim");
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });
  const bobConfigDir = path.join(configDir, "bob");
  fs.mkdirSync(bobConfigDir, { recursive: true });
  fs.writeFileSync(path.join(bobConfigDir, "config.yml"), [
    "properties:",
    "  - name: priority",
    "    values: [P1, P2]",
    "",
  ].join("\n"));
  const owned = buildAuthoredFixture(vaultDir);
  void owned;
  const synced = runBobSync(bobBin, vaultDir);
  try {
    const syncReport = JSON.parse(String(synced.stdout || ""));
    if (!syncReport || syncReport.command !== "sync") throw new Error("not a sync report");
  } catch {
    throw new Error(`fixture sync failed: ${String(synced.stderr || "").slice(0, 300)}`);
  }
  // Make one owner catalog stale after sync so the walk covers missing/stale states.
  const stalePath = path.join(vaultDir, "stale-owner.md");
  if (fs.existsSync(stalePath)) {
    const before = fs.readFileSync(stalePath, "utf8");
    fs.writeFileSync(stalePath, `${before}\nStale edit after sync.\n`);
  }
  const fixtureRealPath = fs.realpathSync(vaultDir);
  seedProfileVault(profileDir, fixtureRealPath);
  const shimPath = writeLoggingShim(shimDir, bobBin);

  const bobVersion = spawnSync(bobBin, ["--version"], { encoding: "utf8", timeout: 10_000 });
  const report = {
    pass: false, executable, vault: fixtureRealPath, realBob: bobBin,
    bobVersion: String(bobVersion.stdout || bobVersion.stderr || "").trim(),
    bobSource: fs.realpathSync(path.dirname(findWorkspaceManifest() || repoRoot)),
    checks: [], screenshots: [], probes: {},
  };
  const record = (name, ok, detail) => {
    report.checks.push({ name, ok: Boolean(ok), detail: detail == null ? "" : String(detail) });
  };
  let child = null;
  let client = null;
  let exitInfo = null;
  const overall = setTimeout(() => {
    if (child && !child.killed) child.kill("SIGTERM");
  }, OVERALL_TIMEOUT_MS);
  if (overall.unref) overall.unref();
  try {
    const cdpPort = await freePort();
    const childEnv = {
      ...process.env,
      HOME: homeDir,
      BOB_DIR: fixtureRealPath,
      BOB_NOW: "2026-11-12 12:00:00",
      BOB_CONFIG_FILE: "/definitely/missing/bob-cli-test-config.yml",
      XDG_CONFIG_HOME: configDir,
      PATH: `${shimDir}${path.delimiter}${process.env.PATH || ""}`,
      DISPLAY: process.env.DISPLAY || ":99",
    };
    delete childEnv.ELECTRON_RUN_AS_NODE;
    child = spawn(
      executable,
      [
        "--no-sandbox",
        `--user-data-dir=${profileDir}`,
        `--remote-debugging-port=${cdpPort}`,
        "--remote-allow-origins=http://127.0.0.1/*",
        fixtureRealPath,
      ],
      { stdio: "ignore", cwd: fixtureRealPath, env: childEnv },
    );
    child.once("exit", (code, signal) => {
      exitInfo = { code, signal };
    });
    const page = await selectOwnedTarget(cdpPort, fixtureRealPath, () => Boolean(exitInfo));
    client = await CdpClient.connect(page.webSocketDebuggerUrl, 8000);
    client.cdpPort = cdpPort;
    client.vaultPath = fixtureRealPath;
    await client.call("Page.enable", {});
    await client.call("Runtime.enable", {});
    await dismissTrustModal(client);
    let loaded = false;
    for (let i = 0; i < 40; i += 1) {
      loaded = await client.evaluate(`(() => Boolean(window.app && window.app.plugins && window.app.plugins.plugins && window.app.plugins.plugins["bob-ledger-tools"]))()`).catch(() => false);
      if (loaded) break;
      await sleep(400);
    }
    record("plugin-loaded", loaded, loaded ? "bob-ledger-tools" : "did not load");
    if (!loaded) throw new Error("bob-ledger-tools did not load in the scratch vault");
    report.probes.cdpTargetContext = page.bobAlbumContext || null;
    report.probes.cdpTargetInventory = page.bobAlbumTargetInventory || [];
    await client.evaluate(`(() => {
      window.__bobAlbumE2eTargetContext = ${JSON.stringify(page.bobAlbumContext || null)};
      window.__bobAlbumE2eTargetInventory = ${JSON.stringify(page.bobAlbumTargetInventory || [])};
      return true;
    })()`).catch(() => false);
    // Widen the shim PATH inside Obsidian so the plugin resolves our logging bob.
    await client.evaluate(`(() => { try { window.__bobAlbumE2eShim = ${JSON.stringify(shimPath)}; return true; } catch { return false; } })()`).catch(() => false);

    const beforeHashes = hashNotes(vaultDir);
    const probe = album.albumUiProbe();
    const clickActiveSchemaOpener = () => client.evaluate(`(() => (async () => {
      const leaf = window.app?.workspace?.activeLeaf;
      const view = leaf?.view;
      const state = view && typeof view.getState === "function" ? view.getState() : {};
      const selector = state.mode === "source" ? ".markdown-source-view" : ".markdown-preview-view";
      const surface = view?.containerEl?.querySelector(selector);
      const plugin = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}];
      const buttons = Array.from(surface?.querySelectorAll(".bob-album-header-schema") || [])
        .filter((button) => button.isConnected);
      const button = buttons.find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      if (!button) return {
        ok: false,
        path: view?.file?.path || null,
        mode: state.mode || null,
        source: state.source,
        activeSurface: Boolean(surface),
        openers: buttons.length,
        diagnostics: {
          cdpTargetContext: window.__bobAlbumE2eTargetContext || null,
          modalOpen: { observed: false, reason: "no visible schema opener" },
          onOpen: { observed: false, reason: "no schema modal instance" },
          contentRoot: null,
          activeViewDocument: {
            matchesCdpDocument: view?.containerEl?.ownerDocument === document,
            title: view?.containerEl?.ownerDocument?.title || "",
            url: view?.containerEl?.ownerDocument?.URL || "",
          },
          targetCount: 0,
          bobPath: plugin?.apiStatsBobPath?.() || null,
          albumReportState: (() => {
            try {
              const value = plugin?.albumReportState?.();
              return value ? {
                unavailable: value.unavailable,
                refreshing: value.refreshing,
                stale: value.stale,
                error: value.error,
                errorModel: value.errorModel,
                reportGeneration: value.reportGeneration,
                generation: value.generation,
                hasReport: Boolean(value.report),
              } : null;
            } catch (error) {
              return { error: String(error?.stack || error) };
            }
          })(),
        },
      };
      const original = plugin?.openAlbumSchemaEntry;
      const hadOwn = Boolean(plugin && Object.prototype.hasOwnProperty.call(plugin, "openAlbumSchemaEntry"));
      const ownDescriptor = hadOwn ? Object.getOwnPropertyDescriptor(plugin, "openAlbumSchemaEntry") : null;
      const ModalCtor = window.Modal;
      const originalModalOpen = ModalCtor?.prototype?.open;
      let onOpenDiagnostic = null;
      if (typeof originalModalOpen === "function") {
        ModalCtor.prototype.open = function(...args) {
          const isSchemaModal = this?.constructor?.name === "AlbumSchemaCardModal";
          const originalOnOpen = this?.onOpen;
          if (isSchemaModal && typeof originalOnOpen === "function") {
            this.onOpen = function(...onOpenArgs) {
              try {
                const result = originalOnOpen.apply(this, onOpenArgs);
                onOpenDiagnostic = { ok: true };
                return result;
              } catch (error) {
                onOpenDiagnostic = {
                  ok: false,
                  error: String(error?.stack || error),
                };
                throw error;
              } finally {
                this.onOpen = originalOnOpen;
              }
            };
          }
          return originalModalOpen.apply(this, args);
        };
      }
      let entryPromise = null;
      let entryResult = null;
      let entryError = null;
      if (plugin && typeof original === "function") {
        plugin.openAlbumSchemaEntry = function(...args) {
          entryPromise = Promise.resolve(original.apply(this, args)).then((result) => {
            entryResult = result;
            return result;
          }, (error) => {
            entryError = String(error?.stack || error);
            throw error;
          });
          return entryPromise;
        };
      }
      try {
        button.click();
        if (entryPromise) await entryPromise.catch(() => null);
        await new Promise((resolve) => setTimeout(resolve, 100));
        const modal = plugin?.albumSchemaCardModal;
        const content = modal?.contentEl;
        const root = content?.getRootNode?.();
        const contentDocument = content?.ownerDocument || document;
        const activeViewDocument = view?.containerEl?.ownerDocument || null;
        const rect = content?.getBoundingClientRect?.();
        const style = content && typeof (contentDocument.defaultView || window).getComputedStyle === "function"
          ? (contentDocument.defaultView || window).getComputedStyle(content) : null;
        const modalState = modal ? {
          className: modal.modalEl?.className || "",
          contentClass: modal.contentEl?.className || "",
          modalConnected: Boolean(modal.modalEl?.isConnected),
          contentConnected: Boolean(modal.contentEl?.isConnected),
          hasOnOpen: typeof modal.onOpen === "function",
          constructor: modal.constructor?.name || "",
          onOpenDiagnostic,
          root: root === document ? "document" : root?.host ? "shadow-root" : root?.nodeName || null,
          rootHost: root?.host?.tagName || null,
          ownerDocumentMatches: contentDocument === document,
          ownerDocumentMatchesActiveView: contentDocument === activeViewDocument,
          ownerDocumentTitle: contentDocument.title || "",
          ownerDocumentUrl: contentDocument.URL || "",
          activeViewDocumentMatches: activeViewDocument === document,
          appDocumentMatches: window.app?.document === document,
          workspaceDocumentMatches: window.app?.workspace?.containerEl?.ownerDocument === document,
          viewContainerDocumentTitle: activeViewDocument?.title || "",
          viewContainerDocumentUrl: activeViewDocument?.URL || "",
          childCount: content?.children?.length ?? null,
          targetCount: content?.querySelectorAll?.("[data-target-key]")?.length ?? null,
          text: String(content?.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 500),
          display: style?.display || null,
          visibility: style?.visibility || null,
          opacity: style?.opacity || null,
          zIndex: style?.zIndex || null,
          bounds: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
        } : null;
        return {
          ok: Boolean(entryResult?.ok && modal),
          path: view?.file?.path || null,
          mode: state.mode || null,
          openers: buttons.length,
          label: button.getAttribute("aria-label") || button.textContent || "",
          entryInvoked: Boolean(entryPromise),
          entryResult: entryResult ? { ok: Boolean(entryResult.ok), reason: entryResult.reason || null, albumPath: entryResult.albumPath || null } : null,
          entryError,
          diagnostics: {
            cdpTargetContext: window.__bobAlbumE2eTargetContext || null,
            modalOpen: {
              hookInstalled: typeof originalModalOpen === "function",
              observedByConnectedElement: Boolean(modal?.modalEl?.isConnected && content?.isConnected),
              constructor: modal?.constructor?.name || null,
            },
            onOpen: {
              methodPresent: typeof modal?.onOpen === "function",
              diagnostic: onOpenDiagnostic,
            inferredFromPaintedTargets: Boolean((content?.matches?.(".bob-album-schema-dialog")
              || content?.querySelector?.(".bob-album-schema-dialog"))
                && content?.querySelectorAll?.("[data-target-key]")?.length),
            },
            contentRoot: {
              kind: root === document ? "document" : root?.host ? "shadow-root" : root?.nodeName || null,
              host: root?.host?.tagName || null,
            },
            activeViewDocument: {
              matchesCdpDocument: activeViewDocument === document,
              matchesContentDocument: contentDocument === activeViewDocument,
              title: activeViewDocument?.title || "",
              url: activeViewDocument?.URL || "",
            },
            albumReportState: (() => {
              try {
                const value = plugin?.albumReportState?.();
                return value ? {
                  unavailable: value.unavailable,
                  refreshing: value.refreshing,
                  stale: value.stale,
                  error: value.error,
                  errorModel: value.errorModel,
                  reportGeneration: value.reportGeneration,
                  generation: value.generation,
                  hasReport: Boolean(value.report),
                  album: (value.report?.albums || []).find((item) => item?.stem === "eat") || null,
                } : null;
              } catch (error) {
                return { error: String(error?.stack || error) };
              }
            })(),
            targetInventory: window.__bobAlbumE2eTargetInventory || [],
            targetCount: content?.querySelectorAll?.("[data-target-key]")?.length ?? 0,
          },
          modal: modalState,
          dialogCount: contentDocument.querySelectorAll(".bob-album-schema-dialog").length,
          topLevelDialogCount: document.querySelectorAll(".bob-album-schema-dialog").length,
        };
      } finally {
        if (ModalCtor && typeof originalModalOpen === "function") ModalCtor.prototype.open = originalModalOpen;
        if (plugin) {
          if (hadOwn) Object.defineProperty(plugin, "openAlbumSchemaEntry", ownDescriptor);
          else delete plugin.openAlbumSchemaEntry;
        }
      }
    })())()`);

    await setViewport(client, 1280, 800);
    for (const [file, mode, label] of [["body.md", "preview", "owner-reading"], ["body.md", "live", "owner-live"]]) {
      const opened = await openNote(client, file, mode);
      record(`open-${label}`, Boolean(opened && opened.ok), JSON.stringify(opened).slice(0, 160));
      await sleep(700);
      const snapshot = await waitFor(client, probe, (value) => value && Array.isArray(value.ownerCards) && value.ownerCards.length > 0, `${label}-card`, 16_000).catch(async (error) => {
        const latest = await client.evaluate(probe).catch(() => ({ error: error.message }));
        latest.error = error.message;
        return latest;
      });
      report.probes[label] = snapshot;
      record(`${label}-card`, (snapshot.ownerCards || []).length > 0, `cards=${(snapshot.ownerCards || []).length}`);
      record(`${label}-counts`, (snapshot.counts || []).length > 0, `counts=${(snapshot.counts || []).length}`);
      record(`${label}-lead`, (snapshot.leads || []).length > 0, `leads=${(snapshot.leads || []).length}`);
      record(`${label}-peek-text`, (snapshot.peeks || []).every((item) => !/<[^>]+>/.test(item.text || "")), `peeks=${(snapshot.peeks || []).length}`);
      record(`${label}-age`, (snapshot.ages || []).length > 0, `ages=${(snapshot.ages || []).length}`);
      const stainedZero = (snapshot.counts || []).some((item) => /\\b0\\b/.test(item.text || "") && /missing|stale|invalid|damaged/i.test(JSON.stringify(snapshot.health || [])));
      record(`${label}-no-zero-when-unavailable`, !stainedZero, "unavailable data must not read as zero");
      await client.evaluate(`(() => {
        const view = window.app.workspace.activeLeaf.view;
        const surface = view.containerEl.querySelector(${JSON.stringify(mode)} === "live" ? ".markdown-source-view" : ".markdown-preview-view");
        surface?.querySelector("[data-callout=albums]")?.scrollIntoView({ block: "start" });
      })()`);
      const shot = path.join(outDir, `album-owner-${label}.png`);
      await capturePage(client, shot);
      report.screenshots.push(shot);
    }

    // Light and dark themes in Reading view.
    await openNote(client, "body.md", "preview");
    await sleep(400);
    await client.evaluate(`(() => { document.body.classList.remove("theme-dark"); document.body.classList.add("theme-light"); return true; })()`);
    await sleep(200);
    await client.evaluate(`(() => {
      document.querySelector(".markdown-preview-view [data-callout=albums]")?.scrollIntoView({ block: "start" });
    })()`);
    const lightShot = path.join(outDir, "album-owner-light.png");
    await capturePage(client, lightShot);
    report.screenshots.push(lightShot);
    await client.evaluate(`(() => { document.body.classList.remove("theme-light"); document.body.classList.add("theme-dark"); return true; })()`);
    await sleep(200);
    const darkShot = path.join(outDir, "album-owner-dark.png");
    await capturePage(client, darkShot);
    report.screenshots.push(darkShot);
    await client.evaluate(`(() => { document.body.classList.remove("theme-dark"); document.body.classList.add("theme-light"); return true; })()`);
    record("themes-captured", fs.existsSync(lightShot) && fs.existsSync(darkShot), "light+dark");

    // Narrow pane: chips wrap at ~375 px.
    await setViewport(client, 375, 812);
    await sleep(300);
    await openNote(client, "body.md", "preview");
    await sleep(500);
    await client
      .evaluate(`(() => {
        try {
          if (window.app && window.app.workspace && window.app.workspace.leftSplit) window.app.workspace.leftSplit.collapse();
          if (window.app && window.app.workspace && window.app.workspace.rightSplit) window.app.workspace.rightSplit.collapse();
        } catch {}
        const el = document.querySelector('.markdown-preview-view [data-callout=albums], .markdown-preview-view [data-callout="albums"]');
        if (el) el.scrollIntoView({ block: "start" });
        return Boolean(el);
      })()`)
      .catch(() => false);
    await sleep(300);
    const narrow = await client.evaluate(probe);
    report.probes.narrow375 = narrow;
    const overflow = (narrow.leads || []).concat(narrow.ages || [], narrow.health || []).some((chip) => chip.w > 375);
    record("narrow-375-wrap", !overflow, "chips wrap at 375px");
    const narrowShot = path.join(outDir, "album-owner-375.png");
    await capturePage(client, narrowShot);
    report.screenshots.push(narrowShot);
    await setViewport(client, 1280, 800);

    // Record index folds: first group expanded, later >12 group folded, per-pane.
    await openNote(client, "eat.md", "preview");
    await sleep(800);
    const records = await waitFor(client, probe, (value) => value && Array.isArray(value.recordCards) && value.recordCards.length > 0, "records-card", 16_000).catch(async (error) => {
      const latest = await client.evaluate(probe).catch(() => ({ error: error.message }));
      latest.error = error.message;
      return latest;
    });
    report.probes.eatReading = records;
    const readingHeader = album.assertHeaderIntegrity(records);
    record("reading-single-header-no-warning", readingHeader.ok, readingHeader.reason || "one header outside records; no ancestry warning");
    record("records-card", (records.recordCards || []).length > 0, `cards=${(records.recordCards || []).length}`);
    record("records-folds-present", (records.folds || []).length > 0, `folds=${(records.folds || []).length}`);
    const foldStates = (records.recordGroups || []).map((item) => item.folded);
    record("records-fold-defaults", foldStates.includes("") || foldStates.includes(null) || (records.folds || []).length > 0, JSON.stringify(foldStates).slice(0, 160));
    const eatShot = path.join(outDir, "album-records-reading.png");
    await capturePage(client, eatShot);
    report.screenshots.push(eatShot);
    await openNote(client, "eat.md", "live");
    await sleep(700);
    const recordsLive = await client.evaluate(probe);
    report.probes.eatLive = recordsLive;
    const liveHeader = album.assertHeaderIntegrity(recordsLive);
    record("live-single-header-no-warning", liveHeader.ok, liveHeader.reason || "one header outside records; no ancestry warning");
    record("records-live-card", (recordsLive.recordCards || []).length > 0, `cards=${(recordsLive.recordCards || []).length}`);
    const headerLayout = await client.evaluate(`(() => {
      const header = window.app.workspace.activeLeaf.view.containerEl.querySelector(".markdown-source-view .bob-album-header");
      const summary = header?.querySelector(".bob-album-schema-summary");
      const style = header && getComputedStyle(header);
      return { fontSize: parseFloat(style?.fontSize), fontWeight: Number(style?.fontWeight),
        width: header?.clientWidth, scrollWidth: header?.scrollWidth,
        summaryWidth: summary?.clientWidth, summaryScrollWidth: summary?.scrollWidth };
    })()`);
    report.probes.liveHeaderLayout = headerLayout;
    record("live-header-body-sized-and-contained", headerLayout.fontSize >= 12 && headerLayout.fontSize <= 16
      && headerLayout.fontWeight < 600 && headerLayout.scrollWidth <= headerLayout.width + 1
      && headerLayout.summaryScrollWidth <= headerLayout.summaryWidth + 1, JSON.stringify(headerLayout));
    const liveShot = path.join(outDir, "album-records-live.png");
    await capturePage(client, liveShot);
    report.screenshots.push(liveShot);
    await setViewport(client, 375, 812);
    await sleep(300);
    const narrowHeader = await client.evaluate(`(() => {
      const header = window.app.workspace.activeLeaf.view.containerEl.querySelector(".markdown-source-view .bob-album-header");
      header?.scrollIntoView({ block: "start" });
      return { viewport: innerWidth, width: header?.clientWidth, scrollWidth: header?.scrollWidth };
    })()`);
    record("header-375-wrap", narrowHeader.viewport === 375 && narrowHeader.width > 0
      && narrowHeader.scrollWidth <= narrowHeader.width + 1, JSON.stringify(narrowHeader));
    await sleep(150);
    const narrowHeaderShot = path.join(outDir, "album-header-375-light.png");
    await capturePage(client, narrowHeaderShot);
    report.screenshots.push(narrowHeaderShot);
    await setViewport(client, 1280, 800);

    // Date chips: distinct visited/watched tooltips; refresh on frontmatter edit.
    const chips = (recordsLive.dateChips || []).concat(records.dateChips || []);
    record("date-chips-present", chips.length > 0, `chips=${chips.length}`);
    const chipProbe = await client.evaluate(`(() => {
      const nodes = Array.from(document.querySelectorAll(".bob-records-age"));
      return nodes.map((node) => ({ title: node.getAttribute("title") || "", text: node.textContent || "" })).slice(0, 12);
    })()`).catch(() => []);
    report.probes.dateChipTitles = chipProbe;
    const hasVisited = (chipProbe || []).some((entry) => /Visited/i.test(entry.title || ""));
    const hasWatched = (chipProbe || []).some((entry) => /Watched/i.test(entry.title || ""));
    record("date-chip-tooltips", hasVisited && hasWatched, JSON.stringify(chipProbe).slice(0, 220));

    // Album header: breadcrumb resolves, copy puts Name @stem/, schema order.
    await openNote(client, "eat.md", "preview");
    await sleep(600);
    const header = await client.evaluate(probe);
    report.probes.eatHeader = header;
    record("header-present", (header.headers || []).some((item) => item.visible), `headers=${(header.headers || []).length}`);
    record("header-crumb", (header.crumbs || []).some((item) => /body/i.test(item.href || item.text || "")), JSON.stringify((header.crumbs || []).map((c) => c.href)).slice(0, 200));
    record("header-schema", (header.schemaFields || []).length >= 2, `fields=${(header.schemaFields || []).length}`);
    const copyResult = await client.evaluate(`(() => (async () => {
      const button = document.querySelector(".bob-album-header-copy");
      if (!button) return { ok: false, error: "copy button missing" };
      const title = button.getAttribute("title") || "";
      const disabled = button.disabled || button.getAttribute("aria-disabled") === "true";
      let clipboard = null;
      let clipboardError = null;
      try {
        button.click();
        await new Promise((resolve) => setTimeout(resolve, 400));
        clipboard = await navigator.clipboard.readText();
      } catch (error) {
        clipboardError = String((error && error.message) || error);
      }
      return { ok: true, title, disabled: Boolean(disabled), clipboard, clipboardError };
    })())()`).catch((error) => ({ ok: false, error: String(error && error.message || error) }));
    record("header-copy", Boolean(copyResult && copyResult.ok && !copyResult.disabled && (copyResult.clipboard === "Name @eat/" || (copyResult.clipboard == null && String(copyResult.title || "").includes("@eat/")))), JSON.stringify(copyResult).slice(0, 200));

    const childWarnings = await client.evaluate(`(() => {
      const view = window.app.workspace.activeLeaf.view;
      const surface = view.containerEl.querySelector(".markdown-preview-view");
      const summary = surface?.querySelector(".bob-album-schema-summary");
      if (summary?.getAttribute("aria-expanded") !== "true") summary?.click();
      return Array.from(surface?.querySelectorAll(".bob-album-schema-issue") || [])
        .filter((el) => el.getBoundingClientRect().height > 0)
        .map((el) => el.textContent);
    })()`);
    report.probes.childWarnings = childWarnings;
    record("child-warnings-name-their-files", ["First child", "Second child"].every(
      (name) => childWarnings.some((text) => text.includes(`outside/${name}.md`) && text.includes("lives outside eat/"))
    ), JSON.stringify(childWarnings));
    await client.evaluate(`(() => {
      document.querySelector(".markdown-preview-view .bob-album-header")?.scrollIntoView({ block: "start" });
    })()`);
    const warningsShot = path.join(outDir, "album-named-child-warnings.png");
    await capturePage(client, warningsShot);
    report.screenshots.push(warningsShot);

    // The empty records callout previously rendered a header per detached chunk.
    for (const mode of ["preview", "live"]) {
      await openNote(client, "empty.md", mode);
      await sleep(700);
      const empty = await client.evaluate(probe);
      report.probes[`empty-${mode}`] = empty;
      const checked = album.assertHeaderIntegrity(empty);
      record(`empty-${mode}-single-header-no-warning`, checked.ok, checked.reason || "one header outside the empty records callout");
      record(`empty-${mode}-records-card`, (empty.recordCards || []).length > 0, "empty generated records callout is rendered");
    }

    // H1-less album still gets one header.
    await openNote(client, "h1less-album.md", "preview");
    await sleep(600);
    const h1less = await client.evaluate(probe);
    report.probes.h1less = h1less;
    record("h1less-header", (h1less.headers || []).some((item) => item.visible), `headers=${(h1less.headers || []).length}`);

    // Invalid album: copy disabled with a reason.
    await openNote(client, "broken.md", "preview");
    await sleep(600);
    const broken = await client.evaluate(probe);
    report.probes.broken = broken;
    const brokenCopy = await client.evaluate(`(() => {
      const button = document.querySelector(".bob-album-header-copy");
      if (!button) return { ok: false, error: "copy button missing on broken album" };
      const disabled = button.disabled || button.getAttribute("aria-disabled") === "true";
      const reason = button.getAttribute("title") || button.getAttribute("aria-label") || "";
      return { ok: true, disabled: Boolean(disabled), reason };
    })()`).catch((error) => ({ ok: false, error: String(error && error.message || error) }));
    record("broken-copy-disabled", Boolean(brokenCopy && brokenCopy.ok && brokenCopy.disabled), JSON.stringify(brokenCopy).slice(0, 200));

    // Property hiding: record row hidden only on album notes, in Live Preview
    // (native Properties under the CodeMirror editor) as well as Reading.
    await openNote(client, "eat.md", "live");
    await sleep(500);
    const albumLiveProps = await client.evaluate(properties.propertyProbe());
    report.probes.albumLiveProps = albumLiveProps;
    record("record-prop-hidden-on-album-live", properties.propertyVisibility(albumLiveProps, "eat.md", false), JSON.stringify(albumLiveProps));
    await openNote(client, "eat.md", "preview");
    await sleep(500);
    const albumProps = await client.evaluate(properties.propertyProbe());
    await openNote(client, "unrelated.md", "preview");
    await sleep(500);
    const unrelatedProps = await client.evaluate(properties.propertyProbe());
    report.probes.albumProps = albumProps;
    report.probes.unrelatedProps = unrelatedProps;
    record("record-prop-hidden-on-album", properties.propertyVisibility(albumProps, "eat.md", false), JSON.stringify(albumProps));
    record("record-prop-visible-off-album", properties.propertyVisibility(unrelatedProps, "unrelated.md", true), JSON.stringify(unrelatedProps));

    // Report failure and retry through the shim control flag.
    fs.writeFileSync(path.join(shimDir, "control.json"), JSON.stringify({ mode: "malformed" }));
    await openNote(client, "body.md", "preview");
    await sleep(1200);
    const failed = await client.evaluate(probe);
    report.probes.failed = failed;
    record("failure-state", (failed.status || []).length > 0 || (failed.retry || []).length > 0 || (failed.actions || []).length > 0, "error state offers retry");
    fs.writeFileSync(path.join(shimDir, "control.json"), JSON.stringify({ mode: "passthrough" }));
    await client.evaluate(`(() => {
      const plugin = window.app && window.app.plugins && window.app.plugins.plugins && window.app.plugins.plugins["bob-ledger-tools"];
      if (plugin && typeof plugin.apiAlbumInvalidate === "function") plugin.apiAlbumInvalidate("e2e-retry");
      return true;
    })()`).catch(() => false);
    await sleep(1500);
    const retried = await client.evaluate(probe);
    report.probes.retried = retried;
    record("retry-restores", (retried.ownerCards || []).length > 0, "healthy card returns after retry");

    // Snapshot vault bytes before the sync-triggering frontmatter edits below.
    const midHashes = hashNotes(vaultDir);

    // Debounced sync: two quick frontmatter edits coalesce to one sync ~3s later.
    // Body-only appends must not start a sync, so these edits change the
    // indexed `location` frontmatter field on two records.
    const logBase = shimLogLength(shimDir);
    await client.evaluate(`(() => (async () => {
      const vault = window.app.vault;
      const editLocation = async (name, from, to) => {
        const file = vault.getAbstractFileByPath(name);
        if (!file) return false;
        const text = await vault.read(file);
        if (!text.includes("location: " + from)) return false;
        await vault.modify(file, text.replace("location: " + from, "location: " + to));
        return true;
      };
      const first = await editLocation("eat/liked-01.md", "Downtown", "Uptown");
      await new Promise((resolve) => setTimeout(resolve, 300));
      const second = await editLocation("eat/liked-02.md", "downtown", "Midtown");
      return { ok: Boolean(first && second), first, second };
    })())()`).catch(() => ({ ok: false }));
    await sleep(5_500);
    const syncs = shimSyncCount(shimDir, logBase);
    record("debounced-sync-once", syncs === 1, `albums sync invocations=${syncs}`);

    // Byte preservation for presentation-only interactions. midHashes was taken
    // before the sync-triggering edits; the debounced sync legitimately
    // rewrites stale indexes afterwards, so it is verified separately.
    const drifted = Object.keys(beforeHashes).filter((name) => beforeHashes[name] !== midHashes[name]);
    record("presentation-preserves-bytes", drifted.length === 0, drifted.length ? `drifted=${drifted.slice(0, 4).join(",")}` : "hashes identical");

    // Schema Card editor walk: entry, keyboard, preview/apply/Undo, stale,
    // YAML Done, and narrow-pane visual proof. Mutations land last so the
    // byte and sync assertions above stay clean.
    const LEDGER_ID = "bob-ledger-tools";
    const updateShimBase = shimLogLength(shimDir);
    const updateShimEdits = (since = updateShimBase) => {
      try {
        const lines = fs.readFileSync(path.join(shimDir, "argv.jsonl"), "utf8").split("\n").filter(Boolean).slice(since);
        let dry = 0;
        let apply = 0;
        const requests = [];
        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            if (Array.isArray(entry.argv) && entry.argv[0] === "albums" && entry.argv[1] === "update") {
              if (entry.argv.includes("-d")) dry += 1;
              else apply += 1;
              requests.push({
                args: entry.argv,
                stdinBytes: Number(entry.stdinBytes) || 0,
                inputJsonValid: entry.inputJsonValid === true,
              });
            }
          } catch {
            // A torn log line must not fail the walk.
          }
        }
        return { dry, apply, requests };
      } catch {
        return { dry: 0, apply: 0, requests: [] };
      }
    };
    const ledgerEval = (body) => client.evaluate(`(() => {
      const plugin = window.app && window.app.plugins && window.app.plugins.plugins && window.app.plugins.plugins[${JSON.stringify(LEDGER_ID)}];
      if (!plugin) return { ok: false, error: "ledger-tools missing" };
      return (async () => { ${body} })();
    })()`);
    const schemaFp = async () => {
      const state = await ledgerEval(`return { report: (typeof plugin.albumReportState === "function" ? plugin.albumReportState() : {}).report || null };`);
      const entry = state && state.report && (state.report.albums || []).find((item) => item && item.stem === "eat");
      return entry ? entry.schema_fingerprint : null;
    };
    const closeSchemaCard = () => ledgerEval(`try { plugin.albumSchemaCardModal?.close?.(); } catch {} return { closed: !plugin.albumSchemaCardModal };`);

    await openNote(client, "eat.md", "preview");
    await sleep(800);
    const openerClicked = await clickActiveSchemaOpener();
    record("schema-open-header", Boolean(openerClicked && openerClicked.ok), JSON.stringify(openerClicked));
    const dialog = await waitFor(client, probe, (value) => value && (value.schemaDialogs || []).length > 0, "schema-dialog", 16_000).catch(async () => client.evaluate(probe));
    report.probes.schemaDialog = dialog;
    record("schema-dialog-targets", (dialog.schemaTargets || []).length > 3, `targets=${(dialog.schemaTargets || []).length}`);
    record("schema-dialog-footer", (dialog.schemaFooter || []).some((item) => /⏎/.test(item.text || "") && /esc/i.test(item.text || "")), "footer names edit/Undo/YAML keys");
    record("schema-dialog-labeled", (dialog.schemaUnlabeled || []).length === 0, `unlabeled=${(dialog.schemaUnlabeled || []).length}`);
    record("schema-no-preview-yet", (dialog.schemaConsequence || []).length === 0, "opening and reading never previews");
    const captureSchemaThemes = async (stem) => {
      await setViewport(client, 375, 812);
      await sleep(200);
      const light = path.join(outDir, `album-schema-${stem}-375-light.png`);
      await capturePage(client, light);
      report.screenshots.push(light);
      await client.evaluate(`(() => { document.body.classList.add("theme-dark"); return true; })()`);
      await sleep(150);
      const dark = path.join(outDir, `album-schema-${stem}-375-dark.png`);
      await capturePage(client, dark);
      report.screenshots.push(dark);
      await client.evaluate(`(() => { document.body.classList.remove("theme-dark"); return true; })()`);
    };
    await captureSchemaThemes("browsing");
    const moreOpened = await client.evaluate(`(() => {
      const modal = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}]?.albumSchemaCardModal;
      const toggle = modal?.contentEl?.querySelector?.('[data-schema-action="more"]');
      if (!toggle) return { ok: false, error: "more toggle missing" };
      toggle.click();
      const list = modal?.contentEl?.querySelector?.(".bob-album-schema-more");
      return { ok: Boolean(list) && list.getAttribute("hidden") == null, text: String(list?.textContent || "").slice(0, 160) };
    })()`);
    record("schema-more-list", Boolean(moreOpened && moreOpened.ok), JSON.stringify(moreOpened));
    await captureSchemaThemes("more");
    await client.evaluate(`(() => {
      const modal = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}]?.albumSchemaCardModal;
      if (modal) {
        modal.schemaMoreOpen = false;
        modal.paintSchemaCard?.("session");
      }
      return true;
    })()`);

    const keyState = await client.evaluate(`(() => {
      const ledger = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}];
      const modal = ledger && ledger.albumSchemaCardModal;
      if (!modal) return { ok: false };
      const root = modal.contentEl || document;
      const first = root.querySelector("[data-target-key]");
      if (!first) return { ok: false };
      const before = modal.selectedKey;
      first.focus();
      first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      const moved = modal.selectedKey;
      const selected = root.querySelector('[data-target-key].is-selected') || first;
      selected.focus();
      selected.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      const staged = Boolean(root.querySelector("[data-schema-stage]"));
      const draftAfterEnter = (modal.session?.getState?.().draftOps || []).length;
      const input = root.querySelector("[data-schema-input]");
      if (input) {
        input.focus();
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "s", bubbles: true }));
      }
      const draftAfterType = (modal.session?.getState?.().draftOps || []).length;
      const target = root.querySelector("[data-target-key]");
      if (target) target.dispatchEvent(new KeyboardEvent("keydown", { key: "x", keyCode: 229, bubbles: true }));
      const afterIme = modal.selectedKey;
      if (input) input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      const cancelled = !root.querySelector("[data-schema-stage]");
      const modalAfterEscape = ledger?.albumSchemaCardModal || null;
      const rootAfterEscape = modalAfterEscape?.contentEl || null;
      const activeElement = root.ownerDocument?.activeElement || null;
      const focus = activeElement && root.contains(activeElement) && activeElement.getAttribute
        ? activeElement.getAttribute("data-target-key") : null;
      return { ok: true, before, moved, staged, draftAfterEnter, draftAfterType, afterIme, cancelled, focus,
        modalSurvivedEscape: modalAfterEscape === modal,
        targetCountAfterEscape: rootAfterEscape?.querySelectorAll?.("[data-target-key]")?.length ?? 0,
        targetKeysAfterEscape: Array.from(rootAfterEscape?.querySelectorAll?.("[data-target-key]") || [])
          .map((target) => target.getAttribute("data-target-key")),
        selectedAfterEscape: modalAfterEscape?.selectedKey || null,
        stageAfterEscape: modalAfterEscape?.stage?.kind || null,
        contentDocumentAfterEscape: rootAfterEscape?.ownerDocument?.title || "",
        activeElement: activeElement ? { tag: activeElement.tagName, className: String(activeElement.className || ""), inModal: root.contains(activeElement) } : null };
    })()`);
    report.probes.schemaKeys = keyState;
    record("schema-keyboard-nav", Boolean(keyState && keyState.ok && keyState.before !== keyState.moved), `selection ${keyState.before} -> ${keyState.moved}`);
    record("schema-keyboard-stage", Boolean(keyState && keyState.staged), "Enter stages the selected row");
    record("schema-typing-guard", Boolean(keyState && keyState.draftAfterType === 0), "typing in inputs never queues a hotkey draft");
    record("schema-ime-guard", Boolean(keyState && keyState.afterIme === keyState.moved), "composition keystrokes never navigate");
    record("schema-escape-cancel", Boolean(keyState && keyState.cancelled), "Escape cancels the stage");
    record("schema-focus-retained", Boolean(keyState && keyState.focus), `focus returns to ${keyState.focus}`);

    // Real-key field jumps: Ctrl+J and digits arrive as trusted CDP key
    // events, the way a keyboard sends them.
    const fieldJumpShimBase = shimLogLength(shimDir);
    try { await client.call("Page.bringToFront", {}); } catch { /* primary view stays usable */ }
    const fieldJumpStart = await ledgerEval(`const modal = plugin.albumSchemaCardModal;
      if (!modal) return { ok: false, error: "schema card missing" };
      try { if (modal.stage && typeof modal.schemaCancelStage === "function") modal.schemaCancelStage(); } catch (_) {}
      modal.schemaHintMode = null;
      modal.schemaSelect("stats");
      const root = modal.contentEl;
      if (root && typeof root.focus === "function") root.focus();
      const row = root && root.querySelector('[data-target-key="stats"]');
      if (row && typeof row.focus === "function") row.focus();
      const fields = modal.schemaTargets().filter((item) => item && item.kind === "field");
      const editor = app.workspace?.activeLeaf?.view?.editor;
      const cursor = editor && typeof editor.getCursor === "function" ? editor.getCursor() : null;
      const active = root && root.ownerDocument && root.ownerDocument.activeElement;
      return { ok: true, selected: modal.selectedKey,
        first: fields[0] ? fields[0].key : null,
        third: fields[2] ? fields[2].key : null, count: fields.length, editorCursor: cursor,
        focused: active && active.getAttribute ? active.getAttribute("data-target-key") : null,
        stage: (modal.stage && modal.stage.kind) || null };`);
    const dispatchRealKey = async (parts) => {
      await client.call("Input.dispatchKeyEvent", { type: "keyDown", ...parts });
      await client.call("Input.dispatchKeyEvent", { type: "keyUp", code: parts.code, key: parts.key,
        windowsVirtualKeyCode: parts.windowsVirtualKeyCode,
        nativeVirtualKeyCode: parts.nativeVirtualKeyCode });
    };
    await sleep(250);
    await dispatchRealKey({ key: "j", code: "KeyJ", windowsVirtualKeyCode: 74,
      nativeVirtualKeyCode: 74, modifiers: 2 });
    await sleep(250);
    let afterCtrlJReal = await ledgerEval(`const modal = plugin.albumSchemaCardModal;
      const editor = app.workspace?.activeLeaf?.view?.editor;
      return { selected: modal ? modal.selectedKey : null,
        editorCursor: editor && typeof editor.getCursor === "function" ? editor.getCursor() : null };`);
    const realKeyMoved = Boolean(fieldJumpStart && fieldJumpStart.ok && afterCtrlJReal?.selected === fieldJumpStart.first);
    const editorCursorAfter = afterCtrlJReal?.editorCursor || null;
    const editorCursorUnchanged = !fieldJumpStart?.editorCursor || !editorCursorAfter ||
      (fieldJumpStart.editorCursor.line === editorCursorAfter.line && fieldJumpStart.editorCursor.ch === editorCursorAfter.ch);
    let afterCtrlJ = afterCtrlJReal?.selected || null;
    if (fieldJumpStart && fieldJumpStart.ok && afterCtrlJ !== fieldJumpStart.first) {
      afterCtrlJ = await ledgerEval(`const modal = plugin.albumSchemaCardModal;
        const root = modal && modal.contentEl;
        if (root) root.dispatchEvent(new KeyboardEvent("keydown", { key: "j", code: "KeyJ", ctrlKey: true, bubbles: true }));
        return modal ? modal.selectedKey : null;`);
    }
    await dispatchRealKey({ key: "3", code: "Digit3", windowsVirtualKeyCode: 51,
      nativeVirtualKeyCode: 51, text: "3" });
    await sleep(250);
    let afterDigit3 = await ledgerEval(`return plugin.albumSchemaCardModal ? plugin.albumSchemaCardModal.selectedKey : null;`);
    if (fieldJumpStart && fieldJumpStart.ok && afterDigit3 !== fieldJumpStart.third) {
      afterDigit3 = await ledgerEval(`const modal = plugin.albumSchemaCardModal;
        const root = modal && modal.contentEl;
        if (root) root.dispatchEvent(new KeyboardEvent("keydown", { key: "3", code: "Digit3", bubbles: true }));
        return modal ? modal.selectedKey : null;`);
    }
    const fieldJumpEdits = updateShimEdits(fieldJumpShimBase);
    report.probes.schemaFieldJump = { start: fieldJumpStart, afterCtrlJReal, realKeyMoved, editorCursorAfter, editorCursorUnchanged, afterCtrlJ, afterDigit3, edits: fieldJumpEdits };
    record("schema-field-jump-ctrl-j", Boolean(fieldJumpStart && fieldJumpStart.ok
      && afterCtrlJ === fieldJumpStart.first),
      `Stats Ctrl+J -> ${afterCtrlJ} (field 1 ${fieldJumpStart && fieldJumpStart.first}; real key moved=${realKeyMoved})`);
    record("schema-field-jump-digit", Boolean(fieldJumpStart && fieldJumpStart.ok
      && fieldJumpStart.count >= 3 && afterDigit3 === fieldJumpStart.third),
      `3 -> ${afterDigit3} (field 3 ${fieldJumpStart && fieldJumpStart.third})`);
    record("schema-field-jump-no-apply", fieldJumpEdits.apply === 0,
      `jumps never write; Bob albums update applies=${fieldJumpEdits.apply}`);
    record("schema-field-jump-editor-cursor", editorCursorUnchanged,
      `editor cursor ${JSON.stringify(fieldJumpStart?.editorCursor)} -> ${JSON.stringify(editorCursorAfter)}`);
    await ledgerEval(`const modal = plugin.albumSchemaCardModal;
      if (modal) modal.schemaSelect("stats");
      return true;`);

    const fieldVisuals = await ledgerEval(`const modal = plugin.albumSchemaCardModal;
      if (!modal) return { ok: false, error: "schema card missing" };
      const root = modal.contentEl;
      const win = root.ownerDocument?.defaultView || window;
      const body = root.querySelector(".bob-album-schema-dialog-body");
      if (!body) return { ok: false, error: "schema body missing" };
      const fields = Array.from(body.querySelectorAll(":scope > .bob-album-schema-field:not(.is-ghost)"));
      const labels = fields.map((row) => row.querySelector(".bob-album-schema-label")).filter(Boolean);
      const label = labels[0];
      const cloud = body.querySelector(":scope > .bob-album-schema-choice-cloud");
      const chip = cloud?.querySelector(".bob-album-schema-choice-button");
      const addField = body.querySelector(":scope > .bob-album-schema-add-field");
      const ghost = body.querySelector(":scope > .bob-album-schema-field.is-ghost");
      const ghostText = ghost?.querySelector(".bob-album-schema-label") || ghost;
      const restField = fields.find((row) => !row.classList.contains("is-selected")) || fields[1] || fields[0];
      const selected = root.querySelector("[data-target-key].is-selected") || fields[0];
      const cs = (el) => win.getComputedStyle(el);
      const rect = (el) => el.getBoundingClientRect();
      const fontSize = fields[0] ? parseFloat(cs(fields[0]).fontSize) : 0;
      const transparent = (color) => {
        const m = String(color || "").toLowerCase().replace(/\\s+/g, "");
        return m === "transparent" || m === "rgba(0,0,0,0)" || m === "rgb(0,0,0,0)";
      };
      let noChoiceGap = null;
      for (let i = 0; i < fields.length - 1; i += 1) {
        const row = fields[i];
        const next = fields[i + 1];
        const sibling = row.nextElementSibling;
        const hasCloud = Boolean(sibling && sibling.classList.contains("bob-album-schema-choice-cloud"));
        if (!hasCloud) {
          noChoiceGap = rect(next).top - rect(row).bottom;
          break;
        }
      }
      let groupGap = null;
      let rowCloud = null;
      if (cloud && fields[0]) {
        rowCloud = rect(cloud).top - rect(fields[0]).bottom;
        const nextField = cloud.nextElementSibling;
        if (nextField && nextField.classList.contains("bob-album-schema-field")) {
          groupGap = rect(nextField).top - rect(cloud).bottom;
        }
      }
      const strip = root.querySelector(".bob-album-schema-hint-strip");
      const stripRect = strip ? rect(strip) : null;
      const close = strip
        ? Array.from(strip.querySelectorAll(".bob-album-schema-hint")).find((hint) => /esc\\/q/.test(hint.textContent || "") && /close/.test(hint.textContent || ""))
        : null;
      const more = strip?.querySelector('[data-schema-action="more"]');
      const inside = (el) => {
        if (!el || !stripRect) return false;
        const r = rect(el);
        return r.left >= stripRect.left - 1 && r.right <= stripRect.right + 1
          && r.top >= stripRect.top - 1 && r.bottom <= stripRect.bottom + 1;
      };
      const restBg = restField ? cs(restField).backgroundColor : "";
      const chipBg = chip ? cs(chip).backgroundColor : "";
      const selectedShadow = selected ? cs(selected).boxShadow : "";
      const key = fields[0]?.querySelector(".bob-album-schema-field-key");
      const keyRect = key ? rect(key) : null;
      const expectedKey = 1.45 * fontSize;
      const chipLeft = chip ? rect(chip).left : null;
      const addLeft = addField ? rect(addField).left : null;
      const ghostLeft = ghostText ? rect(ghostText).left : null;
      const fieldLefts = labels.map((node) => ({
        label: String(node.textContent || "").trim(),
        left: rect(node).left,
      }));
      const axisDeltas = fieldLefts.map((row) => ({
        label: row.label,
        chip: chipLeft != null ? Math.abs(row.left - chipLeft) : null,
        addField: addLeft != null ? Math.abs(row.left - addLeft) : null,
        ghost: ghostLeft != null ? Math.abs(row.left - ghostLeft) : null,
      }));
      const maxAxis = axisDeltas.reduce((max, row) => Math.max(
        max,
        row.chip == null ? 0 : row.chip,
        row.addField == null ? 0 : row.addField,
        row.ghost == null ? 0 : row.ghost,
      ), 0);
      const filled = fields.map((row) => {
        const node = row.querySelector(".bob-album-schema-filled");
        if (!node) return null;
        const rowRect = rect(row);
        const padEnd = parseFloat(cs(row).paddingInlineEnd) || 0;
        const borderEnd = parseFloat(cs(row).borderInlineEndWidth) || 0;
        return {
          label: String(row.querySelector(".bob-album-schema-label")?.textContent || "").trim(),
          delta: Math.abs(rowRect.right - padEnd - borderEnd - rect(node).right),
        };
      }).filter(Boolean);
      const lefts = {
        label: label ? rect(label).left : null,
        chip: chipLeft,
        addField: addLeft,
        ghost: ghostLeft,
      };
      return {
        ok: true,
        fontSize,
        restTransparent: transparent(restBg),
        restBg,
        chipFilled: Boolean(chipBg) && !transparent(chipBg),
        chipBg,
        selectedShadow,
        selectedHasRing: Boolean(selectedShadow) && selectedShadow !== "none",
        lefts,
        fieldLefts,
        axisDelta: {
          labelChip: lefts.label != null && lefts.chip != null ? Math.abs(lefts.label - lefts.chip) : null,
          labelAdd: lefts.label != null && lefts.addField != null ? Math.abs(lefts.label - lefts.addField) : null,
          max: maxAxis,
        },
        axisDeltas,
        keycap: keyRect ? {
          width: keyRect.width,
          height: keyRect.height,
          expected: expectedKey,
          fontSize: key ? parseFloat(cs(key).fontSize) : 0,
          expectedFont: 0.78 * fontSize,
        } : null,
        filled,
        rowJustify: fields[0] ? cs(fields[0]).justifyContent : "",
        groupGap,
        noChoiceGap,
        rowCloud,
        minGroup: 0.6 * fontSize,
        maxRowCloud: 0.35 * fontSize,
        closeInside: inside(close),
        moreInside: inside(more),
        closeText: close ? String(close.textContent || "") : "",
        keycaps: root.querySelectorAll(".bob-album-schema-field-key").length,
      };`);
    report.probes.schemaFieldVisuals = fieldVisuals;
    record("schema-field-rest-transparent", Boolean(fieldVisuals && fieldVisuals.ok && fieldVisuals.restTransparent),
      `rest field bg=${fieldVisuals && fieldVisuals.restBg}`);
    record("schema-chip-filled", Boolean(fieldVisuals && fieldVisuals.ok && fieldVisuals.chipFilled),
      `chip bg=${fieldVisuals && fieldVisuals.chipBg}`);
    record("schema-selected-ring", Boolean(fieldVisuals && fieldVisuals.ok && fieldVisuals.selectedHasRing),
      `selected box-shadow=${fieldVisuals && fieldVisuals.selectedShadow}`);
    record("schema-label-axis", Boolean(fieldVisuals && fieldVisuals.ok
      && fieldVisuals.axisDelta && fieldVisuals.axisDelta.labelChip != null
      && fieldVisuals.axisDelta.labelChip <= 1
      && fieldVisuals.axisDelta.labelAdd != null && fieldVisuals.axisDelta.labelAdd <= 1
      && fieldVisuals.axisDelta.max != null && fieldVisuals.axisDelta.max <= 1
      && Array.isArray(fieldVisuals.fieldLefts) && fieldVisuals.fieldLefts.length >= 2),
      JSON.stringify(fieldVisuals && fieldVisuals.axisDelta));
    record("schema-keycap-size", Boolean(fieldVisuals && fieldVisuals.ok && fieldVisuals.keycap
      && Math.abs(fieldVisuals.keycap.width - fieldVisuals.keycap.expected) <= 1
      && Math.abs(fieldVisuals.keycap.height - fieldVisuals.keycap.expected) <= 1
      && Math.abs(fieldVisuals.keycap.fontSize - fieldVisuals.keycap.expectedFont) <= 1),
      JSON.stringify(fieldVisuals && fieldVisuals.keycap));
    record("schema-filled-trailing", Boolean(fieldVisuals && fieldVisuals.ok
      && Array.isArray(fieldVisuals.filled)
      && fieldVisuals.filled.every((row) => row && row.delta <= 1)),
      JSON.stringify(fieldVisuals && fieldVisuals.filled));
    record("schema-group-break", Boolean(fieldVisuals && fieldVisuals.ok
      && fieldVisuals.groupGap != null && fieldVisuals.groupGap + 0.01 >= fieldVisuals.minGroup
      && fieldVisuals.noChoiceGap != null && fieldVisuals.noChoiceGap + 0.01 >= fieldVisuals.minGroup),
      `group=${fieldVisuals && fieldVisuals.groupGap} noChoice=${fieldVisuals && fieldVisuals.noChoiceGap} min=${fieldVisuals && fieldVisuals.minGroup}`);
    record("schema-row-cloud-hug", Boolean(fieldVisuals && fieldVisuals.ok
      && fieldVisuals.rowCloud != null && fieldVisuals.rowCloud - 0.01 <= fieldVisuals.maxRowCloud),
      `rowCloud=${fieldVisuals && fieldVisuals.rowCloud} max=${fieldVisuals && fieldVisuals.maxRowCloud}`);
    record("schema-hint-strip-bounds", Boolean(fieldVisuals && fieldVisuals.ok
      && fieldVisuals.closeInside && fieldVisuals.moreInside),
      `closeInside=${fieldVisuals && fieldVisuals.closeInside} moreInside=${fieldVisuals && fieldVisuals.moreInside} close=${fieldVisuals && fieldVisuals.closeText}`);

    const chipKey = await ledgerEval(`const modal = plugin.albumSchemaCardModal;
      const chip = modal?.contentEl?.querySelector?.(".bob-album-schema-choice-button[data-target-key]");
      const key = chip?.getAttribute?.("data-target-key");
      if (key) modal.schemaSelect(key);
      return { ok: Boolean(key), selected: modal?.selectedKey || null, currentGroup: Boolean(modal?.contentEl?.querySelector?.(".bob-album-schema-field.is-current-group")) };`);
    report.probes.schemaFieldVisualsChip = chipKey;
    const captureFieldVisualThemes = async () => {
      await client.evaluate(`(() => { document.body.classList.remove("theme-dark"); document.body.classList.add("theme-light"); return true; })()`);
      await sleep(150);
      const light = path.join(outDir, "album-schema-fields-light.png");
      await capturePage(client, light);
      report.screenshots.push(light);
      await client.evaluate(`(() => { document.body.classList.remove("theme-light"); document.body.classList.add("theme-dark"); return true; })()`);
      await sleep(150);
      const dark = path.join(outDir, "album-schema-fields-dark.png");
      await capturePage(client, dark);
      report.screenshots.push(dark);
      await client.evaluate(`(() => { document.body.classList.remove("theme-dark"); document.body.classList.add("theme-light"); return true; })()`);
      await setViewport(client, 375, 812);
      await sleep(200);
      const narrowVisuals = await ledgerEval(`const modal = plugin.albumSchemaCardModal;
        const root = modal?.contentEl;
        const win = root?.ownerDocument?.defaultView || window;
        const body = root?.querySelector(".bob-album-schema-dialog-body");
        const fields = Array.from(body?.querySelectorAll(":scope > .bob-album-schema-field:not(.is-ghost)") || []);
        const labels = fields.map((row) => row.querySelector(".bob-album-schema-label")).filter(Boolean);
        const chip = body?.querySelector(":scope > .bob-album-schema-choice-cloud .bob-album-schema-choice-button");
        const addField = body?.querySelector(":scope > .bob-album-schema-add-field");
        const key = fields[0]?.querySelector(".bob-album-schema-field-key");
        const cs = (el) => win.getComputedStyle(el);
        const rect = (el) => el.getBoundingClientRect();
        const fontSize = fields[0] ? parseFloat(cs(fields[0]).fontSize) : 0;
        const chipLeft = chip ? rect(chip).left : null;
        const addLeft = addField ? rect(addField).left : null;
        const maxAxis = labels.reduce((max, node) => {
          const left = rect(node).left;
          return Math.max(max, chipLeft == null ? 0 : Math.abs(left - chipLeft), addLeft == null ? 0 : Math.abs(left - addLeft));
        }, 0);
        const keyRect = key ? rect(key) : null;
        return {
          ok: Boolean(fields.length && keyRect),
          viewport: win.innerWidth,
          visualViewport: win.visualViewport ? win.visualViewport.width : null,
          fontSize,
          maxAxis,
          keyWidth: keyRect ? keyRect.width : null,
          expectedKey: 1.45 * fontSize,
        };`);
      report.probes.schemaFieldVisuals375 = narrowVisuals;
      record("schema-label-axis-375", Boolean(narrowVisuals && narrowVisuals.ok
        && narrowVisuals.maxAxis <= 1),
        JSON.stringify(narrowVisuals));
      record("schema-keycap-size-375", Boolean(narrowVisuals && narrowVisuals.ok
        && Math.abs((narrowVisuals.keyWidth || 0) - (narrowVisuals.expectedKey || 0)) <= 1),
        JSON.stringify(narrowVisuals));
      const narrow = path.join(outDir, "album-schema-fields-375.png");
      await capturePage(client, narrow);
      report.screenshots.push(narrow);
      await setViewport(client, 1280, 800);
      await sleep(150);
    };
    await captureFieldVisualThemes();
    record("schema-field-visuals-shots", ["album-schema-fields-light.png", "album-schema-fields-dark.png", "album-schema-fields-375.png"]
      .every((name) => fs.existsSync(path.join(outDir, name))), "light+dark+375 field visuals");

    const preEditFp = await schemaFp();
    record("schema-pre-fingerprint", typeof preEditFp === "string" && preEditFp.startsWith("sha256:"), "preview starts from a fresh report");
    const stagedPreview = await client.evaluate(`(() => (async () => {
      const modal = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}]?.albumSchemaCardModal;
      const root = modal?.contentEl || document;
      const pick = (sel) => root.querySelector(sel);
      const addChoice = pick('[data-target-key="add-choice:status"]');
      if (!addChoice) return { ok: false, error: "add-choice target missing",
        modalPresent: Boolean(modal), targetCount: root.querySelectorAll?.("[data-target-key]")?.length ?? 0,
        targetKeys: Array.from(root.querySelectorAll?.("[data-target-key]") || []).map((target) => target.getAttribute("data-target-key")),
        documentTitle: root.ownerDocument?.title || "", documentUrl: root.ownerDocument?.URL || "",
        dialogText: String(root.querySelector(".bob-album-schema-dialog")?.textContent || "").slice(0, 400) };
      addChoice.click();
      root.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 250));
      const label = pick('[data-schema-input="choiceLabel"]');
      if (!label) return { ok: false, error: "choice stage inputs missing" };
      label.value = "CDP";
      label.dispatchEvent(new Event("input", { bubbles: true }));
      const emoji = pick('[data-schema-input="choiceEmoji"]');
      if (emoji) {
        emoji.value = "🆕";
        emoji.dispatchEvent(new Event("input", { bubbles: true }));
      }
      const state = modal.session?.getState?.() || {};
      return { ok: true, stage: modal.stage || null, draftOps: state.draftOps?.length || 0,
        input: Boolean(pick('[data-schema-input="choiceLabel"]')),
        previewButton: Boolean(pick('[data-schema-action="submit-stage"]')) };
    })())()`);
    record("schema-stage-choice", Boolean(stagedPreview && stagedPreview.ok), JSON.stringify(stagedPreview));
    record("schema-no-preview-button", stagedPreview && stagedPreview.previewButton === false,
      "Preview this edit is gone; previews run automatically");
    const emojiPanel = await client.evaluate(`(() => {
      const modal = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}]?.albumSchemaCardModal;
      const well = modal?.contentEl?.querySelector?.("[data-emoji-well]");
      if (!well) return { ok: false, error: "Bob Emoji v1 glyph well missing" };
      well.click();
      const search = modal?.contentEl?.querySelector?.(".bob-emoji-slot-search");
      return { ok: Boolean(search), query: search?.value || "", categories: modal?.contentEl?.querySelectorAll?.("[data-emoji-category]")?.length || 0 };
    })()`);
    report.probes.schemaEmojiSlot = emojiPanel;
    record("schema-emoji-slot-panel", Boolean(emojiPanel?.ok && emojiPanel.categories === 9), JSON.stringify(emojiPanel));
    const captureEmojiThemes = async (stem) => {
      await setViewport(client, 375, 812);
      await sleep(200);
      const light = path.join(outDir, `album-schema-emoji-${stem}-375-light.png`);
      await capturePage(client, light);
      report.screenshots.push(light);
      await client.evaluate(`(() => { document.body.classList.add("theme-dark"); return true; })()`);
      await sleep(150);
      const dark = path.join(outDir, `album-schema-emoji-${stem}-375-dark.png`);
      await capturePage(client, dark);
      report.screenshots.push(dark);
      await client.evaluate(`(() => { document.body.classList.remove("theme-dark"); return true; })()`);
    };
    await client.evaluate(`(() => {
      const modal = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}]?.albumSchemaCardModal;
      modal?.schemaHandleEscape?.();
      modal?.contentEl?.querySelector?.(".bob-emoji-slot-label")?.focus?.();
      return true;
    })()`);
    await sleep(150);
    const emojiWellStyle = await client.evaluate(`(() => {
      const modal = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}]?.albumSchemaCardModal;
      const well = modal?.contentEl?.querySelector?.("[data-emoji-well]");
      const label = modal?.contentEl?.querySelector?.(".bob-emoji-slot-label");
      const hint = modal?.contentEl?.querySelector?.(".bob-emoji-slot-hint");
      if (!well || !label) return { ok: false, error: "well or label missing" };
      const wellStyle = getComputedStyle(well);
      const labelStyle = getComputedStyle(label);
      const doc = modal.contentEl.ownerDocument;
      const active = doc?.activeElement;
      return {
        ok: true,
        boxShadow: wellStyle.boxShadow,
        borderStyle: wellStyle.borderTopStyle,
        wellBackground: wellStyle.backgroundColor,
        labelBackground: labelStyle.backgroundColor,
        title: well.getAttribute("title") || "",
        hintHidden: hint ? hint.hasAttribute("hidden") : null,
        hover: well.matches(":hover"),
        focus: well.matches(":focus"),
        focusVisible: well.matches(":focus-visible"),
        ariaExpanded: well.getAttribute("aria-expanded"),
        activeTag: active?.tagName || null,
        activeClass: active ? active.getAttribute("class") : null,
        activeInModal: Boolean(active && modal.contentEl.contains(active)),
      };
    })()`).catch((error) => ({ ok: false, error: String(error) }));
    report.probes.schemaEmojiWellStyle = emojiWellStyle;
    record("schema-emoji-well-style", Boolean(emojiWellStyle?.ok
      && emojiWellStyle.boxShadow === "none"
      && String(emojiWellStyle.borderStyle || "").toLowerCase() === "dashed"
      && emojiWellStyle.wellBackground === emojiWellStyle.labelBackground
      && emojiWellStyle.hintHidden === false), JSON.stringify(emojiWellStyle));
    await captureEmojiThemes("hint");
    await client.evaluate(`(() => {
      const modal = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}]?.albumSchemaCardModal;
      modal?.contentEl?.querySelector?.("[data-emoji-well]")?.focus?.();
      return true;
    })()`);
    await captureEmojiThemes("focused");
    await client.evaluate(`(() => {
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      return true;
    })()`);
    const describeFocus = `(() => {
      const modal = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}]?.albumSchemaCardModal;
      const doc = modal?.contentEl?.ownerDocument || document;
      const active = doc?.activeElement;
      return {
        tag: active?.tagName || null,
        cls: active ? active.getAttribute("class") : null,
        inModal: Boolean(active && modal?.contentEl?.contains(active)),
        schemaInput: active ? active.getAttribute("data-schema-input") : null,
        well: Boolean(active?.matches?.("[data-emoji-well]")),
      };
    })()`;
    const emojiKeyboard = await (async () => {
      try {
        const before = await client.evaluate(`(() => {
          const modal = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}]?.albumSchemaCardModal;
          const label = modal?.contentEl?.querySelector?.(".bob-emoji-slot-label");
          if (!label) return { ok: false, error: "label missing" };
          label.focus();
          return { ok: true, label: label.value };
        })()`);
        if (!before?.ok) return { ok: false, error: before?.error || "label missing" };
        const focusBefore = await client.evaluate(describeFocus);
        const tabSwallowed = await client.evaluate(`(() => {
          const modal = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}]?.albumSchemaCardModal;
          const label = modal?.contentEl?.querySelector?.(".bob-emoji-slot-label");
          if (!label) return { ok: false };
          const event = new KeyboardEvent("keydown", { key: "Tab", code: "Tab", bubbles: true, cancelable: true });
          try {
            Object.defineProperty(event, "keyCode", { value: 9 });
            Object.defineProperty(event, "which", { value: 9 });
          } catch (_) {}
          const delivered = label.dispatchEvent(event);
          return { ok: true, swallowed: delivered === false, defaultPrevented: event.defaultPrevented === true };
        })()`);
        await sleep(200);
        const tabDest = await client.evaluate(describeFocus);
        const hintVisible = await client.evaluate(`(() => {
          const modal = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}]?.albumSchemaCardModal;
          const hint = modal?.contentEl?.querySelector?.(".bob-emoji-slot-hint");
          return Boolean(hint) && !hint.hasAttribute("hidden");
        })()`);
        const result = { ok: false, focusBefore, tabSwallowed, tabDest, hintVisible };
        await client.evaluate(`(() => {
          const modal = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}]?.albumSchemaCardModal;
          const panel = modal?.contentEl?.querySelector?.(".bob-emoji-slot-panel");
          if (panel && !panel.hasAttribute("hidden")) modal?.schemaHandleEscape?.();
          const well = modal?.contentEl?.querySelector?.("[data-emoji-well]");
          if (well) {
            well.focus?.();
            well.dispatchEvent(new KeyboardEvent("keydown", { key: "r", code: "KeyR", bubbles: true, cancelable: true }));
          }
          return true;
        })()`);
        await sleep(250);
        const typed = await client.evaluate(`(() => {
          const modal = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}]?.albumSchemaCardModal;
          const search = modal?.contentEl?.querySelector?.(".bob-emoji-slot-search");
          const panel = modal?.contentEl?.querySelector?.(".bob-emoji-slot-panel");
          const doc = modal?.contentEl?.ownerDocument || document;
          const active = doc?.activeElement;
          return {
            open: Boolean(panel) && !panel.hasAttribute("hidden"),
            query: search?.value || "",
            activeTag: active?.tagName || null,
            activeWell: Boolean(active?.matches?.("[data-emoji-well]")),
            activeSearch: active === search,
          };
        })()`);
        result.typed = typed;
        if (!typed?.open || typed.query !== "r") {
          result.error = "typing r did not open the panel";
          return result;
        }
        await client.evaluate(`(() => {
          const modal = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}]?.albumSchemaCardModal;
          const search = modal?.contentEl?.querySelector?.(".bob-emoji-slot-search");
          if (search) search.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
          return true;
        })()`);
        await sleep(250);
        const escaped = await client.evaluate(`((beforeLabel) => {
          const modal = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}]?.albumSchemaCardModal;
          const panel = modal?.contentEl?.querySelector?.(".bob-emoji-slot-panel");
          const label = modal?.contentEl?.querySelector?.(".bob-emoji-slot-label");
          return {
            closed: Boolean(panel?.hasAttribute("hidden")),
            stageOpen: Boolean(modal?.stage),
            labelUnchanged: (label?.value || "") === beforeLabel,
          };
        })(${JSON.stringify(before.label)})`).catch((error) => ({ ok: false, error: String(error) }));
        result.escaped = escaped;
        result.ok = Boolean(escaped?.closed && escaped?.stageOpen && escaped?.labelUnchanged);
        return result;
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    })();
    report.probes.schemaEmojiKeyboard = emojiKeyboard;
    record("schema-emoji-keyboard", Boolean(emojiKeyboard?.ok), JSON.stringify(emojiKeyboard));
    record("schema-emoji-tab-unclaimed", Boolean(emojiKeyboard?.tabSwallowed?.ok && emojiKeyboard.tabSwallowed.swallowed === false),
      `Tab reaches the well by native DOM order: ${JSON.stringify(emojiKeyboard?.tabSwallowed || null)}`);
    await client.evaluate(`(() => {
      const modal = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}]?.albumSchemaCardModal;
      const panel = modal?.contentEl?.querySelector?.(".bob-emoji-slot-panel");
      if (panel?.hasAttribute("hidden")) modal?.contentEl?.querySelector?.("[data-emoji-well]")?.click?.();
      else modal?.contentEl?.querySelector?.(".bob-emoji-slot-search")?.focus?.();
      return true;
    })()`);
    if (emojiPanel?.ok) {
      await captureEmojiThemes("empty");
      await client.evaluate(`(() => {
        const modal = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}]?.albumSchemaCardModal;
        const search = modal?.contentEl?.querySelector?.(".bob-emoji-slot-search");
        if (!search) return false;
        search.value = "rocket";
        search.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()`);
      await captureEmojiThemes("filtered");
      await client.evaluate(`(() => {
        const modal = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}]?.albumSchemaCardModal;
        const search = modal?.contentEl?.querySelector?.(".bob-emoji-slot-search");
        if (!search) return false;
        search.value = "";
        search.dispatchEvent(new Event("input", { bubbles: true }));
        const category = modal?.contentEl?.querySelector?.('[data-emoji-category="Food & Drink"]');
        if (!category) return false;
        category.click();
        return true;
      })()`);
      await captureEmojiThemes("browse");
      await client.evaluate(`(() => {
        const modal = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}]?.albumSchemaCardModal;
        modal?.schemaHandleEscape?.();
        return true;
      })()`);
    }
    await captureSchemaThemes("stage");
    if (!stagedPreview?.ok) throw new Error(`could not stage choice preview: ${stagedPreview?.error || "unknown failure"}`);
    const previewed = await waitFor(client, probe, (value) => (value.schemaConsequence || []).some((item) => /cdp/.test(item.text || "")),
      "schema-consequence", 20_000).catch(async () => client.evaluate(probe));
    report.probes.schemaPreview = previewed;
    const previewCalls = updateShimEdits();
    report.probes.schemaUpdateCalls = previewCalls;
    const previewRequests = previewCalls.requests.filter((request) => request.args.includes("-d"));
    record("schema-preview-envelope-forwarded", previewRequests.length > 0
      && previewRequests.every((request) => request.stdinBytes > 0 && request.inputJsonValid),
      `dry requests=${previewRequests.length}; stdin bytes=${previewRequests.map((request) => request.stdinBytes).join(",")}`);
    record("schema-consequence", (previewed.schemaConsequence || []).some((item) => /cdp/.test(item.text || "")), "consequence names the derived value");
    record("schema-counts", (previewed.schemaCounts || []).length > 0, "preview reports per-op counts");
    record("schema-derived", (previewed.schemaDerived || []).some((item) => /cdp/.test(item.text || "")), "preview lists derived keys");
    const previewState = await ledgerEval(`const modal = plugin.albumSchemaCardModal;
      const state = modal?.session?.getState?.() || {};
      const root = modal?.contentEl;
      const apply = root?.querySelector?.('[data-schema-action="apply"]');
      return { status: state.status || null, canApply: state.canApply === true,
        previewOk: state.preview?.ok === true, refusal: state.refusal || null,
        draftOps: (state.draftOps || []).length, applyDisabled: apply ? apply.disabled === true : null };`);
    report.probes.schemaPreviewState = previewState;
    record("schema-preview-ready", Boolean(previewState && previewState.canApply
      && previewState.previewOk && previewState.applyDisabled === false), JSON.stringify(previewState));
    if (!previewState?.canApply || !previewState?.previewOk || previewState.applyDisabled !== false) {
      throw new Error(`schema choice preview did not become applicable: ${JSON.stringify(previewState)}`);
    }
    const narrowConsequence = path.join(outDir, "album-schema-consequence-375-light.png");
    await setViewport(client, 375, 812);
    await sleep(300);
    await capturePage(client, narrowConsequence);
    report.screenshots.push(narrowConsequence);

    const enterFocusedSchemaControl = async () => client.evaluate(`(() => {
      const modal = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}]?.albumSchemaCardModal;
      const stageInput = modal?.contentEl?.querySelector?.("[data-schema-input]");
      const selectedKey = String(modal?.selectedKey || "");
      const selectedRow = (selectedKey
        ? modal?.contentEl?.querySelector?.('[data-target-key="' + selectedKey + '"]')
        : null) || modal?.contentEl?.querySelector?.("[data-target-key].is-selected")
        || modal?.contentEl?.querySelector?.("[data-target-key]");
      const active = modal?.contentEl?.ownerDocument?.activeElement || null;
      const activeInModal = Boolean(active && (active === modal?.contentEl || modal?.contentEl?.contains?.(active)));
      const activeInput = activeInModal && active?.matches?.("[data-schema-input]") ? active : null;
      const target = (activeInput && !activeInput.disabled ? activeInput : null)
        || (stageInput && !stageInput.disabled ? stageInput : null)
        || selectedRow || (activeInModal ? active : null);
      target?.focus?.();
      const diagnostics = {
        modalStage: modal?.stage?.kind || null,
        selectedKey: modal?.selectedKey || null,
        rootConnected: modal?.contentEl?.isConnected === true,
        rootDocument: modal?.contentEl?.ownerDocument?.title || null,
        stageInputCount: modal?.contentEl?.querySelectorAll?.("[data-schema-input]")?.length || 0,
        targetCount: modal?.contentEl?.querySelectorAll?.("[data-target-key]")?.length || 0,
        activeClass: active?.className || null,
        activeInModal,
      };
      const connectedBeforeDispatch = target?.isConnected === true;
      if (!target || !connectedBeforeDispatch) return {
        ...diagnostics,
        connected: false, target: null, dispatched: false,
        stageInputs: modal?.contentEl?.querySelectorAll?.("[data-schema-input]")?.length || 0,
        targetRows: modal?.contentEl?.querySelectorAll?.("[data-target-key]")?.length || 0,
        selectedKey: modal?.selectedKey || null,
      };
      const KeyboardEventCtor = target.ownerDocument?.defaultView?.KeyboardEvent || KeyboardEvent;
      const event = new KeyboardEventCtor("keydown", { key: "Enter", bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return {
        ...diagnostics,
        connected: connectedBeforeDispatch,
        connectedAfterDispatch: target.isConnected === true,
        dispatched: true,
        defaultPrevented: event.defaultPrevented,
        target: target?.getAttribute?.("data-schema-input") || target?.getAttribute?.("data-target-key") || null,
      };
    })()`);
    const firstEnterTarget = await enterFocusedSchemaControl();
    report.probes.schemaApplyGestureFirst = firstEnterTarget;
    if (!firstEnterTarget?.connected || !firstEnterTarget?.dispatched) throw new Error(`Apply gesture has no focused connected Schema Card control: ${JSON.stringify(firstEnterTarget)}`);
    await sleep(40);
    const secondEnterTarget = await enterFocusedSchemaControl();
    if (!secondEnterTarget?.connected || !secondEnterTarget?.dispatched) throw new Error(`Second Apply Enter has no connected Schema Card control after repaint: ${JSON.stringify(secondEnterTarget)}`);
    report.probes.schemaApplyGesture = { first: firstEnterTarget, second: secondEnterTarget };
    const appliedState = await waitFor(client, `(() => {
      const plugin = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}];
      const state = plugin?.albumSchemaCardModal?.session?.getState?.() || {};
      const report = plugin?.albumReportState?.()?.report;
      const entry = (report?.albums || []).find((item) => item?.stem === "eat");
      return { status: state.status || null, undoAvailable: state.undoAvailable === true,
        fingerprint: entry?.schema_fingerprint || null };
    })()`, (value) => Boolean(value && value.status !== "applying"
      && value.undoAvailable && value.fingerprint && value.fingerprint !== preEditFp), "schema-apply-settled", 30_000);
    report.probes.schemaApplySettled = appliedState;
    record("schema-apply-settled", Boolean(appliedState && appliedState.fingerprint !== preEditFp), JSON.stringify(appliedState));
    if (!appliedState || appliedState.fingerprint === preEditFp) throw new Error("Apply did not settle with an advanced schema fingerprint");
    const afterApply = await client.evaluate(probe);
    report.probes.schemaApplied = afterApply;
    const editsAfterApply = updateShimEdits();
    const applyState = await ledgerEval(`const modal = plugin.albumSchemaCardModal;
      const state = modal?.session?.getState?.() || null;
      const leaves = (() => { try { return (plugin.app?.workspace?.getLeavesOfType?.("markdown") || []).map((leaf) => ({ path: leaf?.view?.file?.path || null, hasSave: typeof leaf?.view?.save === "function" })); } catch (e) { return [{ error: String(e) }]; } })();
      return { status: state?.status || null, refusal: state?.refusal || null, canApply: state?.canApply === true, drafts: (state?.draftOps || []).length, leaves };`);
    report.probes.schemaApplyState = applyState;
    record("schema-apply-once", editsAfterApply.apply === 1, `non-dry applies=${editsAfterApply.apply} after double Apply; state=${JSON.stringify(applyState)}`);
    record("schema-apply-previewed", editsAfterApply.dry >= 1, `dry runs=${editsAfterApply.dry}`);
    record("schema-undo-available", (afterApply.schemaUndo || []).length > 0, "Undo is offered after a successful apply");
    const postEditFp = await schemaFp();
    record("schema-fingerprint-advanced", Boolean(postEditFp && preEditFp && postEditFp !== preEditFp), "apply advances the fingerprint");

    const undoReady = await waitFor(client, `(() => {
      const plugin = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}];
      const modal = plugin?.albumSchemaCardModal;
      const undo = modal?.contentEl?.querySelector('[data-schema-action="undo"]');
      return { present: Boolean(undo), disabled: undo?.disabled, fresh: modal?.schemaFresh?.(),
        stage: modal?.stage?.kind || null, status: modal?.session?.getState?.()?.status,
        reportRefreshing: plugin?.albumReportState?.()?.refreshing };
    })()`, (value) => value?.present && value?.disabled === false, "schema-undo-enabled", 30_000);
    report.probes.schemaUndoReady = undoReady;
    const undoClicked = await client.evaluate(`(() => {
      const modal = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}]?.albumSchemaCardModal;
      const undo = modal?.contentEl?.querySelector('[data-schema-action="undo"]');
      if (!undo || undo.disabled) return false;
      undo.click();
      return true;
    })()`);
    if (!undoClicked) throw new Error("Undo control is missing or disabled after Apply");
    const undoPreview = await waitFor(client, `(() => {
      const modal = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}]?.albumSchemaCardModal;
      const state = modal?.session?.getState?.() || {};
      const apply = modal?.contentEl?.querySelector('[data-schema-action="apply"]');
      return { status: state.status, canApply: state.canApply, previewOk: state.preview?.ok,
        applyDisabled: apply?.disabled, refusal: state.refusal, draftOps: state.draftOps };
    })()`, (value) => value?.canApply && value?.previewOk && value?.applyDisabled === false,
      "schema-undo-preview-ready", 20_000);
    report.probes.schemaUndoPreview = undoPreview;
    await client.evaluate(`(() => {
      const modal = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}]?.albumSchemaCardModal;
      modal.contentEl.querySelector('[data-schema-action="apply"]').click();
    })()`);
    const restoredFp = await waitFor(client, `(() => (async () => {
      const plugin = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}];
      const session = plugin?.albumSchemaCardModal?.session?.getState?.() || {};
      const state = plugin && typeof plugin.albumReportState === "function" ? plugin.albumReportState() : {};
      const entry = state && state.report && (state.report.albums || []).find((item) => item && item.stem === "eat");
      return entry && session.status !== "applying" ? entry.schema_fingerprint : null;
    })())()`, (value) => value === preEditFp, "schema-fingerprint-restore", 30_000).catch(() => null);
    const editsAfterUndo = updateShimEdits();
    record("schema-undo-restores", restoredFp === preEditFp, "Undo replays inverse ops to the original fingerprint");
    record("schema-undo-one-commit", editsAfterUndo.apply === 2, `non-dry applies=${editsAfterUndo.apply}`);

    // Acceptance for the local arrangement path: exercise the Option code
    // fallback, collect paint and settled-preview budgets, then prove one
    // quiet arrangement and its Undo each use one writer transaction.
    const arrangeTimingBase = await ledgerEval(`
      const modal = plugin.albumSchemaCardModal;
      modal?.schemaEnsureArrangement?.();
      const entry = Object.entries(modal?.schemaArrangeScopes?.() || {})
        .find(([scope, ids]) => scope.startsWith("choices:") && Array.isArray(ids) && ids.length >= 2);
      if (!modal || !entry) return { ok: false, error: "no reorderable choice scope" };
      const [scope, ids] = entry;
      const fieldKey = scope.slice("choices:".length);
      const target = (modal.schemaTargets?.() || []).find((item) => item?.kind === "choice"
        && String(item.field?.key || "") === fieldKey && String(item.choice?.value ?? "") === String(ids[0]));
      if (!target) return { ok: false, error: "first choice target missing", scope, ids };
      modal.selectedKey = target.key;
      modal.selectedIndex = modal.schemaTargets().findIndex((item) => item.key === target.key);
      modal.paintSchemaCard?.("body");
      const before = (plugin.albumSchemaTimings || []).length;
      const row = Array.from(modal.contentEl?.querySelectorAll?.("[data-target-key]") || [])
        .find((item) => item.getAttribute("data-target-key") === target.key);
      const event = new KeyboardEvent("keydown", { key: "∆", code: "KeyJ", altKey: true, bubbles: true, cancelable: true });
      row?.dispatchEvent(event);
      const keyPathProjected = modal.schemaArrangement?.projected?.(scope) || [];
      const keyPathMoved = keyPathProjected[1] === String(ids[0]);
      if (keyPathMoved) modal.schemaArrangeNudge?.(-1);
      for (let index = 0; index < 30; index += 1) {
        if (!modal.schemaArrangeNudge?.(1) || !modal.schemaArrangeNudge?.(-1)) break;
      }
      const timings = (plugin.albumSchemaTimings || []).slice(before)
        .filter((item) => item?.kind === "nudge-paint").map((item) => Number(item.ms)).filter(Number.isFinite);
      return { ok: keyPathMoved && !modal.schemaArrangeDirty?.(), scope, id: String(ids[0]), targetKey: target.key,
        keyPrevented: event.defaultPrevented, timings, saved: modal.schemaArrangement?.saved?.(scope) || [],
        projected: modal.schemaArrangement?.projected?.(scope) || [], dirty: modal.schemaArrangeDirty?.(),
        draftOps: modal.session?.getState?.()?.draftOps?.length || 0 };
    `);
    report.probes.schemaArrangeLocal = arrangeTimingBase;
    const localCommandBase = shimLogLength(shimDir);
    await sleep(350);
    const localWriterCalls = updateShimEdits(localCommandBase);
    const localP95 = p95(arrangeTimingBase?.timings || []);
    report.timings = report.timings || {};
    report.timings.album = { nudgePaintSamplesMs: arrangeTimingBase?.timings || [], nudgePaintP95Ms: localP95 };
    record("schema-arrange-option-code-local", Boolean(arrangeTimingBase?.ok && arrangeTimingBase?.keyPrevented
      && !arrangeTimingBase?.dirty && arrangeTimingBase?.draftOps === 0
      && localWriterCalls.apply === 0 && localWriterCalls.dry === 0),
      `Option+J code path returned to saved order; writer calls=${localWriterCalls.dry + localWriterCalls.apply}`);
    record("schema-arrange-nudge-budget", Boolean(localP95 !== null && localP95 < 50),
      `n=${(arrangeTimingBase?.timings || []).length}, p95=${localP95} ms, budget <50 ms`);

    const previewSamples = [];
    for (let index = 0; index < 6; index += 1) {
      const startedAt = Date.now();
      const moved = await ledgerEval(`const modal = plugin.albumSchemaCardModal; return Boolean(modal?.schemaArrangeNudge?.(1));`);
      if (!moved) break;
      await waitFor(client, `(() => {
        const modal = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}]?.albumSchemaCardModal;
        const state = modal?.session?.getState?.() || {};
        return { status: state.status || "", canApply: state.canApply === true, previewOk: state.preview?.ok === true };
      })()`, (value) => value?.status === "preview-ready" && value.canApply && value.previewOk,
      `album arrangement timing preview ${index + 1}`, 20_000);
      previewSamples.push(Date.now() - startedAt);
      const reverted = await ledgerEval(`const modal = plugin.albumSchemaCardModal; return Boolean(modal?.schemaArrangeRevert?.());`);
      if (!reverted) break;
      await sleep(280);
    }
    const previewP95 = p95(previewSamples);
    report.timings.album.settledDryRunSamplesMs = previewSamples;
    report.timings.album.settledDryRunP95Ms = previewP95;
    record("schema-arrange-dry-run-budget", Boolean(previewSamples.length === 6 && previewP95 !== null && previewP95 <= 1300),
      `n=${previewSamples.length}, p95=${previewP95} ms, budget <=1300 ms`);

    const arrangeLogBase = shimLogLength(shimDir);
    const arrangeCommitsBefore = gitCount(vaultDir);
    const arrangeGesture = await ledgerEval(`
      const modal = plugin.albumSchemaCardModal;
      const row = Array.from(modal?.contentEl?.querySelectorAll?.("[data-target-key]") || [])
        .find((item) => item.getAttribute("data-target-key") === modal?.selectedKey);
      if (!row) return { ok: false, error: "selected choice row missing" };
      row.focus();
      const event = new KeyboardEvent("keydown", { key: "∆", code: "KeyJ", altKey: true, bubbles: true, cancelable: true });
      row.dispatchEvent(event);
      return { ok: Boolean(modal.schemaArrangeDirty?.()), prevented: event.defaultPrevented,
        projected: modal.schemaArrangement?.projected?.(modal.schemaArrangeSelectedScope?.()?.scope) || [] };
    `);
    const arrangePreviewStarted = Date.now();
    const arrangePreview = arrangeGesture?.ok ? await waitFor(client, `(() => {
      const modal = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}]?.albumSchemaCardModal;
      const state = modal?.session?.getState?.() || {};
      const loud = modal?.schemaArrangeIsLoud?.() || {};
      return { status: state.status || "", canApply: state.canApply === true, previewOk: state.preview?.ok === true,
        loud: loud.loud === true, draftOps: (state.draftOps || []).length };
    })()`, (value) => value?.status === "preview-ready" && value.canApply && value.previewOk,
    "album quiet arrangement preview", 20_000) : null;
    const arrangePreviewMs = Date.now() - arrangePreviewStarted;
    report.probes.schemaArrangeGesture = arrangeGesture;
    report.probes.schemaArrangePreview = arrangePreview;
    const arrangePreSaveCommands = updateShimEdits(arrangeLogBase);
    const arrangeReadCountBeforeSave = (() => {
      try {
        return fs.readFileSync(path.join(shimDir, "argv.jsonl"), "utf8").split("\n").filter(Boolean).slice(arrangeLogBase)
          .map((line) => { try { return JSON.parse(line).argv || []; } catch { return []; } })
          .filter((argv) => argv[0] === "albums" && argv[1] === "list").length;
      } catch { return 0; }
    })();
    report.timings.album.quietArrangementPreviewMs = arrangePreviewMs;
    record("schema-arrange-preview-is-one-envelope", Boolean(arrangeGesture?.ok && arrangeGesture.prevented
      && arrangePreview?.canApply && !arrangePreview?.loud && arrangePreview.draftOps === 1
      && arrangePreSaveCommands.apply === 0 && arrangePreSaveCommands.dry === 1),
      `one quiet preview; dry=${arrangePreSaveCommands.dry}, apply=${arrangePreSaveCommands.apply}, ms=${arrangePreviewMs}`);

    if (arrangePreview?.canApply && !arrangePreview.loud) {
      await setViewport(client, 375, 812);
      await captureSchemaThemes("arrangement");
      await client.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
      const reducedMotion = await client.evaluate(`window.matchMedia("(prefers-reduced-motion: reduce)").matches`);
      const reducedShot = path.join(outDir, "album-schema-arrangement-375-reduced-motion.png");
      await capturePage(client, reducedShot);
      report.screenshots.push(reducedShot);
      record("schema-arrange-reduced-motion", reducedMotion === true, `media preference=${reducedMotion}`);
      await client.call("Emulation.setEmulatedMedia", { features: [] });

      const oneEnter = await ledgerEval(`
        const modal = plugin.albumSchemaCardModal;
        const row = Array.from(modal?.contentEl?.querySelectorAll?.("[data-target-key]") || [])
          .find((item) => item.getAttribute("data-target-key") === modal?.selectedKey);
        const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
        row?.dispatchEvent(event);
        return { prevented: event.defaultPrevented, status: modal?.session?.getState?.()?.status || "",
          confirm: modal?.schemaArrangeConfirm === true };
      `);
      await waitFor(client, `(() => {
        const modal = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}]?.albumSchemaCardModal;
        const state = modal?.session?.getState?.() || {};
        return { status: state.status || "", dirty: Boolean(modal?.schemaArrangeDirty?.()), undo: state.undoAvailable === true };
      })()`, (value) => value && value.status !== "applying" && !value.dirty && value.undo,
      "album arrangement saved after one Enter", 30_000);
      const arrangeWrites = updateShimEdits(arrangeLogBase);
      const arrangeCommitsAfter = gitCount(vaultDir);
      const arrangeApplyMs = await ledgerEval(`return (plugin.albumSchemaTimings || []).filter((item) => item?.kind === "apply").map((item) => Number(item.ms)).filter(Number.isFinite).slice(-1)[0] ?? null;`);
      const postApplyReads = (() => {
        try {
          return fs.readFileSync(path.join(shimDir, "argv.jsonl"), "utf8").split("\n").filter(Boolean).slice(arrangeLogBase)
            .map((line) => { try { return JSON.parse(line).argv || []; } catch { return []; } })
            .filter((argv) => argv[0] === "albums" && argv[1] === "list").length;
        } catch { return 0; }
      })();
      report.timings.album.applyMs = arrangeApplyMs;
      report.probes.schemaArrangeSave = { oneEnter, writes: arrangeWrites, commitsBefore: arrangeCommitsBefore,
        commitsAfter: arrangeCommitsAfter, postApplyReads, previewReadsBefore: arrangeReadCountBeforeSave };
      record("schema-arrange-one-enter-one-commit", Boolean(oneEnter?.prevented && arrangeWrites.apply === 1
        && arrangeCommitsAfter - arrangeCommitsBefore === 1),
        `Enter applies once; Bob apply=${arrangeWrites.apply}, git commits=${arrangeCommitsAfter - arrangeCommitsBefore}`);
      record("schema-arrange-one-revalidation", postApplyReads === 1,
        `albums list revalidations after apply=${postApplyReads}`);

      const undoGesture = await ledgerEval(`
        const modal = plugin.albumSchemaCardModal;
        const row = Array.from(modal?.contentEl?.querySelectorAll?.("[data-target-key]") || [])
          .find((item) => item.getAttribute("data-target-key") === modal?.selectedKey);
        const event = new KeyboardEvent("keydown", { key: "u", bubbles: true, cancelable: true });
        row?.dispatchEvent(event);
        return { prevented: event.defaultPrevented, staged: Boolean(modal?.session?.getState?.()?.draftOps?.length) };
      `);
      const arrangeUndoPreview = await waitFor(client, `(() => {
        const modal = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}]?.albumSchemaCardModal;
        const state = modal?.session?.getState?.() || {};
        return { status: state.status || "", canApply: state.canApply === true, previewOk: state.preview?.ok === true,
          undo: state.undoAvailable === true, draftOps: (state.draftOps || []).length };
      })()`, (value) => value?.canApply && value.previewOk && value.draftOps > 0,
      "album arrangement undo preview", 20_000);
      await ledgerEval(`const modal = plugin.albumSchemaCardModal; modal?.schemaArrangeEnter?.(); return true;`);
      await waitFor(client, `(() => {
        const modal = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}]?.albumSchemaCardModal;
        const state = modal?.session?.getState?.() || {};
        return { status: state.status || "", dirty: Boolean(modal?.schemaArrangeDirty?.()) };
      })()`, (value) => value && value.status !== "applying" && !value.dirty,
      "album arrangement undo applied", 30_000);
      const arrangeWritesAfterUndo = updateShimEdits(arrangeLogBase);
      const arrangeCommitsAfterUndo = gitCount(vaultDir);
      report.probes.schemaArrangeUndo = { gesture: undoGesture, preview: arrangeUndoPreview,
        writes: arrangeWritesAfterUndo, commits: arrangeCommitsAfterUndo - arrangeCommitsAfter };
      record("schema-arrange-undo-one-commit", Boolean(undoGesture?.prevented && arrangeUndoPreview?.canApply
        && arrangeWritesAfterUndo.apply === 2 && arrangeCommitsAfterUndo - arrangeCommitsAfter === 1),
        `arrangement Undo adds one commit; total applies=${arrangeWritesAfterUndo.apply}`);
    } else {
      record("schema-arrange-one-enter-one-commit", false, "quiet arrangement preview was not ready");
      record("schema-arrange-one-revalidation", false, "quiet arrangement preview was not ready");
      record("schema-arrange-undo-one-commit", false, "quiet arrangement preview was not ready");
    }
    await closeSchemaCard();
    await sleep(300);

    const paletteEat = await client.evaluate(`(() => (async () => {
      await window.app.commands.executeCommandById("bob-ledger-tools:edit-album-schema");
      await new Promise((resolve) => setTimeout(resolve, 800));
      const modal = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}]?.albumSchemaCardModal;
      const doc = modal?.contentEl?.ownerDocument || document;
      return { dialog: Boolean(doc.querySelector(".bob-album-schema-dialog")) };
    })())()`);
    record("schema-entry-palette", Boolean(paletteEat && paletteEat.dialog), "palette opens the card on the album");
    await closeSchemaCard();
    await openNote(client, "eat/a-one.md", "live");
    await sleep(700);
    const paletteRecord = await client.evaluate(`(() => (async () => {
      await window.app.commands.executeCommandById("bob-ledger-tools:edit-album-schema");
      await new Promise((resolve) => setTimeout(resolve, 800));
      const modal = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}]?.albumSchemaCardModal;
      const doc = modal?.contentEl?.ownerDocument || document;
      const title = doc.querySelector(".bob-album-schema-dialog-title");
      return { dialog: Boolean(doc.querySelector(".bob-album-schema-dialog")), title: title ? title.textContent : "",
        sourcePath: String(modal?.schemaSourcePath || ""), modelPath: String(modal?.schemaModel?.path || "") };
    })())()`);
    report.probes.schemaEntryRecord = paletteRecord;
    record("schema-entry-record", Boolean(paletteRecord && paletteRecord.dialog && paletteRecord.sourcePath === "eat.md"),
      `record note resolves album path=${paletteRecord?.sourcePath || "(none)"}; card title=${paletteRecord?.title || "(none)"}`);
    await closeSchemaCard();
    await openNote(client, "unrelated.md", "preview");
    await sleep(700);
    const paletteUnrelated = await client.evaluate(`(() => (async () => {
      await window.app.commands.executeCommandById("bob-ledger-tools:edit-album-schema");
      await new Promise((resolve) => setTimeout(resolve, 800));
      const modal = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}]?.albumSchemaCardModal;
      const doc = modal?.contentEl?.ownerDocument || document;
      return { dialog: Boolean(doc.querySelector(".bob-album-schema-dialog")) };
    })())()`);
    record("schema-entry-unrelated", Boolean(paletteUnrelated && !paletteUnrelated.dialog), "unrelated notes teach instead of opening");
    const commandIds = await client.evaluate(`(() => {
      try {
        return window.app.commands.listCommands().filter((item) => /edit-album-schema|set-bullet-property/.test(item.id || "")).map((item) => item.id);
      } catch { return []; }
    })()`);
    record("schema-commands-registered", commandIds.includes("bob-ledger-tools:edit-album-schema"), commandIds.join(","));

    await client.evaluate(`(() => (async () => {
      const file = window.app.vault.getAbstractFileByPath("body.md");
      if (!file) return false;
      const text = await window.app.vault.read(file);
      if (text.includes("- [ ] probe task #task")) return true;
      await window.app.vault.modify(file, text.replace(/\\s*$/, ${JSON.stringify("\n\n- [ ] probe task #task\n- probe bullet\n")}));
      return true;
    })())()`);
    await openNote(client, "body.md", "live");
    await sleep(800);
    const taskPriorityVerdict = await client.evaluate(`(() => (async () => {
      const nav = window.app?.plugins?.plugins?.["bob-navigation-hotkeys"];
      const ledger = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}];
      const view = window.app?.workspace?.activeLeaf?.view;
      const editor = view && view.editor;
      if (!nav || !ledger || !editor) {
        return { ok: false };
      }
      const value = editor.getValue();
      const lines = value.split("\\n");
      const taskLine = lines.findIndex((line) => line.includes("- [ ] probe task"));
      if (taskLine < 0) return { ok: false, error: "probe task line missing" };
      const taskLineText = lines[taskLine];
      const taskPredicate = /(?:^|\\s)#task(?:\\s|$)/.test(taskLineText);
      const command = window.app.commands.commands?.["bob-navigation-hotkeys:set-bullet-property"];
      const runTaskCardCommand = () => typeof command?.editorCallback === "function"
        ? { registered: true, result: command.editorCallback(editor) }
        : { registered: false, result: window.app.commands.executeCommandById("bob-navigation-hotkeys:set-bullet-property") };
      editor.setCursor({ line: taskLine, ch: 4 });
      const taskCommand = runTaskCardCommand();
      await new Promise((resolve) => setTimeout(resolve, 800));
      const taskPicker = nav.activeBulletPropertyPicker;
      const taskCard = taskPicker?.pickerOpen === true;
      const taskSchema = Boolean(ledger.albumSchemaCardModal?.modalEl?.isConnected);
      try { taskPicker?.close?.(); } catch {}
      return {
        ok: true, taskLineText, taskPredicate,
        taskCard, taskPickerOpen: taskPicker?.pickerOpen ?? null,
        taskPickerClass: taskPicker?.constructor?.name || null,
        taskPickerStage: taskPicker?.stage || null,
        taskPickerConnected: Boolean(taskPicker?.modalEl?.isConnected && taskPicker?.contentEl?.isConnected),
        taskCommand: { registered: taskCommand.registered, result: typeof taskCommand.result === "boolean" ? taskCommand.result : String(taskCommand.result ?? "") },
        taskSchema,
      };
    })())()`);
    await openNote(client, "eat.md", "live");
    await sleep(800);
    const albumFallbackVerdict = await client.evaluate(`(() => (async () => {
      const nav = window.app?.plugins?.plugins?.["bob-navigation-hotkeys"];
      const ledger = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}];
      const view = window.app?.workspace?.activeLeaf?.view;
      const editor = view && view.editor;
      if (!nav || !ledger || !editor) return { ok: false };
      const lines = editor.getValue().split("\\n");
      const titleLine = lines.findIndex((line) => line === "# Eat");
      if (titleLine < 0) return { ok: false, error: "album title line missing" };
      const command = window.app.commands.commands?.["bob-navigation-hotkeys:set-bullet-property"];
      const runCommand = () => typeof command?.editorCallback === "function"
        ? { registered: true, result: command.editorCallback(editor) }
        : { registered: false, result: window.app.commands.executeCommandById("bob-navigation-hotkeys:set-bullet-property") };
      const schemaIsOpen = () => {
        const modal = ledger.albumSchemaCardModal;
        const content = modal?.contentEl;
        return Boolean(content?.isConnected && modal?.modalEl?.isConnected
          && (content.matches?.(".bob-album-schema-dialog") || content.querySelector?.(".bob-album-schema-dialog")));
      };
      editor.setCursor({ line: titleLine, ch: 2 });
      const titleCommand = runCommand();
      await new Promise((resolve) => setTimeout(resolve, 800));
      const titleSchema = schemaIsOpen();
      try { ledger.albumSchemaCardModal?.close?.(); } catch {}
      editor.setCursor({ line: titleLine + 1, ch: 0 });
      const blankCommand = runCommand();
      await new Promise((resolve) => setTimeout(resolve, 800));
      const blankSchema = schemaIsOpen();
      try { ledger.albumSchemaCardModal?.close?.(); } catch {}
      return {
        ok: true, titleSchema, blankSchema,
        titleCommand: { registered: titleCommand.registered, result: typeof titleCommand.result === "boolean" ? titleCommand.result : String(titleCommand.result ?? "") },
        blankCommand: { registered: blankCommand.registered, result: typeof blankCommand.result === "boolean" ? blankCommand.result : String(blankCommand.result ?? "") },
      };
    })())()`);
    const fallbackVerdicts = { ...taskPriorityVerdict, ...albumFallbackVerdict };
    report.probes.schemaFallback = fallbackVerdicts;
    record("schema-task-priority", Boolean(fallbackVerdicts && fallbackVerdicts.ok
      && fallbackVerdicts.taskCard && !fallbackVerdicts.taskSchema),
      `task card=${Boolean(fallbackVerdicts && fallbackVerdicts.taskCard)}; schema=${Boolean(fallbackVerdicts && fallbackVerdicts.taskSchema)}`);
    record("schema-fallback-title", Boolean(fallbackVerdicts && fallbackVerdicts.ok && fallbackVerdicts.titleSchema),
      "the registered Task Card command opens the album Schema Card on the album title row");
    record("schema-fallback-blank", Boolean(fallbackVerdicts && fallbackVerdicts.ok && fallbackVerdicts.blankSchema),
      "the registered Task Card command opens the album Schema Card on a blank album row");
    await closeSchemaCard();

    await openNote(client, "eat.md", "preview");
    await sleep(800);
    const reopenClicked = await clickActiveSchemaOpener();
    record("schema-reopen-header", Boolean(reopenClicked && reopenClicked.ok), JSON.stringify(reopenClicked));
    await waitFor(client, probe, (value) => (value.schemaDialogs || []).length > 0, "schema-dialog-reopen", 16_000);
    const staleStageResult = await client.evaluate(`(() => (async () => {
      const modal = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}]?.albumSchemaCardModal;
      const root = modal?.contentEl || document;
      const pick = (sel) => root.querySelector(sel);
      const addChoice = pick('[data-target-key="add-choice:status"]');
      if (!addChoice) return { ok: false, error: "add-choice target missing" };
      addChoice.click();
      root.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 250));
      const label = pick('[data-schema-input="choiceLabel"]');
      if (!label) return { ok: false, error: "choice stage input missing", stage: modal.stage || null };
      label.value = "Stale";
      label.dispatchEvent(new Event("input", { bubbles: true }));
      return { ok: true, stage: modal.stage || null,
        previewButton: Boolean(pick('[data-schema-action="submit-stage"]')) };
    })())()`);
    record("schema-stale-draft-staged", Boolean(staleStageResult && staleStageResult.ok), JSON.stringify(staleStageResult));
    if (!staleStageResult?.ok) throw new Error(`could not stage stale draft: ${staleStageResult?.error || "unknown failure"}`);
    await waitFor(client, probe, (value) => (value.schemaConsequence || []).some((item) => /stale/.test(item.text || "")),
      "schema-stale-preview", 20_000).catch(() => null);
    const stalePreviewState = await waitFor(client, `(() => {
      const modal = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}]?.albumSchemaCardModal;
      const state = modal?.session?.getState?.() || {};
      const root = modal?.contentEl;
      const apply = root?.querySelector?.('[data-schema-action="apply"]');
      return { status: state.status || null, canApply: state.canApply === true,
        previewOk: state.preview?.ok === true, applyDisabled: apply ? apply.disabled === true : null,
        refusal: state.refusal || null, previewError: state.preview?.error || null,
        drafts: state.draftOps || [], stage: modal?.stage?.kind || null,
        rootConnected: root?.isConnected === true };
    })()`, (value) => Boolean(value && value.canApply && value.previewOk && value.applyDisabled === false),
    "schema-stale-preview-ready", 20_000);
    report.probes.schemaStalePreviewState = stalePreviewState;
    const staleBase = updateShimEdits().apply;
    const staleHeadBefore = gitHead(vaultDir);
    const staleBytesBefore = fs.readFileSync(path.join(vaultDir, "eat.md"), "utf8");
    const saveRaceSetup = await client.evaluate(`(() => (async () => {
      const workspace = window.app?.workspace;
      const file = window.app?.vault?.getAbstractFileByPath("eat.md");
      const first = workspace?.activeLeaf;
      if (!workspace || !file || !first || typeof workspace.getLeaf !== "function") {
        return { ok: false, error: "workspace or album pane unavailable" };
      }
      const second = workspace.getLeaf("split", "vertical");
      if (!second || second === first) return { ok: false, error: "Obsidian did not create a second pane" };
      await second.openFile(file, { state: ${JSON.stringify(markdownViewState("source"))} });
      const view = second.view;
      if (!view || !view.editor || view.file?.path !== "eat.md" || typeof view.save !== "function") {
        return { ok: false, error: "second Source pane has no supported Markdown save" };
      }
      if (typeof view.setState === "function") {
        const state = (view.getState && view.getState()) || {};
        await view.setState(Object.assign({}, state, ${JSON.stringify(markdownViewState("source"))}), { history: false });
      }
      const originalText = view.editor.getValue();
      const beforeDisk = await window.app.vault.read(file);
      const from = "    category: {required: true, suggest: true}";
      const to = "    category: {required: false, suggest: true}";
      const editedText = originalText.replace(from, to);
      if (editedText === originalText) return { ok: false, error: "expected category schema line was not found" };
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      const originalSave = view.save;
      let savePromise = null;
      const race = {
        view,
        applyRequested: false,
        saveStarted: false,
        calls: 0,
        applySaveCalls: 0,
        release: () => release(),
        restore: () => { view.save = originalSave; },
      };
      view.save = async function(...args) {
        race.calls += 1;
        if (race.applyRequested) race.applySaveCalls += 1;
        race.saveStarted = true;
        if (!savePromise) {
          savePromise = (async () => {
            await gate;
            return await originalSave.apply(view, args);
          })();
        }
        return savePromise;
      };
      window.__bobAlbumSaveRace = race;
      view.editor.setValue(editedText);
      const sameNotePanes = workspace.getLeavesOfType("markdown")
        .filter((leaf) => leaf?.view?.file?.path === "eat.md").length;
      const state = view.getState && view.getState();
      return {
        ok: true,
        sameNotePanes,
        sourceMode: Boolean(state && (state.mode === "source" || state.source === true)),
        dirtySchema: view.editor.getValue() !== beforeDisk,
        beforeDisk,
        editedText,
      };
    })())()`);
    record("schema-two-pane-source-edit", Boolean(saveRaceSetup && saveRaceSetup.ok
      && saveRaceSetup.sameNotePanes >= 2 && saveRaceSetup.sourceMode && saveRaceSetup.dirtySchema),
      `setup=${JSON.stringify({ ok: saveRaceSetup?.ok, panes: saveRaceSetup?.sameNotePanes, source: saveRaceSetup?.sourceMode, dirty: saveRaceSetup?.dirtySchema, error: saveRaceSetup?.error })}`);
    if (!saveRaceSetup?.ok) throw new Error(`could not set up real two-pane save race: ${saveRaceSetup?.error || "unknown failure"}`);

    const applyWhileSaving = await client.evaluate(`(() => {
      const race = window.__bobAlbumSaveRace;
      const modal = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}]?.albumSchemaCardModal;
      const root = modal?.contentEl || document;
      const apply = root.querySelector('[data-schema-action="apply"]');
      const state = modal?.session?.getState?.() || {};
      if (!race || !apply || apply.disabled) return {
        ok: false, error: "Apply is not enabled for the successful preview",
        hasRace: Boolean(race), hasApply: Boolean(apply), applyDisabled: apply?.disabled ?? null,
        status: state.status || null, canApply: state.canApply === true,
        previewOk: state.preview?.ok === true, stage: modal?.stage?.kind || null,
        rootConnected: root?.isConnected === true,
      };
      race.applyRequested = true;
      apply.click();
      return { ok: true };
    })()`);
    record("schema-save-race-apply-started", Boolean(applyWhileSaving && applyWhileSaving.ok), applyWhileSaving?.error || "confirmed Apply began before the delayed pane save");
    if (!applyWhileSaving?.ok) throw new Error(`could not start save race: ${applyWhileSaving?.error || "Apply unavailable"}`);

    const saveWait = await waitFor(client, `(() => {
      const race = window.__bobAlbumSaveRace;
      return race ? { started: race.saveStarted, applyCalls: race.applySaveCalls, calls: race.calls } : null;
    })()`, (value) => Boolean(value && value.started && value.applyCalls > 0), "schema-two-pane-supported-save-wait", 12_000);
    const beforeReleaseBytes = fs.readFileSync(path.join(vaultDir, "eat.md"), "utf8");
    const applyAttemptsBeforeRelease = updateShimEdits().apply - staleBase;
    record("schema-save-race-waits-for-supported-save", Boolean(saveWait && saveWait.applyCalls > 0
      && beforeReleaseBytes === staleBytesBefore && applyAttemptsBeforeRelease === 0),
      `save calls=${saveWait?.calls}; disk unchanged=${beforeReleaseBytes === staleBytesBefore}; writer applies=${applyAttemptsBeforeRelease}`);

    await client.evaluate(`(() => {
      const race = window.__bobAlbumSaveRace;
      if (race) race.release();
      return Boolean(race);
    })()`);
    const staleRefused = await waitFor(client, probe, (value) => (value.schemaRefusal || []).some((item) => /stale|fingerprint|changed/i.test((item.text || "") + " " + JSON.stringify(value.schemaRefusal))),
      "schema-stale-refusal", 20_000).catch(async () => client.evaluate(probe));
    report.probes.schemaStale = staleRefused;
    const staleSession = await ledgerEval(`return (() => {
      const modal = plugin.albumSchemaCardModal;
      const state = modal && modal.session ? modal.session.getState() : {};
      return { kind: (state.refusal && state.refusal.kind) || null, drafts: (state.draftOps || []).length, canApply: state.canApply === true };
    })();`);
    const staleAttempts = updateShimEdits().apply - staleBase;
    const staleHeadAfter = gitHead(vaultDir);
    const staleBytesAfter = fs.readFileSync(path.join(vaultDir, "eat.md"), "utf8");
    await client.evaluate(`(() => {
      const race = window.__bobAlbumSaveRace;
      if (race) race.restore();
      delete window.__bobAlbumSaveRace;
      return true;
    })()`);
    report.probes.schemaSaveRace = {
      setup: saveRaceSetup,
      saveWait,
      applyAttemptsBeforeRelease,
      applyAttemptsAfterRelease: staleAttempts,
      headBefore: staleHeadBefore,
      headAfter: staleHeadAfter,
      sourceBytesMatchSupportedSave: staleBytesAfter === saveRaceSetup.editedText,
      staleSession,
    };
    record("schema-stale-refusal", (staleRefused.schemaRefusal || []).length > 0, "the delayed second-pane Source save invalidates the old schema preview");
    record("schema-stale-no-write-or-retry", staleAttempts === 0 && staleHeadAfter === staleHeadBefore
      && staleBytesAfter === saveRaceSetup.editedText,
      `writer applies=${staleAttempts}; commit unchanged=${staleHeadAfter === staleHeadBefore}; source save preserved=${staleBytesAfter === saveRaceSetup.editedText}`);
    record("schema-stale-draft-retained", Boolean(staleSession && staleSession.kind === "stale"
      && staleSession.drafts === 1 && staleSession.canApply === false), `draft stays unconfirmed: ${JSON.stringify(staleSession)}`);
    await captureSchemaThemes("refusal");

    const yamlJumped = await client.evaluate(`(() => {
      const modal = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}]?.albumSchemaCardModal;
      const root = modal?.contentEl || document;
      const action = root.querySelector('[data-schema-action="yaml"]');
      if (action) action.click();
      return true;
    })()`);
    void yamlJumped;
    await sleep(1200);
    const yamlState = await client.evaluate(`(() => {
      const view = window.app?.workspace?.activeLeaf?.view;
      const state = view && typeof view.getState === "function" ? view.getState() : {};
      const doc = view?.containerEl?.ownerDocument || document;
      const done = doc.querySelector("[data-album-yaml-done]");
      return { mode: state.mode || null, source: state.source, done: Boolean(done) };
    })()`);
    report.probes.schemaYaml = yamlState;
    record("schema-yaml-done-mounted", Boolean(yamlState && isMarkdownSource(yamlState) && yamlState.done), "Source mode mounts a pane-scoped Done");
    const doneBlocked = await client.evaluate(`(() => (async () => {
      const ledger = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}];
      const view = window.app?.workspace?.activeLeaf?.view;
      const editor = view && view.editor;
      const doc = view?.containerEl?.ownerDocument || document;
      if (!editor) return { ok: false, error: "no editor" };
      editor.setCursor({ line: Math.max(0, editor.lineCount() - 1), ch: 0 });
      const before = editor.getCursor();
      const valid = editor.getValue();
      const corrupted = valid.replace("\\n  fields:", "\\n  fields: []\\n  orphan: true\\n  fields:");
      editor.setValue(corrupted);
      const done = doc.querySelector("[data-album-yaml-done]");
      if (!done) return { ok: false, error: "Done button missing" };
      done.click();
      await new Promise((resolve) => setTimeout(resolve, 2500));
      const after = editor.getCursor();
      const content = ledger?.albumSchemaCardModal?.contentEl;
      const dialog = Boolean(content && (content.matches?.(".bob-album-schema-dialog")
        || content.querySelector?.(".bob-album-schema-dialog")));
      const state = view && typeof view.getState === "function" ? view.getState() : {};
      window.__bobSchemaRepair = valid;
      return { ok: true, before, after, dialog,
        source: state.source === true || state.mode === "source", mode: state.mode || null };
    })())()`);
    report.probes.schemaDoneBlocked = doneBlocked;
    record("schema-done-blocked", Boolean(doneBlocked && doneBlocked.ok && !doneBlocked.dialog && doneBlocked.source
      && doneBlocked.after && doneBlocked.before && doneBlocked.after.line !== doneBlocked.before.line),
      `cursor moves to the diagnostic line ${JSON.stringify((doneBlocked && doneBlocked.after) || {})}`);
    const doneRepairClicked = await client.evaluate(`(() => (async () => {
      const ledger = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}];
      const view = window.app?.workspace?.activeLeaf?.view;
      const editor = view && view.editor;
      const doc = view?.containerEl?.ownerDocument || document;
      if (!editor || !window.__bobSchemaRepair) return { ok: false };
      if (typeof ledger?.albumYamlDone !== "function") return { ok: false, error: "Done handler missing" };
      if (!ledger.__albumYamlDoneE2eWrapped) {
        const originalDone = ledger.albumYamlDone;
        const originalReport = ledger.apiAlbumReport;
        ledger.albumYamlDone = async function(options) {
          const result = await originalDone.call(this, options);
          window.__bobSchemaDoneResult = result || null;
          return result;
        };
        ledger.apiAlbumReport = async function(options) {
          const state = await originalReport.call(this, options);
          if (options?.force === true && options?.wait === true) {
            window.__bobSchemaDoneReportState = {
              stale: state?.stale === true, unavailable: state?.unavailable === true,
              refreshing: state?.refreshing === true, error: state?.error || null,
              generation: state?.generation ?? null, reportGeneration: state?.reportGeneration ?? null,
              hasReport: Boolean(state?.report), hasEat: (state?.report?.albums || []).some((item) => item?.path === "eat.md" || item?.stem === "eat"),
            };
          }
          return state;
        };
        ledger.__albumYamlDoneE2eWrapped = true;
      }
      window.__bobSchemaDoneResult = null;
      window.__bobSchemaDoneReportState = null;
      editor.setValue(window.__bobSchemaRepair);
      const done = doc.querySelector("[data-album-yaml-done]");
      if (!done) return { ok: false, error: "Done button missing after repair" };
      done.click();
      return { ok: true, handlerAvailable: true };
    })())()`);
    if (!doneRepairClicked?.ok) throw new Error(`could not click Done after repair: ${doneRepairClicked?.error || "unknown failure"}`);
    const doneRepaired = await waitFor(client, `(() => {
      const ledger = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}];
      const modal = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}]?.albumSchemaCardModal;
      const content = modal?.contentEl;
      const view = window.app?.workspace?.activeLeaf?.view;
      const state = view && typeof view.getState === "function" ? view.getState() : {};
      return { doneResult: window.__bobSchemaDoneResult || null,
        reportState: window.__bobSchemaDoneReportState || null,
        dialog: Boolean(content?.isConnected && modal?.modalEl?.isConnected
          && (content.matches?.(".bob-album-schema-dialog") || content.querySelector?.(".bob-album-schema-dialog"))),
        targetCount: content?.querySelectorAll?.("[data-target-key]")?.length || 0,
        mode: state.mode || null, source: state.source === true };
    })()`, (value) => Boolean(value && value.doneResult), "schema-done-result", 30_000);
    report.probes.schemaDoneRepair = doneRepaired;
    record("schema-done-repair", Boolean(doneRepaired && doneRepaired.doneResult?.ok
      && doneRepaired.dialog && doneRepaired.targetCount > 3), JSON.stringify(doneRepaired));
    if (!doneRepaired?.doneResult?.ok || !doneRepaired.dialog || doneRepaired.targetCount <= 3) {
      throw new Error(`repair then Done did not reopen the card: ${JSON.stringify(doneRepaired)}`);
    }
    const typedStage = await client.evaluate(`(() => (async () => {
      const modal = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}]?.albumSchemaCardModal;
      const root = modal?.contentEl || document;
      const pick = (sel) => root.querySelector(sel);
      const stats = pick('[data-target-key="stats"]');
      if (!stats) return { staged: false, error: "stats target missing after YAML Done", modalOpen: Boolean(modal?.modalEl?.isConnected), rootConnected: root?.isConnected === true, targetCount: root?.querySelectorAll?.("[data-target-key]")?.length || 0 };
      if (stats) stats.click();
      await new Promise((resolve) => setTimeout(resolve, 300));
      const target = pick('[data-target-key="stats"]') || stats;
      const KeyboardEventCtor = target.ownerDocument?.defaultView?.KeyboardEvent || KeyboardEvent;
      const enter = new KeyboardEventCtor("keydown", { key: "Enter", bubbles: true, cancelable: true });
      target.focus?.();
      target.dispatchEvent(enter);
      await new Promise((resolve) => setTimeout(resolve, 300));
      return { staged: Boolean(pick("[data-schema-stage]")), stage: modal?.stage?.kind || null,
        selectedKey: modal?.selectedKey || null, eventDefaultPrevented: enter.defaultPrevented,
        targetConnected: target.isConnected === true, targetCount: root?.querySelectorAll?.("[data-target-key]")?.length || 0,
        inputCount: root?.querySelectorAll?.("[data-schema-input]")?.length || 0 };
    })())()`);
    report.probes.schemaTypedStage = typedStage;
    record("schema-typed-stage", Boolean(typedStage && typedStage.staged), JSON.stringify(typedStage));
    const typedShot = path.join(outDir, "album-schema-typed-375-light.png");
    await setViewport(client, 375, 812);
    await sleep(300);
    await capturePage(client, typedShot);
    report.screenshots.push(typedShot);
    await client.evaluate(`(() => {
      const modal = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}]?.albumSchemaCardModal;
      const doc = modal?.contentEl?.ownerDocument || document;
      doc.body.classList.add("theme-dark");
      return true;
    })()`);
    await sleep(200);
    const schemaDarkShot = path.join(outDir, "album-schema-375-dark.png");
    await capturePage(client, schemaDarkShot);
    report.screenshots.push(schemaDarkShot);
    await client.evaluate(`(() => {
      const modal = window.app?.plugins?.plugins?.[${JSON.stringify(LEDGER_ID)}]?.albumSchemaCardModal;
      const doc = modal?.contentEl?.ownerDocument || document;
      doc.body.classList.remove("theme-dark");
      return true;
    })()`);
    await closeSchemaCard();

    // Exercise Obsidian's actual Properties input, after all read-only byte
    // checks. The native serializer must preserve the emitted record block.
    await setViewport(client, 1280, 800);
    await openNote(client, "schema-proof.md", "preview");
    await sleep(600);
    const roundTrip = await properties.propertiesRoundTrip(client, vaultDir);
    report.probes.propertiesRoundTrip = roundTrip;
    record("properties-summary-preserves-record-bytes", roundTrip.ok, JSON.stringify(roundTrip));

    // Disabling the plugin must restore the existing native property row.
    await client.evaluate(`(async () => {
      await window.app.plugins.disablePlugin("bob-ledger-tools");
      return true;
    })()`);
    await sleep(300);
    const restoredProperty = await client.evaluate(properties.propertyProbe());
    report.probes.restoredProperty = restoredProperty;
    record("plugin-disable-restores-record-property", properties.propertyVisibility(restoredProperty, "schema-proof.md", true), JSON.stringify(restoredProperty));

    report.probes.bobInvocations = shimInvocationSummary(shimDir);
    const failures = report.checks.filter((item) => !item.ok);
    report.probes.screenshotContexts = client?.screenshotContexts || [];
    report.pass = failures.length === 0;
    report.failures = failures.map((item) => item.name);
    if (args.report) fs.writeFileSync(args.report, JSON.stringify(report, null, 2));
    process.stdout.write(`${report.pass ? "PASS" : "FAIL"} album UI e2e (${report.checks.length} checks, ${failures.length} failed)\\n`);
    if (!report.pass) process.exitCode = 1;
  } catch (error) {
    report.fatalError = String((error && error.stack) || error);
    report.probes.bobInvocations = shimInvocationSummary(shimDir);
    record("fatal", false, String((error && error.message) || error));
    report.failures = report.checks.filter((item) => !item.ok).map((item) => item.name);
    if (client) {
      const failureShot = path.join(outDir, "album-ui-failure.png");
      try {
        await capturePage(client, failureShot);
        report.screenshots.push(failureShot);
      } catch (_) {}
    }
    if (args.report) fs.writeFileSync(args.report, JSON.stringify(report, null, 2));
    throw error;
  } finally {
    clearTimeout(overall);
    if (client) client.close();
    if (child && !child.killed) {
      child.kill("SIGTERM");
      await sleep(500);
      if (!child.killed) child.kill("SIGKILL");
    }
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

async function main(argv) {
  const args = album.parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${album.HELP_TEXT}\\n`);
    return;
  }
  if (args.selfTest) {
    selfTest();
    return;
  }
  await run(args);
}

main(process.argv.slice(2)).catch((error) => {
  const code = Number.isInteger(error.exitCode) ? error.exitCode : 1;
  process.stderr.write(`${(error && error.stack) || error}\\n`);
  process.exit(code);
});

