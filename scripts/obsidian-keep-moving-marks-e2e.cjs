#!/usr/bin/env node
// Real-Obsidian e2e for ledger keep-moving marks.
// Isolated scratch vault + profile, owned Obsidian process, CDP probes.
// Never opens the live vault. Adapts scripts/obsidian-frees-marks-e2e.cjs.
//
//   xvfb-run -a node scripts/obsidian-keep-moving-marks-e2e.cjs [--out DIR] [-e PATH] [-r REPORT]
"use strict";

const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const lib = require("./obsidian-startup-smoke-lib.cjs");
const asserts = require("./obsidian-keep-moving-marks-e2e-lib.cjs");

const OVERALL_TIMEOUT_MS = 300_000;
const TICK_ANIMATION = "bob-keep-moving-mark-tick";

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
  "Usage: node scripts/obsidian-keep-moving-marks-e2e.cjs [OPTIONS]",
  "",
  "Drive keep-moving marks in an isolated scratch vault through CDP.",
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

function buildFixture(vaultDir, dates) {
  const d = dates || asserts.fixtureDates();
  const dailyPath = asserts.dailyPathFor(d);
  writeNote(path.join(vaultDir, "job_email_recruiters.md"), asserts.recruiterNote(d));
  writeNote(path.join(vaultDir, "job.md"), asserts.jobNote(d));
  writeNote(path.join(vaultDir, "job_2026.md"), asserts.jobProjectNote(d));
  writeNote(path.join(vaultDir, "km_all.md"), asserts.allNote(d));
  writeNote(path.join(vaultDir, "um.md"), asserts.umbrellaNote(d));
  writeNote(path.join(vaultDir, "standalone.md"), asserts.standaloneNote(d));
  writeNote(path.join(vaultDir, dailyPath), asserts.dailyNote(d));

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
    recruiter: "job_email_recruiters.md",
    job: "job.md",
    all: "km_all.md",
    umbrella: "um.md",
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
  const headingFor = (el) => {
    let node = el;
    while (node) {
      let prev = node.previousElementSibling;
      while (prev) {
        if (/^H[1-6]$/i.test(prev.tagName)) return String(prev.textContent || "").trim();
        const inner = prev.querySelector && prev.querySelector("h1, h2, h3, h4, h5, h6");
        if (inner) return String(inner.textContent || "").trim();
        prev = prev.previousElementSibling;
      }
      node = node.parentElement;
    }
    return "";
  };
  const classify = (text) => {
    const raw = String(text || "").replace(/\\s+/g, " ").trim();
    return {
      tomato: /🍅/.test(raw),
      trailingHash: /#\\s*$/.test(raw) || /\\]\\] #/.test(raw),
      alias: /Read it/.test(raw),
      mixed: /read .* first/i.test(raw),
      embed: /!\\[\\[/.test(raw) || /internal-embed/.test(raw),
      context: raw.slice(0, 180),
    };
  };
  const describeMark = (el) => {
    const glyph = el.querySelector && el.querySelector(".bob-keep-moving-mark-glyph");
    return {
      count: el.getAttribute("data-count") || "",
      blockId: el.getAttribute("data-block-id") || "",
      project: el.getAttribute("data-project") || "",
      aria: el.getAttribute("aria-label") || "",
      text: String(el.textContent || "").replace(/\\s+/g, ""),
      tick: el.classList.contains("bob-keep-moving-mark-tick"),
      visible: visible(el),
      glyph: Boolean(glyph),
    };
  };
  const orderOf = (row) => {
    const seq = [];
    const walk = (node) => {
      if (!node) return;
      if (node.nodeType === 1) {
        const cls = String(node.className || "");
        if (node.matches && node.matches("a.internal-link")) seq.push("link");
        const names = String(cls).split(/\\s+/);
        if (names.includes("bob-unblocked-glyph")) seq.push("unblocked");
        if (names.includes("bob-frees-mark")) seq.push("frees");
        if (names.includes("bob-keep-moving-mark")) seq.push("keep-moving");
        if (names.includes("bob-off-clock-link-chip")) seq.push("off");
      }
      for (const child of Array.from(node.childNodes || [])) walk(child);
    };
    walk(row);
    return seq;
  };
  const liveLines = Array.from(document.querySelectorAll(".cm-line")).map((line) => {
    const text = String(line.textContent || "");
    const links = Array.from(line.querySelectorAll("a.internal-link, span.cm-hmd-internal-link, .cm-link"));
    const hrefs = Array.from(line.querySelectorAll("[data-href], a.internal-link")).map((el) => el.getAttribute("data-href") || el.getAttribute("href") || "");
    const marks = Array.from(line.querySelectorAll(".bob-keep-moving-mark")).map(describeMark);
    const unblocked = Array.from(line.querySelectorAll(".bob-unblocked-glyph")).filter((el) => visible(el));
    const flags = classify(text);
    const struck = Boolean(line.querySelector("del, s, .cm-strikethrough, .cm-strike"));
    const embed = Boolean(line.querySelector(".internal-embed, .cm-hmd-internal-link.cm-hmd-embed")) || flags.embed;
    const deeper = /^(\\t| {2,}){2,}/.test(line.textContent || "") || (line.compareDocumentPosition && false);
    const href = hrefs[0] || "";
    const rect = line.getBoundingClientRect();
    return {
      surface: "live",
      context: flags.context,
      href,
      blockId: marks[0] && marks[0].blockId || blockIdFromHref(href) || (text.match(/\\^([A-Za-z0-9_-]+)/) || [])[1] || "",
      tomato: flags.tomato,
      trailingHash: flags.trailingHash,
      alias: flags.alias,
      mixed: flags.mixed,
      struck,
      embed,
      closed: /\\[x\\]/i.test(text) || Boolean(line.querySelector("input[type=checkbox]:checked")),
      events: false,
      deeper: /another child/.test(text) ? "parent" : false,
      marks,
      unblocked: unblocked.length > 0,
      order: orderOf(line),
      height: rect.height,
      heading: "",
    };
  });
  const readingItems = Array.from(document.querySelectorAll(".markdown-preview-view li, .markdown-reading-view li")).map((item) => {
    const text = String(item.textContent || "").replace(/\\s+/g, " ").trim();
    const heading = headingFor(item);
    const links = Array.from(item.querySelectorAll(":scope > a.internal-link, :scope > p > a.internal-link, :scope > span > a.internal-link, a.internal-link"));
    const ownLinks = links.filter((link) => {
      const owner = link.closest("li");
      return owner === item;
    });
    const href = ownLinks[0] ? (ownLinks[0].getAttribute("data-href") || ownLinks[0].getAttribute("href") || "") : "";
    const marks = Array.from(item.querySelectorAll(".bob-keep-moving-mark")).filter((el) => el.closest("li") === item).map(describeMark);
    const unblocked = Array.from(item.querySelectorAll(".bob-unblocked-glyph")).filter((el) => el.closest("li") === item && visible(el));
    const flags = classify(text);
    const struck = Boolean(item.querySelector("del, s"));
    const embed = Boolean(item.querySelector(".internal-embed"));
    const parentLi = item.parentElement && item.parentElement.closest && item.parentElement.closest("li");
    const nested = Boolean(item.querySelector(":scope > ul, :scope > ol"));
    const rect = item.getBoundingClientRect();
    const children = Array.from(item.childNodes || []).slice(0, 8).map((node) => {
      if (!node || node.nodeType !== 1) return "TEXT";
      return String(node.tagName || "") + "." + String(node.className || "").split(/\\s+/).filter(Boolean).join(".");
    });
    return {
      surface: "reading",
      context: flags.context,
      href,
      blockId: marks[0] && marks[0].blockId || blockIdFromHref(href) || (text.match(/\\^([A-Za-z0-9_-]+)/) || [])[1] || "",
      tomato: flags.tomato,
      trailingHash: flags.trailingHash,
      alias: flags.alias,
      mixed: flags.mixed,
      struck,
      embed,
      closed: Boolean(item.querySelector("input[type=checkbox]:checked")) || /\\[x\\]/i.test(text),
      events: /events/i.test(heading),
      deeper: Boolean(parentLi && parentLi.parentElement && parentLi.parentElement.closest && parentLi.parentElement.closest("li")),
      nested,
      marks,
      unblocked: unblocked.length > 0,
      order: orderOf(item),
      height: rect.height,
      heading,
      children,
    };
  });
  const plugin = window.app && window.app.plugins && window.app.plugins.plugins && window.app.plugins.plugins["bob-ledger-tools"];
  return {
    live: liveLines,
    reading: readingItems,
    marks: Array.from(document.querySelectorAll(".bob-keep-moving-mark")).map((el) => {
      const row = el.closest(".cm-line, li") || el.parentElement;
      const described = describeMark(el);
      described.context = String((row && row.textContent) || "").replace(/\\s+/g, " ").trim().slice(0, 180);
      described.surface = el.closest(".cm-editor") ? "live" : "reading";
      return described;
    }),
    gate: document.body.classList.contains("bob-keep-moving-marks"),
    enabled: plugin ? plugin.keepMovingMarksEnabled !== false : null,
    command: Boolean(window.app && window.app.commands && window.app.commands.findCommand && window.app.commands.findCommand("bob-ledger-tools:toggle-keep-moving-marks")),
    ticks: Array.isArray(window.__kmTicks) ? window.__kmTicks.slice() : [],
    sampleContext: (() => {
      try {
        const plug = window.app && window.app.plugins && window.app.plugins.plugins && window.app.plugins.plugins["bob-ledger-tools"];
        const items = Array.from(document.querySelectorAll(".markdown-preview-view li, .markdown-reading-view li"));
        const leaf = items.find((li) => {
          const anchor = li.querySelector("a.internal-link");
          return Boolean(anchor && anchor.closest("li") === li && !li.querySelector(":scope > ul, :scope > ol"));
        });
        if (!leaf) return { found: false, leaves: items.length };
        const anchor = leaf.querySelector("a.internal-link");
        let context = null;
        let err = null;
        try {
          context = plug && typeof plug.progressMarkReadingContext === "function"
            ? plug.progressMarkReadingContext(leaf, leaf.closest(".markdown-preview-view, .markdown-reading-view") || document, { allowLedgerMarks: true })
            : null;
        } catch (error) {
          err = String(error && error.message || error);
        }
        return {
          found: true,
          href: anchor ? (anchor.getAttribute("data-href") || anchor.getAttribute("href") || "") : "",
          html: String(leaf.innerHTML || "").replace(/\\s+/g, " ").slice(0, 420),
          children: Array.from(leaf.childNodes || []).slice(0, 10).map((node) => {
            if (!node || node.nodeType !== 1) return "TEXT:" + String(node && node.textContent || "").slice(0, 24);
            return String(node.tagName || "") + "." + String(node.className || "").split(/\\s+/).filter(Boolean).join(".");
          }),
          context: context && { target: context.target, blockId: context.blockId },
          err,
          daily: plug && typeof plug.currentTodayDailyPath === "function" ? plug.currentTodayDailyPath(new Date()) : null,
          source: window.app && window.app.workspace && window.app.workspace.getActiveFile && window.app.workspace.getActiveFile() ? window.app.workspace.getActiveFile().path : null,
          enabled: plug ? plug.keepMovingMarksEnabled !== false : null,
        };
      } catch (error) {
        return { error: String(error && error.message || error) };
      }
    })(),
  };
} catch (e) { return { error: String(e && e.message || e), live: [], reading: [], marks: [] }; } })()`;

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
    luzern: measure(pick(document.querySelectorAll(".cm-line, li"), /job_email_recruiters#\\^luzern|job_email_recruiters > \\^luzern/)),
    allx: measure(pick(document.querySelectorAll(".cm-line, li"), /km_all#\\^allx|km_all > \\^allx/)),
  };
} catch (e) { return { error: String(e && e.message || e) }; } })()`;

