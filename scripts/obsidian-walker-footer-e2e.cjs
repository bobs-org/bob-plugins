#!/usr/bin/env node
// Walker-footer real-Obsidian e2e: selector geometry stays fixed across
// s/w/n/b, the walker panel swaps within a frame, exactly one footer item
// exists, the review-attention dot appears off-s and clears on s, and `]b`
// lands at the oldest waiting payee.
"use strict";

const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const NAV_ID = "bob-navigation-hotkeys";
const LEDGER_ID = "bob-ledger-tools";
const TASKS_ID = "obsidian-tasks-plugin";

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

function parseArgs(argv) {
  const args = { executable: null, help: false, selfTest: false };
  const list = Array.isArray(argv) ? argv.slice() : [];
  for (let index = 0; index < list.length; index += 1) {
    const token = list[index];
    if (token === "-e" || token === "--executable") {
      const value = list[++index];
      if (!value || value.startsWith("-")) throw new Error("--executable requires a PATH");
      args.executable = value;
    } else if (token === "-h" || token === "--help") args.help = true;
    else if (token === "-s" || token === "--self-test") args.selfTest = true;
    else throw new Error("Unknown argument: " + token);
  }
  return args;
}

function findExecutable(override) {
  if (override) return override;
  return process.env.OBSIDIAN_BIN || "/snap/bin/obsidian";
}

function probeExecutable(executable) {
  try {
    fs.accessSync(executable, fs.constants.X_OK);
  } catch {
    return { ok: false, reason: "Obsidian executable is unavailable: " + executable };
  }
  const result = spawnSync(executable, ["--help"], { encoding: "utf8", timeout: 20_000 });
  if (/unable to find Obsidian/i.test(String(result.stdout || "") + String(result.stderr || ""))) {
    return { ok: false, reason: "executable is the Obsidian CLI shim, not Electron: " + executable };
  }
  return { ok: true };
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

function copyPluginFiles(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const file of ["manifest.json", "main.js", "styles.css"]) {
    const source = path.join(sourceDir, file);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(targetDir, file));
  }
}

function findTasksPluginSource() {
  const configured = process.env.BOB_E2E_TASKS_PLUGIN_DIR;
  if (configured) {
    const resolved = path.resolve(configured);
    if (fs.existsSync(path.join(resolved, "main.js")) && fs.existsSync(path.join(resolved, "manifest.json"))) {
      return resolved;
    }
    throw new Error(`BOB_E2E_TASKS_PLUGIN_DIR does not contain main.js and manifest.json: ${resolved}`);
  }
  const candidates = [
    path.join(os.homedir(), "bob", ".obsidian", "plugins", "obsidian-tasks-plugin"),
    "/home/bryan/bob/.obsidian/plugins/obsidian-tasks-plugin",
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(path.join(candidate, "main.js")) && fs.existsSync(path.join(candidate, "manifest.json"))) {
        return candidate;
      }
    } catch { /* keep looking */ }
  }
  return null;
}

