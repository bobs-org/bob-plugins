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
const PERIOD_STRIP_HEIGHT_BOTH = 320;
const PERIOD_STRIP_HEIGHT_SINGLE = 270;

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

function displayMinutes(minutes) {
  const value = Math.round(Number(minutes) || 0);
  const hours = Math.floor(value / 60);
  const remainder = value % 60;
  return hours ? `${hours}h ${String(remainder).padStart(2, "0")}m` : `${remainder}m`;
}

function displayShort(minutes) {
  return minutes >= 600 ? `${Math.floor((minutes + 30) / 60)}h` : displayMinutes(minutes);
}

// The production painter consumes bob's charts/stacks contract. The older
// fixtures predate it, so preview fixtures add chart-shaped sample data here.
function addPreviewCharts(source) {
  const report = structuredClone(source);
  const columns = Array.isArray(report.columns) ? report.columns : [];
  const typesByKey = new Map();
  const rawRoots = new Map();
  for (const column of columns) {
    const total = column && column.worked && Number(column.worked.value) > 0 ? Number(column.worked.value) : 0;
    const roots = new Map();
    for (const item of column && Array.isArray(column.stack) ? column.stack : []) {
      if (!item || typeof item.key !== "string" || !(Number(item.minutes) > 0)) continue;
      const key = item.key === "@unlinked" || item.key === "@unfiled" ? "@unattributed" : item.key;
      roots.set(key, (roots.get(key) || 0) + Number(item.minutes));
    }
    let rootTotal = Array.from(roots.values()).reduce((sum, value) => sum + value, 0);
    if (rootTotal < total) roots.set("@unattributed", (roots.get("@unattributed") || 0) + total - rootTotal);
    else if (rootTotal > total) {
      let excess = rootTotal - total;
      for (const [key, value] of Array.from(roots.entries()).reverse()) {
        const removed = Math.min(value, excess);
        roots.set(key, value - removed);
        excess -= removed;
        if (!excess) break;
      }
    }
    for (const [key, minutes] of roots) {
      if (minutes <= 0) continue;
      rawRoots.set(key, (rawRoots.get(key) || 0) + minutes);
    }
    const build = Math.floor(total * 0.54);
    const fix = Math.floor(total * 0.26);
    const untyped = total - build - fix;
    if (build > 0) typesByKey.set("build", (typesByKey.get("build") || 0) + build);
    if (fix > 0) typesByKey.set("fix", (typesByKey.get("fix") || 0) + fix);
    if (untyped > 0) typesByKey.set("@unattributed", (typesByKey.get("@unattributed") || 0) + untyped);
    column.__previewRoots = Array.from(roots.entries()).filter(([, value]) => value > 0);
    column.__previewTypes = [
      ["build", build], ["fix", fix], ["@unattributed", untyped],
    ].filter(([, value]) => value > 0);
  }

  const homes = report.homes && typeof report.homes === "object" ? report.homes : {};
  const namedRoots = Array.from(rawRoots.entries()).filter(([key]) => !key.startsWith("@"))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const topRoots = namedRoots.slice(0, 5);
  const restRoots = namedRoots.slice(5);
  const rootSeries = topRoots.map(([key, minutes]) => ({
    key, kind: "root", label: (homes[key] && homes[key].label) || key.replace(/\.md$/i, ""),
    minutes, display: displayMinutes(minutes), display_short: displayShort(minutes),
  }));
  const restMinutes = restRoots.reduce((sum, [, minutes]) => sum + minutes, 0);
  if (restMinutes > 0) rootSeries.push({
    key: "@rest", kind: "rest", label: `${restRoots.length} more`, minutes: restMinutes,
    display: displayMinutes(restMinutes), display_short: displayShort(restMinutes),
    members: restRoots.map(([key, minutes]) => ({ key, label: (homes[key] && homes[key].label) || key.replace(/\.md$/i, ""), minutes, display: displayMinutes(minutes) })),
  });
  const unattributed = rawRoots.get("@unattributed") || 0;
  if (unattributed > 0) rootSeries.push({ key: "@unattributed", kind: "unattributed", label: "unlinked", minutes: unattributed, display: displayMinutes(unattributed), display_short: displayShort(unattributed) });

  const typeLabels = { build: "BUILD", fix: "FIX", "@unattributed": "untyped" };
  const typeSeries = Array.from(typesByKey.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([key, minutes]) => ({
    key, kind: key.startsWith("@") ? "unattributed" : "type", label: typeLabels[key] || key.toUpperCase(),
    minutes, display: displayMinutes(minutes), display_short: displayShort(minutes),
  }));
  const rootKeys = new Set(topRoots.map(([key]) => key));
  const typeOrder = typeSeries.map((row) => row.key);
  for (const column of columns) {
    const rootParts = new Map();
    for (const [key, minutes] of column.__previewRoots || []) {
      const target = key.startsWith("@") ? "@unattributed" : (rootKeys.has(key) ? key : "@rest");
      rootParts.set(target, (rootParts.get(target) || 0) + minutes);
    }
    column.stacks = {
      roots: rootSeries.map((series) => ({ key: series.key, minutes: rootParts.get(series.key) || 0 })).filter((row) => row.minutes > 0),
      types: typeOrder.map((key) => ({ key, minutes: (column.__previewTypes || []).find((row) => row[0] === key)?.[1] || 0 })).filter((row) => row.minutes > 0),
    };
    delete column.__previewRoots;
    delete column.__previewTypes;
  }
  report.theme_hues = {
    ...(report.theme_hues || {}),
    build: { name: "BUILD", hue: "aqua", configured: true },
    fix: { name: "FIX", hue: "red", configured: true },
  };
  report.charts = {
    version: 1,
    roots: { limit: 5, dimension: "root_parent", series: rootSeries },
    types: { policy: "configured", series: typeSeries },
  };
  return report;
}

