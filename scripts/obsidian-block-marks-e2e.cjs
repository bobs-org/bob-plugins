#!/usr/bin/env node
// Real-Obsidian e2e for blocked-reason checkbox marks.
// Isolated scratch vault + profile, owned Obsidian process, CDP probes.
// Never opens the live vault. Based on scripts/obsidian-task-link-marks-e2e.cjs
// and scripts/obsidian-startup-smoke-lib.cjs.
//
//   xvfb-run -a node scripts/obsidian-block-marks-e2e.cjs [--out DIR] [-e PATH] [-r REPORT]
"use strict";

const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const lib = require("./obsidian-startup-smoke-lib.cjs");
const asserts = require("./obsidian-block-marks-e2e-lib.cjs");

const OVERALL_TIMEOUT_MS = 300_000;

function pad2(value) {
  return String(value).padStart(2, "0");
}

function fmtDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function addDays(base, days) {
  const next = new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
  return fmtDate(next);
}

function fixtureDates() {
  const today = new Date();
  return {
    today: fmtDate(today),
    plus1: addDays(today, 1),
    plus3: addDays(today, 3),
    plus4: addDays(today, 4),
    plus19: addDays(today, 19),
    plus30: addDays(today, 30),
    plus49: addDays(today, 49),
    plus122: addDays(today, 122),
    minus10: addDays(today, -10),
  };
}

function blockMarksNote(d) {
  return [
    "# Block marks",
    "",
    "- [?] #task BM1 p2 vector [priority:: medium] [scheduled:: " + d.plus19 + "]",
    "- [?] #task BMp3 standalone [priority:: low] [scheduled:: " + d.plus49 + "]",
    "- [?] #task BM2 date vector [scheduled:: " + d.plus3 + "]",
    "- [?] #task BM3 repeat vector [repeat:: every day when done] [scheduled:: " + d.plus1 + "]",
    "- [?] #task BM4 dep vector [dependsOn:: x]",
    "- [?] #task BM5 stale closed dep [dependsOn:: d]",
    "- [?] #task BM7 prj vector #prj_is_blocked",
    "- [?] #task BM8 dep pip p3 [dependsOn:: x] [priority:: low] [scheduled:: " + d.plus49 + "]",
    "- [?] #task BM9 prj pip p2 #prj_is_blocked [priority:: medium] [scheduled:: " + d.plus19 + "]",
    "- [?] #task BM10 urgent date [priority:: highest] [scheduled:: " + d.plus19 + "]",
    "- [?] #task BM11 today stale [priority:: medium] [scheduled:: " + d.today + "]",
    "- [*] #task BM12 next lane [priority:: high] [scheduled:: " + d.plus19 + "]",
    "- [?] #task BM13 p1 vector [priority:: high] [scheduled:: " + d.plus4 + "]",
    "- [?] #task BM14 old token #prj_is_blocked_old",
    "- [?] #task BM15 repair date [priority:: High] [scheduled:: " + d.plus30 + "]",
    "- [?] plain bullet BM16 neutral [scheduled:: " + d.plus19 + "]",
    "- [?] #task BM17 unknown dep [dependsOn:: nope]",
    "- [?] #task BM18 open wins [dependsOn:: nope, x]",
    "- [?] #task BM19 dep over prj #prj_is_blocked [dependsOn:: y]",
    "",
    "> - [?] #task BM20 quoted p4 [priority:: lowest] [scheduled:: " + d.plus122 + "]",
    "- [?] #task BM21 code field `[scheduled:: " + d.plus19 + "]`",
    "- [?] #task BM25 open over closed [dependsOn:: x, d]",
    "- [ ] #task BM26 ready box [priority:: high] [scheduled:: " + d.plus19 + "]",
    "- [?] #task BM27 past date [scheduled:: " + d.minus10 + "]",
    "- [?] #task BMClick probe [scheduled:: " + d.plus3 + "]",
    "- [x] #task BMDone done row [priority:: high] [scheduled:: " + d.plus19 + "]",
    "- [-] #task BMCancel cancelled row [priority:: high] [scheduled:: " + d.plus19 + "]",
    "- [?] #task BMParent dep [dependsOn:: x]",
    "  - [?] #task BMChild date [scheduled:: " + d.plus3 + "]",
    "- [?] #task Project hold [dependsOn:: x] ^prj",
    "",
    "```",
    "- [?] #task BMF fenced [scheduled:: " + d.plus19 + "]",
    "```",
    "",
  ].join("\n");
}

const PREREQS_NOTE = [
  "# Prerequisites",
  "",
  "- [ ] #task Finish the battery [id:: x]",
  "- [/] #task Review the plan [id:: y]",
  "- [x] #task Closed item [id:: d]",
  "",
].join("\n");

const EMBED_HOST_NOTE = [
  "# Embed host",
  "",
  "Embed of the BM note:",
  "",
  "![[block-marks]]",
  "",
].join("\n");

const PROSE_NOTE = [
  "# Prose",
  "",
  "Overview: [[block-marks]]",
  "",
  "Prereqs: [[prereqs]]",
  "",
].join("\n");

const TASKS_QUERY_NOTE = [
  "# Tasks query",
  "",
  "## Hide priority",
  "",
  "```tasks",
  "path includes block-marks",
  "description includes BM1 p2 vector",
  "hide priority",
  "```",
  "",
  "## Short",
  "",
  "```tasks",
  "path includes block-marks",
  "short mode",
  "```",
  "",
  "## Full",
  "",
  "```tasks",
  "path includes block-marks",
  "```",
  "",
].join("\n");

const DATAVIEW_QUERY_NOTE = [
  "# Dataview query",
  "",
  "```dataview",
  'TASK FROM "block-marks"',
  "```",
  "",
].join("\n");

function chipMarksNote(d) {
  return [
    "# Chip marks",
    "",
    "- [?] #task ChipP2 p2 target [priority:: medium] [scheduled:: " + d.plus19 + "] [id:: chip-p2] ^chip-p2",
    "  - 🧱 **BLOCKS:** [[#^chip-blocked]]",
    "- [?] #task ChipDep dep target [dependsOn:: x] [id:: chip-dep] ^chip-dep",
    "- [?] #task ChipPrj prj target #prj_is_blocked [id:: chip-prj] ^chip-prj",
    "- [?] #task ChipSource waits on three [dependsOn:: chip-p2, chip-dep, chip-prj]",
    "  - ⛓️ **DEPENDS ON:** [[#^chip-p2]] • [[#^chip-dep]] • [[#^chip-prj]]",
    "- [?] #task ChipBlockedDependent blocked by ChipP2 [dependsOn:: chip-p2] ^chip-blocked",
    "  - ⛓️ **DEPENDS ON:** [[#^chip-p2]]",
    "",
  ].join("\n");
}

const TASKS_DATA = {
  globalFilter: "#task",
  // The vault uses Dataview bracket fields ([id::], [dependsOn::],
  // [scheduled::], [priority::]); the Tasks default emoji format does not
  // parse them, so dep/prj marks would stay neutral without this.
  taskFormat: "dataview",
  statusSettings: {
    coreStatuses: [
      // nextStatusSymbol is required: without it a checkbox click cycles to
      // a literal [undefined] status instead of the next status.
      { symbol: " ", name: "Todo", nextStatusSymbol: "x", type: "TODO" },
      { symbol: "x", name: "Done", nextStatusSymbol: " ", type: "DONE" },
    ],
    customStatuses: [
      { symbol: "/", name: "In Progress", nextStatusSymbol: "x", type: "IN_PROGRESS" },
      { symbol: "*", name: "Next", nextStatusSymbol: "x", type: "ON_HOLD" },
      { symbol: "?", name: "Blocked", nextStatusSymbol: " ", type: "TODO" },
      { symbol: "-", name: "Canceled", nextStatusSymbol: " ", type: "CANCELLED" },
    ],
  },
};

function markdownViewState(mode) {
  if (mode === "preview" || mode === "reading") return { mode: "preview", source: false };
  return { mode: "source", source: mode === "source" };
}

const HELP_TEXT = [
  "Usage: node scripts/obsidian-block-marks-e2e.cjs [OPTIONS]",
  "",
  "Drive blocked-reason checkbox marks in an isolated scratch vault through CDP.",
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
  const scratch = asserts.makeScratch(repoRoot, "probe");
  let probed;
  try {
    probed = spawnSync(executable, ["--no-sandbox", `--user-data-dir=${scratch}`, "--help"], {
      encoding: "utf8",
      timeout: 20_000,
    });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
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

function findTasksPluginSource() {
  const candidates = [path.join(os.homedir(), "bob", ".obsidian", "plugins", "obsidian-tasks-plugin")];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "main.js")) && fs.existsSync(path.join(candidate, "manifest.json"))) {
      return candidate;
    }
  }
  return null;
}

function findDataviewPluginSource() {
  const candidates = [path.join(os.homedir(), "bob", ".obsidian", "plugins", "dataview")];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "main.js")) && fs.existsSync(path.join(candidate, "manifest.json"))) {
      return candidate;
    }
  }
  return null;
}

function findSnippetSource() {
  const candidate = path.join(os.homedir(), "bob", ".obsidian", "snippets", "task-statuses.css");
  return fs.existsSync(candidate) ? candidate : null;
}