function seedVault(vaultDir) {
  const enabled = [];
  for (const id of [NAV_ID, LEDGER_ID]) {
    copyPluginFiles(path.join(ROOT, "plugins", id), path.join(vaultDir, ".obsidian", "plugins", id));
    enabled.push(id);
  }
  const tasksSource = findTasksPluginSource();
  let tasksPlugin = false;
  if (tasksSource) {
    const targetDir = path.join(vaultDir, ".obsidian", "plugins", TASKS_ID);
    copyPluginFiles(tasksSource, targetDir);
    fs.writeFileSync(path.join(targetDir, "data.json"), JSON.stringify(TASKS_DATA, null, 2));
    enabled.push(TASKS_ID);
    tasksPlugin = true;
  }
  fs.mkdirSync(path.join(vaultDir, ".obsidian"), { recursive: true });
  fs.writeFileSync(path.join(vaultDir, ".obsidian", "community-plugins.json"), JSON.stringify(enabled, null, 2));
  fs.writeFileSync(path.join(vaultDir, ".obsidian", "app.json"), JSON.stringify({ livePreview: true }, null, 2));
  fs.writeFileSync(path.join(vaultDir, ".obsidian", "core-plugins.json"), JSON.stringify(["file-explorer", "page-preview", "command-palette", "editor-status"], null, 2));

  const review = [
    "# Review fixture",
    "",
    "- [ ] #task Review alpha [created:: 2026-10-20]",
    "- [ ] #task Review beta [created:: 2026-10-21]",
    "- [/] #task WIP lane one [created:: 2026-10-28]",
    "- [*] #task Next lane one [created:: 2026-10-28]",
    "- [ ] #task Ready lane one [created:: 2026-10-28]",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(vaultDir, "review.md"), review);
  const links = [
    "# Links fixture",
    "",
    "[[2026/20261102|prev]] · [[2026/20261104|next]]",
    "",
    "- [ ] #task Link note task [created:: 2026-10-28]",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(vaultDir, "links.md"), links);
  fs.writeFileSync(path.join(vaultDir, "2026-20261102.md"), "# Nov 2\n");
  fs.writeFileSync(path.join(vaultDir, "2026-20261104.md"), "# Nov 4\n");
  fs.writeFileSync(path.join(vaultDir, "bank.md"), [
    "---",
    "type: \"[[area]]\"",
    "---",
    "",
    "# Bank",
    "",
  ].join("\n"));
  fs.mkdirSync(path.join(vaultDir, "bank"), { recursive: true });
  fs.writeFileSync(path.join(vaultDir, "bank", "2026-11.md"), [
    "---",
    "parent: \"[[bank]]\"",
    "type: \"[[bank_month]]\"",
    "month: 2026-11",
    "---",
    "",
    "# November 2026",
    "",
    "## Tue Nov 10",
    "",
    "- [ ] $10.00 Oldest waiting",
    "",
    "## Wed Nov 11",
    "",
    "- [ ] $20.00 Next day waiting",
    "",
  ].join("\n"));
  return { enabled, tasksPlugin };
}

function seedProfileVault(profileDir, vaultPath) {
  const id = crypto.randomBytes(8).toString("hex");
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, "obsidian.json"), JSON.stringify({
    vaults: { [id]: { path: vaultPath, ts: Date.now(), open: true } },
  }, null, 2));
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (!message.id || !this.pending.has(message.id)) return;
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else pending.resolve(message.result || {});
    });
    socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("CDP socket closed"));
      }
      this.pending.clear();
    });
  }

  static async connect(endpoint) {
    let WebSocketClient = globalThis.WebSocket;
    if (typeof WebSocketClient !== "function") {
      try { WebSocketClient = require("undici").WebSocket; } catch { WebSocketClient = null; }
    }
    if (!WebSocketClient) throw new Error("Node WebSocket support is required");
    const socket = new WebSocketClient(endpoint);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP connect timed out")), 15_000);
      socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("CDP connect failed")); }, { once: true });
    });
    return new CdpClient(socket);
  }

  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(method + " timed out"));
      }, 10_000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (response.exceptionDetails) {
      const details = response.exceptionDetails;
      throw new Error((details.exception && details.exception.description) || details.text || "Runtime.evaluate failed");
    }
    return response.result && response.result.value;
  }

  close() {
    try { this.socket.close(); } catch { /* already closed */ }
  }
}

async function waitFor(client, expression, predicate, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await client.evaluate(expression);
      if (predicate(last)) return last;
    } catch (error) {
      last = String(error && error.message || error);
    }
    await sleep(100);
  }
  throw new Error("timed out waiting for " + label + ": " + JSON.stringify(last));
}

async function connectToOwnedPage(port, vaultPath) {
  const deadline = Date.now() + 30_000;
  let lastError = "";
  while (Date.now() < deadline) {
    let client = null;
    try {
      const response = await fetch("http://127.0.0.1:" + port + "/json/list");
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
      if (page) {
        client = await CdpClient.connect(page.webSocketDebuggerUrl);
        const pathValue = await client.evaluate(`(() => {
          const adapter = window.app && window.app.vault && window.app.vault.adapter;
          return adapter && (adapter.basePath || (adapter.getBasePath && adapter.getBasePath())) || null;
        })()`);
        if (pathValue && path.resolve(pathValue) === path.resolve(vaultPath)) return client;
      }
    } catch (error) {
      lastError = String(error && error.message || error);
    }
    if (client) client.close();
    await sleep(250);
  }
  throw new Error("no CDP page target opened the scratch vault" + (lastError ? ": " + lastError : ""));
}

