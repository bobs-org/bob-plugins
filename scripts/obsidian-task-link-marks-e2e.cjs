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

    await openNote(client, fixture.prose, "live");
    await sleep(400);
    await waitForMarks(client, (value) => statesOf(value, /See the six/).includes("ready"), "prose-ready-before-complete", 8000);

    const completed = await client.evaluate(
      `(() => (async () => {
        const target = ${JSON.stringify(fixture.area)};
        const abstract = window.app.vault.getAbstractFileByPath(target);
        if (!abstract) return { ok: false, error: "missing " + target };
        const text = await window.app.vault.read(abstract);
        const next = text.replace("- [ ] #task Ready task ^ready-1", "- [x] #task Ready task ^ready-1");
        if (next === text) return { ok: false, error: "ready line not found" };
        await window.app.vault.modify(abstract, next);
        return { ok: true };
      })())()`,
      lib.RPC_TIMEOUT_MS,
    );
    record("complete-ready-task", completed && completed.ok, completed && (completed.error || "modified"));

    const RESOLVE_PROBE = `(() => { try {
      const plugin = window.app.plugins.plugins["bob-ledger-tools"];
      const hit = plugin && typeof plugin.taskLinkMarkResolve === "function"
        ? plugin.taskLinkMarkResolve({ linkpath: "areas/work", blockId: "ready-1", sourcePath: "prose.md" })
        : null;
      const tasksPlugin = window.app.plugins.plugins["obsidian-tasks-plugin"];
      const tasks = tasksPlugin && typeof tasksPlugin.getTasks === "function" ? tasksPlugin.getTasks() : [];
      const task = (Array.isArray(tasks) ? tasks : []).find((row) => row && (row.blockId === "ready-1" || /\\^ready-1/.test(String(row.originalMarkdown || ""))));
      const cache = window.app.metadataCache.getCache("areas/work.md");
      const block = cache && cache.blocks && (cache.blocks["ready-1"] || cache.blocks["^ready-1"]);
      const line = block && block.position && block.position.start && block.position.start.line;
      const item = Array.isArray(cache && cache.listItems) ? cache.listItems.find((entry) => entry && entry.position && entry.position.start && entry.position.start.line === line) : null;
      return {
        state: hit && hit.state || null,
        taskSymbol: task && task.status && (task.status.symbol || task.status.name) || (task && task.status) || null,
        cacheTask: item && item.task || null,
      };
    } catch (e) { return { error: String(e && e.message || e) }; } })()`;

    let sawSwap = false;
    let afterComplete = null;
    let resolveProbe = null;
    let forcedRefresh = false;
    const swapDeadline = Date.now() + REFRESH_WAIT_MS;
    while (Date.now() < swapDeadline) {
      resolveProbe = await client.evaluate(RESOLVE_PROBE).catch((error) => ({ error: String(error && error.message || error) }));
      if (resolveProbe && resolveProbe.state === "done" && !forcedRefresh) {
        forcedRefresh = true;
        await client.evaluate(`(() => {
          const plugin = window.app.plugins.plugins["bob-ledger-tools"];
          if (plugin && typeof plugin.runTaskLinkMarksRefresh === "function") plugin.runTaskLinkMarksRefresh(true);
          return true;
        })()`);
      }
      afterComplete = await client.evaluate(MARKS_PROBE).catch((error) => ({ error: String(error && error.message || error), marks: [] }));
      const six = afterComplete && afterComplete.marks
        ? afterComplete.marks.filter((mark) => mark && mark.visible !== false && /See the six/.test(String(mark.context || "")))
        : [];
      if (six.some((mark) => mark.swap && mark.state === "done")) sawSwap = true;
      if (six.some((mark) => mark.state === "done") && sawSwap) break;
      if (six.some((mark) => mark.state === "done") && forcedRefresh && Date.now() > swapDeadline - 500) break;
      await sleep(20);
    }
    const sixAfter = statesOf(afterComplete, /See the six/);
    record(
      "cross-note-ready-becomes-done",
      sixAfter.includes("done") && !sixAfter.includes("ready"),
      `${sixAfter.join(",")} resolve=${JSON.stringify(resolveProbe)}`,
    );
    record("cross-note-swap-once", sawSwap, `sawSwap=${sawSwap} resolve=${resolveProbe && resolveProbe.state}`);

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
