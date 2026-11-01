#!/usr/bin/env node
// Real-Obsidian e2e for task link marks.
// Isolated scratch vault + profile, owned Obsidian process, CDP probes.
// Never opens the live vault. Reuses scripts/obsidian-startup-smoke-lib.cjs.
//
//   xvfb-run -a node scripts/obsidian-task-link-marks-e2e.cjs [--out DIR] [-e PATH] [-r REPORT]
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
const REFRESH_WAIT_MS = 5_000;

const AREA_NOTE = [
  "# Work",
  "",
  "Related: [[#^ready-1]] and [[#^next-1]]",
  "",
  "- [ ] #task Ready task ^ready-1",
  "- [*] #task Next task ^next-1",
  "- [/] #task In progress task ^wip-1",
  "- [?] #task Blocked task ^blocked-1",
  "- [x] #task Done task ^done-1",
  "- [-] #task Cancelled task ^cancelled-1",
  "- [ ] Pack charger ^plain-1",
  "Some text ^block-1",
  "- [ ] #task Follow up on [[areas/work#^ready-1|the ready task]] ^follow-1",
  "- [ ] #task Swap target ^swap-1",
  "",
].join("\n");

const PROSE_NOTE = [
  "# Prose",
  "",
  "See the six: [[areas/work#^ready-1]] [[areas/work#^next-1]] [[areas/work#^wip-1]] [[areas/work#^blocked-1]] [[areas/work#^done-1]] [[areas/work#^cancelled-1]]",
  "",
  "Short: [[areas/work#^next-1]]",
  "",
  "Heading only: [[areas/work#Work]]",
  "",
  "Non-task block: [[areas/work#^block-1]]",
  "",
  "Plain checklist: [[areas/work#^plain-1]]",
  "",
  "Embed: ![[areas/work#^ready-1]]",
  "",
  "Struck: ~~[[areas/work#^ready-1]]~~",
  "",
  "> Quote: [[areas/work#^done-1]]",
  "",
  "Overview: [[areas/work]]",
  "",
].join("\n");

const MANAGED_NOTE = [
  "# Managed",
  "",
  "- [ ] #task Parent with a mention [[areas/work#^ready-1]] in title ^parent-1",
  "  - ⛓️ **DEPENDS ON:** [[areas/work#^next-1]]",
  "  - 🪢 **LINKS:** [[areas/work#^wip-1]]",
  "",
].join("\n");

const DAILY_NOTE = [
  "# 2026-11-01",
  "",
  "## Pomodoros",
  "",
  "- [ ] FIX (09:00-09:30)",
  "  - [[areas/work#^ready-1]]",
  "  - see [[areas/work#^next-1]]",
  "  - pair with [[areas/work#^wip-1]]",
  "",
  "## Notes",
  "",
  "Daily notes prose: [[areas/work#^blocked-1]]",
  "",
].join("\n");

// Swap sources. Each holds two instances of the swap target, an unrelated
// already-Done ring and an unrelated Ready ring (controls that must never
// animate), then a long run of filler and a tail instance that is far below
// the first screen, so scrolling materialises it after the swap.
const SWAP_FILLER = Array.from({ length: 120 }, (_, index) => `Filler paragraph ${index + 1}.\n`).join("\n");

function swapSourceNote(kind) {
  return [
    `# Swap ${kind}`,
    "",
    `Swap ${kind} source: [[areas/work#^swap-1]] and again [[areas/work#^swap-1|alias]]. Control: [[areas/work#^done-1]] and [[areas/work#^ready-1]].`,
    "",
    SWAP_FILLER,
    "Swap tail: [[areas/work#^swap-1]]",
    "",
  ].join("\n");
}

const QUERY_NOTE = [
  "# Queries",
  "",
  "```tasks",
  "description includes Follow up on",
  "```",
  "",
].join("\n");

const TASKS_DATA = {
  globalFilter: "#task",
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

function markdownViewState(mode) {
  if (mode === "preview" || mode === "reading") return { mode: "preview", source: false };
  return { mode: "source", source: mode === "source" };
}

const HELP_TEXT = [
  "Usage: node scripts/obsidian-task-link-marks-e2e.cjs [OPTIONS]",
  "",
  "Drive task link marks in an isolated scratch vault through CDP.",
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
  // The probe starts the real app once, so give it a throwaway profile
  // instead of the user's own Obsidian profile.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "bob-tlm-e2e-probe-"));
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
  const candidates = [
    path.join(os.homedir(), "bob", ".obsidian", "plugins", "obsidian-tasks-plugin"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "main.js")) && fs.existsSync(path.join(candidate, "manifest.json"))) {
      return candidate;
    }
  }
  return null;
}