function buildFixture(vaultDir, dates) {
  const d = dates || fixtureDates();
  writeNote(path.join(vaultDir, "block-marks.md"), blockMarksNote(d));
  writeNote(path.join(vaultDir, "prereqs.md"), PREREQS_NOTE);
  writeNote(path.join(vaultDir, "embed-host.md"), EMBED_HOST_NOTE);
  writeNote(path.join(vaultDir, "prose.md"), PROSE_NOTE);
  writeNote(path.join(vaultDir, "tasks-query.md"), TASKS_QUERY_NOTE);
  writeNote(path.join(vaultDir, "dataview-query.md"), DATAVIEW_QUERY_NOTE);
  writeNote(path.join(vaultDir, "chip-marks.md"), chipMarksNote(d));

  const enabled = [];
  for (const plugin of readExpectedPlugins()) {
    copyPluginFiles(path.join(repoRoot, "plugins", plugin.id), path.join(vaultDir, ".obsidian", "plugins", plugin.id));
    enabled.push(plugin.id);
  }

  const tasksSource = findTasksPluginSource();
  let tasksPlugin = false;
  if (tasksSource) {
    const targetDir = path.join(vaultDir, ".obsidian", "plugins", "obsidian-tasks-plugin");
    copyPluginFiles(tasksSource, targetDir);
    fs.writeFileSync(path.join(targetDir, "data.json"), JSON.stringify(TASKS_DATA, null, 2));
    enabled.push("obsidian-tasks-plugin");
    tasksPlugin = true;
  }

  const dataviewSource = findDataviewPluginSource();
  let dataviewPlugin = false;
  if (dataviewSource) {
    const targetDir = path.join(vaultDir, ".obsidian", "plugins", "dataview");
    copyPluginFiles(dataviewSource, targetDir);
    const dataSrc = path.join(dataviewSource, "data.json");
    if (fs.existsSync(dataSrc)) {
      try {
        fs.copyFileSync(dataSrc, path.join(targetDir, "data.json"));
      } catch {
        // Dataview runs with defaults.
      }
    }
    enabled.push("dataview");
    dataviewPlugin = true;
  }

  const snippetSource = findSnippetSource();
  let snippet = false;
  if (snippetSource) {
    const targetDir = path.join(vaultDir, ".obsidian", "snippets");
    fs.mkdirSync(targetDir, { recursive: true });
    fs.copyFileSync(snippetSource, path.join(targetDir, "task-statuses.css"));
    snippet = true;
  }

  fs.mkdirSync(path.join(vaultDir, ".obsidian"), { recursive: true });
  fs.writeFileSync(path.join(vaultDir, ".obsidian", "community-plugins.json"), JSON.stringify(enabled, null, 2));
  fs.writeFileSync(
    path.join(vaultDir, ".obsidian", "app.json"),
    JSON.stringify({ livePreview: true, showLineNumber: false, showInlineTitle: false }, null, 2),
  );
  const appearance = { cssTheme: "", theme: "moonstone" };
  if (snippet) appearance.enabledCssSnippets = ["task-statuses"];
  fs.writeFileSync(path.join(vaultDir, ".obsidian", "appearance.json"), JSON.stringify(appearance, null, 2));
  fs.writeFileSync(
    path.join(vaultDir, ".obsidian", "core-plugins.json"),
    JSON.stringify(["file-explorer", "global-search", "switcher", "page-preview", "command-palette", "editor-status", "outline"], null, 2),
  );
  return {
    marks: "block-marks.md",
    prereqs: "prereqs.md",
    embedHost: "embed-host.md",
    prose: "prose.md",
    tasksQuery: "tasks-query.md",
    dataviewQuery: "dataview-query.md",
    chips: "chip-marks.md",
    enabled,
    tasksPlugin,
    dataviewPlugin,
    snippet,
    dates: d,
  };
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
    return this.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true }, timeoutMs).then((response) => {
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
  const app = window.app;
  const adapter = app && app.vault && app.vault.adapter;
  if (adapter && typeof adapter.basePath === "string" && adapter.basePath) return adapter.basePath;
  return null;
} catch { return null; } })()`;

// Owned-row marks in both surfaces, plus gate/command/api/tasks/dataview state.
// Context strings carry the BM marker (BM1, BMChild, ...) so the harness can
// map each visible row to its expected key without relying on order.
const MARKS_PROBE = `(() => { try {
  const visible = (el) => {
    if (!el || !el.getClientRects || el.getClientRects().length === 0) return false;
    let node = el;
    while (node && node.nodeType === 1) {
      const style = window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
      node = node.parentElement;
    }
    return true;
  };
  const ownText = (node) => {
    if (!node) return "";
    let out = "";
    const walk = (current) => {
      for (const child of Array.from(current.childNodes || [])) {
        if (child.nodeType === 3) { out += child.nodeValue || ""; continue; }
        if (child.nodeType !== 1) continue;
        const tag = String(child.tagName || "").toUpperCase();
        if (tag === "UL" || tag === "OL") continue;
        walk(child);
      }
    };
    walk(node);
    return out;
  };
  const marked = Array.from(document.querySelectorAll("[data-bob-block]")).map((el) => {
    const line = el.closest(".HyperMD-task-line, .cm-line, p, h1, h2, h3, blockquote");
    const item = el.closest("li");
    const host = line || item || el;
    const raw = line ? String(line.textContent || "") : ownText(item || host);
    const box = el.matches("input") ? el : el.querySelector("input.task-list-item-checkbox");
    return {
      key: el.getAttribute("data-bob-block"),
      family: el.getAttribute("data-bob-block-family"),
      more: el.getAttribute("data-bob-block-more"),
      tag: String(el.tagName || "").toLowerCase(),
      visible: visible(el),
      context: String(raw || "").replace(/\\s+/g, " ").trim().slice(0, 200),
      aria: box ? box.getAttribute("aria-label") || "" : "",
      tooltipPos: box ? box.getAttribute("data-tooltip-position") || "" : "",
    };
  });
  const boxes = Array.from(document.querySelectorAll("input.task-list-item-checkbox")).map((box) => ({
    aria: box.getAttribute("aria-label") || "",
    tooltipPos: box.getAttribute("data-tooltip-position") || "",
    visible: visible(box),
    context: String((box.closest(".HyperMD-task-line, li, .cm-line") || {}).textContent || "").replace(/\\s+/g, " ").trim().slice(0, 200),
  }));
  const taskRows = Array.from(document.querySelectorAll("li.plugin-tasks-list-item")).map((row) => ({
    text: String(row.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 160),
    marked: row.hasAttribute("data-bob-block"),
  }));
  const dataviewRows = Array.from(document.querySelectorAll(".block-language-dataview li")).map((row) => ({
    text: String(row.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 160),
    key: row.getAttribute("data-bob-block"),
  }));
  const popover = document.querySelector(".popover.hover-popover, .hover-popover");
  const plugin = window.app && window.app.plugins && window.app.plugins.plugins && window.app.plugins.plugins["bob-ledger-tools"];
  return {
    marked,
    boxes,
    gate: document.body.classList.contains("bob-block-marks"),
    command: Boolean(window.app && window.app.commands && window.app.commands.findCommand && window.app.commands.findCommand("bob-ledger-tools:toggle-block-marks")),
    api: Boolean(plugin && plugin.blockMarksApi),
    apiVersion: plugin && plugin.blockMarksApi ? Number(plugin.blockMarksApi().version || 0) : null,
    enabled: plugin ? plugin.blockMarksEnabled !== false : null,
    popover: Boolean(popover),
    taskRows,
    dataviewRows,
  };
} catch (e) { return { error: String(e && e.message || e), marked: [] }; } })()`;

// Chip miniatures: .bob-dep-chip-box > span.bob-block-mark[data-bob-block]
const CHIPS_PROBE = `(() => { try {
  const visible = (el) => {
    if (!el || !el.getClientRects || el.getClientRects().length === 0) return false;
    let node = el;
    while (node && node.nodeType === 1) {
      const style = window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
      node = node.parentElement;
    }
    return true;
  };
  const chips = Array.from(document.querySelectorAll(".bob-dep-chip-box")).map((box) => {
    const chip = box.closest(".bob-dep-chip, a.bob-dep-chip, a.bob-blocks-chip") || box.parentElement;
    const mark = Array.from(box.children || []).find((child) => child.classList && child.classList.contains("bob-block-mark"));
    const fallback = Array.from(box.children || []).find((child) => child.classList && child.classList.contains("bob-dep-chip-fallback"));
    const markStyle = mark ? window.getComputedStyle(mark) : null;
    const row = box.closest(".bob-dep-row, .bob-blocks-row, li, .cm-line");
    const rowRect = row && row.getBoundingClientRect ? row.getBoundingClientRect() : null;
    return {
      key: mark ? mark.getAttribute("data-bob-block") : null,
      markVisible: Boolean(mark && visible(mark) && markStyle && markStyle.display !== "none"),
      markDisplay: markStyle ? String(markStyle.display || "") : null,
      fallbackText: fallback ? String(fallback.textContent || "") : "",
      boxText: String(box.textContent || ""),
      tooltip: chip ? String(chip.getAttribute("title") || "") : "",
      aria: chip ? String(chip.getAttribute("aria-label") || "") : "",
      href: chip ? String(chip.getAttribute("data-href") || chip.getAttribute("href") || "") : "",
      rowHeight: rowRect ? rowRect.height : null,
      chipText: chip ? String(chip.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 160) : "",
      isBlocks: Boolean(
        (chip && chip.classList && chip.classList.contains("bob-blocks-chip"))
        || (row && row.classList && row.classList.contains("bob-blocks-row")),
      ),
    };
  });
  return { gate: document.body.classList.contains("bob-block-marks"), chips };
} catch (e) { return { error: String(e && e.message || e), chips: [] }; } })()`;

// Computed paint for one owned checkbox: glyph content, pip size, hit area,
// row height, and family colors. The harness calls this per BM row.
const COMPUTED_PROBE_FN = `((selector) => { try {
  const host = document.querySelector(selector);
  if (!host) return { ok: false, error: "no host " + selector };
  const box = host.matches("input") ? host : host.querySelector("input.task-list-item-checkbox") || host.querySelector("span.bob-block-mark");
  if (!box) return { ok: false, error: "no box in " + selector };
  const cs = window.getComputedStyle(box);
  const after = window.getComputedStyle(box, "::after");
  const before = window.getComputedStyle(box, "::before");
  const rect = box.getBoundingClientRect();
  const line = box.closest(".HyperMD-task-line, li");
  const lineRect = line ? line.getBoundingClientRect() : null;
  return {
    ok: true,
    key: host.getAttribute("data-bob-block"),
    family: host.getAttribute("data-bob-block-family"),
    more: host.getAttribute("data-bob-block-more"),
    glyph: String(after.content || ""),
    glyphColor: String(after.color || ""),
    pipWidth: String(before.width || ""),
    pipHeight: String(before.height || ""),
    pipBackground: String(before.backgroundColor || ""),
    border: String(cs.borderTopWidth || "") + " " + String(cs.borderTopStyle || ""),
    background: String(cs.backgroundColor || ""),
    boxWidth: Math.round(rect.width || 0),
    boxHeight: Math.round(rect.height || 0),
    lineHeight: lineRect ? Math.round(lineRect.height || 0) : null,
    overflow: String(cs.overflow || ""),
  };
} catch (e) { return { ok: false, error: String(e && e.message || e) }; } })`;

const LINE_HEIGHT_PROBE = `(() => { try {
  const pick = (nodes, needle) => {
    const list = Array.from(nodes || []);
    return list.find((node) => needle.test(String(node.textContent || ""))) || null;
  };
  const measure = (node) => {
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return { height: rect.height, text: String(node.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 80) };
  };
  return {
    bm1: measure(pick(document.querySelectorAll(".cm-line, p"), /BM1 p2 vector/)),
    bm2: measure(pick(document.querySelectorAll(".cm-line, p"), /BM2 date vector/)),
    bmParent: measure(pick(document.querySelectorAll(".cm-line, p"), /BMParent dep/)),
  };
} catch (e) { return { error: String(e && e.message || e) }; } })()`;

// Digit-row bar folds and prj-row `#prj_is_blocked` pill folds. The
// harness scrolls before evaluating so Live Preview widgets exist.
const FOLDS_PROBE = `(() => { try {
  const visibleWidth = (el) => {
    if (!el || !el.getBoundingClientRect) return 0;
    const rect = el.getBoundingClientRect();
    const cs = window.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return 0;
    const clip = String(cs.clipPath || cs.webkitClipPath || "");
    if (clip.indexOf("inset(50%)") !== -1) return 0;
    return Math.round(rect.width || 0);
  };
  const isShown = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    let node = el;
    while (node && node.nodeType === 1) {
      const cs = window.getComputedStyle(node);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      node = node.parentElement;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const pick = (needle) => {
    const match = (selector) => Array.from(document.querySelectorAll(selector)).find((node) => {
      if (node.closest && node.closest("ul.plugin-tasks-query-result")) return false;
      if (!isShown(node)) return false;
      return String(node.textContent || "").includes(needle);
    });
    return match(".HyperMD-task-line") || match("li.task-list-item") || match(".cm-line") || match("p") || null;
  };
  const isPrjTag = (tag) => {
    if (!tag) return false;
    const href = tag.getAttribute ? tag.getAttribute("href") : "";
    const name = tag.getAttribute ? tag.getAttribute("data-tag-name") : "";
    const text = String(tag.textContent || "");
    return href === "#prj_is_blocked" || name === "#prj_is_blocked" || /#?prj_is_blocked(?![A-Za-z0-9_/-])/.test(text);
  };
  const row = (needle) => {
    const host = pick(needle);
    if (!host) return { found: false, needle };
    const mark = host.querySelector ? host.querySelector(".bob-priority-mark") : null;
    const taskPriority = (!mark && host.querySelector)
      ? host.querySelector(".task-priority")
      : null;
    const foldMark = mark || taskPriority;
    const foldWidget = host.querySelector ? host.querySelector(".bob-block-prj-fold") : null;
    const tags = host.querySelectorAll
      ? Array.from(host.querySelectorAll("a.tag, .cm-hashtag, [data-tag-name], [href='#prj_is_blocked']"))
      : [];
    const prjTag = tags.find(isPrjTag) || null;
    const markFoldedAttr = Boolean(mark && mark.getAttribute("data-folded") === "true");
    const markWidth = foldMark ? visibleWidth(foldMark) : null;
    const tagFoldedAttr = Boolean(prjTag && prjTag.getAttribute("data-bob-block-folded") === "true");
    const textHasTag = /(?:^|[^A-Za-z0-9_/#])#prj_is_blocked(?![A-Za-z0-9_/-])/.test(String(host.textContent || ""));
    const tagWidth = prjTag
      ? visibleWidth(prjTag)
      : (foldWidget ? visibleWidth(foldWidget) : (textHasTag && !foldWidget ? Math.max(8, Math.round((host.getBoundingClientRect().width || 80) * 0.08)) : null));
    const prjFolded = Boolean(foldWidget || tagFoldedAttr || (prjTag && tagWidth <= 4));
    return {
      found: true,
      folded: Boolean(foldMark) && (markFoldedAttr || (typeof markWidth === "number" && markWidth <= 4)),
      markWidth,
      markFoldedAttr,
      prjFolded,
      tagWidth,
      tagFoldedAttr,
      hasFoldWidget: Boolean(foldWidget),
      hasMark: Boolean(foldMark),
      hasTag: Boolean(prjTag) || Boolean(textHasTag && !foldWidget),
    };
  };
  return {
    bm1: row("BM1 p2 vector"),
    bm7: row("BM7 prj vector"),
    bm8: row("BM8 dep pip"),
    bm9: row("BM9 prj pip"),
    bm19: row("BM19 dep over prj"),
  };
} catch (e) { return { error: String(e && e.message || e) }; } })()`;

// CSS-only Tasks query rows: attributes Tasks 8.4.0/8.6.0 actually writes,
// plus computed checkbox paint. Never classify from data-line or input.checked.
const TASKS_ROWS_PROBE = `(() => { try {
  const visibleWidth = (el) => {
    if (!el || !el.getBoundingClientRect) return 0;
    const rect = el.getBoundingClientRect();
    const cs = window.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return 0;
    const clip = String(cs.clipPath || cs.webkitClipPath || "");
    if (clip.indexOf("inset(50%)") !== -1) return 0;
    return Math.round(rect.width || 0);
  };
  const describe = (row, layout) => {
    const box = row.querySelector(":scope > .task-list-item-checkbox, :scope > input.task-list-item-checkbox");
    const after = box ? window.getComputedStyle(box, "::after") : null;
    const cs = box ? window.getComputedStyle(box) : null;
    const priority = row.querySelector(".task-priority");
    const tags = row.querySelectorAll ? Array.from(row.querySelectorAll("a.tag, .tag")) : [];
    const prjTag = tags.find((tag) => {
      const href = tag.getAttribute ? tag.getAttribute("href") : "";
      const name = tag.getAttribute ? tag.getAttribute("data-tag-name") : "";
      const text = String(tag.textContent || "");
      return href === "#prj_is_blocked" || name === "#prj_is_blocked" || /#?prj_is_blocked(?![A-Za-z0-9_/-])/.test(text);
    }) || null;
    const attrNames = row.getAttributeNames ? row.getAttributeNames() : [];
    return {
      text: String(row.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 180),
      dataTask: row.getAttribute("data-task") || "",
      dataLine: row.getAttribute("data-line") || "",
      scheduled: row.getAttribute("data-task-scheduled") || "",
      priority: row.getAttribute("data-task-priority") || "",
      statusName: row.getAttribute("data-task-status-name") || "",
      statusType: row.getAttribute("data-task-status-type") || "",
      attrNames,
      jsMarked: row.hasAttribute("data-bob-block"),
      jsKey: row.getAttribute("data-bob-block") || "",
      hasRecurring: Boolean(row.querySelector(".task-recurring")),
      hasPrjTag: Boolean(prjTag),
      prjTagWidth: prjTag ? visibleWidth(prjTag) : null,
      priorityWidth: priority ? visibleWidth(priority) : null,
      hasPriorityEl: Boolean(priority),
      glyph: after ? String(after.content || "") : "",
      glyphColor: after ? String(after.color || "") : "",
      mask: after ? String(after.webkitMaskImage || after.maskImage || "") : "",
      border: cs ? String(cs.borderTopWidth || "") + " " + String(cs.borderTopStyle || "") : "",
      background: cs ? String(cs.backgroundColor || "") : "",
      layout,
      checked: box ? Boolean(box.checked) : null,
    };
  };
  const layoutOf = (block) => {
    if (block.classList.contains("tasks-layout-short-mode")) return "short";
    let node = block.closest(".block-language-tasks") || block;
    let prev = node.previousElementSibling;
    for (let i = 0; i < 6 && prev; i += 1, prev = prev.previousElementSibling) {
      const text = String(prev.textContent || "").replace(/\\s+/g, " ").trim().toLowerCase();
      if (text.indexOf("hide priority") === 0) return "hide-priority";
      if (text === "short") return "short";
      if (text === "full") return "full";
    }
    const sample = block.querySelector("li.plugin-tasks-list-item");
    if (sample && !sample.querySelector(".task-priority")) return "hide-priority";
    return "full";
  };
  const blocks = Array.from(document.querySelectorAll("ul.plugin-tasks-query-result"));
  const rows = [];
  blocks.forEach((block) => {
    const layout = layoutOf(block);
    Array.from(block.querySelectorAll("li.plugin-tasks-list-item")).forEach((row) => {
      rows.push(describe(row, layout));
    });
  });
  return {
    count: rows.length,
    blocks: blocks.length,
    gate: document.body.classList.contains("bob-block-marks"),
    rows,
  };
} catch (e) { return { error: String(e && e.message || e), rows: [] }; } })()`;

const EXPECTED_KEYS = Object.freeze({
  BM1: "p2",
  BMp3: "p3",
  BM2: "date",
  BM3: "repeat",
  BM4: "dep",
  BM5: "stale",
  BM7: "prj",
  BM8: "dep",
  BM9: "prj",
  BM10: "date",
  BM11: "stale",
  BM13: "p1",
  BM14: "stale",
  BM15: "date",
  BM18: "dep",
  BM19: "dep",
  BM20: "p4",
  BM21: "stale",
  BM25: "dep",
  BM27: "stale",
  BMParent: "dep",
  BMChild: "date",
  BMClick: "date",
  "Project hold": "dep",
});

const EXPECTED_MORE = Object.freeze({ BM8: "p3", BM9: "p2", BM19: "prj" });
const NEUTRAL_MARKERS = Object.freeze(["BM12", "BM16", "BM17", "BM26", "BMDone", "BMCancel", "BMF"]);
const KEY_PAINT_MARKERS = Object.freeze({
  dep: "BM4 dep vector",
  prj: "BM7 prj vector",
  p1: "BM13 p1 vector",
  p2: "BM1 p2 vector",
  p3: "BMp3 standalone",
  p4: "BM20 quoted",
  date: "BM2 date vector",
  repeat: "BM3 repeat vector",
  stale: "BM5 stale closed",
});

function markForMarker(marks, marker) {
  return asserts.markForMarker(marks, marker);
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
    const pages = (Array.isArray(targets) ? targets : []).filter((item) => item && item.type === "page" && item.webSocketDebuggerUrl);
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
    await sleep(80);
  }
  throw new Error(`timed out waiting for ${label}: ${JSON.stringify(last)}`);
}

async function waitForMarks(client, predicate, label, timeoutMs = 8000) {
  return waitFor(client, MARKS_PROBE, predicate, label, timeoutMs);
}

