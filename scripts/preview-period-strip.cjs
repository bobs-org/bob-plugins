#!/usr/bin/env node
// Render the production period strip and parts table in Chromium under an
// Obsidian baseline stylesheet. Mirrors preview-day-strip.cjs.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const repoRoot = path.resolve(__dirname, "..");
const pluginRoot = path.join(repoRoot, "plugins/bob-ledger-tools");
const PERIOD_STRIP_HEIGHT_WEEK = 240;
const PERIOD_STRIP_HEIGHT_WEEK_WRAPPED = 306; // 240 plus the Day strip wrapped increment (198 - 132)

const OBSIDIAN_BASELINE_CSS = [
  "/* Obsidian app.css baseline (excerpt). */",
  ":root { --input-height: 30px; }",
  "button {",
  "  display: inline-flex;",
  "  align-items: center;",
  "  justify-content: center;",
  "  height: var(--input-height);",
  "}",
  "a { color: var(--text-accent); }",
  ".markdown-rendered { line-height: 1.5; }",
].join("\n");

function parseArgs(argv) {
  const args = { out: path.join("/tmp", "bob-period-strip-preview") };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--out" && argv[index + 1]) args.out = path.resolve(argv[++index]);
    else if (argv[index] === "--help" || argv[index] === "--help") {
      console.log("Usage: node scripts/preview-period-strip.cjs [--out DIRECTORY]");
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
      for (const platformDir of ["chrome-linux64", "chrome-linux"]) {
        const executable = path.join(cache, browserDir, platformDir, "chrome");
        if (fs.existsSync(executable)) candidates.push(executable);
      }
    }
    if (candidates.length) return candidates.sort().at(-1);
  }
  return null;
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function loadFixtures() {
  const dir = path.join(pluginRoot, "scripts/fixtures/stats");
  const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, `period-strip-${name}-week.json`), "utf8"));
  const parts = require(path.join(dir, "period-parts-fixtures.cjs")).periodPartsFixtures(read("closed"));
  return {
    current: read("current"), closed: read("closed"), "pre-ledger": read("pre-ledger"), future: read("future"),
    "current-quarter": parts.currentQuarter, "closed-quarter": parts.closedQuarter, year: parts.year, all: parts.all,
  };
}

function makeHtml({ pluginSource, css, fixtures }) {
  return fs.readFileSync(path.join(__dirname, "preview-period-strip.template.html"), "utf8")
    .replace("__OBSIDIAN_BASELINE_CSS__", () => OBSIDIAN_BASELINE_CSS)
    .replace("__PRODUCTION_CSS__", () => css)
    .replace("__PLUGIN_SOURCE_JSON__", () => safeJson(pluginSource))
    .replace("__FIXTURES_JSON__", () => safeJson(fixtures));
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitForFile(file, timeoutMs = 15000) {
  const start = Date.now();
  for (;;) {
    if (fs.existsSync(file)) return;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${file}`);
    await sleep(100);
  }
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(String(pending.method) + ": " + (message.error.message || JSON.stringify(message.error))));
      else pending.resolve(message.result || {});
    });
  }
  static async connect(endpoint) {
    let WebSocketClient = typeof globalThis.WebSocket === "function" ? globalThis.WebSocket : null;
    if (!WebSocketClient) {
      try { WebSocketClient = require("undici").WebSocket || null; }
      catch (error) { WebSocketClient = null; }
    }
    if (!WebSocketClient) throw new Error("The preview needs Node 22+ WebSocket or the undici WebSocket client.");
    const socket = new WebSocketClient(endpoint);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    return new CdpClient(socket);
  }
  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const response = await this.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception && response.exceptionDetails.exception.description || response.exceptionDetails.text);
    }
    return response.result && response.result.value;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.out, { recursive: true });
  const pluginSource = fs.readFileSync(path.join(pluginRoot, "main.js"), "utf8");
  const css = fs.readFileSync(path.join(pluginRoot, "styles.css"), "utf8");
  const fixtures = loadFixtures();
  const htmlFile = path.join(args.out, "index.html");
  fs.writeFileSync(htmlFile, makeHtml({ pluginSource, css, fixtures }));
  console.log(`Wrote ${htmlFile}`);
  const chromium = findChromium();
  if (!chromium) {
    console.log("No headless Chromium found; wrote HTML only (set CHROMIUM_PATH to measure).");
    return;
  }
  const profile = fs.mkdtempSync(path.join("/tmp", "bob-period-strip-chromium-"));
  const child = spawn(chromium, [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: "ignore", env: { ...process.env, TMPDIR: "/tmp" } });
  let client = null;
  try {
    const activePortFile = path.join(profile, "DevToolsActivePort");
    await waitForFile(activePortFile);
    const port = fs.readFileSync(activePortFile, "utf8").split(/\s+/)[0];
    let pageInfo = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      pageInfo = pages.find((page) => page.type === "page");
      if (pageInfo) break;
      await sleep(100);
    }
    if (!pageInfo) throw new Error("Chromium did not publish a DevTools page.");
    client = await CdpClient.connect(pageInfo.webSocketDebuggerUrl);
    await client.call("Page.enable");
    await client.call("Runtime.enable");
    await client.call("Page.navigate", { url: pathToFileURL(htmlFile).href });
    await sleep(1500);
    const failures = [];
    const rows = [];
    for (const width of [130, 410, 700]) {
      for (const theme of ["light", "dark"]) {
        await client.call("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
        await sleep(300);
        const result = await client.evaluate(`window.periodStripPreview.renderMatrix(${width}, ${JSON.stringify(theme)})`);
        for (const item of result.measurements) {
          rows.push({ width, theme, ...item });
          const budget = width <= 410 ? PERIOD_STRIP_HEIGHT_WEEK_WRAPPED : PERIOD_STRIP_HEIGHT_WEEK;
          if (width >= 300 && ["current", "closed", "pre-ledger"].includes(item.state) && item.stripHeight > budget + 0.5) {
            failures.push(`${item.state} ${width}px ${theme}: height ${item.stripHeight}px over the ${budget}px budget`);
          }
          if (item.kind === "year" && width <= 150 && !item.yearFallback) failures.push(`year ${width}px ${theme}: narrow quarter fallback did not render`);
        }
      }
    }
    const report = [
      "# Period strip and parts table preview",
      "",
      ...rows.map((item) => `- ${item.width}px ${item.theme} ${item.state} (${item.kind}): strip ${item.stripHeight}px, table ${item.tableHeight}px${item.kind === "year" ? (item.yearFallback ? ", quarter fallback" : ", week detail") : ""}`),
      "",
      failures.length ? `FAIL: ${failures.join("; ")}` : "The period preview matrix rendered without layout errors.",
    ].join("\n");
    fs.writeFileSync(path.join(args.out, "report.md"), report + "\n");
    console.log(report);
    if (failures.length) process.exitCode = 1;
  } finally {
    try {
      if (client) client.socket.close();
    } catch (error) {
      // Best-effort.
    }
    try {
      child.kill();
    } catch (error) {
      // Best-effort.
    }
  }
}

main().catch((error) => {
  console.error(String(error && error.stack || error));
  process.exit(1);
});
