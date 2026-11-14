#!/usr/bin/env node
// Render the production Bank Period Charts panel in Chromium under an
// Obsidian baseline stylesheet. Mirrors preview-period-strip.cjs.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const repoRoot = path.resolve(__dirname, "..");
const pluginRoot = path.join(repoRoot, "plugins/bob-ledger-tools");

const OBSIDIAN_BASELINE_CSS = [
  "/* Obsidian app.css baseline (excerpt). */",
  ":root { --input-height: 30px; }",
  "a { color: var(--text-accent); }",
  ".markdown-rendered { line-height: 1.5; }",
].join("\n");

function parseArgs(argv) {
  const args = { out: path.join("/tmp", "bob-bank-period-preview") };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--out" && argv[index + 1]) args.out = path.resolve(argv[++index]);
    else if (argv[index] === "--help") {
      console.log("Usage: node scripts/preview-bank-period.cjs [--out DIRECTORY]");
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

function totals(overrides = {}) {
  return {
    in_cents: 0, out_cents: 0, net_cents: 0, refund_cents: 0,
    transfer_out_cents: 0, transfer_in_cents: 0, cash_out_cents: 0,
    cash_traced_cents: 0, unclassified_out_cents: 0, unclassified_in_cents: 0,
    ...overrides,
  };
}

function loadHelpers() {
  const harness = require("./ledger-tools-harness.cjs");
  return harness.LedgerToolsPlugin.helpers;
}

function buildFixtures() {
  const helpers = loadHelpers();
  const monday = helpers.periodNotesIsoWeekMonday;
  const shift = helpers.bankIsoShiftDays;
  const entry = (overrides = {}) => {
    const inCents = overrides.in_cents || 0;
    const outCents = overrides.out_cents || 0;
    return {
      id: "2026-11-09", kind: "day", label: "Mon 9",
      start: "2026-11-09", end: "2026-11-09", group: null,
      so_far: false, state: "tracked", waiting: 0, rows: 0, top_out: [],
      target: { path: "bank/2026-11.md", line: 12 },
      ...overrides,
      in_cents: inCents, out_cents: outCents,
      net_cents: Object.prototype.hasOwnProperty.call(overrides, "net_cents")
        ? overrides.net_cents : inCents - outCents,
    };
  };
  const weekStart = monday(2026, 46);
  const weekEnd = shift(weekStart, 6);
  const weekDays = (fill) => {
    const days = [];
    for (let index = 0; index < 7; index += 1) {
      const id = shift(weekStart, index);
      const label = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][index] + " " + Number(id.slice(8));
      days.push(entry({ id, label, start: id, end: id, ...(fill(id) || {}) }));
    }
    return days;
  };
  const baseReport = (overrides = {}) => ({
    command: "report", teaching_empty: false,
    period: { kind: "week", key: "2026-W46", start: weekStart, end: weekEnd, label: "2026-W46", so_far: true, note: null },
    totals: totals({ out_cents: 24977, net_cents: -24977 }),
    breakdown: [], days: [],
    waiting: { period: 7, all: 7, oldest: "2026-11-11" },
    coverage: { tracked_since: "2026-11-01", imported_through: "2026-11-11", start: weekStart, through: "2026-11-11", complete: false },
    navigation: {
      waiting: { path: "bank/2026-11.md", line: 12, date: "2026-11-11" },
      first: { path: "bank/2026-11.md", line: 12, date: "2026-11-11" },
      months: ["bank/2026-11.md"],
    },
    ...overrides,
  });
  const weekCategories = {
    limit: 5,
    series: [
      { key: "groceries", emoji: "🛒", label: "Groceries", kind: "category", out_cents: 14210, share: 0.569, rows: 3 },
      { key: "dining", emoji: "🍽", label: "Dining", kind: "category", out_cents: 6420, share: 0.257, rows: 2 },
      { key: "unclassified", emoji: "●", label: "Unclassified", kind: "unclassified", out_cents: 2047, share: 0.082, rows: 1 },
    ],
    rest: { count: 2, out_cents: 2300, share: 0.092, rows: 2 },
  };
  const weekBuckets = weekDays((id) => (id === "2026-11-11"
    ? { state: "tracked", out_cents: 24977, waiting: 7, rows: 7, top_out: [{ key: "groceries", emoji: "🛒", label: "Groceries", out_cents: 14210 }] }
    : { state: "awaiting_import", so_far: id === "2026-11-14" }));
  const richBuckets = weekDays((id) => ({
    "2026-11-09": { state: "untracked" },
    "2026-11-10": { state: "partial", out_cents: 1200, rows: 2 },
    "2026-11-11": { state: "tracked", in_cents: 250000, out_cents: 24977, waiting: 2, rows: 8, so_far: true, top_out: [{ key: "groceries", emoji: "🛒", label: "Groceries", out_cents: 14210 }] },
    "2026-11-12": { state: "awaiting_import" },
  }[id] || { state: "awaiting_import" }));
  const q4Buckets = [];
  for (let weekNo = 40; weekNo <= 53; weekNo += 1) {
    const start = monday(2026, weekNo);
    q4Buckets.push(entry({
      id: `2026-W${String(weekNo).padStart(2, "0")}`, kind: "week", label: `W${weekNo}`,
      start, end: shift(start, 6), group: null,
      out_cents: weekNo === 46 ? 24977 : 0, state: "tracked",
    }));
  }
  const yearBuckets = [];
  const lastWeek = monday(2026, 53) ? 53 : 52;
  for (let weekNo = 1; weekNo <= lastWeek; weekNo += 1) {
    const start = monday(2026, weekNo);
    yearBuckets.push(entry({
      id: `2026-W${String(weekNo).padStart(2, "0")}`, kind: "week", label: `W${weekNo}`,
      start, end: shift(start, 6), group: `Q${Math.min(4, Math.floor((weekNo - 1) / 13) + 1)}`,
      out_cents: weekNo === 46 ? 24977 : weekNo === 10 ? 500000 : 0,
      in_cents: weekNo === 10 ? 250000 : 0,
      state: "tracked",
    }));
  }
  const yearGroups = ["Q1", "Q2", "Q3", "Q4"].map((quarter) => entry({
    id: quarter, kind: "quarter", label: quarter,
    start: quarter === "Q1" ? monday(2026, 1) : quarter === "Q2" ? monday(2026, 14) : quarter === "Q3" ? monday(2026, 27) : monday(2026, 40),
    end: quarter === "Q1" ? shift(monday(2026, 13), 6) : quarter === "Q2" ? shift(monday(2026, 26), 6) : quarter === "Q3" ? shift(monday(2026, 39), 6) : shift(monday(2026, lastWeek), 6),
    group: null, out_cents: quarter === "Q4" ? 24977 : 0, in_cents: 0, state: "tracked",
  }));
  const quarterStart = monday(2026, 40);
  const quarterEnd = shift(monday(2026, 53), 6);
  const yearStart = monday(2026, 1);
  const yearEnd = shift(monday(2026, lastWeek), 6);
  const fixtures = {
    week: {
      report: baseReport({ charts: { version: 1, granularity: "day", buckets: weekBuckets, groups: [], categories: weekCategories } }),
      ctx: { kind: "week", periodId: "2026-W46", today: "2026-11-14", stale: false, refreshFailed: false, badgeEnabled: true, view: "both", collapsed: false },
    },
    "rich-week": {
      report: baseReport({
        totals: totals({ in_cents: 250000, out_cents: 26177, net_cents: 250000 - 26177 }),
        charts: { version: 1, granularity: "day", buckets: richBuckets, groups: [], categories: weekCategories },
      }),
      ctx: { kind: "week", periodId: "2026-W46", today: "2026-11-14", stale: false, refreshFailed: false, badgeEnabled: true, view: "both", collapsed: false },
    },
    quarter: {
      report: {
        ...baseReport({
          period: { kind: "quarter", key: "2026-Q4", start: quarterStart, end: quarterEnd, label: "2026-Q4", so_far: true, note: null },
          charts: {
            version: 1, granularity: "week", buckets: q4Buckets, groups: [],
            categories: { limit: 5, series: [{ key: "groceries", emoji: "🛒", label: "Groceries", kind: "category", out_cents: 24977, share: 1, rows: 7 }], rest: null },
          },
        }),
      },
      ctx: { kind: "quarter", periodId: "2026-Q4", today: "2026-11-14", stale: false, refreshFailed: false, badgeEnabled: true, view: "both", collapsed: false },
    },
    year: {
      report: {
        ...baseReport({
          period: { kind: "iso_year", key: "2026", start: yearStart, end: yearEnd, label: "2026", so_far: true, note: null },
          totals: totals({ in_cents: 250000, out_cents: 524977, net_cents: -274977 }),
          charts: {
            version: 1, granularity: "week", buckets: yearBuckets, groups: yearGroups,
            categories: { limit: 5, series: [{ key: "groceries", emoji: "🛒", label: "Groceries", kind: "category", out_cents: 524977, share: 1, rows: 9 }], rest: null },
          },
        }),
      },
      ctx: { kind: "year", periodId: "2026", today: "2026-11-14", stale: false, refreshFailed: false, badgeEnabled: true, view: "both", collapsed: false },
    },
    "all-single": {
      report: {
        ...baseReport({
          period: { kind: "all_time", key: "all", start: "2026-01-01", end: "2026-12-31", label: "All time", so_far: true, note: null },
          charts: {
            version: 1, granularity: "quarter",
            buckets: [entry({ id: "2026-Q4", kind: "quarter", label: "Q4", start: quarterStart, end: quarterEnd, group: "2026", out_cents: 24977, state: "tracked" })],
            groups: [],
            categories: { limit: 5, series: [{ key: "groceries", emoji: "🛒", label: "Groceries", kind: "category", out_cents: 24977, share: 1, rows: 7 }], rest: null },
          },
        }),
      },
      ctx: { kind: "all", periodId: "all", today: "2026-11-14", stale: false, refreshFailed: false, badgeEnabled: true, view: "both", collapsed: false },
    },
    "all-collapse": {
      report: {
        ...baseReport({
          period: { kind: "all_time", key: "all", start: "2019-01-01", end: "2026-12-31", label: "All time", so_far: true, note: null },
          charts: {
            version: 1, granularity: "quarter",
            buckets: ["2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4", "2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4"].map((id) => entry({
              id, kind: "quarter", label: id, start: id.startsWith("2025") ? `2025-01-01` : quarterStart, end: id.startsWith("2025") ? `2025-12-31` : quarterEnd,
              group: id.slice(0, 4), out_cents: id === "2026-Q4" ? 24977 : 0,
              state: id.startsWith("2025") ? "untracked" : "tracked",
            })),
            groups: ["2025", "2026"].map((year) => entry({ id: year, kind: "year", label: year, start: `${year}-01-01`, end: `${year}-12-31`, group: null, out_cents: year === "2026" ? 24977 : 0, state: year === "2025" ? "untracked" : "tracked" })),
            categories: { limit: 5, series: [{ key: "groceries", emoji: "🛒", label: "Groceries", kind: "category", out_cents: 24977, share: 1, rows: 7 }], rest: null },
          },
        }),
      },
      ctx: { kind: "all", periodId: "all", today: "2026-11-14", stale: false, refreshFailed: false, badgeEnabled: true, view: "both", collapsed: false },
    },
    stale: {
      report: baseReport({ charts: { version: 1, granularity: "day", buckets: weekBuckets, groups: [], categories: weekCategories } }),
      ctx: { kind: "week", periodId: "2026-W46", today: "2026-11-14", stale: true, refreshFailed: true, badgeEnabled: true, view: "both", collapsed: false },
    },
  };
  fixtures.unavailable = null;
  return fixtures;
}

function makeHtml({ pluginSource, css, fixtures }) {
  return fs.readFileSync(path.join(__dirname, "preview-bank-period.template.html"), "utf8")
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
  const fixtures = buildFixtures();
  const htmlFile = path.join(args.out, "index.html");
  fs.writeFileSync(htmlFile, makeHtml({ pluginSource, css, fixtures }));
  console.log(`Wrote ${htmlFile}`);
  const chromium = findChromium();
  if (!chromium) {
    console.log("No headless Chromium found (CHROMIUM_PATH unset and no cached Chromium); wrote HTML only.");
    return;
  }
  const profile = fs.mkdtempSync(path.join("/tmp", "bob-bank-period-chromium-"));
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
    for (const width of [360, 720]) {
      for (const theme of ["light", "dark"]) {
        await client.call("Emulation.setDeviceMetricsOverride", { width, height: 1500, deviceScaleFactor: 1, mobile: false });
        for (const view of ["both", "cashflow", "categories"]) {
          await sleep(100);
          const result = await client.evaluate(`window.bankPeriodPreview.renderMatrix(${width}, ${JSON.stringify(theme)}, ${JSON.stringify(view)})`);
          for (const item of result.measurements) {
            rows.push({ width, theme, view, ...item });
            if (width >= 544 && item.hasModel && view === "both" && item.bodyHeight > 155) {
              failures.push(`${item.state} ${view} ${width}px ${theme}: body ${item.bodyHeight}px over the 150px budget`);
            }
            if (!item.noOverflow) failures.push(`${item.state} ${view} ${width}px ${theme}: horizontal overflow`);
            if (item.overlap) failures.push(`${item.state} ${view} ${width}px ${theme}: caption/waiting-dot overlap`);
          }
        }
      }
    }
    for (const [width, theme, view] of [[720, "light", "both"], [360, "dark", "both"]]) {
      await client.call("Emulation.setDeviceMetricsOverride", { width, height: 1500, deviceScaleFactor: 1, mobile: false });
      await client.evaluate(`window.bankPeriodPreview.renderMatrix(${width}, ${JSON.stringify(theme)}, ${JSON.stringify(view)}, ["rich-week", "year"])`);
      await sleep(150);
      const screenshot = await client.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      const name = `bank-period-${width}-${theme}-${view}.png`;
      fs.writeFileSync(path.join(args.out, name), Buffer.from(screenshot.data, "base64"));
    }
    const report = [
      "# Bank Period Charts preview",
      "",
      ...rows.map((item) => `- ${item.width}px ${item.theme} ${item.view} ${item.state}: body ${item.bodyHeight}px; overflow ${item.noOverflow ? "none" : "yes"}`),
      "",
      failures.length ? `FAIL: ${failures.join("; ")}` : "The bank period preview matrix rendered without layout errors.",
    ].join("\n");
    fs.writeFileSync(path.join(args.out, "report.md"), report + "\n");
    console.log(report);
    if (failures.length) process.exitCode = 1;
  } finally {
    try {
      if (client) client.socket.close();
    } catch (error) {}
    try {
      child.kill();
    } catch (error) {}
  }
}

main().catch((error) => {
  console.error(String(error && error.stack || error));
  process.exit(1);
});
