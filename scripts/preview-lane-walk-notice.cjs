#!/usr/bin/env node
// Render the production lane-walk renderer and styles.css in headless
// Chromium. Models come from the production model builders; DOM is a
// minimal Obsidian-Element shim serialized to HTML, and all layout,
// overflow, and rail-wrap measurement happens in Chromium.
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const repoRoot = path.resolve(__dirname, "..");
const pluginRoot = path.join(repoRoot, "plugins/bob-navigation-hotkeys");

const OBSIDIAN_BASELINE_CSS = [
  "/* Obsidian app.css baseline (excerpt). */",
  ":root { --input-height: 30px; }",
  ".markdown-rendered { line-height: 1.5; }",
  ".markdown-source-view.mod-cm6 .cm-content { line-height: 1.5; }",
].join("\n");

function parseArgs(argv) {
  const args = { out: path.join("/tmp", "bob-lane-walk-preview") };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--out" && argv[index + 1]) args.out = path.resolve(argv[++index]);
    else if (argv[index] === "--help" || argv[index] === "-h") {
      console.log("Usage: node scripts/preview-lane-walk-notice.cjs [--out DIRECTORY]");
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
  const cache = path.join(os.homedir(), ".cache/ms-playwright");
  if (fs.existsSync(cache)) {
    const candidates = [];
    for (const browserDir of fs.readdirSync(cache)) {
      if (!browserDir.startsWith("chromium-")) continue;
      for (const platformDir of ["chrome-linux64", "chrome-linux", "chrome-mac/Chromium.app/Contents/MacOS"]) {
        const executable = path.join(cache, browserDir, platformDir, process.platform === "darwin" ? "Chromium" : "chrome");
        if (fs.existsSync(executable)) candidates.push(executable);
      }
    }
    if (candidates.length) return candidates.sort().at(-1);
  }
  throw new Error("Could not find headless Chromium. Set CHROMIUM_PATH to an installed browser executable.");
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

// Minimal Obsidian-Element shim: createDiv/createSpan plus attribute and
// text support, serialized to HTML for the Chromium page.
function escapeHtml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

class FakeEl {
  constructor(tag) {
    this.tag = tag;
    this.classes = [];
    this.attrs = {};
    this.children = [];
    this.text = null;
  }

  createEl(tag, options = {}) {
    const el = new FakeEl(tag);
    if (typeof options.cls === "string" && options.cls) el.classes.push(...options.cls.split(/\s+/));
    if (typeof options.text === "string") el.text = options.text;
    if (options.attr && typeof options.attr === "object") {
      for (const [key, value] of Object.entries(options.attr)) el.attrs[key] = String(value);
    }
    this.children.push(el);
    return el;
  }

  createDiv(options = {}) {
    return this.createEl("div", options);
  }

  createSpan(options = {}) {
    return this.createEl("span", options);
  }

  setAttribute(key, value) {
    this.attrs[String(key)] = String(value);
  }

  toHtml() {
    const cls = this.classes.length ? ` class="${escapeHtml(this.classes.join(" "))}"` : "";
    const attrs = Object.entries(this.attrs)
      .map(([key, value]) => ` ${key}="${escapeHtml(value)}"`)
      .join("");
    const body = escapeHtml(this.text || "") + this.children.map((child) => child.toHtml()).join("");
    return `<${this.tag}${cls}${attrs}>${body}</${this.tag}>`;
  }
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
    if (!helpers || typeof helpers.buildLaneWalkNoticeModel !== "function") {
      throw new Error("Lane-walk helpers missing from the built bundle; run npm run build first.");
    }
  } finally {
    Module._load = originalLoad;
  }
  return helpers;
}

function laneEntry(lane, line, text, notePath = "notes/alpha.md") {
  return {
    key: `${notePath}:${line}`,
    path: notePath,
    line,
    lineNumber: line - 1,
    originalMarkdown: `- [${lane === "pending" ? "/" : "*"}] #task ${text}`,
    text,
    blockId: null,
    lane,
    laneLabel: lane === "pending" ? "PENDING" : "NEXT",
    created: null,
    rank: 0,
    total: 0,
    laneRank: 0,
    laneTotal: 0,
  };
}

function withRanks(rows) {
  const pending = rows.filter((row) => row.lane === "pending").length;
  const next = rows.length - pending;
  let seenPending = 0;
  let seenNext = 0;
  return rows.map((row, index) => ({
    ...row,
    rank: index + 1,
    total: rows.length,
    laneRank: row.lane === "pending" ? (seenPending += 1) : (seenNext += 1),
    laneTotal: row.lane === "pending" ? pending : next,
  }));
}

function buildCases(helpers) {
  const {
    buildLaneWalkNoticeModel,
    buildLaneWalkEmptyNoticeModel,
    renderLaneWalkNoticeFragment,
    renderLaneWalkEmptyFragment,
  } = helpers;
  const render = (model) => {
    const root = new FakeEl("div");
    if (model.empty === true) renderLaneWalkEmptyFragment(model, root);
    else renderLaneWalkNoticeFragment(model, root);
    return root.children.map((child) => child.toHtml()).join("");
  };
  const cases = [];
  const pendingRows = withRanks([
    laneEntry("pending", 3, "Fix vault-sync quarantine for foreign identity clobbers"),
    laneEntry("pending", 9, "second pending"),
    laneEntry("pending", 14, "third pending"),
    laneEntry("next", 20, "next one"),
    laneEntry("next", 26, "next two"),
  ]);
  cases.push({
    id: "pending-mid-walk-worklog",
    title: "PENDING mid-walk with a Work Log",
    html: render(
      buildLaneWalkNoticeModel(pendingRows[1], {
        rank: 2,
        total: 5,
        laneRank: 2,
        laneTotal: 3,
        wrapped: false,
        list: pendingRows,
        workLog: { date: "2026-10-28", summary: "apollo agent" },
      }),
    ),
  });
  cases.push({
    id: "next-after-crossing-created",
    title: "NEXT after a lane crossing with created",
    html: render(
      buildLaneWalkNoticeModel({ ...pendingRows[3], created: "2026-10-03" }, {
        rank: 4,
        total: 5,
        laneRank: 1,
        laneTotal: 2,
        wrapped: false,
        list: pendingRows,
      }),
    ),
  });
  cases.push({
    id: "wrapped",
    title: "wrapped",
    html: render(
      buildLaneWalkNoticeModel(pendingRows[0], {
        rank: 1,
        total: 5,
        laneRank: 1,
        laneTotal: 3,
        wrapped: true,
        list: pendingRows,
      }),
    ),
  });
  cases.push({
    id: "two-line-title",
    title: "a two-line long title",
    html: render(
      buildLaneWalkNoticeModel(
        laneEntry("pending", 3, "A very long task title that should clamp to two lines and then ellipsize instead of growing the card without bound"),
        {
          rank: 1,
          total: 1,
          laneRank: 1,
          laneTotal: 1,
          wrapped: false,
          list: [laneEntry("pending", 3, "x")],
        },
      ),
    ),
  });
  const eight = withRanks(
    [1, 2, 3, 4, 5, 6, 7, 8].map((line) => laneEntry(line <= 5 ? "pending" : "next", line, `task ${line}`)),
  );
  cases.push({
    id: "eight-dots",
    title: "8 entries (dots)",
    html: render(
      buildLaneWalkNoticeModel(eight[3], {
        rank: 4,
        total: 8,
        laneRank: 4,
        laneTotal: 5,
        wrapped: false,
        list: eight,
      }),
    ),
  });
  const forty = withRanks(
    Array.from({ length: 40 }, (_, index) =>
      laneEntry(index < 22 ? "pending" : "next", index + 1, `task ${index + 1}`),
    ),
  );
  cases.push({
    id: "forty-bar",
    title: "40 entries (compressed bar)",
    html: render(
      buildLaneWalkNoticeModel(forty[21], {
        rank: 22,
        total: 40,
        laneRank: 22,
        laneTotal: 22,
        wrapped: false,
        list: forty,
      }),
    ),
  });
  cases.push({
    id: "empty-today",
    title: "empty, everything on today",
    html: render(buildLaneWalkEmptyNoticeModel({ todayPending: 2, todayNext: 1 })),
  });
  cases.push({
    id: "empty-none",
    title: "empty, nothing pending or next",
    html: render(buildLaneWalkEmptyNoticeModel({})),
  });
  return cases;
}

function makeHtml({ css, cases }) {
  const cards = cases
    .map(
      (item) =>
        `<section class="preview-case" data-case="${escapeHtml(item.id)}"><h2>${escapeHtml(item.title)}</h2><div class="preview-card"><div class="notice">${item.html}</div></div></section>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Bob lane walk notice preview</title>
<style>
${OBSIDIAN_BASELINE_CSS}
body[data-theme="light"] {
  --background-primary:#fcfcfd; --background-secondary:#f0f1f4; --background-modifier-border:#d7d9df;
  --text-normal:#252832; --text-muted:#727783; --text-faint:#a0a4ad; --text-accent:#624bb8;
  --color-green:#3f8f5f; --color-orange:#d9822b; --color-yellow:#b87918; --color-blue:#3b82c4;
  --color-purple:#8e63c8; --color-red:#c44950; --font-ui-smaller:12px; --radius-s:5px; --radius-m:8px;
  --shadow-s:0 2px 8px #20263a22;
  --task-status-in-progress:#d9a13b; --task-status-next:#3f8f5f;
  color-scheme:light;
}
body[data-theme="dark"] {
  --background-primary:#202226; --background-secondary:#292c32; --background-modifier-border:#41454d;
  --text-normal:#e4e5e9; --text-muted:#a3a7b0; --text-faint:#6b7078; --text-accent:#b6a0ff;
  --color-green:#3f8f5f; --color-orange:#d9822b; --color-yellow:#e8b55e; --color-blue:#6aa5e8;
  --color-purple:#b48ae8; --color-red:#ee797e; --font-ui-smaller:12px; --radius-s:5px; --radius-m:8px;
  --shadow-s:0 2px 8px #0008;
  --task-status-in-progress:#e0aa3e; --task-status-next:#73c99d;
  color-scheme:dark;
}
body { margin:0; padding:28px; background:var(--background-secondary); color:var(--text-normal); font:14px sans-serif; }
.preview-shell { max-width:940px; margin:0 auto; padding:22px; border:1px solid var(--background-modifier-border); border-radius:14px; background:var(--background-primary); }
.preview-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; align-items:start; }
.preview-case { min-width:0; padding:10px; border:1px solid var(--background-modifier-border); border-radius:10px; background:var(--background-secondary); }
.preview-case h2 { margin:0 0 9px; color:var(--text-muted); font-size:10px; letter-spacing:.08em; text-transform:uppercase; }
.preview-card .notice { max-width:380px; }
${css}
</style>
</head>
<body data-theme="light">
<main class="preview-shell"><div class="preview-grid">${cards}</div></main>
<script>
window.laneWalkPreview = {
  measure() {
    const out = [];
    for (const section of document.querySelectorAll(".preview-case")) {
      const card = section.querySelector(".bob-nh-notice");
      const rail = section.querySelector(".bob-nh-lane-walk-rail");
      const overflow = card ? card.scrollWidth - card.clientWidth : 0;
      const railOverflow = rail ? rail.scrollWidth - rail.clientWidth : 0;
      const firstTop = rail && rail.children.length ? rail.children[0].offsetTop : 0;
      const railWrapped = rail
        ? Array.from(rail.children).some((child) => Math.abs(child.offsetTop - firstTop) > 4)
        : false;
      out.push({ id: section.dataset.case, overflow, railOverflow, railWrapped });
    }
    return out;
  }
};
window.laneWalkPreviewReady = true;
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.out, { recursive: true });
  const helpers = loadProductionHelpers();
  const cases = buildCases(helpers);
  const css = fs.readFileSync(path.join(pluginRoot, "styles.css"), "utf8");
  const htmlFile = path.join(args.out, "index.html");
  fs.writeFileSync(htmlFile, makeHtml({ css, cases }));
  const chromium = findChromium();
  const profile = fs.mkdtempSync(path.join("/tmp", "bob-lane-preview-"));
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
    await client.call("Emulation.setDeviceMetricsOverride", { width: 1040, height: 1680, deviceScaleFactor: 1, mobile: false });
    await client.call("Page.navigate", { url: pathToFileURL(htmlFile).href });
    const start = Date.now();
    while (Date.now() - start < 15000) {
      if (await client.evaluate("Boolean(window.laneWalkPreviewReady)")) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const screenshots = [];
    const failures = [];
    for (const theme of ["light", "dark"]) {
      await client.evaluate(`document.body.dataset.theme = ${safeJson(theme)}`);
      const measurements = await client.evaluate("window.laneWalkPreview.measure()");
      for (const item of measurements) {
        if (item.overflow > 0.5) failures.push(`${theme}/${item.id}: card overflows 380px by ${item.overflow}px`);
        if (item.railOverflow > 0.5) failures.push(`${theme}/${item.id}: rail overflows by ${item.railOverflow}px`);
        if (item.railWrapped) failures.push(`${theme}/${item.id}: rail wraps`);
      }
      const output = path.join(args.out, `lane-walk-${theme}.png`);
      await capture(client, output);
      screenshots.push(output);
    }
    fs.writeFileSync(path.join(args.out, "matrix-report.md"), [
      "# Bob lane walk notice preview",
      "",
      "Rendered from the production lane-walk renderer plus `styles.css` under an Obsidian baseline stylesheet.",
      "",
      "Cases: PENDING mid-walk with a Work Log, NEXT after a lane crossing with created, wrapped, a two-line long title, 8 entries (dots), 40 entries (compressed bar), both empty states.",
      "",
      ...screenshots.map((file) => `- ${path.basename(file)}`),
      "",
    ].join("\n"));
    if (failures.length > 0) {
      console.error(failures.join("\n"));
      process.exitCode = 1;
    }
    console.log(JSON.stringify({ output: args.out, html: htmlFile, chromium, screenshots }, null, 2));
  } finally {
    if (client) client.socket.close();
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) resolve();
      else child.once("exit", resolve);
    });
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error((error && error.stack) || error);
  process.exitCode = 1;
});
