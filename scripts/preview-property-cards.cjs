#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const PLUGIN_CSS = path.join(ROOT, "plugins/bob-ledger-tools/styles.css");
const DEFAULT_OBSIDIAN = "/snap/obsidian/current/app/obsidian";
const HELP = [
  "Usage: node scripts/preview-property-cards.cjs [OPTIONS]",
  "",
  "Render the three real property-card DOM builders in Obsidian and compare",
  "the original shared-card CSS with the current CSS across themes and widths.",
  "Kinds that adopted the identity kit get structural assertions instead of",
  "the pixel-identity gate. Run under xvfb-run -a on Linux.",
  "",
  "Options:",
  "  -e, --executable PATH   Obsidian Electron binary",
  "  -o, --out DIRECTORY     Save paired screenshots and report",
  "  -b, --baseline SHA      Original bob-plugins source revision (default 36d4801)",
  "  -h, --help              Print this help",
].join("\n");

function parseArgs(argv) {
  const args = { executable: DEFAULT_OBSIDIAN, out: null, baseline: "36d4801", help: false };
  const list = Array.isArray(argv) ? argv : [];
  for (let index = 0; index < list.length; index += 1) {
    const value = list[index];
    if (["-e", "--executable"].includes(value)) args.executable = list[++index];
    else if (["-o", "--out"].includes(value)) args.out = list[++index];
    else if (["-b", "--baseline"].includes(value)) args.baseline = list[++index];
    else if (["-h", "--help"].includes(value)) args.help = true;
    else throw new Error(`Unknown argument: ${value}`);
    if (value !== "-h" && value !== "--help" && (!args[value === "-e" || value === "--executable" ? "executable" : value === "-o" || value === "--out" ? "out" : "baseline"])) {
      throw new Error(`${value} requires a value`);
    }
  }
  return args;
}

class PreviewTextNode {
  constructor(text, ownerDocument) {
    this.nodeType = 3;
    this.nodeValue = String(text);
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
  }
  get textContent() { return this.nodeValue; }
  set textContent(value) { this.nodeValue = String(value); }
}

