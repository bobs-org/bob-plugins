#!/usr/bin/env node
// Real-Obsidian e2e for ledger snooze display marks.
// Isolated scratch vault + profile, owned Obsidian process, CDP probes.
// Never opens the live vault. Adapts scripts/obsidian-frees-marks-e2e.cjs
// and scripts/obsidian-event-link-times-e2e.cjs.
//
//   xvfb-run -a node scripts/obsidian-snooze-marks-e2e.cjs [--out DIR] [-e PATH] [-r REPORT]
"use strict";

const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const lib = require("./obsidian-startup-smoke-lib.cjs");
const asserts = require("./obsidian-snooze-marks-e2e-lib.cjs");

const OVERALL_TIMEOUT_MS = 420_000;

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
  "Usage: node scripts/obsidian-snooze-marks-e2e.cjs [OPTIONS]",
  "",
  "Drive snooze display marks in an isolated scratch vault through CDP.",
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
    if (fs.existsSync(path.join(override, "main.js"))) return override;
  }
  const candidates = [path.join(os.homedir(), "bob", ".obsidian", "plugins", "obsidian-tasks-plugin")];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "main.js")) && fs.existsSync(path.join(candidate, "manifest.json"))) {
      return candidate;
    }
  }
  return null;
}

function buildFixture(vaultDir, dates, clocks) {
  const d = dates || asserts.fixtureDates();
  const c = clocks || asserts.fixtureClocks();
  const dailyPath = asserts.dailyPathFor(d);
  const pastPath = asserts.pastDailyPathFor(d);
  writeNote(path.join(vaultDir, "job.md"), asserts.jobNote());
  writeNote(path.join(vaultDir, dailyPath), asserts.dailyNote(d, c));
  writeNote(path.join(vaultDir, pastPath), asserts.yesterdayNote(d, c));
  writeNote(path.join(vaultDir, "plan.md"), asserts.planNote());

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
    job: "job.md",
    plan: "plan.md",
    enabled,
    tasksPlugin,
    dates: d,
    clocks: c,
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

// One probe for every snooze surface plus the Today tomato and Event-link-time
// regression controls. Selectors never touch [data-tooltip-position].
const SNOOZE_PROBE = `(() => { try {
  const root = document.querySelector(".workspace-leaf.mod-active") || document;
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
  const surfaceOf = (el) => (el && el.closest && el.closest(".cm-editor") ? "live" : "reading");
  const rowContext = (el) => {
    const row = (el && el.closest && (el.closest(".cm-line, li") || el.parentElement)) || null;
    return String((row && row.textContent) || "").replace(/\\s+/g, " ").trim().slice(0, 200);
  };
  const toneOf = (el, prefix) => {
    const names = String((el && el.getAttribute && el.getAttribute("class")) || "").split(/\\s+/);
    const hit = names.find((name) => name.indexOf(prefix) === 0 && name !== prefix);
    return hit ? hit.slice(prefix.length) : "";
  };
  const defMarks = Array.from(root.querySelectorAll(".bob-snooze-mark")).map((el) => {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const row = el.closest(".cm-line, li") || el.parentElement;
    const rowLineHeight = row ? parseFloat(window.getComputedStyle(row).lineHeight) : NaN;
    const after = window.getComputedStyle(el, "::after");
    const before = window.getComputedStyle(el, "::before");
    return {
      key: el.getAttribute("data-bob-snooze-key") || "",
      time: el.getAttribute("data-bob-snooze-time") || "",
      label: el.getAttribute("data-bob-snooze-label") || "",
      tone: toneOf(el, "bob-snooze-mark--"),
      aria: el.getAttribute("aria-label") || "",
      text: String(el.textContent || "").replace(/\\s+/g, " ").trim(),
      title: el.getAttribute("title") || "",
      width: rect.width,
      height: rect.height,
      fontSize: parseFloat(style.fontSize),
      rowLineHeight,
      afterContent: after.content,
      color: style.color,
      beforeMask: before.maskImage || before.webkitMaskImage,
      beforeBackground: before.backgroundColor,
      beforeForcedColorAdjust: before.forcedColorAdjust,
      visible: visible(el),
      surface: surfaceOf(el),
      context: rowContext(el),
    };
  });
  const todayMarks = Array.from(root.querySelectorAll(".bob-today-mark")).map((el) => ({
    aria: el.getAttribute("aria-label") || "",
    text: String(el.textContent || "").replace(/\\s+/g, " ").trim(),
    visible: visible(el),
    surface: surfaceOf(el),
    context: rowContext(el),
  }));
  const eventTimes = Array.from(root.querySelectorAll(".bob-event-link-time")).map((el) => ({
    text: String(el.textContent || "").replace(/\\s+/g, " ").trim(),
    visible: visible(el),
    surface: surfaceOf(el),
    context: rowContext(el),
  }));
  const woken = Array.from(root.querySelectorAll(".bob-snooze-woke")).map((el) => {
    const before = window.getComputedStyle(el, "::before");
    return {
      pill: toneOf(el, "bob-snooze-woke--"),
      text: String(el.textContent || "").replace(/\\s+/g, " ").trim(),
      aria: el.getAttribute("aria-label") || "",
      title: el.getAttribute("title") || "",
      time: el.getAttribute("data-bob-snooze-woke-time") || "",
      line: el.getAttribute("data-bob-snooze-woke-line") || "",
      beforeMask: before.maskImage || before.webkitMaskImage,
      beforeBackground: before.backgroundColor,
      beforeForcedColorAdjust: before.forcedColorAdjust,
      visible: visible(el),
      surface: surfaceOf(el),
      context: rowContext(el),
    };
  });
  const rowChips = Array.from(root.querySelectorAll(".bob-snooze-row-chip")).map((el) => ({
    text: String(el.textContent || "").replace(/\\s+/g, " ").trim(),
    paint: el.getAttribute("data-bob-snooze-row-paint") || "",
    time: el.getAttribute("data-bob-snooze-row-time") || "",
    status: el.getAttribute("data-bob-snooze-row-status") || "",
    aria: el.getAttribute("aria-label") || "",
    title: el.getAttribute("title") || "",
    visible: visible(el),
    surface: surfaceOf(el),
    context: rowContext(el),
  }));
  const readingRows = Array.from(root.querySelectorAll("li.bob-snooze-row")).map((item) => ({
    cls: String(item.getAttribute("class") || ""),
    chip: (() => { const chip = item.querySelector(":scope > .bob-snooze-row-chip"); return chip ? String(chip.textContent || "").replace(/\\s+/g, " ").trim() : ""; })(),
    text: String(item.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 220),
    visible: visible(item),
  }));
  const headingChips = Array.from(root.querySelectorAll(".bob-snooze-heading-chip")).map((el) => ({
    text: String(el.textContent || "").replace(/\\s+/g, " ").trim(),
    summary: el.getAttribute("data-bob-snooze-heading-summary") || "",
    aria: el.getAttribute("aria-label") || "",
    visible: visible(el),
    surface: surfaceOf(el),
    context: rowContext(el),
  }));
  const planChips = Array.from(root.querySelectorAll(".bob-plan-snoozed")).map((el) => {
    const glyph = el.querySelector(".bob-snooze-plan-glyph");
    const before = glyph ? window.getComputedStyle(glyph, "::before") : null;
    return {
      text: String(el.textContent || "").replace(/\\s+/g, " ").trim(),
      aria: el.getAttribute("aria-label") || "",
      title: el.getAttribute("title") || "",
      due: el.classList.contains("bob-plan-snoozed-due"),
      glyphMask: before ? before.maskImage || before.webkitMaskImage : "none",
      glyphBackground: before ? before.backgroundColor : "transparent",
      glyphForcedColorAdjust: before ? before.forcedColorAdjust : "auto",
      visible: visible(el),
    };
  });
  const plugin = window.app && window.app.plugins && window.app.plugins.plugins && window.app.plugins.plugins["bob-ledger-tools"];
  return {
    defMarks, todayMarks, eventTimes, woken, rowChips, readingRows, headingChips, planChips,
    snoozeCommand: Boolean(window.app && window.app.commands && window.app.commands.findCommand && window.app.commands.findCommand("bob-ledger-tools:toggle-snooze-marks")),
    todayCommand: Boolean(window.app && window.app.commands && window.app.commands.findCommand && window.app.commands.findCommand("bob-ledger-tools:toggle-today-marks")),
    snoozeEnabled: plugin && typeof plugin.snoozeMarksEnabledForTest === "function" ? plugin.snoozeMarksEnabledForTest() : null,
    errors: Array.isArray(window.__snErrors) ? window.__snErrors.slice(0, 10) : [],
  };
} catch (e) { return { error: String(e && e.message || e), defMarks: [], todayMarks: [], eventTimes: [], woken: [], rowChips: [], readingRows: [], headingChips: [], planChips: [] }; } })()`;

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
  const lines = Array.from(document.querySelectorAll(".cm-line"));
  const snoozed = lines.find((line) => /\\^sz-asleep/.test(String(line.textContent || "")));
  const plain = lines.find((line) => /\\^sz-ready/.test(String(line.textContent || "")));
  const measure = (node) => {
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return { height: rect.height, text: String(node.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 80) };
  };
  return { snoozed: measure(snoozed), plain: measure(plain) };
} catch (e) { return { error: String(e && e.message || e) }; } })()`;

const CACHE_PROBE = `(() => { try {
  const plugin = window.app && window.app.plugins && window.app.plugins.plugins && window.app.plugins.plugins["bob-ledger-tools"];
  if (!plugin) return { error: "no plugin" };
  const cache = plugin.snoozedCache || null;
  const wakeDisabled = plugin.snoozeWakeDisabled === true;
  let todayRank = null;
  try {
    const today = plugin.todayCache;
    const rank = today && today.rank;
    todayRank = rank instanceof Map ? Array.from(rank.keys()) : (rank && typeof rank === "object" ? Object.keys(rank) : null);
  } catch (e) { todayRank = "err"; }
  return {
    wakeDisabled,
    ready: typeof plugin.isSnoozedCacheReady === "function" ? plugin.isSnoozedCacheReady(new Date()) : null,
    date: cache && cache.date,
    nowMinutes: cache && cache.nowMinutes,
    nextWakeAt: cache && cache.nextWakeAt,
    planned: cache && cache.planned,
    blocked: cache && cache.blocked,
    rows: ((cache && cache.rows) || []).map((row) => ({
      blockId: row.blockId, state: row.state, kind: row.kind, line: row.line,
      hhmm: row.hhmm, target: row.target, wokeAt: row.wokeAt, history: Boolean(row.history),
    })),
    todayRank,
  };
} catch (e) { return { error: String(e && e.message || e) }; } })()`;

const SCROLL_SNOOZED_EXPR = `(() => {
  try {
    const leaf = window.app.workspace.activeLeaf;
    const editor = leaf && leaf.view && leaf.view.editor;
    if (editor && typeof editor.lineCount === "function" && typeof editor.getLine === "function") {
      const count = editor.lineCount();
      for (let index = 0; index < count; index += 1) {
        if (/## Snoozed/.test(editor.getLine(index))) {
          try { editor.setCursor({ line: index, ch: 0 }); } catch {}
          const scroller = document.querySelector(".workspace-leaf.mod-active .cm-scroller") || document.querySelector(".cm-scroller");
          if (scroller) {
            const line = Array.from(scroller.querySelectorAll(".cm-line")).find((node) => /## Snoozed/.test(String(node.textContent || "")));
            if (line) line.scrollIntoView({ block: "start" });
          }
          return { ok: true, mode: "live", line: index };
        }
      }
      return { ok: false, error: "no snoozed heading in editor" };
    }
    const headings = Array.from(document.querySelectorAll(".workspace-leaf.mod-active h2, .markdown-preview-view h2, .markdown-reading-view h2"));
    const heading = headings.find((node) => /Snoozed/.test(String(node.textContent || "")));
    if (heading) { heading.scrollIntoView({ block: "start" }); return { ok: true, mode: "reading" }; }
    return { ok: false, error: "no snoozed heading" };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
})()`;

function unifiedDiff(beforeText, afterText) {
  const before = String(beforeText).split("\n");
  const after = String(afterText).split("\n");
  const max = Math.max(before.length, after.length);
  const out = [];
  for (let index = 0; index < max; index += 1) {
    const left = before[index];
    const right = after[index];
    if (left === right) continue;
    if (left !== undefined) out.push(`- ${left}`);
    if (right !== undefined) out.push(`+ ${right}`);
    if (out.length > 40) { out.push("... (truncated)"); break; }
  }
  return out.join("\n");
}

const OVERFLOW_PROBE = `(() => { try {
  const doc = document.documentElement;
  return {
    scrollWidth: doc.scrollWidth,
    innerWidth: window.innerWidth,
    overflowX: doc.scrollWidth - window.innerWidth,
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

function liveDefMarks(probe) {
  return (probe && probe.defMarks || []).filter((mark) => mark.surface === "live" && mark.visible !== false);
}

function readingDefMarks(probe) {
  return (probe && probe.defMarks || []).filter((mark) => mark.surface !== "live" && mark.visible !== false);
}

function markByKey(marks, key) {
  return (Array.isArray(marks) ? marks : []).find((mark) => String(mark.key || "") === String(key));
}

function wokenByTime(woken, time) {
  return (Array.isArray(woken) ? woken : []).find((pill) => String(pill.time || pill.text || "").includes(String(time)));
}

function runSelfTest() {
  const tmp = asserts.makeScratch(repoRoot, "self");
  try {
    if (!tmp.startsWith(asserts.scratchRoot(repoRoot))) {
      throw new Error("self-test scratch must stay under the configured scratch root");
    }
    const parsed = parseArgs(["--self-test", "--out", tmp, "--report", path.join(tmp, "r.json")]);
    if (!parsed.selfTest) throw new Error("parseArgs did not keep --self-test");
    const dates = asserts.fixtureDates();
    const clocks = asserts.fixtureClocks();
    const fixture = buildFixture(tmp, dates, clocks);
    for (const relative of [fixture.daily, fixture.past, fixture.job, fixture.plan]) {
      if (!fs.existsSync(path.join(tmp, relative))) throw new Error(`fixture missing ${relative}`);
    }
    const source = fs.readFileSync(__filename, "utf8");
    const job = fs.readFileSync(path.join(tmp, fixture.job), "utf8");
    for (const token of ["^sz-asleep", "^sz-due", "^sz-blocked", "^sz-ready", "^sz-woken", "^sz-woken2", "^sz-plain", "^sz-dup", "^sz-done", "#task"]) {
      if (!job.includes(token)) throw new Error(`job note missing ${token}`);
    }
    const dupLines = job.split("\n").filter((line) => line.includes("^sz-dup"));
    if (dupLines.length !== 2) throw new Error("job note must carry exactly two ^sz-dup lines for the ambiguity control");
    const daily = fs.readFileSync(path.join(tmp, fixture.daily), "utf8");
    for (const token of ["## Events", "## Pomodoros", "## Snoozed", "— WRITE", "— MEET", "[[job#^sz-asleep]]", "[[job#^sz-woken]]", "woke", "^evt-running", "[[nope#^sz-gone]]"]) {
      if (!daily.includes(token)) throw new Error(`daily note missing ${token}`);
    }
    if (!daily.includes(`**${clocks.asleepHhmm}**`) || !daily.includes(`**${clocks.dueHhmm}**`) || !daily.includes(clocks.freshWokeHhmm.slice(0, 2) + ":" + clocks.freshWokeHhmm.slice(2))) {
      throw new Error("daily note must embed the computed fixture clocks");
    }
    if (!daily.includes(`- ~~**${clocks.dueHhmm}** [[job#^sz-woken]]~~ · woke ${asserts.fmtColonClock(clocks.freshWokeHhmm)}`)) {
      throw new Error("fresh history row must target the due clock for a deterministic late tooltip");
    }
    if (!daily.includes(`- ~~**${clocks.dueHhmm}** [[job#^sz-woken2]]~~ · woke ${asserts.fmtColonClock(clocks.settledWokeHhmm)}`)) {
      throw new Error("settled history row must target the due clock for a deterministic early tooltip");
    }
    if (!source.includes("CACHE_PROBE")) throw new Error("self-test must cover cache introspection");
    if (!source.includes("before-")) throw new Error("self-test must cover before/after byte snapshots");
    if (!source.includes("unrecognized subcommand")) throw new Error("self-test must cover the stub wake command");
    if (!source.includes("XDG_CONFIG_HOME") || !source.includes("bob_path")) {
      throw new Error("self-test must cover the stub bob config");
    }
    const past = fs.readFileSync(path.join(tmp, fixture.past), "utf8");
    if (!past.includes("## Snoozed") || !past.includes("woke")) throw new Error("yesterday note must carry neutral history");
    const plan = fs.readFileSync(path.join(tmp, fixture.plan), "utf8");
    if (!plan.includes("```bob-plan")) throw new Error("plan note must carry a bob-plan fence");
    const app = JSON.parse(fs.readFileSync(path.join(tmp, fixture.daily.split("/")[0], "..", ".obsidian", "app.json"), "utf8"));
    void app;
    const community = JSON.parse(fs.readFileSync(path.join(tmp, ".obsidian", "community-plugins.json"), "utf8"));
    if (!community.includes("bob-ledger-tools")) throw new Error("bob-ledger-tools must be enabled");
    if (!fs.existsSync(path.join(tmp, ".obsidian/plugins/bob-ledger-tools/main.js"))) {
      throw new Error("bob-ledger-tools main.js was not copied");
    }
    const liveState = markdownViewState("live");
    if (liveState.mode !== "source" || liveState.source !== false) throw new Error("Live Preview must open as Markdown source:false");
    const readingState = markdownViewState("preview");
    if (readingState.mode !== "preview") throw new Error("Reading view must open as mode:preview");
    const forced = new RegExp(
      ["\\.scheduleSnooze", "MarksRefresh\\(|\\.refreshSnooze", "MarksReadingViews\\(|\\.refreshSnooze", "RowPaint"].join(""),
    );
    if (forced.test(source)) {
      throw new Error("the e2e must not call the plugin refresh methods; trigger a normal edit and observe");
    }
    if (!source.includes("toggle-snooze-marks")) throw new Error("self-test must cover the session toggle");
    if (!source.includes("Input.dispatchMouseEvent")) throw new Error("self-test must cover CDP hover");
    if (!source.includes(".tooltip")) throw new Error("self-test must wait for a visible .tooltip");
    if (/querySelector\([^\)]*data-tooltip-position/.test(source)) {
      throw new Error("tooltip selector must not include [data-tooltip-position]");
    }
    if (!source.includes('"animationstart"') && !source.includes("reduced-motion")) {
      throw new Error("self-test must cover motion accessibility");
    }
    const goodTip = asserts.assertExactTooltip({
      aria: "Woke 18:55 (snoozed until 18:30, 25m late)",
      tip: "Woke 18:55 (snoozed until 18:30, 25m late)",
      expected: "Woke 18:55 (snoozed until 18:30, 25m late)",
    });
    if (!goodTip.ok) throw new Error(`exact tooltip helper failed: ${goodTip.reason}`);
    const emptyTip = asserts.assertExactTooltip({
      aria: "Woke 18:55 (snoozed until 18:30, 25m late)",
      tip: "",
      expected: "Woke 18:55 (snoozed until 18:30, 25m late)",
    });
    if (emptyTip.ok) throw new Error("empty tooltip must not pass");
    if (asserts.assertNoDoubleColon("Snoozed until 15:30 · in 2h 30m").ok !== true) {
      throw new Error("plain tooltip must pass the :: guard");
    }
    if (asserts.assertNoDoubleColon("a:: b").ok !== false) {
      throw new Error("offline self-test must reject :: in tooltip text");
    }
    if (asserts.fmtColonClock("1530") !== "15:30") throw new Error("colon clock helper");
    if (asserts.marksForKey([{ key: "a", visible: true }], "a").visible.length !== 1) {
      throw new Error("marksForKey helper");
    }
    if (!source.includes("case-8-linux-waker")) {
      throw new Error("self-test must cover Linux notice case 8");
    }
    if (!source.includes('notified: "none"') && !source.includes("notified: \"none\"")) {
      throw new Error("self-test must cover Notice when notified is none");
    }
    const wakerPath = path.join(repoRoot, "plugins/bob-ledger-tools/src/290b-snooze-waker.js");
    const waker = fs.readFileSync(wakerPath, "utf8");
    if (!waker.includes('["snooze", "wake", "-q", "-f", "json"]')) {
      throw new Error("waker must spawn bob snooze wake -q -f json");
    }
    if (!waker.includes('report.notified === "none"') || !waker.includes("this.snoozeWakeNotice(report)")) {
      throw new Error("waker must Notice only when notified is none");
    }
    console.log("offline self-test complete (not an Obsidian pass)");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function markPoint(client, selector, key) {
  return client.evaluate(`(() => {
    const key = ${JSON.stringify(key)};
    const root = document.querySelector(".workspace-leaf.mod-active") || document;
    const marks = Array.from(root.querySelectorAll(${JSON.stringify(selector)}));
    const mark = marks.find((el) => {
      if (el.getClientRects().length === 0) return false;
      const k = el.getAttribute("data-bob-snooze-key") || el.getAttribute("data-bob-snooze-woke-time") || "";
      return !key || k === key || String(el.textContent || "").includes(key);
    });
    if (!mark) return { ok: false, error: "mark missing" };
    mark.scrollIntoView({ block: "center" });
    const rect = mark.getBoundingClientRect();
    if (!rect || rect.width < 2 || rect.height < 2) return { ok: false, error: "mark has no layout" };
    return {
      ok: true,
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      aria: mark.getAttribute("aria-label") || "",
    };
  })()`);
}

async function hoverMarkViaCdp(client, selector, key) {
  const point = await markPoint(client, selector, key);
  if (!point || !point.ok) return { ok: false, error: point && point.error || "point missing", aria: "" };
  try { await client.call("Page.bringToFront", {}); } catch { /* xvfb may ignore */ }
  await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x + 1, y: point.y });
  await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y + 1 });
  await client.evaluate(`(() => {
    const root = document.querySelector(".workspace-leaf.mod-active") || document;
    const marks = Array.from(root.querySelectorAll(${JSON.stringify(selector)}));
    const mark = marks.find((el) => el.getClientRects().length > 0);
    if (!mark) return false;
    try { window.focus(); } catch {}
    const rect = mark.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const pointerOpts = { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", clientX: x, clientY: y, view: window };
    for (let i = 0; i < 3; i += 1) {
      document.dispatchEvent(new PointerEvent("pointermove", pointerOpts));
    }
    mark.dispatchEvent(new PointerEvent("pointerover", { ...pointerOpts, relatedTarget: document.body }));
    mark.dispatchEvent(new PointerEvent("pointerenter", { ...pointerOpts, relatedTarget: document.body }));
    mark.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window, relatedTarget: document.body }));
    mark.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window, relatedTarget: document.body }));
    mark.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window }));
    return true;
  })()`).catch(() => false);
  const tip = await waitFor(client, VISIBLE_TOOLTIP_PROBE, (value) => value && value.text, "visible-tooltip", 6000).catch((error) => ({ visible: false, text: "", error: error.message }));
  const aria = await client.evaluate(`(() => {
    const root = document.querySelector(".workspace-leaf.mod-active") || document;
    const marks = Array.from(root.querySelectorAll(${JSON.stringify(selector)}));
    const mark = marks.find((el) => el.getClientRects().length > 0);
    return mark ? mark.getAttribute("aria-label") || "" : "";
  })()`).catch(() => "");
  return { ok: Boolean(tip && tip.text), tip: tip && tip.text || "", aria, laidOut: Boolean(tip && tip.laidOut), error: tip && tip.error };
}

function colonClock(hhmm) {
  const text = String(hhmm || "");
  return `${text.slice(0, 2)}:${text.slice(2, 4)}`;
}

function clockMinutes(hhmm) {
  const text = String(hhmm || "");
  return parseInt(text.slice(0, 2), 10) * 60 + parseInt(text.slice(2, 4), 10);
}

function wokeTooltip(wokeHhmm, targetHhmm) {
  const delta = clockMinutes(wokeHhmm) - clockMinutes(targetHhmm);
  const rel = delta === 0 ? "on time" : delta > 0 ? `${delta}m late` : `${-delta}m early`;
  return `Woke ${colonClock(wokeHhmm)} (snoozed until ${colonClock(targetHhmm)}, ${rel})\nCtrl-click to open the struck row`;
}

function sha256File(filePath) {
  try {
    return require("node:crypto").createHash("sha256").update(fs.readFileSync(filePath)).digest("hex").slice(0, 16);
  } catch {
    return "missing";
  }
}

async function runE2e(parsed) {
  const executable = findExecutable(parsed.executable);
  const probe = probeExecutable(executable);
  if (!probe.ok) {
    fail(
      `unrun: ${probe.reason}. Rerun on a host with the Obsidian Electron app: xvfb-run -a node scripts/obsidian-snooze-marks-e2e.cjs -e /snap/bin/obsidian`,
      2,
    );
  }
  if (!process.env.DISPLAY && !process.env.XVFB_RUN_TMPDIR) {
    fail("unrun: no X display; rerun under xvfb-run -a node scripts/obsidian-snooze-marks-e2e.cjs", 2);
  }

  const outDir = parsed.out ? path.resolve(parsed.out) : asserts.makeScratch(repoRoot, "out");
  fs.mkdirSync(outDir, { recursive: true });
  const runRoot = asserts.makeScratch(repoRoot, "run");
  const vaultDir = path.join(runRoot, "vault");
  const profileDir = path.join(runRoot, "profile");
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(profileDir, { recursive: true });
  // Stub wake writer: the display proof must never mutate the fixture
  // vault. An unsupported `bob snooze wake` disables the waker for the run.
  const stubBin = path.join(runRoot, "bin");
  fs.mkdirSync(stubBin, { recursive: true });
  const stubBob = path.join(stubBin, "bob");
  fs.writeFileSync(stubBob, "#!/bin/sh\n# snooze-marks e2e stub: the wake writer stays out of the fixture vault.\necho \"bob: unrecognized subcommand 'snooze'\" >&2\nexit 2\n");
  fs.chmodSync(stubBob, 0o755);
  // The plugin resolves an absolute candidate bob before PATH, so point its
  // own config at the stub through a scratch XDG_CONFIG_HOME.
  const stubXdg = path.join(runRoot, "xdg");
  fs.mkdirSync(path.join(stubXdg, "bob"), { recursive: true });
  fs.writeFileSync(path.join(stubXdg, "bob", "config.yml"), `stats:\n  bob_path: ${stubBob}\n`);
  const dates = asserts.fixtureDates();
  const clocks = asserts.fixtureClocks();
  const fixture = buildFixture(vaultDir, dates, clocks);
  const fixtureRealPath = fs.realpathSync(vaultDir);
  seedProfileVault(profileDir, fixtureRealPath);
  const stable = clocks.stable === true;

  const noteFiles = [fixture.job, fixture.daily, fixture.past, fixture.plan].map((rel) => path.join(vaultDir, rel));
  const hashesBefore = noteFiles.map(sha256File).join(" ");
  for (const file of noteFiles) {
    try { fs.copyFileSync(file, path.join(outDir, `before-${path.basename(file)}`)); } catch { /* best-effort */ }
  }

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
      const stubDir = path.join(runRoot, "bin");
      const env = {
        ...process.env,
        BOB_DIR: fixtureRealPath,
        TMPDIR: os.tmpdir(),
        PATH: `${stubDir}${path.delimiter}${process.env.PATH || ""}`,
        XDG_CONFIG_HOME: path.join(runRoot, "xdg"),
      };
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
    clocks: { asleep: clocks.asleepHhmm, due: clocks.dueHhmm, freshWoke: clocks.freshWokeHhmm, settledWoke: clocks.settledWokeHhmm, stable },
    cases: [],
    skipped: [],
    screenshots: [],
    metrics: null,
    pass: false,
  };
  try {
    const target = await selectOwnedTarget(cdpPort, fixtureRealPath, () => Boolean(exitInfo));
    client = await CdpClient.connect(target.webSocketDebuggerUrl, lib.CONNECT_TIMEOUT_MS);
    await client.call("Page.enable", {}, lib.RPC_TIMEOUT_MS);
    await client.call("Runtime.enable", {}, lib.RPC_TIMEOUT_MS);
    await client.call("Input.enable", {}, lib.RPC_TIMEOUT_MS).catch(() => ({}));
    // Electron's --window-size is ignored by some Ozone headless launches;
    // establish the ordinary test viewport explicitly so screenshots, row
    // geometry, and CDP click coordinates use the intended full-size surface.
    await client.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

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

    await client.evaluate(`(() => {
      window.__snErrors = [];
      window.addEventListener("error", (event) => {
        try { window.__snErrors.push(String((event && event.message) || event)); } catch {}
      });
      return true;
    })()`);

    const expectTimes = (name) => {
      if (stable) return true;
      skip(name, "fixture clocks cross midnight; time-sensitive asserts skipped");
      return false;
    };

    // ---- job.md Live Preview: definition clocks ----
    await openNote(client, fixture.job, "live").catch(() => ({}));
    const jobProbe = await waitFor(client, SNOOZE_PROBE, (value) => value && Array.isArray(value.defMarks) && value.defMarks.filter((mark) => mark.surface === "live" && mark.visible !== false).length >= 2, "lp-def-marks", 15_000).catch(async (error) => {
      const latest = await client.evaluate(SNOOZE_PROBE).catch(() => ({ defMarks: [], error: error.message }));
      latest.error = error.message;
      return latest;
    });
    record("toggle-commands-registered", Boolean(jobProbe && jobProbe.snoozeCommand && jobProbe.todayCommand), `snooze=${Boolean(jobProbe && jobProbe.snoozeCommand)} today=${Boolean(jobProbe && jobProbe.todayCommand)}`);
    console.log(`DEFKEYS ${JSON.stringify(((jobProbe && jobProbe.defMarks) || []).map((mark) => ({ key: mark.key, tone: mark.tone, time: mark.time, visible: mark.visible, surface: mark.surface })))}`);
    const cacheState = await client.evaluate(CACHE_PROBE).catch((error) => ({ error: String(error) }));
    console.log(`CACHE ${JSON.stringify(cacheState)}`);
    report.cache = cacheState;
    record("wake-stubbed", cacheState && cacheState.wakeDisabled === true, `wakeDisabled=${cacheState && cacheState.wakeDisabled}`);
    const defs = liveDefMarks(jobProbe);
    const asleepKey = "job.md#sz-asleep";
    const asleep = markByKey(defs, asleepKey);
    if (expectTimes("lp-asleep-clock")) {
      record("lp-asleep-clock", Boolean(asleep) && asleep.tone === "asleep" && asleep.time === colonClock(clocks.asleepHhmm) && asleep.label === colonClock(clocks.asleepHhmm) && String(asleep.aria).startsWith(`Snoozed until ${colonClock(clocks.asleepHhmm)} · in `) && String(asleep.aria).endsWith("Ctrl-click to open the Snoozed row") && !/::/.test(String(asleep.aria)) && (asleep.title || "") === "", JSON.stringify(asleep).slice(0, 400));
    }
    const due = markByKey(defs, "job.md#sz-due");
    if (expectTimes("lp-due-clock")) {
      record("lp-due-clock", Boolean(due) && due.tone === "due" && due.time === colonClock(clocks.dueHhmm) && due.label === `${colonClock(clocks.dueHhmm)} · due` && /due — waking\s*\nCtrl-click/.test(String(due.aria)), JSON.stringify((due) ?? null).slice(0, 400));
    }
    const blocked = markByKey(defs, "job.md#sz-blocked");
    record("lp-blocked-clock", Boolean(blocked) && blocked.tone === "blocked" && blocked.label === colonClock(clocks.dueHhmm) && /waits on prerequisites\s*\nCtrl-click/.test(String(blocked.aria)), JSON.stringify((blocked) ?? null).slice(0, 400));
    const visibleDefs = defs.filter((mark) => mark.visible !== false);
    const singleLineWidths = visibleDefs.length >= 3 && visibleDefs.every((mark) =>
      Number.isFinite(mark.height) && Number.isFinite(mark.rowLineHeight) &&
      mark.height <= mark.rowLineHeight + 1 && mark.width > mark.fontSize * 2.5,
    );
    record("lp-clock-single-line-width", singleLineWidths, JSON.stringify(visibleDefs.map((mark) => ({ key: mark.key, width: mark.width, height: mark.height, rowLineHeight: mark.rowLineHeight, fontSize: mark.fontSize }))).slice(0, 600));
    const stateColors = new Set([asleep && asleep.color, due && due.color, blocked && blocked.color]);
    record("lp-clock-state-colors", Boolean(asleep && due && blocked) && stateColors.size === 3, JSON.stringify([asleep && asleep.color, due && due.color, blocked && blocked.color]));
    const dueContent = String(due && due.afterContent || "");
    const asleepContent = String(asleep && asleep.afterContent || "");
    const blockedContent = String(blocked && blocked.afterContent || "");
    record("lp-clock-visible-labels", Boolean(due && /· due/.test(dueContent) && asleep && !/· due/.test(asleepContent) && blocked && !/· due/.test(blockedContent)), JSON.stringify({ dueContent, asleepContent, blockedContent }));
    record("lp-clock-masked-glyphs", visibleDefs.length >= 3 && visibleDefs.every((mark) => mark.beforeMask && mark.beforeMask !== "none"), JSON.stringify(visibleDefs.map((mark) => mark.beforeMask)).slice(0, 320));
    for (const neutral of ["job.md#sz-ready", "job.md#sz-dup", "job.md#sz-done"]) {
      record(`lp-neutral-${neutral.split("#")[1]}`, !markByKey(defs, neutral), JSON.stringify(markByKey(defs, neutral) || null).slice(0, 160));
    }
    const missingMark = (jobProbe.defMarks || []).find((mark) => /sz-gone/.test(String(mark.context || "")));
    record("lp-neutral-missing", !missingMark, JSON.stringify(missingMark || null).slice(0, 160));
    const tomatoContexts = (jobProbe.todayMarks || []).filter((mark) => mark.visible !== false).map((mark) => mark.context);
    record("lp-tomato-regression", tomatoContexts.some((text) => /sz-plain/.test(text)) && tomatoContexts.some((text) => /sz-woken/.test(text)), `tomatoes=${tomatoContexts.length}`);
    const tomatoOnClockLine = (jobProbe.todayMarks || []).some((mark) => mark.visible !== false && /sz-asleep/.test(String(mark.context || "")));
    record("lp-no-tomato-on-snoozed", !tomatoOnClockLine, "asleep keeps its clock, never both marks");

    const shotLiveLight = path.join(outDir, "e2e-snooze-marks-live-light.png");
    await capturePage(client, shotLiveLight);
    report.screenshots.push(shotLiveLight);
    await client.evaluate(`(() => { document.body.classList.remove("theme-light"); document.body.classList.add("theme-dark"); return true; })()`);
    await sleep(250);
    const jobDark = await client.evaluate(SNOOZE_PROBE).catch(() => ({ defMarks: [] }));
    record("theme-dark-repaints", liveDefMarks(jobDark).length >= 2, `marks=${liveDefMarks(jobDark).length}`);
    const shotLiveDark = path.join(outDir, "e2e-snooze-marks-live-dark.png");
    await capturePage(client, shotLiveDark);
    report.screenshots.push(shotLiveDark);
    await client.evaluate(`(() => { document.body.classList.remove("theme-dark"); document.body.classList.add("theme-light"); return true; })()`);
    await sleep(150);

    // ---- job.md Reading view: same clocks, no code ----
    await openNote(client, fixture.job, "preview");
    await sleep(700);
    const jobReading = await waitFor(client, SNOOZE_PROBE, (value) => value && Array.isArray(value.defMarks) && value.defMarks.filter((mark) => mark.surface !== "live" && mark.visible !== false).length >= 2, "reading-def-marks", 15_000).catch(async (error) => {
      const latest = await client.evaluate(SNOOZE_PROBE).catch(() => ({ defMarks: [], error: error.message }));
      latest.error = error.message;
      return latest;
    });
    const rdefs = readingDefMarks(jobReading);
    if (expectTimes("reading-asleep-clock")) {
      const ra = markByKey(rdefs, asleepKey);
      record("reading-asleep-clock", Boolean(ra) && ra.tone === "asleep" && ra.time === colonClock(clocks.asleepHhmm) && ra.label === colonClock(clocks.asleepHhmm), JSON.stringify((ra) ?? null).slice(0, 400));
    }
    const sameReadingHosts = [asleepKey, "job.md#sz-due", "job.md#sz-blocked"].every((key) => {
      const live = markByKey(defs, key);
      const reading = markByKey(rdefs, key);
      return Boolean(live && reading) && ["tone", "time", "label", "aria"].every((field) => live[field] === reading[field]);
    });
    record("reading-live-mark-hosts-match", sameReadingHosts, JSON.stringify([asleepKey, "job.md#sz-due", "job.md#sz-blocked"].map((key) => ({ key, live: markByKey(defs, key), reading: markByKey(rdefs, key) }))).slice(0, 800));
    const readingVisibleDefs = rdefs.filter((mark) => mark.visible !== false);
    const readingSingleLine = readingVisibleDefs.length >= 3 && readingVisibleDefs.every((mark) =>
      Number.isFinite(mark.height) && Number.isFinite(mark.rowLineHeight) &&
      mark.height <= mark.rowLineHeight + 1 && mark.width > mark.fontSize * 2.5,
    );
    record("reading-clock-single-line-width", readingSingleLine, JSON.stringify(readingVisibleDefs.map((mark) => ({ key: mark.key, width: mark.width, height: mark.height, rowLineHeight: mark.rowLineHeight, fontSize: mark.fontSize }))).slice(0, 600));
    const stampState = await client.evaluate(`(() => { try {
      const root = document.querySelector(".workspace-leaf.mod-active") || document;
      return {
        stamped: root.querySelectorAll("li[data-bob-today-key]").length,
        marks: Array.from(root.querySelectorAll(".bob-today-mark")).map((el) => ({
          aria: el.getAttribute("aria-label") || "",
          visible: el.getClientRects().length > 0,
          context: String((el.closest("li") && el.closest("li").textContent) || "").replace(/\s+/g, " ").trim().slice(0, 60),
        })),
      };
    } catch (e) { return { error: String(e && e.message || e) }; } })()`).catch((error) => ({ error: String(error) }));
    record("reading-tomato-stamps", true, JSON.stringify(stampState).slice(0, 600));
    const tomatoPredicate = (value) => value && Array.isArray(value.todayMarks) && value.todayMarks.some((mark) => mark.surface !== "live" && mark.visible !== false && /sz-plain/.test(String(mark.context || "")));
    let jobReadingTomatoes = await waitFor(client, SNOOZE_PROBE, tomatoPredicate, "reading-tomatoes", 8000).catch(async () => client.evaluate(SNOOZE_PROBE).catch(() => ({ todayMarks: [] })));
    if (!tomatoPredicate(jobReadingTomatoes)) {
      // A cold-cache first render may stamp rows before the Today cache
      // fills; a fresh open re-runs the postprocessor with warm caches.
      await openNote(client, fixture.job, "preview").catch(() => ({}));
      await sleep(800);
      jobReadingTomatoes = await waitFor(client, SNOOZE_PROBE, tomatoPredicate, "reading-tomatoes-retry", 8000).catch(async () => client.evaluate(SNOOZE_PROBE).catch(() => ({ todayMarks: [] })));
    }
    const readingTomatoes = (jobReadingTomatoes.todayMarks || []).filter((mark) => mark.surface !== "live" && mark.visible !== false);
    record("reading-tomato-regression", readingTomatoes.some((mark) => /sz-plain/.test(String(mark.context || ""))), `tomatoes=${readingTomatoes.length}`);

    // ---- daily Live Preview: woken pills, rows, heading, event control ----
    await openNote(client, fixture.daily, "live").catch(() => ({}));
    await sleep(500);
    await client.evaluate(SCROLL_SNOOZED_EXPR).catch(() => ({}));
    await sleep(400);
    const dailyEarly = await waitFor(client, SNOOZE_PROBE, (value) => {
      const pills = (value && value.woken || []).filter((pill) => pill.surface === "live" && pill.visible !== false).length;
      const chips = (value && value.rowChips || []).filter((chip) => chip.surface === "live" && chip.visible !== false).length;
      return pills >= (stable ? 2 : 1) && chips >= 7;
    }, "lp-woken-rows", 15_000).catch(async (error) => {
      const latest = await client.evaluate(SNOOZE_PROBE).catch(() => ({ woken: [], rowChips: [], error: error.message }));
      latest.error = error.message;
      return latest;
    });
    // History and heading paint may resolve on a later refresh cycle than
    // the first rows; wait for them explicitly, then probe fresh so no
    // assert reads the waitFor snapshot.
    await waitFor(client, SNOOZE_PROBE, (value) => {
      const history = (value && value.rowChips || []).filter((chip) => chip.surface === "live" && chip.visible !== false && chip.paint === "history").length;
      const heading = (value && value.headingChips || []).filter((chip) => chip.surface === "live" && chip.visible !== false).length;
      return history >= 2 && heading >= 1;
    }, "lp-heading-history", 10_000).catch(() => null);
    await sleep(500);
    const dailyProbe = await client.evaluate(SNOOZE_PROBE).catch(() => ({ woken: [], rowChips: [], headingChips: [], error: "reprobe failed" }));
    dailyProbe.error = dailyEarly && dailyEarly.error;
    console.log(`CHIPS ${JSON.stringify(((dailyProbe && dailyProbe.rowChips) || []).map((chip) => ({ paint: chip.paint, time: chip.time, status: chip.status, visible: chip.visible, surface: chip.surface, context: String(chip.context || "").slice(0, 60) })))}`);
    const liveWoken = (dailyProbe.woken || []).filter((pill) => pill.surface === "live" && pill.visible !== false);
    record("lp-woken-masked-glyphs", liveWoken.length >= 1 && liveWoken.every((pill) => pill.beforeMask && pill.beforeMask !== "none"), JSON.stringify(liveWoken.map((pill) => pill.beforeMask)).slice(0, 320));
    // Hosts stay empty by contract (copy-safe); the words live in aria-label.
    if (expectTimes("lp-woken-fresh")) {
      const fresh = wokenByTime(liveWoken, colonClock(clocks.freshWokeHhmm));
      const expectedFresh = wokeTooltip(clocks.freshWokeHhmm, clocks.dueHhmm);
      record("lp-woken-fresh", Boolean(fresh) && fresh.pill === "fresh" && fresh.text === "" && fresh.time === colonClock(clocks.freshWokeHhmm) && fresh.line === "26" && fresh.aria === expectedFresh && (fresh.title || "") === "", JSON.stringify((fresh) ?? null).slice(0, 400));
    }
    if (expectTimes("lp-woken-settled")) {
      const settled = wokenByTime(liveWoken, colonClock(clocks.settledWokeHhmm));
      const expectedSettled = wokeTooltip(clocks.settledWokeHhmm, clocks.dueHhmm);
      record("lp-woken-settled", Boolean(settled) && settled.pill === "settled" && settled.time === colonClock(clocks.settledWokeHhmm) && settled.line === "27" && settled.aria === expectedSettled, JSON.stringify((settled) ?? null).slice(0, 400));
    }
    const liveChips = (dailyProbe.rowChips || []).filter((chip) => chip.surface === "live" && chip.visible !== false);
    const chipPaint = (paint) => liveChips.filter((chip) => chip.paint === paint);
    if (expectTimes("lp-row-asleep")) {
      const asleepChips = chipPaint("asleep");
      record("lp-row-asleep", asleepChips.some((chip) => chip.time === colonClock(clocks.asleepHhmm) && /^in /.test(chip.status) && /::/.test(chip.status) === false), JSON.stringify(asleepChips).slice(0, 400));
    }
    record("lp-row-due", chipPaint("due").some((chip) => chip.status === "due · waking"), JSON.stringify(chipPaint("due")).slice(0, 320));
    record("lp-row-blocked", chipPaint("blocked").some((chip) => chip.status === "waits on prerequisites"), JSON.stringify(chipPaint("blocked")).slice(0, 320));
    const ignoredStatus = chipPaint("ignored").map((chip) => chip.status);
    record("lp-row-ready", ignoredStatus.some((text) => text === "Ready — won't wake"), JSON.stringify(ignoredStatus).slice(0, 320));
    record("lp-row-missing", ignoredStatus.some((text) => text === "Missing — won't wake"), JSON.stringify(ignoredStatus).slice(0, 320));
    record("lp-row-ambiguous", ignoredStatus.some((text) => text === "Ambiguous — won't wake"), JSON.stringify(ignoredStatus).slice(0, 320));
    record("lp-row-done", ignoredStatus.some((text) => text === "Done — won't wake"), JSON.stringify(ignoredStatus).slice(0, 320));
    if (expectTimes("lp-row-history")) {
      const historyChips = chipPaint("history");
      record("lp-row-history", historyChips.some((chip) => chip.status === `woke ${colonClock(clocks.freshWokeHhmm)}`), JSON.stringify(historyChips).slice(0, 400));
    }
    const liveHeadings = (dailyProbe.headingChips || []).filter((chip) => chip.surface === "live" && chip.visible !== false).map((chip) => chip.summary || chip.aria);
    if (expectTimes("lp-heading-summary")) {
      const expectedHeading = `1 asleep · 1 due · 1 blocked · next ${colonClock(clocks.dueHhmm)}`;
      record("lp-heading-summary", liveHeadings.some((text) => text === expectedHeading), JSON.stringify(liveHeadings).slice(0, 320));
    }
    const liveDiag = await client.evaluate(`(() => { try {
      const p = window.app.plugins.plugins["bob-ledger-tools"];
      const leaf = window.app.workspace.activeLeaf;
      const file = leaf && leaf.view && leaf.view.file && leaf.view.file.path;
      const editor = leaf && leaf.view && leaf.view.editor;
      const text = editor && typeof editor.getValue === "function" ? editor.getValue() : null;
      let model = null, err = null;
      try { model = p.snoozeRowPaintClassify(file, text, new Date()); } catch (e) { err = String(e && e.message || e); }
      return { file, err,
        summary: model ? p.snoozeRowPaintHeadingSummary(model.classified) : null,
        headerNumber: model && model.parsed && model.parsed.headerNumber,
        rows: model && model.classified && model.classified.rows.map((row) => [row.line, row.state, row.hhmm]) };
    } catch (e) { return { error: String(e && e.message || e) }; } })()`).catch((error) => ({ error: String(error) }));
    record("live-classify-state", true, JSON.stringify(liveDiag).slice(0, 500));
    const headingBisect = await client.evaluate(`(() => { try {
      const all = Array.from(document.querySelectorAll(".bob-snooze-heading-chip")).map((el) => ({
        aria: el.getAttribute("aria-label") || "",
        summary: el.getAttribute("data-bob-snooze-heading-summary") || "",
        visible: el.getClientRects().length > 0,
        surface: el.closest(".cm-editor") ? "live" : "other",
      }));
      const root = document.querySelector(".workspace-leaf.mod-active") || document;
      const scoped = Array.from(root.querySelectorAll(".bob-snooze-heading-chip")).length;
      return { all, scoped };
    } catch (e) { return { error: String(e && e.message || e) }; } })()`).catch((error) => ({ error: String(error) }));
    record("live-heading-bisect", true, JSON.stringify(headingBisect).slice(0, 500));
    const liveEvents = (dailyProbe.eventTimes || []).filter((mark) => mark.surface === "live" && mark.visible !== false);
    record("lp-event-time-regression", liveEvents.length >= 1, `event-chips=${liveEvents.length}`);
    // Tomatoes decorate #task definition lines, never bare ledger links: the
    // same identity wears 🍅 in job.md (asserted above) and the pill below.
    const livePillContexts = liveWoken.map((pill) => pill.context);
    record("lp-pill-marks-linked-task", livePillContexts.some((text) => /sz-woken/.test(text)), JSON.stringify(livePillContexts).slice(0, 200));
    const pillBeforeLink = await client.evaluate(`(() => {
      const root = document.querySelector(".workspace-leaf.mod-active") || document;
      const pill = root.querySelector(".bob-snooze-woke");
      if (!pill) return { ok: false, error: "no pill" };
      const row = pill.closest(".cm-line, li");
      if (!row) return { ok: false, error: "no row" };
      const link = row.querySelector("a.internal-link, .cm-hmd-internal-link");
      if (!link) return { ok: false, error: "no link" };
      const position = pill.compareDocumentPosition(link);
      const FOLLOWING = typeof Node !== "undefined" && Node.DOCUMENT_POSITION_FOLLOWING ? Node.DOCUMENT_POSITION_FOLLOWING : 4;
      return { ok: Boolean(position & FOLLOWING), position };
    })()`).catch((error) => ({ ok: false, error: String(error) }));
    record("lp-pill-before-link", Boolean(pillBeforeLink && pillBeforeLink.ok), JSON.stringify((pillBeforeLink) ?? null).slice(0, 160));

    const shotDailyLight = path.join(outDir, "e2e-snooze-marks-daily-light.png");
    await capturePage(client, shotDailyLight);
    report.screenshots.push(shotDailyLight);
    await client.evaluate(`(() => { document.body.classList.remove("theme-light"); document.body.classList.add("theme-dark"); return true; })()`);
    await sleep(250);
    const shotDailyDark = path.join(outDir, "e2e-snooze-marks-daily-dark.png");
    await capturePage(client, shotDailyDark);
    report.screenshots.push(shotDailyDark);
    await client.evaluate(`(() => { document.body.classList.remove("theme-dark"); document.body.classList.add("theme-light"); return true; })()`);
    await sleep(150);
    await client.evaluate(`(() => {
      const root = document.querySelector(".workspace-leaf.mod-active") || document;
      const line = Array.from(root.querySelectorAll(".cm-line")).find((node) => /sz-due|sz-blocked/.test(String(node.textContent || "")));
      if (line) line.scrollIntoView({ block: "center" });
      return Boolean(line);
    })()`).catch(() => false);
    await sleep(300);
    const shotRows = path.join(outDir, "e2e-snooze-marks-rows.png");
    await capturePage(client, shotRows);
    report.screenshots.push(shotRows);
    await client.evaluate(`(() => { document.body.classList.remove("theme-light"); document.body.classList.add("theme-dark"); return true; })()`);
    await sleep(250);
    const shotRowsDark = path.join(outDir, "e2e-snooze-marks-rows-dark.png");
    await capturePage(client, shotRowsDark);
    report.screenshots.push(shotRowsDark);
    await client.evaluate(`(() => { document.body.classList.remove("theme-dark"); document.body.classList.add("theme-light"); return true; })()`);
    await sleep(150);

    // ---- daily Reading view ----
    await openNote(client, fixture.daily, "preview");
    await sleep(700);
    await client.evaluate(SCROLL_SNOOZED_EXPR).catch(() => ({}));
    await sleep(400);
    const readingEarly = await waitFor(client, SNOOZE_PROBE, (value) => {
      const pills = (value && value.woken || []).filter((pill) => pill.surface !== "live" && pill.visible !== false).length;
      const rows = (value && value.readingRows || []).filter((row) => row.visible !== false).length;
      return pills >= (stable ? 2 : 1) && rows >= 5;
    }, "reading-woken-rows", 15_000).catch(async (error) => {
      const latest = await client.evaluate(SNOOZE_PROBE).catch(() => ({ woken: [], readingRows: [], error: error.message }));
      latest.error = error.message;
      return latest;
    });
    await sleep(500);
    const dailyReading = await client.evaluate(SNOOZE_PROBE).catch(() => ({ woken: [], readingRows: [], headingChips: [], error: "reprobe failed" }));
    dailyReading.error = readingEarly && readingEarly.error;
    const readingShape = await client.evaluate(`(() => { try {
      const root = document.querySelector(".workspace-leaf.mod-active") || document;
      const h2 = Array.from(root.querySelectorAll("h2")).find((node) => /Snoozed/.test(String(node.textContent || "")));
      if (!h2) return { ok: false, error: "no snoozed h2" };
      const sib = h2.nextElementSibling;
      return {
        ok: true,
        parent: h2.parentElement ? String(h2.parentElement.tagName) + "." + String(h2.parentElement.className || "").split(/\s+/).slice(0, 2).join(".") : null,
        sibling: sib ? String(sib.tagName) + "." + String(sib.className || "").split(/\s+/).slice(0, 2).join(".") : null,
        lists: root.querySelectorAll("ul, ol").length,
      };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; } })()`).catch((error) => ({ ok: false, error: String(error) }));
    record("reading-dom-shape", true, JSON.stringify(readingShape).slice(0, 300));
    const readingWoken = (dailyReading.woken || []).filter((pill) => pill.surface !== "live" && pill.visible !== false);
    if (expectTimes("reading-woken-fresh")) {
      const fresh = wokenByTime(readingWoken, colonClock(clocks.freshWokeHhmm));
      record("reading-woken-fresh", Boolean(fresh) && fresh.pill === "fresh" && fresh.text === "" && fresh.time === colonClock(clocks.freshWokeHhmm) && fresh.aria === wokeTooltip(clocks.freshWokeHhmm, clocks.dueHhmm), JSON.stringify((fresh) ?? null).slice(0, 400));
    }
    const readingRows = (dailyReading.readingRows || []).filter((row) => row.visible !== false);
    const readingRowChips = (dailyReading.rowChips || []).filter((chip) => chip.surface !== "live" && chip.visible !== false);
    record("reading-row-classes", readingRows.some((row) => /bob-snooze-row--asleep/.test(row.cls)) && readingRows.some((row) => /bob-snooze-row--due/.test(row.cls)) && readingRows.some((row) => /bob-snooze-row--blocked/.test(row.cls)) && readingRows.some((row) => /bob-snooze-row--history/.test(row.cls)) && readingRows.some((row) => /bob-snooze-row--ignored/.test(row.cls)), JSON.stringify(readingRows.map((row) => `${row.cls} :: ${row.chip}`)).slice(0, 400));
    record("reading-row-history", readingRowChips.some((chip) => chip.paint === "history" && chip.status === `woke ${colonClock(clocks.freshWokeHhmm)}`), JSON.stringify(readingRowChips.filter((chip) => chip.paint === "history")).slice(0, 300));
    const readingHeadings = (dailyReading.headingChips || []).filter((chip) => chip.visible !== false).map((chip) => chip.summary || chip.aria);
    if (expectTimes("reading-heading-summary")) {
      const expectedHeading = `1 asleep · 1 due · 1 blocked · next ${colonClock(clocks.dueHhmm)}`;
      record("reading-heading-summary", readingHeadings.some((text) => text === expectedHeading), JSON.stringify(readingHeadings).slice(0, 320));
    }
    const shotReadingLight = path.join(outDir, "e2e-snooze-marks-reading-light.png");
    await capturePage(client, shotReadingLight);
    report.screenshots.push(shotReadingLight);
    await client.evaluate(`(() => { document.body.classList.remove("theme-light"); document.body.classList.add("theme-dark"); return true; })()`);
    await sleep(250);
    const shotReadingDark = path.join(outDir, "e2e-snooze-marks-reading-dark.png");
    await capturePage(client, shotReadingDark);
    report.screenshots.push(shotReadingDark);
    await client.evaluate(`(() => { document.body.classList.remove("theme-dark"); document.body.classList.add("theme-light"); return true; })()`);
    await sleep(150);

    // ---- plan.md: the snoozed meter beside TODAY ----
    await openNote(client, fixture.plan, "live").catch(() => ({}));
    const planProbe = await waitFor(client, SNOOZE_PROBE, (value) => value && Array.isArray(value.planChips) && value.planChips.filter((chip) => chip.visible !== false).length >= 1, "lp-plan-chip", 15_000).catch(async (error) => {
      const latest = await client.evaluate(SNOOZE_PROBE).catch(() => ({ planChips: [], error: error.message }));
      latest.error = error.message;
      return latest;
    });
    const planChip = (planProbe.planChips || []).find((chip) => chip.visible !== false);
    if (expectTimes("lp-plan-chip")) {
      // Counts and tone follow the live queue, so assert the contract shape
      // (glyph, count, earliest live time, meter disclaimer, no ::) and
      // record the exact runtime values for the land agent.
      const chipRe = new RegExp(`^\\d+ · \\d\\d:\\d\\d$`);
      record("lp-plan-chip", Boolean(planChip) && chipRe.test(String(planChip.text)) && /not counted in TODAY/.test(String(planChip.aria)) && /when all wake/.test(String(planChip.aria)) && !/::/.test(String(planChip.aria)) && (planChip.title || "") !== "", JSON.stringify((planChip) ?? null).slice(0, 400));
      record("lp-plan-chip-masked-glyph", Boolean(planChip && planChip.glyphMask && planChip.glyphMask !== "none"), JSON.stringify(planChip && { mask: planChip.glyphMask, background: planChip.glyphBackground }));
    }
    const shotPlan = path.join(outDir, "e2e-snooze-marks-plan.png");
    await capturePage(client, shotPlan);
    report.screenshots.push(shotPlan);

    // ---- yesterday: neutral historical paint, quiet pill, no countdown ----
    await openNote(client, fixture.past, "live").catch(() => ({}));
    await sleep(700);
    const pastProbe = await client.evaluate(SNOOZE_PROBE).catch(() => ({ woken: [], rowChips: [], headingChips: [] }));
    const pastWoken = (pastProbe.woken || []).filter((pill) => pill.visible !== false);
    if (expectTimes("past-quiet-pill")) {
      record("past-quiet-pill", pastWoken.some((pill) => pill.pill === "quiet" && pill.time === colonClock(clocks.freshWokeHhmm)) && pastWoken.every((pill) => pill.pill !== "fresh"), JSON.stringify(pastWoken).slice(0, 320));
    }
    const pastChips = (pastProbe.rowChips || []).filter((chip) => chip.visible !== false).map((chip) => chip.text);
    record("past-no-countdown", pastChips.length > 0 && pastChips.every((text) => !/in \d/.test(text)), JSON.stringify(pastChips).slice(0, 320));
    const pastHeadings = (pastProbe.headingChips || []).filter((chip) => chip.visible !== false).map((chip) => chip.text);
    record("past-no-today-summary", pastHeadings.every((text) => !/next /.test(text)), JSON.stringify(pastHeadings).slice(0, 320));

    // ---- tooltips: exact woken text, structural clock text, never :: ----
    await openNote(client, fixture.job, "live").catch(() => ({}));
    await sleep(500);
    if (expectTimes("hover-def-tooltip")) {
      const hovered = await hoverMarkViaCdp(client, ".bob-snooze-mark", asleepKey);
      const expectedStart = `Snoozed until ${colonClock(clocks.asleepHhmm)} · in `;
      const tipAssert = asserts.assertExactTooltip({ aria: hovered.aria, tip: hovered.tip, expected: hovered.aria });
      record("hover-def-tooltip", hovered.ok && tipAssert.ok && String(hovered.tip).startsWith(expectedStart) && String(hovered.tip).endsWith("Ctrl-click to open the Snoozed row") && !/::/.test(String(hovered.tip)) && Boolean(hovered.laidOut), JSON.stringify({ tip: hovered.tip, aria: hovered.aria }).slice(0, 300));
      const shotHover = path.join(outDir, "e2e-snooze-marks-hover.png");
      await capturePage(client, shotHover);
      report.screenshots.push(shotHover);
    }
    if (expectTimes("hover-woken-tooltip")) {
      await openNote(client, fixture.daily, "live").catch(() => ({}));
      await sleep(400);
      const hovered = await hoverMarkViaCdp(client, ".bob-snooze-woke", colonClock(clocks.freshWokeHhmm));
      const expectedFresh = wokeTooltip(clocks.freshWokeHhmm, clocks.dueHhmm);
      const tipAssert = asserts.assertExactTooltip({ aria: hovered.aria, tip: hovered.tip, expected: expectedFresh });
      record("hover-woken-tooltip", hovered.ok && tipAssert.ok, JSON.stringify({ tip: hovered.tip, aria: hovered.aria, reason: tipAssert.reason }).slice(0, 300));
    }

    // ---- passive rendering never writes note bytes ----
    const hashesAfterPassive = noteFiles.map(sha256File).join(" ");
    if (hashesAfterPassive === hashesBefore) {
      record("passive-render-no-write", true, hashesAfterPassive);
    } else {
      const names = [fixture.job, fixture.daily, fixture.past, fixture.plan];
      const mismatched = [];
      for (let index = 0; index < noteFiles.length; index += 1) {
        let disk = "";
        try { disk = fs.readFileSync(noteFiles[index], "utf8"); } catch { disk = ""; }
        fs.writeFileSync(path.join(outDir, `after-${path.basename(noteFiles[index])}`), disk);
        if (sha256File(noteFiles[index]) !== hashesBefore.split(" ")[index]) mismatched.push(names[index]);
      }
      let diffText = "";
      try {
        const first = mismatched[0];
        const idx = names.indexOf(first);
        const before = fs.readFileSync(path.join(outDir, `before-${path.basename(noteFiles[idx])}`), "utf8");
        const after = fs.readFileSync(path.join(outDir, `after-${path.basename(noteFiles[idx])}`), "utf8");
        diffText = `\n${unifiedDiff(before, after)}`;
      } catch { diffText = " (diff unavailable)"; }
      record("passive-render-no-write", false, `changed: ${mismatched.join(", ")} (before-/after-*.md in ${outDir})${diffText}`.slice(0, 1200));
    }

    // ---- line height: marked and unmarked baselines agree ----
    await openNote(client, fixture.job, "live").catch(() => ({}));
    await sleep(500);
    const heights = await client.evaluate(LINE_HEIGHT_PROBE).catch(() => ({}));
    // Baselines differ by content length (the snoozed line wraps); the gated
    // proof that marks add no height is toggle-row-height-unchanged below.
    if (heights && heights.snoozed && heights.plain) {
      record("line-height-baseline", true, `snoozed=${heights.snoozed.height} plain=${heights.plain.height} (content differs; see toggle pair)`);
    } else {
      record("line-height-baseline", false, JSON.stringify((heights) ?? null).slice(0, 200));
    }

    // ---- narrow layout stays readable with the long title ----
    await client.call("Emulation.setDeviceMetricsOverride", { width: 480, height: 800, deviceScaleFactor: 1, mobile: false }).catch(() => ({}));
    await sleep(300);
    const narrow = await client.evaluate(`(() => { try {
      const scroller = document.querySelector(".mod-active .cm-scroller") || document.querySelector(".cm-scroller");
      if (!scroller) return { error: "no scroller" };
      return { overflowX: scroller.scrollWidth - scroller.clientWidth, clientWidth: scroller.clientWidth };
    } catch (e) { return { error: String(e && e.message || e) }; } })()`).catch((error) => ({ error: String(error) }));
    record("narrow-no-hscroll", Number.isFinite(narrow.overflowX) && narrow.overflowX <= 1, JSON.stringify((narrow) ?? null).slice(0, 160));
    const shotNarrow = path.join(outDir, "e2e-snooze-marks-narrow.png");
    await capturePage(client, shotNarrow);
    report.screenshots.push(shotNarrow);
    // Restore the explicit full-size baseline after the narrow viewport case.
    await client.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(200);

    // ---- reduced motion + forced colors keep a visible glyph and text ----
    await client.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }, { name: "forced-colors", value: "active" }] }).catch(() => ({}));
    await sleep(400);
    await openNote(client, fixture.job, "live").catch(() => ({}));
    await sleep(500);
    const a11yJob = await client.evaluate(SNOOZE_PROBE).catch(() => ({ defMarks: [] }));
    const a11yDefs = liveDefMarks(a11yJob);
    record("reduced-motion-keeps-marks", a11yDefs.length >= 2 && a11yDefs.every((mark) => String(mark.aria || "").length > 0), `marks=${a11yDefs.length}`);
    record("forced-colors-keeps-definition-glyphs", a11yDefs.length >= 2 && a11yDefs.every((mark) => mark.beforeBackground !== "rgba(0, 0, 0, 0)" && mark.beforeForcedColorAdjust === "none"), JSON.stringify(a11yDefs.map((mark) => ({ background: mark.beforeBackground, adjust: mark.beforeForcedColorAdjust }))));
    await openNote(client, fixture.daily, "live").catch(() => ({}));
    await sleep(500);
    const a11yProbe = await client.evaluate(SNOOZE_PROBE).catch(() => ({ woken: [] }));
    const a11yWoken = (a11yProbe.woken || []).filter((pill) => pill.surface === "live" && pill.visible !== false);
    record("forced-colors-keeps-pills", a11yWoken.length >= 1 && a11yWoken.every((pill) => String(pill.aria || "").includes("Woke")), `pills=${a11yWoken.length}`);
    record("forced-colors-keeps-woken-glyphs", a11yWoken.length >= 1 && a11yWoken.every((pill) => pill.beforeBackground !== "rgba(0, 0, 0, 0)" && pill.beforeForcedColorAdjust === "none"), JSON.stringify(a11yWoken.map((pill) => ({ background: pill.beforeBackground, adjust: pill.beforeForcedColorAdjust }))));
    const shotA11y = path.join(outDir, "e2e-snooze-marks-a11y.png");
    await capturePage(client, shotA11y);
    report.screenshots.push(shotA11y);
    await openNote(client, fixture.plan, "live").catch(() => ({}));
    await sleep(500);
    const a11yPlan = await client.evaluate(SNOOZE_PROBE).catch(() => ({ planChips: [] }));
    const a11yPlanChip = (a11yPlan.planChips || []).find((chip) => chip.visible !== false);
    record("forced-colors-keeps-plan-glyph", Boolean(a11yPlanChip && a11yPlanChip.glyphMask && a11yPlanChip.glyphMask !== "none" && a11yPlanChip.glyphBackground !== "rgba(0, 0, 0, 0)" && a11yPlanChip.glyphForcedColorAdjust === "none"), JSON.stringify(a11yPlanChip && { mask: a11yPlanChip.glyphMask, background: a11yPlanChip.glyphBackground, adjust: a11yPlanChip.glyphForcedColorAdjust }));
    await client.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }, { name: "forced-colors", value: "none" }] }).catch(() => ({}));
    await sleep(200);

    // ---- toggles: paint gates off per surface, meter stays, restoration works ----
    const toggledOff = await client.evaluate(`(() => {
      const result = window.app.commands.executeCommandById("bob-ledger-tools:toggle-snooze-marks");
      return { ok: result !== false };
    })()`);
    record("toggle-off-command", toggledOff && toggledOff.ok, JSON.stringify((toggledOff) ?? null));
    await openNote(client, fixture.job, "live").catch(() => ({}));
    const jobOff = await waitFor(client, SNOOZE_PROBE, (value) => value && (value.defMarks || []).filter((mark) => mark.surface === "live" && mark.visible !== false).length === 0, "toggle-hides-clocks", 6000).catch(async (error) => {
      const latest = await client.evaluate(SNOOZE_PROBE).catch(() => ({ defMarks: [], error: error.message }));
      latest.error = error.message;
      return latest;
    });
    record("toggle-hides-clocks", liveDefMarks(jobOff).length === 0, `marks=${liveDefMarks(jobOff).length}`);
    await openNote(client, fixture.daily, "live").catch(() => ({}));
    await sleep(400);
    const dailyOff = await client.evaluate(SNOOZE_PROBE).catch(() => ({ woken: [], rowChips: [] }));
    const offPills = (dailyOff.woken || []).filter((pill) => pill.surface === "live" && pill.visible !== false);
    const offChips = (dailyOff.rowChips || []).filter((chip) => chip.surface === "live" && chip.visible !== false);
    record("toggle-hides-pills", offPills.length === 0, `pills=${offPills.length}`);
    record("toggle-hides-rows", offChips.length === 0, `chips=${offChips.length}`);
    await openNote(client, fixture.plan, "live").catch(() => ({}));
    await sleep(400);
    const planOff = await client.evaluate(SNOOZE_PROBE).catch(() => ({ planChips: [] }));
    const offPlan = (planOff.planChips || []).filter((chip) => chip.visible !== false);
    record("toggle-keeps-meter", offPlan.length >= 1, `chips=${offPlan.length} text=${offPlan.map((chip) => chip.text).join(" | ")}`);
    await openNote(client, fixture.job, "live").catch(() => ({}));
    await sleep(300);
    const heightsOff = await client.evaluate(LINE_HEIGHT_PROBE).catch(() => ({}));
    if (heights && heights.snoozed && heightsOff && heightsOff.snoozed) {
      record("toggle-row-height-unchanged", Math.abs(heights.snoozed.height - heightsOff.snoozed.height) <= 1, `on=${heights.snoozed.height} off=${heightsOff.snoozed.height}`);
    } else {
      record("toggle-row-height-unchanged", false, "missing height sample");
    }
    await client.evaluate(`(() => window.app.commands.executeCommandById("bob-ledger-tools:toggle-snooze-marks"))()`);
    const onProbe = await waitFor(client, SNOOZE_PROBE, (value) => value && (value.defMarks || []).filter((mark) => mark.surface === "live" && mark.visible !== false).length >= 2, "toggle-restores-marks", 8000).catch((error) => ({ error: error.message, defMarks: [] }));
    record("toggle-restores-marks", liveDefMarks(onProbe).length >= 2, `marks=${liveDefMarks(onProbe).length}`);
    await client.evaluate(`(() => window.app.commands.executeCommandById("bob-ledger-tools:toggle-today-marks"))()`);
    const todayOff = await waitFor(client, SNOOZE_PROBE, (value) => value && (value.defMarks || []).filter((mark) => mark.surface === "live" && mark.visible !== false).length === 0, "today-toggle-hides-clocks", 6000).catch(async (error) => {
      const latest = await client.evaluate(SNOOZE_PROBE).catch(() => ({ defMarks: [], error: error.message }));
      latest.error = error.message;
      return latest;
    });
    record("today-toggle-hides-clocks", liveDefMarks(todayOff).length === 0, `marks=${liveDefMarks(todayOff).length}`);
    await client.evaluate(`(() => window.app.commands.executeCommandById("bob-ledger-tools:toggle-today-marks"))()`);
    const todayOn = await waitFor(client, SNOOZE_PROBE, (value) => value && (value.defMarks || []).filter((mark) => mark.surface === "live" && mark.visible !== false).length >= 2, "today-toggle-restores", 8000).catch((error) => ({ error: error.message, defMarks: [] }));
    record("today-toggle-restores", liveDefMarks(todayOn).length >= 2, `marks=${liveDefMarks(todayOn).length}`);

    // ---- clicks: plain never navigates, Mod+click jumps, chip reaches heading ----
    const clickAt = async (point, modifiers) => {
      await client.call("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1, modifiers: modifiers || 0 });
      await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1, modifiers: modifiers || 0 });
    };
    const clickMark = async (selector, key, modifiers) => {
      const first = await markPoint(client, selector, key);
      if (!first || !first.ok) return first;
      await sleep(150);
      const point = await markPoint(client, selector, key);
      if (!point || !point.ok) return point;
      await clickAt(point, modifiers);
      await sleep(400);
      return point;
    };
    const navState = () => client.evaluate(`(() => {
      const leaves = window.app.workspace.getLeavesOfType("markdown").map((leaf) => leaf.view && leaf.view.file && leaf.view.file.path);
      const leaf = window.app.workspace.activeLeaf;
      const editor = leaf && leaf.view && leaf.view.editor;
      let cursor = null;
      try { cursor = editor && typeof editor.getCursor === "function" ? editor.getCursor() : null; } catch {}
      return { paths: leaves, active: window.app.workspace.getActiveFile && window.app.workspace.getActiveFile() ? window.app.workspace.getActiveFile().path : null, cursor };
    })()`).catch((error) => ({ error: String(error) }));
    await openNote(client, fixture.job, "live").catch(() => ({}));
    await sleep(500);
    const hashesBeforeClick = noteFiles.map(sha256File).join(" ");
    await clickMark(".bob-snooze-mark", asleepKey, 0);
    const hashesAfterClick = noteFiles.map(sha256File).join(" ");
    record("plain-click-no-write", hashesBeforeClick === hashesAfterClick, `${hashesBeforeClick} vs ${hashesAfterClick}`);
    const caret = await client.evaluate(`(() => {
      const leaf = window.app.workspace.activeLeaf;
      const editor = leaf && leaf.view && leaf.view.editor;
      if (!editor || typeof editor.getCursor !== "function") return { ok: false, error: "no editor" };
      const cursor = editor.getCursor();
      const line = editor.getLine(cursor.line);
      return { ok: true, line: cursor.line, ch: cursor.ch, text: String(line || "").slice(0, 80), focused: document.hasFocus() };
    })()`).catch((error) => ({ ok: false, error: String(error) }));
    record("plain-click-keeps-editor", Boolean(caret && caret.ok && caret.line === 2 && caret.ch > 0), JSON.stringify((caret) ?? null).slice(0, 220));
    await clickMark(".bob-snooze-mark", asleepKey, 2);
    let jumped = { active: null };
    for (let i = 0; i < 20; i += 1) {
      await sleep(250);
      jumped = await navState().catch(() => ({ active: null }));
      if (jumped && jumped.active === fixture.daily) break;
    }
    record("mod-click-opens-daily", jumped && jumped.active === fixture.daily, JSON.stringify(jumped && { active: jumped.active, cursor: jumped.cursor }).slice(0, 220));
    if (jumped && jumped.cursor && Number.isFinite(jumped.cursor.line)) {
      record("mod-click-lands-on-row", Math.abs(jumped.cursor.line - (19 - 1)) <= 3, `cursor=${JSON.stringify(jumped.cursor)}`);
    } else {
      record("mod-click-lands-on-row", false, JSON.stringify(jumped && jumped.cursor).slice(0, 160));
    }
    await openNote(client, fixture.daily, "live").catch(() => ({}));
    await sleep(500);
    await clickMark(".bob-snooze-woke", colonClock(clocks.freshWokeHhmm), 2);
    await sleep(200);
    const afterWokenJump = await navState().catch(() => ({}));
    if (afterWokenJump && afterWokenJump.cursor && Number.isFinite(afterWokenJump.cursor.line)) {
      record("woken-mod-click-lands-on-history", Math.abs(afterWokenJump.cursor.line - (26 - 1)) <= 3, `cursor=${JSON.stringify(afterWokenJump.cursor)}`);
    } else {
      record("woken-mod-click-lands-on-history", false, JSON.stringify(afterWokenJump && afterWokenJump.cursor).slice(0, 160));
    }
    await openNote(client, fixture.plan, "live").catch(() => ({}));
    await sleep(500);
    const chipPoint = await client.evaluate(`(() => {
      const root = document.querySelector(".workspace-leaf.mod-active") || document;
      const chip = Array.from(root.querySelectorAll(".bob-plan-snoozed")).find((el) => el.getClientRects().length > 0);
      if (!chip) return { ok: false, error: "chip missing" };
      chip.scrollIntoView({ block: "center" });
      const rect = chip.getBoundingClientRect();
      return { ok: true, x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`).catch((error) => ({ ok: false, error: String(error) }));
    if (chipPoint && chipPoint.ok) {
      await clickAt(chipPoint, 0);
      await sleep(600);
    }
    const afterChipJump = await navState().catch(() => ({}));
    record("plan-chip-reaches-heading", afterChipJump && afterChipJump.active === fixture.daily, JSON.stringify(afterChipJump && { active: afterChipJump.active, cursor: afterChipJump.cursor }).slice(0, 220));

    // ---- liveness: retime, link-win, and deletion update without reopening ----
    await openNote(client, fixture.daily, "live").catch(() => ({}));
    await sleep(500);
    if (expectTimes("live-retime-to-due")) {
      const retimed = await client.evaluate(`(() => (async () => {
        const target = window.app.vault.getAbstractFileByPath(${JSON.stringify(fixture.daily)});
        if (!target) return { ok: false, error: "daily missing" };
        const text = await window.app.vault.read(target);
        const next = text.replace("- **${clocks.asleepHhmm}** [[job#^sz-asleep]]", "- **${clocks.dueHhmm}** [[job#^sz-asleep]]");
        if (next === text) return { ok: false, error: "row not found" };
        await window.app.vault.modify(target, next);
        return { ok: true };
      })())()`).catch((error) => ({ ok: false, error: String(error) }));
      record("live-retime-edit-applied", Boolean(retimed && retimed.ok), JSON.stringify((retimed) ?? null).slice(0, 160));
      const dueFlip = await waitFor(client, SNOOZE_PROBE, (value) => {
        const chips = ((value && value.rowChips) || []).filter((chip) => chip.surface === "live" && chip.visible !== false);
        return chips.filter((chip) => chip.status === "due · waking").length >= 2;
      }, "retime-due-flip", 8000).catch(() => null);
      const flippedChips = dueFlip ? dueFlip.rowChips.filter((chip) => chip.surface === "live" && chip.visible !== false).map((chip) => `${chip.paint}:${chip.status}`) : [];
      record("live-retime-to-due", Boolean(dueFlip) && flippedChips.filter((text) => text === "due:due · waking").length >= 2, JSON.stringify(flippedChips).slice(0, 400));
    }
    const linkAdded = await client.evaluate(`(() => (async () => {
      const target = window.app.vault.getAbstractFileByPath(${JSON.stringify(fixture.daily)});
      if (!target) return { ok: false, error: "daily missing" };
      const text = await window.app.vault.read(target);
      const anchor = "\t- [[job#^sz-plain]]";
      if (!text.includes(anchor)) return { ok: false, error: "anchor missing" };
      const next = text.replace(anchor, anchor + "\\n\\t- [[job#^sz-asleep]]");
      await window.app.vault.modify(target, next);
      return { ok: true };
    })())()`).catch((error) => ({ ok: false, error: String(error) }));
    record("live-link-edit-applied", Boolean(linkAdded && linkAdded.ok), JSON.stringify((linkAdded) ?? null).slice(0, 160));
    await openNote(client, fixture.job, "live").catch(() => ({}));
    const linkWin = await waitFor(client, SNOOZE_PROBE, (value) => {
      const marks = ((value && value.defMarks) || []).filter((mark) => mark.surface === "live" && mark.visible !== false);
      return marks.every((mark) => String(mark.key || "") !== "job.md#sz-asleep") && marks.length >= 1;
    }, "link-wins-over-clock", 8000).catch(() => null);
    const linkWinMarks = linkWin ? linkWin.defMarks.filter((mark) => mark.surface === "live" && mark.visible !== false).map((mark) => mark.key) : [];
    record("live-link-wins-over-clock", Boolean(linkWin), JSON.stringify(linkWinMarks).slice(0, 220));
    const linkWinTomato = linkWin ? (linkWin.todayMarks || []).filter((mark) => mark.visible !== false && /sz-asleep/.test(String(mark.context || ""))) : [];
    record("wake-to-tomato", linkWinTomato.length >= 1, `tomatoes=${linkWinTomato.length}`);
    const deleted = await client.evaluate(`(() => (async () => {
      const target = window.app.vault.getAbstractFileByPath(${JSON.stringify(fixture.daily)});
      if (!target) return { ok: false, error: "daily missing" };
      const text = await window.app.vault.read(target);
      const parts = text.split("\\n").filter((line) => line !== "- **${clocks.dueHhmm}** [[job#^sz-blocked]]");
      if (parts.length === text.split("\\n").length) return { ok: false, error: "row not found" };
      await window.app.vault.modify(target, parts.join("\\n"));
      return { ok: true };
    })())()`).catch((error) => ({ ok: false, error: String(error) }));
    record("live-delete-edit-applied", Boolean(deleted && deleted.ok), JSON.stringify((deleted) ?? null).slice(0, 160));
    await openNote(client, fixture.daily, "live").catch(() => ({}));
    const deletedGone = await waitFor(client, SNOOZE_PROBE, (value) => {
      const chips = ((value && value.rowChips) || []).filter((chip) => chip.surface === "live" && chip.visible !== false).map((chip) => chip.text);
      return !chips.some((text) => text === "waits on prerequisites");
    }, "delete-removes-paint", 8000).catch(() => null);
    record("live-delete-removes-paint", Boolean(deletedGone), JSON.stringify(deletedGone ? deletedGone.rowChips.filter((chip) => chip.surface === "live" && chip.visible !== false).map((chip) => chip.text) : null).slice(0, 320));

    // ---- case-8-linux-waker: spawn bob snooze wake; Notice when notified is none ----
    const case8 = await client.evaluate(`(() => (async () => {
      const plugin = window.app && window.app.plugins && window.app.plugins.plugins && window.app.plugins.plugins["bob-ledger-tools"];
      if (!plugin || typeof plugin.snoozeWakeTick !== "function") return { ok: false, error: "no waker" };
      const notices = [];
      const spawns = [];
      const origSpawn = plugin.snoozeWakeSpawn;
      const origNotice = plugin.snoozeWakeNotice;
      const origReady = plugin.isSnoozedCacheReady;
      const origDesktop = plugin.snoozeWakeIsDesktop;
      plugin.snoozeWakeDisabled = false;
      plugin.snoozeWakeUnloaded = false;
      plugin.snoozeWakeInFlight = false;
      plugin.snoozeWakeLastAttemptMinute = "";
      plugin.snoozeWakeIsDesktop = () => true;
      plugin.isSnoozedCacheReady = () => true;
      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const date = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
      plugin.snoozedCache = Object.assign({}, plugin.snoozedCache || {}, {
        date,
        nowMinutes: now.getHours() * 60 + now.getMinutes(),
        nextWakeAt: new Date(now.getTime() - 60 * 1000).toISOString(),
      });
      plugin.snoozeWakeSpawn = async (args) => {
        const argv = Array.isArray(args) ? args.slice() : ["snooze", "wake", "-q", "-f", "json"];
        spawns.push(argv);
        return {
          ok: true,
          report: {
            schema_version: 1,
            date,
            now: now.toISOString(),
            status: "woke",
            daily_file: "daily.md",
            notified: "none",
            wake_id: "e2e-case8",
            woken: [{
              route: "job.md",
              block_id: "sz-due",
              title: "Due e2e (test, no action needed)",
              target: "0000",
              woke_at: pad(now.getHours()) + ":" + pad(now.getMinutes()),
              destination: { created: false, line: 1, name: "WRITE" },
              over_cap: false,
            }],
            dropped: [],
            ignored: [],
            pending: [],
            next_wake_at: null,
            plan: { count: 0, cap: 10, over: false },
          },
        };
      };
      plugin.snoozeWakeNotice = (report) => {
        notices.push({ notified: report && report.notified, title: report && report.woken && report.woken[0] && report.woken[0].title });
        try { return origNotice.call(plugin, report); } catch (error) { return false; }
      };
      let ticked = false;
      let tickError = null;
      try {
        ticked = await plugin.snoozeWakeTick(now);
      } catch (error) {
        tickError = String(error && error.message || error);
      }
      plugin.snoozeWakeSpawn = origSpawn;
      plugin.snoozeWakeNotice = origNotice;
      plugin.isSnoozedCacheReady = origReady;
      plugin.snoozeWakeIsDesktop = origDesktop;
      if (tickError) return { ok: false, error: tickError };
      const spawnOk = spawns.length === 1 && JSON.stringify(spawns[0]) === JSON.stringify(["snooze", "wake", "-q", "-f", "json"]);
      const noticeOk = notices.length === 1 && notices[0].notified === "none";
      let noticeDom = false;
      try {
        noticeDom = Array.from(document.querySelectorAll(".notice, .notice-container .notice")).some((el) => /Ready now/.test(String(el.textContent || "")));
      } catch (error) { noticeDom = false; }
      return { ok: Boolean(ticked && spawnOk && noticeOk), ticked, spawns, notices, noticeDom };
    })())()`).catch((error) => ({ ok: false, error: String(error) }));
    record("case-8-linux-waker", Boolean(case8 && case8.ok), JSON.stringify(case8).slice(0, 600));
    if (case8 && case8.ok) {
      const noticeShot = path.join(outDir, "case-8-linux-notice.png");
      await capturePage(client, noticeShot);
      report.screenshots.push(noticeShot);
    }

    // ---- renderer health: no collected window errors, no duplicate hosts ----
    const finalProbe = await client.evaluate(SNOOZE_PROBE).catch(() => ({ defMarks: [], errors: ["probe failed"] }));
    record("no-renderer-errors", Array.isArray(finalProbe.errors) && finalProbe.errors.length === 0, JSON.stringify(finalProbe.errors || null).slice(0, 220));
    const liveKeys = liveDefMarks(finalProbe).map((mark) => mark.key);
    record("no-duplicate-hosts", new Set(liveKeys).size === liveKeys.length, JSON.stringify(liveKeys).slice(0, 220));

    for (const file of noteFiles) {
      try { fs.copyFileSync(file, path.join(outDir, `final-${path.basename(file)}`)); } catch { /* best-effort */ }
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
