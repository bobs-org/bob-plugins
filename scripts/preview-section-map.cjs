#!/usr/bin/env node
// Render the production Section Map painter plus styles.css in headless
// Chromium. Models come from the production bundle (buildSectionMapModel),
// placement from production computeSectionMapPlacement over measured rects.
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const repoRoot = path.resolve(__dirname, "..");
const pluginRoot = path.join(repoRoot, "plugins/bob-navigation-hotkeys");

function parseArgs(argv) {
  const args = { out: path.join("/tmp", "bob-section-map-preview") };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--out" && argv[index + 1]) args.out = path.resolve(argv[++index]);
    else if (argv[index] === "--help" || argv[index] === "-h") {
      console.log("Usage: node scripts/preview-section-map.cjs [--out DIRECTORY]");
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
      return { EditorView: { updateListener: { of: (listener) => ({ listener }) }, keymap: { of: (value) => value } } };
    }
    return originalLoad.apply(this, arguments);
  };
  let helpers;
  try {
    helpers = require("../plugins/bob-navigation-hotkeys/main.js").helpers;
    for (const name of ["buildSectionMapModel", "computeSectionMapPlacement", "createSectionMapHost"]) {
      if (typeof helpers[name] !== "function") {
        throw new Error(`Section Map helper ${name} missing from the built bundle; run npm run build first.`);
      }
    }
  } finally {
    Module._load = originalLoad;
  }
  return helpers;
}

function headingLines(count, prefix = "Heading") {
  return Array.from({ length: count }, (_unused, index) => `# ${prefix} ${index + 1}`);
}

function buildCases() {
  return [
    {
      id: "margin-ring-chips",
      title: "1 · Margin mode with ring and chips",
      width: 1000,
      column: { left: 100, width: 500 },
      lines: ["# Bob Mac Capture", "body", "## Goals", "## Design", "### Capture grammar", "body", "### Live preview", "body", "### Completion", "body", "## Open questions"],
      cursorLine: 6,
      fromLine: 4,
      direction: 1,
      wrapped: false,
    },
    {
      id: "windowed-overlay",
      title: "2 · Windowed overlay on a 42-heading note",
      width: 700,
      column: null,
      lines: headingLines(42),
      cursorLine: 20,
      fromLine: 18,
      direction: 1,
      wrapped: false,
    },
    {
      id: "wrap-daily",
      title: "3 · Wrap on a 3-heading daily note",
      width: 900,
      column: { left: 80, width: 560 },
      lines: ["# 2026-11-27", "body", "## Morning", "body", "## Evening"],
      cursorLine: 0,
      fromLine: 4,
      direction: 1,
      wrapped: true,
    },
    {
      id: "compact-strip",
      title: "4 · Compact strip in a narrow pane",
      width: 400,
      column: null,
      lines: ["# Alpha", "body", "## Beta", "details", "# Gamma"],
      cursorLine: 3,
      fromLine: 1,
      direction: 1,
      wrapped: false,
    },
    {
      id: "only-section",
      title: "5 · Only-section state",
      width: 1000,
      column: { left: 100, width: 500 },
      lines: ["body", "# Only"],
      cursorLine: 1,
      fromLine: 1,
      direction: 1,
      wrapped: false,
    },
    {
      id: "odd-untitled",
      title: "6 · Odd and untitled labels",
      width: 1000,
      column: { left: 100, width: 500 },
      lines: ["# [[target|Alias]] and **bold** `code`", "# %%comment%%", "#", "# Fish & Chips #tag 😀", "# <b>not a tag here</b>"],
      cursorLine: 3,
      fromLine: 0,
      direction: -1,
      wrapped: false,
    },
    {
      id: "mid-slide",
      title: "7 · Mid-slide between two presses",
      width: 1000,
      column: { left: 100, width: 500 },
      lines: ["# Bob Mac Capture", "body", "## Goals", "## Design", "### Capture grammar", "body", "### Live preview", "body", "### Completion", "body", "## Open questions"],
      cursorLine: 6,
      fromLine: 4,
      direction: 1,
      wrapped: false,
      thenCursorLine: 8,
      thenFromLine: 6,
    },
    {
      id: "notice-nudge",
      title: "9 · Notice nudges the overlay card",
      width: 700,
      column: null,
      lines: headingLines(20),
      cursorLine: 10,
      fromLine: 9,
      direction: 1,
      wrapped: false,
      notice: true,
    },
    {
      id: "reduced-motion",
      title: "8 · Reduced motion keeps the card",
      width: 1000,
      column: { left: 100, width: 500 },
      lines: ["# Bob Mac Capture", "body", "## Goals", "## Design", "### Capture grammar", "body", "### Live preview", "body", "### Completion", "body", "## Open questions"],
      cursorLine: 6,
      fromLine: 4,
      direction: 1,
      wrapped: false,
      reducedMotion: true,
    },
  ];
}