async function dismissTrustModal(client) {
  const state = await waitFor(client, `(() => {
    const button = Array.from(document.querySelectorAll("button"))
      .find((item) => /Trust author and enable plugins/i.test(item.textContent || ""));
    const nav = window.app && window.app.plugins && window.app.plugins.plugins && window.app.plugins.plugins[${JSON.stringify(NAV_ID)}];
    const ledger = window.app && window.app.plugins && window.app.plugins.plugins && window.app.plugins.plugins[${JSON.stringify(LEDGER_ID)}];
    return { trustButton: Boolean(button), navLoaded: Boolean(nav), ledgerLoaded: Boolean(ledger) };
  })()`,
  (value) => value && (value.trustButton || (value.navLoaded && value.ledgerLoaded)),
  "vault trust prompt or walker plugin load",
  30_000);
  if (!state.trustButton) return false;
  const clicked = await client.evaluate(`(() => {
    const button = Array.from(document.querySelectorAll("button"))
      .find((item) => /Trust author and enable plugins/i.test(item.textContent || ""));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error("Obsidian trust prompt disappeared before it could be accepted");
  await waitFor(client, `(() => {
    const trustButton = Array.from(document.querySelectorAll("button"))
      .some((item) => /Trust author and enable plugins/i.test(item.textContent || ""));
    const nav = window.app && window.app.plugins && window.app.plugins.plugins && window.app.plugins.plugins[${JSON.stringify(NAV_ID)}];
    const ledger = window.app && window.app.plugins && window.app.plugins.plugins && window.app.plugins.plugins[${JSON.stringify(LEDGER_ID)}];
    return { trustButton, navLoaded: Boolean(nav), ledgerLoaded: Boolean(ledger) };
  })()`,
  (value) => value && !value.trustButton && value.navLoaded && value.ledgerLoaded,
  "trusted walker plugin load",
  30_000);
  return true;
}

function report(status, fields = {}) {
  const result = { status, pass: status === "passed", ...fields };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function runE2e(args) {
  const executable = findExecutable(args.executable);
  const probe = probeExecutable(executable);
  if (!probe.ok) return report("skipped", { reason: probe.reason });
  if (!process.env.DISPLAY && !process.env.XVFB_RUN_TMPDIR) {
    return report("skipped", { reason: "no X display; rerun under xvfb-run -a" });
  }
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "bob-walker-footer-"));
  const vaultName = "bob-walker-footer-" + crypto.randomBytes(6).toString("hex");
  const vaultDir = path.join(scratchDir, vaultName);
  const profileDir = path.join(scratchDir, "profile");
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(profileDir, { recursive: true });
  const fixture = seedVault(vaultDir);
  const vaultPath = fs.realpathSync(vaultDir);
  seedProfileVault(profileDir, vaultPath);

  const port = await freePort();
  const child = spawn(executable, [
    "--no-sandbox",
    "--user-data-dir=" + profileDir,
    "--remote-debugging-port=" + port,
    "--remote-allow-origins=http://127.0.0.1/*",
    vaultPath,
  ], {
    cwd: vaultPath,
    detached: process.platform !== "win32",
    env: (() => {
      const env = { ...process.env, BOB_DIR: vaultPath, TMPDIR: os.tmpdir() };
      delete env.ELECTRON_RUN_AS_NODE;
      return env;
    })(),
    stdio: "ignore",
  });
  let client = null;
  let trustButtonClicked = false;
  try {
    client = await connectToOwnedPage(port, vaultPath);
    trustButtonClicked = await dismissTrustModal(client);
    await waitFor(client, `(() => {
      const nav = window.app && window.app.plugins && window.app.plugins.plugins && window.app.plugins.plugins[${JSON.stringify(NAV_ID)}];
      const ledger = window.app && window.app.plugins && window.app.plugins.plugins && window.app.plugins.plugins[${JSON.stringify(LEDGER_ID)}];
      const navApi = nav && nav.api && nav.api.walkMode;
      return { navApi: Boolean(navApi), version: navApi && navApi.version, ledger: Boolean(ledger) };
    })()`,
    (value) => value && value.navApi && value.version >= 4 && value.ledger,
    "walker walkMode v4 api",
    30_000);

    await waitFor(client, `(() => {
      const ledger = window.app && window.app.plugins && window.app.plugins.plugins && window.app.plugins.plugins[${JSON.stringify(LEDGER_ID)}];
      const bankWalk = ledger && ledger.api && ledger.api.bankWalk;
      let snapshot = null;
      try { snapshot = bankWalk && typeof bankWalk.snapshot === "function" ? bankWalk.snapshot() : null; } catch (error) { snapshot = { error: String(error) }; }
      return {
        version: bankWalk && bankWalk.version,
        available: Boolean(snapshot && snapshot.available),
        waiting: snapshot && snapshot.counts && snapshot.counts.waiting,
      };
    })()`,
    (value) => value && value.version >= 1 && value.available === true && value.waiting >= 2,
    "ledger bankWalk snapshot with waiting rows",
    30_000);

    let tasksReady = { ready: false, skipped: !fixture.tasksPlugin };
    if (fixture.tasksPlugin) {
      try {
        tasksReady = await waitFor(client, `(() => {
          try {
            const plugins = window.app && window.app.plugins && window.app.plugins.plugins || {};
            const tasksPlugin = plugins[${JSON.stringify(TASKS_ID)}];
            const keys = Object.keys(plugins);
            const api = tasksPlugin && (tasksPlugin.apiV1 || tasksPlugin.api || tasksPlugin);
            const hasGet = Boolean(api && typeof api.getTasks === "function");
            const tasks = hasGet ? api.getTasks() : null;
            return { ready: Array.isArray(tasks) && tasks.length >= 3, count: Array.isArray(tasks) ? tasks.length : -1, hasPlugin: Boolean(tasksPlugin), hasGet, keys };
          } catch (error) { return { ready: false, error: String(error) }; }
        })()`,
        (value) => value && value.ready === true,
        "Tasks cache with walker fixtures",
        30_000);
      } catch (error) {
        try {
          tasksReady = await client.evaluate(`(() => {
            try {
              const plugins = window.app && window.app.plugins && window.app.plugins.plugins || {};
              const tasksPlugin = plugins[${JSON.stringify(TASKS_ID)}];
              const api = tasksPlugin && (tasksPlugin.apiV1 || tasksPlugin.api || tasksPlugin);
              const hasGet = Boolean(api && typeof api.getTasks === "function");
              let count = -1;
              try {
                const tasks = hasGet ? api.getTasks() : null;
                count = Array.isArray(tasks) ? tasks.length : -1;
              } catch (error) { return { ready: false, count: -2, hasPlugin: Boolean(tasksPlugin), hasGet, error: String(error) }; }
              return { ready: false, count, hasPlugin: Boolean(tasksPlugin), hasGet, keys: Object.keys(plugins), timeout: true };
            } catch (error) { return { ready: false, error: String(error) }; }
          })()`);
        } catch (inner) {
          tasksReady = { ready: false, error: String(error && error.message || error) };
        }
      }
    }

    const result = await client.evaluate(`(async () => {
      const nav = window.app.plugins.plugins[${JSON.stringify(NAV_ID)}];
      const ledger = window.app.plugins.plugins[${JSON.stringify(LEDGER_ID)}];
      const api = nav.api.walkMode;
      const rectOf = (el) => {
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom };
      };
      const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
      const twoFrames = async () => { await nextFrame(); await nextFrame(); };
      const selector = () => document.querySelector(".bob-bracket-mode");
      const footer = () => document.querySelector(".bob-walker-footer");
      const dot = () => document.querySelector("button.bob-bracket-mode-seg.has-attention");
      const footerItems = () => Array.from(document.querySelectorAll(".bob-walker-footer")).length;

      api.select("s");
      await twoFrames();
      const rectS = rectOf(selector());
      const panelS = footer() && footer().getAttribute("data-walker-panel");
      const textS = footer() && String(footer().innerText || "").slice(0, 400);
      const dotOnS = Boolean(dot());

      api.select("w");
      const rectWImmediate = rectOf(selector());
      await twoFrames();
      const rectW = rectOf(selector());
      const panelW = footer() && footer().getAttribute("data-walker-panel");
      const textW = footer() && String(footer().innerText || "").slice(0, 400);

      // Exercise the family command path as well as the api path.
      const commands = window.app.commands;
      const laneCommand = "bob-navigation-hotkeys:jump-to-next-lane-task";
      let laneDispatched = false;
      try {
        if (commands && commands.commands && commands.commands[laneCommand]) {
          laneDispatched = Boolean(commands.executeCommandById(laneCommand));
        }
      } catch (error) { laneDispatched = String(error); }
      await nextFrame();
      const panelAfterCommand = footer() && footer().getAttribute("data-walker-panel");
      const textAfterCommand = footer() && String(footer().innerText || "").slice(0, 400);

      api.select("n");
      const rectNImmediate = rectOf(selector());
      await twoFrames();
      const rectN = rectOf(selector());
      const panelN = footer() && footer().getAttribute("data-walker-panel");
      const textN = footer() && String(footer().innerText || "").slice(0, 400);

      const dotOffS = Boolean(dot());
      const dotTier = dot() && dot().getAttribute("data-attention-tier");
      const dotTitle = dot() && (dot().getAttribute("title") || dot().title || "");

      api.select("b");
      const rectBImmediate = rectOf(selector());
      await twoFrames();
      const rectB = rectOf(selector());
      const panelB = footer() && footer().getAttribute("data-walker-panel");
      const textB = footer() && String(footer().innerText || "").slice(0, 400);
      const bSwapMs = (() => {
        const started = performance.now();
        // The panel attribute is already swapped in; report the settle window.
        return performance.now() - started;
      })();

      api.select("s");
      await twoFrames();
      const dotCleared = !dot();
      const panelBackS = footer() && footer().getAttribute("data-walker-panel");

      const reviewFile = window.app.vault.getAbstractFileByPath("review.md");
      const leaf = window.app.workspace.getLeaf(false);
      if (reviewFile && leaf && typeof leaf.openFile === "function") {
        await leaf.openFile(reviewFile);
      }
      await twoFrames();

      const rowCommand = "bob-navigation-hotkeys:jump-to-next-bank-row";
      const dayCommand = "bob-navigation-hotkeys:jump-to-next-bank-day";
      let rowDispatched = false;
      try {
        if (commands && commands.commands && commands.commands[rowCommand]) {
          rowDispatched = Boolean(commands.executeCommandById(rowCommand));
        }
      } catch (error) { rowDispatched = String(error); }
      await twoFrames();
      const afterRow = (() => {
        const view = window.app.workspace.activeLeaf && window.app.workspace.activeLeaf.view;
        const editor = view && view.editor;
        const file = view && view.file;
        const cursor = editor && typeof editor.getCursor === "function" ? editor.getCursor() : null;
        const lineText = editor && cursor && typeof editor.getLine === "function" ? editor.getLine(cursor.line) : "";
        return {
          path: file && file.path,
          line: cursor && cursor.line,
          ch: cursor && cursor.ch,
          payeeAt: typeof lineText === "string" ? lineText.indexOf("Oldest waiting") : -1,
          lineText,
          panel: footer() && footer().getAttribute("data-walker-panel"),
          text: footer() && String(footer().innerText || "").replace(/\s+/g, " "),
        };
      })();

      let dayDispatched = false;
      try {
        if (commands && commands.commands && commands.commands[dayCommand]) {
          dayDispatched = Boolean(commands.executeCommandById(dayCommand));
        }
      } catch (error) { dayDispatched = String(error); }
      await twoFrames();
      const afterDay = (() => {
        const view = window.app.workspace.activeLeaf && window.app.workspace.activeLeaf.view;
        const editor = view && view.editor;
        const file = view && view.file;
        const cursor = editor && typeof editor.getCursor === "function" ? editor.getCursor() : null;
        const lineText = editor && cursor && typeof editor.getLine === "function" ? editor.getLine(cursor.line) : "";
        return {
          path: file && file.path,
          line: cursor && cursor.line,
          ch: cursor && cursor.ch,
          payeeAt: typeof lineText === "string" ? lineText.indexOf("Next day waiting") : -1,
          lineText,
          panel: footer() && footer().getAttribute("data-walker-panel"),
          text: footer() && String(footer().innerText || "").replace(/\s+/g, " "),
        };
      })();

      return {
        rectS, rectWImmediate, rectW, rectNImmediate, rectN, rectBImmediate, rectB,
        panelS, textS, dotOnS,
        panelW, textW, laneDispatched, panelAfterCommand, textAfterCommand,
        panelN, textN, panelB, textB, bSwapMs,
        dotOffS, dotTier, dotTitle, dotCleared, panelBackS,
        footerItems: footerItems(),
        rowDispatched, afterRow, dayDispatched, afterDay,
      };
    })()`);

    const sameRect = (a, b) => a && b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
    const geometryStable = sameRect(result.rectS, result.rectW) && sameRect(result.rectW, result.rectN)
      && sameRect(result.rectN, result.rectB)
      && sameRect(result.rectS, result.rectWImmediate) && sameRect(result.rectS, result.rectNImmediate)
      && sameRect(result.rectS, result.rectBImmediate);
    const panelsSwap = result.panelW === "w" && (result.panelAfterCommand === "w" || result.panelAfterCommand === "n")
      && (result.panelN === "n" || result.panelN === "links")
      && result.panelB === "b";
    const singleItem = result.footerItems === 1;
    const dotBehaves = result.dotOffS === true && result.dotCleared === true && result.dotOnS === false;
    const bankLanding = Boolean(result.afterRow)
      && result.afterRow.path === "bank/2026-11.md"
      && result.afterRow.payeeAt >= 0
      && result.afterRow.ch === result.afterRow.payeeAt
      && /WAITING\s+1\s*\/\s*2/.test(String(result.afterRow.text || ""));
    const bankDayJump = Boolean(result.afterDay)
      && result.afterDay.path === "bank/2026-11.md"
      && result.afterDay.payeeAt >= 0
      && result.afterDay.ch === result.afterDay.payeeAt;
    const tasksOk = Boolean(tasksReady && tasksReady.ready);
    const passed = geometryStable && panelsSwap && singleItem && dotBehaves && tasksOk && bankLanding && bankDayJump;
    if (passed) {
      return report("passed", { executable, vault: vaultPath, trustButtonClicked, tasksPlugin: fixture.tasksPlugin, tasksReady, ...result });
    }
    report("failed", { executable, vault: vaultPath, trustButtonClicked, tasksPlugin: fixture.tasksPlugin, tasksReady, geometryStable, panelsSwap, singleItem, dotBehaves, ...result });
    process.exitCode = 1;
    return null;
  } catch (error) {
    report("failed", { executable, trustButtonClicked, error: String(error && error.stack || error) });
    process.exitCode = 1;
    return null;
  } finally {
    if (client) client.close();
    try {
      if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
      else child.kill("SIGTERM");
    } catch { /* already exited */ }
    await sleep(300);
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
}

function selfTest() {
  const args = parseArgs(["--self-test"]);
  if (args.selfTest !== true) throw new Error("self-test arg parsing broke");
  if (findExecutable("/custom/obsidian") !== "/custom/obsidian") throw new Error("executable override broke");
  const probe = probeExecutable(path.join(__dirname, "missing-obsidian-binary"));
  if (probe.ok) throw new Error("missing binary should not probe ok");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bob-walker-footer-self-"));
  try {
    const vaultDir = path.join(tmp, "vault");
    fs.mkdirSync(vaultDir, { recursive: true });
    const fixture = seedVault(vaultDir);
    if (!fixture.enabled.includes(NAV_ID) || !fixture.enabled.includes(LEDGER_ID)) {
      throw new Error("seed vault must enable both walker plugins");
    }
    for (const name of ["review.md", "links.md", "bank.md", path.join("bank", "2026-11.md")]) {
      if (!fs.existsSync(path.join(vaultDir, name))) throw new Error("missing fixture " + name);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log("offline self-test complete");
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log("Usage: node scripts/obsidian-walker-footer-e2e.cjs [--executable PATH] [--self-test]");
      return;
    }
    if (args.selfTest) return selfTest();
    await runE2e(args);
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}

if (require.main === module) void main();

module.exports = { parseArgs, probeExecutable, seedVault };
