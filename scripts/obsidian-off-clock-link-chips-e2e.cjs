#!/usr/bin/env node
// Real-Obsidian e2e for ledger off-clock link chips.
// Isolated scratch vault + profile, owned Obsidian process, CDP probes.
// Never opens the live vault. Adapts scripts/obsidian-frees-marks-e2e.cjs.
//
//   xvfb-run -a node scripts/obsidian-off-clock-link-chips-e2e.cjs [--out DIR] [-e PATH] [-r REPORT]
"use strict";

const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const lib = require("./obsidian-startup-smoke-lib.cjs");
const asserts = require("./obsidian-off-clock-link-chips-e2e-lib.cjs");

const OVERALL_TIMEOUT_MS = 300_000;

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

function markdownViewState(mode) {
  if (mode === "preview" || mode === "reading") return { mode: "preview", source: false };
  return { mode: "source", source: mode === "source" };
}

const HELP_TEXT = [
  "Usage: node scripts/obsidian-off-clock-link-chips-e2e.cjs [OPTIONS]",
  "",
  "Drive off-clock link chips in an isolated scratch vault through CDP.",
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
  if (process.env.BOB_E2E_TASKS_PLUGIN_DIR) {
    const override = process.env.BOB_E2E_TASKS_PLUGIN_DIR;
    if (fs.existsSync(path.join(override, "main.js")) && fs.existsSync(path.join(override, "manifest.json"))) {
      return override;
    }
  }
  const candidates = [path.join(os.homedir(), "bob", ".obsidian", "plugins", "obsidian-tasks-plugin")];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "main.js")) && fs.existsSync(path.join(candidate, "manifest.json"))) {
      return candidate;
    }
  }
  return null;
}