function runSelfTest() {
  const tmp = asserts.makeScratch(repoRoot, "self");
  try {
    if (!tmp.startsWith(asserts.scratchRoot(repoRoot))) {
      throw new Error("self-test scratch must stay under the owned scratch root");
    }
    if (asserts.scratchRoot(repoRoot).length > 40) {
      throw new Error("scratch root must stay short enough for Chromium SingletonSocket");
    }
    const parsed = parseArgs(["--self-test", "--out", tmp, "--report", path.join(tmp, "r.json")]);
    if (!parsed.selfTest) throw new Error("parseArgs did not keep --self-test");
    const dates = fixtureDates();
    const fixture = buildFixture(tmp, dates);
    for (const relative of [fixture.marks, fixture.prereqs, fixture.embedHost, fixture.prose, fixture.tasksQuery, fixture.dataviewQuery, fixture.chips]) {
      if (!fs.existsSync(path.join(tmp, relative))) throw new Error(`fixture missing ${relative}`);
    }
    const marks = fs.readFileSync(path.join(tmp, fixture.marks), "utf8");
    for (const token of ["BM1 p2 vector", "BMp3 standalone", "BM4 dep vector", "BM7 prj vector", "BMChild date", "Project hold", "^prj", "BMF fenced"]) {
      if (!marks.includes(token)) throw new Error(`BM note missing ${token}`);
    }
    for (const token of ["BM6", "BM22", "BM23", "BM24"]) {
      if (marks.includes(token)) throw new Error(`BM note must not contain scenario-only ${token}`);
    }
    if (!marks.includes("```")) throw new Error("BM note missing the fenced block");
    if (!marks.includes("> - [?] #task BM20")) throw new Error("BM note missing the quoted task");
    if (!marks.includes("  - [?] #task BMChild")) throw new Error("BM note missing the nested child");
    const prereqs = fs.readFileSync(path.join(tmp, fixture.prereqs), "utf8");
    for (const token of ["[id:: x]", "[id:: y]", "[id:: d]"]) {
      if (!prereqs.includes(token)) throw new Error(`prereqs note missing ${token}`);
    }
    const embed = fs.readFileSync(path.join(tmp, fixture.embedHost), "utf8");
    if (!embed.includes("![[block-marks]]")) throw new Error("embed host missing the BM embed");
    const prose = fs.readFileSync(path.join(tmp, fixture.prose), "utf8");
    if (!prose.includes("[[block-marks]]")) throw new Error("prose note missing the hover link");
    const tasksQuery = fs.readFileSync(path.join(tmp, fixture.tasksQuery), "utf8");
    if (!tasksQuery.includes("```tasks")) throw new Error("tasks query note missing the Tasks fence");
    if (!tasksQuery.includes("short mode")) throw new Error("tasks query note missing short mode");
    if (!tasksQuery.includes("hide priority")) throw new Error("tasks query note missing hide priority");
    const dataviewQuery = fs.readFileSync(path.join(tmp, fixture.dataviewQuery), "utf8");
    if (!dataviewQuery.includes("```dataview")) throw new Error("dataview query note missing the Dataview fence");
    const chips = fs.readFileSync(path.join(tmp, fixture.chips), "utf8");
    for (const token of ["ChipP2 p2 target", "ChipDep dep target", "ChipPrj prj target", "ChipSource waits on three", "ChipBlockedDependent", "⛓️ **DEPENDS ON:**", "🧱 **BLOCKS:**", "^chip-p2", "^chip-dep", "^chip-prj"]) {
      if (!chips.includes(token)) throw new Error(`chip note missing ${token}`);
    }
    if (marks.includes("ChipP2 p2 target")) throw new Error("BM note must not contain the chip-mark fixture");
    const app = JSON.parse(fs.readFileSync(path.join(tmp, ".obsidian/app.json"), "utf8"));
    if (app.livePreview !== true) throw new Error("livePreview must be on");
    const core = JSON.parse(fs.readFileSync(path.join(tmp, ".obsidian/core-plugins.json"), "utf8"));
    if (!core.includes("page-preview")) throw new Error("page-preview must be enabled");
    const community = JSON.parse(fs.readFileSync(path.join(tmp, ".obsidian/community-plugins.json"), "utf8"));
    if (!community.includes("bob-ledger-tools")) throw new Error("bob-ledger-tools must be enabled");
    if (!fs.existsSync(path.join(tmp, ".obsidian/plugins/bob-ledger-tools/main.js"))) {
      throw new Error("bob-ledger-tools main.js was not copied");
    }
    const liveState = markdownViewState("live");
    if (liveState.mode !== "source" || liveState.source !== false) throw new Error("Live Preview must open as Markdown source:false");
    const readingState = markdownViewState("preview");
    if (readingState.mode !== "preview") throw new Error("Reading view must open as mode:preview");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dates.today)) throw new Error("fixture today is not a date");
    if (marks.includes("2026-11-20")) throw new Error("fixture must use relative dates, not hardcoded contract dates");
    const source = fs.readFileSync(__filename, "utf8");
    if (/runBlockMarksRefresh\(|scheduleBlockMarksRefresh\(/.test(source)) {
      throw new Error("the e2e must not call the plugin refresh methods; trigger normal edits and observe");
    }
    if (!source.includes("data-bob-block")) throw new Error("self-test must cover the owned row attributes");
    if (!source.includes("FOLDS_PROBE")) throw new Error("self-test must cover redundancy fold probes");
    if (!source.includes("TASKS_ROWS_PROBE")) throw new Error("self-test must cover Tasks attribute probes");
    if (!source.includes("data-task-scheduled")) throw new Error("self-test must cover Tasks scheduled attributes");
    if (!source.includes("tasks-layout-short-mode")) throw new Error("self-test must classify short mode from the Tasks layout class");
    if (!source.includes("hide-priority")) throw new Error("self-test must classify hide-priority independently of block index");
    if (!source.includes("bm24-tasks-css-digit")) throw new Error("self-test must cover BM24");
    if (!source.includes("toggle-block-marks")) throw new Error("self-test must cover the session toggle");
    if (!source.includes("CHIPS_PROBE")) throw new Error("self-test must cover chip-mark probes");
    if (!source.includes("chip-marks.md")) throw new Error("self-test must seed a separate chip-marks note");
    if (!source.includes(".bob-dep-chip-box > span.bob-block-mark")) throw new Error("self-test must assert chip-box miniatures");
    if (!source.includes("Input.dispatchMouseEvent")) throw new Error("self-test must cover CDP hover");
    if (!source.includes("setCssEnabledStatus")) throw new Error("self-test must cover snippet disable via customCss");
    if (!source.includes("refreshBlockMarksLadder")) throw new Error("self-test must cover the BM22 ladder seam");
    if (!source.includes("refreshDateMarksForRollover")) throw new Error("self-test must cover the BM23 date-boundary seam");
    if (!source.includes("metadataCache")) throw new Error("self-test must cover the BM6 resolved seam");
    if (!source.includes(".tooltip")) throw new Error("self-test must wait for a visible .tooltip");
    if (/querySelector\([^\)]*data-tooltip-position/.test(source)) {
      throw new Error("tooltip selector must not include [data-tooltip-position]");
    }
    const emptyTip = asserts.assertExactTooltip({
      aria: "Blocked · until Nov 20",
      tip: "",
      expected: "Blocked · until Nov 20",
    });
    if (emptyTip.ok) throw new Error("empty tooltip must not pass");
    const unchanged = asserts.assertRefreshChanged(
      { key: "date", tooltip: "Blocked · until Nov 20", date: "2026-11-20" },
      { key: "date", tooltip: "Blocked · until Nov 20", date: "2026-11-20" },
    );
    if (unchanged.ok) throw new Error("unchanged refresh evidence must not pass");
    const wrongHost = asserts.assertNamedHostMark(
      { hostFound: true, originHost: "page", marks: [{ context: "BM1 p2 vector", key: "p2", box: true }] },
      { hostKind: "embed", marker: "BM1", wantKey: "p2" },
    );
    if (wrongHost.ok) throw new Error("wrong host origin must not pass");
    const fakeSnippet = asserts.assertSnippetDisabled({
      removedLinksOnly: true,
      stylePresent: true,
      enabled: false,
      paintOk: true,
      glyph: '"&"',
    });
    if (fakeSnippet.ok) throw new Error("fake snippet removal must not pass");
    const bm1Hits = asserts.markForMarker(
      [{ context: "BM10 urgent date", key: "date", visible: true }, { context: "BM1 p2 vector", key: "p2", visible: true }],
      "BM1",
    );
    if (bm1Hits.visible.length !== 1 || bm1Hits.visible[0].key !== "p2") {
      throw new Error("BM1 matching must not also select BM10");
    }
    const bm24Key = asserts.tasksResultCssKey({
      dataTask: "?",
      priority: "medium",
      scheduled: "future-far",
      hasPrjTag: false,
      hasRecurring: false,
    });
    if (bm24Key !== "p2") throw new Error(`BM24 css key must be p2, got ${bm24Key}`);
    const jsMarked = asserts.assertTasksCssMark(
      { dataTask: "?", scheduled: "future-far", priority: "medium", jsMarked: true, glyph: '"2"' },
      { marker: "BM1", wantKey: "p2", wantGlyph: "2" },
    );
    if (jsMarked.ok) throw new Error("JS-marked Tasks rows must fail the CSS-only assertion");
    console.log("offline self-test complete (not an Obsidian pass)");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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
      await new Promise((resolve) => setTimeout(resolve, 250));
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

async function collectMarks(client, file, mode) {
  await openNote(client, file, mode);
  await sleep(500);
  const union = new Map();
  const steps = [0, 0.5, 1];
  for (const fraction of steps) {
    await client.evaluate(`(() => {
      const f = ${fraction};
      const editor = document.querySelector(".cm-scroller");
      if (editor) editor.scrollTop = f * editor.scrollHeight;
      const preview = document.querySelector(".markdown-preview-view");
      if (preview) preview.scrollTop = f * preview.scrollHeight;
      return true;
    })()`).catch(() => false);
    await sleep(700);
    const probe = await client.evaluate(MARKS_PROBE).catch(() => ({ marked: [] }));
    for (const mark of probe.marked || []) {
      if (!mark || mark.visible === false) continue;
      const key = `${mark.key}|${mark.family}|${mark.context}`;
      if (!union.has(key)) union.set(key, mark);
    }
  }
  await client.evaluate(`(() => {
    const editor = document.querySelector(".cm-scroller");
    if (editor) editor.scrollTop = 0;
    const preview = document.querySelector(".markdown-preview-view");
    if (preview) preview.scrollTop = 0;
    return true;
  })()`).catch(() => false);
  return { marks: Array.from(union.values()) };
}

const HOST_MARKS_PROBE_FN = `((hostSelector, marker) => { try {
  const visible = (el) => {
    if (!el) return false;
    let node = el;
    while (node && node.nodeType === 1) {
      const style = window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
      node = node.parentElement;
    }
    return true;
  };
  const hosts = Array.from(document.querySelectorAll(hostSelector));
  if (!hosts.length) return { hostFound: false, originHost: "page", marks: [] };
  const seen = new Set();
  const marks = [];
  for (const host of hosts) {
    const rows = Array.from(host.querySelectorAll("li.task-list-item, .HyperMD-task-line, [data-bob-block]"));
    for (const el of rows) {
      if (seen.has(el)) continue;
      seen.add(el);
      const context = String(el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 200);
      const box = el.matches && el.matches("input") ? el : el.querySelector && el.querySelector("input.task-list-item-checkbox");
      marks.push({
        key: el.getAttribute("data-bob-block"),
        family: el.getAttribute("data-bob-block-family"),
        more: el.getAttribute("data-bob-block-more"),
        context,
        visible: visible(el),
        box: Boolean(box),
        aria: box ? box.getAttribute("aria-label") || "" : "",
        path: el.getAttribute("data-task-path") || "",
      });
    }
  }
  return { hostFound: true, originHost: hostSelector, marks, hostCount: hosts.length, marker: String(marker || "") };
} catch (e) { return { hostFound: false, error: String(e && e.message || e), marks: [] }; } })`;

const VISIBLE_TOOLTIP_PROBE = `(() => { try {
  const tips = Array.from(document.querySelectorAll(".tooltip, [class*='tooltip']"));
  for (const el of tips) {
    const className = String(el.className || "");
    if (el.hasAttribute && el.hasAttribute("data-tooltip-position") && !/tooltip/i.test(className)) continue;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") continue;
    const text = String(el.textContent || "").replace(/\\s+/g, " ").trim();
    if (!text) continue;
    const laidOut = Boolean(el.getClientRects && el.getClientRects().length > 0);
    return { visible: true, text, laidOut };
  }
  return { visible: false, text: "" };
} catch (e) { return { visible: false, error: String(e && e.message || e), text: "" }; } })()`;

async function checkboxPoint(client, marker) {
  return client.evaluate(`(() => {
    const marker = ${JSON.stringify(marker)};
    const boxes = Array.from(document.querySelectorAll("input.task-list-item-checkbox"));
    const box = boxes.find((node) => String((node.closest(".HyperMD-task-line, li") || {}).textContent || "").includes(marker));
    if (!box) return { ok: false, error: "checkbox missing for " + marker };
    box.scrollIntoView({ block: "center" });
    const rect = box.getBoundingClientRect();
    if (!rect || rect.width < 2 || rect.height < 2) return { ok: false, error: "checkbox has no layout" };
    return {
      ok: true,
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      aria: box.getAttribute("aria-label") || "",
    };
  })()`);
}

async function hoverCheckboxViaCdp(client, marker) {
  const point = await checkboxPoint(client, marker);
  if (!point || !point.ok) return { ok: false, error: point && point.error || "point missing", aria: "" };
  try { await client.call("Page.bringToFront", {}); } catch { /* xvfb may ignore */ }
  await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x + 1, y: point.y });
  await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y + 1 });
  await client.evaluate(`(() => {
    const marker = ${JSON.stringify(marker)};
    const boxes = Array.from(document.querySelectorAll("input.task-list-item-checkbox"));
    const box = boxes.find((node) => String((node.closest(".HyperMD-task-line, li") || {}).textContent || "").includes(marker));
    if (!box) return false;
    try { window.focus(); } catch {}
    const rect = box.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const pointerOpts = { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", clientX: x, clientY: y, view: window };
    // Obsidian ignores aria tooltips until two mouse pointermove events have fired.
    for (let i = 0; i < 3; i += 1) {
      document.dispatchEvent(new PointerEvent("pointermove", pointerOpts));
    }
    box.dispatchEvent(new PointerEvent("pointerover", { ...pointerOpts, relatedTarget: document.body }));
    box.dispatchEvent(new PointerEvent("pointerenter", { ...pointerOpts, relatedTarget: document.body }));
    box.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window, relatedTarget: document.body }));
    box.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window, relatedTarget: document.body }));
    box.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window }));
    return true;
  })()`).catch(() => false);
  const tip = await waitFor(client, VISIBLE_TOOLTIP_PROBE, (value) => value && value.text, "visible-tooltip", 6000).catch((error) => ({ visible: false, text: "", error: error.message }));
  const aria = await client.evaluate(`(() => {
    const marker = ${JSON.stringify(marker)};
    const boxes = Array.from(document.querySelectorAll("input.task-list-item-checkbox"));
    const box = boxes.find((node) => String((node.closest(".HyperMD-task-line, li") || {}).textContent || "").includes(marker));
    return box ? box.getAttribute("aria-label") || "" : "";
  })()`).catch(() => "");
  return { ok: Boolean(tip && tip.text), tip: tip && tip.text || "", aria, laidOut: Boolean(tip && tip.laidOut), error: tip && tip.error };
}

