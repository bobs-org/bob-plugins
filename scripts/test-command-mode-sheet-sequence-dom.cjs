// Production DOM coverage for command-mode sequences: real HTMLElements,
// native listeners, and Chromium MouseEvent dispatch. Does not use ElementStub
// `.classes` or `_listeners`.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const repoRoot = path.resolve(__dirname, "..");
const pluginRoot = path.join(repoRoot, "plugins/bob-command-mode");

function findChromium() {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH;
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    const found = spawnSync("which", [name], { encoding: "utf8" });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  throw new Error("Could not find Chromium. Set CHROMIUM_PATH to a browser executable.");
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const wait = this.pending.get(message.id);
      if (!wait) return;
      this.pending.delete(message.id);
      if (message.error) wait.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else wait.resolve(message.result || {});
    });
  }

  static async connect(endpoint) {
    let Socket = typeof globalThis.WebSocket === "function" ? globalThis.WebSocket : null;
    if (!Socket) Socket = require("undici").WebSocket;
    const socket = new Socket(endpoint);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    return new CdpClient(socket);
  }

  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    }
    return response.result && response.result.value;
  }
}

async function waitFor(file, child, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(file)) return;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error("Chromium exited before publishing its DevTools port (exit " + child.exitCode + ").");
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for Chromium's DevTools port file.");
}

