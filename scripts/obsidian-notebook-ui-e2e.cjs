#!/usr/bin/env node
// Real-Obsidian e2e for notebook catalog/header UI.
// Isolated scratch vault + profile, owned Obsidian process, CDP probes.
// Never opens the live vault.
//
//   xvfb-run -a node scripts/obsidian-notebook-ui-e2e.cjs [--out DIR] [-e PATH] [-r REPORT]
"use strict";

const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const lib = require("./obsidian-startup-smoke-lib.cjs");

const OVERALL_TIMEOUT_MS = 240_000;
const HELP_TEXT = [
  "Usage: node scripts/obsidian-notebook-ui-e2e.cjs [OPTIONS]",
  "",
  "Drive notebook headers and catalogs in an isolated scratch vault through CDP.",
  "Never opens the live vault. Run under xvfb-run -a on Linux.",
  "",
  "Options:",
  "  -e, --executable PATH   Obsidian executable (default: /snap/bin/obsidian)",
  "  -h, --help              Print this help and exit",
  "  -o, --out DIRECTORY     Screenshot output directory",
  "  -r, --report PATH       Write the structured JSON report to PATH",
  "  -s, --self-test         Run offline self-tests (no Obsidian needed)",
].join("\n");

function parseArgs(argv) {
  const args = { executable: null, help: false, out: null, report: null, selfTest: false };
  const list = Array.isArray(argv) ? argv.slice() : [];
  for (let index = 0; index < list.length; index += 1) {
    const token = list[index];
    if (token === "-e" || token === "--executable" || token === "--obsidian-bin") {
      const value = list[++index];
      if (!value || value.startsWith("-")) throw new Error("--executable requires a PATH value");
      args.executable = value;
    } else if (token === "-h" || token === "--help") {
      args.help = true;
    } else if (token === "-o" || token === "--out") {
      const value = list[++index];
      if (!value || value.startsWith("-")) throw new Error("--out requires a DIRECTORY value");
      args.out = value;
    } else if (token === "-r" || token === "--report") {
      const value = list[++index];
      if (!value || value.startsWith("-")) throw new Error("--report requires a PATH value");
      args.report = value;
    } else if (token === "-s" || token === "--self-test") {
      args.selfTest = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

function fail(message, code) {
  const error = new Error(message);
  error.exitCode = code || 1;
  throw error;
}

function findExecutable(override) {
  const candidates = [];
  if (override) candidates.push(override);
  if (process.env.OBSIDIAN_BIN) candidates.push(process.env.OBSIDIAN_BIN);
  candidates.push("/snap/bin/obsidian");
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

function fixtureNotes() {
  const long = "A very long notebook label that should wrap beside count age and add-summary chips at 375 px without overlapping the row text.";
  return {
    "area.md": [
      "---",
      "type: \"[[area]]\"",
      "color: blue",
      "parent: \"[[index]]\"",
      "---",
      "",
      "# Area",
      "",
      "## Notebooks",
      "",
      "> [!notebooks]",
      ">",
      `> - **[[tools|Developer tools]]** — Command-line tools.`,
      `>   - **[[git|Git]]** — Commands and workflow.`,
      `> - **[[ideas|Ideas]]**`,
      `> - 🧩 [[sub]]`,
      `>   - **[[child|${long}]]** — Nested under a project group.`,
      "",
    ].join("\n"),
    "tools.md": [
      "---",
      "type: \"[[notebook]]\"",
      "parent: \"[[area]]\"",
      "summary: Command-line tools.",
      "---",
      "",
      "# Developer tools",
      "",
      "Child notebooks live here.",
      "",
    ].join("\n"),
    "git.md": [
      "---",
      "type: \"[[notebook]]\"",
      "parent: \"[[tools]]\"",
      "summary: Commands and workflow.",
      "---",
      "",
      "# Git",
      "",
      "Workflow notes.",
      "",
    ].join("\n"),
    "ideas.md": [
      "---",
      "type: \"[[notebook]]\"",
      "parent: \"[[area]]\"",
      "summary: \"\"",
      "---",
      "",
      "# Ideas",
      "",
      "Missing summary on purpose.",
      "",
    ].join("\n"),
    "sub.md": [
      "---",
      "type: \"[[project]]\"",
      "parent: \"[[area]]\"",
      "color: orange",
      "---",
      "",
      "# Sub",
      "",
      "Project host.",
      "",
    ].join("\n"),
    "child.md": [
      "---",
      "type: \"[[notebook]]\"",
      "parent: \"[[sub]]\"",
      "summary: Nested under a project.",
      "---",
      "",
      "# Child",
      "",
      "Nested notebook.",
      "",
    ].join("\n"),
    "host.md": [
      "---",
      "type: \"[[note]]\"",
      "parent: \"[[area]]\"",
      "---",
      "",
      "# Host embed",
      "",
      "![[git]]",
      "",
    ].join("\n"),
    "h1less.md": [
      "---",
      "type: \"[[area]]\"",
      "parent: \"[[index]]\"",
      "---",
      "",
      "No title and no Notebooks heading; catalog is missing.",
      "",
    ].join("\n"),
    "h1child.md": [
      "---",
      "type: \"[[notebook]]\"",
      "parent: \"[[h1less]]\"",
      "summary: Child of the H1-less host.",
      "---",
      "",
      "# H1 child",
      "",
    ].join("\n"),
    "damaged.md": [
      "---",
      "type: \"[[area]]\"",
      "parent: \"[[index]]\"",
      "---",
      "",
      "# Damaged",
      "",
      "## Notebooks",
      "",
      "<!-- bob:notebooks:begin v1 -->",
      "> [!notebooks]",
      ">",
      "> - **[[git|Git]]** — broken markers on purpose.",
      "",
    ].join("\n"),
    "index.md": [
      "---",
      "type: \"[[area]]\"",
      "---",
      "",
      "# Index",
      "",
    ].join("\n"),
  };
}

function buildFixture(vaultDir) {
  const notes = fixtureNotes();
  for (const [name, body] of Object.entries(notes)) {
    writeNote(path.join(vaultDir, name), body);
  }
  const enabled = [];
  for (const plugin of readExpectedPlugins()) {
    copyPluginFiles(
      path.join(repoRoot, "plugins", plugin.id),
      path.join(vaultDir, ".obsidian", "plugins", plugin.id),
    );
    enabled.push(plugin.id);
  }
  fs.mkdirSync(path.join(vaultDir, ".obsidian"), { recursive: true });
  fs.writeFileSync(path.join(vaultDir, ".obsidian", "community-plugins.json"), JSON.stringify(enabled, null, 2));
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
  fs.writeFileSync(path.join(ledgerDir, "data.json"), JSON.stringify({ notebookChips: true }, null, 2));
  return { notes: Object.keys(notes), enabled };
}

function seedProfileVault(profileDir, vaultRealPath) {
  const id = crypto.randomBytes(8).toString("hex");
  const payload = { vaults: { [id]: { path: vaultRealPath, ts: Date.now(), open: true } } };
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, "obsidian.json"), JSON.stringify(payload, null, 2));
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
    return this.call(
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true, userGesture: true },
      timeoutMs,
    ).then((response) => {
      if (response.exceptionDetails) {
        const details = response.exceptionDetails;
        throw new Error((details.exception && details.exception.description) || details.text || "Runtime.evaluate failed");
      }
      return response.result && response.result.value;
    });
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
  const adapter = window.app && window.app.vault && window.app.vault.adapter;
  if (adapter && typeof adapter.basePath === "string" && adapter.basePath) return adapter.basePath;
  return null;
} catch { return null; } })()`;

const NOTEBOOK_PROBE = `(() => { try {
  const describe = (el) => {
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return {
      className: String(el.className || ""),
      text: String(el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 180),
      href: el.getAttribute && (el.getAttribute("data-href") || el.getAttribute("href") || ""),
      source: el.getAttribute && el.getAttribute("data-notebook-source"),
      hue: el.getAttribute && (el.getAttribute("data-root-hue") || el.getAttribute("data-hue")),
      stale: el.getAttribute && el.getAttribute("data-stale"),
      kind: el.getAttribute && (el.getAttribute("data-action-kind") || el.getAttribute("data-catalog-state") || el.getAttribute("data-kind")),
      cm: el.getAttribute && el.getAttribute("data-cm-widget"),
      tag: el.tagName,
      w: rect.width,
      h: rect.height,
      visible: rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden",
      embed: Boolean(el.closest && el.closest(".markdown-embed, .internal-embed")),
    };
  };
  const pick = (sel) => Array.from(document.querySelectorAll(sel)).map(describe);
  const file = window.app && window.app.workspace && window.app.workspace.getActiveFile && window.app.workspace.getActiveFile();
  const plugin = window.app && window.app.plugins && window.app.plugins.plugins && window.app.plugins.plugins["bob-ledger-tools"];
  const leafView = window.app && window.app.workspace && window.app.workspace.activeLeaf && window.app.workspace.activeLeaf.view;
  const state = leafView && typeof leafView.getState === "function" ? leafView.getState() : {};
  return {
    path: file && file.path,
    mode: state.mode || null,
    source: state.source,
    headers: pick(".bob-notebook-header"),
    crumbs: pick(".bob-notebook-header a.internal-link, .bob-notebook-crumb a"),
    chips: pick(".bob-notebook-chips"),
    retry: pick(".bob-notebook-retry"),
    sync: pick(".bob-notebook-sync"),
    status: pick(".bob-notebook-status"),
    anchor: pick(".bob-notebook-anchor"),
    addSummary: pick(".bob-notebook-add-summary"),
    callouts: pick('.callout[data-callout="notebooks"]'),
    plugin: Boolean(plugin),
    chipsSetting: plugin && typeof plugin.notebookChipsVisible === "function" ? plugin.notebookChipsVisible() : null,
    active: document.activeElement ? {
      tag: document.activeElement.tagName,
      className: String(document.activeElement.className || ""),
      href: document.activeElement.getAttribute && document.activeElement.getAttribute("data-href"),
    } : null,
  };
} catch (e) { return { error: String(e && e.message || e) }; } })()`;

function markdownViewState(mode) {
  if (mode === "preview" || mode === "reading") return { mode: "preview", source: false };
  return { mode: "source", source: mode === "source" };
}

async function selectOwnedTarget(cdpPort, fixtureRealPath, shouldStop) {
  const deadline = Date.now() + lib.CONNECT_TIMEOUT_MS * 2;
  let lastError = "";
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
    const pages = (Array.isArray(targets) ? targets : []).filter(
      (item) => item && item.type === "page" && item.webSocketDebuggerUrl,
    );
    for (const page of pages) {
      let probeClient = null;
      try {
        probeClient = await CdpClient.connect(page.webSocketDebuggerUrl, 5000);
        const vaultPath = await probeClient.evaluate(VAULT_PATH_PROBE, 5000);
        if (lib.verifyVaultPath(vaultPath, fixtureRealPath)) return page;
      } catch (error) {
        lastError = error && error.message ? error.message : String(error);
      } finally {
        if (probeClient) probeClient.close();
      }
    }
    await sleep(500);
  }
  throw new Error(`no CDP page target reports the fixture vault${lastError ? `; last probe: ${lastError.slice(0, 160)}` : ""}`);
}

async function dismissTrustModal(client) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const clicked = await client.evaluate(`(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const trust = buttons.find((button) => /Trust author and enable plugins/i.test(button.textContent || ""));
      if (!trust) return { clicked: false };
      trust.click();
      return { clicked: true };
    })()`).catch(() => ({ clicked: false }));
    if (clicked && clicked.clicked) {
      await sleep(400);
      return true;
    }
    await sleep(200);
  }
  return false;
}

async function waitFor(client, expression, predicate, label, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await client.evaluate(expression);
      if (predicate(last)) return last;
    } catch (error) {
      last = { error: String(error && error.message || error) };
    }
    await sleep(120);
  }
  throw new Error(`timed out waiting for ${label}: ${JSON.stringify(last)}`);
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
        const current = view.getState && view.getState() || {};
        await view.setState(Object.assign({}, current, wantState), { history: false });
      }
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await new Promise((resolve) => setTimeout(resolve, 350));
      const next = view && view.getState && view.getState() || {};
      return { ok: true, path: view && view.file && view.file.path, mode: next.mode || null, source: next.source };
    })())()`,
    lib.RPC_TIMEOUT_MS,
  );
}