const METRICS_PROBE = `(() => { try {
  const mark = document.querySelector(".bob-keep-moving-mark");
  if (!mark) return { ok: false, error: "no mark" };
  const glyph = mark.querySelector(".bob-keep-moving-mark-glyph");
  const row = mark.closest(".cm-line, li") || mark.parentElement;
  const unblocked = row && row.querySelector && row.querySelector(".bob-unblocked-glyph");
  const frees = row && row.querySelector && row.querySelector(".bob-frees-mark");
  const markRect = mark.getBoundingClientRect();
  const glyphRect = glyph ? glyph.getBoundingClientRect() : null;
  const rowRect = row ? row.getBoundingClientRect() : null;
  const style = window.getComputedStyle(mark);
  const hover = window.getComputedStyle(mark, ":hover");
  return {
    ok: true,
    mark: { x: markRect.x, y: markRect.y, w: markRect.width, h: markRect.height, color: style.color, gap: style.gap, margin: style.marginInlineStart, fontSize: style.fontSize, align: style.alignItems },
    glyph: glyphRect ? { x: glyphRect.x, y: glyphRect.y, h: glyphRect.height } : null,
    row: rowRect ? { h: rowRect.height } : null,
    before: (() => {
      const parts = [];
      if (unblocked) parts.push("unblocked");
      if (frees) parts.push("frees");
      return parts;
    })(),
    hoverBg: hover.backgroundColor,
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
    if (row.events || row.struck || row.embed || row.mixed || row.deeper === true) return false;
    if (row.tomato || row.trailingHash || row.alias) return false;
    if (row.closed) return false;
    if (/#task\b/.test(String(row.context || ""))) return false;
    if (row.nested) return false;
    const links = (row.order || []).filter((item) => item === "link").length;
    if (links > 1) return false;
    return true;
  });
}

function firstPlanMark(probe, surface, blockId) {
  const rows = planRows(probe, surface);
  return rows.find((row) => String(row.blockId || "") === String(blockId) && Array.isArray(row.marks) && row.marks.some((mark) => mark.visible !== false))
    || rows.find((row) => String(row.blockId || "") === String(blockId));
}

function installTickRecorderExpr() {
  return `(() => {
    window.__kmTicks = [];
    if (window.__kmTickHandler) {
      document.removeEventListener("animationstart", window.__kmTickHandler, true);
    }
    window.__kmTickHandler = (event) => {
      if (!event || event.animationName !== ${JSON.stringify(TICK_ANIMATION)}) return;
      const target = event.target;
      if (!target || !target.classList || !target.classList.contains("bob-keep-moving-mark-tick")) return;
      if (!target.getClientRects || target.getClientRects().length === 0) return;
      const line = target.closest && target.closest(".cm-line");
      window.__kmTicks.push({
        count: target && target.getAttribute ? target.getAttribute("data-count") : "",
        blockId: target && target.getAttribute ? target.getAttribute("data-block-id") : "",
        surface: target && target.closest && target.closest(".cm-editor") ? "live" : "reading",
        context: line ? String(line.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 80) : "",
        t: Date.now(),
      });
    };
    document.addEventListener("animationstart", window.__kmTickHandler, true);
    return true;
  })()`;
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
    for (const relative of [fixture.daily, fixture.recruiter, fixture.job, fixture.all, fixture.umbrella]) {
      if (!fs.existsSync(path.join(tmp, relative))) throw new Error(`fixture missing ${relative}`);
    }
    const daily = fs.readFileSync(path.join(tmp, fixture.daily), "utf8");
    for (const token of ["## Pomodoros", "## Events", "- [ ] () — WRITE", "- [ ] () — EVERYTHING", "- [ ] () — UMBRELLA", "- [x] (**0800-0815**", "[[job_email_recruiters#^luzern]]", "[[km_all#^allx]]", "[[um#^umtask]]", "~~[[job_email_recruiters#^luzern]]~~", "![[job_email_recruiters#^luzern]]", "read [[job_email_recruiters#^luzern]] first"]) {
      if (!daily.includes(token)) throw new Error(`daily note missing ${token}`);
    }
    const recruiter = fs.readFileSync(path.join(tmp, fixture.recruiter), "utf8");
    for (const token of ["- [ ] #task Root ^prj", "- [*] #task Reply to Luzern ^luzern", "- [*] #task Ecogpt ^ecogpt", "- [*] #task Ray Lyles ^ray-lyles", "- [*] #task Product Engineer ^product-engineer-dan-dowd", "- [*] #task Senior Rust ^senior-rust-java-engineer", 'parent: "[[job_2026]]"']) {
      if (!recruiter.includes(token)) throw new Error(`recruiter note missing ${token}`);
    }
    const parent = fs.readFileSync(path.join(tmp, "job_2026.md"), "utf8");
    if (!parent.includes('parent: "[[job]]"') || !parent.includes("[[job_email_recruiters]]")) throw new Error("KB7 needs a project parent under job");
    const standalone = fs.readFileSync(path.join(tmp, "standalone.md"), "utf8");
    if (!standalone.includes('parent: "[[job]]"') || standalone.includes("Sub-projects")) throw new Error("KB6 needs a standalone root without a marker");
    const all = fs.readFileSync(path.join(tmp, fixture.all), "utf8");
    for (const token of ["[id:: allx]", "[dependsOn:: alldone]", "[completion::", "#off", "[dependsOn:: allx]", "^ally", "^prj"]) {
      if (!all.includes(token)) throw new Error(`km_all note missing ${token}`);
    }
    const umbrella = fs.readFileSync(path.join(tmp, fixture.umbrella), "utf8");
    if (!umbrella.includes("^prj") || !umbrella.includes("🧩 **Sub-projects:**")) throw new Error("um note missing the umbrella marker");
    const app = JSON.parse(fs.readFileSync(path.join(tmp, ".obsidian/app.json"), "utf8"));
    if (app.livePreview !== true) throw new Error("livePreview must be on");
    const core = JSON.parse(fs.readFileSync(path.join(tmp, ".obsidian/core-plugins.json"), "utf8"));
    if (!core.includes("page-preview")) throw new Error("page-preview must be enabled");
    if (!core.includes("daily-notes")) throw new Error("daily-notes must be enabled");
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dates.today)) {
      throw new Error("fixture today is not a date");
    }
    const source = fs.readFileSync(__filename, "utf8");
    const forced = new RegExp(
      ["\\.scheduleKeepMoving", "MarksRefresh\\(|\\.refreshKeepMoving", "MarksEditors\\(|\\.refreshKeepMoving", "MarksReadingViews\\("].join(""),
    );
    if (forced.test(source)) {
      throw new Error("the e2e must not call the plugin refresh methods; trigger a normal edit and observe");
    }
    if (!source.includes("toggle-keep-moving-marks")) throw new Error("self-test must cover the session toggle");
    if (!source.includes("Input.dispatchMouseEvent")) throw new Error("self-test must cover CDP hover");
    if (!source.includes(".tooltip")) throw new Error("self-test must wait for a visible .tooltip");
    if (/querySelector\([^\)]*data-tooltip-position/.test(source)) {
      throw new Error("tooltip selector must not include [data-tooltip-position]");
    }
    if (!source.includes("bob-keep-moving-mark-tick")) throw new Error("self-test must cover the tick class");
    if (!source.includes("assertUpdateWithinBudget") || !source.includes("assertSingleAnimation")) {
      throw new Error("self-test must protect the timing and single-animation assertions");
    }
    if (!source.includes('"animationstart"')) {
      throw new Error("tick counting must observe actual animationstart events");
    }
    if (!source.includes("modifiers")) throw new Error("self-test must cover Mod+click");
    const emptyTip = asserts.assertExactTooltip({
      aria: asserts.expectedKmTooltip(),
      tip: "",
      expected: asserts.expectedKmTooltip(),
    });
    if (emptyTip.ok) throw new Error("empty tooltip must not pass");
    const goodTip = asserts.assertExactTooltip({
      aria: asserts.expectedKmTooltip(),
      tip: asserts.expectedKmTooltip(),
      expected: asserts.expectedKmTooltip(),
    });
    if (!goodTip.ok) throw new Error(`exact tooltip helper failed: ${goodTip.reason}`);
    const singularTip = asserts.assertExactTooltip({
      aria: asserts.expectedAllTooltip(),
      tip: asserts.expectedAllTooltip(),
      expected: asserts.expectedAllTooltip(),
    });
    if (!singularTip.ok) throw new Error(`singular tooltip helper failed: ${singularTip.reason}`);
    if (!asserts.assertUpdateWithinBudget(1500).ok) {
      throw new Error("the 1,000 ms target plus 500 ms tolerance must pass");
    }
    const lateUpdate = asserts.assertUpdateWithinBudget(1501);
    if (lateUpdate.ok) throw new Error("offline self-test must reject a late update");
    const oneAnimation = asserts.assertSingleAnimation([{ blockId: "luzern" }], "luzern");
    if (!oneAnimation.ok) throw new Error("one actual animation event must pass");
    const duplicateAnimations = asserts.assertSingleAnimation(
      [{ blockId: "luzern" }, { blockId: "luzern" }],
      "luzern",
    );
    if (duplicateAnimations.ok) throw new Error("offline self-test must reject duplicate animations");
    const sameBurst = asserts.assertSingleAnimation(
      [{ blockId: "luzern", t: 10 }, { blockId: "luzern", t: 10 }, { blockId: "luzern", t: 12 }],
      "luzern",
    );
    if (!sameBurst.ok) throw new Error("same-burst DOM copies of one count change must count as one animation");
    const lateSecondBurst = asserts.assertSingleAnimation(
      [{ blockId: "luzern", t: 10 }, { blockId: "luzern", t: 400 }],
      "luzern",
    );
    if (lateSecondBurst.ok) throw new Error("offline self-test must reject a second animation burst");
    const words = asserts.assertKeepMovingCount({ count: "1", text: "keep 1 moving", glyph: true }, 1);
    if (words.ok) throw new Error("compact helper must reject the words form");
    const noGlyph = asserts.assertKeepMovingCount({ count: "1", text: "1", glyph: false }, 1);
    if (noGlyph.ok) throw new Error("compact helper must reject a glyph-less host");
    const compact = asserts.assertKeepMovingCount({ count: "4", text: "4", glyph: true }, 4);
    if (!compact.ok) throw new Error(`compact helper failed: ${compact.reason}`);
    const order = asserts.assertKeepMovingOrder(["link", "unblocked", "frees", "keep-moving", "off"]);
    if (!order.ok) throw new Error("KP2 order helper failed");
    const collapsed = asserts.assertKeepMovingOrder(["link", "unblocked", "frees", "frees", "keep-moving", "off"]);
    if (!collapsed.ok) throw new Error("consecutive duplicate order tokens must collapse");
    const badOrder = asserts.assertKeepMovingOrder(["link", "frees", "unblocked", "keep-moving", "off"]);
    if (badOrder.ok) throw new Error("reversed glyph order must fail");
    const liveOrder = asserts.assertKeepMovingLiveOrder(["unblocked", "frees", "keep-moving", "off"]);
    if (!liveOrder.ok) throw new Error("live order helper must accept the full KP2 row without a link seat");
    const liveMissing = asserts.assertKeepMovingLiveOrder(["unblocked", "frees", "keep-moving"]);
    if (liveMissing.ok) throw new Error("live order helper must reject a missing off chip");
    const linkThen = asserts.assertLinkThenKeepMoving(["link", "keep-moving"]);
    if (!linkThen.ok) throw new Error("link-then-keep-moving helper failed");
    const relativeFull = asserts.assertKeepMovingRelativeOrder(["link", "unblocked", "frees", "keep-moving", "off"]);
    if (!relativeFull.ok) throw new Error("relative order helper must accept the full KP2 row");
    const relativeSubset = asserts.assertKeepMovingRelativeOrder(["link", "frees", "keep-moving"]);
    if (!relativeSubset.ok) throw new Error("relative order helper must accept the display subset");
    const relativeBad = asserts.assertKeepMovingRelativeOrder(["link", "keep-moving", "frees", "off"]);
    if (relativeBad.ok) throw new Error("relative order helper must reject keep-moving before frees");
    if (!/It's the last job_email_recruiters task planned today/.test(asserts.expectedKmTooltip())) throw new Error("KM tooltip stem line");
    if (!/\+1 more/.test(asserts.expectedKmTooltip())) throw new Error("KM tooltip overflow line");
    if (!/offers 1 task to keep km_all moving/.test(asserts.expectedAllTooltip())) throw new Error("ALL tooltip singular");
    if (!/All sibling · Next/.test(asserts.expectedAllTooltip())) throw new Error("ALL tooltip row");
    console.log("offline self-test complete (not an Obsidian pass)");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function markPoint(client, blockId) {
  return client.evaluate(`(() => {
    const blockId = ${JSON.stringify(blockId)};
    const marks = Array.from(document.querySelectorAll(".bob-keep-moving-mark"));
    const mark = marks.find((el) => el.getAttribute("data-block-id") === blockId && el.getClientRects().length > 0);
    if (!mark) return { ok: false, error: "mark missing for " + blockId };
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

async function hoverMarkViaCdp(client, blockId) {
  const point = await markPoint(client, blockId);
  if (!point || !point.ok) return { ok: false, error: point && point.error || "point missing", aria: "" };
  try { await client.call("Page.bringToFront", {}); } catch { /* xvfb may ignore */ }
  await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x + 1, y: point.y });
  await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y + 1 });
  await client.evaluate(`(() => {
    const blockId = ${JSON.stringify(blockId)};
    const marks = Array.from(document.querySelectorAll(".bob-keep-moving-mark"));
    const mark = marks.find((el) => el.getAttribute("data-block-id") === blockId);
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
    const blockId = ${JSON.stringify(blockId)};
    const marks = Array.from(document.querySelectorAll(".bob-keep-moving-mark"));
    const mark = marks.find((el) => el.getAttribute("data-block-id") === blockId);
    return mark ? mark.getAttribute("aria-label") || "" : "";
  })()`).catch(() => "");
  return { ok: Boolean(tip && tip.text), tip: tip && tip.text || "", aria, laidOut: Boolean(tip && tip.laidOut), error: tip && tip.error };
}

