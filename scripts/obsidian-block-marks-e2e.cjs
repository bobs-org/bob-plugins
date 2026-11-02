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
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "bob-bm-e2e-probe-"));
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

const EXPECTED_KEYS = Object.freeze({
  BM1: "p2",
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

function markForMarker(marks, marker) {
  const list = (marks || []).filter((m) => m && typeof m.context === "string" && m.context.includes(marker));
  return { all: list, visible: list.filter((m) => m.visible !== false) };
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bob-bm-e2e-self-"));
  try {
    const parsed = parseArgs(["--self-test", "--out", tmp, "--report", path.join(tmp, "r.json")]);
    if (!parsed.selfTest) throw new Error("parseArgs did not keep --self-test");
    const dates = fixtureDates();
    const fixture = buildFixture(tmp, dates);
    for (const relative of [fixture.marks, fixture.prereqs, fixture.embedHost, fixture.prose, fixture.tasksQuery, fixture.dataviewQuery]) {
      if (!fs.existsSync(path.join(tmp, relative))) throw new Error(`fixture missing ${relative}`);
    }
    const marks = fs.readFileSync(path.join(tmp, fixture.marks), "utf8");
    for (const token of ["BM1 p2 vector", "BM4 dep vector", "BM7 prj vector", "BMChild date", "Project hold", "^prj", "BMF fenced"]) {
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
    const dataviewQuery = fs.readFileSync(path.join(tmp, fixture.dataviewQuery), "utf8");
    if (!dataviewQuery.includes("```dataview")) throw new Error("dataview query note missing the Dataview fence");
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
    if (!source.includes("toggle-block-marks")) throw new Error("self-test must cover the session toggle");
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

async function runE2e(parsed) {
  const executable = findExecutable(parsed.executable);
  const probe = probeExecutable(executable);
  if (!probe.ok) {
    fail(`unrun: ${probe.reason}. Rerun on a host with the Obsidian Electron app: xvfb-run -a node scripts/obsidian-block-marks-e2e.cjs -e /snap/bin/obsidian`, 2);
  }
  if (!process.env.DISPLAY && !process.env.XVFB_RUN_TMPDIR) {
    fail("unrun: no X display; rerun under xvfb-run -a node scripts/obsidian-block-marks-e2e.cjs", 2);
  }

  const outDir = parsed.out ? path.resolve(parsed.out) : fs.mkdtempSync(path.join(os.tmpdir(), "bob-bm-e2e-out-"));
  fs.mkdirSync(outDir, { recursive: true });
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bob-bm-e2e-"));
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
      const env = { ...process.env, BOB_DIR: fixtureRealPath, TMPDIR: os.tmpdir() };
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
    // (Fence tree-name recording moved to the refresh-edit rebuild below.)

    // Live Preview tooltips attach lazily on hover: drive a real mouseover on
    // the BM1 row and confirm the existing checkbox gains tooltip metadata.
    // Attribute presence without a hover proves nothing, so the bare
    // collectMarks probe is not asserted here.
    await openNote(client, fixture.marks, "live");
    await sleep(500);
    const lpHoverMeta = await client.evaluate(`(() => (async () => {
      const hosts = Array.from(document.querySelectorAll("[data-bob-block]"));
      const host = hosts.find((el) => String((el.closest(".HyperMD-task-line, li") || el).textContent || "").includes("BM1 p2 vector"));
      if (!host) return { ok: false, error: "BM1 host missing" };
      const box = host.matches("input") ? host : host.querySelector("input.task-list-item-checkbox");
      if (!box) return { ok: false, error: "BM1 checkbox missing" };
      const rect = box.getBoundingClientRect();
      box.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, clientX: rect.left + 2, clientY: rect.top + 2 }));
      await new Promise((r) => setTimeout(r, 400));
      return { ok: true, aria: box.getAttribute("aria-label") || "", pos: box.getAttribute("data-tooltip-position") || "" };
    })())()`).catch((e) => ({ ok: false, error: String(e) }));
    record("lp-tooltip-aria", Boolean(lpHoverMeta && lpHoverMeta.ok && /Blocked|Recurring/.test(lpHoverMeta.aria || "")), JSON.stringify(lpHoverMeta).slice(0, 200));
    record("lp-tooltip-position", Boolean(lpHoverMeta && lpHoverMeta.ok && lpHoverMeta.pos === "top"), JSON.stringify(lpHoverMeta).slice(0, 200));

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
        const box = host.matches("input") ? host : host.querySelector("input.task-list-item-checkbox") || host.querySelector("span.bob-block-mark");
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
    // Snippet-disabled: remove the snippet stylesheet and confirm marks still paint.
    const snippetProbe = await client.evaluate(`(() => {
      for (const el of Array.from(document.querySelectorAll('link'))) {
        if (/task-statuses/.test(el.getAttribute("href") || "")) el.remove();
      }
      const host = document.querySelector('[data-bob-block="dep"], [data-bob-block="p2"], [data-bob-block]');
      if (!host) return { error: "no marked host" };
      const box = host.matches("input") ? host : host.querySelector("input.task-list-item-checkbox") || host;
      const csAfter = box ? String(window.getComputedStyle(box).backgroundColor || "") : "";
      const csBorder = box ? String(window.getComputedStyle(box).borderTopWidth || "") + " " + String(window.getComputedStyle(box).borderTopStyle || "") : "";
      return { after: csAfter, border: csBorder };
    })()`).catch((e) => ({ error: String(e) }));
    record("paint-without-snippet", Boolean(snippetProbe && snippetProbe.after && !/transparent|rgba\(0,\s*0,\s*0,\s*0\)/.test(snippetProbe.after)), JSON.stringify(snippetProbe).slice(0, 200));

    // Embeds: the BM note embedded in a host note still marks rows.
    await openNote(client, fixture.embedHost, "preview");
    await sleep(800);
    const embedProbe = await client.evaluate(MARKS_PROBE).catch(() => ({ marked: [] }));
    const embedMarks = (embedProbe.marked || []).filter((m) => m.visible !== false);
    record("embed-marks", embedMarks.length > 0, `${embedMarks.length} marks inside the embed host`);
    const shotEmbed = path.join(outDir, "e2e-block-marks-embed.png");
    await capturePage(client, shotEmbed);
    report.screenshots.push(shotEmbed);

    // Hover preview: hover the BM link and confirm popover marks.
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
      const popover = await waitForMarks(client, (v) => v && v.popover === true, "hover-popover-marks", 6000).catch((e) => ({ error: e.message, popover: false }));
      record("hover-popover-marks", Boolean(popover.popover), popover.error || "popover with marks");
      const shotHover = path.join(outDir, "e2e-block-marks-hover.png");
      await capturePage(client, shotHover);
      report.screenshots.push(shotHover);
    }
    // Real hover tooltip text on a marked checkbox (attribute presence is not proof).
    await openNote(client, fixture.marks, "live");
    await sleep(500);
    const tooltip = await client.evaluate(`(() => (async () => {
      const hosts = Array.from(document.querySelectorAll("[data-bob-block]"));
      const host = hosts.find((el) => String((el.closest(".HyperMD-task-line, li") || el).textContent || "").includes("BM1 p2 vector"));
      if (!host) return { ok: false, error: "BM1 host missing" };
      const box = host.matches("input") ? host : host.querySelector("input.task-list-item-checkbox");
      if (!box) return { ok: false, error: "BM1 checkbox missing" };
      const rect = box.getBoundingClientRect();
      box.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, clientX: rect.left + 2, clientY: rect.top + 2 }));
      await new Promise((r) => setTimeout(r, 900));
      const tip = document.querySelector(".tooltip, .tool-tip, [data-tooltip-position]");
      return { ok: true, aria: box.getAttribute("aria-label") || "", tip: tip ? String(tip.textContent || "").slice(0, 200) : "" };
    })())()`).catch((e) => ({ ok: false, error: String(e) }));
    record("hover-tooltip-text", Boolean(tooltip && tooltip.ok && /Blocked|Recurring|P2|until/.test(`${tooltip.aria} ${tooltip.tip}`)), JSON.stringify(tooltip).slice(0, 220));

    // Toggle off removes attributes and restores prior appearance, then back on.
    // The BM note carries the marks; the prose note has none, so toggling there
    // proves nothing about removal or restoration.
    await openNote(client, fixture.marks, "live");
    await sleep(500);
    const heightsBefore = await client.evaluate(LINE_HEIGHT_PROBE).catch(() => ({}));
    const beforeToggle = await client.evaluate(MARKS_PROBE).catch(() => ({}));
    const beforeVisible = (beforeToggle.marked || []).filter((m) => m.visible !== false);
    record("toggle-precondition", beforeToggle.gate === true && beforeVisible.length > 0, `gate=${beforeToggle.gate} visible=${beforeVisible.length}`);
    const toggledOff = await client.evaluate(`(() => {
      const result = window.app.commands.executeCommandById("bob-ledger-tools:toggle-block-marks");
      return { ok: result !== false };
    })()`);
    record("toggle-off-command", toggledOff && toggledOff.ok, JSON.stringify(toggledOff));
    const offProbe = await waitForMarks(client, (v) => v && v.gate === false, "toggle-hides-marks", 4000).catch((e) => ({ error: e.message, marked: [], gate: true }));
    record("toggle-hides-marks", offProbe.gate === false, `gate=${offProbe.gate} visible=${(offProbe.marked || []).filter((m) => m.visible !== false).length}`);
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
    // Natural document refresh: editing a scheduled date reclassifies the row.
    const refreshEdit = await client.evaluate(`(() => (async () => {
      const abstract = window.app.vault.getAbstractFileByPath(${JSON.stringify(fixture.marks)});
      const text = await window.app.vault.read(abstract);
      const line = text.split("\\n").find((l) => l.includes("BMClick probe")) || "";
      const m = line.match(/\\[scheduled:: (\\d{4}-\\d{2}-\\d{2})\\]/);
      if (!m) return { ok: false, error: "BMClick date missing" };
      const next = text.replace(m[0], "[scheduled:: 2099-01-01]");
      await window.app.vault.modify(abstract, next);
      return { ok: true, from: m[1] };
    })())()`);
    record("refresh-edit-applied", refreshEdit && refreshEdit.ok, JSON.stringify(refreshEdit).slice(0, 120));
    await sleep(1200);
    const refreshCollected = await collectMarks(client, fixture.marks, "live");
    const refreshMark = (refreshCollected.marks || []).find((m) => (m.context || "").includes("BMClick probe") && m.visible !== false);
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
    const refreshFence = (refreshCollected.marks || []).find((m) => (m.context || "").includes("BMF fenced") && m.visible !== false);
    record("fence-neutral-after-refresh", !refreshFence, refreshFence ? `still ${refreshFence.key}/${refreshFence.family} after a forced rebuild` : "neutral once decorations rebuild");
    // 2099 is far-future with no priority: still a waiting date mark.
    record("refresh-reclassifies", Boolean(refreshMark && refreshMark.key === "date"), refreshMark ? `${refreshMark.key}/${refreshMark.family}` : "BMClick mark missing after edit");
    await client.evaluate(`(() => (async () => {
      const abstract = window.app.vault.getAbstractFileByPath(${JSON.stringify(fixture.marks)});
      const text = await window.app.vault.read(abstract);
      const next = text.replace("[scheduled:: 2099-01-01]", "[scheduled:: " + ${JSON.stringify(fixture.dates.plus3)} + "]");
      if (next !== text) await window.app.vault.modify(abstract, next);
      return { ok: true };
    })())()`);
    await sleep(800);
    // Day boundary (controlled-clock, not a midnight observation): today is stale, future waits.
    const dayProbe = await collectMarks(client, fixture.marks, "live");
    const bm11 = markForMarker(dayProbe.marks, "BM11 today stale");
    const bm2day = markForMarker(dayProbe.marks, "BM2 date vector");
    record("day-boundary-today-stale", bm11.visible.length > 0 && bm11.visible[0].key === "stale", bm11.visible[0] ? bm11.visible[0].key : "missing");
    record("day-boundary-future-waits", bm2day.visible.length > 0 && bm2day.visible[0].key === "date", bm2day.visible[0] ? bm2day.visible[0].key : "missing");

    // Tasks query rows stay excluded (later parent phases own Tasks CSS/BM24).
    if (!fixture.tasksPlugin) {
      skip("tasks-query-excluded", "Tasks plugin was not copied into the scratch vault; node tests cover query rows");
    } else {
      await openNote(client, fixture.tasksQuery, "preview");
      await sleep(2500);
      const tasksProbe = await client.evaluate(MARKS_PROBE).catch(() => ({ taskRows: [] }));
      const markedTasks = (tasksProbe.taskRows || []).filter((r) => r.marked);
      if ((tasksProbe.taskRows || []).length === 0) {
        skip("tasks-query-excluded", "Tasks query rows did not render; node tests cover query rows");
      } else {
        record("tasks-query-excluded", markedTasks.length === 0, `${markedTasks.length} marked of ${(tasksProbe.taskRows || []).length} Tasks rows`);
      }
    }

    // Dataview TASK rows use proven origins when the plugin is present.
    if (!fixture.dataviewPlugin) {
      skip("dataview-rows", "Dataview was not copied into the scratch vault; node tests cover delayed origins");
    } else {
      await openNote(client, fixture.dataviewQuery, "preview");
      await sleep(3000);
      const dvProbe = await client.evaluate(MARKS_PROBE).catch(() => ({ dataviewRows: [] }));
      const dvRows = dvProbe.dataviewRows || [];
      const dvMarked = dvRows.filter((r) => r.key);
      if (dvRows.length === 0) {
        skip("dataview-rows", "Dataview TASK rows did not render; node tests cover delayed origins");
      } else {
        record("dataview-rows", dvMarked.length > 0, `${dvMarked.length} marked of ${dvRows.length} Dataview rows`);
        const shotDv = path.join(outDir, "e2e-block-marks-dataview.png");
        await capturePage(client, shotDv);
        report.screenshots.push(shotDv);
      }
    }
    report.dataview = { copied: fixture.dataviewPlugin };
    report.snippet = { copied: fixture.snippet };
    report.controlledClockNote = "Day/config checks use relative-date fixtures under the real clock, not an actual midnight observation.";

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