function makeHtml({ css, painterSource, fullRows, cases }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Bob Section Map preview</title>
<style>
:root {
  --font-interface: Inter, ui-sans-serif, system-ui, sans-serif;
  --font-monospace: ui-monospace, SFMono-Regular, Menlo, monospace;
  --font-ui-smaller: 12px;
  --radius-s: 5px;
  --radius-l: 12px;
}
body[data-theme="light"] {
  --background-primary:#fcfcfd; --background-secondary:#f0f1f4;
  --background-modifier-border:#d7d9df; --background-modifier-hover:#e5e7ec;
  --text-normal:#252832; --text-muted:#727783; --text-faint:#a0a4ad;
  --interactive-accent:#624bb8; --text-on-accent:#fff;
  --shadow-s:0 1px 2px #20263a22; --shadow-l:0 12px 32px #20263a24;
  color-scheme:light;
}
body[data-theme="dark"] {
  --background-primary:#202226; --background-secondary:#292c32;
  --background-modifier-border:#41454d; --background-modifier-hover:#383c44;
  --text-normal:#e4e5e9; --text-muted:#a3a7b0; --text-faint:#6b7078;
  --interactive-accent:#b6a0ff; --text-on-accent:#1a1528;
  --shadow-s:0 1px 2px #0006; --shadow-l:0 12px 32px #0008;
  color-scheme:dark;
}
html, body { margin:0; padding:0; background:var(--background-secondary); color:var(--text-normal); font:13px var(--font-interface); }
.preview-chrome {
  display:flex; align-items:center; gap:10px; height:36px; padding:0 16px;
  border-bottom:1px solid var(--background-modifier-border); background:var(--background-primary);
  color:var(--text-muted); font-size:12px; letter-spacing:.04em;
}
.preview-chrome strong { color:var(--text-normal); font-weight:650; letter-spacing:0; }
.preview-pane {
  position:relative; height:600px; margin:16px; background:var(--background-primary);
  border:1px solid var(--background-modifier-border); border-radius:8px; overflow:hidden;
}
.preview-scroller { position:absolute; inset:0; overflow:hidden; }
.preview-text-column { position:absolute; top:0; bottom:0; }
.preview-line { height:22px; line-height:22px; color:var(--text-faint); font-size:12px; white-space:nowrap; overflow:hidden; }
.preview-line.is-heading { color:var(--text-normal); font-weight:600; }
.preview-notice {
  position:absolute; top:0; right:12px; padding:6px 12px; font-size:12px;
  background:var(--background-primary); border:1px solid var(--background-modifier-border);
  border-radius:0 0 8px 8px; color:var(--text-muted);
}
${css}
</style>
</head>
<body data-theme="light">
<header class="preview-chrome" id="chrome"><strong>Section Map</strong><span id="case-title"></span></header>
<div class="preview-pane" id="pane">
  <div class="preview-scroller" id="scroller"><div class="preview-text-column" id="column"></div></div>
  <div class="preview-notice" id="notice" hidden>Section 2 of 12</div>
</div>
<script>
const SECTION_MAP_FULL_ROWS = ${JSON.stringify(fullRows)};
${painterSource}
window.SECTION_MAP_CASES = ${safeJson(cases)};
function rectOf(el) {
  const rect = el.getBoundingClientRect();
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
}
function renderNote(lines) {
  const column = document.getElementById("column");
  column.replaceChildren();
  for (const line of lines) {
    const el = document.createElement("div");
    el.className = "preview-line" + (/^\\s*#{1,6}\\s/.test(line) ? " is-heading" : "");
    el.textContent = line;
    column.appendChild(el);
  }
}
window.sectionMapPreview = {
  host: null,
  layout(id) {
    const item = window.SECTION_MAP_CASES.find((entry) => entry.id === id);
    if (!item) throw new Error("unknown preview case " + id);
    document.getElementById("case-title").textContent = item.title;
    if (this.host) this.host.destroy();
    const pane = document.getElementById("pane");
    const scroller = document.getElementById("scroller");
    const column = document.getElementById("column");
    pane.style.width = item.width + "px";
    scroller.style.left = "0px";
    scroller.style.right = "0px";
    if (item.column) {
      column.style.left = item.column.left + "px";
      column.style.width = item.column.width + "px";
    } else {
      column.style.left = "0px";
      column.style.right = "0px";
      column.style.width = "auto";
    }
    renderNote(item.lines);
    document.getElementById("notice").hidden = !item.notice;
    const hostRect = rectOf(pane);
    const scrollerRect = rectOf(scroller);
    const columnRect = item.column ? rectOf(column) : null;
    const noticeRects = item.notice ? [rectOf(document.getElementById("notice"))] : [];
    this.placement = computeSectionMapPlacement({
      host: hostRect, scroller: scrollerRect, textColumn: columnRect, notices: noticeRects,
    });
    return { placement: this.placement };
  },
  render(model, thenModel, reducedMotion) {
    const pane = document.getElementById("pane");
    const host = createSectionMapHost(document, { mount: pane });
    this.host = host;
    host.render(model, this.placement, { reducedMotion: Boolean(reducedMotion) });
    host.setLiveText(model.ariaSentence);
    if (thenModel) host.render(thenModel, this.placement, { reducedMotion: false });
    return this.measure();
  },
  remeasure() {
    return this.measure();
  },
  measure() {
    const pane = document.getElementById("pane");
    const paneRect = pane.getBoundingClientRect();
    const card = document.querySelector(".bob-section-map");
    const cardRect = card ? card.getBoundingClientRect() : null;
    const pill = document.querySelector(".bob-section-map-pill");
    const pillRect = pill && pill.style.display !== "none" ? pill.getBoundingClientRect() : null;
    const currentRow = document.querySelector(".bob-section-map-row.is-current");
    const rowRect = currentRow ? currentRow.getBoundingClientRect() : null;
    const overflows = [];
    for (const row of document.querySelectorAll(".bob-section-map-row, .bob-section-map-gap")) {
      if (row.scrollWidth > row.clientWidth + 1) overflows.push(row.textContent.slice(0, 40));
    }
    const strip = document.querySelector(".bob-section-map-compact:not(.is-hidden)");
    return {
      cardVisible: Boolean(cardRect && cardRect.width > 0 && cardRect.height > 0),
      cardWithinPane: Boolean(cardRect &&
        cardRect.left >= paneRect.left - 1 && cardRect.right <= paneRect.right + 1 &&
        cardRect.top >= paneRect.top - 1 && cardRect.bottom <= paneRect.bottom + 1),
      cardWidth: cardRect ? cardRect.width : 0,
      pillAligned: !pillRect || !rowRect ? "n/a" : Math.abs(pillRect.top - rowRect.top) <= 2,
      pillHeightMatchesRow: !pillRect || !rowRect ? "n/a" : Math.abs(pillRect.height - rowRect.height) <= 2,
      counter: (document.querySelector(".bob-section-map-counter") || { textContent: "" }).textContent,
      rows: document.querySelectorAll(".bob-section-map-row").length,
      overflows,
      stripHeight: strip ? strip.getBoundingClientRect().height : 0,
      cardRect: cardRect ? { left: cardRect.left, top: cardRect.top, right: cardRect.right, bottom: cardRect.bottom } : null,
      paneRect: { left: paneRect.left, top: paneRect.top, right: paneRect.right, bottom: paneRect.bottom },
      mode: card ? (card.classList.contains("is-compact") ? "compact" : card.classList.contains("is-margin") ? "margin" : "overlay") : "none",
    };
  },
};
window.sectionMapPreviewReady = true;
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
  const hi = Math.max(relativeLuminance(a), relativeLuminance(b));
  const lo = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (hi + 0.05) / (lo + 0.05);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.out, { recursive: true });
  const helpers = loadProductionHelpers();
  const cases = buildCases();
  const css = fs.readFileSync(path.join(pluginRoot, "styles.css"), "utf8");
  const painterSource = fs.readFileSync(path.join(pluginRoot, "src/474-section-map-view.js"), "utf8");
  if (!painterSource.includes("renderSectionMapCard") || !painterSource.includes("computeSectionMapPlacement")) {
    throw new Error("474-section-map-view.js does not define the Section Map painter entry points.");
  }
  const htmlFile = path.join(args.out, "index.html");
  fs.writeFileSync(htmlFile, makeHtml({ css, painterSource, fullRows: helpers.SECTION_MAP_FULL_ROWS, cases }));
  const chromium = findChromium();
  const profile = fs.mkdtempSync(path.join("/tmp", "bob-section-map-preview-"));
  const child = spawn(chromium, [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
    "--remote-debugging-port=0", "--user-data-dir=" + profile, "about:blank",
  ], { stdio: "ignore", env: { ...process.env, TMPDIR: "/tmp" } });
  let client = null;
  try {
    const portFile = path.join(profile, "DevToolsActivePort");
    await waitFor(portFile, child);
    const port = fs.readFileSync(portFile, "utf8").split(/\s+/)[0];
    let pages = null;
    let lastFetchError = null;
    for (let attempt = 0; attempt < 20 && !pages; attempt += 1) {
      try {
        const response = await fetch("http://127.0.0.1:" + port + "/json/list");
        pages = JSON.parse(await response.text());
      } catch (error) {
        lastFetchError = error;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    if (!pages) throw new Error("Chromium DevTools list unreachable on port " + port + ": " + lastFetchError);
    const page = pages.find((item) => item.type === "page");
    if (!page) throw new Error("Chromium did not publish a DevTools page.");
    client = await CdpClient.connect(page.webSocketDebuggerUrl);
    await client.call("Page.enable");
    await client.call("Runtime.enable");
    await client.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await client.call("Page.navigate", { url: pathToFileURL(htmlFile).href });
    const start = Date.now();
    while (Date.now() - start < 15000) {
      if (await client.evaluate("Boolean(window.sectionMapPreviewReady)")) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const screenshots = [];
    const failures = [];
    for (const [theme, normal, surface] of [["light", "#252832", "#f0f1f4"], ["dark", "#e4e5e9", "#292c32"]]) {
      const ratio = contrastRatio(normal, surface);
      if (ratio < 4.5) failures.push(`${theme}/ink: text-normal on surface contrast ${ratio.toFixed(2)}:1 below 4.5:1`);
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
          const layout = await client.evaluate(`window.sectionMapPreview.layout(${safeJson(item.id)})`);
          const model = helpers.buildSectionMapModel(item.lines, {
            cursorLine: item.cursorLine, fromLine: item.fromLine,
            direction: item.direction, wrapped: Boolean(item.wrapped),
            maxRows: layout.placement.maxRows,
          });
          const thenModel = item.thenCursorLine == null ? null : helpers.buildSectionMapModel(item.lines, {
            cursorLine: item.thenCursorLine, fromLine: item.thenFromLine,
            direction: item.direction, wrapped: false,
            maxRows: layout.placement.maxRows,
          });
          let measured = await client.evaluate(
            `window.sectionMapPreview.render(${safeJson(model)}, ${safeJson(thenModel)}, ${safeJson(Boolean(item.reducedMotion))})`,
          );
          if (item.thenCursorLine != null) {
            // Let the 140 ms pill slide settle, then verify it landed.
            await new Promise((resolve) => setTimeout(resolve, 400));
            measured = await client.evaluate("window.sectionMapPreview.remeasure()");
          }
          if (!measured.cardVisible) failures.push(`${theme}/${item.id}: card did not paint`);
          if (!measured.cardWithinPane) failures.push(`${theme}/${item.id}: card escapes the pane`);
          if (measured.overflows.length > 0) {
            failures.push(`${theme}/${item.id}: ${measured.overflows.length} clipped row(s): ${measured.overflows[0]}`);
          }
          if (measured.pillAligned === false) failures.push(`${theme}/${item.id}: pill misses the current row`);
          if (measured.pillHeightMatchesRow === false) failures.push(`${theme}/${item.id}: pill height misses the row`);
          if (item.id === "compact-strip" && measured.mode !== "compact") {
            failures.push(`${theme}/${item.id}: expected compact mode, got ${measured.mode}`);
          }
          if (item.id === "compact-strip" && measured.stripHeight > 40) {
            failures.push(`${theme}/${item.id}: compact strip is ${measured.stripHeight}px tall`);
          }
          if (item.id !== "compact-strip" && measured.mode === "compact") {
            failures.push(`${theme}/${item.id}: unexpected compact mode`);
          }
          if (item.id === "only-section" && !/1 \/ 1/.test(measured.counter.replace(/\s+/g, " "))) {
            failures.push(`${theme}/${item.id}: counter is ${JSON.stringify(measured.counter)}`);
          }
          const output = path.join(args.out, `section-map-${item.id}-${theme}.png`);
          await capture(client, output);
          screenshots.push(output);
        } catch (error) {
          failures.push(`${theme}/${item.id}: ${error.message}`);
        }
      }
    }
    fs.writeFileSync(path.join(args.out, "summary.md"), [
      "# Bob Section Map preview",
      "",
      "Rendered from the production painter (`createSectionMapHost`) plus `styles.css` over a fixture pane.",
      "",
      ...screenshots.map((file) => `- ${path.basename(file)}`),
      "",
      failures.length ? "## Failures\n\n" + failures.map((item) => `- ${item}`).join("\n") : "All layout checks passed.",
      "",
    ].join("\n"));
    console.log(JSON.stringify({ output: args.out, html: htmlFile, chromium, screenshots, failures }, null, 2));
    if (failures.length > 0) {
      console.error(failures.join("\n"));
      process.exitCode = 1;
    }
  } finally {
    if (client) client.socket.close();
    child.kill("SIGKILL");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