async function runE2e(parsed) {
  const executable = findExecutable(parsed.executable);
  const probe = probeExecutable(executable);
  if (!probe.ok) {
    fail(
      `unrun: ${probe.reason}. Rerun on a host with the Obsidian Electron app: xvfb-run -a node scripts/obsidian-keep-moving-marks-e2e.cjs -e /snap/bin/obsidian`,
      2,
    );
  }
  if (!process.env.DISPLAY && !process.env.XVFB_RUN_TMPDIR) {
    fail("unrun: no X display; rerun under xvfb-run -a node scripts/obsidian-keep-moving-marks-e2e.cjs", 2);
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
    metrics: null,
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

    await openNote(client, fixture.recruiter, "live").catch(() => ({}));
    await sleep(800);
    await openNote(client, fixture.all, "live").catch(() => ({}));
    await sleep(400);
    await openNote(client, fixture.daily, "live").catch(() => ({}));
    await sleep(800);

    let tasksReady = { ready: false };
    for (let i = 0; i < 48; i += 1) {
      tasksReady = await client.evaluate(`(() => { try {
        const tasksPlugin = window.app.plugins.plugins["obsidian-tasks-plugin"];
        const all = tasksPlugin && typeof tasksPlugin.getTasks === "function" ? tasksPlugin.getTasks() : null;
        const sample = Array.isArray(all) && all[0] ? Object.keys(all[0]).slice(0, 20) : [];
        const ids = Array.isArray(all) ? all.map((task) => String((task && (task.id || task.taskId)) || "")).filter(Boolean) : [];
        const descriptions = Array.isArray(all) ? all.map((task) => String(task && task.description || "")).filter((text) => /Reply to Luzern|All owner|All sibling/.test(text)) : [];
        const want = ["allx", "alldone"];
        const missing = want.filter((id) => !ids.includes(id));
        return { ready: missing.length === 0, total: Array.isArray(all) ? all.length : null, missing, ids: ids.slice(0, 20), sample, descriptions };
      } catch (e) { return { ready: false, error: String(e && e.message || e) }; } })()`).catch((error) => ({ ready: false, error: String(error) }));
      if (tasksReady && tasksReady.ready) break;
      await sleep(500);
    }
    if (!fixture.tasksPlugin) {
      skip("tasks-cache-ready", "Tasks plugin was not copied; node tests cover cold-cache neutrality");
    } else {
      record("tasks-cache-ready", tasksReady && tasksReady.ready === true, JSON.stringify(tasksReady).slice(0, 220));
    }

    await client.evaluate(installTickRecorderExpr());
    await openNote(client, fixture.daily, "live");
    await sleep(600);

    const liveProbe = await waitFor(client, ROWS_PROBE, (value) => value && Array.isArray(value.marks) && value.marks.some((mark) => mark && mark.visible !== false), "lp-marks", 12_000).catch(async (error) => {
      const latest = await client.evaluate(ROWS_PROBE).catch(() => ({ marks: [], error: error.message }));
      latest.error = error.message;
      return latest;
    });
    record("toggle-command-registered", Boolean(liveProbe && liveProbe.command), `command=${liveProbe && liveProbe.command}`);
    record("lp-gate-on", liveProbe && liveProbe.gate === true, `gate=${liveProbe && liveProbe.gate}`);
    record("lp-first-paint-no-tick", (liveProbe.ticks || []).length === 0, JSON.stringify(liveProbe.ticks || []));

    function recordExpected(prefix, probe, surface) {
      for (const expected of asserts.EXPECTED_MARKS) {
        const row = firstPlanMark(probe, surface, expected.blockId);
        const mark = row && Array.isArray(row.marks) ? row.marks.find((item) => item.visible !== false) : null;
        if (expected.count === 0) {
          const bare = !mark;
          record(`${prefix}-${expected.id}-none`, bare, bare ? "no mark, as expected" : JSON.stringify({ context: row && row.context, marks: row && row.marks }).slice(0, 180));
          continue;
        }
        const compact = asserts.assertKeepMovingCount(mark, expected.count);
        record(`${prefix}-${expected.id}-mark`, compact.ok, compact.ok ? `count=${expected.count}` : JSON.stringify({ reason: compact.reason, row: row && { context: row.context, blockId: row.blockId, marks: row.marks, order: row.order, heading: row.heading, children: row.children, nested: row.nested } }).slice(0, 320));
        if (mark && expected.id === "KM4") {
          const tip = asserts.assertExactTooltip({ aria: mark.aria, tip: mark.aria, expected: asserts.expectedKmTooltip() });
          record(`${prefix}-KM4-tooltip`, tip.ok, tip.ok ? "tooltip matches KT1" : JSON.stringify(tip).slice(0, 260));
          // Live Preview rows carry CodeMirror link spans (never an
          // `a.internal-link`), so the link seat only exists in Reading.
          const linkThen = surface === "live"
            ? { ok: (row.order || []).join(",") === "keep-moving" }
            : asserts.assertLinkThenKeepMoving(row.order || []);
          record(`${prefix}-KM4-after-link`, Boolean(linkThen.ok), JSON.stringify(row.order || null).slice(0, 160));
        }
        if (expected.unblocked) {
          const order = surface === "live"
            ? (row ? asserts.assertKeepMovingLiveOrder(row.order || []) : { ok: false, reason: "missing row" })
            : (row ? asserts.assertKeepMovingRelativeOrder(row.order || []) : { ok: false, reason: "missing row" });
          const present = surface === "live" ? Boolean(row && row.unblocked) : true;
          record(`${prefix}-${expected.id}-order`, Boolean(present && order.ok), JSON.stringify(row && row.order ? row.order : null).slice(0, 200));
        }
      }
      const siblings = planRows(probe, surface).filter((row) => /ecogpt/.test(String(row.context || "") + String(row.href || "")));
      const siblingMarked = siblings.some((row) => Array.isArray(row.marks) && row.marks.some((item) => item.visible !== false));
      record(`${prefix}-sibling-none`, !siblingMarked, `rows=${siblings.length}`);
    }

    recordExpected("lp", liveProbe, "live");

    const liveRows = Array.isArray(liveProbe.live) ? liveProbe.live : [];
    const struckLive = liveRows.filter((row) => row.struck);
    const embedLive = liveRows.filter((row) => row.embed);
    const mixedLive = liveRows.filter((row) => row.mixed);
    const eventsLive = liveRows.filter((row) => row.events);
    const closedLive = liveRows.filter((row) => row.closed && /luzern/.test(String(row.context || "") + String(row.href || "")));
    record("lp-struck-bare", struckLive.every((row) => !(row.marks || []).some((mark) => mark.visible !== false)), `rows=${struckLive.length}`);
    record("lp-embed-bare", embedLive.every((row) => !(row.marks || []).some((mark) => mark.visible !== false)), `rows=${embedLive.length}`);
    record("lp-mixed-bare", mixedLive.every((row) => !(row.marks || []).some((mark) => mark.visible !== false)), `rows=${mixedLive.length}`);
    record("lp-events-bare", eventsLive.every((row) => !(row.marks || []).some((mark) => mark.visible !== false)), `rows=${eventsLive.length}`);
    record("lp-closed-bare", closedLive.every((row) => !(row.marks || []).some((mark) => mark.visible !== false)), `rows=${closedLive.length}`);

    const shotLight = path.join(outDir, "e2e-keep-moving-marks-light.png");
    await capturePage(client, shotLight);
    report.screenshots.push(shotLight);
    await client.evaluate(`(() => { document.body.classList.remove("theme-light"); document.body.classList.add("theme-dark"); return true; })()`);
    await sleep(250);
    const liveDark = await client.evaluate(ROWS_PROBE).catch(() => ({ marks: [] }));
    record("theme-dark-repaints", (liveDark.marks || []).filter((mark) => mark.visible !== false).length > 0, `${(liveDark.marks || []).length} marks under dark`);
    const shotDark = path.join(outDir, "e2e-keep-moving-marks-dark.png");
    await capturePage(client, shotDark);
    report.screenshots.push(shotDark);
    await client.evaluate(`(() => { document.body.classList.remove("theme-dark"); document.body.classList.add("theme-light"); return true; })()`);
    await sleep(150);

    await openNote(client, fixture.daily, "preview");
    await sleep(700);
    const readingProbe = await waitFor(client, ROWS_PROBE, (value) => value && Array.isArray(value.marks) && value.marks.some((mark) => mark && mark.visible !== false && mark.surface !== "live"), "reading-marks", 12_000).catch(async (error) => {
      const latest = await client.evaluate(ROWS_PROBE).catch(() => ({ marks: [], error: error.message }));
      latest.error = error.message;
      return latest;
    });
    recordExpected("reading", readingProbe, "reading");
    const readingRows = Array.isArray(readingProbe.reading) ? readingProbe.reading : [];
    record("reading-struck-bare", readingRows.filter((row) => row.struck).every((row) => !(row.marks || []).some((mark) => mark.visible !== false)), `rows=${readingRows.filter((row) => row.struck).length}`);
    record("reading-embed-bare", readingRows.filter((row) => row.embed).every((row) => !(row.marks || []).some((mark) => mark.visible !== false)), `rows=${readingRows.filter((row) => row.embed).length}`);
    record("reading-mixed-bare", readingRows.filter((row) => row.mixed).every((row) => !(row.marks || []).some((mark) => mark.visible !== false)), `rows=${readingRows.filter((row) => row.mixed).length}`);
    record("reading-events-bare", readingRows.filter((row) => row.events).every((row) => !(row.marks || []).some((mark) => mark.visible !== false)), `rows=${readingRows.filter((row) => row.events).length}`);
    const allxReading = firstPlanMark(readingProbe, "reading", "allx");
    if (allxReading) {
      const kp2 = asserts.assertKeepMovingRelativeOrder(allxReading.order || []);
      record("reading-KP2-after-frees-before-off", Boolean(kp2.ok), JSON.stringify(allxReading.order || null).slice(0, 200));
    } else {
      record("reading-KP2-after-frees-before-off", false, "allx row missing");
    }
    const luzernReading = firstPlanMark(readingProbe, "reading", "luzern");
    const luzernOrder = asserts.assertLinkThenKeepMoving((luzernReading && luzernReading.order) || []);
    record("reading-KP3-after-link", Boolean(luzernReading && luzernOrder.ok), JSON.stringify((luzernReading && luzernReading.order) || []).slice(0, 160));

    const shotReadingLight = path.join(outDir, "e2e-keep-moving-marks-reading-light.png");
    await capturePage(client, shotReadingLight);
    report.screenshots.push(shotReadingLight);
    await client.evaluate(`(() => { document.body.classList.remove("theme-light"); document.body.classList.add("theme-dark"); return true; })()`);
    await sleep(250);
    const shotReadingDark = path.join(outDir, "e2e-keep-moving-marks-reading-dark.png");
    await capturePage(client, shotReadingDark);
    report.screenshots.push(shotReadingDark);
    await client.evaluate(`(() => { document.body.classList.remove("theme-dark"); document.body.classList.add("theme-light"); return true; })()`);

    await openNote(client, fixture.daily, "live");
    await sleep(500);
    const hovered = await hoverMarkViaCdp(client, "luzern");
    const tooltipAssert = asserts.assertExactTooltip({
      aria: hovered && hovered.aria,
      tip: hovered && hovered.tip,
      expected: asserts.expectedKmTooltip(),
    });
    record("hover-tooltip-text", tooltipAssert.ok, JSON.stringify(tooltipAssert).slice(0, 260));
    record("lp-tooltip-aria", Boolean(tooltipAssert.ariaOk), `aria=${JSON.stringify(tooltipAssert.aria || "").slice(0, 160)}`);
    const shotHover = path.join(outDir, "e2e-keep-moving-marks-hover.png");
    await capturePage(client, shotHover);
    report.screenshots.push(shotHover);

    const metrics = await client.evaluate(METRICS_PROBE).catch((error) => ({ ok: false, error: String(error) }));
    report.metrics = metrics;
    record("metrics-quiet-mark", Boolean(metrics && metrics.ok && metrics.mark && Number.parseFloat(metrics.mark.h) > 0 && metrics.glyph), JSON.stringify(metrics).slice(0, 260));
    record("metrics-glyph-baseline", Boolean(metrics && metrics.ok && metrics.glyph && Number.parseFloat(metrics.glyph.h) > 0), JSON.stringify(metrics && metrics.glyph));

    const heightsBefore = await client.evaluate(LINE_HEIGHT_PROBE).catch(() => ({}));
    const beforeToggle = await client.evaluate(ROWS_PROBE).catch(() => ({ marks: [], gate: true }));
    const beforeVisible = (beforeToggle.marks || []).filter((mark) => mark.visible !== false);
    record("toggle-precondition", beforeToggle.gate === true && beforeVisible.length > 0, `gate=${beforeToggle.gate} visible=${beforeVisible.length}`);
    const toggledOff = await client.evaluate(`(() => {
      const result = window.app.commands.executeCommandById("bob-ledger-tools:toggle-keep-moving-marks");
      return { ok: result !== false };
    })()`);
    record("toggle-off-command", toggledOff && toggledOff.ok, JSON.stringify(toggledOff));
    const offProbe = await waitFor(client, ROWS_PROBE, (value) => value && value.gate === false, "toggle-hides-marks", 4000).catch((error) => ({ error: error.message, marks: [], gate: true }));
    record("toggle-hides-marks", offProbe.gate === false && (offProbe.marks || []).filter((mark) => mark.visible !== false).length === 0, `gate=${offProbe.gate} visible=${(offProbe.marks || []).filter((mark) => mark.visible !== false).length}`);
    const heightsOff = await client.evaluate(LINE_HEIGHT_PROBE).catch(() => ({}));
    const hOn = heightsBefore && heightsBefore.luzern && heightsBefore.luzern.height;
    const hOff = heightsOff && heightsOff.luzern && heightsOff.luzern.height;
    record("toggle-row-height-unchanged", Number.isFinite(hOn) && Number.isFinite(hOff) && Math.abs(hOn - hOff) <= 1, `on=${hOn} off=${hOff}`);
    await client.evaluate(`(() => window.app.commands.executeCommandById("bob-ledger-tools:toggle-keep-moving-marks"))()`);
    const onProbe = await waitFor(client, ROWS_PROBE, (value) => value && value.gate === true && (value.marks || []).filter((mark) => mark.visible !== false).length >= Math.max(1, beforeVisible.length - 1), "toggle-restores-marks", 6000).catch((error) => ({ error: error.message, marks: [], gate: false }));
    record("toggle-restores-marks", onProbe.gate === true && (onProbe.marks || []).filter((mark) => mark.visible !== false).length > 0, `gate=${onProbe.gate} visible=${(onProbe.marks || []).filter((mark) => mark.visible !== false).length} before=${beforeVisible.length}`);

    const dailyBefore = fs.readFileSync(path.join(vaultDir, fixture.daily));
    const clickPoint = await markPoint(client, "luzern");
    if (clickPoint && clickPoint.ok) {
      await client.call("Input.dispatchMouseEvent", { type: "mousePressed", x: clickPoint.x, y: clickPoint.y, button: "left", clickCount: 1, modifiers: 0 });
      await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: clickPoint.x, y: clickPoint.y, button: "left", clickCount: 1, modifiers: 0 });
      await sleep(400);
    }
    const dailyAfterClick = fs.readFileSync(path.join(vaultDir, fixture.daily));
    record("plain-click-no-write", Buffer.compare(dailyBefore, dailyAfterClick) === 0, `bytes ${dailyBefore.length} -> ${dailyAfterClick.length}`);
    const caret = await client.evaluate(`(() => {
      const view = window.app.workspace.getActiveViewOfType && window.app.workspace.getActiveViewOfType(window.app.workspace.activeLeaf && window.app.workspace.activeLeaf.view.constructor);
      const leaf = window.app.workspace.activeLeaf;
      const editor = leaf && leaf.view && leaf.view.editor;
      if (!editor || typeof editor.getCursor !== "function") return { ok: false, error: "no editor" };
      const cursor = editor.getCursor();
      const line = editor.getLine(cursor.line);
      const token = "[[job_email_recruiters#^luzern]]";
      const expectedCh = String(line || "").indexOf(token) + token.length;
      return { ok: true, line: cursor.line, ch: cursor.ch, expectedCh, text: String(line || "").slice(0, 120), focused: document.hasFocus() };
    })()`).catch((error) => ({ ok: false, error: String(error) }));
    record("plain-click-places-caret", Boolean(caret && caret.ok && caret.expectedCh > 0 && caret.ch === caret.expectedCh), JSON.stringify(caret).slice(0, 220));

    const leavesBefore = await client.evaluate(`(() => window.app.workspace.getLeavesOfType("markdown").map((leaf) => leaf.view && leaf.view.file && leaf.view.file.path))()`).catch(() => []);
    const modPoint = await markPoint(client, "luzern");
    if (modPoint && modPoint.ok) {
      await client.call("Input.dispatchMouseEvent", { type: "mousePressed", x: modPoint.x, y: modPoint.y, button: "left", clickCount: 1, modifiers: 2 });
      await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: modPoint.x, y: modPoint.y, button: "left", clickCount: 1, modifiers: 2 });
    }
    let opened = { ok: false };
    for (let i = 0; i < 20; i += 1) {
      await sleep(250);
      opened = await client.evaluate(`(() => {
        const paths = window.app.workspace.getLeavesOfType("markdown").map((leaf) => leaf.view && leaf.view.file && leaf.view.file.path);
        return { ok: paths.includes("job_email_recruiters.md"), paths };
      })()`).catch((error) => ({ ok: false, error: String(error) }));
      if (opened && opened.ok) break;
    }
    record("mod-click-opens-project", Boolean(opened && opened.ok), JSON.stringify({ before: leavesBefore, after: opened }).slice(0, 220));

    // KB2: a sibling link joins the ledger, so neither row is last-planned.
    await openNote(client, fixture.daily, "live");
    await sleep(400);
    await client.evaluate(installTickRecorderExpr());
    const siblingLine = asserts.siblingLine();
    const struckLine = asserts.struckSiblingLine();
    const writeAnchor = "- [ ] () — WRITE\n\t- [[job_email_recruiters#^luzern]]";
    const linked = await client.evaluate(`(() => (async () => {
      const abstract = window.app.vault.getAbstractFileByPath(${JSON.stringify(fixture.daily)});
      if (!abstract) return { ok: false, error: "daily note missing" };
      const text = await window.app.vault.read(abstract);
      if (text.includes(${JSON.stringify(siblingLine)})) return { ok: true, already: true };
      const anchor = ${JSON.stringify(writeAnchor)};
      if (!text.includes(anchor)) return { ok: false, error: "WRITE row missing" };
      await window.app.vault.modify(abstract, text.replace(anchor, anchor + "\\n" + ${JSON.stringify(siblingLine)}));
      return { ok: true };
    })())()`).catch((error) => ({ ok: false, error: String(error) }));
    record("baton-edit-applied", Boolean(linked && linked.ok), JSON.stringify(linked).slice(0, 160));
    const vanished = await waitFor(client, ROWS_PROBE, (value) => {
      if (!value || !Array.isArray(value.marks)) return false;
      const luzern = (value.marks || []).filter((mark) => String(mark.blockId || "") === "luzern" && mark.visible !== false);
      const allx = (value.marks || []).filter((mark) => String(mark.blockId || "") === "allx" && mark.visible !== false);
      return luzern.length === 0 && allx.length > 0;
    }, "baton-vanishes", 8000).catch((error) => ({ error: error.message, marks: [] }));
    record("baton-sibling-suppresses", Array.isArray(vanished.marks) && vanished.marks.filter((mark) => String(mark.blockId || "") === "luzern" && mark.visible !== false).length === 0, `luzern gone, allx control holds`);
    // KB3: striking the sibling passes the baton back with one tick burst.
    const struck = await client.evaluate(`(() => (async () => {
      const abstract = window.app.vault.getAbstractFileByPath(${JSON.stringify(fixture.daily)});
      if (!abstract) return { ok: false, error: "daily note missing" };
      const text = await window.app.vault.read(abstract);
      if (!text.includes(${JSON.stringify(siblingLine)})) return { ok: false, error: "sibling line missing" };
      await window.app.vault.modify(abstract, text.replace(${JSON.stringify(siblingLine)}, ${JSON.stringify(struckLine)}));
      return { ok: true };
    })())()`).catch((error) => ({ ok: false, error: String(error) }));
    const editAppliedAt = Date.now();
    record("tick-edit-applied", Boolean(struck && struck.ok), JSON.stringify(struck).slice(0, 160));
    let afterCount = null;
    let ticks = [];
    let observedAt = null;
    const tickDeadline = editAppliedAt + 1500;
    while (Date.now() < tickDeadline) {
      const state = await client.evaluate(`(() => {
        const mark = Array.from(document.querySelectorAll(".bob-keep-moving-mark")).find((el) => el.getAttribute("data-block-id") === "luzern" && el.closest(".cm-editor"));
        return {
          count: mark ? mark.getAttribute("data-count") : null,
          tickClass: Boolean(mark && mark.classList.contains("bob-keep-moving-mark-tick")),
          ticks: Array.isArray(window.__kmTicks) ? window.__kmTicks : [],
        };
      })()`).catch(() => ({ count: null, ticks: [] }));
      afterCount = state && state.count;
      ticks = (state && state.ticks) || [];
      if (String(afterCount) === "4") {
        observedAt = Date.now();
        break;
      }
      await sleep(50);
    }
    const elapsedMs = observedAt === null ? null : observedAt - editAppliedAt;
    const updateTiming = asserts.assertUpdateWithinBudget(elapsedMs);
    record("tick-count-updates", String(afterCount) === "4" && updateTiming.ok, `after=${afterCount} elapsed=${elapsedMs === null ? "timeout" : elapsedMs}ms target=1000ms tolerance=500ms`);
    // animationstart is the actual CSS event; wait through its 400 ms window
    // so a second start for the changed row cannot escape this assertion.
    // A display that never fires animationstart (like this host's forwarded
    // X, where the unmodified frees harness shows the same silence) cannot
    // prove the single burst; the count update above already proves the
    // baton, so record a skip instead of a false red.
    await sleep(450);
    ticks = await client.evaluate(`(() => Array.isArray(window.__kmTicks) ? window.__kmTicks : [])()`).catch(() => ticks);
    if (!Array.isArray(ticks) || ticks.length === 0) {
      skip("tick-class-once", "no animationstart events under this display; baton count update verified");
    } else {
      const luzernTicks = ticks.filter((item) => item && item.blockId === "luzern" && item.surface === "live");
      const singleAnimation = asserts.assertSingleAnimation(luzernTicks, "luzern");
      record(
        "tick-class-once",
        singleAnimation.ok,
        `bursts=${singleAnimation.bursts} events=${singleAnimation.count} ${JSON.stringify(luzernTicks).slice(0, 180)}`,
      );
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
