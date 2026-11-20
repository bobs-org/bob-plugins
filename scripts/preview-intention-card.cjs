#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { htmlPage, serialize } = require("./preview-property-cards.cjs");
const DEFAULT_OBSIDIAN = "/snap/obsidian/current/app/obsidian";

function parseArgs(argv) {
  const args = { executable: DEFAULT_OBSIDIAN, out: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (["-e", "--executable"].includes(value)) args.executable = argv[++index];
    else if (["-o", "--out"].includes(value)) args.out = argv[++index];
    else if (["-h", "--help"].includes(value)) args.help = true;
    else throw new Error(`Unknown argument: ${value}`);
    if (value !== "-h" && value !== "--help" && !args[value === "-e" || value === "--executable" ? "executable" : "out"]) {
      throw new Error(`${value} requires a value`);
    }
  }
  return args;
}

class PreviewTextNode {
  constructor(text, ownerDocument) { this.nodeType = 3; this.nodeValue = String(text); this.ownerDocument = ownerDocument; this.parentNode = null; }
  get textContent() { return this.nodeValue; }
  set textContent(value) { this.nodeValue = String(value); }
}

class PreviewElement {
  constructor(tagName, ownerDocument) {
    this.nodeType = 1; this.tagName = String(tagName).toUpperCase(); this.ownerDocument = ownerDocument;
    this.parentNode = null; this.children = []; this.attributes = new Map(); this.listeners = new Map();
    const self = this;
    this.classList = {
      add(...names) { const values = new Set((self.getAttribute("class") || "").split(/\s+/).filter(Boolean)); names.forEach((name) => values.add(String(name))); self.setAttribute("class", [...values].join(" ")); },
      remove(...names) { const remove = new Set(names.map(String)); self.setAttribute("class", (self.getAttribute("class") || "").split(/\s+/).filter((name) => name && !remove.has(name)).join(" ")); },
      contains(name) { return (self.getAttribute("class") || "").split(/\s+/).includes(String(name)); },
    };
  }
  set className(value) { this.setAttribute("class", value); }
  get className() { return this.getAttribute("class") || ""; }
  get textContent() { return this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this.children = [this.ownerDocument.createTextNode(value)]; this.children[0].parentNode = this; }
  appendChild(child) { child.parentNode?.removeChild?.(child); child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) { const index = this.children.indexOf(child); if (index >= 0) this.children.splice(index, 1); child.parentNode = null; return child; }
  setAttribute(name, value) { this.attributes.set(String(name), String(value)); }
  getAttribute(name) { return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null; }
  addEventListener(type, callback) { const entries = this.listeners.get(type) || []; entries.push(callback); this.listeners.set(type, entries); }
  contains(node) { return node === this || this.children.some((child) => child.contains?.(node)); }
  matches(selector) { const tag = /^([a-z][a-z0-9-]*)/i.exec(selector)?.[1]; return (!tag || this.tagName === tag.toUpperCase()) && (selector.match(/\.[\w-]+/g) || []).every((name) => this.classList.contains(name.slice(1))); }
  querySelectorAll(selector) { const out = []; const visit = (node) => { for (const child of node.children || []) { if (child.nodeType === 1 && child.matches(selector)) out.push(child); visit(child); } }; visit(this); return out; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function previewDocument() {
  return { createElement(tag) { return new PreviewElement(tag, this); }, createTextNode(text) { return new PreviewTextNode(text, this); } };
}

// Note bodies in the shapes bob writes: the H1 and nav line (and, for
// periods, the child-links line) that the day or period card hides and
// docks as its rail.
const DAY_BODY = (date, weekday, prev, next, week) => `# ${date} ${weekday}\n\n[[${prev}|prev]] · [[${week}|${week.slice(-3)}]] · [[${next}|next]]\n\n- [ ] #task [[gtd_daily]] ^gtd\n`;
const WEEK_BODY = "# 2026-W47 · Nov 16 – 22\n\n[[2026/2026-W46|‹ W46]] · [[2026/2026-Q4|↑ 2026-Q4]] · [[2026/2026-W48|W48 ›]]\n\n"
  + "[[2026/20261116|Mon Nov 16]] · [[2026/20261117|Tue 17]] · [[2026/20261118|Wed 18]] · [[2026/20261119|Thu 19]] · [[2026/20261120|Fri 20]] · [[2026/20261121|Sat 21]] · [[2026/20261122|Sun 22]]\n";
const QUARTER_BODY = "# 2026-Q4 · W40–W53 · Sep 28, 2026 – Jan 3, 2027\n\n[[2026/2026-Q3|‹ Q3]] · [[2026|↑ 2026]] · [[2027/2027-Q1|2027-Q1 ›]]\n\n"
  + Array.from({ length: 14 }, (_, i) => `[[2026/2026-W${40 + i}|W${40 + i}]]`).join(" · ") + "\n";
const YEAR_BODY = "# 2026 · Dec 29, 2025 – Jan 3, 2027 · 53 weeks\n\n[[2025|‹ 2025]] · [[all_time|↑ All time]] · [[2027|2027 ›]]\n\n"
  + "[[2026/2026-Q1|Q1]] · [[2026/2026-Q2|Q2]] · [[2026/2026-Q3|Q3]] · [[2026/2026-Q4|Q4]]\n";
// Notes that do not exist yet in the preview vault (their links look unresolved).
const PREVIEW_MISSING = ["2026/20261121", "2026/20261122", "2026/20261124", "2026/20261125", "2026/2026-W48", "2027/2027-Q1", "2027",
  ...Array.from({ length: 6 }, (_, i) => `2026/2026-W${48 + i}`)];

function previewCases(H) {
  const day = (date, weekday, prev, next) => DAY_BODY(date, weekday, prev, next, "2026/2026-W47");
  const cases = [
    { name: "recent-closed-ghost", path: "2026/20261114.md", today: "2026-11-19", frontmatter: { intentions: ["Leave enough room to notice what matters"] },
      body: "# 2026-11-14 Sat\n\n[[2026/20261113|prev]] · [[2026/2026-W46|W46]] · [[2026/20261115|next]]\n" },
    { name: "single-intention", path: "2026/20261119.md", today: "2026-11-19", frontmatter: { intentions: ["Protect the first quiet hour"] },
      body: day("2026-11-19", "Thu", "2026/20261118", "2026/20261120") },
    { name: "three-with-both-bands", path: "2026/20261119.md", today: "2026-11-19", frontmatter: { intentions: ["Finish the smallest useful slice", "Ask for the missing context", "Leave a clean handoff"], summary: "A steady day with **one clear finish**.", summary_digest: H.intentionCardDigest("A steady day with **one clear finish**."), summary_drafted: "2026-11-19", reflection: "The pause before the meeting helped.\n\nI kept the afternoon open for follow-through." },
      body: day("2026-11-19", "Thu", "2026/20261118", "2026/20261120") },
    { name: "edited-summary", path: "2026/2026-W47.md", today: "2026-11-19", frontmatter: { intentions: ["Build a reliable week"], summary: "I rewrote this summary after reviewing the week.", summary_digest: "sha256:0000000000000000", summary_drafted: "2026-11-19", reflection: "Keep the quieter pace." },
      body: WEEK_BODY },
    { name: "summary-only", path: "2026/2026-Q4.md", today: "2026-11-19", frontmatter: { summary: "The quarter is taking shape around fewer, better commitments." }, body: QUARTER_BODY },
    { name: "reflection-only", path: "2026.md", today: "2026-11-19", frontmatter: { reflection: "A year can hold a lot of change.\n\nKeep what made the work humane." }, body: YEAR_BODY },
    // Day and period cards (bob-cli-o6 day-period-cards).
    { name: "empty-today-ghost", path: "2026/20261120.md", today: "2026-11-20", frontmatter: {}, body: day("2026-11-20", "Fri", "2026/20261119", "2026/20261121") },
    { name: "past-empty-day", path: "2026/20261117.md", today: "2026-11-20", frontmatter: {}, body: day("2026-11-17", "Tue", "2026/20261116", "2026/20261118") },
    { name: "future-day", path: "2026/20261123.md", today: "2026-11-20", frontmatter: {},
      body: "# 2026-11-23 Mon\n\n[[2026/20261122|prev]] · [[2026/2026-W48|W48]] · [[2026/20261124|next]]\n" },
    { name: "week-children", path: "2026/2026-W47.md", today: "2026-11-20", frontmatter: { intentions: ["Finish the album", "Ship the release train"] }, body: WEEK_BODY },
    { name: "quarter", path: "2026/2026-Q4.md", today: "2026-11-20", frontmatter: { intentions: ["The blog has been released!"] }, body: QUARTER_BODY },
    { name: "year", path: "2026.md", today: "2026-11-20", frontmatter: {}, body: YEAR_BODY },
    { name: "legacy-daily", path: "2025/20250301.md", today: "2026-11-20", frontmatter: {},
      body: "day::2025-03-01 Sat\n\nRelated notes:\n- [[2025/20250228]]\n- [[2025/20250302]]\n" },
  ];
  return cases.map((item) => {
    let model = H.intentionCardModelFor(item.path, item.frontmatter, item.today, null);
    assert.ok(model, `${item.name}: model is available`);
    // What the plugin's model wrapper attaches: identity, the title
    // recognizer's rail from the note body, and the ghost.
    const source = `---\n${JSON.stringify(item.frontmatter)}\n---\n\n${item.body || ""}`;
    const recognizer = H.intentionCardTitleRecognizer(model.subject, item.frontmatter, item.today);
    model = { ...model, today: item.today, identity: H.intentionCardIdentity(model.subject),
      rail: recognizer ? H.intentionCardRailModel(source, model.subject, recognizer, item.today) : null };
    model.ghost = H.intentionCardShowsGhost(model);
    return { ...item, model };
  });
}

// A vault stub where every link resolves except PREVIEW_MISSING.
function previewPlugin() {
  const exists = (target) => !PREVIEW_MISSING.includes(String(target || "").replace(/\.md$/i, ""));
  const file = (target) => ({ path: `${String(target).replace(/\.md$/i, "")}.md` });
  return { app: {
    workspace: {},
    vault: { getAbstractFileByPath: (target) => (exists(target) ? file(target) : null) },
    metadataCache: { getFirstLinkpathDest: (target) => (exists(target) ? file(target) : null), getFileCache: () => null },
  } };
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function cdpTarget(port, child) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Obsidian exited during startup (${child.exitCode})`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) { const page = (await response.json()).find((target) => target.type === "page" && target.webSocketDebuggerUrl); if (page) return page.webSocketDebuggerUrl; }
    } catch (_) {}
    await sleep(200);
  }
  throw new Error("Timed out waiting for Obsidian's CDP page");
}

class CdpClient {
  constructor(endpoint, WebSocketClient) {
    this.socket = new WebSocketClient(endpoint); this.nextId = 0; this.pending = new Map();
    this.opened = new Promise((resolve, reject) => { this.socket.addEventListener("open", resolve, { once: true }); this.socket.addEventListener("error", reject, { once: true }); });
    this.socket.addEventListener("message", (event) => {
      let message; try { message = JSON.parse(String(event.data)); } catch (_) { return; }
      const waiting = this.pending.get(message.id); if (!waiting) return;
      this.pending.delete(message.id);
      if (message.error) waiting.reject(new Error(message.error.message || "CDP command failed")); else waiting.resolve(message.result || {});
    });
  }
  async call(method, params = {}) {
    await this.opened; const id = ++this.nextId;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.socket.send(JSON.stringify({ id, method, params })); });
  }
  close() { try { this.socket.close(); } catch (_) {} }
}

async function installPage(client, html) {
  const encoded = Buffer.from(html).toString("base64");
  const result = await client.call("Runtime.evaluate", { expression: `(() => { const bytes = Uint8Array.from(atob("${encoded}"), (char) => char.charCodeAt(0)); document.open(); document.write(new TextDecoder("utf-8").decode(bytes)); document.close(); return true; })()`, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Could not install preview page");
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const state = await client.call("Runtime.evaluate", { expression: `document.readyState === "complete" && Boolean(document.querySelector(".bob-intention-card"))`, returnByValue: true });
    if (state.result?.value === true) return;
    await sleep(50);
  }
  throw new Error("Preview page did not render the intention card");
}

async function capture(client, outPath) {
  const bounds = await client.call("Runtime.evaluate", { expression: `(() => { const r = document.querySelector(".bob-intention-card").getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()`, returnByValue: true });
  const rect = bounds.result?.value;
  if (!rect || !(rect.width > 0 && rect.height > 0)) throw new Error("Rendered intention card has no visible bounds");
  const image = await client.call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: true, clip: { x: Math.floor(rect.x), y: Math.floor(rect.y), width: Math.ceil(rect.width), height: Math.ceil(rect.height), scale: 1 } });
  const bytes = Buffer.from(image.data, "base64"); fs.writeFileSync(outPath, bytes);
  return { file: path.basename(outPath), sha256: crypto.createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write("Usage: node scripts/preview-intention-card.cjs --out DIRECTORY [-e OBSIDIAN]\n"); return; }
  if (!args.out) throw new Error("--out is required");
  if (!fs.existsSync(args.executable)) throw new Error(`Obsidian executable not found: ${args.executable}`);
  const { helpers: H } = require("./ledger-tools-harness.cjs");
  const cases = previewCases(H);
  const css = fs.readFileSync(path.join(__dirname, "../plugins/bob-ledger-tools/styles.css"), "utf8");
  const outDir = path.resolve(args.out); fs.mkdirSync(outDir, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "intention-card-"));
  const vault = path.join(scratch, "vault"); fs.mkdirSync(path.join(vault, ".obsidian"), { recursive: true }); fs.writeFileSync(path.join(vault, "README.md"), "# Preview scratch vault\n");
  const profile = path.join(scratch, "profile"); const port = await freePort();
  const child = spawn(args.executable, ["--no-sandbox", `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "--remote-allow-origins=http://127.0.0.1/*", vault], { cwd: vault, env: { ...process.env, TMPDIR: "/tmp" }, detached: process.platform !== "win32", stdio: "ignore" });
  let client = null;
  try {
    const endpoint = await cdpTarget(port, child);
    let WebSocketClient = globalThis.WebSocket;
    if (typeof WebSocketClient !== "function") { try { WebSocketClient = require("undici").WebSocket; } catch (_) { WebSocketClient = null; } }
    if (!WebSocketClient) throw new Error("WebSocket is required (Node 22+ or undici)");
    client = new CdpClient(endpoint, WebSocketClient);
    await client.call("Page.enable"); await client.call("Runtime.enable"); await client.call("Page.navigate", { url: "about:blank" }); await sleep(250);
    const report = [];
    for (const item of cases) {
      for (const theme of ["light", "dark"]) {
        for (const width of [1280, 375]) {
          const doc = previewDocument();
          const plugin = previewPlugin();
          const card = H.intentionCardBuildDom(item.model, plugin, doc);
          assert.ok(card?.classList?.contains("bob-property-card"), `${item.name}: shared card painter ran`);
          const caseName = `${item.name}-${theme}-${width}`;
          await client.call("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
          await client.call("Emulation.setEmulatedMedia", { media: "screen", features: [{ name: "prefers-color-scheme", value: theme }, { name: "prefers-reduced-motion", value: "reduce" }] });
          await installPage(client, htmlPage(css, serialize(card), theme));
          const shot = await capture(client, path.join(outDir, `${caseName}.png`));
          report.push({ case: caseName, scenario: item.name, theme, width, screenshot: shot });
        }
      }
    }
    fs.writeFileSync(path.join(outDir, "report.json"), `${JSON.stringify({ screenshotCount: report.length, cases: report }, null, 2)}\n`);
    process.stdout.write(`Rendered ${report.length} intention-card screenshots to ${outDir}\n`);
  } finally {
    client?.close();
    try { if (child.pid && child.exitCode === null) { if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM"); else child.kill("SIGTERM"); } } catch (_) {}
    await sleep(200); fs.rmSync(scratch, { recursive: true, force: true });
  }
}

if (require.main === module) main().catch((error) => { process.stderr.write(`preview-intention-card: ${error.stack || error.message}\n`); process.exitCode = 1; });

module.exports = { parseArgs, previewCases };