function loadFixtures() {
  const dir = path.join(pluginRoot, "scripts/fixtures/stats");
  const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, `period-strip-${name}-week.json`), "utf8"));
  const parts = require(path.join(dir, "period-parts-fixtures.cjs")).periodPartsFixtures(read("closed"));
  return Object.fromEntries(Object.entries({
    current: read("current"), closed: read("closed"), "pre-ledger": read("pre-ledger"), future: read("future"),
    "current-quarter": parts.currentQuarter, "closed-quarter": parts.closedQuarter, year: parts.year, all: parts.all,
  }).map(([key, report]) => [key, addPreviewCharts(report)]));
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
    for (const width of [530, 760]) {
      for (const theme of ["light", "dark"]) {
        await client.call("Emulation.setDeviceMetricsOverride", { width, height: 1500, deviceScaleFactor: 1, mobile: false });
        for (const view of ["both", "roots", "types"]) {
          await sleep(100);
          const result = await client.evaluate(`window.periodStripPreview.renderMatrix(${width}, ${JSON.stringify(theme)}, ${JSON.stringify(view)})`);
          for (const item of result.measurements.filter((entry) => (entry.kind === "week" || entry.kind === "quarter") && entry.state !== "future")) {
            rows.push({ width, theme, view, ...item });
            const both = view === "both";
            const budget = both ? PERIOD_STRIP_HEIGHT_BOTH : PERIOD_STRIP_HEIGHT_SINGLE;
            if (item.stripHeight > budget + 0.5) failures.push(`${item.state} ${item.kind} ${view} ${width}px ${theme}: ${item.stripHeight}px over ${budget}px`);
            if (!item.noOverflow) failures.push(`${item.state} ${item.kind} ${view} ${width}px ${theme}: horizontal overflow`);
            if (item.overlap) failures.push(`${item.state} ${item.kind} ${view} ${width}px ${theme}: caption/value overlap`);
            if (!item.proportional) failures.push(`${item.state} ${item.kind} ${view} ${width}px ${theme}: chart pieces do not match their minute proportions`);
          }
        }
      }
    }

    for (const [width, theme, view] of [[760, "light", "both"], [530, "dark", "types"]]) {
      await client.evaluate(`window.periodStripPreview.renderMatrix(${width}, ${JSON.stringify(theme)}, ${JSON.stringify(view)}, ["closed", "closed-quarter"])`);
      await sleep(150);
      const screenshot = await client.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      const name = `period-strip-${width}-${theme}-${view}.png`;
      fs.writeFileSync(path.join(args.out, name), Buffer.from(screenshot.data, "base64"));
    }
    const report = [
      "# Period strip chart preview",
      "",
      ...rows.map((item) => `- ${item.width}px ${item.theme} ${item.view} ${item.state} (${item.kind}): ${item.stripHeight}px; overflow ${item.noOverflow ? "none" : "yes"}; proportional ${item.proportional ? "yes" : "no"}`),
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