async function capturePage(client, output) {
  const screenshot = await client.call("Page.captureScreenshot", { format: "png", fromSurface: true });
  fs.writeFileSync(output, Buffer.from(screenshot.data, "base64"));
}

async function setViewport(client, width, height) {
  await client.call("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width <= 400,
  });
}

function selfTest() {
  const notes = fixtureNotes();
  const required = ["area.md", "git.md", "ideas.md", "host.md", "h1less.md", "h1child.md", "damaged.md", "child.md"];
  for (const name of required) {
    if (!notes[name] || !String(notes[name]).trim()) throw new Error(`missing fixture note ${name}`);
  }
  if (!notes["area.md"].includes("> [!notebooks]")) throw new Error("area catalog callout missing");
  if (notes["area.md"].includes("bob:notebooks:")) throw new Error("area catalog must not carry markers");
  if (!notes["ideas.md"].includes("summary: \"\"")) throw new Error("ideas must have a blank summary");
  if (!notes["host.md"].includes("![[git]]")) throw new Error("host embed missing");
  if (notes["h1less.md"].includes("# ")) throw new Error("h1less must not have an H1");
  if (!notes["h1child.md"].includes("parent: \"[[h1less]]\"")) throw new Error("h1less must host at least one notebook");
  if (!notes["damaged.md"].includes("bob:notebooks:begin") || notes["damaged.md"].includes("bob:notebooks:end")) {
    throw new Error("damaged catalog must open markers without a close");
  }
  if (!notes["child.md"].includes("parent: \"[[sub]]\"")) throw new Error("child must nest under the project");
  const parsed = parseArgs(["-s", "-o", "/tmp/out", "-r", "/tmp/report.json"]);
  if (!parsed.selfTest || parsed.out !== "/tmp/out" || parsed.report !== "/tmp/report.json") {
    throw new Error("parseArgs failed");
  }
  process.stdout.write("offline self-test complete\n");
}