class PreviewElement {
  constructor(tagName, ownerDocument) {
    this.nodeType = 1;
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.disabled = false;
    const self = this;
    this.classList = {
      add(...names) {
        const values = new Set((self.getAttribute("class") || "").split(/\s+/).filter(Boolean));
        names.forEach((name) => values.add(String(name)));
        self.setAttribute("class", [...values].join(" "));
      },
      remove(...names) {
        const remove = new Set(names.map(String));
        self.setAttribute("class", (self.getAttribute("class") || "").split(/\s+/).filter((name) => name && !remove.has(name)).join(" "));
      },
      contains(name) { return (self.getAttribute("class") || "").split(/\s+/).includes(String(name)); },
    };
  }
  get className() { return this.getAttribute("class") || ""; }
  set className(value) { this.setAttribute("class", value); }
  get textContent() { return this.children.map((child) => child.textContent).join(""); }
  set textContent(value) {
    this.children = [this.ownerDocument.createTextNode(value)];
    this.children[0].parentNode = this;
  }
  appendChild(child) {
    child.parentNode?.removeChild?.(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  setAttribute(name, value) { this.attributes.set(String(name), String(value)); }
  getAttribute(name) { return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null; }
  removeAttribute(name) { this.attributes.delete(String(name)); }
  addEventListener(type, callback) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(callback);
    this.listeners.set(type, listeners);
  }
  contains(node) { return node === this || this.children.some((child) => child.contains?.(node)); }
  matches(selector) {
    const tag = /^([a-z][a-z0-9-]*)/i.exec(selector)?.[1];
    if (tag && this.tagName !== tag.toUpperCase()) return false;
    for (const name of selector.match(/\.[\w-]+/g) || []) {
      if (!this.classList.contains(name.slice(1))) return false;
    }
    return true;
  }
  querySelectorAll(selector) {
    const results = [];
    const visit = (node) => {
      for (const child of node.children || []) {
        if (child.nodeType === 1 && child.matches(selector)) results.push(child);
        visit(child);
      }
    };
    visit(this);
    return results;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function previewDocument() {
  return {
    createElement(tagName) { return new PreviewElement(tagName, this); },
    createTextNode(text) { return new PreviewTextNode(text, this); },
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[char]);
}

function serialize(node) {
  if (!node || node.nodeType === 3) return escapeHtml(node?.nodeValue || "");
  const attrs = [...node.attributes.entries()]
    .map(([name, value]) => ` ${name}="${escapeHtml(value)}"`).join("");
  return `<${node.tagName.toLowerCase()}${attrs}>${node.children.map(serialize).join("")}</${node.tagName.toLowerCase()}>`;
}

function sampleAlbumReport(H) {
  const entry = {
    path: "eat.md", stem: "eat", title: "Restaurants", noun: "restaurant",
    emoji: "🍽️", parent: "body", owner: "body", root: "body",
    schema_fingerprint: "sha256:property-card-preview", records: 12,
    label: "Restaurant", plural: "restaurants", singular: "restaurant",
    dated_notes: true, index_by: "status", group_field: "status",
    fields: [
      { key: "status", label: "Status", kind: "text", required: true, choices: [
        { value: "to_try", label: "🔖 To try", count: 4 },
        { value: "liked", label: "💚 Liked", count: 8 },
      ] },
      { key: "location", label: "Location", kind: "text", required: true, choices: [] },
      { key: "category", label: "Category", kind: "text", choices: [] },
    ],
    issues: [], index: { state: "current" },
  };
  return H.albumIndexReport({ schema_version: 1, ok: true, albums: [entry], catalogs: [], counts: {} });
}

// The album card model: local identity plus the report body, or the title
// block alone while the report is pending.
function albumModel(H, app, pending = false) {
  return H.albumHeaderCardModel(pending ? null : sampleAlbumReport(H), "eat.md", {
    sourcePath: "eat.md",
    sourceText: "---\ntype: [[album]]\n---\n",
    metadataCache: app.metadataCache,
    vault: app.vault,
  });
}

function recordModel(H, collapsed) {
  const album = {
    path: "eat.md", stem: "eat", title: "Restaurants", noun: "restaurant",
    emoji: "🍽️", legacy: ["old_place"], group_field: "status",
    schema_fingerprint: "sha256:property-card-preview",
    fields: [
      { key: "status", label: "Status", kind: "text", required: true, choices: [
        { value: "liked", label: "💚 Liked" }, { value: "to_try", label: "🔖 To try" },
      ] },
      { key: "location", label: "Location", kind: "text", required: true, choices: [] },
      { key: "category", label: "Category", kind: "text", choices: [] },
    ],
  };
  const model = H.recordSheetModel({
    gate: {
      mount: true, state: "healthy", filePath: "eat/cranford.md", albumPath: "eat.md",
      album, hideEligible: true, editable: true,
    },
    frontmatter: {
      title: "Cranford Ramen", created: "2026-11-18", status: "liked",
      location: "Cranford", old_place: "Broad Street",
    },
    heading: "Legacy Heading", hue: "blue", collapsed,
    clock: { today: "2026-11-19", now: new Date(2026, 10, 19, 12, 0, 0) },
  });
  if (!model) throw new Error("recordSheetModel did not produce the preview model");
  model.choiceChips = [{ key: "status", group: true, chips: [{ text: "💚 Liked" }, { text: "🔖 To try" }] }];
  model.walk = {
    path: "eat/cranford.md", lineIndex: 8, lineState: "current", state: "ok",
    album: { title: "Restaurants", stem: "eat", emoji: "🍽️", hue: "blue" },
    writtenPrev: { target: "eat/phou-house.md", label: "‹ Pho House" },
    writtenNext: { target: "eat/ramen-ya.md", label: "Ramen Ya ›" },
    position: 3, total: 12, wrapsPrev: false, wrapsNext: false,
  };
  return model;
}

function bankModel(H, expanded) {
  const report = {
    ok: true, state: "valid", path: "bank.md",
    categories: [
      { key: "coffee", label: "Coffee", hotkey: "c", count: 5, line: 13, group: "Everyday" },
      { key: "groceries", label: "Groceries", hotkey: "g", count: 8, line: 14, group: "Everyday" },
      { key: "kids", label: "Kids", hotkey: "k", count: 2, line: 15, group: "Everyday", hidden: true },
    ],
    accounts: [{ alias: "checking", label: "WF Checking", kind: "checking", start: "2026-11-01", line: 3 }],
    rules: [{ match: "Local Market", cat: "groceries", line: 22 }],
    findings: [], free_hotkeys: ["c", "g"],
    stale_after: { days: 10, explicit: false, line: null },
  };
  return H.bankSetupModel(report, { desktop: true, expanded });
}

// Kinds that adopted the identity kit leave the baseline pixel-identity gate
// and get structural assertions instead: data-card-kind, the species word,
// the tile form, and the aria-level=1 count. A card that owns its note title
// carries exactly one heading; the bank card never owns the title, so it
// carries none. Keep every phase's kinds when merging.
const ADOPTED_KINDS = Object.freeze({
  bank: Object.freeze({ word: "Bank", tile: "plain", headings: 0, glyph: "🏦" }),
  album: Object.freeze({ word: "Album", tile: "stack", headings: 1, glyph: "🍽️" }),
});

function adoptedSpec(kind) {
  return Object.prototype.hasOwnProperty.call(ADOPTED_KINDS, kind) ? ADOPTED_KINDS[kind] : null;
}

// In-page probe for an adopted kind. Returns { ok, failures, facts }.
function structuralExpression(kind, spec) {
  return `(() => {
    const kind = ${JSON.stringify(kind)};
    const spec = ${JSON.stringify(spec)};
    const failures = [];
    const visible = (el) => {
      if (!el) return false;
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return box.width > 0 && box.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const card = document.querySelector(".bob-property-card");
    if (!card) return { ok: false, failures: ["card missing"], facts: {} };
    const cardKind = card.getAttribute("data-card-kind");
    if (cardKind !== kind) failures.push("data-card-kind " + cardKind);
    const headings = card.querySelectorAll('[aria-level="1"]').length;
    if (headings !== spec.headings) failures.push("aria-level=1 count " + headings);
    const words = Array.from(card.querySelectorAll(".bob-property-card-kicker-species, .bob-property-card-identity-word"));
    const word = words.find((el) => el.textContent.trim() === spec.word && visible(el));
    if (!word) failures.push("species word " + spec.word + " not visible");
    const transform = word ? getComputedStyle(word).textTransform : "";
    if (word && transform !== "uppercase") failures.push("species word text-transform " + transform);
    const tile = card.querySelector('.bob-property-card-tile[data-tile-form="' + spec.tile + '"]');
    if (!visible(tile)) failures.push("tile form " + spec.tile + " not visible");
    if (tile && tile.getAttribute("aria-hidden") !== "true") failures.push("tile is not aria-hidden");
    const glyph = tile ? tile.textContent.trim() : "";
    if (spec.glyph && glyph !== spec.glyph) failures.push("tile glyph " + JSON.stringify(glyph));
    const tileBox = tile ? tile.getBoundingClientRect() : null;
    const wordBox = word ? word.getBoundingClientRect() : null;
    if (tileBox && wordBox && !(tileBox.right <= wordBox.left + 0.5)) failures.push("tile overlaps the species word");
    return {
      ok: failures.length === 0,
      failures,
      facts: {
        cardKind, headings, word: word ? word.textContent.trim() : "", transform, glyph,
        ariaLabel: card.getAttribute("aria-label") || "",
        tileSize: tileBox ? [Math.round(tileBox.width), Math.round(tileBox.height)] : null,
      },
    };
  })()`;
}

async function structuralCheck(client, kind, spec) {
  const result = await client.call("Runtime.evaluate", { expression: structuralExpression(kind, spec), returnByValue: true });
  if (result.exceptionDetails) return { ok: false, failures: [result.exceptionDetails.text || "probe threw"], facts: {} };
  return result.result?.value || { ok: false, failures: ["probe returned nothing"], facts: {} };
}

function buildCard(kind, H, Plugin, doc, expanded, app, variant = "") {
  if (kind === "album") {
    const model = albumModel(H, app, variant === "pending");
    const plugin = Object.create(Plugin.prototype);
    return plugin.albumHeaderBuildEl(model, {
      desktop: true, expanded, hue: "blue", handlers: {},
    }, doc);
  }
  if (kind === "record") {
    const card = H.recordSheetBuildEl(recordModel(H, !expanded), { handlers: {} }, doc);
    if (!card) return null;
    if (card.classList) card.classList.add("docks-record-walk", "has-record-walk");
    const rail = H.recordWalkRailBuildEl(recordModel(H, !expanded).walk, { hue: "blue", handlers: {} }, doc);
    if (rail) card.appendChild(rail);
    return card;
  }
  const card = H.bankSetupBuildEl(bankModel(H, expanded), {}, doc);
  card?.setAttribute?.("data-root-hue", "blue");
  return card;
}

const PAGE_CHROME = `
html, body { margin: 0; min-height: 100%; }
body { padding: 24px; box-sizing: border-box; font: 14px/1.4 Arial, sans-serif; }
body.theme-light {
  color-scheme: light; color: #24262a; background: #f5f4f0;
  --background-primary: #f5f4f0; --background-secondary: #ecebe6;
  --background-modifier-border: #d5d3ce; --background-modifier-hover: #e9e8e3;
  --text-normal: #24262a; --text-muted: #686a70; --text-faint: #8c8e93;
  --text-warning: #a35a00; --text-success: #26743d; --text-error: #a51f24;
  --interactive-accent: #6656c6; --font-interface: Arial, sans-serif;
  --font-text: Arial, sans-serif; --font-ui-small: 13px; --font-normal: 400;
  --inline-title-color: #24262a; --h1-color: #24262a; --radius-s: 4px;
  --bob-area-aqua: #2d8c91; --bob-area-blue: #4268c9; --bob-area-green: #31734a;
  --bob-area-magenta: #a2469c; --bob-area-orange: #b06022; --bob-area-red: #ac4447;
  --bob-area-violet: #714db0; --bob-area-yellow: #9c7611; --bob-area-ink: #4268c9;
}
body.theme-dark {
  color-scheme: dark; color: #e5e6e9; background: #17191d;
  --background-primary: #17191d; --background-secondary: #202228;
  --background-modifier-border: #393c43; --background-modifier-hover: #292c33;
  --text-normal: #e5e6e9; --text-muted: #a5a7ad; --text-faint: #777a82;
  --text-warning: #e2aa54; --text-success: #7cc28b; --text-error: #ef8d91;
  --interactive-accent: #aa9cf8; --font-interface: Arial, sans-serif;
  --font-text: Arial, sans-serif; --font-ui-small: 13px; --font-normal: 400;
  --inline-title-color: #e5e6e9; --h1-color: #e5e6e9; --radius-s: 4px;
  --bob-area-aqua: #57b9bd; --bob-area-blue: #83a0ff; --bob-area-green: #78be8b;
  --bob-area-magenta: #e39bdc; --bob-area-orange: #e6a56f; --bob-area-red: #eb8f93;
  --bob-area-violet: #bda0f2; --bob-area-yellow: #e4c468; --bob-area-ink: #83a0ff;
}
.markdown-preview-view { color: var(--text-normal); background: transparent; }
.markdown-preview-sizer { min-width: 0; max-width: 100%; }
.preview-note-h1 { margin: 0 0 0.6em; font-size: 1.35em; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
`;

function htmlPage(css, cardHtml, theme) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${PAGE_CHROME}</style><style>${css.replace(/<\/style/gi, "<\\/style")}</style></head><body class="theme-${theme}"><main class="markdown-preview-view"><div class="markdown-preview-sizer"><h1 class="preview-note-h1">Property card preview</h1>${cardHtml}</div></main></body></html>`;
}

function sha256(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function cdpTarget(port, child) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Obsidian exited during startup (${child.exitCode})`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
        if (page) return page.webSocketDebuggerUrl;
      }
    } catch (_) {}
    await sleep(200);
  }
  throw new Error("Timed out waiting for Obsidian's CDP page");
}