function buildFixture(vaultDir) {
  writeNote(path.join(vaultDir, "areas/work.md"), AREA_NOTE);
  writeNote(path.join(vaultDir, "prose.md"), PROSE_NOTE);
  writeNote(path.join(vaultDir, "managed.md"), MANAGED_NOTE);
  writeNote(path.join(vaultDir, "2026/20261101.md"), DAILY_NOTE);
  writeNote(path.join(vaultDir, "queries.md"), QUERY_NOTE);
  writeNote(path.join(vaultDir, "swap-live.md"), swapSourceNote("live"));
  writeNote(path.join(vaultDir, "swap-reading.md"), swapSourceNote("reading"));

  const enabled = [];
  for (const plugin of readExpectedPlugins()) {
    copyPluginFiles(
      path.join(repoRoot, "plugins", plugin.id),
      path.join(vaultDir, ".obsidian", "plugins", plugin.id),
    );
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
  fs.writeFileSync(
    path.join(vaultDir, ".obsidian", "core-plugins.json"),
    JSON.stringify([
      "file-explorer",
      "global-search",
      "switcher",
      "page-preview",
      "command-palette",
      "editor-status",
      "outline",
    ], null, 2),
  );
  return {
    area: "areas/work.md",
    prose: "prose.md",
    managed: "managed.md",
    daily: "2026/20261101.md",
    queries: "queries.md",
    swapLive: "swap-live.md",
    swapReading: "swap-reading.md",
    enabled,
    tasksPlugin,
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
  const app = window.app;
  const adapter = app && app.vault && app.vault.adapter;
  if (adapter && typeof adapter.basePath === "string" && adapter.basePath) return adapter.basePath;
  return null;
} catch { return null; } })()`;

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
        if (child.nodeType === 3) {
          out += child.nodeValue || "";
          continue;
        }
        if (child.nodeType !== 1) continue;
        const tag = String(child.tagName || "").toUpperCase();
        if (tag === "UL" || tag === "OL") continue;
        walk(child);
      }
    };
    walk(node);
    return out;
  };
  const marks = Array.from(document.querySelectorAll(".bob-task-link-mark")).map((el) => {
    const line = el.closest(".cm-line, p, h1, h2, h3, blockquote");
    const item = el.closest("li");
    const parent = line || item || el.parentElement;
    const raw = line ? String(line.textContent || "") : ownText(item || parent);
    return {
      state: el.getAttribute("data-state"),
      label: el.getAttribute("aria-label") || "",
      swap: el.classList.contains("bob-task-link-mark-swap"),
      visible: visible(el),
      context: String(raw || "").replace(/\\s+/g, " ").trim().slice(0, 160),
    };
  });
  const popover = document.querySelector(".popover.hover-popover, .hover-popover");
  const popoverMarks = popover
    ? Array.from(popover.querySelectorAll(".bob-task-link-mark")).map((el) => ({
      state: el.getAttribute("data-state"),
      visible: visible(el),
      label: el.getAttribute("aria-label") || "",
    }))
    : [];
  const taskRows = Array.from(document.querySelectorAll("li.plugin-tasks-list-item")).map((row) => ({
    text: String(row.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 160),
    path: row.getAttribute("data-task-path") || row.getAttribute("data-path") || "",
    task: row.getAttribute("data-task"),
    marks: Array.from(row.querySelectorAll(".bob-task-link-mark")).map((el) => el.getAttribute("data-state")),
    links: Array.from(row.querySelectorAll("a.internal-link")).map((anchor) => ({
      href: anchor.getAttribute("data-href") || anchor.getAttribute("href") || "",
      src: anchor.getAttribute("data-bob-task-link-src"),
      prev: anchor.previousSibling && anchor.previousSibling.getAttribute && anchor.previousSibling.getAttribute("class") || "",
    })),
  }));
  const plugin = window.app && window.app.plugins && window.app.plugins.plugins && window.app.plugins.plugins["bob-ledger-tools"];
  return {
    marks,
    gate: document.body.classList.contains("bob-task-link-marks"),
    enabled: plugin ? plugin.taskLinkMarksEnabled !== false : null,
    command: Boolean(window.app && window.app.commands && window.app.commands.findCommand && window.app.commands.findCommand("bob-ledger-tools:toggle-task-link-marks")),
    popover: Boolean(popover),
    popoverMarks,
    taskRows,
  };
} catch (e) { return { error: String(e && e.message || e), marks: [] }; } })()`;

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
    six: measure(pick(document.querySelectorAll(".cm-line, p"), /See the six/)),
    short: measure(pick(document.querySelectorAll(".cm-line, p"), /^Short:/)),
    heading: measure(pick(document.querySelectorAll(".cm-line, p"), /Heading only/)),
  };
} catch (e) { return { error: String(e && e.message || e) }; } })()`;

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
      if (!trust) return { clicked: false, present: buttons.some((button) => /Restricted Mode|Trust author/i.test(button.textContent || "")) };
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

function runSelfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bob-tlm-e2e-self-"));
  try {
    const parsed = parseArgs(["--self-test", "--out", tmp, "--report", path.join(tmp, "r.json")]);
    if (!parsed.selfTest) throw new Error("parseArgs did not keep --self-test");
    const fixture = buildFixture(tmp);
    for (const relative of [fixture.area, fixture.prose, fixture.managed, fixture.daily, fixture.queries]) {
      if (!fs.existsSync(path.join(tmp, relative))) throw new Error(`fixture missing ${relative}`);
    }
    const area = fs.readFileSync(path.join(tmp, fixture.area), "utf8");
    for (const token of ["[ ] #task Ready", "[*] #task Next", "[/] #task In progress", "[?] #task Blocked", "[x] #task Done", "[-] #task Cancelled"]) {
      if (!area.includes(token)) throw new Error(`area note missing ${token}`);
    }
    const prose = fs.readFileSync(path.join(tmp, fixture.prose), "utf8");
    if (!prose.includes("See the six:")) throw new Error("prose note missing the six-state sentence");
    if (!prose.includes("Short: [[areas/work#^next-1]]")) throw new Error("prose note missing the short line");
    if (!prose.includes("![[areas/work#^ready-1]]")) throw new Error("prose note missing embed");
    if (!prose.includes("~~[[areas/work#^ready-1]]~~")) throw new Error("prose note missing struck link");
    const daily = fs.readFileSync(path.join(tmp, fixture.daily), "utf8");
    if (!daily.includes("## Pomodoros") || !daily.includes("## Notes")) throw new Error("daily note missing sections");
    const managed = fs.readFileSync(path.join(tmp, fixture.managed), "utf8");
    if (!managed.includes("DEPENDS ON:") || !managed.includes("LINKS:")) throw new Error("managed note missing edge rows");
    const queries = fs.readFileSync(path.join(tmp, fixture.queries), "utf8");
    if (!queries.includes("```tasks")) throw new Error("queries note missing Tasks fence");
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
    if (liveState.mode !== "source" || liveState.source !== false) {
      throw new Error("Live Preview must open as Markdown source:false");
    }
    const readingState = markdownViewState("preview");
    if (readingState.mode !== "preview") throw new Error("Reading view must open as mode:preview");
    runSwapSelfTest(tmp, fixture);
    console.log("offline self-test complete (not an Obsidian pass)");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// Offline checks for the natural-refresh and single-swap acceptance logic.
