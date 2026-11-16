#!/usr/bin/env node
// Render the production window-prefix painter plus styles.css in headless Chromium.
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const repoRoot = path.resolve(__dirname, "..");
const pluginRoot = path.join(repoRoot, "plugins/bob-navigation-hotkeys");

function parseArgs(argv) {
  const args = { out: path.join("/tmp", "bob-window-prefix-preview") };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--out" && argv[index + 1]) args.out = path.resolve(argv[++index]);
    else if (argv[index] === "--help" || argv[index] === "-h") {
      console.log("Usage: node scripts/preview-window-prefix.cjs [--out DIRECTORY]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return args;
}

function findChromium() {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH;
  for (const name of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]) {
    const found = spawnSync("which", [name], { encoding: "utf8" });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  for (const candidate of ["/usr/bin/google-chrome", "/snap/bin/chromium"]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  const cache = path.join(os.homedir(), ".cache/ms-playwright");
  if (fs.existsSync(cache)) {
    const candidates = [];
    for (const browserDir of fs.readdirSync(cache)) {
      if (!browserDir.startsWith("chromium-")) continue;
      for (const platformDir of ["chrome-linux64", "chrome-linux", "chrome-headless-shell-linux64"]) {
        for (const name of ["chrome", "chrome-headless-shell", "headless_shell"]) {
          const executable = path.join(cache, browserDir, platformDir, name);
          if (fs.existsSync(executable)) candidates.push(executable);
        }
      }
    }
    if (candidates.length) return candidates.sort().at(-1);
  }
  throw new Error("Could not find headless Chromium. Set CHROMIUM_PATH to an installed browser executable.");
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function loadProductionHelpers() {
  class TestPlugin {}
  const originalLoad = Module._load;
  Module._load = function loadWithObsidianStubs(request) {
    if (request === "obsidian") {
      return {
        MarkdownView: class {},
        Modal: class {},
        Notice: class {},
        Platform: { isDesktopApp: true },
        Plugin: TestPlugin,
        normalizePath: (value) => value,
        parseYaml: (text) => JSON.parse(text),
      };
    }
    if (request === "@codemirror/state") return { Prec: { highest: (value) => value } };
    if (request === "@codemirror/view") {
      return { EditorView: { updateListener: { of: (listener) => ({ listener }) } }, keymap: { of: (value) => value } };
    }
    return originalLoad.apply(this, arguments);
  };
  let helpers;
  try {
    helpers = require("../plugins/bob-navigation-hotkeys/main.js").helpers;
    if (!helpers || typeof helpers.createWindowHintHost !== "function") {
      throw new Error("Window-hint helpers missing from the built bundle; run npm run build first.");
    }
  } finally {
    Module._load = originalLoad;
  }
  return helpers;
}

function split(id, x, leaves, options = {}) {
  const width = options.width ?? 100;
  return {
    id,
    rect: { left: x, top: options.top ?? 0, right: x + width, bottom: (options.top ?? 0) + 100 },
    leaves,
    selectedLeafId: options.selected ?? leaves[leaves.length - 1]?.id,
    recency: options.recency ?? 0,
  };
}

function leaf(id, options = {}) {
  return { id, label: options.label ?? id, pinned: options.pinned === true };
}

function layout(activeLeafId, splits) {
  return { activeLeafId, splits };
}

function dimMoves(model) {
  const next = JSON.parse(JSON.stringify(model));
  for (const row of next.rows) {
    if (row.key === "H" || row.key === "L") {
      row.available = false;
      row.reason = "layout-api-changed";
      row.preview = "layout API changed";
      row.plan = { ...row.plan, available: false, action: "unavailable", reason: "layout-api-changed" };
    }
  }
  return next;
}

function buildCases(helpers) {
  // Paint-phase preview: every fixture tab bar uses Obsidian's real header
  // structure and the numbers below come from the production catalog
  // (`buildWindowPrefixTabCatalog`), the same source the dormant stamper
  // reads. The browser applies them with the stamper's attribute and body
  // class rules, so the PNGs show what the stamper paints.
  function numberedCase(options) {
    const snap = layout(options.activeLeafId, options.rawSplits);
    const catalog = helpers.buildWindowPrefixTabCatalog(snap);
    const byId = new Map();
    for (const tab of catalog.tabs || []) byId.set(tab.leafId, tab.number);
    const model = helpers.buildWindowPrefixViewModel(snap);
    model.platform = "mac";
    const activeSplitId = model.activeSplitId;
    const workspace = {
      width: options.width || 840,
      splits: options.rawSplits.map((raw) => {
        const view = model.splits.find((entry) => entry.id === raw.id) || {};
        return {
          id: raw.id,
          title: view.label || raw.id,
          active: raw.id === activeSplitId,
          flex: Math.max(0.4, view.widthRatio || 1),
          stacked: Boolean(options.stackedIds && options.stackedIds.includes(raw.id)),
          tabs: raw.leaves.map((entry) => ({
            name: entry.label || entry.id,
            number: byId.has(entry.id) ? byId.get(entry.id) : null,
            pinned: entry.pinned === true,
            active: entry.id === (raw.selectedLeafId || raw.leaves[raw.leaves.length - 1]?.id),
          })),
        };
      }),
    };
    return {
      id: options.id,
      title: options.title,
      model,
      workspace,
      actions: options.ring === false ? (options.card ? ["card"] : []) : (options.card ? ["armed", "card"] : ["armed"]),
      tabState: options.tabState || "idle",
      flashNumber: options.flashNumber ?? null,
      showNumerals: options.showNumerals !== false,
      cardTabNumbers: options.cardTabNumbers !== false,
      nudge: options.nudge || null,
      receipt: options.receipt || null,
      reducedMotion: Boolean(options.reducedMotion),
    };
  }

  function rawSplit(id, x, leaves, options = {}) {
    return split(id, x, leaves, options);
  }

  const twoSplitRaw = [
    rawSplit("left", 0, [
      leaf("day", { label: "20261115" }),
      leaf("dash", { label: "dash" }),
      leaf("blog", { label: "sase_blog" }),
    ], { selected: "blog", width: 280 }),
    rawSplit("right", 280, [leaf("contents", { label: "sase_blog_contents" })], { width: 180 }),
  ];
  const thirteenLeft = Array.from({ length: 6 }, (_, index) => leaf(`t${index + 1}`, { label: `Tab ${index + 1}`, pinned: index === 0 }));
  const thirteenRight = Array.from({ length: 7 }, (_, index) => leaf(`t${index + 7}`, { label: `Note ${index + 7} with a long crowded title` }));
  const thirteenRaw = [
    rawSplit("left", 0, thirteenLeft, { selected: "t1", width: 300 }),
    rawSplit("right", 300, thirteenRight, { selected: "t7", width: 320 }),
  ];
  const sixTabRaw = [
    rawSplit("left", 0, [
      leaf("a1", { label: "20261115" }),
      leaf("a2", { label: "dash" }),
      leaf("a3", { label: "sase_blog" }),
    ], { selected: "a3", width: 260 }),
    rawSplit("right", 260, [
      leaf("b1", { label: "map" }),
      leaf("b2", { label: "outline" }),
      leaf("b3", { label: "sase_blog_contents" }),
    ], { selected: "b1", width: 260 }),
  ];

  return [
    numberedCase({
      id: "idle", title: "1 · Idle numerals · two splits",
      activeLeafId: "blog", rawSplits: twoSplitRaw, width: 840,
      tabState: "idle", card: false,
    }),
    numberedCase({
      id: "lit", title: "2 · Lit caps with the here cap · card",
      activeLeafId: "blog", rawSplits: twoSplitRaw, width: 840,
      tabState: "lit", card: true, cardTabNumbers: true,
    }),
    numberedCase({
      id: "flash", title: "3 · Flash on the destination numeral",
      activeLeafId: "contents", rawSplits: twoSplitRaw, width: 840,
      tabState: "flash", flashNumber: 4, card: false,
    }),
    numberedCase({
      id: "crowded", title: "4 · Thirteen tabs · 10+ blank",
      activeLeafId: "t1", rawSplits: thirteenRaw, width: 900,
      tabState: "idle", card: false,
    }),
    numberedCase({
      id: "stacked", title: "5 · Stacked-tab spines stay upright",
      activeLeafId: "blog", rawSplits: twoSplitRaw, width: 840,
      tabState: "idle", card: false, stackedIds: ["left", "right"], ring: false,
    }),
    numberedCase({
      id: "one-split", title: "6 · One split · two tabs",
      activeLeafId: "blog", rawSplits: [
        rawSplit("only", 0, [
          leaf("day", { label: "20261115" }),
          leaf("blog", { label: "sase_blog" }),
        ], { selected: "blog", width: 420 }),
      ], width: 640,
      tabState: "idle", card: false,
    }),
    numberedCase({
      id: "single", title: "7 · A single tab shows no numerals",
      activeLeafId: "solo", rawSplits: [
        rawSplit("only", 0, [leaf("solo", { label: "sase_blog" })], { width: 420 }),
      ], width: 560,
      tabState: "hidden", card: false, showNumerals: false,
    }),
    numberedCase({
      id: "card", title: "8 · Card with pill ranges and the tabs row",
      activeLeafId: "blog", rawSplits: twoSplitRaw, width: 840,
      tabState: "lit", card: true, cardTabNumbers: true,
    }),
    numberedCase({
      id: "card-many", title: "9 · Card over thirteen tabs · +k pill",
      activeLeafId: "t1", rawSplits: thirteenRaw, width: 900,
      tabState: "lit", card: true, cardTabNumbers: true,
    }),
    numberedCase({
      id: "card-one", title: "10 · Card over one tab · dimmed tabs row",
      activeLeafId: "solo", rawSplits: [
        rawSplit("only", 0, [leaf("solo", { label: "sase_blog" })], { width: 420 }),
      ], width: 560,
      tabState: "hidden", card: true, cardTabNumbers: true, showNumerals: false,
    }),
    numberedCase({
      id: "blocked", title: "11 · Blocked digit nudges the tabs row",
      activeLeafId: "a3", rawSplits: sixTabRaw, width: 840,
      tabState: "lit", card: true, cardTabNumbers: true,
      nudge: { key: "tabs", message: "No tab 7 · 6 tabs" },
    }),
    numberedCase({
      id: "narrow", title: "12 · 420px narrow card",
      activeLeafId: "blog", rawSplits: twoSplitRaw, width: 420,
      tabState: "lit", card: true, cardTabNumbers: true,
    }),
    numberedCase({
      id: "reduced", title: "13 · Reduced motion keeps the flash",
      activeLeafId: "blog", rawSplits: twoSplitRaw, width: 840,
      tabState: "lit", card: true, cardTabNumbers: true, reducedMotion: true,
    }),
  ];
}

function makeHtml({ css, painterSource, cases }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Bob window-prefix preview</title>
<style>
:root {
  --font-interface: Inter, ui-sans-serif, system-ui, sans-serif;
  --font-monospace: ui-monospace, SFMono-Regular, Menlo, monospace;
  --layer-popover: 30;
  --radius-s: 5px;
  --radius-m: 8px;
}
body[data-theme="light"] {
  --background-primary:#fcfcfd; --background-secondary:#f0f1f4;
  --background-modifier-border:#d7d9df; --background-modifier-hover:#e5e7ec;
  --text-normal:#252832; --text-muted:#727783; --text-faint:#a0a4ad;
  --interactive-accent:#624bb8; --text-on-accent:#fff;
  --color-orange:#b87918; --shadow-s:0 1px 2px #20263a22; --shadow-l:0 12px 32px #20263a24;
  color-scheme:light;
}
body[data-theme="dark"] {
  --background-primary:#202226; --background-secondary:#292c32;
  --background-modifier-border:#41454d; --background-modifier-hover:#383c44;
  --text-normal:#e4e5e9; --text-muted:#a3a7b0; --text-faint:#6b7078;
  --interactive-accent:#b6a0ff; --text-on-accent:#1a1528;
  --color-orange:#e8b55e; --shadow-s:0 1px 2px #0006; --shadow-l:0 12px 32px #0008;
  color-scheme:dark;
}
html, body { margin:0; padding:0; background:var(--background-secondary); color:var(--text-normal); font:13px var(--font-interface); }
.preview-chrome {
  display:flex; align-items:center; gap:10px; height:36px; padding:0 16px;
  border-bottom:1px solid var(--background-modifier-border); background:var(--background-primary);
  color:var(--text-muted); font-size:12px; letter-spacing:.04em;
}
.preview-chrome strong { color:var(--text-normal); font-weight:650; letter-spacing:0; }
.preview-workspace {
  display:flex; height:560px; min-width:0; background:var(--background-primary);
}
.workspace-tabs {
  display:flex; flex-direction:column; min-width:0; border-right:1px solid var(--background-modifier-border);
}
.workspace-tabs:last-child { border-right:none; }
.workspace-tab-header-container {
  display:flex; align-items:stretch; height:36px; padding:0 6px; gap:2px;
  background:var(--background-secondary); border-bottom:1px solid var(--background-modifier-border);
}
.workspace-tab-header {
  display:flex; align-items:center; min-width:0; max-width:140px; padding:0 8px;
  color:var(--text-muted); font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}
.workspace-tab-header.is-active { color:var(--text-normal); font-weight:600; }
.workspace-tabs.mod-active .workspace-tab-header.is-active { color:var(--text-normal); }
.workspace-tab-header-inner {
  display:flex; align-items:center; min-width:0; flex:1 1 auto;
}
.workspace-tab-header-inner-icon {
  flex:0 0 auto; width:16px; height:16px; margin-right:2px;
  display:inline-flex; align-items:center; justify-content:center;
  color:var(--text-faint); font-size:10px;
}
.workspace-tab-header-inner-title {
  flex:1 1 auto; min-width:0; overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap;
}
.workspace-tab-header-pin,
.workspace-tab-header-close {
  flex:0 0 auto; width:14px; text-align:center;
  color:var(--text-faint); font-size:10px; line-height:1;
}
.workspace-tabs.mod-stacked .workspace-tab-header-container {
  flex-direction:column; height:auto; min-height:120px;
}
.workspace-tabs.mod-stacked .workspace-tab-header {
  max-width:none; padding:6px 8px;
}
.workspace-leaf {
  flex:1 1 auto; min-height:0; padding:14px 16px; color:var(--text-muted); font-size:13px; line-height:1.55;
}
.workspace-leaf p { margin:0 0 8px; }
.workspace-leaf .task { color:var(--text-normal); }
${css}
</style>
</head>
<body data-theme="light">
<header class="preview-chrome" id="chrome"><strong>Window prefix</strong><span id="case-title"></span></header>
<div class="preview-workspace" id="workspace"></div>
<script>
function applyAttrs(el, options) {
  if (!options) return el;
  if (options.cls) el.className = String(options.cls);
  if (options.text != null) el.textContent = String(options.text);
  if (options.attr) {
    for (const [key, value] of Object.entries(options.attr)) {
      if (value != null) el.setAttribute(key, String(value));
    }
  }
  return el;
}
HTMLElement.prototype.createDiv = function(options) {
  const el = document.createElement("div");
  applyAttrs(el, options);
  this.appendChild(el);
  return el;
};
HTMLElement.prototype.createSpan = function(options) {
  const el = document.createElement("span");
  applyAttrs(el, options);
  this.appendChild(el);
  return el;
};
HTMLElement.prototype.createEl = function(tag, options) {
  const el = document.createElement(tag);
  applyAttrs(el, options);
  this.appendChild(el);
  return el;
};
HTMLElement.prototype.addClass = function(name) { this.classList.add(name); return this; };
HTMLElement.prototype.removeClass = function(name) { this.classList.remove(name); return this; };
HTMLElement.prototype.empty = function() { this.replaceChildren(); return this; };
HTMLElement.prototype.setText = function(text) { this.textContent = text == null ? "" : String(text); return this; };
const ICONS = {
  "arrow-left": "M19 12H5M12 19l-7-7 7-7",
  "arrow-right": "M5 12h14M12 5l7 7-7 7",
  "arrow-left-right": "M8 7 4 12l4 5M16 7l4 5-4 5M4 12h16",
  "columns-2": "M12 3v18M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",
  "hash": "M4 9h16M4 15h16M10 3L8 21M16 3L14 21",
};
function setIcon(el, name) {
  el.replaceChildren();
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const node = document.createElementNS("http://www.w3.org/2000/svg", "path");
  node.setAttribute("d", ICONS[name] || ICONS["arrow-left"]);
  svg.appendChild(node);
  el.appendChild(svg);
}
${painterSource}
window.WINDOW_PREFIX_CASES = ${safeJson(cases)};
function rectOf(el) {
  const rect = el.getBoundingClientRect();
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
}
function renderWorkspace(spec, tabState, flashNumber, showNumerals) {
  const root = document.getElementById("workspace");
  root.replaceChildren();
  root.style.width = (spec.width || 840) + "px";
  document.body.classList.toggle("bob-wp-multi-split", (spec.splits || []).length > 1);
  document.body.classList.toggle("bob-tab-numbers", showNumerals !== false);
  document.body.classList.toggle("bob-tab-numbers-lit", tabState === "lit");
  for (const split of spec.splits || []) {
    const tabs = document.createElement("div");
    tabs.className = "workspace-tabs" + (split.active ? " mod-active" : "") + (split.stacked ? " mod-stacked" : "");
    tabs.dataset.split = split.id;
    tabs.style.flex = String(split.flex || 1) + " 1 0";
    const header = document.createElement("div");
    header.className = "workspace-tab-header-container";
    for (const tab of split.tabs || []) {
      const info = (tab && typeof tab === "object") ? tab : { name: String(tab) };
      const tabEl = document.createElement("div");
      tabEl.className = "workspace-tab-header" + (info.active ? " is-active" : "");
      const inner = document.createElement("div");
      inner.className = "workspace-tab-header-inner";
      if (showNumerals !== false && info.number != null) {
        inner.setAttribute("data-bob-tab", String(info.number));
        tabEl.setAttribute("aria-description", "Control W then N");
      }
      if (flashNumber != null && info.number === flashNumber) {
        inner.classList.add("bob-tab-number-flash");
      }
      const icon = document.createElement("div");
      icon.className = "workspace-tab-header-inner-icon";
      icon.textContent = info.pinned ? "📌" : "○";
      const title = document.createElement("div");
      title.className = "workspace-tab-header-inner-title";
      title.textContent = info.name || split.title;
      inner.appendChild(icon);
      inner.appendChild(title);
      tabEl.appendChild(inner);
      if (info.pinned) {
        const pin = document.createElement("div");
        pin.className = "workspace-tab-header-pin";
        pin.textContent = "•";
        tabEl.appendChild(pin);
      }
      const close = document.createElement("div");
      close.className = "workspace-tab-header-close";
      close.textContent = "×";
      tabEl.appendChild(close);
      header.appendChild(tabEl);
    }
    const leaf = document.createElement("div");
    leaf.className = "workspace-leaf";
    leaf.innerHTML = split.active
      ? "<p class=\\"task\\">- [ ] Review window keys</p><p class=\\"task\\">- [ ] Keep the draft beside the task</p><p>The editor keeps focus and caret.</p>"
      : "<p>" + String(split.title || "") + "</p><p>Unfocused split.</p>";
    tabs.appendChild(header);
    tabs.appendChild(leaf);
    root.appendChild(tabs);
  }
}
window.windowPrefixPreview = {
  host: null,
  show(id) {
    const item = window.WINDOW_PREFIX_CASES.find((entry) => entry.id === id);
    if (!item) throw new Error("unknown preview case " + id);
    document.getElementById("case-title").textContent = item.title;
    if (this.host) this.host.destroy();
    document.body.classList.remove("bob-tab-numbers", "bob-tab-numbers-lit");
    renderWorkspace(item.workspace, item.tabState, item.flashNumber, item.showNumerals);
    const workspace = document.getElementById("workspace");
    const active = workspace.querySelector(".workspace-tabs.mod-active") || workspace.querySelector(".workspace-tabs");
    const host = createWindowHintHost(document, { setIcon, platform: "mac", reducedMotion: Boolean(item.reducedMotion), tabNumbers: item.cardTabNumbers !== false });
    this.host = host;
    const area = rectOf(workspace);
    const ring = rectOf(active);
    if (item.actions.includes("armed")) host.showArmed(item.model, ring, area);
    if (item.actions.includes("card")) host.showCard(item.model);
    if (item.nudge) host.nudge(item.nudge.key, item.nudge.message);
    if (item.receipt) host.receipt(item.receipt);
    if (item.bump) host.bump(item.bump);
    return this.measure();
  },
  measure() {
    const workspace = document.getElementById("workspace");
    const ring = document.querySelector(".bob-wp-ring");
    const card = document.querySelector(".bob-wp-card");
    const header = workspace.querySelector(".workspace-tabs.mod-active .workspace-tab-header-container");
    const workspaceRect = workspace.getBoundingClientRect();
    const ringRect = ring ? ring.getBoundingClientRect() : null;
    const cardRect = card && card.offsetParent !== null ? card.getBoundingClientRect() : null;
    const headerRect = header ? header.getBoundingClientRect() : null;
    const counts = Array.from(document.querySelectorAll(".bob-wp-pill-count"));
    const titles = Array.from(document.querySelectorAll(".bob-wp-pill-title"));
    const overflow = titles.some((el) => el.scrollWidth > el.clientWidth + 1);
    const numerals = Array.from(document.querySelectorAll(".workspace-tab-header-inner[data-bob-tab]"));
    const blankPastNine = Array.from(document.querySelectorAll(".workspace-tab-header-inner:not([data-bob-tab])")).length;
    return {
      ringCoversTabs: Boolean(ringRect && headerRect && ringRect.top < headerRect.bottom - 1),
      cardWidth: cardRect ? cardRect.width : 0,
      workspaceWidth: workspaceRect.width,
      titleEllipsisKeepsCount: counts.every((el) => el.offsetWidth > 0),
      dimmedRows: document.querySelectorAll(".bob-wp-row.is-unavailable").length,
      overflowTitles: overflow,
      numerals: numerals.length,
      blankPastNine,
    };
  },
};
window.windowPrefixPreviewReady = true;
</script>
</body>
</html>`;
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
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result && response.result.value;
  }
}

async function waitFor(file, child, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(file)) return;
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("Chromium exited before publishing its DevTools port.");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for Chromium's DevTools port file.");
}

async function capture(client, output) {
  await client.evaluate("document.fonts && document.fonts.ready");
  await client.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  const metrics = await client.call("Page.getLayoutMetrics");
  const width = Math.ceil(metrics.cssContentSize.width);
  const height = Math.ceil(metrics.cssContentSize.height);
  const response = await client.call("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height, scale: 1 },
  });
  fs.writeFileSync(output, Buffer.from(response.data, "base64"));
}

function relativeLuminance(hex) {
  const clean = String(hex).replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((ch) => ch + ch).join("") : clean;
  const rgb = [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16) / 255);
  const linear = rgb.map((value) => (value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(a, b) {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.out, { recursive: true });
  const helpers = loadProductionHelpers();
  const cases = buildCases(helpers);
  const css = fs.readFileSync(path.join(pluginRoot, "styles.css"), "utf8");
  const painterSource = fs.readFileSync(path.join(pluginRoot, "src/473-window-hint-view.js"), "utf8");
  const htmlFile = path.join(args.out, "index.html");
  fs.writeFileSync(htmlFile, makeHtml({ css, painterSource, cases }));
  const chromium = findChromium();
  const profile = fs.mkdtempSync(path.join("/tmp", "bob-window-prefix-preview-"));
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
    await client.call("Emulation.setDeviceMetricsOverride", { width: 960, height: 640, deviceScaleFactor: 1, mobile: false });
    await client.call("Page.navigate", { url: pathToFileURL(htmlFile).href });
    const start = Date.now();
    while (Date.now() - start < 15000) {
      if (await client.evaluate("Boolean(window.windowPrefixPreviewReady)")) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const screenshots = [];
    const failures = [];
    for (const [theme, accent, surface] of [["light", "#624bb8", "#f0f1f4"], ["dark", "#b6a0ff", "#292c32"]]) {
      const ratio = contrastRatio(accent, surface);
      if (ratio < 4.5) failures.push(`${theme}/lit-cap: contrast ${ratio.toFixed(2)}:1 below 4.5:1 (${accent} on ${surface})`);
    }
    for (const theme of ["light", "dark"]) {
      await client.evaluate(`document.body.dataset.theme = ${safeJson(theme)}`);
      for (const item of cases) {
        try {
          if (item.reducedMotion) {
            await client.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
          } else {
            await client.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
          }
          const measured = await client.evaluate(`window.windowPrefixPreview.show(${safeJson(item.id)})`);
          if (measured.ringCoversTabs) failures.push(`${theme}/${item.id}: ring covers tab titles`);
          if (item.id === "narrow" && measured.cardWidth > 420) {
            failures.push(`${theme}/${item.id}: card ${measured.cardWidth}px wider than 420px area`);
          }
          const output = path.join(args.out, `window-prefix-${item.id}-${theme}.png`);
          await capture(client, output);
          screenshots.push(output);
        } catch (error) {
          failures.push(`${theme}/${item.id}: ${error.message}`);
        }
      }
    }
    fs.writeFileSync(path.join(args.out, "summary.md"), [
      "# Bob window-prefix preview",
      "",
      "Rendered from the production painter (`createWindowHintHost`) plus `styles.css` over a fixture workspace.",
      "",
      ...screenshots.map((file) => `- ${path.basename(file)}`),
      "",
      failures.length ? "## Failures\n\n" + failures.map((item) => `- ${item}`).join("\n") : "All layout checks passed.",
      "",
    ].join("\n"));
    if (failures.length > 0) {
      console.error(failures.join("\n"));
      process.exitCode = 1;
    }
    console.log(JSON.stringify({ output: args.out, html: htmlFile, chromium, screenshots, failures }, null, 2));
  } finally {
    if (client) client.socket.close();
    child.kill("SIGKILL");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