async function run(args) {
  const executable = findExecutable(args.executable);
  const probed = probeExecutable(executable);
  if (!probed.ok) {
    const report = { pass: false, unrun: true, reason: probed.reason, executable };
    if (args.report) fs.writeFileSync(args.report, JSON.stringify(report, null, 2));
    fail(probed.reason, 2);
  }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "bob-notebook-ui-e2e-"));
  const vaultDir = path.join(scratch, "vault");
  const profileDir = path.join(scratch, "profile");
  const outDir = args.out || path.join(scratch, "shots");
  fs.mkdirSync(outDir, { recursive: true });
  const fixture = buildFixture(vaultDir);
  const vaultRealPath = fs.realpathSync(vaultDir);
  seedProfileVault(profileDir, vaultRealPath);
  const cdpPort = await freePort();
  const report = {
    pass: false,
    executable,
    vault: vaultRealPath,
    checks: [],
    screenshots: [],
    probes: {},
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
    child = spawn(executable, [
      "--no-sandbox",
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${cdpPort}`,
      vaultRealPath,
    ], {
      stdio: "ignore",
      env: { ...process.env, DISPLAY: process.env.DISPLAY || ":99" },
    });
    child.once("exit", (code, signal) => {
      exitInfo = { code, signal };
    });
    const page = await selectOwnedTarget(cdpPort, vaultRealPath, () => Boolean(exitInfo));
    client = await CdpClient.connect(page.webSocketDebuggerUrl, 8000);
    await client.call("Page.enable", {});
    await client.call("Runtime.enable", {});
    await dismissTrustModal(client);
    let loaded = false;
    for (let i = 0; i < 40; i += 1) {
      loaded = await client.evaluate(`(() => Boolean(window.app && window.app.plugins && window.app.plugins.plugins && window.app.plugins.plugins["bob-ledger-tools"]))()`).catch(() => false);
      if (loaded) break;
      await sleep(400);
    }
    record("plugin-loaded", loaded, loaded ? "bob-ledger-tools" : "bob-ledger-tools did not load");
    if (!loaded) throw new Error("bob-ledger-tools did not load in the scratch vault");

    await setViewport(client, 1280, 800);
    const gitLive = await openNote(client, "git.md", "live");
    record("open-git-live", Boolean(gitLive && gitLive.ok), JSON.stringify(gitLive).slice(0, 160));
    const liveHeader = await waitFor(
      client,
      NOTEBOOK_PROBE,
      (value) => value && Array.isArray(value.headers) && value.headers.some((item) => item && item.visible),
      "live-header",
      16_000,
    ).catch(async (error) => {
      const latest = await client.evaluate(NOTEBOOK_PROBE).catch(() => ({ error: error.message }));
      latest.error = error.message;
      return latest;
    });
    report.probes.gitLive = liveHeader;
    const liveVisible = (liveHeader.headers || []).filter((item) => item.visible);
    record("lp-header-one", liveVisible.length === 1, `headers=${liveVisible.length}`);
    record("lp-header-cm", liveVisible.every((item) => item.cm === "true"), JSON.stringify(liveVisible.map((item) => item.cm)));
    record("lp-self-link", (liveHeader.crumbs || []).some((item) => item.tag === "A" && /git/i.test(item.href || item.text || "")), JSON.stringify(liveHeader.crumbs || []).slice(0, 220));
    const shotLpLight = path.join(outDir, "notebook-git-lp-light.png");
    await capturePage(client, shotLpLight);
    report.screenshots.push(shotLpLight);

    await client.evaluate(`(() => { document.body.classList.remove("theme-light"); document.body.classList.add("theme-dark"); return true; })()`);
    await sleep(200);
    const shotLpDark = path.join(outDir, "notebook-git-lp-dark.png");
    await capturePage(client, shotLpDark);
    report.screenshots.push(shotLpDark);
    await client.evaluate(`(() => { document.body.classList.remove("theme-dark"); document.body.classList.add("theme-light"); return true; })()`);

    const gitReading = await openNote(client, "git.md", "preview");
    record("open-git-reading", Boolean(gitReading && gitReading.ok), JSON.stringify(gitReading).slice(0, 160));
    await sleep(600);
    const readingHeader = await waitFor(
      client,
      NOTEBOOK_PROBE,
      (value) => value && Array.isArray(value.headers) && value.headers.some((item) => item && item.visible && item.cm !== "true"),
      "reading-header",
      12_000,
    ).catch(async (error) => {
      const latest = await client.evaluate(NOTEBOOK_PROBE).catch(() => ({ error: error.message }));
      latest.error = error.message;
      return latest;
    });
    report.probes.gitReading = readingHeader;
    const readingVisible = (readingHeader.headers || []).filter((item) => item.visible && item.cm !== "true");
    record("reading-header-one", readingVisible.length === 1, `headers=${readingVisible.length}`);
    const focused = await client.evaluate(`(() => {
      const plugin = window.app && window.app.plugins && window.app.plugins.plugins && window.app.plugins.plugins["bob-ledger-tools"];
      const links = Array.from(document.querySelectorAll(".bob-notebook-header a.internal-link"));
      const link = links.find((el) => {
        const header = el.closest && el.closest(".bob-notebook-header");
        if (!header || header.getAttribute("data-cm-widget") === "true") return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      if (!link) return { ok: false, error: "no visible reading header link" };
      if (typeof link.setAttribute === "function") link.setAttribute("tabindex", "0");
      link.focus();
      try {
        link.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      } catch (error) {
        // FocusEvent may be missing; focus() still records the target.
      }
      const href = link.getAttribute("data-href") || link.getAttribute("href") || "";
      if (plugin) plugin.notebookHeaderLastFocusHref = href;
      if (!plugin || typeof plugin.refreshNotebookHeaderAll !== "function") {
        return { ok: false, error: "refreshNotebookHeaderAll missing", href };
      }
      plugin.refreshNotebookHeaderAll();
      const active = document.activeElement;
      return {
        ok: true,
        href,
        restored: Boolean(active && active.getAttribute && active.getAttribute("data-href") === href),
        active: {
          tag: active && active.tagName,
          className: active && String(active.className || ""),
          href: active && active.getAttribute && active.getAttribute("data-href"),
        },
      };
    })()`);
    record(
      "focus-after-refresh",
      Boolean(focused && focused.ok && focused.restored && focused.active && focused.active.href === focused.href),
      JSON.stringify(focused).slice(0, 220),
    );
    const shotReading = path.join(outDir, "notebook-git-reading-light.png");
    await capturePage(client, shotReading);
    report.screenshots.push(shotReading);

    await openNote(client, "area.md", "preview");
    await sleep(700);
    const catalog = await waitFor(
      client,
      NOTEBOOK_PROBE,
      (value) => value && Array.isArray(value.callouts) && value.callouts.length > 0,
      "area-catalog",
      12_000,
    ).catch(async (error) => {
      const latest = await client.evaluate(NOTEBOOK_PROBE).catch(() => ({ error: error.message }));
      latest.error = error.message;
      return latest;
    });
    report.probes.area = catalog;
    record("catalog-callout", (catalog.callouts || []).some((item) => item.visible), JSON.stringify(catalog.callouts || []).slice(0, 180));
    record("catalog-chips", (catalog.chips || []).length > 0, `chips=${(catalog.chips || []).length}`);
    record("add-summary", (catalog.addSummary || []).length > 0, `add=${(catalog.addSummary || []).length}`);
    record("catalog-hue", (catalog.callouts || []).some((item) => item.hue), JSON.stringify((catalog.callouts || []).map((item) => item.hue)));
    const shotCatalog = path.join(outDir, "notebook-area-reading-light.png");
    await capturePage(client, shotCatalog);
    report.screenshots.push(shotCatalog);

    await setViewport(client, 375, 812);
    await sleep(250);
    const narrow = await client.evaluate(NOTEBOOK_PROBE);
    report.probes.areaNarrow = narrow;
    const overflow = (narrow.chips || []).some((chip) => chip.w > 375);
    record("narrow-375-chips", !overflow, JSON.stringify((narrow.chips || []).map((chip) => chip.w)).slice(0, 160));
    const shotNarrow = path.join(outDir, "notebook-area-375.png");
    await capturePage(client, shotNarrow);
    report.screenshots.push(shotNarrow);
    await setViewport(client, 1280, 800);

    await openNote(client, "host.md", "preview");
    await sleep(700);
    const embed = await client.evaluate(NOTEBOOK_PROBE);
    report.probes.hostEmbed = embed;
    const embedHeaders = (embed.headers || []).filter((item) => item.visible);
    record("embed-header-in-embed", embedHeaders.length >= 1 && embedHeaders.every((item) => item.embed), JSON.stringify(embedHeaders).slice(0, 220));
    const shotEmbed = path.join(outDir, "notebook-embed-reading.png");
    await capturePage(client, shotEmbed);
    report.screenshots.push(shotEmbed);

    await openNote(client, "h1less.md", "preview");
    await sleep(700);
    const h1less = await client.evaluate(NOTEBOOK_PROBE);
    report.probes.h1less = h1less;
    record(
      "h1less-action",
      (h1less.anchor || []).length > 0 || (h1less.sync || []).length > 0 || (h1less.retry || []).length > 0,
      JSON.stringify({ anchor: h1less.anchor, sync: h1less.sync, retry: h1less.retry }).slice(0, 240),
    );

    await openNote(client, "damaged.md", "preview");
    await sleep(700);
    const damaged = await client.evaluate(NOTEBOOK_PROBE);
    report.probes.damaged = damaged;
    record(
      "damaged-action",
      (damaged.sync || []).length > 0 || (damaged.status || []).length > 0 || (damaged.retry || []).length > 0,
      JSON.stringify({ sync: damaged.sync, status: damaged.status, retry: damaged.retry }).slice(0, 240),
    );

    await openNote(client, "git.md", "source");
    await sleep(400);
    const sourceMode = await client.evaluate(NOTEBOOK_PROBE);
    report.probes.gitSource = sourceMode;
    record("source-no-header", (sourceMode.headers || []).filter((item) => item.visible).length === 0, `headers=${(sourceMode.headers || []).length}`);

    const failures = report.checks.filter((item) => !item.ok);
    report.pass = failures.length === 0;
    report.failures = failures.map((item) => item.name);
    if (args.report) fs.writeFileSync(args.report, JSON.stringify(report, null, 2));
    process.stdout.write(`${report.pass ? "PASS" : "FAIL"} notebook UI e2e (${report.checks.length} checks, ${failures.length} failed)\n`);
    if (!report.pass) process.exitCode = 1;
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
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${HELP_TEXT}\n`);
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
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  process.exit(code);
});