// These prove the judges reject the weak evidence the old check accepted (a
// boolean "saw a swap", an unrelated Done ring, a forced refresh) without
// needing a real Obsidian.
function runSwapSelfTest(tmp, fixture) {
  const assertThat = (condition, message) => {
    if (!condition) throw new Error(message);
  };

  // Fixtures: a dedicated swap target, two instances plus controls per source,
  // and a tail instance below a long run of filler.
  const area = fs.readFileSync(path.join(tmp, fixture.area), "utf8");
  assertThat(area.includes("- [ ] #task Swap target ^swap-1"), "area note missing the swap target");
  for (const [file, kind] of [[fixture.swapLive, "live"], [fixture.swapReading, "reading"]]) {
    const note = fs.readFileSync(path.join(tmp, file), "utf8");
    const first = note.split("\n").find((line) => line.startsWith(`Swap ${kind} source:`)) || "";
    assertThat((first.match(/\^swap-1/g) || []).length === 2, `${file} must link the swap target twice in its first paragraph`);
    assertThat(first.includes("^done-1") && first.includes("^ready-1"), `${file} must hold an unrelated Done and Ready control`);
    assertThat(note.includes("Filler paragraph 120."), `${file} must hold enough filler to scroll`);
    assertThat(note.trimEnd().split("\n").pop().startsWith("Swap tail:"), `${file} must end with the tail instance`);
  }

  // Ring identity comes from block text and ordinal, never from state.
  const fakeBlock = (text, count) => {
    const rings = Array.from({ length: count }, () => ({ closest: () => block }));
    const block = {
      textContent: text,
      querySelectorAll: () => rings,
    };
    return { block, rings };
  };
  const roleOfRing = (text, count, index) => {
    const { block, rings } = fakeBlock(text, count);
    const ring = rings[index];
    ring.closest = (selector) => (/cm-line|p/.test(selector) ? block : null);
    return ringRole(ring);
  };
  const liveText = "Swap live source: areas/work > ^swap-1 and again alias. Control: a and b.";
  assertThat(
    [0, 1, 2, 3].map((index) => roleOfRing(liveText, 4, index)).join(",") === "target,target,control-done,control-ready",
    "ring roles by ordinal",
  );
  assertThat(roleOfRing("Swap tail: areas/work > ^swap-1", 1, 0) === "target", "tail ring is a target");
  assertThat(roleOfRing("See the six: x", 6, 0) === "other", "other blocks are not swap rings");
  assertThat(ringSurface({ closest: (selector) => (selector === ".cm-editor" ? {} : null) }) === "live", "Live Preview surface");
  assertThat(ringSurface({ closest: (selector) => (/markdown-preview-view/.test(selector) ? {} : null) }) === "reading", "Reading surface");

  // A good swap: two rendered instances per surface, each animated once.
  const ring = (id, surface, role, state) => ({ id, surface, role, state, visible: true });
  const start = (id, surface, role, state = "done", animationName = SWAP_ANIMATION) => ({ id, surface, role, state, animationName });
  const before = [
    ring(1, "live", "target", "ready"), ring(2, "live", "target", "ready"),
    ring(3, "live", "control-done", "done"), ring(4, "live", "control-ready", "ready"),
    ring(5, "reading", "target", "ready"), ring(6, "reading", "target", "ready"),
    ring(7, "reading", "control-done", "done"), ring(8, "reading", "control-ready", "ready"),
  ];
  const after = [
    ring(11, "live", "target", "done"), ring(12, "live", "target", "done"),
    ring(3, "live", "control-done", "done"), ring(4, "live", "control-ready", "ready"),
    ring(5, "reading", "target", "done"), ring(6, "reading", "target", "done"),
    ring(7, "reading", "control-done", "done"), ring(8, "reading", "control-ready", "ready"),
  ];
  const goodStarts = [
    start(11, "live", "target"), start(12, "live", "target"),
    start(5, "reading", "target"), start(6, "reading", "target"),
  ];
  const good = judgeSwap({ before, after, starts: goodStarts });
  assertThat(good.ok, `a clean swap must pass: ${good.problems.join("; ")}`);
  assertThat(good.summary.live.targetStarts === 2 && good.summary.reading.distinctElements === 2, "good swap summary");

  const mustFail = (name, input, pattern) => {
    const verdict = judgeSwap(input);
    assertThat(!verdict.ok, `${name} must fail`);
    assertThat(pattern.test(verdict.problems.join("; ")), `${name} must report ${pattern}: ${verdict.problems.join("; ")}`);
  };
  // The old check: only "some Done ring swapped". An unrelated Done control
  // animating, with no target swap, is not success.
  mustFail("an unrelated Done ring animating alone",
    { before, after, starts: [start(3, "live", "control-done"), start(7, "reading", "control-done")] },
    /expected exactly 2 swap start/);
  mustFail("no animation at all", { before, after, starts: [] }, /expected exactly 2 swap start/);
  mustFail("one surface never swapping",
    { before, after, starts: goodStarts.filter((entry) => entry.surface === "live") }, /reading: expected exactly 2/);
  mustFail("a target ring animating twice",
    { before, after, starts: [...goodStarts, start(11, "live", "target")] }, /more than once|expected exactly 2/);
  mustFail("an extra swap on a control",
    { before, after, starts: [...goodStarts, start(4, "reading", "control-ready", "ready")] }, /unrelated ring/);
  mustFail("a stale target ring",
    { before, after: after.map((entry) => (entry.id === 12 ? { ...entry, state: "ready" } : entry)), starts: goodStarts }, /not Done after/);
  mustFail("a target that was already Done before",
    { before: before.map((entry) => (entry.id === 1 ? { ...entry, state: "done" } : entry)), after, starts: goodStarts }, /not Ready before/);
  mustFail("a control ring that changed",
    { before, after: after.map((entry) => (entry.id === 4 ? { ...entry, state: "done" } : entry)), starts: goodStarts }, /control-ready changed/);
  mustFail("no rendered rings", { before: [], after: [], starts: [] }, /no rendered target ring/);
  // Animations other than the swap never count.
  mustFail("a different animation name",
    { before, after, starts: goodStarts.map((entry) => ({ ...entry, animationName: "other" })) }, /expected exactly 2 swap start/);

  // Quiet steps: first paint, unchanged refresh, scroll, rerender.
  assertThat(judgeQuiet("first paint", [], 0).ok, "no starts is quiet");
  assertThat(judgeQuiet("scroll", goodStarts, goodStarts.length).ok, "no new starts since the baseline is quiet");
  const noisy = judgeQuiet("rerender", [...goodStarts, start(20, "live", "target")], goodStarts.length);
  assertThat(!noisy.ok && /rerender: unexpected swap start on live\/target/.test(noisy.problems.join(";")), "a new start after the baseline fails");
  assertThat(!judgeQuiet("first paint", [start(1, "reading", "target", "ready")], 0).ok, "a first-paint swap fails");

  // The acceptance path may not drive the refresh itself. The only mention of
  // the refresh methods is the count-only spy, which wraps by name.
  const source = fs.readFileSync(__filename, "utf8");
  const forced = new RegExp(
    ["\\.(?:run|schedule)Task", "LinkMarksRefresh\\(|\\.sweepTask", "LinkMarksReading\\(|\\.refreshTask", "LinkMarkEditors\\("].join(""),
  );
  assertThat(!forced.test(source), "the e2e must not call the plugin's refresh methods; trigger a normal task edit and observe");
  assertThat(/animationstart/.test(ANIM_INSTALL), "the recorder must count real animationstart events");
  assertThat(!source.includes(["swap-once", '", ', "saw", "Swap,"].join("")), "swap-once must be judged from counted starts, not a boolean");
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
      if (!wantState.source && wantState.mode === "source") {
        const ready = view && view.editor && view.containerEl && view.containerEl.querySelector && view.containerEl.querySelector(".cm-content");
        if (!ready) await new Promise((resolve) => setTimeout(resolve, 250));
      } else {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      const next = view && view.getState && view.getState() || {};
      return {
        ok: true,
        path: view && view.file && view.file.path,
        mode: next.mode || null,
        source: next.source,
      };
    })())()`,
    lib.RPC_TIMEOUT_MS,
  );
}

async function capturePage(client, output) {
  const screenshot = await client.call("Page.captureScreenshot", { format: "png", fromSurface: true });
  fs.writeFileSync(output, Buffer.from(screenshot.data, "base64"));
}

function statesOf(probe, needle) {
  const marks = probe && Array.isArray(probe.marks) ? probe.marks : [];
  return marks
    .filter((mark) => mark && mark.visible !== false && needle.test(String(mark.context || "")))
    .map((mark) => mark.state)
    .sort();
}

function visibleStates(probe) {
  const marks = probe && Array.isArray(probe.marks) ? probe.marks : [];
  return marks.filter((mark) => mark && mark.visible !== false).map((mark) => mark.state).sort();
}

// --- Natural cross-note refresh and single-swap evidence ----------------------
//
// The swap fixtures hold two instances of one target task per source, plus
// an unrelated already-Done ring and an unrelated Ready ring (controls). A
// ring's identity in the page comes from its block text and ordinal, never
// from its state, so an already-Done control can never be mistaken for the
// ring that changed. The page records every real CSS `animationstart` of the
// swap animation per ring element; the judges below turn that record into
// verdicts. The acceptance path triggers only a normal task edit and then
// watches: it never calls the plugin's refresh methods itself.

const SWAP_ANIMATION = "bob-task-link-mark-swap";
const SWAP_REFRESH_BOUND_MS = 3000;
const SWAP_SURFACES = ["live", "reading"];

// Page-side helpers; serialised into the probes with Function.prototype
// .toString, so they must stay self-contained (no closure references).
function ringSurface(el) {
  if (el.closest(".cm-editor")) return "live";
  if (el.closest(".markdown-preview-view, .markdown-reading-view, .markdown-rendered")) return "reading";
  return "other";
}

function ringRole(el) {
  const block = el.closest(".cm-line, p");
  if (!block) return "other";
  const text = String(block.textContent || "").replace(/\s+/g, " ").trim();
  const rings = Array.from(block.querySelectorAll(".bob-task-link-mark"));
  const ordinal = rings.indexOf(el);
  if (/^Swap (live|reading) source/.test(text)) {
    return ordinal < 2 ? "target" : ordinal === 2 ? "control-done" : "control-ready";
  }
  if (/^Swap tail/.test(text)) return "target";
  return "other";
}

const ANIM_INSTALL = `(() => {
  const ringSurface = ${ringSurface.toString()};
  const ringRole = ${ringRole.toString()};
  const previous = window.__tlmAnim;
  if (previous) {
    previous.starts.length = 0;
    return { installed: true, reused: true };
  }
  const rec = { starts: [], ids: new WeakMap(), next: 1 };
  rec.idOf = (el) => {
    if (!rec.ids.has(el)) rec.ids.set(el, rec.next++);
    return rec.ids.get(el);
  };
  document.addEventListener("animationstart", (event) => {
    const el = event.target;
    if (!el || !el.classList || !el.classList.contains("bob-task-link-mark")) return;
    rec.starts.push({
      id: rec.idOf(el),
      animationName: event.animationName,
      surface: ringSurface(el),
      role: ringRole(el),
      state: el.getAttribute("data-state"),
      at: Math.round(performance.now()),
    });
  }, true);
  window.__tlmAnim = rec;
  return { installed: true, reused: false };
})()`;

// Every ring in the page with its identity, plus the animation starts so
// far and the plugin's own schedule/run call counts (observational spies).
const SWAP_SNAPSHOT_PROBE = `(() => { try {
  const ringSurface = ${ringSurface.toString()};
  const ringRole = ${ringRole.toString()};
  const rec = window.__tlmAnim;
  if (!rec) return { error: "animation recorder missing", rings: [], starts: [] };
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
  const rings = Array.from(document.querySelectorAll(".bob-task-link-mark")).map((el) => ({
    id: rec.idOf(el),
    surface: ringSurface(el),
    role: ringRole(el),
    state: el.getAttribute("data-state"),
    label: el.getAttribute("aria-label") || "",
    swap: el.classList.contains("bob-task-link-mark-swap"),
    visible: visible(el),
  }));
  const spy = window.__tlmSpy || { schedule: 0, run: 0 };
  return { rings, starts: rec.starts.slice(), spy: { schedule: spy.schedule, run: spy.run } };
} catch (e) { return { error: String(e && e.message || e), rings: [], starts: [] }; } })()`;

// Count-only spies on the plugin's coalesced refresh. They observe the
// natural event path (metadata, vault, and Tasks events call these) and
// never call, schedule, or replace the behaviour.
const SPY_INSTALL = `(() => {
  const plugin = window.app.plugins.plugins["bob-ledger-tools"];
  if (!plugin) return { error: "plugin missing" };
  if (window.__tlmSpy) return { reused: true };
  const spy = { schedule: 0, run: 0 };
  const wrap = (name, key) => {
    const original = plugin[name];
    if (typeof original !== "function") return;
    plugin[name] = function spied() {
      spy[key] += 1;
      return original.apply(this, arguments);
    };
  };
  wrap("scheduleTaskLinkMarksRefresh", "schedule");
  wrap("runTaskLinkMarksRefresh", "run");
  window.__tlmSpy = spy;
  return { installed: true };
})()`;

// Computed motion of a swapped ring in the real app, under the production
// stylesheet and Obsidian's own CSS. Reduced motion is emulated through CDP.
const MOTION_PROBE = `(() => {
  const host = document.createElement("span");
  host.className = "bob-task-link-mark bob-task-link-mark-swap";
  host.setAttribute("data-state", "ready");
  document.body.appendChild(host);
  const style = getComputedStyle(host);
  const out = {
    reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    gate: document.body.classList.contains("bob-task-link-marks"),
    animationName: style.animationName,
    transitionDuration: style.transitionDuration,
  };
  host.remove();
  return out;
})()`;

// Reading-view section state, for triage when a ring is stale after a scroll:
// whether Obsidian keeps rendered sections detached from the page, and what
// each section's rings say. Read-only; uses Obsidian's renderer internals.
const READING_SECTIONS_PROBE = `(() => { try {
  const { readingLeaf } = window.__tlmLeaves || {};
  const renderer = readingLeaf && readingLeaf.view && readingLeaf.view.previewMode && readingLeaf.view.previewMode.renderer;
  const sections = renderer && Array.isArray(renderer.sections) ? renderer.sections : [];
  return {
    total: sections.length,
    sections: sections
      .map((section, index) => {
        const el = section && section.el;
        const rings = el && el.querySelectorAll ? Array.from(el.querySelectorAll(".bob-task-link-mark")) : [];
        return {
          index,
          rendered: Boolean(section && section.rendered),
          connected: Boolean(el && el.isConnected),
          rings: rings.map((ring) => ring.getAttribute("data-state")),
          text: el ? String(el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 40) : "",
        };
      })
      .filter((entry) => entry.rings.length > 0 || /Swap/.test(entry.text)),
  };
} catch (e) { return { error: String(e && e.message || e) }; } })()`;

function ringsFor(rings, surface, role) {
  return (Array.isArray(rings) ? rings : []).filter(
    (ring) => ring && ring.surface === surface && ring.role === role && ring.visible !== false,
  );
}

function swapStartsFor(starts, surface) {
  return (Array.isArray(starts) ? starts : []).filter(
    (start) => start && start.surface === surface && start.animationName === SWAP_ANIMATION,
  );
}

// Verdict for the natural status change. `before` and `after` are ring
// lists; `starts` is the animation-start record covering only the window
// between them. Exactly one swap start per rendered target instance on each
// surface, each on its own element, none on a control ring, and every
// rendered target ring Done afterwards. Returns {ok, problems, summary}.
function judgeSwap(input) {
  const problems = [];
  const summary = {};
  const { before, after, starts } = input || {};
  for (const surface of SWAP_SURFACES) {
    const rendered = ringsFor(before, surface, "target");
    const expected = rendered.length;
    const notReady = rendered.filter((ring) => ring.state !== "ready");
    const afterTargets = ringsFor(after, surface, "target");
    const notDone = afterTargets.filter((ring) => ring.state !== "done");
    const surfaceStarts = swapStartsFor(starts, surface);
    const targetStarts = surfaceStarts.filter((start) => start.role === "target");
    const otherStarts = surfaceStarts.filter((start) => start.role !== "target");
    const distinct = new Set(targetStarts.map((start) => start.id));
    summary[surface] = {
      renderedBefore: expected,
      doneAfter: afterTargets.length - notDone.length,
      targetStarts: targetStarts.length,
      distinctElements: distinct.size,
      otherStarts: otherStarts.length,
    };
    if (expected === 0) problems.push(`${surface}: no rendered target ring before the change`);
    if (notReady.length) problems.push(`${surface}: ${notReady.length} target ring(s) were not Ready before the change`);
    if (afterTargets.length < expected) problems.push(`${surface}: ${afterTargets.length} target ring(s) after, ${expected} before`);
    if (notDone.length) problems.push(`${surface}: target ring(s) not Done after the edit: ${notDone.map((ring) => ring.state).join(",")}`);
    if (targetStarts.length !== expected) {
      problems.push(`${surface}: expected exactly ${expected} swap start(s) (one per rendered instance), saw ${targetStarts.length}`);
    }
    if (distinct.size !== targetStarts.length) {
      problems.push(`${surface}: a target ring played the swap more than once (${targetStarts.length} starts on ${distinct.size} element(s))`);
    }
    if (otherStarts.length) {
      problems.push(`${surface}: unrelated ring(s) animated: ${otherStarts.map((start) => `${start.role}/${start.state}`).join(",")}`);
    }
    for (const role of ["control-done", "control-ready"]) {
      const was = ringsFor(before, surface, role).map((ring) => ring.state).join(",");
      const now = ringsFor(after, surface, role).map((ring) => ring.state).join(",");
      if (was !== now) problems.push(`${surface}: ${role} changed from ${was || "none"} to ${now || "none"}`);
    }
  }
  return { ok: problems.length === 0, problems, summary };
}

// Verdict for a step that must not create a swap: first paint, an unchanged
// refresh, scrolling, or a rerender. `baseline` is how many swap starts were
// already recorded before the step.
function judgeQuiet(label, starts, baseline) {
  const all = (Array.isArray(starts) ? starts : []).filter((start) => start && start.animationName === SWAP_ANIMATION);
  const extra = all.slice(baseline);
  const problems = extra.map((start) => `${label}: unexpected swap start on ${start.surface}/${start.role} (${start.state})`);
  return { ok: problems.length === 0, problems, count: all.length };
}

async function waitForMarks(client, predicate, label, timeoutMs = 8000) {
  return waitFor(client, MARKS_PROBE, predicate, label, timeoutMs);
}

async function runE2e(parsed) {
  const executable = findExecutable(parsed.executable);
  const probe = probeExecutable(executable);
  if (!probe.ok) {
    fail(
      `unrun: ${probe.reason}. Rerun on a host with the Obsidian Electron app: xvfb-run -a node scripts/obsidian-task-link-marks-e2e.cjs -e /snap/bin/obsidian`,
      2,
    );
  }
  if (!process.env.DISPLAY && !process.env.XVFB_RUN_TMPDIR) {
    fail("unrun: no X display; rerun under xvfb-run -a node scripts/obsidian-task-link-marks-e2e.cjs", 2);
  }

  const outDir = parsed.out ? path.resolve(parsed.out) : fs.mkdtempSync(path.join(os.tmpdir(), "bob-tlm-e2e-out-"));
  fs.mkdirSync(outDir, { recursive: true });
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bob-tlm-e2e-"));
  const vaultDir = path.join(runRoot, "vault");
  const profileDir = path.join(runRoot, "profile");
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(profileDir, { recursive: true });
  const fixture = buildFixture(vaultDir);
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
  const child = spawn(executable, [
    "--no-sandbox",
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${cdpPort}`,
    "--remote-allow-origins=http://127.0.0.1/*",
    fixtureRealPath,
  ], {
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
  const report = {
    executable,
    vault: fixtureRealPath,
    cases: [],
    skipped: [],
    screenshots: [],
    pass: false,
  };
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

    await client.evaluate(
      `(() => (async () => {
        const plugins = window.app && window.app.plugins;
        if (!plugins || typeof plugins.isEnabled !== "function") return { error: "plugin manager unavailable" };
        if (!plugins.isEnabled()) await plugins.setEnable(true);
        return { enabled: Boolean(plugins.isEnabled()) };
      })())()`,
      lib.RPC_TIMEOUT_MS,
    );

    const pluginDeadline = Date.now() + 30_000;
    let loaded = false;
    while (Date.now() < pluginDeadline) {
      loaded = await client.evaluate(
        'Boolean(window.app && window.app.plugins && window.app.plugins.plugins && window.app.plugins.plugins["bob-ledger-tools"])',
      ).catch(() => false);
      if (loaded) break;
      await sleep(400);
    }
    record("plugin-loaded", loaded, loaded ? "bob-ledger-tools" : "bob-ledger-tools did not load");
    if (!loaded) throw new Error("bob-ledger-tools did not load in the scratch vault");
    await dismissTrustModal(client);
    await sleep(800);

    const commandProbe = await client.evaluate(MARKS_PROBE);
    record("toggle-command-registered", Boolean(commandProbe && commandProbe.command), JSON.stringify({ command: commandProbe && commandProbe.command }));

    async function openAndProbe(file, mode, label) {
      const opened = await openNote(client, file, mode);
      record(`open-${label}`, opened && opened.ok && opened.path === file, opened && `${opened.path} mode=${opened.mode} source=${opened.source}`);
      await sleep(400);
      const marks = await waitForMarks(
        client,
        (value) => value && Array.isArray(value.marks),
        `marks-${label}`,
        8000,
      ).catch((error) => ({ marks: [], error: error.message }));
      return marks;
    }

    const sixWanted = ["blocked", "cancelled", "done", "in-progress", "next", "ready"];

    const proseLive = await openAndProbe(fixture.prose, "live", "prose-live");
    const liveSix = statesOf(proseLive, /See the six/);
    record("lp-six-states", liveSix.join(",") === sixWanted.join(","), liveSix.join(",") || JSON.stringify(proseLive.marks));
    record("lp-heading-none", statesOf(proseLive, /Heading only/).length === 0, statesOf(proseLive, /Heading only/).join(","));
    record("lp-nontask-none", statesOf(proseLive, /Non-task block/).length === 0, statesOf(proseLive, /Non-task block/).join(","));
    record("lp-checklist-none", statesOf(proseLive, /Plain checklist/).length === 0, statesOf(proseLive, /Plain checklist/).join(","));
    record("lp-embed-none", statesOf(proseLive, /^Embed:/).length === 0, statesOf(proseLive, /^Embed:/).join(","));
    record("lp-struck-ready", statesOf(proseLive, /Struck:/).includes("ready"), statesOf(proseLive, /Struck:/).join(","));
    record("lp-quote-done", statesOf(proseLive, /Quote:/).includes("done"), statesOf(proseLive, /Quote:/).join(","));
    record("lp-gate-on", proseLive.gate === true, `gate=${proseLive.gate}`);

    const shotLight = path.join(outDir, "e2e-task-link-marks-light.png");
    await capturePage(client, shotLight);
    report.screenshots.push(shotLight);

    await client.evaluate(`(() => {
      document.body.classList.remove("theme-light");
      document.body.classList.add("theme-dark");
      return true;
    })()`);
    await sleep(250);
    const shotDark = path.join(outDir, "e2e-task-link-marks-dark.png");
    await capturePage(client, shotDark);
    report.screenshots.push(shotDark);
    await client.evaluate(`(() => {
      document.body.classList.remove("theme-dark");
      document.body.classList.add("theme-light");
      return true;
    })()`);
    await sleep(150);

    const proseReading = await openAndProbe(fixture.prose, "preview", "prose-reading");
    const readingSix = statesOf(proseReading, /See the six/);
    record("reading-six-states", readingSix.join(",") === sixWanted.join(","), readingSix.join(",") || JSON.stringify(proseReading.marks));
    record("reading-heading-none", statesOf(proseReading, /Heading only/).length === 0, statesOf(proseReading, /Heading only/).join(","));
    record("reading-nontask-none", statesOf(proseReading, /Non-task block/).length === 0, statesOf(proseReading, /Non-task block/).join(","));
    record("reading-checklist-none", statesOf(proseReading, /Plain checklist/).length === 0, statesOf(proseReading, /Plain checklist/).join(","));
    record("reading-embed-none", statesOf(proseReading, /^Embed:/).length === 0, statesOf(proseReading, /^Embed:/).join(","));
    record("reading-struck-ready", statesOf(proseReading, /Struck:/).includes("ready"), statesOf(proseReading, /Struck:/).join(","));

    const dailyLive = await openAndProbe(fixture.daily, "live", "daily-live");
    const ledgerDedicated = (dailyLive.marks || []).filter((mark) => mark.visible !== false && /areas\/work#\^ready-1|work > \^ready-1/.test(String(mark.context || "")) && !/see |pair with |Related|Follow up|See the six/.test(String(mark.context || "")));
    record("lp-ledger-row-none", ledgerDedicated.length === 0, JSON.stringify(ledgerDedicated));
    record("lp-ledger-nested", statesOf(dailyLive, /\bsee\b/i).includes("next"), statesOf(dailyLive, /\bsee\b/i).join(","));
    record("lp-ledger-mixed", statesOf(dailyLive, /pair with/).includes("in-progress"), statesOf(dailyLive, /pair with/).join(","));
    record("lp-daily-notes", statesOf(dailyLive, /Daily notes prose/).includes("blocked"), statesOf(dailyLive, /Daily notes prose/).join(","));

    const dailyReading = await openAndProbe(fixture.daily, "preview", "daily-reading");
    record("reading-ledger-nested", statesOf(dailyReading, /\bsee\b/i).includes("next"), statesOf(dailyReading, /\bsee\b/i).join(","));
    record("reading-ledger-mixed", statesOf(dailyReading, /pair with/).includes("in-progress"), statesOf(dailyReading, /pair with/).join(","));
    record("reading-daily-notes", statesOf(dailyReading, /Daily notes prose/).includes("blocked"), statesOf(dailyReading, /Daily notes prose/).join(","));

    const managedLive = await openAndProbe(fixture.managed, "live", "managed-live");
    record("lp-task-title-ring", statesOf(managedLive, /Parent with a mention/).includes("ready"), statesOf(managedLive, /Parent with a mention/).join(","));
    record("lp-depends-none", statesOf(managedLive, /DEPENDS ON/).length === 0, statesOf(managedLive, /DEPENDS ON/).join(","));
    record("lp-links-none", statesOf(managedLive, /LINKS:/).length === 0, statesOf(managedLive, /LINKS:/).join(","));

    const managedReading = await openAndProbe(fixture.managed, "preview", "managed-reading");
    record("reading-depends-none", statesOf(managedReading, /DEPENDS ON/).length === 0, statesOf(managedReading, /DEPENDS ON/).join(","));
    record("reading-links-none", statesOf(managedReading, /LINKS:/).length === 0, statesOf(managedReading, /LINKS:/).join(","));

    // --- Natural cross-note refresh, one swap per rendered instance ------------
    // Two sources stay open side by side: swap-live.md in Live Preview and
    // swap-reading.md in Reading view. Each links the swap target twice and
    // holds an unrelated Done ring and an unrelated Ready ring. The only
    // trigger is an ordinary edit of the target task in a third note, then we
    // watch the DOM and the real CSS animation starts.
    const snapshot = () => client
      .evaluate(SWAP_SNAPSHOT_PROBE)
      .catch((error) => ({ error: String(error && error.message || error), rings: [], starts: [] }));
    const editArea = (from, to) => client.evaluate(
      `(() => (async () => {
        const abstract = window.app.vault.getAbstractFileByPath(${JSON.stringify(fixture.area)});
        if (!abstract) return { ok: false, error: "missing area note" };
        const text = await window.app.vault.read(abstract);
        const next = text.replace(${JSON.stringify(from)}, ${JSON.stringify(to)});
        if (next === text) return { ok: false, error: "line not found: " + ${JSON.stringify(from)} };
        await window.app.vault.modify(abstract, next);
        return { ok: true };
      })())()`,
      lib.RPC_TIMEOUT_MS,
    );
    const quiet = async (name, label, baseline, waitMs) => {
      await sleep(waitMs);
      const now = await snapshot();
      const verdict = judgeQuiet(label, now.starts, baseline);
      record(name, verdict.ok, verdict.ok ? `${verdict.count} swap start(s) total` : verdict.problems.join("; "));
      return now;
    };

    const spyInstalled = await client.evaluate(SPY_INSTALL);
    record("swap-spies-installed", Boolean(spyInstalled && !spyInstalled.error), JSON.stringify(spyInstalled));
    await client.evaluate(ANIM_INSTALL);

    const layout = await client.evaluate(
      `(() => (async () => {
        const ws = window.app.workspace;
        const file = (p) => window.app.vault.getAbstractFileByPath(p);
        const liveFile = file(${JSON.stringify(fixture.swapLive)});
        const readingFile = file(${JSON.stringify(fixture.swapReading)});
        if (!liveFile || !readingFile) return { ok: false, error: "swap source missing" };
        const liveLeaf = ws.getLeaf(false);
        await liveLeaf.openFile(liveFile, { state: { mode: "source", source: false } });
        const readingLeaf = ws.getLeaf("split", "vertical");
        await readingLeaf.openFile(readingFile, { state: { mode: "preview", source: false } });
        window.__tlmLeaves = { liveLeaf, readingLeaf };
        await new Promise((resolve) => setTimeout(resolve, 600));
        return {
          ok: true,
          live: liveLeaf.view.getState().mode + "/" + liveLeaf.view.getState().source,
          reading: readingLeaf.view.getState().mode,
        };
      })())()`,
      lib.RPC_TIMEOUT_MS,
    );
    record("swap-sources-open", layout && layout.ok && layout.live === "source/false" && layout.reading === "preview", JSON.stringify(layout));

    const bothRendered = (value) => SWAP_SURFACES.every((surface) => ringsFor(value && value.rings, surface, "target").length >= 2);
    let opened = await snapshot();
    const renderDeadline = Date.now() + 10_000;
    while (!bothRendered(opened) && Date.now() < renderDeadline) {
      await sleep(150);
      opened = await snapshot();
    }
    record(
      "swap-sources-rendered",
      bothRendered(opened),
      SWAP_SURFACES.map((surface) => `${surface}=${ringsFor(opened.rings, surface, "target").map((ring) => ring.state).join(",")}`).join(" "),
    );
    // First paint: rings appear with no swap animation, on both surfaces.
    await quiet("swap-first-paint-none", "first paint", 0, 800);

    // An unchanged refresh: an ordinary edit of an unrelated line in the
    // target note fires the same events but changes no ring.
    const unrelated = await editArea("Some text ^block-1", "Some text, edited ^block-1");
    record("swap-unrelated-edit", unrelated && unrelated.ok, unrelated && (unrelated.error || "modified"));
    await quiet("swap-unchanged-refresh-none", "unchanged refresh", 0, 1500);

    // The change under test.
    const beforeChange = await snapshot();
    const spyBefore = beforeChange.spy || { schedule: 0, run: 0 };
    const baseline = beforeChange.starts.length;
    const changedAt = Date.now();
    const completed = await editArea("- [ ] #task Swap target ^swap-1", "- [x] #task Swap target ^swap-1");
    record("complete-swap-target", completed && completed.ok, completed && (completed.error || "modified"));
    const updatedAfterMs = {};
    let latest = beforeChange;
    while (Date.now() - changedAt < SWAP_REFRESH_BOUND_MS) {
      latest = await snapshot();
      for (const surface of SWAP_SURFACES) {
        const targets = ringsFor(latest.rings, surface, "target");
        if (updatedAfterMs[surface] === undefined && targets.length > 0 && targets.every((ring) => ring.state === "done")) {
          updatedAfterMs[surface] = Date.now() - changedAt;
        }
      }
      if (SWAP_SURFACES.every((surface) => updatedAfterMs[surface] !== undefined)) break;
      await sleep(40);
    }
    for (const surface of SWAP_SURFACES) {
      const name = surface === "live" ? "cross-note-live-preview-updates" : "cross-note-reading-updates";
      const ms = updatedAfterMs[surface];
      record(name, ms !== undefined, ms !== undefined
        ? `target ring Done ${ms}ms after the edit (bound ${SWAP_REFRESH_BOUND_MS}ms)`
        : `still ${ringsFor(latest.rings, surface, "target").map((ring) => ring.state).join(",") || "no rings"} after ${SWAP_REFRESH_BOUND_MS}ms`);
    }
    // Let any duplicate swap show itself before judging.
    await sleep(1500);
    const afterChange = await snapshot();
    const spyAfter = afterChange.spy || { schedule: 0, run: 0 };
    record(
      "cross-note-natural-events",
      spyAfter.schedule > spyBefore.schedule && spyAfter.run > spyBefore.run,
      `coalesced refresh scheduled ${spyAfter.schedule - spyBefore.schedule}x and ran ${spyAfter.run - spyBefore.run}x from vault/metadata/Tasks events; the harness never calls it`,
    );
    const swapVerdict = judgeSwap({
      before: beforeChange.rings,
      after: afterChange.rings,
      starts: afterChange.starts.slice(baseline),
    });
    const swapPerSurface = (surface) => {
      const entry = swapVerdict.summary[surface];
      return `${entry.targetStarts} swap start(s) on ${entry.distinctElements} element(s) for ${entry.renderedBefore} rendered instance(s); ${entry.otherStarts} unrelated`;
    };
    record(
      "cross-note-ready-becomes-done",
      SWAP_SURFACES.every((surface) => swapVerdict.summary[surface].doneAfter === swapVerdict.summary[surface].renderedBefore && swapVerdict.summary[surface].renderedBefore > 0),
      SWAP_SURFACES.map((surface) => `${surface}: ${swapVerdict.summary[surface].doneAfter}/${swapVerdict.summary[surface].renderedBefore} Done`).join("; "),
    );
    record("cross-note-swap-once", swapVerdict.ok, swapVerdict.ok
      ? SWAP_SURFACES.map((surface) => `${surface}: ${swapPerSurface(surface)}`).join("; ")
      : swapVerdict.problems.join("; "));
    const settledStarts = afterChange.starts.length;
    report.swap = {
      refreshBoundMs: SWAP_REFRESH_BOUND_MS,
      updatedAfterMs,
      verdict: swapVerdict,
      starts: afterChange.starts,
      spy: { before: spyBefore, after: spyAfter },
    };

    // Nothing further may swap: another unchanged refresh, scrolling the
    // tail instances into view, and rerendering both surfaces.
    const unrelatedAgain = await editArea("Some text, edited ^block-1", "Some text, edited again ^block-1");
    record("swap-unrelated-edit-after", unrelatedAgain && unrelatedAgain.ok, unrelatedAgain && (unrelatedAgain.error || "modified"));
    await quiet("swap-unchanged-refresh-after-none", "unchanged refresh after the swap", settledStarts, 1500);

    const scrollTo = (bottom) => client.evaluate(
      `(() => (async () => {
        const { liveLeaf, readingLeaf } = window.__tlmLeaves;
        const cm = liveLeaf.view.editor.cm;
        const reading = readingLeaf.view.containerEl.querySelector(".markdown-preview-view");
        const bottom = ${bottom ? "true" : "false"};
        cm.scrollDOM.scrollTop = bottom ? cm.scrollDOM.scrollHeight : 0;
        if (reading) reading.scrollTop = bottom ? reading.scrollHeight : 0;
        await new Promise((resolve) => setTimeout(resolve, 900));
        return {
          live: { top: Math.round(cm.scrollDOM.scrollTop), height: cm.scrollDOM.scrollHeight, client: cm.scrollDOM.clientHeight },
          reading: reading ? { top: Math.round(reading.scrollTop), height: reading.scrollHeight, client: reading.clientHeight } : null,
        };
      })())()`,
      lib.RPC_TIMEOUT_MS,
    );
    const bottomScroll = await scrollTo(true);
    const atBottom = await snapshot();
    const scrolled = SWAP_SURFACES.every((surface) => bottomScroll && bottomScroll[surface] && bottomScroll[surface].top > 0);
    record("swap-scrolled-to-tail", scrolled, JSON.stringify(bottomScroll));
    const tailStates = SWAP_SURFACES.map((surface) => `${surface}=${ringsFor(atBottom.rings, surface, "target").map((ring) => ring.state).join(",")}`);
    record(
      "swap-tail-rings-done",
      SWAP_SURFACES.every((surface) => {
        const targets = ringsFor(atBottom.rings, surface, "target");
        return targets.length > 0 && targets.every((ring) => ring.state === "done");
      }),
      tailStates.join(" ") + " sections=" + JSON.stringify(await client.evaluate(READING_SECTIONS_PROBE)),
    );
    await scrollTo(false);
    await quiet("swap-scroll-none", "scrolling", settledStarts, 600);

    const rerendered = await client.evaluate(
      `(() => (async () => {
        const { liveLeaf, readingLeaf } = window.__tlmLeaves;
        readingLeaf.view.previewMode.rerender(true);
        const view = liveLeaf.view;
        const current = view.getState();
        await view.setState(Object.assign({}, current, { mode: "source", source: true }), { history: false });
        await new Promise((resolve) => setTimeout(resolve, 500));
        await view.setState(Object.assign({}, current, { mode: "source", source: false }), { history: false });
        await new Promise((resolve) => setTimeout(resolve, 900));
        return { ok: true };
      })())()`,
      lib.RPC_TIMEOUT_MS,
    );
    record("swap-rerendered", rerendered && rerendered.ok, JSON.stringify(rerendered));
    const afterRerender = await quiet("swap-rerender-none", "rerender", settledStarts, 600);
    record(
      "swap-rerender-rings-done",
      SWAP_SURFACES.every((surface) => {
        const targets = ringsFor(afterRerender.rings, surface, "target");
        return targets.length >= 2 && targets.every((ring) => ring.state === "done");
      }),
      SWAP_SURFACES.map((surface) => `${surface}=${ringsFor(afterRerender.rings, surface, "target").map((ring) => ring.state).join(",")}`).join(" "),
    );

    // Reduced motion in the real app: the swap animation and the transitions
    // must compute to none, while normal motion keeps the swap.
    const emulate = (value) => client.call(
      "Emulation.setEmulatedMedia",
      { features: [{ name: "prefers-reduced-motion", value }] },
      lib.RPC_TIMEOUT_MS,
    );
    let motionNormal = null;
    let motionReduced = null;
    try {
      await emulate("no-preference");
      motionNormal = await client.evaluate(MOTION_PROBE);
      await emulate("reduce");
      motionReduced = await client.evaluate(MOTION_PROBE);
    } finally {
      await emulate("no-preference").catch(() => {});
    }
    record(
      "motion-normal-keeps-swap",
      Boolean(motionNormal) && motionNormal.gate === true && motionNormal.reduced === false && motionNormal.animationName === SWAP_ANIMATION,
      JSON.stringify(motionNormal),
    );
    record(
      "motion-reduced-disables-swap",
      Boolean(motionReduced) && motionReduced.reduced === true && motionReduced.animationName === "none" &&
        String(motionReduced.transitionDuration).split(",").every((part) => part.trim() === "0s"),
      JSON.stringify(motionReduced),
    );
    report.motion = { normal: motionNormal, reduced: motionReduced };

    // Screenshots of the swapped, settled state, side by side.
    const splitLight = path.join(outDir, "e2e-task-link-marks-swap-light.png");
    await capturePage(client, splitLight);
    report.screenshots.push(splitLight);
    await client.evaluate(`(() => {
      document.body.classList.remove("theme-light");
      document.body.classList.add("theme-dark");
      return true;
    })()`);
    await sleep(250);
    const splitDark = path.join(outDir, "e2e-task-link-marks-swap-dark.png");
    await capturePage(client, splitDark);
    report.screenshots.push(splitDark);
    await client.evaluate(`(() => {
      document.body.classList.remove("theme-dark");
      document.body.classList.add("theme-light");
      return true;
    })()`);

    // Back to one pane for the remaining checks.
    await client.evaluate(
      `(() => {
        const { liveLeaf, readingLeaf } = window.__tlmLeaves || {};
        if (readingLeaf) readingLeaf.detach();
        if (liveLeaf) window.app.workspace.setActiveLeaf(liveLeaf, { focus: true });
        delete window.__tlmLeaves;
        return true;
      })()`,
    );
    await sleep(300);

    await openNote(client, fixture.prose, "live");
    await sleep(300);
    const heightsBeforeToggle = await client.evaluate(LINE_HEIGHT_PROBE);
    const beforeToggle = await client.evaluate(MARKS_PROBE);
    const toggledOff = await client.evaluate(
      `(() => {
        const result = window.app.commands.executeCommandById("bob-ledger-tools:toggle-task-link-marks");
        return { ok: result !== false };
      })()`,
    );
    record("toggle-off-command", toggledOff && toggledOff.ok);
    const offProbe = await waitForMarks(
      client,
      (value) => value && (value.gate === false || visibleStates(value).length === 0),
      "toggle-hides-rings",
      4000,
    ).catch((error) => ({ error: error.message, marks: [], gate: true }));
    record("toggle-hides-rings", offProbe.gate === false && visibleStates(offProbe).length === 0, `gate=${offProbe.gate} visible=${visibleStates(offProbe).length}`);
    const heightsOff = await client.evaluate(LINE_HEIGHT_PROBE);
    const heightOn = heightsBeforeToggle && heightsBeforeToggle.short && heightsBeforeToggle.short.height;
    const heightOff = heightsOff && heightsOff.short && heightsOff.short.height;
    const sameHeight = Number.isFinite(heightOn) && Number.isFinite(heightOff) && Math.abs(heightOn - heightOff) <= 1;
    record("line-height-unchanged", sameHeight, `on=${heightOn} off=${heightOff} text=${heightsBeforeToggle && heightsBeforeToggle.short && heightsBeforeToggle.short.text}`);

    await client.evaluate(`(() => window.app.commands.executeCommandById("bob-ledger-tools:toggle-task-link-marks"))()`);
    const onProbe = await waitForMarks(
      client,
      (value) => value && value.gate === true && visibleStates(value).length > 0,
      "toggle-restores-rings",
      4000,
    ).catch((error) => ({ error: error.message, marks: [], gate: false }));
    record("toggle-restores-rings", onProbe.gate === true && visibleStates(onProbe).length > 0, `gate=${onProbe.gate} visible=${visibleStates(onProbe).length} before=${visibleStates(beforeToggle).length}`);

    await openNote(client, fixture.prose, "preview");
    await sleep(400);
    const hover = await client.evaluate(
      `(() => {
        const app = window.app;
        const links = Array.from(document.querySelectorAll("a.internal-link"));
        const target = links.find((link) => {
          const href = String(link.getAttribute("data-href") || link.getAttribute("href") || "");
          return href === "areas/work" || href === "areas/work.md";
        });
        if (!target) return { ok: false, error: "overview link missing", hrefs: links.map((link) => link.getAttribute("data-href")).slice(0, 12) };
        const rect = target.getBoundingClientRect();
        const event = new MouseEvent("mouseover", {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + Math.min(8, Math.max(1, rect.width / 2)),
          clientY: rect.top + Math.min(8, Math.max(1, rect.height / 2)),
        });
        app.workspace.trigger("hover-link", {
          event,
          source: "preview",
          hoverParent: target,
          targetEl: target,
          linktext: "areas/work",
          sourcePath: "prose.md",
        });
        return { ok: true };
      })()`,
    );
    if (!hover || !hover.ok) {
      skip("hover-popover-rings", hover && hover.error ? hover.error : "overview link missing");
    } else {
      const popover = await waitForMarks(
        client,
        (value) => value && value.popover === true && Array.isArray(value.popoverMarks) && value.popoverMarks.some((mark) => mark && mark.visible !== false),
        "hover-popover-rings",
        6000,
      ).catch((error) => ({ error: error.message, popover: false, popoverMarks: [] }));
      record(
        "hover-popover-rings",
        Boolean(popover.popover) && (popover.popoverMarks || []).some((mark) => mark && mark.visible !== false),
        popover.error || JSON.stringify(popover.popoverMarks),
      );
    }

    if (!fixture.tasksPlugin) {
      skip("tasks-query-rings", "Tasks plugin was not copied into the scratch vault; node tests cover query rows");
    } else {
      const queryOpen = await openNote(client, fixture.queries, "preview");
      record("open-queries-reading", queryOpen && queryOpen.ok, queryOpen && queryOpen.path);
      const marked = await waitForMarks(
        client,
        (value) => value && Array.isArray(value.taskRows) && value.taskRows.some((row) => Array.isArray(row.marks) && row.marks.length > 0),
        "tasks-query-rings",
        15000,
      ).catch(async (error) => {
        const latest = await client.evaluate(MARKS_PROBE).catch(() => ({ taskRows: [] }));
        return { error: error.message, taskRows: latest.taskRows || [] };
      });
      const withMarks = (marked.taskRows || []).filter((row) => Array.isArray(row.marks) && row.marks.length > 0);
      if (withMarks.length > 0) {
        record("tasks-query-rings", true, JSON.stringify(withMarks.slice(0, 2)));
      } else if (!(marked.taskRows || []).length) {
        skip("tasks-query-rings", marked.error || "Tasks query rows did not render; node tests cover query rows");
      } else if (!(marked.taskRows || []).some((row) => Array.isArray(row.links) && row.links.length > 0)) {
        skip("tasks-query-rings", "Tasks rows rendered without internal-links; node tests cover rings when a.internal-link is present");
      } else {
        record("tasks-query-rings", false, marked.error || JSON.stringify((marked.taskRows || []).slice(0, 3)));
      }
    }

    report.cases = cases;
    report.skipped = skipped;
    report.pass = cases.every((item) => item.ok);
    report.out = outDir;
    if (parsed.report) {
      fs.mkdirSync(path.dirname(path.resolve(parsed.report)), { recursive: true });
      fs.writeFileSync(parsed.report, JSON.stringify(report, null, 2));
    }
    console.log(JSON.stringify({
      pass: report.pass,
      failed: cases.filter((item) => !item.ok).map((item) => item.name),
      skipped: skipped.map((item) => item.name),
      screenshots: report.screenshots,
      out: outDir,
    }, null, 2));
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