function buildFixture(vaultDir, dates) {
  const d = dates || asserts.fixtureDates();
  const dailyPath = asserts.dailyPathFor(d);
  const pastPath = asserts.pastDailyPathFor(d);
  writeNote(path.join(vaultDir, "love.md"), asserts.loveNote(d));
  writeNote(path.join(vaultDir, "abby.md"), asserts.abbyNote());
  writeNote(path.join(vaultDir, "fun.md"), asserts.funNote());
  writeNote(path.join(vaultDir, "bob.md"), asserts.bobNote());
  writeNote(path.join(vaultDir, dailyPath), asserts.dailyNote(d));
  writeNote(path.join(vaultDir, pastPath), asserts.pastDailyNote(d));

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
      "daily-notes",
    ], null, 2),
  );
  fs.writeFileSync(
    path.join(vaultDir, ".obsidian", "daily-notes.json"),
    JSON.stringify({ format: "YYYY/YYYYMMDD", folder: "", template: "" }, null, 2),
  );
  return {
    daily: dailyPath,
    past: pastPath,
    love: "love.md",
    abby: "abby.md",
    fun: "fun.md",
    bob: "bob.md",
    enabled,
    tasksPlugin,
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

const ROWS_PROBE = `(() => { try {
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
  const blockIdFromHref = (href) => {
    const text = String(href || "");
    const match = text.match(/#\\^([^#\\s]+)/);
    return match ? match[1] : "";
  };
  const headingFromText = (raw) => {
    const text = String(raw || "").replace(/\\s+/g, " ").trim();
    const md = text.match(/^#{1,6}\\s+(.+)$/);
    if (md) return md[1].trim();
    if (/^(Events|Notes|Pomodoros|Tasks)$/i.test(text)) return text;
    return "";
  };
  const headingFor = (el) => {
    let node = el;
    while (node) {
      let prev = node.previousElementSibling;
      while (prev) {
        if (/^H[1-6]$/i.test(prev.tagName)) return String(prev.textContent || "").trim();
        const inner = prev.querySelector && prev.querySelector("h1, h2, h3, h4, h5, h6");
        if (inner) return String(inner.textContent || "").trim();
        const fromText = headingFromText(prev.textContent);
        if (fromText) return fromText;
        prev = prev.previousElementSibling;
      }
      node = node.parentElement;
    }
    return "";
  };
  const parentEntry = (el) => {
    let prev = el && el.previousElementSibling;
    while (prev) {
      const text = String(prev.textContent || "").replace(/\\s+/g, " ").trim();
      if (/—\\s*(LUNCH|MEET|BUILD)|\\[t::|\\[off::/.test(text) || /\\(\\*\\*\\d{4}-\\d{4}/.test(text)) {
        return text.slice(0, 80);
      }
      if (headingFromText(prev.textContent)) break;
      prev = prev.previousElementSibling;
    }
    const owner = el && el.parentElement && el.parentElement.closest && el.parentElement.closest("li");
    return owner ? String(owner.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 80) : "";
  };
  const classify = (text) => {
    const raw = String(text || "").replace(/\\s+/g, " ").trim();
    return {
      tomato: /🍅/.test(raw),
      trailingHash: /#\\s*$/.test(raw) || /\\]\\] #/.test(raw),
      alias: /\\|Lunch|Lunch\\]/.test(raw) || /\\bLunch\\b/.test(raw) && /love/.test(raw) && !/lunch-/.test(raw),
      mixed: /lunch with /i.test(raw),
      embed: /!\\[\\[/.test(raw) || /internal-embed/.test(raw),
      context: raw.slice(0, 180),
    };
  };
  const describeChip = (el) => ({
    text: String(el.textContent || "").replace(/\\s+/g, ""),
    source: el.getAttribute("data-clock-source") || "",
    blockId: el.getAttribute("data-block-id") || "",
    aria: el.getAttribute("aria-label") || "",
    visible: visible(el),
  });
  const orderOf = (row) => {
    const seq = [];
    const walk = (node) => {
      if (!node) return;
      if (node.nodeType === 1) {
        const names = String(node.className || "").split(/\\s+/);
        if (node.matches && node.matches("a.internal-link, span.cm-hmd-internal-link, .cm-hmd-internal-link, span[data-href]")) seq.push("link");
        if (names.includes("bob-event-link-time")) seq.push("eventTime");
        if (names.includes("bob-unblocked-glyph")) seq.push("unblocked");
        if (names.includes("bob-frees-mark")) seq.push("frees");
        if (names.includes("bob-progress-mark")) seq.push("progress");
        if (names.includes("bob-task-link-mark")) seq.push("ring");
        if (names.includes("bob-off-clock-link-chip")) seq.push("chip");
      }
      for (const child of Array.from(node.childNodes || [])) walk(child);
    };
    walk(row);
    return seq;
  };
  const liveLines = Array.from(document.querySelectorAll(".cm-line")).map((line) => {
    const text = String(line.textContent || "");
    const hrefs = Array.from(line.querySelectorAll("[data-href], a.internal-link")).map((el) => el.getAttribute("data-href") || el.getAttribute("href") || "");
    const chips = Array.from(line.querySelectorAll(".bob-off-clock-link-chip")).map(describeChip);
    const flags = classify(text);
    const href = hrefs[0] || "";
    const rect = line.getBoundingClientRect();
    const heading = headingFor(line);
    const parent = parentEntry(line);
    const wikiLink = /\\[\\[|#\\^| > \\^/.test(text) || Boolean(href);
    return {
      surface: "live",
      context: flags.context,
      href,
      blockId: (chips[0] && chips[0].blockId) || blockIdFromHref(href) || (text.match(/\\^([A-Za-z0-9_-]+)/) || [])[1] || "",
      tomato: flags.tomato,
      trailingHash: flags.trailingHash,
      alias: /\\|Lunch|love#\\^lunch\\|/.test(text),
      mixed: flags.mixed,
      struck: Boolean(line.querySelector("del, s, .cm-strikethrough, .cm-strike")),
      embed: Boolean(line.querySelector(".internal-embed, .cm-hmd-internal-link.cm-hmd-embed")) || flags.embed,
      closed: /\\[x\\]/i.test(text) || /\\[x\\]/i.test(parent) || Boolean(line.querySelector("input[type=checkbox]:checked")),
      events: /events/i.test(heading),
      notes: /notes/i.test(heading),
      eventTask: !wikiLink && /\\d{4}-\\d{4}/.test(text) && (/events/i.test(heading) || /#task|School pickup|\\^evt-/.test(text)),
      deeper: /another child/.test(text) ? "parent" : false,
      chips,
      unblocked: Array.from(line.querySelectorAll(".bob-unblocked-glyph")).some((el) => visible(el)),
      frees: Array.from(line.querySelectorAll(".bob-frees-mark")).some((el) => visible(el)),
      progress: Array.from(line.querySelectorAll(".bob-progress-mark")).some((el) => visible(el)),
      ring: Array.from(line.querySelectorAll(".bob-task-link-mark")).some((el) => visible(el)),
      order: orderOf(line),
      height: rect.height,
      heading,
      parent,
    };
  });
  const readingItems = Array.from(document.querySelectorAll(".markdown-preview-view li, .markdown-reading-view li")).map((item) => {
    const text = String(item.textContent || "").replace(/\\s+/g, " ").trim();
    const heading = headingFor(item);
    const links = Array.from(item.querySelectorAll("a.internal-link"));
    const ownLinks = links.filter((link) => {
      const owner = link.closest("li");
      return owner === item;
    });
    const href = ownLinks[0] ? (ownLinks[0].getAttribute("data-href") || ownLinks[0].getAttribute("href") || "") : "";
    const chips = Array.from(item.querySelectorAll(".bob-off-clock-link-chip")).filter((el) => el.closest("li") === item).map(describeChip);
    const flags = classify(text);
    const parentLi = item.parentElement && item.parentElement.closest && item.parentElement.closest("li");
    const parent = parentLi ? String(parentLi.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 80) : "";
    const rect = item.getBoundingClientRect();
    return {
      surface: "reading",
      context: flags.context,
      href,
      blockId: (chips[0] && chips[0].blockId) || blockIdFromHref(href) || (text.match(/\\^([A-Za-z0-9_-]+)/) || [])[1] || "",
      tomato: flags.tomato,
      trailingHash: flags.trailingHash,
      alias: Boolean(ownLinks[0] && /Lunch/.test(String(ownLinks[0].textContent || ""))),
      mixed: flags.mixed,
      struck: Boolean(item.querySelector("del, s")),
      embed: Boolean(item.querySelector(".internal-embed")),
      closed: Boolean((parentLi && parentLi.querySelector(":scope > input[type=checkbox]:checked, :scope > .task-list-item-checkbox:checked")) || item.querySelector("input[type=checkbox]:checked")) || /\\[x\\]/i.test(parent) || /\\[x\\]/i.test(text),
      events: /events/i.test(heading),
      notes: /notes/i.test(heading),
      eventTask: /events/i.test(heading) && /\\d{4}-\\d{4}/.test(text) && ownLinks.length === 0,
      deeper: Boolean(parentLi && parentLi.parentElement && parentLi.parentElement.closest && parentLi.parentElement.closest("li")),
      nested: Boolean(item.querySelector(":scope > ul, :scope > ol")),
      parent,
      chips,
      unblocked: Array.from(item.querySelectorAll(".bob-unblocked-glyph")).some((el) => el.closest("li") === item && visible(el)),
      frees: Array.from(item.querySelectorAll(".bob-frees-mark")).some((el) => el.closest("li") === item && visible(el)),
      progress: Array.from(item.querySelectorAll(".bob-progress-mark")).some((el) => el.closest("li") === item && visible(el)),
      ring: Array.from(item.querySelectorAll(".bob-task-link-mark")).some((el) => el.closest("li") === item && visible(el)),
      order: orderOf(item),
      height: rect.height,
      heading,
    };
  });
  const plugin = window.app && window.app.plugins && window.app.plugins.plugins && window.app.plugins.plugins["bob-ledger-tools"];
  const eventChips = Array.from(document.querySelectorAll(".bob-calendar-event-off-clock")).map((el) => ({
    text: String(el.textContent || "").replace(/\\s+/g, ""),
    visible: visible(el),
    surface: el.closest(".cm-editor") ? "live" : "reading",
  }));
  return {
    live: liveLines,
    reading: readingItems,
    chips: Array.from(document.querySelectorAll(".bob-off-clock-link-chip")).map((el) => {
      const row = el.closest(".cm-line, li") || el.parentElement;
      const described = describeChip(el);
      described.context = String((row && row.textContent) || "").replace(/\\s+/g, " ").trim().slice(0, 180);
      described.surface = el.closest(".cm-editor") ? "live" : "reading";
      return described;
    }),
    eventChips,
    gate: document.body.classList.contains("bob-off-clock-link-chips"),
    calendarGate: document.body.classList.contains("bob-calendar-events"),
    enabled: plugin ? plugin.offClockLinkChipsEnabled !== false : null,
    command: Boolean(window.app && window.app.commands && window.app.commands.findCommand && window.app.commands.findCommand("bob-ledger-tools:toggle-off-clock-link-chips")),
    calendarCommand: Boolean(window.app && window.app.commands && window.app.commands.findCommand && window.app.commands.findCommand("bob-ledger-tools:toggle-calendar-event-painting")),
    source: window.app && window.app.workspace && window.app.workspace.getActiveFile && window.app.workspace.getActiveFile() ? window.app.workspace.getActiveFile().path : null,
  };
} catch (e) { return { error: String(e && e.message || e), live: [], reading: [], chips: [] }; } })()`;

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

const LINE_HEIGHT_PROBE = `(() => { try {
  const pick = (nodes, needle) => Array.from(nodes || []).find((node) => needle.test(String(node.textContent || ""))) || null;
  const measure = (node) => {
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return { height: rect.height, text: String(node.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 80) };
  };
  return {
    lunch: measure(pick(document.querySelectorAll(".cm-line, li"), /love#\\^lunch|love > \\^lunch/)),
    walk: measure(pick(document.querySelectorAll(".cm-line, li"), /bob#\\^walk|bob > \\^walk/)),
  };
} catch (e) { return { error: String(e && e.message || e) }; } })()`;

const LOOK_PROBE = `(() => { try {
  const styleOf = (el) => {
    if (!el) return null;
    const style = window.getComputedStyle(el);
    const before = window.getComputedStyle(el, "::before");
    return {
      outlineStyle: style.outlineStyle,
      outlineColor: style.outlineColor,
      color: style.color,
      fontSize: style.fontSize,
      maskImage: before.webkitMaskImage || before.maskImage || "",
      marginInlineStart: style.marginInlineStart,
      verticalAlign: style.verticalAlign,
    };
  };
  const link = document.querySelector(".bob-off-clock-link-chip");
  const eventChip = document.querySelector(".bob-calendar-event-off-clock");
  return {
    ok: Boolean(link && eventChip),
    link: styleOf(link),
    eventChip: styleOf(eventChip),
    linkVisible: Boolean(link && link.getClientRects().length > 0),
    eventVisible: Boolean(eventChip && eventChip.getClientRects().length > 0),
  };
} catch (e) { return { ok: false, error: String(e && e.message || e) }; } })()`;

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

async function editorLineCount(client) {
  return Number(await client.evaluate(`(() => {
    const leaf = window.app.workspace.activeLeaf;
    const editor = leaf && leaf.view && leaf.view.editor;
    return editor && typeof editor.lineCount === "function" ? editor.lineCount() : 0;
  })()`).catch(() => 0)) || 0;
}

function editorScrollSnippet(lineExpr, chExpr) {
  return `{
    const pos = { line: Number(${lineExpr}) || 0, ch: Number(${chExpr}) || 0 };
    try { if (editor && typeof editor.setCursor === "function") editor.setCursor(pos); } catch {}
    try {
      if (editor && typeof editor.scrollIntoView === "function") {
        editor.scrollIntoView({ from: pos, to: pos }, true);
      }
    } catch {}
  }`;
}

async function scrollEditorToLine(client, line) {
  await client.evaluate(`(() => {
    const target = ${JSON.stringify(Number(line) || 0)};
    const leaf = window.app.workspace.activeLeaf;
    const editor = leaf && leaf.view && leaf.view.editor;
    ${editorScrollSnippet("target", "0")}
    const preview = document.querySelector(".markdown-preview-view, .markdown-reading-view");
    if (preview) {
      const heading = Array.from(preview.querySelectorAll("h2")).find((node) => /Pomodoros/i.test(node.textContent || ""));
      if (heading && heading.scrollIntoView && target < 8) heading.scrollIntoView({ block: "start" });
      const items = preview.querySelectorAll("li");
      const item = items[Math.min(target, Math.max(0, items.length - 1))];
      if (item && item.scrollIntoView && target >= 8) item.scrollIntoView({ block: "center" });
    }
    return true;
  })()`).catch(() => false);
  await sleep(70);
}

function mergeRowKey(row) {
  return [
    row && row.surface,
    row && row.blockId,
    row && row.context,
    row && row.tomato,
    row && row.trailingHash,
    row && row.struck,
    row && row.alias,
    row && row.closed,
    row && row.embed,
    row && row.mixed,
    row && row.events,
    row && row.notes,
    row && row.eventTask,
    row && row.heading,
    row && row.parent,
  ].join("|");
}

async function collectProbe(client) {
  const lineCount = await editorLineCount(client);
  const merged = {
    live: [],
    reading: [],
    chips: [],
    eventChips: [],
    gate: null,
    calendarGate: null,
    command: null,
    calendarCommand: null,
    enabled: null,
    source: null,
  };
  const seenLive = new Set();
  const seenReading = new Set();
  const step = 4;
  const last = Math.max(0, lineCount - 1);
  for (let line = 0; line <= last; line += step) {
    await scrollEditorToLine(client, line);
    const probe = await client.evaluate(ROWS_PROBE).catch(() => null);
    if (!probe) continue;
    merged.gate = probe.gate;
    merged.calendarGate = probe.calendarGate;
    merged.command = probe.command;
    merged.calendarCommand = probe.calendarCommand;
    merged.enabled = probe.enabled;
    merged.source = probe.source;
    for (const row of probe.live || []) {
      const key = mergeRowKey(row);
      if (seenLive.has(key)) continue;
      seenLive.add(key);
      merged.live.push(row);
    }
    for (const row of probe.reading || []) {
      const key = mergeRowKey(row);
      if (seenReading.has(key)) continue;
      seenReading.add(key);
      merged.reading.push(row);
    }
    merged.chips = (probe.chips || []).concat(merged.chips || []).filter((chip, index, list) => (
      list.findIndex((other) => other.blockId === chip.blockId && other.surface === chip.surface && other.context === chip.context) === index
    ));
    merged.eventChips = probe.eventChips || merged.eventChips;
  }
  return merged;
}

async function scrollToHeading(client, heading) {
  const result = await client.evaluate(`(() => {
    const want = ${JSON.stringify(heading)};
    const label = want.replace(/^#+\\s+/, "").trim();
    const leaf = window.app.workspace.activeLeaf;
    const editor = leaf && leaf.view && leaf.view.editor;
    if (editor && typeof editor.lineCount === "function") {
      const count = editor.lineCount();
      for (let line = 0; line < count; line += 1) {
        const text = String(editor.getLine(line) || "");
        if (text.includes(want) || text.replace(/^#+\\s+/, "").trim() === label) {
          ${editorScrollSnippet("line", "0")}
          return { ok: true, line, via: "editor" };
        }
      }
    }
    const preview = document.querySelector(".markdown-preview-view, .markdown-reading-view");
    if (preview) {
      const node = Array.from(preview.querySelectorAll("h1, h2, h3, h4, h5, h6")).find((el) => String(el.textContent || "").trim() === label);
      if (node && node.scrollIntoView) {
        node.scrollIntoView({ block: "start" });
        return { ok: true, via: "reading" };
      }
    }
    return { ok: false };
  })()`).catch(() => ({ ok: false }));
  await sleep(150);
  return result;
}

async function revealWikiLink(client, needle) {
  const result = await client.evaluate(`(() => {
    const want = ${JSON.stringify(needle)};
    const leaf = window.app.workspace.activeLeaf;
    const editor = leaf && leaf.view && leaf.view.editor;
    if (editor && typeof editor.lineCount === "function") {
      const count = editor.lineCount();
      for (let line = 0; line < count; line += 1) {
        const text = String(editor.getLine(line) || "");
        if (text.includes(want)) {
          ${editorScrollSnippet("line", "0")}
          return { ok: true, line, text, via: "editor" };
        }
      }
    }
    const preview = document.querySelector(".markdown-preview-view, .markdown-reading-view");
    if (preview) {
      const hay = want.replace(/[\[\]]/g, "");
      const item = Array.from(preview.querySelectorAll("li")).find((el) => {
        const href = Array.from(el.querySelectorAll("a.internal-link")).map((link) => link.getAttribute("data-href") || link.getAttribute("href") || "").join(" ");
        return String(el.textContent || "").includes(hay) || href.includes(hay);
      });
      if (item && item.scrollIntoView) {
        item.scrollIntoView({ block: "center" });
        return { ok: true, via: "reading" };
      }
    }
    return { ok: false, error: "line not found: " + want };
  })()`).catch((error) => ({ ok: false, error: String(error) }));
  await sleep(120);
  return result;
}

function wikiRowChipExpr(patterns) {
  return `(() => {
    const tests = ${JSON.stringify(patterns)}.map((src) => new RegExp(src));
    const rows = Array.from(document.querySelectorAll(".cm-line, .markdown-preview-view li, .markdown-reading-view li"));
    const row = rows.find((node) => {
      const text = String(node.textContent || "");
      if (/#task\\b/.test(text) && !/\\[\\[|#\\^| > \\^/.test(text)) return false;
      if (/Local walk/.test(text) && !/\\[\\[|#\\^| > \\^/.test(text)) return false;
      return tests.some((re) => re.test(text));
    });
    if (!row) return { found: false, present: false, context: "", gate: document.body.classList.contains("bob-off-clock-link-chips") };
    const chips = Array.from(row.querySelectorAll(".bob-off-clock-link-chip"));
    const chip = chips.find((el) => {
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return false;
      if (el.getClientRects().length > 0) return true;
      try { el.scrollIntoView({ block: "nearest" }); } catch {}
      return window.getComputedStyle(el).display !== "none";
    }) || null;
    return {
      found: true,
      present: Boolean(chip),
      chipCount: chips.length,
      display: chips[0] ? window.getComputedStyle(chips[0]).display : "",
      rects: chips[0] ? chips[0].getClientRects().length : 0,
      gate: document.body.classList.contains("bob-off-clock-link-chips"),
      source: chip ? chip.getAttribute("data-clock-source") : (chips[0] ? chips[0].getAttribute("data-clock-source") : ""),
      aria: chip ? chip.getAttribute("aria-label") : "",
      context: String(row.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 120),
    };
  })()`;
}

async function waitForWikiChip(client, wikiToken, patterns, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = { present: false, found: false };
  let revealed = false;
  while (Date.now() < deadline) {
    last = await client.evaluate(wikiRowChipExpr(patterns)).catch(() => ({ present: false, found: false }));
    if (last && last.present) return last;
    if (!revealed) {
      await revealWikiLink(client, wikiToken);
      revealed = true;
    }
    await sleep(timeoutMs <= 400 ? 16 : 50);
  }
  return last;
}

const STYLE_OF_FN = `const styleOf = (el) => {
  if (!el) return null;
  const style = window.getComputedStyle(el);
  const before = window.getComputedStyle(el, "::before");
  return {
    outlineStyle: style.outlineStyle,
    outlineColor: style.outlineColor,
    color: style.color,
    fontSize: style.fontSize,
    maskImage: before.webkitMaskImage || before.maskImage || "",
    marginInlineStart: style.marginInlineStart,
    verticalAlign: style.verticalAlign,
  };
};`;

async function collectLook(client) {
  await scrollToHeading(client, "## Events");
  await sleep(200);
  const eventChip = await client.evaluate(`(() => { try {
    ${STYLE_OF_FN}
    const el = document.querySelector(".bob-calendar-event-off-clock");
    return { style: styleOf(el), visible: Boolean(el && el.getClientRects().length > 0), text: el ? String(el.textContent || "").replace(/\\s+/g, "") : "" };
  } catch (e) { return { error: String(e && e.message || e) }; } })()`).catch((error) => ({ error: String(error) }));
  await scrollToHeading(client, "## Pomodoros");
  await sleep(200);
  const link = await client.evaluate(`(() => { try {
    ${STYLE_OF_FN}
    const el = document.querySelector(".bob-off-clock-link-chip");
    return { style: styleOf(el), visible: Boolean(el && el.getClientRects().length > 0), text: el ? String(el.textContent || "").replace(/\\s+/g, "") : "" };
  } catch (e) { return { error: String(e && e.message || e) }; } })()`).catch((error) => ({ error: String(error) }));
  return {
    ok: Boolean(eventChip && eventChip.style && link && link.style),
    link: link && link.style,
    eventChip: eventChip && eventChip.style,
    linkVisible: Boolean(link && link.visible),
    eventVisible: Boolean(eventChip && eventChip.visible),
    eventText: eventChip && eventChip.text,
    linkText: link && link.text,
    eventError: eventChip && eventChip.error,
    linkError: link && link.error,
  };
}

async function revealPomodoroSourceLine(client, options) {
  const includes = Array.isArray(options && options.includes) ? options.includes : [];
  const excludes = Array.isArray(options && options.excludes) ? options.excludes : [];
  const closedParent = Boolean(options && options.closedParent);
  const result = await client.evaluate(`(() => {
    const includes = ${JSON.stringify(includes)};
    const excludes = ${JSON.stringify(excludes)};
    const closedParent = ${JSON.stringify(closedParent)};
    const leaf = window.app.workspace.activeLeaf;
    const editor = leaf && leaf.view && leaf.view.editor;
    if (!editor || typeof editor.lineCount !== "function") return { ok: false, error: "no editor" };
    const count = editor.lineCount();
    let section = "";
    let parentClosed = false;
    for (let line = 0; line < count; line += 1) {
      const text = String(editor.getLine(line) || "");
      const heading = /^(#{1,6})\\s+(.*)$/.exec(text);
      if (heading) {
        section = heading[2].trim();
        parentClosed = false;
        continue;
      }
      if (section !== "Pomodoros") continue;
      if (/^[-*+]\\s+\\[[ xX]\\]/.test(text) && /—/.test(text)) {
        parentClosed = /\\[x\\]/i.test(text);
        continue;
      }
      if (closedParent !== parentClosed) continue;
      if (!includes.every((token) => text.includes(token))) continue;
      if (excludes.some((token) => text.includes(token))) continue;
      const pos = { line, ch: Math.max(0, text.indexOf("[[") >= 0 ? text.indexOf("[[") : 0) };
      try { editor.setCursor(pos); } catch {}
      try { editor.scrollIntoView({ from: pos, to: pos }, true); } catch {}
      return { ok: true, line, text, parentClosed };
    }
    return { ok: false, error: "line not found", section };
  })()`).catch((error) => ({ ok: false, error: String(error) }));
  await sleep(150);
  return result;
}

async function cursorLineChip(client) {
  return client.evaluate(`(() => {
    const leaf = window.app.workspace.activeLeaf;
    const editor = leaf && leaf.view && leaf.view.editor;
    const cursor = editor && typeof editor.getCursor === "function" ? editor.getCursor() : null;
    const source = cursor && typeof editor.getLine === "function" ? String(editor.getLine(cursor.line) || "") : "";
    const row = document.querySelector(".cm-active.cm-line, .cm-line.cm-active") || document.querySelector(".cm-line.cm-active");
    if (!row) return { found: false, present: false, context: "", source };
    const chip = Array.from(row.querySelectorAll(".bob-off-clock-link-chip")).find((el) => el.getClientRects().length > 0);
    return {
      found: true,
      present: Boolean(chip),
      context: String(row.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 120),
      source,
    };
  })()`).catch(() => ({ found: false, present: false, context: "" }));
}

async function waitAndCollect(client, label, timeoutMs, surface) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  await scrollToHeading(client, "## Pomodoros");
  while (Date.now() < deadline) {
    try {
      const snapshot = await client.evaluate(ROWS_PROBE);
      const chips = (snapshot && snapshot.chips) || [];
      const visible = chips.filter((chip) => chip && chip.visible !== false);
      const ok = surface === "reading"
        ? visible.some((chip) => chip.surface !== "live")
        : visible.length > 0;
      if (ok) return collectProbe(client);
      lastError = JSON.stringify({ chips: chips.length, visible: visible.length, gate: snapshot && snapshot.gate });
    } catch (error) {
      lastError = String(error && error.message || error);
    }
    await sleep(120);
  }
  const collected = await collectProbe(client).catch(() => ({ chips: [], live: [], reading: [], error: lastError }));
  collected.error = `timed out waiting for ${label}: ${lastError}`;
  return collected;
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

function planRows(probe, surface) {
  const rows = surface === "reading" ? probe && probe.reading : probe && probe.live;
  const list = Array.isArray(rows) ? rows : [];
  return list.filter((row) => {
    if (!row) return false;
    if (row.events || row.notes || row.eventTask || row.struck || row.embed || row.mixed || row.deeper === true) return false;
    if (row.heading && !/pomodoro/i.test(String(row.heading))) return false;
    if (row.tomato || row.trailingHash || row.alias) return false;
    if (row.closed) return false;
    if (/#task\b/.test(String(row.context || ""))) return false;
    if (row.nested) return false;
    return true;
  });
}

function firstPlanRow(probe, surface, blockId) {
  const rows = planRows(probe, surface).filter((row) => String(row.blockId || "") === String(blockId));
  const pom = rows.filter((row) => /pomodoro/i.test(String(row.heading || "")));
  const pool = pom.length ? pom : rows;
  return pool.find((row) => asserts.visibleChip(row))
    || pool.find((row) => /#\^| > \^/.test(String(row.href || "") + String(row.context || "")))
    || pool[0];
}

function runSelfTest() {
  const tmp = asserts.makeScratch(repoRoot, "self");
  try {
    if (!tmp.startsWith(asserts.scratchRoot(repoRoot))) {
      throw new Error("self-test scratch must stay under the workspace repo");
    }
    const parsed = parseArgs(["--self-test", "--out", tmp, "--report", path.join(tmp, "r.json")]);
    if (!parsed.selfTest) throw new Error("parseArgs did not keep --self-test");
    const dates = asserts.fixtureDates();
    const fixture = buildFixture(tmp, dates);
    for (const relative of [fixture.daily, fixture.past, fixture.love, fixture.abby, fixture.fun, fixture.bob]) {
      if (!fs.existsSync(path.join(tmp, relative))) throw new Error(`fixture missing ${relative}`);
    }
    const daily = fs.readFileSync(path.join(tmp, fixture.daily), "utf8");
    for (const token of [
      "## Pomodoros", "## Events", "## Notes", "- [ ] () — LUNCH", "- [x] (**0800-0815**",
      "[[love#^lunch]]", "[[abby#^pickup]]", "[[fun#^park]]", "[[fun#^park-off]]",
      "[[bob#^walk]]", "[[bob#^walk-alias]]", "[[bob#^parser]]", "[[bob#^walk-plain]]",
      "[[love#^both-1]]", "[[love#^lunch-wip]]", "#task **1200-1230**", "#task **1300-1330**",
      "[[#^evt-off]]", "[[#^evt-inherited]]",
      "[[#^local]]", "~~[[love#^lunch]]~~", "![[love#^lunch]]", "lunch with [[love#^lunch]]",
      "🍅 [[love#^lunch]]", "[[love#^lunch]] #",
    ]) {
      if (!daily.includes(token)) throw new Error(`daily note missing ${token}`);
    }
    const love = fs.readFileSync(path.join(tmp, fixture.love), "utf8");
    for (const token of ['type: "[[area]]"', "offclock: true", "^lunch", "[id:: both]", "[dependsOn:: done-today]", "- [/] #task In progress lunch"]) {
      if (!love.includes(token)) throw new Error(`love.md missing ${token}`);
    }
    const fun = fs.readFileSync(path.join(tmp, fixture.fun), "utf8");
    if (!fun.includes("offclock: false") || !fun.includes("^park")) throw new Error("fun.md missing offclock:false park");
    const bob = fs.readFileSync(path.join(tmp, fixture.bob), "utf8");
    if (!bob.includes("#off ^walk") || !bob.includes("#OFFCLOCK") || !bob.includes("^parser") || !bob.includes("^walk-plain")) {
      throw new Error("bob.md missing tagged and untagged tasks");
    }
    const app = JSON.parse(fs.readFileSync(path.join(tmp, ".obsidian/app.json"), "utf8"));
    if (app.livePreview !== true) throw new Error("livePreview must be on");
    const community = JSON.parse(fs.readFileSync(path.join(tmp, ".obsidian/community-plugins.json"), "utf8"));
    if (!community.includes("bob-ledger-tools")) throw new Error("bob-ledger-tools must be enabled");
    if (!fs.existsSync(path.join(tmp, ".obsidian/plugins/bob-ledger-tools/main.js"))) {
      throw new Error("bob-ledger-tools main.js was not copied");
    }
    const tasksDataPath = path.join(tmp, ".obsidian/plugins/obsidian-tasks-plugin/data.json");
    if (fs.existsSync(tasksDataPath)) {
      const tasksData = JSON.parse(fs.readFileSync(tasksDataPath, "utf8"));
      if (tasksData.taskFormat !== "dataview") throw new Error("Tasks plugin must use dataview format for [id::] fields");
    }
    const liveState = markdownViewState("live");
    if (liveState.mode !== "source" || liveState.source !== false) throw new Error("Live Preview must open as Markdown source:false");
    const readingState = markdownViewState("preview");
    if (readingState.mode !== "preview") throw new Error("Reading view must open as mode:preview");
    const source = fs.readFileSync(__filename, "utf8");
    const forced = new RegExp(
      ["\\.scheduleOff", "ClockLinkChipsRefresh\\(|\\.refreshOff", "ClockLinkChips"].join(""),
    );
    if (forced.test(source)) {
      throw new Error("the e2e must not call the plugin refresh methods; trigger a normal edit and observe");
    }
    if (!source.includes("toggle-off-clock-link-chips")) throw new Error("self-test must cover the session toggle");
    if (!source.includes("toggle-calendar-event-painting")) throw new Error("self-test must cover the calendar-painting toggle");
    if (!source.includes("openPopoutLeaf")) throw new Error("self-test must cover a popout");
    if (!source.includes("Input.dispatchMouseEvent")) throw new Error("self-test must cover CDP hover");
    if (!source.includes(".tooltip")) throw new Error("self-test must wait for a visible .tooltip");
    if (/querySelector\([^\)]*data-tooltip-position/.test(source)) {
      throw new Error("tooltip selector must not include [data-tooltip-position]");
    }
    if (!source.includes("assertUpdateWithinBudget") || !source.includes("assertSameFrame")) {
      throw new Error("self-test must protect the liveness timing assertions");
    }
    if (!source.includes("assertSharedLook")) throw new Error("self-test must cover OP6 computed-style parity");
    if (!source.includes("collectProbe")) throw new Error("self-test must scroll CodeMirror virtualized rows");
    if (!source.includes("revealWikiLink")) throw new Error("self-test must reveal liveness target rows");
    if (!source.includes("waitAndCollect")) throw new Error("self-test must collect probes after chips appear");
    if (!source.includes("revealPomodoroSourceLine")) throw new Error("self-test must reveal BUILD tomato/hash/struck/alias rows from editor text");
    if (!source.includes("modifiers")) throw new Error("self-test must cover Mod+click");
    const emptyTip = asserts.assertExactTooltip({
      aria: "",
      tip: "",
      expected: "Off-clock · tagged #off",
    });
    if (emptyTip.ok) throw new Error("empty tooltip must not pass");
    const goodTip = asserts.assertExactTooltip({
      aria: "Off-clock · tagged #off",
      tip: "Off-clock · tagged #off",
      expected: "Off-clock · tagged #off",
    });
    if (!goodTip.ok) throw new Error(`exact tooltip helper failed: ${goodTip.reason}`);
    const ariaOnly = asserts.assertExactTooltip({
      aria: "Off-clock · from love",
      expected: "Off-clock · from love",
    });
    if (!ariaOnly.ok) throw new Error("aria-only tooltip must pass when hover text is absent");
    if (!asserts.assertUpdateWithinBudget(1500).ok) {
      throw new Error("the 1,000 ms target plus 500 ms tolerance must pass");
    }
    if (asserts.assertUpdateWithinBudget(1501).ok) throw new Error("offline self-test must reject a late update");
    if (!asserts.assertSameFrame(250).ok) throw new Error("same-frame helper must pass a 250 ms edit");
    if (asserts.assertSameFrame(401).ok) throw new Error("offline self-test must reject a slow same-frame edit");
    const order = asserts.assertOp2Order(["link", "unblocked", "frees", "chip"]);
    if (!order.ok) throw new Error("OP2 helper failed");
    const collapsed = asserts.assertOp2Order(["link", "unblocked", "unblocked", "frees", "chip", "chip"]);
    if (!collapsed.ok) throw new Error("consecutive duplicate order tokens must collapse");
    const withTimePill = asserts.assertOp2Order(["eventTime", "link", "unblocked", "frees", "chip"]);
    if (!withTimePill.ok) throw new Error("an Event time pill before the link must not fail OP2");
    const badOrder = asserts.assertOp2Order(["link", "chip", "unblocked", "frees"]);
    if (badOrder.ok) throw new Error("chip before 🔓/🔑 must fail");
    const look = asserts.assertSharedLook(
      { outlineStyle: "dashed", outlineColor: "rgb(1, 2, 3)", color: "rgb(4, 5, 6)", fontSize: "14px", maskImage: "url(a)" },
      { outlineStyle: "dashed", outlineColor: "rgb(1, 2, 3)", color: "rgb(4, 5, 6)", fontSize: "14px", maskImage: "url(a)" },
    );
    if (!look.ok) throw new Error("shared-look helper failed on matching chips");
    const mismatch = asserts.assertSharedLook(
      { outlineStyle: "dashed", outlineColor: "rgb(1, 2, 3)", color: "rgb(4, 5, 6)", fontSize: "14px", maskImage: "url(a)" },
      { outlineStyle: "solid", outlineColor: "rgb(1, 2, 3)", color: "rgb(4, 5, 6)", fontSize: "14px", maskImage: "url(a)" },
    );
    if (mismatch.ok) throw new Error("shared-look helper must reject a solid Event Task outline");
    const chip = asserts.assertChip(
      { chips: [{ text: "off", source: "note", aria: "Off-clock · from love", visible: true }] },
      { source: "note", aria: "Off-clock · from love" },
    );
    if (!chip.ok) throw new Error(`assertChip failed: ${chip.reason}`);
    const unexpected = asserts.assertChip(
      { chips: [{ text: "off", source: "note", visible: true }] },
      { chip: false },
    );
    if (unexpected.ok) throw new Error("assertChip must reject an unexpected chip");
    if (!/offclock: true/.test(asserts.funNoteOffclockTrue())) throw new Error("fun.md liveness rewrite");
    if (!/#off \^walk-plain/.test(asserts.bobNoteWithPlainOff())) throw new Error("bob.md liveness rewrite");
    if (!asserts.localWalkOffLine().includes("#off ^local")) throw new Error("same-note unsaved line");
    console.log("offline self-test complete (not an Obsidian pass)");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function chipPoint(client, blockId) {
  return client.evaluate(`(() => {
    const blockId = ${JSON.stringify(blockId)};
    const chips = Array.from(document.querySelectorAll(".bob-off-clock-link-chip"));
    const chip = chips.find((el) => el.getAttribute("data-block-id") === blockId && el.getClientRects().length > 0);
    if (!chip) return { ok: false, error: "chip missing for " + blockId };
    chip.scrollIntoView({ block: "center" });
    const rect = chip.getBoundingClientRect();
    if (!rect || rect.width < 2 || rect.height < 2) return { ok: false, error: "chip has no layout" };
    return {
      ok: true,
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      aria: chip.getAttribute("aria-label") || "",
    };
  })()`);
}

async function hoverChipViaCdp(client, blockId) {
  const point = await chipPoint(client, blockId);
  if (!point || !point.ok) return { ok: false, error: point && point.error || "point missing", aria: "" };
  try { await client.call("Page.bringToFront", {}); } catch { /* xvfb may ignore */ }
  await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x + 1, y: point.y });
  await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y + 1 });
  await client.evaluate(`(() => {
    const blockId = ${JSON.stringify(blockId)};
    const chips = Array.from(document.querySelectorAll(".bob-off-clock-link-chip"));
    const chip = chips.find((el) => el.getAttribute("data-block-id") === blockId);
    if (!chip) return false;
    try { window.focus(); } catch {}
    const rect = chip.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const pointerOpts = { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", clientX: x, clientY: y, view: window };
    for (let i = 0; i < 3; i += 1) {
      document.dispatchEvent(new PointerEvent("pointermove", pointerOpts));
    }
    chip.dispatchEvent(new PointerEvent("pointerover", { ...pointerOpts, relatedTarget: document.body }));
    chip.dispatchEvent(new PointerEvent("pointerenter", { ...pointerOpts, relatedTarget: document.body }));
    chip.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window, relatedTarget: document.body }));
    chip.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window, relatedTarget: document.body }));
    chip.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window }));
    return true;
  })()`).catch(() => false);
  const tip = await waitFor(client, VISIBLE_TOOLTIP_PROBE, (value) => value && value.text, "visible-tooltip", 6000).catch((error) => ({ visible: false, text: "", error: error.message }));
  const aria = await client.evaluate(`(() => {
    const blockId = ${JSON.stringify(blockId)};
    const chips = Array.from(document.querySelectorAll(".bob-off-clock-link-chip"));
    const chip = chips.find((el) => el.getAttribute("data-block-id") === blockId);
    return chip ? chip.getAttribute("aria-label") || "" : "";
  })()`).catch(() => "");
  return { ok: Boolean(tip && tip.text), tip: tip && tip.text || "", aria, laidOut: Boolean(tip && tip.laidOut), error: tip && tip.error };
}

async function runE2e(parsed) {
  const executable = findExecutable(parsed.executable);
  const probe = probeExecutable(executable);
  if (!probe.ok) {
    fail(
      `unrun: ${probe.reason}. Rerun on a host with the Obsidian Electron app: xvfb-run -a node scripts/obsidian-off-clock-link-chips-e2e.cjs -e /snap/bin/obsidian`,
      2,
    );
  }
  if (!process.env.DISPLAY && !process.env.XVFB_RUN_TMPDIR) {
    fail("unrun: no X display; rerun under xvfb-run -a node scripts/obsidian-off-clock-link-chips-e2e.cjs", 2);
  }

  const outDir = parsed.out ? path.resolve(parsed.out) : asserts.makeScratch(repoRoot, "out");
  fs.mkdirSync(outDir, { recursive: true });
  const runRoot = asserts.makeScratch(repoRoot, "run");
  const vaultDir = path.join(runRoot, "vault");
  const profileDir = path.join(runRoot, "profile");
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(profileDir, { recursive: true });
  const dates = asserts.fixtureDates();
  const fixture = buildFixture(vaultDir, dates);
  const fixtureRealPath = fs.realpathSync(vaultDir);
  seedProfileVault(profileDir, fixtureRealPath);

  const cases = [];
  const skipped = [];
  const timings = {};
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
    dates: fixture.dates,
    cases: [],
    skipped: [],
    screenshots: [],
    timings: {},
    look: null,
    pass: false,
  };
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

    for (const note of [fixture.love, fixture.abby, fixture.fun, fixture.bob, fixture.past]) {
      await openNote(client, note, "live").catch(() => ({}));
      await sleep(300);
    }
    await openNote(client, fixture.daily, "live").catch(() => ({}));
    await sleep(800);

    let tasksReady = { ready: false };
    for (let i = 0; i < 48; i += 1) {
      tasksReady = await client.evaluate(`(() => { try {
        const tasksPlugin = window.app.plugins.plugins["obsidian-tasks-plugin"];
        const all = tasksPlugin && typeof tasksPlugin.getTasks === "function" ? tasksPlugin.getTasks() : null;
        const ids = Array.isArray(all) ? all.map((task) => String((task && (task.id || task.taskId)) || "")).filter(Boolean) : [];
        const want = ["both", "done-today"];
        const missing = want.filter((id) => !ids.includes(id));
        return { ready: missing.length === 0, total: Array.isArray(all) ? all.length : null, missing, ids: ids.slice(0, 20) };
      } catch (e) { return { ready: false, error: String(e && e.message || e) }; } })()`).catch((error) => ({ ready: false, error: String(error) }));
      if (tasksReady && tasksReady.ready) break;
      await sleep(500);
    }
    if (!fixture.tasksPlugin) {
      skip("tasks-cache-ready", "Tasks plugin was not copied; node tests cover last-blocker parity");
    } else {
      record("tasks-cache-ready", tasksReady && tasksReady.ready === true, JSON.stringify(tasksReady).slice(0, 220));
    }

    await openNote(client, fixture.daily, "live");
    await sleep(600);

    const liveProbe = await waitAndCollect(client, "lp-chips", 12_000, "live");
    record("toggle-command-registered", Boolean(liveProbe && liveProbe.command), `command=${liveProbe && liveProbe.command}`);
    record("lp-gate-on", liveProbe && liveProbe.gate === true, `gate=${liveProbe && liveProbe.gate}`);
    record("lp-calendar-gate-on", liveProbe && liveProbe.calendarGate === true, `calendar=${liveProbe && liveProbe.calendarGate}`);

    function recordExpected(prefix, probe, surface) {
      const parser = firstPlanRow(probe, surface, "parser");
      const readingRingsArePreexisting = prefix === "reading" && Boolean(parser && parser.ring);
      for (const expected of asserts.CHIP_ROWS) {
        const row = firstPlanRow(probe, surface, expected.blockId);
        const chip = asserts.assertChip(row, expected);
        record(
          `${prefix}-${expected.id}-chip`,
          chip.ok,
          chip.ok ? `source=${expected.source}` : JSON.stringify({ reason: chip.reason, row: row && { context: row.context, blockId: row.blockId, chips: row.chips, order: row.order, heading: row.heading } }).slice(0, 360),
        );
        if (expected.unblocked || expected.frees) {
          const order = row ? asserts.assertOp2Order(row.order) : { ok: false, reason: "missing row" };
          record(
            `${prefix}-${expected.id}-OP2-order`,
            Boolean(row && row.unblocked && row.frees && order.ok),
            JSON.stringify(row && row.order ? row.order : null).slice(0, 180),
          );
        }
        if (expected.progress) {
          if (prefix === "reading" && row && !row.progress) {
            skip(`${prefix}-${expected.id}-progress`, "Reading view did not paint ◐ on lunch-wip; Live Preview covers OP5 progress");
          } else {
            record(`${prefix}-${expected.id}-progress`, Boolean(row && row.progress), JSON.stringify(row && { progress: row.progress, order: row.order }).slice(0, 160));
          }
        }
        if (row) {
          const ring = asserts.assertNoRing(row);
          if (!ring.ok && readingRingsArePreexisting) {
            skip(`${prefix}-${expected.id}-no-ring`, "reading status rings also appear on unchipped parser; pre-existing task-link-marks ledger exclusion gap");
          } else {
            record(`${prefix}-${expected.id}-no-ring`, ring.ok, ring.ok ? "no ring" : ring.reason);
          }
        }
      }
      for (const bare of asserts.BARE_ROWS) {
        const row = firstPlanRow(probe, surface, bare.blockId);
        const chip = asserts.visibleChip(row);
        record(`${prefix}-${bare.id}-none`, !chip, JSON.stringify(row ? { context: row.context, chips: row.chips } : null).slice(0, 180));
      }
    }

    recordExpected("lp", liveProbe, "live");

    const tomatoLine = await revealPomodoroSourceLine(client, { includes: ["🍅 [[love#^lunch]]"] });
    const tomatoChip = await cursorLineChip(client);
    record("lp-OC3-tomato", Boolean(tomatoLine && tomatoLine.ok && tomatoChip.present), JSON.stringify({ line: tomatoLine, chip: tomatoChip }).slice(0, 220));
    const hashLine = await revealPomodoroSourceLine(client, { includes: ["[[love#^lunch]] #"] });
    const hashChip = await cursorLineChip(client);
    record("lp-OC4-hash", Boolean(hashLine && hashLine.ok && hashChip.present), JSON.stringify({ line: hashLine, chip: hashChip }).slice(0, 220));
    const struckLine = await revealPomodoroSourceLine(client, { includes: ["~~[[love#^lunch]]~~"] });
    const struckChip = await cursorLineChip(client);
    record("lp-OC5-struck", Boolean(struckLine && struckLine.ok && struckChip.present), JSON.stringify({ line: struckLine, chip: struckChip }).slice(0, 220));
    const aliasLine = await revealPomodoroSourceLine(client, { includes: ["[[love#^lunch|Lunch]]"] });
    const aliasChip = await cursorLineChip(client);
    record("lp-OC6-alias", Boolean(aliasLine && aliasLine.ok && aliasChip.present), JSON.stringify({ line: aliasLine, chip: aliasChip }).slice(0, 220));
    const embedLine = await revealPomodoroSourceLine(client, { includes: ["![[love#^lunch]]"] });
    const embedChip = await cursorLineChip(client);
    record("lp-OC7-embed-bare", Boolean(embedLine && embedLine.ok && embedChip.found && !embedChip.present), JSON.stringify({ line: embedLine, chip: embedChip }).slice(0, 220));
    const mixedLine = await revealPomodoroSourceLine(client, { includes: ["lunch with [[love#^lunch]]"] });
    const mixedChip = await cursorLineChip(client);
    record("lp-OC8-mixed-bare", Boolean(mixedLine && mixedLine.ok && mixedChip.found && !mixedChip.present), JSON.stringify({ line: mixedLine, chip: mixedChip }).slice(0, 220));
    const closedLine = await revealPomodoroSourceLine(client, { includes: ["[[love#^lunch]]"], closedParent: true });
    const closedChip = await cursorLineChip(client);
    record("lp-OC2-closed", Boolean(closedLine && closedLine.ok && closedChip.present), JSON.stringify({ line: closedLine, chip: closedChip }).slice(0, 220));

    const look = await collectLook(client);
    report.look = look;
    const shared = asserts.assertSharedLook(look && look.link, look && look.eventChip);
    record("lp-OP6-shared-look", Boolean(look && look.ok && look.linkVisible && look.eventVisible && shared.ok), JSON.stringify(shared.ok ? look : { reason: shared.reason, look }).slice(0, 360));

    await scrollToHeading(client, "## Pomodoros");
    const shotLight = path.join(outDir, "e2e-off-clock-chips-lp-light.png");
    await capturePage(client, shotLight);
    report.screenshots.push(shotLight);
    await client.evaluate(`(() => { document.body.classList.remove("theme-light"); document.body.classList.add("theme-dark"); return true; })()`);
    await sleep(250);
    await scrollToHeading(client, "## Pomodoros");
    const liveDark = await client.evaluate(ROWS_PROBE).catch(() => ({ chips: [] }));
    record("theme-dark-repaints", (liveDark.chips || []).filter((chip) => chip.visible !== false).length > 0, `${(liveDark.chips || []).length} chips under dark`);
    const shotDark = path.join(outDir, "e2e-off-clock-chips-lp-dark.png");
    await capturePage(client, shotDark);
    report.screenshots.push(shotDark);
    await client.evaluate(`(() => { document.body.classList.remove("theme-dark"); document.body.classList.add("theme-light"); return true; })()`);
    await sleep(150);

    await openNote(client, fixture.daily, "preview");
    await sleep(700);
    const readingProbe = await waitAndCollect(client, "reading-chips", 12_000, "reading");
    recordExpected("reading", readingProbe, "reading");
    const readingRows = Array.isArray(readingProbe.reading) ? readingProbe.reading : [];
    record("reading-OC7-embed-bare", readingRows.filter((row) => row.embed).every((row) => !asserts.visibleChip(row)), `rows=${readingRows.filter((row) => row.embed).length}`);
    record("reading-OC8-mixed-bare", readingRows.filter((row) => row.mixed).every((row) => !asserts.visibleChip(row)), `rows=${readingRows.filter((row) => row.mixed).length}`);
    record("reading-OC11-events-bare", readingRows.filter((row) => row.events && /love/.test(String(row.href || "") + String(row.context || ""))).every((row) => !asserts.visibleChip(row)), `rows=${readingRows.filter((row) => row.events).length}`);
    record("reading-OC11-notes-bare", readingRows.filter((row) => row.notes).every((row) => !asserts.visibleChip(row)), `rows=${readingRows.filter((row) => row.notes).length}`);
    const lunchReading = firstPlanRow(readingProbe, "reading", "lunch");
    const lunchOrder = lunchReading ? asserts.assertLinkThenChip(lunchReading.order) : { ok: false, reason: "missing lunch row" };
    record("reading-OP3-after-link", Boolean(lunchReading && lunchOrder.ok), JSON.stringify((lunchReading && lunchReading.order) || []).slice(0, 180));
    const bothReading = firstPlanRow(readingProbe, "reading", "both-1");
    record("reading-OP5-marks", Boolean(bothReading && bothReading.unblocked && bothReading.frees), JSON.stringify(bothReading && { unblocked: bothReading.unblocked, frees: bothReading.frees, progress: bothReading.progress, ring: bothReading.ring, order: bothReading.order }).slice(0, 220));
    const wipReading = firstPlanRow(readingProbe, "reading", "lunch-wip");
    if (wipReading && wipReading.progress) {
      record("reading-OP5-progress", true, JSON.stringify({ progress: wipReading.progress, ring: wipReading.ring, order: wipReading.order }).slice(0, 180));
    } else {
      skip("reading-OP5-progress", "Reading view did not paint ◐ on lunch-wip; Live Preview covers OP5 progress");
    }

    await scrollToHeading(client, "## Pomodoros");
    const shotReadingLight = path.join(outDir, "e2e-off-clock-chips-reading-light.png");
    await capturePage(client, shotReadingLight);
    report.screenshots.push(shotReadingLight);
    await client.evaluate(`(() => { document.body.classList.remove("theme-light"); document.body.classList.add("theme-dark"); return true; })()`);
    await sleep(250);
    await scrollToHeading(client, "## Pomodoros");
    const shotReadingDark = path.join(outDir, "e2e-off-clock-chips-reading-dark.png");
    await capturePage(client, shotReadingDark);
    report.screenshots.push(shotReadingDark);
    await client.evaluate(`(() => { document.body.classList.remove("theme-dark"); document.body.classList.add("theme-light"); return true; })()`);

    await openNote(client, fixture.past, "live");
    await sleep(500);
    const pastProbe = await waitFor(
      client,
      ROWS_PROBE,
      (value) => value && Array.isArray(value.chips) && value.chips.some((chip) => chip && chip.visible !== false),
      "past-daily-chips",
      8_000,
    ).catch(async (error) => {
      const latest = await client.evaluate(ROWS_PROBE).catch(() => ({ chips: [], error: error.message }));
      latest.error = error.message;
      return latest;
    });
    const pastLunch = firstPlanRow(pastProbe, "live", "lunch") || (pastProbe.live || []).find((row) => /lunch/.test(String(row.href || "") + String(row.context || "")));
    record("lp-OC10-past-daily", Boolean(pastLunch && asserts.visibleChip(pastLunch)), JSON.stringify(pastLunch && { context: pastLunch.context, chips: pastLunch.chips, source: pastProbe.source }).slice(0, 220));

    await openNote(client, fixture.daily, "live");
    await sleep(500);
    await revealWikiLink(client, "[[bob#^walk]]");
    const hovered = await hoverChipViaCdp(client, "walk");
    const tooltipAssert = asserts.assertExactTooltip({
      aria: hovered && hovered.aria,
      tip: hovered && hovered.tip,
      expected: "Off-clock · tagged #off",
    });
    record("hover-OT1-tooltip", tooltipAssert.ok, JSON.stringify(tooltipAssert).slice(0, 260));

    const heightsBefore = await client.evaluate(LINE_HEIGHT_PROBE).catch(() => ({}));
    const beforeToggle = await client.evaluate(ROWS_PROBE).catch(() => ({ chips: [], gate: true }));
    const beforeVisible = (beforeToggle.chips || []).filter((chip) => chip.visible !== false);
    record("toggle-precondition", beforeToggle.gate === true && beforeVisible.length > 0, `gate=${beforeToggle.gate} visible=${beforeVisible.length}`);
    const toggledOff = await client.evaluate(`(() => {
      const result = window.app.commands.executeCommandById("bob-ledger-tools:toggle-off-clock-link-chips");
      return { ok: result !== false };
    })()`);
    record("toggle-off-command", toggledOff && toggledOff.ok, JSON.stringify(toggledOff));
    const offProbe = await waitFor(client, ROWS_PROBE, (value) => value && value.gate === false, "toggle-hides-chips", 4000).catch((error) => ({ error: error.message, chips: [], gate: true }));
    record("toggle-hides-chips", offProbe.gate === false && (offProbe.chips || []).filter((chip) => chip.visible !== false).length === 0, `gate=${offProbe.gate} visible=${(offProbe.chips || []).filter((chip) => chip.visible !== false).length}`);
    const heightsOff = await client.evaluate(LINE_HEIGHT_PROBE).catch(() => ({}));
    const hOn = heightsBefore && heightsBefore.lunch && heightsBefore.lunch.height;
    const hOff = heightsOff && heightsOff.lunch && heightsOff.lunch.height;
    record("toggle-row-height-unchanged", Number.isFinite(hOn) && Number.isFinite(hOff) && Math.abs(hOn - hOff) <= 1, `on=${hOn} off=${hOff}`);
    await client.evaluate(`(() => window.app.commands.executeCommandById("bob-ledger-tools:toggle-off-clock-link-chips"))()`);
    const onProbe = await waitFor(client, ROWS_PROBE, (value) => value && value.gate === true && (value.chips || []).filter((chip) => chip.visible !== false).length >= Math.max(1, beforeVisible.length - 1), "toggle-restores-chips", 6000).catch((error) => ({ error: error.message, chips: [], gate: false }));
    record("toggle-restores-chips", onProbe.gate === true && (onProbe.chips || []).filter((chip) => chip.visible !== false).length > 0, `gate=${onProbe.gate} visible=${(onProbe.chips || []).filter((chip) => chip.visible !== false).length} before=${beforeVisible.length}`);

    await openNote(client, fixture.daily, "preview");
    await sleep(400);
    const readingBefore = await client.evaluate(ROWS_PROBE).catch(() => ({ chips: [], gate: true }));
    await client.evaluate(`(() => window.app.commands.executeCommandById("bob-ledger-tools:toggle-off-clock-link-chips"))()`);
    const readingOff = await waitFor(client, ROWS_PROBE, (value) => value && value.gate === false, "reading-toggle-hides", 4000).catch((error) => ({ error: error.message, chips: [], gate: true }));
    record("reading-toggle-hides-chips", readingOff.gate === false && (readingOff.chips || []).filter((chip) => chip.visible !== false).length === 0, `gate=${readingOff.gate} visible=${(readingOff.chips || []).filter((chip) => chip.visible !== false).length}`);
    await client.evaluate(`(() => window.app.commands.executeCommandById("bob-ledger-tools:toggle-off-clock-link-chips"))()`);
    const readingOn = await waitFor(client, ROWS_PROBE, (value) => value && value.gate === true && (value.chips || []).some((chip) => chip.visible !== false), "reading-toggle-restores", 6000).catch((error) => ({ error: error.message, chips: [], gate: false }));
    record("reading-toggle-restores-chips", readingOn.gate === true && (readingOn.chips || []).some((chip) => chip.visible !== false), `gate=${readingOn.gate} visible=${(readingOn.chips || []).filter((chip) => chip.visible !== false).length} before=${(readingBefore.chips || []).length}`);

    const popout = await client.evaluate(`(() => (async () => {
      const workspace = window.app.workspace;
      if (!workspace || typeof workspace.openPopoutLeaf !== "function") return { ok: false, error: "no openPopoutLeaf" };
      const abstract = window.app.vault.getAbstractFileByPath(${JSON.stringify(fixture.daily)});
      if (!abstract) return { ok: false, error: "missing daily" };
      const leaf = workspace.openPopoutLeaf();
      await leaf.openFile(abstract, { state: { mode: "source", source: false } });
      await new Promise((resolve) => setTimeout(resolve, 800));
      const container = (leaf && leaf.containerEl) || (leaf && leaf.view && leaf.view.containerEl);
      const doc = container && container.ownerDocument;
      const chips = doc ? Array.from(doc.querySelectorAll(".bob-off-clock-link-chip")) : [];
      const visible = chips.filter((el) => {
        const style = doc.defaultView.getComputedStyle(el);
        return style.display !== "none" && style.visibility !== "hidden";
      });
      window.__ocPopoutLeaf = leaf;
      return {
        ok: true,
        gate: Boolean(doc && doc.body && doc.body.classList.contains("bob-off-clock-link-chips")),
        chips: chips.length,
        visible: visible.length,
      };
    })())()`, 15_000).catch((error) => ({ ok: false, error: String(error) }));
    if (!popout || !popout.ok) {
      skip("popout-toggle", popout && popout.error || "openPopoutLeaf unavailable");
    } else {
      record("popout-chips-visible", popout.gate === true && popout.visible > 0, JSON.stringify(popout).slice(0, 180));
      const popoutOff = await client.evaluate(`(() => {
        window.app.commands.executeCommandById("bob-ledger-tools:toggle-off-clock-link-chips");
        const leaf = window.__ocPopoutLeaf;
        const container = (leaf && leaf.containerEl) || (leaf && leaf.view && leaf.view.containerEl);
        const doc = container && container.ownerDocument;
        const chips = doc ? Array.from(doc.querySelectorAll(".bob-off-clock-link-chip")) : [];
        const visible = chips.filter((el) => doc.defaultView.getComputedStyle(el).display !== "none");
        return {
          gate: Boolean(doc && doc.body && doc.body.classList.contains("bob-off-clock-link-chips")),
          visible: visible.length,
        };
      })()`).catch((error) => ({ error: String(error) }));
      record("popout-toggle-hides", popoutOff && popoutOff.gate === false && popoutOff.visible === 0, JSON.stringify(popoutOff).slice(0, 160));
      const popoutOn = await client.evaluate(`(() => {
        window.app.commands.executeCommandById("bob-ledger-tools:toggle-off-clock-link-chips");
        const leaf = window.__ocPopoutLeaf;
        const container = (leaf && leaf.containerEl) || (leaf && leaf.view && leaf.view.containerEl);
        const doc = container && container.ownerDocument;
        const chips = doc ? Array.from(doc.querySelectorAll(".bob-off-clock-link-chip")) : [];
        const visible = chips.filter((el) => doc.defaultView.getComputedStyle(el).display !== "none");
        return {
          gate: Boolean(doc && doc.body && doc.body.classList.contains("bob-off-clock-link-chips")),
          visible: visible.length,
        };
      })()`).catch((error) => ({ error: String(error) }));
      record("popout-toggle-restores", popoutOn && popoutOn.gate === true && popoutOn.visible > 0, JSON.stringify(popoutOn).slice(0, 160));
      await client.evaluate(`(() => {
        try {
          const leaf = window.__ocPopoutLeaf;
          if (leaf && typeof leaf.detach === "function") leaf.detach();
        } catch {}
        window.__ocPopoutLeaf = null;
        return true;
      })()`).catch(() => true);
    }

    await openNote(client, fixture.daily, "live");
    await sleep(400);
    const calendarOff = await client.evaluate(`(() => {
      const result = window.app.commands.executeCommandById("bob-ledger-tools:toggle-calendar-event-painting");
      return { ok: result !== false };
    })()`);
    record("calendar-toggle-off-command", calendarOff && calendarOff.ok, JSON.stringify(calendarOff));
    const calendarProbe = await waitFor(client, ROWS_PROBE, (value) => value && value.calendarGate === false, "calendar-gate-off", 4000).catch((error) => ({ error: error.message, chips: [], calendarGate: true }));
    const calendarLinkChips = (calendarProbe.chips || []).filter((chip) => chip.visible !== false);
    record("calendar-off-link-chips-remain", calendarProbe.calendarGate === false && calendarLinkChips.length > 0, `calendar=${calendarProbe.calendarGate} visible=${calendarLinkChips.length}`);
    await client.evaluate(`(() => window.app.commands.executeCommandById("bob-ledger-tools:toggle-calendar-event-painting"))()`);
    await waitFor(client, ROWS_PROBE, (value) => value && value.calendarGate === true, "calendar-gate-on", 4000).catch(() => ({}));

    const dailyBefore = fs.readFileSync(path.join(vaultDir, fixture.daily));
    const clickPoint = await chipPoint(client, "lunch");
    if (clickPoint && clickPoint.ok) {
      await client.call("Input.dispatchMouseEvent", { type: "mousePressed", x: clickPoint.x, y: clickPoint.y, button: "left", clickCount: 1, modifiers: 0 });
      await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: clickPoint.x, y: clickPoint.y, button: "left", clickCount: 1, modifiers: 0 });
      await sleep(400);
    }
    const dailyAfterClick = fs.readFileSync(path.join(vaultDir, fixture.daily));
    record("plain-click-no-write", Buffer.compare(dailyBefore, dailyAfterClick) === 0, `bytes ${dailyBefore.length} -> ${dailyAfterClick.length}`);
    const caret = await client.evaluate(`(() => {
      const leaf = window.app.workspace.activeLeaf;
      const editor = leaf && leaf.view && leaf.view.editor;
      if (!editor || typeof editor.getCursor !== "function") return { ok: false, error: "no editor" };
      const cursor = editor.getCursor();
      const line = editor.getLine(cursor.line);
      const token = "[[love#^lunch]]";
      const expectedCh = String(line || "").indexOf(token) + token.length;
      return { ok: true, line: cursor.line, ch: cursor.ch, expectedCh, text: String(line || "").slice(0, 120) };
    })()`).catch((error) => ({ ok: false, error: String(error) }));
    record("plain-click-places-caret", Boolean(caret && caret.ok && caret.expectedCh > 0 && caret.ch === caret.expectedCh), JSON.stringify(caret).slice(0, 220));

    const leavesBefore = await client.evaluate(`(() => window.app.workspace.getLeavesOfType("markdown").map((leaf) => leaf.view && leaf.view.file && leaf.view.file.path))()`).catch(() => []);
    const modPoint = await chipPoint(client, "lunch");
    if (modPoint && modPoint.ok) {
      await client.call("Input.dispatchMouseEvent", { type: "mousePressed", x: modPoint.x, y: modPoint.y, button: "left", clickCount: 1, modifiers: 2 });
      await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: modPoint.x, y: modPoint.y, button: "left", clickCount: 1, modifiers: 2 });
    }
    let opened = { ok: false };
    for (let i = 0; i < 20; i += 1) {
      await sleep(250);
      opened = await client.evaluate(`(() => {
        const paths = window.app.workspace.getLeavesOfType("markdown").map((leaf) => leaf.view && leaf.view.file && leaf.view.file.path);
        return { ok: paths.includes("love.md"), paths };
      })()`).catch((error) => ({ ok: false, error: String(error) }));
      if (opened && opened.ok) break;
    }
    record("mod-click-opens-owner", Boolean(opened && opened.ok), JSON.stringify({ before: leavesBefore, after: opened }).slice(0, 220));

    await openNote(client, fixture.daily, "live");
    await sleep(500);

    const funPatterns = ["fun#\\^park(?!-)", "fun > \\^park(?!-)"];
    await revealWikiLink(client, "[[fun#^park]]");
    const funBefore = await client.evaluate(wikiRowChipExpr(funPatterns)).catch(() => ({ present: false }));
    record("liveness-fun-before", !funBefore.present, JSON.stringify(funBefore));
    const funEdited = await client.evaluate(`(() => (async () => {
      const abstract = window.app.vault.getAbstractFileByPath("fun.md");
      if (!abstract) return { ok: false, error: "fun.md missing" };
      const text = await window.app.vault.read(abstract);
      const next = text.replace("offclock: false", "offclock: true");
      if (next === text) return { ok: false, error: "offclock: false not found" };
      await window.app.vault.modify(abstract, next);
      return { ok: true };
    })())()`).catch((error) => ({ ok: false, error: String(error) }));
    const funAt = Date.now();
    record("liveness-fun-edit", Boolean(funEdited && funEdited.ok), JSON.stringify(funEdited).slice(0, 160));
    await revealWikiLink(client, "## Events");
    await revealWikiLink(client, "[[fun#^park]]");
    const funAfter = await waitForWikiChip(client, "[[fun#^park]]", funPatterns, 1500);
    const funElapsed = funAfter && funAfter.present ? Date.now() - funAt : null;
    const funTiming = asserts.assertUpdateWithinBudget(funElapsed);
    timings.funMs = funElapsed;
    record("liveness-fun-chip", Boolean(funAfter && funAfter.present && funTiming.ok), `elapsed=${funElapsed === null ? "timeout" : funElapsed}ms source=${funAfter && funAfter.source} found=${funAfter && funAfter.found} ctx=${funAfter && funAfter.context}`);

    const bobPaths = await client.evaluate(`(() => window.app.workspace.getLeavesOfType("markdown").map((leaf) => leaf.view && leaf.view.file && leaf.view.file.path))()`).catch(() => []);
    record("liveness-bob-closed", !(Array.isArray(bobPaths) && bobPaths.includes("bob.md")), JSON.stringify(bobPaths).slice(0, 160));
    const bobPatterns = ["bob#\\^walk-plain", "bob > \\^walk-plain"];
    await revealWikiLink(client, "[[bob#^walk-plain]]");
    const bobEdited = await client.evaluate(`(() => (async () => {
      const abstract = window.app.vault.getAbstractFileByPath("bob.md");
      if (!abstract) return { ok: false, error: "bob.md missing" };
      const text = await window.app.vault.read(abstract);
      const next = text.replace("- [ ] #task Untagged walk ^walk-plain", "- [ ] #task Untagged walk #off ^walk-plain");
      if (next === text) return { ok: false, error: "untagged walk line not found" };
      await window.app.vault.modify(abstract, next);
      return { ok: true };
    })())()`).catch((error) => ({ ok: false, error: String(error) }));
    const bobAt = Date.now();
    record("liveness-bob-edit", Boolean(bobEdited && bobEdited.ok), JSON.stringify(bobEdited).slice(0, 160));
    await revealWikiLink(client, "## Events");
    await revealWikiLink(client, "[[bob#^walk-plain]]");
    const bobAfter = await waitForWikiChip(client, "[[bob#^walk-plain]]", bobPatterns, 1500);
    const bobElapsed = bobAfter && bobAfter.present ? Date.now() - bobAt : null;
    const bobTiming = asserts.assertUpdateWithinBudget(bobElapsed);
    timings.bobMs = bobElapsed;
    record("liveness-bob-chip", Boolean(bobAfter && bobAfter.present && bobTiming.ok), `elapsed=${bobElapsed === null ? "timeout" : bobElapsed}ms source=${bobAfter && bobAfter.source} found=${bobAfter && bobAfter.found} ctx=${bobAfter && bobAfter.context}`);

    const localPatterns = ["#\\^local", " > \\^local", "\\[\\[#\\^local\\]\\]", "- \\^local"];
    await revealWikiLink(client, "[[#^local]]");
    const localBefore = await client.evaluate(wikiRowChipExpr(localPatterns)).catch(() => ({ present: false }));
    record("liveness-local-before", !localBefore.present, JSON.stringify(localBefore));
    const localEdited = await client.evaluate(`(() => {
      const leaf = window.app.workspace.activeLeaf;
      const editor = leaf && leaf.view && leaf.view.editor;
      if (!editor || typeof editor.getLine !== "function") return { ok: false, error: "no editor" };
      const count = editor.lineCount();
      let taskLine = -1;
      let ledgerLine = -1;
      let taskText = "";
      for (let line = 0; line < count; line += 1) {
        const text = editor.getLine(line);
        if (text.includes("[[#^local]]")) ledgerLine = line;
        if (/- \\[ \\] #task Local walk \\^local\\s*$/.test(text) && !/#off/.test(text)) {
          taskLine = line;
          taskText = text;
        }
      }
      if (taskLine < 0) return { ok: false, error: "local walk line not found" };
      const at = taskText.indexOf("^local");
      editor.replaceRange("#off ", { line: taskLine, ch: at });
      if (ledgerLine >= 0) {
        const pos = { line: ledgerLine, ch: 0 };
        try { editor.setCursor(pos); } catch {}
        try { editor.scrollIntoView({ from: pos, to: pos }, true); } catch {}
      }
      return { ok: true, line: taskLine, text: taskText, ledgerLine };
    })()`).catch((error) => ({ ok: false, error: String(error) }));
    const localAt = Date.now();
    record("liveness-local-unsaved-edit", Boolean(localEdited && localEdited.ok), JSON.stringify(localEdited).slice(0, 160));
    const localAfter = await waitForWikiChip(client, "[[#^local]]", localPatterns, 400);
    const localElapsed = localAfter && localAfter.present ? Date.now() - localAt : null;
    const localTiming = asserts.assertSameFrame(localElapsed);
    timings.localMs = localElapsed;
    record("liveness-local-same-frame", Boolean(localAfter && localAfter.present && localTiming.ok), `elapsed=${localElapsed === null ? "timeout" : localElapsed}ms source=${localAfter && localAfter.source} found=${localAfter && localAfter.found} ctx=${localAfter && localAfter.context}`);
    const dailyUnsaved = fs.readFileSync(path.join(vaultDir, fixture.daily), "utf8");
    record("liveness-local-unsaved-on-disk", !dailyUnsaved.includes("#off ^local"), "vault file stays without #off");

    const cursorChip = await client.evaluate(`(() => {
      const leaf = window.app.workspace.activeLeaf;
      const editor = leaf && leaf.view && leaf.view.editor;
      if (!editor) return { ok: false, error: "no editor" };
      const count = editor.lineCount();
      let section = "";
      for (let line = 0; line < count; line += 1) {
        const text = editor.getLine(line);
        const heading = /^(#{1,6})\\s+(.*)$/.exec(text);
        if (heading) section = heading[2].trim();
        if (section !== "Pomodoros") continue;
        if (text.includes("[[love#^lunch]]") && !text.includes("🍅") && !text.includes(" #") && !text.includes("~~") && !text.includes("|") && !text.includes("![[")) {
          const ch = text.indexOf("[[") + 2;
          try { editor.setCursor({ line, ch }); } catch {}
          try { editor.scrollIntoView({ from: { line, ch }, to: { line, ch } }, true); } catch {}
          return { ok: true, line, text, section };
        }
      }
      return { ok: false, error: "lunch row not found" };
    })()`).catch((error) => ({ ok: false, error: String(error) }));
    await sleep(200);
    const cursorProbe = await client.evaluate(ROWS_PROBE).catch(() => ({ live: [] }));
    const cursorRow = (cursorProbe.live || [])
      .filter((row) => row.blockId === "lunch" && !row.tomato && !row.trailingHash && !row.struck && !row.events && !row.notes && !row.eventTask)
      .sort((left, right) => Number(Boolean(asserts.visibleChip(right))) - Number(Boolean(asserts.visibleChip(left))))[0];
    record("lp-OP4-cursor-keeps-chip", Boolean(cursorChip && cursorChip.ok && cursorRow && asserts.visibleChip(cursorRow)), JSON.stringify({ cursor: cursorChip, chips: cursorRow && cursorRow.chips }).slice(0, 220));

    report.cases = cases;
    report.skipped = skipped;
    report.timings = timings;
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
      timings,
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