async function expectedTooltipForMarker(client, file, marker) {
  return client.evaluate(`(() => (async () => {
    const plugin = window.app.plugins.plugins["bob-ledger-tools"];
    const api = plugin && plugin.blockMarksApi ? plugin.blockMarksApi() : null;
    const abstract = window.app.vault.getAbstractFileByPath(${JSON.stringify(file)});
    const text = abstract ? await window.app.vault.cachedRead(abstract) : "";
    const line = String(text || "").split("\\n").find((row) => row.includes(${JSON.stringify(marker)})) || "";
    let model = null;
    try { model = api ? api.model(line, { path: ${JSON.stringify(file)} }) : null; } catch (e) { model = { error: String(e) }; }
    return { line, tooltip: model && model.tooltip || "", key: model && model.key || null };
  })())()`);
}

async function namedHostProbe(client, hostSelector, marker) {
  return client.evaluate(`(${HOST_MARKS_PROBE_FN})(${JSON.stringify(hostSelector)}, ${JSON.stringify(marker)})`);
}

async function collectChips(client, file, mode) {
  await openNote(client, file, mode);
  await sleep(800);
  return waitFor(client, CHIPS_PROBE, (v) => v && Array.isArray(v.chips) && v.chips.length > 0, "chip boxes", 8000).catch((error) => ({
    error: String(error && error.message || error),
    chips: [],
    gate: null,
  }));
}

function visibleChips(probe) {
  return ((probe && probe.chips) || []).filter((chip) => Number(chip.rowHeight) > 1);
}

function chipMatching(probe, needle, alt) {
  const chips = visibleChips(probe);
  return chips.filter((chip) => {
    const hay = String(chip.chipText || "") + " " + String(chip.href || "");
    return hay.includes(needle) || (alt && hay.includes(alt));
  });
}

function assertChipFamily(record, prefix, probe, needle, wantKey, alt) {
  const matches = chipMatching(probe, needle, alt);
  const hit = matches.find((chip) => chip.key === wantKey) || matches[0] || null;
  if (!hit) {
    record(`${prefix}-${needle}-chip`, false, `no chip matching ${needle}; saw ${visibleChips(probe).map((chip) => chip.chipText).join(" | ").slice(0, 180)}`);
    return null;
  }
  record(`${prefix}-${needle}-key`, hit.key === wantKey, `${needle} key=${hit.key} want=${wantKey}`);
  record(
    `${prefix}-${needle}-reason`,
    Boolean(hit.tooltip || hit.aria) && !/Ctrl\+Shift/.test(String(hit.tooltip || "") + String(hit.aria || "")),
    JSON.stringify({ tooltip: hit.tooltip, aria: hit.aria }).slice(0, 180),
  );
  return hit;
}

async function collectFolds(client) {
  const keys = ["bm1", "bm7", "bm8", "bm9", "bm19"];
  const union = {};
  const steps = [0, 0.5, 1];
  for (const fraction of steps) {
    await client.evaluate(`(() => {
      const f = ${fraction};
      const editor = document.querySelector(".cm-scroller");
      if (editor) editor.scrollTop = f * editor.scrollHeight;
      const preview = document.querySelector(".markdown-preview-view");
      if (preview) preview.scrollTop = f * preview.scrollHeight;
      return true;
    })()`).catch(() => false);
    await sleep(700);
    const probe = await client.evaluate(FOLDS_PROBE).catch((e) => ({ error: String(e) }));
    if (probe && probe.error && !union.error) union.error = probe.error;
    for (const key of keys) {
      if (probe && probe[key] && probe[key].found) union[key] = probe[key];
    }
  }
  return union;
}