class CdpClient {
  constructor(endpoint, WebSocketClient) {
    this.socket = new WebSocketClient(endpoint);
    this.nextId = 0;
    this.pending = new Map();
    this.opened = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      let message;
      try { message = JSON.parse(String(event.data)); } catch (_) { return; }
      const waiting = this.pending.get(message.id);
      if (!waiting) return;
      this.pending.delete(message.id);
      if (message.error) waiting.reject(new Error(message.error.message || "CDP command failed"));
      else waiting.resolve(message.result || {});
    });
  }
  async call(method, params = {}) {
    await this.opened;
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { try { this.socket.close(); } catch (_) {} }
}

async function installPage(client, html) {
  const encoded = Buffer.from(html).toString("base64");
  const result = await client.call("Runtime.evaluate", {
    // Decode the base64 bytes as UTF-8; a bare atob() string is Latin-1 and
    // turns every emoji (the bank mark, album emoji) into mojibake.
    expression: `(() => { const html = new TextDecoder("utf-8").decode(Uint8Array.from(atob("${encoded}"), (c) => c.charCodeAt(0))); document.open(); document.write(html); document.close(); return true; })()`,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Could not install preview page");
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const state = await client.call("Runtime.evaluate", {
      expression: `document.readyState === "complete" && Boolean(document.querySelector(".bob-property-card"))`,
      returnByValue: true,
    });
    if (state.result?.value === true) {
      await client.call("Runtime.evaluate", { expression: "document.fonts.ready.then(() => true)", awaitPromise: true, returnByValue: true });
      return;
    }
    await sleep(50);
  }
  throw new Error("Preview page did not finish rendering a property card");
}

async function captureCard(client, outPath) {
  const bounds = await client.call("Runtime.evaluate", {
    expression: `(() => { const r = document.querySelector(".bob-property-card").getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()`,
    returnByValue: true,
  });
  const rect = bounds.result?.value;
  if (!rect || !(rect.width > 0 && rect.height > 0)) throw new Error("Rendered property card has no visible bounds");
  const image = await client.call("Page.captureScreenshot", {
    format: "png", fromSurface: true, captureBeyondViewport: true,
    clip: { x: Math.floor(rect.x), y: Math.floor(rect.y), width: Math.ceil(rect.width), height: Math.ceil(rect.height), scale: 1 },
  });
  const bytes = Buffer.from(image.data, "base64");
  fs.writeFileSync(outPath, bytes);
  return { path: path.basename(outPath), sha256: sha256(bytes), bytes: bytes.length };
}

async function renderOne(client, css, cardHtml, theme, width, height, outPath, caseName) {
  await client.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await client.call("Emulation.setEmulatedMedia", {
    media: "screen",
    features: [
      { name: "prefers-color-scheme", value: theme },
      { name: "prefers-reduced-motion", value: "reduce" },
    ],
  });
  await installPage(client, htmlPage(css, cardHtml, theme));
  return captureCard(client, outPath, caseName);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(`${HELP}\n`); return; }
  if (!args.out) throw new Error("--out is required");
  if (!fs.existsSync(args.executable)) throw new Error(`Obsidian executable not found: ${args.executable}`);
  fs.mkdirSync(args.out, { recursive: true });

  const { LedgerToolsPlugin: Plugin, helpers: H } = require("../scripts/ledger-tools-harness.cjs");
  const currentCss = fs.readFileSync(PLUGIN_CSS, "utf8");
  const baselineCss = execFileSync("git", ["show", `${args.baseline}:plugins/bob-ledger-tools/styles.css`], {
    cwd: ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
  });
  const baselineCommit = execFileSync("git", ["rev-parse", `${args.baseline}^{commit}`], { cwd: ROOT, encoding: "utf8" }).trim();

  const files = new Map([
    ["eat.md", { path: "eat.md" }], ["body.md", { path: "body.md" }], ["type.md", { path: "type.md" }],
  ]);
  const caches = new Map([
    ["eat.md", {
      frontmatter: {
        type: "[[album]]", parent: "[[body]]", emoji: "🍽️",
        summary: "Restaurants Kelly and I have tried, liked, or want to try.",
      },
      headings: [{ level: 1, heading: "Restaurants" }],
    }],
    ["body.md", { frontmatter: { type: "[[area]]", parent: "[[type]]" }, headings: [{ level: 1, heading: "Body" }] }],
    ["type.md", { frontmatter: { type: "[[type]]" } }],
  ]);
  const app = {
    vault: { getAbstractFileByPath: (value) => files.get(value) || null },
    metadataCache: {
      getFirstLinkpathDest: (target) => files.get(`${String(target).replace(/\.md$/i, "")}.md`) || null,
      getFileCache: (file) => caches.get(file?.path) || null,
    },
  };

  const outDir = path.resolve(args.out);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pcard-"));
  const vaultPath = path.join(tempRoot, "vault");
  fs.mkdirSync(path.join(vaultPath, ".obsidian"), { recursive: true });
  fs.writeFileSync(path.join(vaultPath, "README.md"), "# Preview scratch vault\n");
  const profilePath = path.join(tempRoot, "profile");
  const port = await freePort();
  const child = spawn(args.executable, [
    "--no-sandbox", `--user-data-dir=${profilePath}`, `--remote-debugging-port=${port}`,
    "--remote-allow-origins=http://127.0.0.1/*", vaultPath,
  ], { cwd: vaultPath, env: { ...process.env, TMPDIR: "/tmp" }, detached: process.platform !== "win32", stdio: "ignore" });

  let client = null;
  try {
    let endpoint;
    try { endpoint = await cdpTarget(port, child); }
    catch (error) { throw new Error(`${error.message}; run under xvfb-run -a`); }
    let WebSocketClient = globalThis.WebSocket;
    if (typeof WebSocketClient !== "function") {
      try { WebSocketClient = require("undici").WebSocket; } catch (_) { WebSocketClient = null; }
    }
    if (!WebSocketClient) throw new Error("WebSocket is required for the CDP client (Node 22+ or undici)");
    client = new CdpClient(endpoint, WebSocketClient);
    await client.call("Page.enable");
    await client.call("Runtime.enable");
    await client.call("Page.navigate", { url: "about:blank" });
    await sleep(250);

    const cases = [];
    const errors = [];
    for (const kind of ["album", "record", "bank"]) {
      for (const theme of ["light", "dark"]) {
        for (const width of [1280, 375]) {
          const variants = [["expanded", true], ["collapsed", false]];
          // The album card also paints before bob's report: title block only.
          if (kind === "album") variants.push(["pending", false]);
          for (const [variant, expanded] of variants) {
            const caseName = `${kind}-${theme}-${width}-${variant}`;
            const doc = previewDocument();
            const card = buildCard(kind, H, Plugin, doc, expanded, app, variant);
            assert.ok(card, `${caseName}: DOM builder returned a card`);
            assert.ok(card.classList.contains("bob-property-card"), `${caseName}: shared card class is missing`);
            const markup = serialize(card);
            const height = 960;
            const baselinePath = path.join(outDir, `${caseName}-baseline.png`);
            const currentPath = path.join(outDir, `${caseName}-current.png`);
            const baseline = await renderOne(client, baselineCss, markup, theme, width, height, baselinePath, caseName);
            const current = await renderOne(client, currentCss, markup, theme, width, height, currentPath, caseName);
            const pixelIdentical = baseline.sha256 === current.sha256 && baseline.bytes === current.bytes;
            const adopted = adoptedSpec(kind);
            const row = { case: caseName, kind, theme, width, expanded, variant, baseline, current, pixelIdentical, adopted: Boolean(adopted) };
            if (adopted) {
              // The current page is still installed, so probe it in place.
              row.structural = await structuralCheck(client, kind, adopted);
              if (!row.structural.ok) errors.push(`${caseName} (${row.structural.failures.join("; ")})`);
            } else if (!pixelIdentical) {
              errors.push(caseName);
            }
            cases.push(row);
          }
        }
      }
    }

    const report = {
      baselineCommit,
      currentSourceSha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
      baselineCssSha256: sha256(Buffer.from(baselineCss)),
      currentCssSha256: sha256(Buffer.from(currentCss)),
      screenshotCount: cases.length * 2,
      pixelIdenticalCount: cases.filter((item) => item.pixelIdentical).length,
      gatedCount: cases.filter((item) => !item.adopted).length,
      gatedPixelIdenticalCount: cases.filter((item) => !item.adopted && item.pixelIdentical).length,
      adoptedKinds: Object.keys(ADOPTED_KINDS),
      structuralPassCount: cases.filter((item) => item.adopted && item.structural?.ok).length,
      adoptedCount: cases.filter((item) => item.adopted).length,
      cases,
      errors,
      outcome: errors.length === 0 ? "pass" : "fail",
    };
    fs.writeFileSync(path.join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`Property-card visual comparison: ${report.gatedPixelIdenticalCount}/${report.gatedCount} gated paired screenshots pixel-identical; adopted kinds (${report.adoptedKinds.join(", ") || "none"}) structural ${report.structuralPassCount}/${report.adoptedCount}\n`);
    if (errors.length) throw new Error(`Visual changes in: ${errors.join(", ")}`);
  } finally {
    client?.close();
    try {
      if (child.pid && child.exitCode === null) {
        if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
        else child.kill("SIGTERM");
      }
    } catch (_) {}
    await sleep(200);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`preview-property-cards: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs, buildCard, htmlPage, serialize, ADOPTED_KINDS, adoptedSpec, structuralExpression,
  // Shared with scripts/preview-title-block.cjs.
  PAGE_CHROME, PreviewElement, PreviewTextNode, previewDocument, escapeHtml,
  CdpClient, freePort, cdpTarget, sleep, sha256,
};
