#!/usr/bin/env node
// Render the production Day strip model, painter, and stylesheet in Chromium.
// The output is dev-only; no browser dependency is needed beyond Chromium.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const repoRoot = path.resolve(__dirname, "..");
const pluginRoot = path.join(repoRoot, "plugins/bob-ledger-tools");

function parseArgs(argv) {
  const args = { out: path.join("/tmp", "bob-day-strip-preview") };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--out" && argv[index + 1]) args.out = path.resolve(argv[++index]);
    else if (argv[index] === "--help" || argv[index] === "-h") {
      console.log("Usage: node scripts/preview-day-strip.cjs [--out DIRECTORY]");
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

function loadFixtures() {
  const source = require(path.join(pluginRoot, "scripts/fixtures/stats/day-strip-fixtures.cjs"));
  const result = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === "createReport" || !value || typeof value !== "object" || !value.report) continue;
    result[key] = value;
  }
  const notTrackedWarning = JSON.parse(JSON.stringify(result.notTracked));
  notTrackedWarning.name = "not tracked plus a journal warning";
  notTrackedWarning.report.warnings.push({
    code: "journal_gap",
    date: notTrackedWarning.day,
    message: "A review-journal gap was recorded for this day.",
  });
  result.notTrackedWarning = notTrackedWarning;
  return result;
}

function makeHtml({ pluginSource, css, fixtures }) {
  return fs.readFileSync(path.join(__dirname, "preview-day-strip.template.html"), "utf8")
    .replace("__PRODUCTION_CSS__", () => css)
    .replace("__PLUGIN_SOURCE_JSON__", () => safeJson(pluginSource))
    .replace("__FIXTURES_JSON__", () => safeJson(fixtures));
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
      if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
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
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception && response.exceptionDetails.exception.description || response.exceptionDetails.text);
    }
    return response.result && response.result.value;
  }
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitForFile(file, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(file)) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${file}`);
}

async function waitForPreview(client) {
  const start = Date.now();
  let lastError = "";
  let lastState = null;
  while (Date.now() - start < 15000) {
    let state;
    try {
      state = await client.evaluate("({ ready: Boolean(window.__dayStripPreviewReady), error: window.__previewError || '', stage: window.__dayStripStage || '', state: document.readyState })");
      lastState = state;
    } catch (error) { lastError = error && error.message ? error.message : String(error); }
    if (state && state.error) throw new Error(`Preview page error: ${state.error}`);
    if (state && state.ready) return;
    await sleep(50);
  }
  throw new Error("Day strip preview did not become ready." + (lastError ? " Last CDP error: " + lastError : "") + (lastState ? " Page state: " + JSON.stringify(lastState) : ""));
}

async function capturePage(client, output) {
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

function matrixMarkdown(matrix, browser, revision) {
  const measurements = matrix.flatMap((entry) => entry.measurements.map((item) => ({ ...item, width: entry.width, theme: entry.theme, screenshot: entry.screenshot })));
  return [
    "# Day strip Chromium preview matrix",
    "",
    `- Renderer checkout revision: ${revision}.`,
    `- Browser: ${browser}.` ,
    "- Source: production `main.js`, `styles.css`, and synthetic presentation fixtures; no fixture is captured vault data.",
    "- Grid: light and dark themes × 410, 540, and 700 px note columns × 10 states.",
    "- Height budgets: expanded single-row strips ≤104 px; each additional tile row adds 66 px; collapsed ≤26 px; unavailable ≤40 px.",
    "- Alignment checks compare value and mark baselines within each tile row, and the mix width against the full tile row.",
    "",
    "| Width | Theme | State | Strip height | Budget | Tile rows | Value baseline spread | Mark baseline spread | Mix width delta | Skeleton delta | Result | Screenshot |",
    "| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |",
    ...measurements.map((item) => `| ${item.width}px | ${item.theme} | ${item.state} | ${item.stripHeight}px | ${item.heightBudget}px | ${item.tileRows} | ${item.valueBaselineSpread}px | ${item.markBaselineSpread}px | ${item.mixWidth}px | ${item.skeletonHeightDelta === null ? "—" : `${item.skeletonHeightDelta}px`} | ${item.result} | ${item.screenshot} |`),
    "",
    "Synthetic cases: today in progress, complete past day, collapsed, skeleton, stale cached frame, unavailable, no Pomodoros, not tracked with a journal warning, seven areas with `+N`, and a redefined `worked` without area parts.",
    "",
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.out, { recursive: true });
  const pluginSource = fs.readFileSync(path.join(pluginRoot, "main.js"), "utf8");
  const css = fs.readFileSync(path.join(pluginRoot, "styles.css"), "utf8");
  const fixtures = loadFixtures();
  const htmlFile = path.join(args.out, "index.html");
  fs.writeFileSync(htmlFile, makeHtml({ pluginSource, css, fixtures }));
  const chromium = findChromium();
  const profile = fs.mkdtempSync(path.join("/tmp", "bob-day-strip-chromium-"));
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
    await waitForPreview(client);
    const browserVersion = await client.call("Browser.getVersion");
    const revision = spawnSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim();
    const matrix = [];
    for (const width of [410, 540, 700]) {
      for (const theme of ["light", "dark"]) {
        await client.call("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
        const result = await client.evaluate(`window.dayStripPreview.renderMatrix(${width}, ${JSON.stringify(theme)})`);
        const screenshot = `day-strip-${width}-${theme}.png`;
        await capturePage(client, path.join(args.out, screenshot));
        const readyHeight = result.measurements.find((item) => item.state === "today").stripHeight;
        const skeletonHeight = result.measurements.find((item) => item.state === "skeleton").stripHeight;
        const skeletonHeightDelta = Math.round(Math.abs(readyHeight - skeletonHeight) * 10) / 10;
        const measurements = result.measurements.map((item) => ({
          ...item,
          skeletonHeightDelta: item.state === "skeleton" ? skeletonHeightDelta : null,
          result: item.heightPass && item.mixPass && item.valueBaselineSpread <= 1 && item.markBaselineSpread <= 1 && (item.state !== "skeleton" || skeletonHeightDelta <= 0.5) ? "pass" : "review",
        }));
        matrix.push({ ...result, measurements, screenshot });
      }
    }
    const report = matrixMarkdown(matrix, browserVersion.product, revision);
    fs.writeFileSync(path.join(args.out, "matrix-report.md"), report);
    const failures = matrix.flatMap((entry) => entry.measurements.filter((item) => item.result !== "pass").map((item) => `${entry.width}px ${entry.theme} ${item.state}: height ${item.stripHeight}/${item.heightBudget}, value alignment ${item.valueBaselineSpread}, marks ${item.markBaselineSpread}, mix delta ${item.mixWidth}`));
    const overflow = matrix.filter((item) => item.pageScrollWidth > item.viewportWidth);
    console.log(JSON.stringify({ output: args.out, html: htmlFile, chromium, browser: browserVersion.product, screenshots: matrix.map((item) => path.join(args.out, item.screenshot)), cells: matrix.reduce((sum, item) => sum + item.measurements.length, 0), failures, overflow: overflow.map((item) => `${item.width}px ${item.theme}`) }, null, 2));
    if (failures.length || overflow.length) throw new Error("Preview matrix failed its geometry or no-overflow checks; inspect matrix-report.md and screenshots.");
  } finally {
    if (client) client.socket.close();
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