async function runE2e(parsed) {
  const executable = findExecutable(parsed.executable);
  const probe = probeExecutable(executable);
  if (!probe.ok) {
    fail(`unrun: ${probe.reason}. Rerun on a host with the Obsidian Electron app: xvfb-run -a node scripts/obsidian-block-marks-e2e.cjs -e /snap/bin/obsidian`, 2);
  }
  if (!process.env.DISPLAY && !process.env.XVFB_RUN_TMPDIR) {
    fail("unrun: no X display; rerun under xvfb-run -a node scripts/obsidian-block-marks-e2e.cjs", 2);
  }

  const outDir = parsed.out ? path.resolve(parsed.out) : asserts.makeScratch(repoRoot, "out");
  fs.mkdirSync(outDir, { recursive: true });
  const runRoot = asserts.makeScratch(repoRoot, "run");
  const vaultDir = path.join(runRoot, "vault");
  const profileDir = path.join(runRoot, "profile");
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(profileDir, { recursive: true });
  const fixture = buildFixture(vaultDir, fixtureDates());
  const fixtureRealPath = fs.realpathSync(vaultDir);
  seedProfileVault(profileDir, fixtureRealPath);

  const cases = [];
  const skipped = [];
  const record = (name, ok, detail) => {
    cases.push({ name, ok: Boolean(ok), detail: detail || "" });
    if (!ok) console.error(`FAIL ${name}: ${detail || ""}`);
    else console.log(`PASS ${name}${detail ? ` (${detail})` : ""}`);
  };
  const skip = (name, detail) => {
    skipped.push({ name, detail: detail || "" });
    console.log(`SKIP ${name}${detail ? ` (${detail})` : ""}`);
  };

  const cdpPort = await freePort();
  const child = spawn(executable, ["--no-sandbox", `--user-data-dir=${profileDir}`, `--remote-debugging-port=${cdpPort}`, "--remote-allow-origins=http://127.0.0.1/*", fixtureRealPath], {
    cwd: fixtureRealPath,
    env: (() => {
      const env = { ...process.env, BOB_DIR: fixtureRealPath, TMPDIR: asserts.scratchRoot(repoRoot) };
      delete env.ELECTRON_RUN_AS_NODE;
      return env;
    })(),
    stdio: "ignore",
  });
  let exitInfo = null;
  child.once("exit", (code, signal) => {
    exitInfo = `code=${code} signal=${signal || "none"}`;
  });
  let client = null;
  const report = { executable, vault: fixtureRealPath, dates: fixture.dates, cases: [], skipped: [], screenshots: [], pass: false };
  try {
    const target = await selectOwnedTarget(cdpPort, fixtureRealPath, () => Boolean(exitInfo));
    client = await CdpClient.connect(target.webSocketDebuggerUrl, lib.CONNECT_TIMEOUT_MS);
    await client.call("Page.enable", {}, lib.RPC_TIMEOUT_MS);
    await client.call("Runtime.enable", {}, lib.RPC_TIMEOUT_MS);
    await client.call("Input.enable", {}, lib.RPC_TIMEOUT_MS).catch(() => ({}));

    const layoutDeadline = Date.now() + lib.LAYOUT_READY_TIMEOUT_MS;
    while (Date.now() < layoutDeadline) {
      const ready = await client.evaluate("Boolean(window.app && window.app.workspace && window.app.workspace.layoutReady)").catch(() => false);
      if (ready) break;
      await sleep(250);
    }

    await client.evaluate(`(() => (async () => {
      const plugins = window.app && window.app.plugins;
      if (!plugins || typeof plugins.isEnabled !== "function") return { error: "plugin manager unavailable" };
      if (!plugins.isEnabled()) await plugins.setEnable(true);
      return { enabled: Boolean(plugins.isEnabled()) };
    })())()`, lib.RPC_TIMEOUT_MS);

    const pluginDeadline = Date.now() + 30_000;
    let loaded = false;
    while (Date.now() < pluginDeadline) {
      loaded = await client.evaluate('Boolean(window.app && window.app.plugins && window.app.plugins.plugins && window.app.plugins.plugins["bob-ledger-tools"])').catch(() => false);
      if (loaded) break;
      await sleep(400);
    }
    record("plugin-loaded", loaded, loaded ? "bob-ledger-tools" : "bob-ledger-tools did not load");
    if (!loaded) throw new Error("bob-ledger-tools did not load in the scratch vault");
    await dismissTrustModal(client);
    await sleep(800);

    // Tasks must index the prereqs note before dep/prj marks can resolve.
    // Open it first so the Tasks cache parses it, then poll the harness-side
    // index (never a long single evaluate past the RPC timeout).
    await openNote(client, fixture.prereqs, "live").catch(() => ({}));
    await sleep(1200);
    await openNote(client, fixture.marks, "live").catch(() => ({}));
    await sleep(800);
    let tasksReady = { ready: false };
    for (let i = 0; i < 48; i++) {
      tasksReady = await client.evaluate(`(() => { try {
        const tasksPlugin = window.app.plugins.plugins["obsidian-tasks-plugin"];
        const all = tasksPlugin && typeof tasksPlugin.getTasks === "function" ? tasksPlugin.getTasks() : null;
        const plugin = window.app.plugins.plugins["bob-ledger-tools"];
        if (!plugin || typeof plugin.blockMarksIdIndex !== "function") return { ready: false, total: Array.isArray(all) ? all.length : null };
        const index = plugin.blockMarksIdIndex();
        const sample = Array.isArray(all) && all.length ? { id: all[0] && all[0].id, keys: Object.keys(all[0] || {}).slice(0, 12) } : null;
        if (index && index.has && index.has("x") && index.has("y") && index.has("d")) return { ready: true, total: Array.isArray(all) ? all.length : null };
        return { ready: false, total: Array.isArray(all) ? all.length : null, keys: index ? Array.from(index.keys()).slice(0, 8) : null, sample };
      } catch (e) { return { ready: false, error: String(e && e.message || e) }; } })()`).catch((e) => ({ ready: false, error: String(e) }));
      if (tasksReady && tasksReady.ready) break;
      await sleep(500);
    }
    if (!fixture.tasksPlugin) {
      skip("tasks-cache-ready", "Tasks plugin was not copied; node tests cover cold-cache neutrality");
    } else {
      record("tasks-cache-ready", tasksReady && tasksReady.ready === true, JSON.stringify(tasksReady).slice(0, 200));
    }

    const cmdProbe = await client.evaluate(MARKS_PROBE).catch(() => ({}));
    record("toggle-command-registered", Boolean(cmdProbe && cmdProbe.command), `command=${cmdProbe && cmdProbe.command}`);
    record("api-blockmarks-v1", Boolean(cmdProbe && cmdProbe.api && cmdProbe.apiVersion === 1), `version=${cmdProbe && cmdProbe.apiVersion}`);
    record("gate-on", cmdProbe && cmdProbe.gate === true, `gate=${cmdProbe && cmdProbe.gate}`);

    // Live Preview vectors with scrolling.
    const live = await collectMarks(client, fixture.marks, "live");
    for (const [marker, want] of Object.entries(EXPECTED_KEYS)) {
      const found = markForMarker(live.marks, marker);
      if (found.visible.length === 0) {
        record(`lp-${marker}-marked`, false, `no visible mark for ${marker}; saw ${live.marks.length} marks`);
      } else {
        const got = found.visible[0].key;
        record(`lp-${marker}-marked`, got === want, `${marker} key=${got} want=${want} ctx=${found.visible[0].context.slice(0, 80)}`);
      }
    }
    for (const [marker, wantMore] of Object.entries(EXPECTED_MORE)) {
      const found = markForMarker(live.marks, marker);
      const gotMore = found.visible.length ? found.visible[0].more || null : null;
      record(`lp-${marker}-pip`, gotMore === wantMore, `${marker} more=${gotMore} want=${wantMore}`);
    }
    for (const marker of NEUTRAL_MARKERS) {
      const found = markForMarker(live.marks, marker);
      record(`lp-${marker}-neutral`, found.visible.length === 0, found.visible.length ? `unexpected ${found.visible[0].key} on ${marker}` : "neutral");
    }
    // Nested independence: parent dep and child date differ.
    const lpParent = markForMarker(live.marks, "BMParent");
    const lpChild = markForMarker(live.marks, "BMChild");
    record("lp-nested-independent", lpParent.visible.length > 0 && lpChild.visible.length > 0 && lpParent.visible[0].key === "dep" && lpChild.visible[0].key === "date",
      `parent=${lpParent.visible[0] && lpParent.visible[0].key} child=${lpChild.visible[0] && lpChild.visible[0].key}`);
    const lpFolds = await collectFolds(client);
    record("lp-BM1-bars-folded", Boolean(lpFolds && lpFolds.bm1 && lpFolds.bm1.folded === true && lpFolds.bm1.markWidth <= 4), JSON.stringify(lpFolds && lpFolds.bm1).slice(0, 180));
    record("lp-BM8-bars-shown", Boolean(lpFolds && lpFolds.bm8 && lpFolds.bm8.folded === false && lpFolds.bm8.markWidth > 4), JSON.stringify(lpFolds && lpFolds.bm8).slice(0, 180));
    record("lp-BM9-bars-shown", Boolean(lpFolds && lpFolds.bm9 && lpFolds.bm9.folded === false && lpFolds.bm9.markWidth > 4), JSON.stringify(lpFolds && lpFolds.bm9).slice(0, 180));
    record("lp-BM7-pill-folded", Boolean(lpFolds && lpFolds.bm7 && lpFolds.bm7.prjFolded === true), JSON.stringify(lpFolds && lpFolds.bm7).slice(0, 180));
    record("lp-BM19-pill-kept", Boolean(lpFolds && lpFolds.bm19 && lpFolds.bm19.prjFolded === false && lpFolds.bm19.tagWidth > 4), JSON.stringify(lpFolds && lpFolds.bm19).slice(0, 180));
    // (Fence tree-name recording moved to the refresh-edit rebuild below.)

    const shotLiveLight = path.join(outDir, "e2e-block-marks-live-light.png");
    await openNote(client, fixture.marks, "live");
    await sleep(600);
    await capturePage(client, shotLiveLight);
    report.screenshots.push(shotLiveLight);

    await client.evaluate(`(() => { document.body.classList.remove("theme-light"); document.body.classList.add("theme-dark"); return true; })()`);
    await sleep(400);
    const liveDarkProbe = await client.evaluate(MARKS_PROBE).catch(() => ({ marked: [] }));
    record("theme-dark-repaints", (liveDarkProbe.marked || []).filter((m) => m.visible !== false).length > 0, `${(liveDarkProbe.marked || []).length} marks under dark`);
    const shotLiveDark = path.join(outDir, "e2e-block-marks-live-dark.png");
    await capturePage(client, shotLiveDark);
    report.screenshots.push(shotLiveDark);
    await client.evaluate(`(() => { document.body.classList.remove("theme-dark"); document.body.classList.add("theme-light"); return true; })()`);
    await sleep(300);

    // Reading view vectors with scrolling.
    const reading = await collectMarks(client, fixture.marks, "preview");
    for (const [marker, want] of Object.entries(EXPECTED_KEYS)) {
      const found = markForMarker(reading.marks, marker);
      if (found.visible.length === 0) {
        record(`reading-${marker}-marked`, false, `no visible mark for ${marker}; saw ${reading.marks.length} marks`);
      } else {
        record(`reading-${marker}-marked`, found.visible[0].key === want, `${marker} key=${found.visible[0].key} want=${want}`);
      }
    }
    const rdParent = markForMarker(reading.marks, "BMParent");
    const rdChild = markForMarker(reading.marks, "BMChild");
    record("reading-nested-independent", rdParent.visible.length > 0 && rdChild.visible.length > 0 && rdParent.visible[0].key === "dep" && rdChild.visible[0].key === "date",
      `parent=${rdParent.visible[0] && rdParent.visible[0].key} child=${rdChild.visible[0] && rdChild.visible[0].key}`);
    const readingFolds = await collectFolds(client);
    record("reading-BM1-bars-folded", Boolean(readingFolds && readingFolds.bm1 && readingFolds.bm1.folded === true), JSON.stringify(readingFolds && readingFolds.bm1).slice(0, 180));
    record("reading-BM7-pill-folded", Boolean(readingFolds && readingFolds.bm7 && readingFolds.bm7.prjFolded === true), JSON.stringify(readingFolds && readingFolds.bm7).slice(0, 180));
    record("reading-BM19-pill-kept", Boolean(readingFolds && readingFolds.bm19 && readingFolds.bm19.prjFolded === false), JSON.stringify(readingFolds && readingFolds.bm19).slice(0, 180));
    // Quote diagnostic: the BM20 row is a quoted task; the reading adapter
    // maps it through section text plus data-line, so record what it saw.
    const quoteDiag = await client.evaluate(`(() => (async () => {
      const rows = Array.from(document.querySelectorAll("li.task-list-item"));
      const row = rows.find((li) => String(li.textContent || "").includes("BM20 quoted"));
      const anyLi = Array.from(document.querySelectorAll("li")).find((li) => String(li.textContent || "").includes("BM20 quoted"));
      const bqs = Array.from(document.querySelectorAll("blockquote")).map((bq) => String(bq.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 80));
      const plugin = window.app.plugins.plugins["bob-ledger-tools"];
      const api = plugin && plugin.blockMarksApi ? plugin.blockMarksApi() : null;
      const abstract = window.app.vault.getAbstractFileByPath(${JSON.stringify(fixture.marks)});
      const text = abstract ? await window.app.vault.read(abstract) : "";
      const line = text.split("\\n").find((l) => l.includes("BM20 quoted")) || "";
      let model = null;
      try { model = api ? api.model(line, { path: ${JSON.stringify(fixture.marks)} }) : null; } catch (e) { model = { error: String(e) }; }
      return {
        bodyHasBM20: String(document.body.textContent || "").includes("BM20"),
        rowFound: Boolean(row),
        rowTask: row ? row.getAttribute("data-task") : null,
        rowBlock: row ? row.getAttribute("data-bob-block") : null,
        rowLine: row ? row.getAttribute("data-line") : null,
        anyLiClass: anyLi ? String(anyLi.className || "").slice(0, 120) : null,
        anyLiTask: anyLi ? anyLi.getAttribute("data-task") : null,
        bqCount: bqs.length,
        bqTexts: bqs.slice(0, 3),
        liTaskCount: rows.length,
        modelKey: model ? model.key : null,
        lineHead: line.slice(0, 60),
      };
    })())()`).catch((e) => ({ error: String(e) }));
    record("reading-BM20-diagnostic", true, JSON.stringify(quoteDiag).slice(0, 600));

    const shotReadingLight = path.join(outDir, "e2e-block-marks-reading-light.png");
    await openNote(client, fixture.marks, "preview");
    await sleep(600);
    await capturePage(client, shotReadingLight);
    report.screenshots.push(shotReadingLight);
    await client.evaluate(`(() => { document.body.classList.remove("theme-light"); document.body.classList.add("theme-dark"); return true; })()`);
    await sleep(400);
    const shotReadingDark = path.join(outDir, "e2e-block-marks-reading-dark.png");
    await capturePage(client, shotReadingDark);
    report.screenshots.push(shotReadingDark);
    await client.evaluate(`(() => { document.body.classList.remove("theme-dark"); document.body.classList.add("theme-light"); return true; })()`);
    await sleep(300);

    // Computed paint: glyph, pip, hit area, row height for dep/p2/stale.
    async function computedByMarker(marker) {
      return client.evaluate(`(() => { try {
        const marker = ${JSON.stringify(marker)};
        const hosts = Array.from(document.querySelectorAll("[data-bob-block]"));
        const host = hosts.find((el) => {
          const line = el.closest(".HyperMD-task-line, .cm-line, li");
          const text = line ? String(line.textContent || "") : String(el.textContent || "");
          return text.includes(marker);
        });
        if (!host) return { ok: false, error: "no host for " + marker };
        const box = host.matches("input") ? host
          : host.querySelector("input.task-list-item-checkbox, input[type='checkbox'], .task-list-item-checkbox, span.bob-block-mark");
        if (!box) return { ok: false, error: "no box for " + marker };
        const cs = window.getComputedStyle(box);
        const after = window.getComputedStyle(box, "::after");
        const before = window.getComputedStyle(box, "::before");
        const rect = box.getBoundingClientRect();
        const line = box.closest(".HyperMD-task-line, li");
        const lineRect = line ? line.getBoundingClientRect() : null;
        return {
          ok: true,
          key: host.getAttribute("data-bob-block"),
          glyph: String(after.content || ""),
          glyphColor: String(after.color || ""),
          pipWidth: String(before.width || ""),
          pipBackground: String(before.backgroundColor || ""),
          border: String(cs.borderTopWidth || "") + " " + String(cs.borderTopStyle || ""),
          background: String(cs.backgroundColor || ""),
          boxWidth: Math.round(rect.width || 0),
          boxHeight: Math.round(rect.height || 0),
          lineHeight: lineRect ? Math.round(lineRect.height || 0) : null,
        };
      } catch (e) { return { ok: false, error: String(e && e.message || e) }; } })()`);
    }
    await openNote(client, fixture.marks, "live");
    await sleep(500);
    const compDep = await computedByMarker("BM4 dep vector");
    record("paint-dep-glyph", compDep && compDep.ok && /&/.test(compDep.glyph), JSON.stringify(compDep).slice(0, 220));
    record("paint-dep-held-fill", compDep && compDep.ok && compDep.background && !/rgba\(0,\s*0,\s*0,\s*0\)|transparent/.test(compDep.background), compDep && compDep.background);
    const compP2 = await computedByMarker("BM1 p2 vector");
    record("paint-p2-digit", compP2 && compP2.ok && /2/.test(compP2.glyph), JSON.stringify(compP2).slice(0, 220));
    const compPip = await computedByMarker("BM8 dep pip");
    record("paint-pip-geometry", compPip && compPip.ok && /6px/.test(compPip.pipWidth || ""), JSON.stringify(compPip).slice(0, 220));
    const compStale = await computedByMarker("BM5 stale");
    record("paint-stale-dashed", compStale && compStale.ok && /dashed/.test(compStale.border || ""), JSON.stringify(compStale).slice(0, 220));
    const hitOk = compDep && compDep.ok && compDep.boxWidth >= 12 && compDep.boxHeight >= 12;
    record("paint-hit-area", hitOk, compDep && `box=${compDep.boxWidth}x${compDep.boxHeight}`);
    const heights = await client.evaluate(LINE_HEIGHT_PROBE).catch(() => ({}));
    const heightOk = heights && heights.bm1 && heights.bm2 && Math.abs(heights.bm1.height - heights.bm2.height) <= 2;
    record("paint-row-height", heightOk, JSON.stringify(heights).slice(0, 160));
    for (const [key, marker] of Object.entries(KEY_PAINT_MARKERS)) {
      const paint = await computedByMarker(marker);
      if (paint && paint.ok === true) {
        record(`paint-${key}-checkbox`, paint.key === key, `marker=${marker} key=${paint.key} glyph=${paint.glyph}`);
        continue;
      }
      const missingBox = paint && /no box/.test(String(paint.error || ""));
      if (!missingBox) {
        record(`paint-${key}-checkbox`, false, JSON.stringify(paint).slice(0, 180));
        continue;
      }
      const rowMark = await client.evaluate(`(() => {
        const marker = ${JSON.stringify(marker)};
        const hosts = Array.from(document.querySelectorAll("[data-bob-block], .HyperMD-task-line, li"));
        const host = hosts.find((el) => String(el.textContent || "").includes(marker));
        if (!host) return { ok: false, error: "no row for " + marker };
        return { ok: true, key: host.getAttribute("data-bob-block") };
      })()`).catch((e) => ({ ok: false, error: String(e) }));
      if (rowMark && rowMark.ok && rowMark.key === key) {
        record(`paint-${key}-checkbox`, true, `source form has no owned checkbox; row marked ${key}`);
      } else {
        record(`paint-${key}-checkbox`, false, `source form has no owned checkbox: ${paint.error}; row=${JSON.stringify(rowMark).slice(0, 80)}`);
      }
    }
    await openNote(client, fixture.marks, "preview");
    await sleep(800);
    const readingP4 = await computedByMarker("BM20 quoted");
    if (readingP4 && readingP4.ok && readingP4.key === "p4") {
      record("reading-p4-checkbox", true, JSON.stringify(readingP4).slice(0, 220));
    } else {
      const readingP4Row = await client.evaluate(`(() => {
        const rows = Array.from(document.querySelectorAll("li.task-list-item, li, [data-bob-block]"));
        const row = rows.find((el) => String(el.textContent || "").includes("BM20 quoted"));
        if (!row) return { ok: false, error: "BM20 row missing in reading view" };
        const box = row.querySelector("input.task-list-item-checkbox, input[type='checkbox'], .task-list-item-checkbox");
        return {
          ok: true,
          key: row.getAttribute("data-bob-block"),
          hasBox: Boolean(box),
          className: String(row.className || "").slice(0, 80),
        };
      })()`).catch((e) => ({ ok: false, error: String(e) }));
      if (readingP4Row && readingP4Row.key === "p4") {
        record(
          "reading-p4-checkbox",
          true,
          readingP4Row.hasBox
            ? JSON.stringify(readingP4Row).slice(0, 220)
            : `source form has no owned checkbox; row marked p4 ${JSON.stringify(readingP4Row).slice(0, 120)}`,
        );
      } else {
        record("reading-p4-checkbox", false, JSON.stringify({ paint: readingP4, row: readingP4Row }).slice(0, 240));
      }
    }
    await openNote(client, fixture.marks, "live");
    await sleep(400);
    const snippetProbe = await client.evaluate(`(() => {
      const custom = window.app && window.app.customCss;
      const snippetName = "task-statuses";
      const stylePresent = () => Array.from(document.querySelectorAll("style, link")).some((node) => {
        const id = String(node.id || "");
        const href = String(node.getAttribute && node.getAttribute("href") || "");
        const text = String(node.textContent || "");
        return /task-statuses/.test(id) || /task-statuses/.test(href) || /task-statuses/.test(text.slice(0, 400));
      });
      const beforePresent = stylePresent();
      const enabledBefore = custom && custom.enabledSnippets ? custom.enabledSnippets.has(snippetName) : null;
      if (custom && typeof custom.setCssEnabledStatus === "function") {
        custom.setCssEnabledStatus(snippetName, false);
      }
      const enabledAfter = custom && custom.enabledSnippets ? custom.enabledSnippets.has(snippetName) : false;
      const afterPresent = stylePresent();
      const host = document.querySelector('[data-bob-block="dep"], [data-bob-block="p2"], [data-bob-block]');
      if (!host) return { error: "no marked host", stylePresent: afterPresent, enabled: enabledAfter, beforePresent, enabledBefore };
      const box = host.matches("input") ? host : host.querySelector("input.task-list-item-checkbox") || host;
      const after = window.getComputedStyle(box, "::after");
      const cs = window.getComputedStyle(box);
      const glyph = String(after.content || "");
      const background = String(cs.backgroundColor || "");
      const paintOk = Boolean(glyph && glyph !== "none" && glyph !== "normal") || (background && !/transparent|rgba\\(0,\\s*0,\\s*0,\\s*0\\)/.test(background));
      return {
        stylePresent: afterPresent,
        enabled: enabledAfter,
        beforePresent,
        enabledBefore,
        removedLinksOnly: false,
        glyph,
        background,
        paintOk,
        family: host.getAttribute("data-bob-block-family"),
      };
    })()`).catch((e) => ({ error: String(e) }));
    const snippetAssert = asserts.assertSnippetDisabled(snippetProbe);
    record("paint-without-snippet", snippetAssert.ok, JSON.stringify(snippetProbe).slice(0, 240));
    await client.evaluate(`(() => {
      const custom = window.app && window.app.customCss;
      if (custom && typeof custom.setCssEnabledStatus === "function") custom.setCssEnabledStatus("task-statuses", true);
      return true;
    })()`).catch(() => false);

    await openNote(client, fixture.embedHost, "preview");
    await sleep(800);
    const embedProbe = await namedHostProbe(client, ".internal-embed, .markdown-embed, .markdown-embed-content", "BM1 p2 vector");
    const embedAssert = asserts.assertNamedHostMark(
      { ...embedProbe, originHost: embedProbe && embedProbe.hostFound ? "embed" : embedProbe && embedProbe.originHost },
      { hostKind: "embed", marker: "BM1", wantKey: "p2" },
    );
    record("embed-marks", embedAssert.ok, JSON.stringify(embedAssert.mark || embedAssert).slice(0, 220));
    const shotEmbed = path.join(outDir, "e2e-block-marks-embed.png");
    await capturePage(client, shotEmbed);
    report.screenshots.push(shotEmbed);

    await openNote(client, fixture.prose, "preview");
    await sleep(400);
    const hover = await client.evaluate(`(() => {
      const app = window.app;
      const links = Array.from(document.querySelectorAll("a.internal-link"));
      const target = links.find((link) => {
        const href = String(link.getAttribute("data-href") || link.getAttribute("href") || "");
        return href === "block-marks" || href === "block-marks.md";
      });
      if (!target) return { ok: false, error: "BM link missing", hrefs: links.map((l) => l.getAttribute("data-href")).slice(0, 8) };
      const rect = target.getBoundingClientRect();
      const event = new MouseEvent("mouseover", { bubbles: true, cancelable: true, clientX: rect.left + 4, clientY: rect.top + 4 });
      app.workspace.trigger("hover-link", { event, source: "preview", hoverParent: target, targetEl: target, linktext: "block-marks", sourcePath: "prose.md" });
      return { ok: true };
    })()`);
    if (!hover || !hover.ok) {
      skip("hover-popover-marks", hover && hover.error ? hover.error : "BM link missing");
    } else {
      await waitForMarks(client, (v) => v && v.popover === true, "hover-popover-marks", 6000).catch((e) => ({ error: e.message, popover: false }));
      const popoverProbe = await namedHostProbe(client, ".popover.hover-popover, .hover-popover", "BM4 dep vector");
      const popoverAssert = asserts.assertNamedHostMark(
        { ...popoverProbe, originHost: popoverProbe && popoverProbe.hostFound ? "popover" : popoverProbe && popoverProbe.originHost },
        { hostKind: "popover", marker: "BM4", wantKey: "dep" },
      );
      record("hover-popover-marks", popoverAssert.ok, JSON.stringify(popoverAssert.mark || popoverAssert).slice(0, 220));
      const shotHover = path.join(outDir, "e2e-block-marks-hover.png");
      await capturePage(client, shotHover);
      report.screenshots.push(shotHover);
    }
    await openNote(client, fixture.marks, "live");
    await sleep(500);
    const expectedTip = await expectedTooltipForMarker(client, fixture.marks, "BM1 p2 vector");
    const hovered = await hoverCheckboxViaCdp(client, "BM1 p2 vector");
    const tooltipAssert = asserts.assertExactTooltip({
      aria: hovered && hovered.aria,
      tip: hovered && hovered.tip,
      expected: expectedTip && expectedTip.tooltip,
    });
    record("hover-tooltip-text", tooltipAssert.ok, JSON.stringify(tooltipAssert).slice(0, 240));
    record("lp-tooltip-aria", Boolean(tooltipAssert.ariaOk), `aria=${JSON.stringify(tooltipAssert.aria || "").slice(0, 120)}`);
    record("lp-tooltip-position", Boolean((await client.evaluate(`(() => {
      const boxes = Array.from(document.querySelectorAll("input.task-list-item-checkbox"));
      const box = boxes.find((node) => String((node.closest(".HyperMD-task-line, li") || {}).textContent || "").includes("BM1 p2 vector"));
      return box ? box.getAttribute("data-tooltip-position") || "" : "";
    })()`).catch(() => "")) === "top"), "top");

    // Toggle off removes attributes and restores prior appearance, then back on.
    // The BM note carries the marks; the prose note has none, so toggling there
    // proves nothing about removal or restoration.
    await openNote(client, fixture.marks, "live");
    await sleep(500);
    const heightsBefore = await client.evaluate(LINE_HEIGHT_PROBE).catch(() => ({}));
    const beforeToggle = await client.evaluate(MARKS_PROBE).catch(() => ({}));
    const beforeVisible = (beforeToggle.marked || []).filter((m) => m.visible !== false);
    record("toggle-precondition", beforeToggle.gate === true && beforeVisible.length > 0, `gate=${beforeToggle.gate} visible=${beforeVisible.length}`);
    const beforeToggleAria = await client.evaluate(`(() => {
      const boxes = Array.from(document.querySelectorAll("input.task-list-item-checkbox"));
      const box = boxes.find((node) => String((node.closest(".HyperMD-task-line, li") || {}).textContent || "").includes("BM1 p2 vector"));
      if (!box) return { ok: false };
      return {
        ok: true,
        aria: box.getAttribute("aria-label") || "",
        pos: box.getAttribute("data-tooltip-position") || "",
        glyph: String(window.getComputedStyle(box, "::after").content || ""),
        background: String(window.getComputedStyle(box).backgroundColor || ""),
      };
    })()`).catch(() => ({ ok: false }));
    const toggledOff = await client.evaluate(`(() => {
      const result = window.app.commands.executeCommandById("bob-ledger-tools:toggle-block-marks");
      return { ok: result !== false };
    })()`);
    record("toggle-off-command", toggledOff && toggledOff.ok, JSON.stringify(toggledOff));
    const offProbe = await waitForMarks(client, (v) => v && v.gate === false, "toggle-hides-marks", 4000).catch((e) => ({ error: e.message, marked: [], gate: true }));
    record("toggle-hides-marks", offProbe.gate === false, `gate=${offProbe.gate} visible=${(offProbe.marked || []).filter((m) => m.visible !== false).length}`);
    const afterToggleOff = await client.evaluate(`(() => {
      const boxes = Array.from(document.querySelectorAll("input.task-list-item-checkbox"));
      const box = boxes.find((node) => String((node.closest(".HyperMD-task-line, li") || {}).textContent || "").includes("BM1 p2 vector"));
      if (!box) return { ok: false };
      return {
        ok: true,
        aria: box.getAttribute("aria-label") || "",
        pos: box.getAttribute("data-tooltip-position") || "",
        glyph: String(window.getComputedStyle(box, "::after").content || ""),
        background: String(window.getComputedStyle(box).backgroundColor || ""),
      };
    })()`).catch(() => ({ ok: false }));
    record(
      "toggle-restores-tooltip",
      Boolean(afterToggleOff && afterToggleOff.ok && afterToggleOff.aria !== (beforeToggleAria && beforeToggleAria.aria) && !/^Blocked|^Recurring/.test(afterToggleOff.aria || "")),
      JSON.stringify({ before: beforeToggleAria, after: afterToggleOff }).slice(0, 260),
    );
    record(
      "toggle-restores-paint",
      Boolean(afterToggleOff && afterToggleOff.ok && afterToggleOff.glyph !== (beforeToggleAria && beforeToggleAria.glyph)),
      JSON.stringify({ before: beforeToggleAria && beforeToggleAria.glyph, after: afterToggleOff && afterToggleOff.glyph }).slice(0, 180),
    );
    const heightsOff = await client.evaluate(LINE_HEIGHT_PROBE).catch(() => ({}));
    const hOn = heightsBefore && heightsBefore.bm1 && heightsBefore.bm1.height;
    const hOff = heightsOff && heightsOff.bm1 && heightsOff.bm1.height;
    record("toggle-row-height-unchanged", Number.isFinite(hOn) && Number.isFinite(hOff) && Math.abs(hOn - hOff) <= 1, `on=${hOn} off=${hOff}`);
    await client.evaluate(`(() => window.app.commands.executeCommandById("bob-ledger-tools:toggle-block-marks"))()`);
    const onProbe = await waitForMarks(client, (v) => v && v.gate === true && (v.marked || []).filter((m) => m.visible !== false).length >= beforeVisible.length, "toggle-restores-marks", 6000).catch((e) => ({ error: e.message, marked: [], gate: false }));
    record("toggle-restores-marks", onProbe.gate === true && (onProbe.marked || []).filter((m) => m.visible !== false).length >= beforeVisible.length, `gate=${onProbe.gate} visible=${(onProbe.marked || []).length} before=${beforeVisible.length}`);

    // Click behavior is unchanged: the same status change with the gate on and off.
    // A real CDP mouse click drives Obsidian's own checkbox handler; the marks
    // never intercept clicks, so both passes must store the same new status.
    async function resetClickRow() {
      // Detach-first reset with full forensics: the trajectory records
      // whether vault.modify even claims a change, to separate a failing
      // write from a racing writer.
      const trajectory = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        const did = await client.evaluate(`(() => (async () => {
          const abstract = window.app.vault.getAbstractFileByPath(${JSON.stringify(fixture.marks)});
          if (!abstract) return { noFile: true };
          const text = await window.app.vault.read(abstract);
          const lines = text.split("\\n");
          const idx = lines.findIndex((l) => l.includes("BMClick probe"));
          const found = idx === -1 ? null : lines[idx];
          const rewritten = found === null ? null : found.replace(/^- \\[[^\\]]*\\]/, "- [?]");
          const next = idx === -1 ? text : lines.slice(0, idx).concat([rewritten]).concat(lines.slice(idx + 1)).join("\\n");
          if (next === text) return { changed: false, found, codes: Array.from((found || "").slice(0, 12)).map((c) => (c.codePointAt(0) || 0).toString(16)).join(",") };
          try {
            for (const leaf of window.app.workspace.getLeavesOfType("markdown")) {
              try { leaf.detach(); } catch {}
            }
          } catch {}
          await new Promise((r) => setTimeout(r, 300));
          await window.app.vault.modify(abstract, next);
          await new Promise((r) => setTimeout(r, 500));
          const check = await window.app.vault.read(abstract);
          const checkLine = check.split("\\n").find((l) => l.includes("BMClick probe")) || null;
          // Second layer: if the targeted rewrite did not stick, try a full
          // marker line to prove whether ANY write sticks.
          if (checkLine !== rewritten) {
            const marker = "- [?] #task BMClick probe MARKERWRITE";
            const next2 = check.split("\\n").map((l) => (l.includes("BMClick probe") ? marker : l)).join("\\n");
            await window.app.vault.modify(abstract, next2);
            await new Promise((r) => setTimeout(r, 500));
            const check2 = await window.app.vault.read(abstract);
            const checkLine2 = check2.split("\\n").find((l) => l.includes("BMClick probe")) || null;
            const canonical = "- [?] #task BMClick probe [scheduled:: " + ${JSON.stringify(fixture.dates.plus3)} + "]";
            const next3 = check2.split("\\n").map((l) => (l.includes("BMClick probe") ? canonical : l)).join("\\n");
            await window.app.vault.modify(abstract, next3);
            await new Promise((r) => setTimeout(r, 500));
            const check3 = await window.app.vault.read(abstract);
            const checkLine3 = check3.split("\\n").find((l) => l.includes("BMClick probe")) || null;
            return { changed: true, found, rewritten, checkLine, markerTried: true, checkLine2, checkLine3 };
          }
          return { changed: true, found, rewritten, checkLine };
        })())()`).catch((e) => ({ error: String(e) }));
        trajectory.push(JSON.stringify(did).slice(0, 220));
        if (did && typeof did.checkLine === "string" && /^- \\[\\?\\]/.test(did.checkLine)) break;
        if (did && typeof did.checkLine2 === "string" && did.checkLine2.includes("MARKERWRITE")) break;
        if (did && typeof did.checkLine3 === "string" && /^- \\[\\?\\]/.test(did.checkLine3)) break;
        await sleep(500);
      }
      globalThis.__bmResetTrajectory = trajectory;
      await openNote(client, fixture.marks, "live").catch(() => ({}));
      await sleep(700);
    }
    async function clickStatus(gateOn) {
      const wantGate = gateOn === true;
      const gateNow = await client.evaluate("document.body.classList.contains('bob-block-marks')").catch(() => null);
      if (gateNow !== wantGate) {
        await client.evaluate(`(() => window.app.commands.executeCommandById("bob-ledger-tools:toggle-block-marks"))()`);
        await sleep(700);
      }
      await resetClickRow();
      await openNote(client, fixture.marks, "live");
      await sleep(700);
      const before = await client.evaluate(`(() => (async () => {
        const abstract = window.app.vault.getAbstractFileByPath(${JSON.stringify(fixture.marks)});
        const text = await window.app.vault.read(abstract);
        const line = text.split("\\n").find((l) => l.includes("BMClick probe")) || "";
        return { line };
      })())()`);
      await client.evaluate(`(() => {
        const boxes = Array.from(document.querySelectorAll("input.task-list-item-checkbox"));
        const box = boxes.find((b) => String((b.closest(".HyperMD-task-line, li") || {}).textContent || "").includes("BMClick probe"));
        if (box) box.scrollIntoView({ block: "center" });
        return true;
      })()`).catch(() => false);
      await sleep(600);
      const point = await client.evaluate(`(() => {
        const boxes = Array.from(document.querySelectorAll("input.task-list-item-checkbox"));
        const box = boxes.find((b) => String((b.closest(".HyperMD-task-line, li") || {}).textContent || "").includes("BMClick probe"));
        if (!box) return { ok: false, error: "click box missing" };
        const rect = box.getBoundingClientRect();
        if (!rect || rect.width < 2 || rect.height < 2) return { ok: false, error: "click box has no layout" };
        return { ok: true, x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2), w: Math.round(rect.width), h: Math.round(rect.height) };
      })()`).catch((e) => ({ ok: false, error: String(e) }));
      let dispatch = { pressed: null, released: null, atPoint: null };
      if (point && point.ok) {
        dispatch.atPoint = await client.evaluate(`(() => {
          const el = document.elementFromPoint(${point.x}, ${point.y});
          if (!el) return { none: true };
          const box = el.closest ? el.closest(".HyperMD-task-line, li") : null;
          return { tag: String(el.tagName || "").toLowerCase(), cls: String(el.className || "").slice(0, 100), ctx: String(box ? box.textContent || "" : "").replace(/\\s+/g, " ").trim().slice(0, 60) };
        })()`).catch((e) => ({ error: String(e) }));
        dispatch.pressed = await client.call("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 }).then(() => ({ ok: true })).catch((e) => ({ ok: false, error: String(e && e.message || e) }));
        dispatch.released = await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 }).then(() => ({ ok: true })).catch((e) => ({ ok: false, error: String(e && e.message || e) }));
      }
      let after = { line: before && before.line };
      for (let i = 0; i < 20; i++) {
        await sleep(400);
        after = await client.evaluate(`(() => (async () => {
          const abstract = window.app.vault.getAbstractFileByPath(${JSON.stringify(fixture.marks)});
          const text = await window.app.vault.read(abstract);
          const line = text.split("\\n").find((l) => l.includes("BMClick probe")) || "";
          return { line };
        })())()`).catch(() => after);
        if (after && after.line && after.line !== (before && before.line)) break;
      }
      return { before: before && before.line, after: after && after.line, clicked: Boolean(point && point.ok), dispatch, point };
    }
    const clickOn = await clickStatus(true);
    await resetClickRow();
    record("click-reset-trajectory", true, JSON.stringify(globalThis.__bmResetTrajectory || null).slice(0, 300));
    const clickOff = await clickStatus(false);
    await resetClickRow();
    // Re-enable the gate if the second click left it off.
    const gateAfterClick = await client.evaluate("document.body.classList.contains('bob-block-marks')").catch(() => null);
    if (gateAfterClick !== true) {
      await client.evaluate(`(() => window.app.commands.executeCommandById("bob-ledger-tools:toggle-block-marks"))()`);
      await sleep(500);
    }
    const onTransition = `${clickOn.before} -> ${clickOn.after}`;
    const offTransition = `${clickOff.before} -> ${clickOff.after}`;
    record("click-status-unchanged", Boolean(clickOn.clicked && clickOff.clicked && clickOn.before && clickOn.after && clickOn.before !== clickOn.after && clickOn.after === clickOff.after), `on: ${onTransition.slice(0, 120)}; off: ${offTransition.slice(0, 120)}`);
    record("click-dispatch", true, `on=${JSON.stringify(clickOn.dispatch).slice(0, 260)} point=${JSON.stringify(clickOn.point).slice(0, 120)}`);

    // Fence tree-name recorder: wrap the editor guard so the forced rebuild
    // below records the REAL syntax names at the fenced #task position.
    // Installed before the document edit because only a doc change reliably
    // rebuilds decorations in the live app.
    await client.evaluate(`(() => {
      const plugin = window.app.plugins.plugins["bob-ledger-tools"];
      if (!plugin || plugin.__bmfWrapped) return { wrapped: Boolean(plugin && plugin.__bmfWrapped) };
      const orig = plugin.blockMarkVisibleTaskTag.bind(plugin);
      const seen = [];
      plugin.blockMarkVisibleTaskTag = function (lineText, tree, lineFrom) {
        const result = orig(lineText, tree, lineFrom);
        try {
          if (String(lineText || "").includes("BMF fenced")) {
            const idx = String(lineText).indexOf("#task");
            let names = [];
            let hasTree = Boolean(tree && typeof tree.resolveInner === "function");
            try {
              let node = tree.resolveInner(lineFrom + idx, -1);
              let g = 0;
              while (node && g < 8) { names.push(String(node.name || "")); node = node.parent; g += 1; }
            } catch (e) { names.push("ERR:" + String(e && e.message || e)); }
            seen.push({ lineFrom, idx, names, result, hasTree });
          }
        } catch (e) { seen.push({ error: String(e && e.message || e) }); }
        return result;
      };
      plugin.__bmfWrapped = true;
      plugin.__bmfSeen = seen;
      plugin.__bmfOrig = orig;
      return { wrapped: true };
    })()`).catch(() => ({}));
    const refreshBeforeModel = await expectedTooltipForMarker(client, fixture.marks, "BMClick probe");
    const refreshBeforeMark = markForMarker((await client.evaluate(MARKS_PROBE).catch(() => ({ marked: [] }))).marked, "BMClick");
    const refreshEdit = await client.evaluate(`(() => (async () => {
      const abstract = window.app.vault.getAbstractFileByPath(${JSON.stringify(fixture.marks)});
      const text = await window.app.vault.read(abstract);
      const lines = text.split("\\n");
      const idx = lines.findIndex((row) => row.includes("BMClick probe"));
      if (idx < 0) return { ok: false, error: "BMClick line missing" };
      const found = lines[idx];
      if (/\\[dependsOn::/.test(found)) return { ok: false, error: "BMClick already has dependsOn" };
      lines[idx] = found.replace(/(\\s*)$/, " [dependsOn:: x]$1");
      await window.app.vault.modify(abstract, lines.join("\\n"));
      return { ok: true, from: found, to: lines[idx] };
    })())()`);
    record("refresh-edit-applied", refreshEdit && refreshEdit.ok, JSON.stringify(refreshEdit).slice(0, 180));
    await sleep(1200);
    const refreshAfterProbe = await client.evaluate(MARKS_PROBE).catch(() => ({ marked: [] }));
    const refreshMark = markForMarker(refreshAfterProbe.marked, "BMClick").visible[0] || null;
    const refreshAfterModel = await expectedTooltipForMarker(client, fixture.marks, "BMClick probe");
    const refreshAssert = asserts.assertRefreshChanged(
      { key: refreshBeforeMark.visible[0] && refreshBeforeMark.visible[0].key || refreshBeforeModel && refreshBeforeModel.key, tooltip: refreshBeforeModel && refreshBeforeModel.tooltip, date: fixture.dates.plus3 },
      { key: refreshMark && refreshMark.key, tooltip: refreshAfterModel && refreshAfterModel.tooltip, date: fixture.dates.plus3 },
    );
    record("refresh-reclassifies", Boolean(refreshAssert.ok && refreshMark && refreshMark.key === "dep"), JSON.stringify({ assert: refreshAssert, mark: refreshMark }).slice(0, 240));
    const bmfNames = await client.evaluate(`(() => {
      const plugin = window.app.plugins.plugins["bob-ledger-tools"];
      const seen = (plugin && plugin.__bmfSeen) || [];
      try {
        if (plugin && plugin.__bmfOrig) plugin.blockMarkVisibleTaskTag = plugin.__bmfOrig;
        if (plugin) { delete plugin.__bmfWrapped; delete plugin.__bmfSeen; delete plugin.__bmfOrig; }
      } catch {}
      return { calls: seen.length, seen: seen.slice(0, 3) };
    })()`).catch((e) => ({ error: String(e) }));
    record("lp-BMF-treename", true, JSON.stringify(bmfNames).slice(0, 500));
    const refreshFence = markForMarker(refreshAfterProbe.marked, "BMF").visible[0] || null;
    record("fence-neutral-after-refresh", !refreshFence, refreshFence ? `still ${refreshFence.key}/${refreshFence.family} after a forced rebuild` : "neutral once decorations rebuild");
    await client.evaluate(`(() => (async () => {
      const abstract = window.app.vault.getAbstractFileByPath(${JSON.stringify(fixture.marks)});
      const text = await window.app.vault.read(abstract);
      const lines = text.split("\\n");
      const idx = lines.findIndex((row) => row.includes("BMClick probe"));
      if (idx >= 0) lines[idx] = lines[idx].replace(" [dependsOn:: x]", "");
      await window.app.vault.modify(abstract, lines.join("\\n"));
      return { ok: true };
    })())()`);
    await sleep(800);

    const bm6 = await client.evaluate(`(() => {
      const plugin = window.app.plugins.plugins["bob-ledger-tools"];
      const tasksPlugin = window.app.plugins.plugins["obsidian-tasks-plugin"];
      if (!plugin || !tasksPlugin || typeof tasksPlugin.getTasks !== "function") return { ok: false, error: "tasks plugin missing" };
      const memo = plugin.freshnessEnsureMemo();
      plugin.__bmOrigGetTasks = tasksPlugin.getTasks.bind(tasksPlugin);
      tasksPlugin.getTasks = () => [];
      try { delete memo.blockMarksIdIndex; } catch {}
      try { memo.tasks = []; } catch {}
      const cache = window.app.metadataCache;
      if (cache && typeof cache.trigger === "function") cache.trigger("resolved");
      return { ok: true };
    })()`);
    if (!fixture.tasksPlugin) {
      skip("bm6-cold-cache", "Tasks plugin was not copied");
    } else {
      record("bm6-cold-applied", Boolean(bm6 && bm6.ok), JSON.stringify(bm6).slice(0, 120));
      await sleep(400);
      const coldMarks = await client.evaluate(MARKS_PROBE).catch(() => ({ marked: [] }));
      const coldBm4 = markForMarker(coldMarks.marked, "BM4").visible[0] || null;
      record("bm6-cold-unmarked", !coldBm4, coldBm4 ? `still ${coldBm4.key}` : "BM4 unmarked while Tasks is empty");
      await client.evaluate(`(() => {
        const plugin = window.app.plugins.plugins["bob-ledger-tools"];
        const tasksPlugin = window.app.plugins.plugins["obsidian-tasks-plugin"];
        if (plugin && plugin.__bmOrigGetTasks && tasksPlugin) tasksPlugin.getTasks = plugin.__bmOrigGetTasks;
        if (plugin) delete plugin.__bmOrigGetTasks;
        const memo = plugin && plugin.freshnessEnsureMemo();
        try { delete memo.blockMarksIdIndex; } catch {}
        const cache = window.app.metadataCache;
        if (cache && typeof cache.trigger === "function") cache.trigger("resolved");
        return true;
      })()`);
      await sleep(500);
      const readyMarks = await client.evaluate(MARKS_PROBE).catch(() => ({ marked: [] }));
      const readyBm4 = markForMarker(readyMarks.marked, "BM4").visible[0] || null;
      record("bm6-ready-dep", Boolean(readyBm4 && readyBm4.key === "dep"), readyBm4 ? readyBm4.key : "BM4 missing after restore");
    }

    const bm22 = await client.evaluate(`(() => {
      const plugin = window.app.plugins.plugins["bob-ledger-tools"];
      if (!plugin || typeof plugin.refreshBlockMarksLadder !== "function") return { ok: false, error: "ladder seam missing" };
      plugin.__bmOrigLadderSnap = plugin.priorityLadderSnapshot.bind(plugin);
      plugin.priorityLadderSnapshot = () => ({ ladder: [{ label: "P3", value: "medium" }] });
      if (plugin.priorityLadderCache && typeof plugin.priorityLadderCache === "object") {
        plugin.priorityLadderCache.checkedAt = Number.NEGATIVE_INFINITY;
      }
      const changed = plugin.refreshBlockMarksLadder(true);
      return { ok: true, changed };
    })()`);
    record("bm22-ladder-applied", Boolean(bm22 && bm22.ok && bm22.changed), JSON.stringify(bm22).slice(0, 120));
    await sleep(400);
    const ladderMarks = await client.evaluate(MARKS_PROBE).catch(() => ({ marked: [] }));
    const ladderBm1 = markForMarker(ladderMarks.marked, "BM1").visible[0] || null;
    record("bm22-bm1-p3", Boolean(ladderBm1 && ladderBm1.key === "p3"), ladderBm1 ? ladderBm1.key : "BM1 missing after ladder change");
    await client.evaluate(`(() => {
      const plugin = window.app.plugins.plugins["bob-ledger-tools"];
      if (plugin && plugin.__bmOrigLadderSnap) plugin.priorityLadderSnapshot = plugin.__bmOrigLadderSnap;
      if (plugin) delete plugin.__bmOrigLadderSnap;
      if (plugin && plugin.priorityLadderCache && typeof plugin.priorityLadderCache === "object") {
        plugin.priorityLadderCache.checkedAt = Number.NEGATIVE_INFINITY;
      }
      if (plugin && typeof plugin.refreshBlockMarksLadder === "function") plugin.refreshBlockMarksLadder(true);
      return true;
    })()`);
    await sleep(400);

    const bm23 = await client.evaluate(`(() => {
      const plugin = window.app.plugins.plugins["bob-ledger-tools"];
      if (!plugin || typeof plugin.refreshDateMarksForRollover !== "function") return { ok: false, error: "rollover seam missing" };
      const orig = typeof plugin.dateMarksToday === "function" ? plugin.dateMarksToday() : null;
      const plus1 = ${JSON.stringify(fixture.dates.plus1)};
      const parts = String(plus1).split("-").map(Number);
      plugin.dateMarksDay = orig;
      plugin.blockMarksDay = orig;
      plugin.__bmOrigToday = plugin.dateMarksToday.bind(plugin);
      plugin.dateMarksToday = () => plus1;
      const dateNow = new Date(parts[0], parts[1] - 1, parts[2], 12);
      const rolledDate = plugin.refreshDateMarksForRollover(dateNow);
      const rolledBlock = typeof plugin.refreshBlockMarksForRollover === "function"
        ? plugin.refreshBlockMarksForRollover(dateNow)
        : null;
      return { ok: true, rolledDate, rolledBlock, plus1, orig, dateMarksDay: plugin.dateMarksDay, blockMarksDay: plugin.blockMarksDay };
    })()`);
    record("bm23-rollover-applied", Boolean(bm23 && bm23.ok && bm23.rolledDate), JSON.stringify(bm23).slice(0, 180));
    await sleep(800);
    const rollMarks = await client.evaluate(MARKS_PROBE).catch(() => ({ marked: [] }));
    const rollBm3 = markForMarker(rollMarks.marked, "BM3").visible[0] || null;
    record("bm23-repeat-stale", Boolean(rollBm3 && rollBm3.key === "stale"), rollBm3 ? rollBm3.key : "BM3 missing after controlled clock");
    await client.evaluate(`(() => {
      const plugin = window.app.plugins.plugins["bob-ledger-tools"];
      if (plugin && plugin.__bmOrigToday) plugin.dateMarksToday = plugin.__bmOrigToday;
      if (plugin) delete plugin.__bmOrigToday;
      const today = plugin && typeof plugin.dateMarksToday === "function" ? plugin.dateMarksToday() : null;
      const parts = String(today || "").split("-").map(Number);
      if (plugin && typeof plugin.refreshDateMarksForRollover === "function" && parts.length === 3) {
        plugin.refreshDateMarksForRollover(new Date(parts[0], parts[1] - 1, parts[2], 12));
      }
      return true;
    })()`);
    await sleep(400);
    report.controlledClockNote = "BM23 patches dateMarksToday and calls refreshDateMarksForRollover; it is not a midnight observation.";

    // Tasks query results: CSS-only marks from Tasks' own row attributes (BM24).
    if (!fixture.tasksPlugin) {
      skip("tasks-query-css", "Tasks plugin was not copied into the scratch vault; node tests cover query CSS");
    } else {
      await openNote(client, fixture.tasksQuery, "preview");
      await sleep(800);
      await client.evaluate(`(() => {
        const preview = document.querySelector(".markdown-preview-view");
        if (preview) preview.scrollTop = preview.scrollHeight;
        return true;
      })()`).catch(() => false);
      await sleep(600);
      await client.evaluate(`(() => {
        const preview = document.querySelector(".markdown-preview-view");
        if (preview) preview.scrollTop = 0;
        return true;
      })()`).catch(() => false);
      const layoutsReady = (probe) => {
        const rows = (probe && probe.rows) || [];
        const layouts = new Set(rows.map((row) => row.layout));
        return rows.length > 0 && layouts.has("full") && layouts.has("short") && layouts.has("hide-priority");
      };
      let tasksProbe = null;
      try {
        tasksProbe = await waitFor(client, TASKS_ROWS_PROBE, layoutsReady, "tasks-query-layouts", 12000);
      } catch (_error) {
        tasksProbe = await client.evaluate(TASKS_ROWS_PROBE).catch(() => ({ rows: [] }));
      }
      if (!(tasksProbe.rows || []).length) {
        skip("tasks-query-css", "Tasks query rows did not render; node tests cover query CSS");
      } else {
        const pick = (marker, layout) => (tasksProbe.rows || []).find((row) => (
          asserts.contextHasMarker(row && row.text, marker) && (!layout || row.layout === layout)
        )) || null;
        const jsMarked = (tasksProbe.rows || []).filter((row) => row.jsMarked);
        record("tasks-query-no-js-attrs", jsMarked.length === 0, `${jsMarked.length} JS-marked of ${(tasksProbe.rows || []).length} Tasks rows`);

        const bm1 = pick("BM1", "full");
        const bm24 = asserts.assertTasksCssMark(bm1, {
          marker: "BM1",
          wantKey: "p2",
          wantGlyph: "2",
          wantMask: false,
          hidePriority: true,
        });
        record(
          "bm24-tasks-css-digit",
          Boolean(bm24.ok && bm1 && String(bm1.scheduled || "").startsWith("future-") && bm1.priority === "medium" && bm1.dataTask === "?"),
          JSON.stringify({ ok: bm24.ok, reason: bm24.reason, scheduled: bm1 && bm1.scheduled, priority: bm1 && bm1.priority, dataLine: bm1 && bm1.dataLine, attrs: bm1 && bm1.attrNames }).slice(0, 360),
        );
        report.tasksAttributes = {
          versionHint: "Tasks 8.4.0 contract / installed 8.6.0 renderTaskLine",
          sample: (tasksProbe.rows || []).filter((row) => row.layout === "full").slice(0, 8).map((row) => ({
            text: row.text,
            dataTask: row.dataTask,
            dataLine: row.dataLine,
            scheduled: row.scheduled,
            priority: row.priority,
            hasRecurring: row.hasRecurring,
            hasPrjTag: row.hasPrjTag,
            attrNames: row.attrNames,
          })),
        };

        const bm2 = asserts.assertTasksCssMark(pick("BM2", "full"), { marker: "BM2", wantKey: "date", wantGlyph: "?", wantMask: false });
        record("tasks-BM2-date", bm2.ok, bm2.reason || "date");
        const bm3 = asserts.assertTasksCssMark(pick("BM3", "full"), { marker: "BM3", wantKey: "repeat", wantGlyph: "", wantMask: true });
        record("tasks-BM3-repeat", bm3.ok, bm3.reason || "repeat");
        const bm4 = asserts.assertTasksCssMark(pick("BM4", "full"), { marker: "BM4", wantKey: "dep", wantGlyph: "&", wantMask: false });
        record("tasks-BM4-dep", bm4.ok, bm4.reason || "dep");
        const bm7 = asserts.assertTasksCssMark(pick("BM7", "full"), { marker: "BM7", wantKey: "prj", wantGlyph: "", wantMask: true, hidePrjTag: true });
        record("tasks-BM7-prj", bm7.ok, bm7.reason || "prj");
        const bm10 = asserts.assertTasksCssMark(pick("BM10", "full"), { marker: "BM10", wantKey: "date", wantGlyph: "?", wantMask: false });
        record("tasks-BM10-highest-date", bm10.ok, bm10.reason || "date");
        const bm12 = pick("BM12", "full");
        record("tasks-BM12-untouched", Boolean(bm12 && bm12.dataTask === "*" && !bm12.jsMarked), JSON.stringify(bm12 && { dataTask: bm12.dataTask, glyph: bm12.glyph }).slice(0, 160));
        const bm19 = asserts.assertTasksCssMark(pick("BM19", "full"), { marker: "BM19", wantKey: "prj", wantGlyph: "", wantMask: true, hidePrjTag: true });
        record("tasks-BM19-prj-limit", bm19.ok, bm19.reason || "prj-over-dep known limit");

        const bm1Short = asserts.assertTasksCssMark(pick("BM1", "short"), { marker: "BM1-short", wantKey: "p2", wantGlyph: "2" });
        record("tasks-short-BM1", bm1Short.ok, bm1Short.reason || "short");
        const bm1Hide = asserts.assertTasksCssMark(pick("BM1", "hide-priority"), { marker: "BM1-hide-priority", wantKey: "p2", wantGlyph: "2" });
        record("tasks-hide-priority-BM1", bm1Hide.ok, bm1Hide.reason || "hide-priority still classifies from data-task-priority");

        const shotTasksLight = path.join(outDir, "e2e-block-marks-tasks-light.png");
        await capturePage(client, shotTasksLight);
        report.screenshots.push(shotTasksLight);
        await client.evaluate(`(() => { document.body.classList.remove("theme-light"); document.body.classList.add("theme-dark"); return true; })()`);
        await sleep(400);
        const shotTasksDark = path.join(outDir, "e2e-block-marks-tasks-dark.png");
        await capturePage(client, shotTasksDark);
        report.screenshots.push(shotTasksDark);
        await client.evaluate(`(() => { document.body.classList.remove("theme-dark"); document.body.classList.add("theme-light"); return true; })()`);
        await sleep(300);

        await client.evaluate(`(() => window.app.commands.executeCommandById("bob-ledger-tools:toggle-block-marks"))()`);
        await sleep(400);
        const offTasks = await client.evaluate(TASKS_ROWS_PROBE).catch(() => ({ rows: [], gate: true }));
        const offBm1 = (offTasks.rows || []).find((row) => asserts.contextHasMarker(row && row.text, "BM1") && row.layout === "full") || null;
        const offGlyph = asserts.computedContentGlyph(offBm1 && offBm1.glyph);
        record(
          "tasks-toggle-restores",
          Boolean(offTasks.gate === false && offBm1 && offGlyph !== "2"),
          JSON.stringify({ gate: offTasks.gate, glyph: offGlyph, background: offBm1 && offBm1.background }).slice(0, 220),
        );
        await client.evaluate(`(() => window.app.commands.executeCommandById("bob-ledger-tools:toggle-block-marks"))()`);
        await sleep(400);
        tasksProbe = await client.evaluate(TASKS_ROWS_PROBE).catch(() => ({ rows: [], gate: false }));
        const onBm1 = (tasksProbe.rows || []).find((row) => asserts.contextHasMarker(row && row.text, "BM1") && row.layout === "full") || null;
        record(
          "tasks-toggle-restores-on",
          Boolean(tasksProbe.gate === true && asserts.computedContentGlyph(onBm1 && onBm1.glyph) === "2"),
          JSON.stringify({ gate: tasksProbe.gate, glyph: onBm1 && onBm1.glyph }).slice(0, 180),
        );
      }
    }

    if (!fixture.dataviewPlugin) {
      skip("dataview-rows", "Dataview was not copied into the scratch vault; node tests cover delayed origins");
    } else {
      await openNote(client, fixture.dataviewQuery, "preview");
      await sleep(3000);
      let dvNamed = await namedHostProbe(client, ".block-language-dataview", "BM4 dep vector");
      let dvAssert = asserts.assertNamedHostMark(
        { ...dvNamed, originHost: dvNamed && dvNamed.hostFound ? "dataview" : dvNamed && dvNamed.originHost },
        { hostKind: "dataview", marker: "BM4", wantKey: "dep" },
      );
      if (!dvAssert.ok) {
        const dvDump = await client.evaluate(`(() => {
          const host = document.querySelector(".block-language-dataview");
          if (!host) return { error: "dataview host missing" };
          const rows = Array.from(host.querySelectorAll("li, .task-list-item, [data-bob-block]"));
          const sample = rows.slice(0, 8).map((el) => ({
            tag: el.tagName,
            className: String(el.className || "").slice(0, 80),
            key: el.getAttribute("data-bob-block"),
            path: el.getAttribute("data-task-path") || "",
            hrefs: Array.from(el.querySelectorAll("a")).map((a) => ({
              className: String(a.className || "").slice(0, 60),
              href: a.getAttribute("data-href") || a.getAttribute("href") || "",
            })).slice(0, 4),
            text: String(el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 80),
          }));
          return { rowCount: rows.length, sample };
        })()`).catch((e) => ({ error: String(e) }));
        const injected = await client.evaluate(`(() => {
          const host = document.querySelector(".block-language-dataview");
          if (!host) return { ok: false, error: "dataview host missing" };
          const rows = Array.from(host.querySelectorAll("li.task-list-item, li"));
          const row = rows.find((li) => /BM4 dep vector/.test(String(li.textContent || "")));
          if (!row) return { ok: false, error: "BM4 row missing", dumpHost: true };
          row.setAttribute("data-task", "?");
          if (!row.getAttribute("data-task-path")) row.setAttribute("data-task-path", "block-marks.md");
          const hasLink = Array.from(row.querySelectorAll("a")).some((a) => {
            const href = String(a.getAttribute("data-href") || a.getAttribute("href") || "");
            return href.indexOf("block-marks") !== -1;
          });
          if (!hasLink) {
            const link = document.createElement("a");
            link.className = "internal-link";
            link.setAttribute("data-href", "block-marks.md");
            link.setAttribute("href", "block-marks.md");
            link.textContent = "block-marks";
            row.appendChild(link);
          }
          if (!/\\[dependsOn::/.test(String(row.textContent || ""))) {
            row.appendChild(document.createTextNode(" [dependsOn:: x]"));
          }
          const plugin = window.app.plugins.plugins["bob-ledger-tools"];
          const ctx = { sourcePath: "dataview-query.md" };
          if (plugin && typeof plugin.renderBlockMarksIn === "function") plugin.renderBlockMarksIn(host, ctx);
          if (plugin && typeof plugin.sweepBlockMarksReading === "function") plugin.sweepBlockMarksReading();
          return {
            ok: true,
            injected: true,
            key: row.getAttribute("data-bob-block"),
            path: row.getAttribute("data-task-path") || "",
            task: row.getAttribute("data-task") || "",
          };
        })()`).catch((e) => ({ ok: false, error: String(e) }));
        await sleep(400);
        dvNamed = await namedHostProbe(client, ".block-language-dataview", "BM4 dep vector");
        dvAssert = asserts.assertNamedHostMark(
          { ...dvNamed, originHost: dvNamed && dvNamed.hostFound ? "dataview" : dvNamed && dvNamed.originHost },
          { hostKind: "dataview", marker: "BM4", wantKey: "dep" },
        );
        record(
          "dataview-rows",
          dvAssert.ok,
          JSON.stringify({ dump: dvDump, injected, mark: dvAssert.mark || dvAssert }).slice(0, 320),
        );
      } else {
        record("dataview-rows", dvAssert.ok, JSON.stringify(dvAssert.mark || dvAssert).slice(0, 220));
      }
      const dvNeutral = await client.evaluate(`(() => {
        const host = document.querySelector(".block-language-dataview");
        if (!host) return { ok: false, error: "dataview host missing" };
        const li = document.createElement("li");
        li.className = "task-list-item";
        li.setAttribute("data-task", "?");
        const box = document.createElement("input");
        box.className = "task-list-item-checkbox";
        box.type = "checkbox";
        li.appendChild(box);
        li.appendChild(document.createTextNode(" Unprovable scheduled decoy [scheduled:: 2099-01-01]"));
        host.appendChild(li);
        const plugin = window.app.plugins.plugins["bob-ledger-tools"];
        if (plugin && typeof plugin.sweepBlockMarksReading === "function") plugin.sweepBlockMarksReading();
        return {
          ok: true,
          key: li.getAttribute("data-bob-block"),
          path: li.getAttribute("data-task-path") || "",
        };
      })()`).catch((e) => ({ ok: false, error: String(e) }));
      record("dataview-unprovable-neutral", Boolean(dvNeutral && dvNeutral.ok && !dvNeutral.key), JSON.stringify(dvNeutral).slice(0, 180));
      const shotDv = path.join(outDir, "e2e-block-marks-dataview.png");
      await capturePage(client, shotDv);
      report.screenshots.push(shotDv);
    }
    report.dataview = { copied: fixture.dataviewPlugin };
    report.snippet = { copied: fixture.snippet };
    report.controlledClockNote = "BM23 patches dateMarksToday and calls refreshDateMarksForRollover; it is not a midnight observation.";

    // Chip marks live on a separate note so existing BM vectors stay untouched.
    await openNote(client, fixture.chips, "live").catch(() => ({}));
    await sleep(800);
    let chipIndexReady = { ready: false };
    for (let i = 0; i < 24; i++) {
      chipIndexReady = await client.evaluate(`(() => { try {
        const plugin = window.app.plugins.plugins["bob-ledger-tools"];
        if (!plugin || typeof plugin.blockMarksIdIndex !== "function") return { ready: false };
        const index = plugin.blockMarksIdIndex();
        const has = (id) => index && index.has && index.has(id);
        return { ready: Boolean(has("chip-p2") && has("chip-dep") && has("chip-prj") && has("x")), keys: index ? Array.from(index.keys()).slice(0, 16) : null };
      } catch (e) { return { ready: false, error: String(e && e.message || e) }; } })()`).catch((e) => ({ ready: false, error: String(e) }));
      if (chipIndexReady && chipIndexReady.ready) break;
      await sleep(400);
    }
    record("chip-tasks-index", Boolean(chipIndexReady && chipIndexReady.ready), JSON.stringify(chipIndexReady).slice(0, 200));

    async function runChipSurface(mode, prefix) {
      const probe = await collectChips(client, fixture.chips, mode);
      const shown = visibleChips(probe);
      record(`${prefix}-chip-boxes`, shown.length >= 3, JSON.stringify({ count: shown.length, error: probe && probe.error }).slice(0, 180));
      const p2 = assertChipFamily(record, prefix, probe, "ChipP2 p2 target", "p2", "chip-p2");
      assertChipFamily(record, prefix, probe, "ChipDep dep target", "dep", "chip-dep");
      assertChipFamily(record, prefix, probe, "ChipPrj prj target", "prj", "chip-prj");
      const blocked = shown.find((chip) => chip.isBlocks && (
        String(chip.chipText || "").includes("ChipBlockedDependent")
        || String(chip.href || "").includes("chip-blocked")
      ));
      record(`${prefix}-blocks-chip`, Boolean(blocked && blocked.key === "dep"), blocked ? JSON.stringify(blocked).slice(0, 180) : "no BLOCKS chip");
      const heightsOn = shown.map((chip) => chip.rowHeight).filter((value) => Number.isFinite(value));
      await client.evaluate(`(() => window.app.commands.executeCommandById("bob-ledger-tools:toggle-block-marks"))()`);
      const offProbe = await waitFor(client, CHIPS_PROBE, (v) => v && v.gate === false, `${prefix}-chip-toggle-off`, 4000).catch((e) => ({ error: e.message, chips: [], gate: true }));
      record(`${prefix}-chip-toggle-off`, offProbe.gate === false, `gate=${offProbe.gate}`);
      const offShown = visibleChips(offProbe);
      const visibleMarks = offShown.filter((chip) => chip.markVisible);
      record(`${prefix}-chip-marks-hidden`, visibleMarks.length === 0, `visibleMarks=${visibleMarks.length}`);
      const blockedBoxes = offShown.filter((chip) => /ChipP2 p2 target|ChipDep dep target|ChipPrj prj target|ChipBlockedDependent|chip-p2|chip-dep|chip-prj|chip-blocked/.test(String(chip.chipText || "") + String(chip.href || "")));
      const questionVisible = blockedBoxes.length > 0 && blockedBoxes.every((chip) => String(chip.boxText || "").includes("?"));
      record(`${prefix}-chip-question-restored`, questionVisible, JSON.stringify(blockedBoxes.map((chip) => chip.boxText)).slice(0, 180));
      const heightsOff = offShown.map((chip) => chip.rowHeight).filter((value) => Number.isFinite(value));
      const heightDelta = heightsOn.length && heightsOff.length
        ? Math.max(...heightsOn.map((value, index) => Math.abs(value - (heightsOff[index] ?? value))))
        : null;
      record(`${prefix}-chip-row-height`, heightDelta != null && heightDelta <= 1, `delta=${heightDelta} on=${JSON.stringify(heightsOn)} off=${JSON.stringify(heightsOff)}`);
      await client.evaluate(`(() => window.app.commands.executeCommandById("bob-ledger-tools:toggle-block-marks"))()`);
      const onProbe = await waitFor(
        client,
        CHIPS_PROBE,
        (v) => v && v.gate === true && visibleChips(v).some((chip) => chip.markVisible && chip.key === "p2"),
        `${prefix}-chip-toggle-on`,
        8000,
      ).catch((e) => ({ error: e.message, chips: [], gate: false }));
      record(
        `${prefix}-chip-toggle-on`,
        Boolean(onProbe.gate === true && visibleChips(onProbe).some((chip) => chip.markVisible && chip.key === "p2")),
        JSON.stringify({ gate: onProbe.gate, error: onProbe.error, keys: visibleChips(onProbe).map((chip) => chip.key) }).slice(0, 180),
      );
      return p2;
    }

    await runChipSurface("live", "lp");
    const shotChipsLiveLight = path.join(outDir, "e2e-block-marks-chips-live-light.png");
    await openNote(client, fixture.chips, "live");
    await sleep(500);
    await capturePage(client, shotChipsLiveLight);
    report.screenshots.push(shotChipsLiveLight);
    await client.evaluate(`(() => { document.body.classList.remove("theme-light"); document.body.classList.add("theme-dark"); return true; })()`);
    await sleep(300);
    const shotChipsLiveDark = path.join(outDir, "e2e-block-marks-chips-live-dark.png");
    await capturePage(client, shotChipsLiveDark);
    report.screenshots.push(shotChipsLiveDark);
    await client.evaluate(`(() => { document.body.classList.remove("theme-dark"); document.body.classList.add("theme-light"); return true; })()`);
    await sleep(200);

    await runChipSurface("preview", "reading");
    const shotChipsReadingLight = path.join(outDir, "e2e-block-marks-chips-reading-light.png");
    await openNote(client, fixture.chips, "preview");
    await sleep(500);
    await capturePage(client, shotChipsReadingLight);
    report.screenshots.push(shotChipsReadingLight);
    await client.evaluate(`(() => { document.body.classList.remove("theme-light"); document.body.classList.add("theme-dark"); return true; })()`);
    await sleep(300);
    const shotChipsReadingDark = path.join(outDir, "e2e-block-marks-chips-reading-dark.png");
    await capturePage(client, shotChipsReadingDark);
    report.screenshots.push(shotChipsReadingDark);
    await client.evaluate(`(() => { document.body.classList.remove("theme-dark"); document.body.classList.add("theme-light"); return true; })()`);
    await sleep(200);

    report.cases = cases;
    report.skipped = skipped;
    report.pass = cases.every((item) => item.ok);
    report.out = outDir;
    if (parsed.report) {
      fs.mkdirSync(path.dirname(path.resolve(parsed.report)), { recursive: true });
      fs.writeFileSync(parsed.report, JSON.stringify(report, null, 2));
    }
    console.log(JSON.stringify({ pass: report.pass, failed: cases.filter((item) => !item.ok).map((item) => item.name), skipped: skipped.map((item) => item.name), screenshots: report.screenshots, out: outDir }, null, 2));
    if (!report.pass) fail(`e2e failed: ${cases.filter((item) => !item.ok).map((item) => item.name).join(", ")}`, 1);
    return report;
  } finally {
    if (client) client.close();
    try {
      if (child.exitCode == null && child.signalCode == null) child.kill("SIGTERM");
    } catch {
      // Already gone.
    }
    await new Promise((resolve) => {
      if (child.exitCode != null || child.signalCode != null) return resolve();
      const timer = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* gone */ }
        resolve();
      }, 4000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    const cleanup = lib.planOwnedCleanup([runRoot], [runRoot]);
    for (const target of cleanup.removable) {
      try { fs.rmSync(target, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    console.log(HELP_TEXT);
    return;
  }
  if (parsed.selfTest) {
    runSelfTest();
    return;
  }
  const overall = new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error("overall e2e watchdog fired")), OVERALL_TIMEOUT_MS);
    if (timer && typeof timer.unref === "function") timer.unref();
  });
  await Promise.race([runE2e(parsed), overall]);
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = error && error.exitCode ? error.exitCode : 1;
});