function pageHtml() {
  const source = fs.readFileSync(path.join(pluginRoot, "main.js"), "utf8");
  const css = fs.readFileSync(path.join(pluginRoot, "styles.css"), "utf8");
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>${css}</style></head>
<body>
<script>
HTMLElement.prototype.createEl = function(tag, options) {
  options = options || {};
  const el = document.createElement(tag || "div");
  if (options.cls) el.className = Array.isArray(options.cls) ? options.cls.join(" ") : String(options.cls);
  if (options.text != null) el.textContent = String(options.text);
  if (options.attr) Object.keys(options.attr).forEach((key) => el.setAttribute(key, options.attr[key]));
  this.appendChild(el);
  return el;
};
HTMLElement.prototype.empty = function() { this.replaceChildren(); };
HTMLElement.prototype.addClass = function(name) { this.classList.add(name); };
HTMLElement.prototype.removeClass = function(name) { this.classList.remove(name); };
HTMLElement.prototype.setText = function(value) { this.textContent = String(value); };
class Modal {
  constructor(app) {
    this.app = app;
    this.containerEl = document.createElement("div");
    this.modalEl = document.createElement("div");
    this.contentEl = document.createElement("div");
    this.containerEl.appendChild(this.modalEl);
    this.modalEl.appendChild(this.contentEl);
    document.body.appendChild(this.containerEl);
  }
  open() { if (typeof this.onOpen === "function") this.onOpen(); }
  close() { this._closed = true; if (typeof this.onClose === "function") this.onClose(); }
}
class Notice { constructor() {} hide() {} }
class Plugin {}
class PluginSettingTab {}
class Setting { constructor() {} setName() { return this; } setDesc() { return this; } addText() { return this; } addToggle() { return this; } addSlider() { return this; } }
class MarkdownView {}
window.require = function(name) {
  if (name === "obsidian") return { Modal, Notice, Plugin, PluginSettingTab, Setting, MarkdownView, setIcon() {} };
  if (name === "fs") return { readdirSync() { throw new Error("no runs"); }, existsSync() { return false; }, mkdirSync() {}, readFileSync() { return "{}"; }, writeFileSync() {}, chmodSync() {} };
  if (name === "path") return { join(...parts) { return parts.join("/"); } };
  if (name === "os") return { homedir() { return "/tmp"; }, tmpdir() { return "/tmp"; } };
  if (name === "child_process") return { spawn() { return { stdout: { on() {} }, stderr: { on() {} }, on() {}, kill() {} }; }, execFile() {} };
  throw new Error("unexpected require " + name);
};
window.module = { exports: {} };
window.exports = window.module.exports;
eval(${JSON.stringify(source)});
window.BobCommandModePlugin = module.exports;
window.helpers = module.exports.helpers;
window.commandModeDomReady = true;
</script>
</body></html>`;
}

function catalogJson() {
  return {
    schema_version: 1, ok: true, protocol: 1, bob_version: "0.3.1-test",
    features: [], sections: [{ id: "daily", title: "Daily workflow" }, { id: "vault", title: "Vault" }],
    roots: ["plan"], aliases: [], excluded: [],
    entries: [
      {
        id: "plan", path: ["plan"], fixed: [], title: "Today's plan", about: "Show today's plan",
        section: "daily", keywords: ["plan"], effect: "reads", network: false, presentation: "report",
        policy: "run", preview: null, confirm: null, budget_secs: 60, args: [], exit_codes: [],
        adapter: null, hosts: [], invalidates: [],
      },
      {
        id: "vault-sync", path: ["vault-sync", "run"], fixed: [], title: "Sync vault now",
        about: "Run one reconcile cycle", section: "vault", keywords: ["sync"], effect: "syncs",
        network: false, presentation: "action", policy: "run", preview: null, confirm: null,
        budget_secs: 60, args: [], exit_codes: [], adapter: null, hosts: [], invalidates: [],
      },
      {
        id: "task-archive", path: ["task", "archive"], fixed: [], title: "Archive done tasks",
        about: "Archive", section: "daily", keywords: ["archive"], effect: "writes", network: false,
        presentation: "action", policy: "confirm", preview: null, confirm: "Archive every done task?",
        budget_secs: 60, args: [], exit_codes: [], adapter: null, hosts: [], invalidates: ["tasks"],
      },
    ],
  };
}

test("production sheet render and clicks use real DOM APIs", { timeout: 30000 }, async () => {
  const htmlFile = path.join(os.tmpdir(), "bob-cmd-seq-dom-" + process.pid + ".html");
  fs.writeFileSync(htmlFile, pageHtml());
  const chromium = findChromium();
  const profile = fs.mkdtempSync(path.join("/tmp", "bob-cmd-seq-dom-"));
  const child = spawn(chromium, [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
    "--remote-debugging-port=0", "--user-data-dir=" + profile, "about:blank",
  ], { stdio: "ignore", env: { ...process.env, TMPDIR: "/tmp" } });
  let client = null;
  try {
    const portFile = path.join(profile, "DevToolsActivePort");
    await waitFor(portFile, child);
    const port = fs.readFileSync(portFile, "utf8").split(/\s+/)[0];
    const pages = await fetch("http://127.0.0.1:" + port + "/json/list").then((response) => response.json());
    const page = pages.find((item) => item.type === "page");
    if (!page) throw new Error("Chromium did not publish a DevTools page.");
    client = await CdpClient.connect(page.webSocketDebuggerUrl);
    await client.call("Page.enable");
    await client.call("Runtime.enable");
    await client.call("Page.navigate", { url: pathToFileURL(htmlFile).href });
    const start = Date.now();
    while (Date.now() - start < 15000) {
      if (await client.evaluate("Boolean(window.commandModeDomReady && window.helpers)")) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const result = await client.evaluate("(" + function browserCases(catalog) {
      const helpers = window.helpers;
      const plugin = {
        app: { workspace: {}, commands: { commands: {}, executeCommandById: async () => ({ ok: true }) } },
        commandModeCatalog: catalog,
        commandModeRunner: {
          host: "athena",
          catalog: () => catalog,
          fs: () => ({ readdirSync() { throw new Error("no runs"); } }),
          runsDir: () => "/tmp/runs",
          run: async (argv, opts) => {
            window.__runs.push({ argv, opts });
            return { ok: true, runId: "run-1" };
          },
        },
        commandModeSequences: new Map(),
        commandModeSequenceIsActive() { return false; },
        commandModeRunSequence: async (steps) => {
          window.__sequences.push(steps);
          return { ok: true };
        },
      };
      window.__runs = [];
      window.__sequences = [];
      const modal = new helpers.CommandModeSheetModal(plugin.app, plugin, {
        surfaceAvailable: () => true,
        context: { notePath: null, noteKind: null, clipboardUrl: null },
      });
      plugin.commandModeSheet = modal;
      modal.open();
      modal.query = "";
      modal.rebuildRows();
      modal.render();
      const plan = modal.visible.find((row) => row && row.key === "entry:plan");
      const sync = modal.visible.find((row) => row && row.key === "entry:vault-sync");
      let activated = 0;
      modal.activateRow = async function wrappedActivate() {
        activated += 1;
        return { ok: true, counted: true };
      };
      const planEl = modal.rowEls.get(plan.key);
      const pathEl = planEl.querySelector(".bob-cmd-row-path");
      pathEl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      const plainClick = { activated, marks: modal.sequenceMarks.length };
      activated = 0;
      modal.rowEls.get(plan.key).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
      const markedPlan = modal.rowEls.get(plan.key);
      const ctrlClick = {
        activated,
        marks: modal.sequenceMarks.length,
        badge: Boolean(markedPlan && markedPlan.querySelector(".bob-cmd-row-mark")),
        tint: Boolean(markedPlan && markedPlan.classList.contains("is-marked")),
      };
      activated = 0;
      modal.rowEls.get(sync.key).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      const markedSync = modal.rowEls.get(sync.key);
      const pendingMarkClick = {
        activated,
        marks: modal.sequenceMarks.length,
        badge: Boolean(markedSync && markedSync.querySelector(".bob-cmd-row-mark")),
        tint: Boolean(markedSync && markedSync.classList.contains("is-marked")),
      };
      const steps = [
        { argv: ["vault-sync", "run"], entry_id: "vault-sync", title: "Sync vault now" },
        { argv: ["plan"], entry_id: "plan", title: "Today's plan" },
      ];
      const stamp = helpers.cmSequenceStamp("seq-dom", 0, steps, Date.parse("2026-10-26T12:00:00.000Z"));
      modal.refreshRecords = function keepInjectedRecords() {};
      modal.runRecords = [{
        id: "run-seq-0", argv: ["bob", "vault-sync", "run"], entry_id: "vault-sync",
        title: "Sync vault now", outcome: "completed", started_at: "2026-10-26T12:00:00.000Z",
        finished_at: "2026-10-26T12:00:04.000Z", duration_ms: 4000, sequence: stamp,
      }, {
        id: "run-seq-1", argv: ["bob", "plan"], entry_id: "plan",
        title: "Today's plan", outcome: "completed", started_at: "2026-10-26T12:00:04.000Z",
        finished_at: "2026-10-26T12:00:06.000Z", duration_ms: 2000,
        sequence: helpers.cmSequenceStamp("seq-dom", 1, steps, Date.parse("2026-10-26T12:00:00.000Z")),
      }];
      modal.query = "";
      modal.rebuildRows();
      modal.render();
      const seqRow = modal.visible.find((row) => row && row.kind === "recent" && row.sequenceId === "seq-dom");
      const seqEl = seqRow ? modal.rowEls.get(seqRow.key) : null;
      const recent = {
        found: Boolean(seqRow),
        path: seqRow && seqRow.path,
        separatorSpans: seqEl ? seqEl.querySelectorAll(".bob-cmd-row-seq-sep").length : 0,
        durationChips: seqEl ? seqEl.querySelectorAll(".bob-cmd-row-duration").length : 0,
        parts: seqEl ? seqEl.querySelectorAll(".bob-cmd-row-seq-part").length : 0,
      };
      modal.sequenceMarks = [];
      plugin.commandModeSequences = new Map([["seq-dom", { id: "seq-dom", index: 1, steps }]]);
      modal.runRecords = [{
        id: "run-live", argv: ["bob", "vault-sync", "run"], entry_id: "vault-sync",
        title: "Sync vault now", outcome: "running", started_at: "2026-10-26T12:00:00.000Z",
        sequence: helpers.cmSequenceStamp("seq-dom", 0, steps, Date.parse("2026-10-26T12:00:00.000Z")),
      }];
      modal.rebuildRows();
      modal.render();
      const live = modal.visible.find((row) => row && row.sequenceId === "seq-dom");
      const argsShift = { previewed: 0, warned: false };
      modal.sequenceMarks = [];
      modal.stage = "args";
      modal.query = "old.md New";
      modal.argEntry = catalog.entries.find((entry) => entry.id === "plan");
      modal.argRow = plan;
      modal.runArgumentStage = async () => { argsShift.previewed += 1; return { ok: true }; };
      modal.handleSheetKeydown(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true }));
      argsShift.warned = String(modal.hint || "").includes("previews one command");
      modal.close();
      return {
        plainClick,
        ctrlClick,
        pendingMarkClick,
        recent,
        live: { state: live && live.state, glyph: live && live.glyph },
        argsShift,
        dom: {
          classesType: typeof planEl.classes,
          childrenFindType: typeof planEl.children.find,
          listenersType: typeof planEl._listeners,
        },
      };
    }.toString() + ")(" + JSON.stringify(catalogJson()) + ")");

    assert.equal(result.dom.classesType, "undefined");
    assert.equal(result.dom.childrenFindType, "undefined");
    assert.equal(result.dom.listenersType, "undefined");
    assert.equal(result.plainClick.activated, 1);
    assert.equal(result.plainClick.marks, 0);
    assert.equal(result.ctrlClick.activated, 0);
    assert.equal(result.ctrlClick.marks, 1);
    assert.equal(result.ctrlClick.badge, true);
    assert.equal(result.ctrlClick.tint, true);
    assert.equal(result.pendingMarkClick.activated, 0);
    assert.equal(result.pendingMarkClick.marks, 2);
    assert.equal(result.pendingMarkClick.badge, true);
    assert.equal(result.pendingMarkClick.tint, true);
    assert.equal(result.recent.separatorSpans, 1);
    assert.equal(result.recent.durationChips, 1);
    assert.equal(result.recent.parts, 2);
    assert.equal(result.live.state, "running");
    assert.equal(result.live.glyph, "⟳");
    assert.equal(result.argsShift.previewed, 1);
    assert.equal(result.argsShift.warned, false);
  } finally {
    if (client) client.socket.close();
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch (error) { /* already gone */ }
      }, 1500);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        fs.rmSync(profile, { recursive: true, force: true });
        break;
      } catch (error) {
        if (attempt === 4) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    try { fs.unlinkSync(htmlFile); } catch (error) { /* best effort */ }
  }
});
