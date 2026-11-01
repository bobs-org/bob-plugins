#!/usr/bin/env node
// Render the production task-link-mark stylesheet in Chromium, in light
// and dark, beside real link text. Dev-only; the contract lives in
// bob-cli `docs/task-link-marks.md`.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const repoRoot = path.resolve(__dirname, "..");
const pluginRoot = path.join(repoRoot, "plugins/bob-ledger-tools");

function parseArgs(argv) {
  const args = { out: path.join("/tmp", "bob-task-link-marks-preview") };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--out" && argv[index + 1]) args.out = path.resolve(argv[++index]);
    else if (argv[index] === "--help" || argv === "-h") {
      console.log("Usage: node scripts/preview-task-link-marks.cjs [--out DIRECTORY]");
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
      for (const platformDir of ["chrome-linux64", "chrome-linux", "chrome-headless-shell-linux64"]) {
        for (const name of ["chrome", "chrome-headless-shell", "Chromium"]) {
          const executable = path.join(cache, browserDir, platformDir, name);
          if (fs.existsSync(executable)) candidates.push(executable);
        }
      }
    }
    if (candidates.length) return candidates.sort().at(-1);
  }
  throw new Error("Could not find headless Chromium. Set CHROMIUM_PATH to an installed browser executable.");
}

function makeHtml({ css }) {
  return fs.readFileSync(path.join(__dirname, "preview-task-link-marks.template.html"), "utf8")
    .replace("__PRODUCTION_CSS__", () => css);
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
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message || JSON.stringify(message.error)}`));
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
    const response = await this.call("Runtime.evaluate", {
      expression, awaitPromise: true, returnByValue: true, userGesture: true,
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception && response.exceptionDetails.exception.description || response.exceptionDetails.text);
    }
    return response.result && response.result.value;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  let lastState = null;
  while (Date.now() - start < 15000) {
    lastState = await client.evaluate("({ ready: Boolean(window.__previewReady), error: window.__previewError || '' })");
    if (lastState.error) throw new Error(`Preview page error: ${lastState.error}`);
    if (lastState.ready) return;
    await sleep(50);
  }
  throw new Error(`Task link marks preview did not become ready: ${JSON.stringify(lastState)}`);
}

async function capturePage(client, output) {
  await client.evaluate("document.fonts && document.fonts.ready");
  await client.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  const metrics = await client.call("Page.getLayoutMetrics");
  const width = Math.ceil(metrics.cssContentSize.width);
  const height = Math.ceil(metrics.cssContentSize.height);
  const response = await client.call("Page.captureScreenshot", {
    format: "png", fromSurface: true, captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height, scale: 1 },
  });
  fs.writeFileSync(output, Buffer.from(response.data, "base64"));
}

// Launch headless Chromium on the preview page. `extraArgs` carry flags such
// as `--force-prefers-reduced-motion`. Chromium's DevTools socket lives under
// its profile and TMPDIR, so both stay short (`/tmp`) to dodge the Unix
// socket path limit on long workspace paths. Returns `{client, version,
// close}`.
async function openPreviewPage(htmlFile, extraArgs = []) {
  const chromium = findChromium();
  const profile = fs.mkdtempSync(path.join("/tmp", "bob-task-link-marks-chromium-"));
  const child = spawn(chromium, [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, ...extraArgs, "about:blank",
  ], { stdio: "ignore", env: { ...process.env, TMPDIR: "/tmp" } });
  let client = null;
  const close = async () => {
    if (client) {
      try { client.socket.close(); } catch (error) { /* best-effort */ }
    }
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise((resolve) => {
        child.once("exit", resolve);
        child.kill("SIGTERM");
      });
    }
    await sleep(250);
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch (error) {
      await sleep(500);
      try {
        fs.rmSync(profile, { recursive: true, force: true });
      } catch (ignored) { /* best-effort profile cleanup */ }
    }
  };
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
    const browser = await client.call("Browser.getVersion");
    return { client, version: browser.product || "Chromium", close };
  } catch (error) {
    await close();
    throw error;
  }
}

// Judge one motion probe (`window.taskLinkMarksPreview.motion()`). Under
// reduced motion every swapped and plain ring must compute no animation and
// no transition; under normal motion the swap animation and the 120 ms
// transition must still be there. Returns a list of failure strings.
function checkMotionRings(probe, reduced) {
  const failures = [];
  const label = reduced ? "reduced motion" : "normal motion";
  if (!probe || probe.reduced !== reduced) {
    failures.push(`${label}: matchMedia(prefers-reduced-motion) is ${probe && probe.reduced}, expected ${reduced}`);
  }
  const rings = (probe && probe.rings) || [];
  if (rings.length === 0) failures.push(`${label}: the probe measured no rings`);
  for (const ring of rings) {
    const who = `${ring.state}${ring.swap ? " swap" : ""} ring`;
    const transitions = String(ring.transitionDuration).split(",").map((part) => part.trim());
    if (reduced) {
      if (ring.animationName !== "none") failures.push(`${label}: ${who} computes animation-name ${ring.animationName}`);
      if (!transitions.every((part) => part === "0s")) failures.push(`${label}: ${who} computes transition-duration ${ring.transitionDuration}`);
    } else {
      if (ring.swap && ring.animationName !== "bob-task-link-mark-swap") failures.push(`${label}: ${who} computes animation-name ${ring.animationName}`);
      if (ring.swap && ring.animationDuration !== "0.18s") failures.push(`${label}: ${who} computes animation-duration ${ring.animationDuration}`);
      if (!ring.swap && ring.animationName !== "none") failures.push(`${label}: ${who} computes animation-name ${ring.animationName}`);
      if (!transitions.some((part) => part === "0.12s")) failures.push(`${label}: ${who} computes transition-duration ${ring.transitionDuration}`);
    }
  }
  return failures;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.out, { recursive: true });
  const css = fs.readFileSync(path.join(pluginRoot, "styles.css"), "utf8");
  const htmlFile = path.join(args.out, "index.html");
  fs.writeFileSync(htmlFile, makeHtml({ css }));
  const matrix = [];
  const failures = [];
  const motion = {};
  let browserName = "Chromium";
  const page = await openPreviewPage(htmlFile);
  try {
    const { client } = page;
    browserName = page.version;
    for (const theme of ["light", "dark"]) {
      await client.call("Emulation.setDeviceMetricsOverride", {
        width: 932, height: 1600, deviceScaleFactor: 1, mobile: false,
      });
      const entry = await client.evaluate(`window.taskLinkMarksPreview.render(900, ${JSON.stringify(theme)})`);
      const screenshot = path.join(args.out, `${theme}-900.png`);
      await capturePage(client, screenshot);
      entry.screenshot = path.basename(screenshot);
      const checks = [];
      for (const box of entry.boxes || []) {
        if (!(box.width > 0 && box.height > 0)) checks.push(`${box.state} box is empty`);
        if (Math.abs(box.width - box.height) > 2) checks.push(`${box.state} box is not square (${box.width}x${box.height})`);
      }
      for (const drift of entry.drift || []) {
        if (drift > 0.6) checks.push(`line height drifts by ${drift}px with rings on`);
      }
      entry.failures = checks;
      failures.push(...checks.map((check) => `${theme}: ${check}`));
      matrix.push(entry);
    }
    motion.normal = await client.evaluate("window.taskLinkMarksPreview.motion()");
    failures.push(...checkMotionRings(motion.normal, false));
  } finally {
    await page.close();
  }
  // A second browser forced into reduced motion proves the production CSS
  // computes no animation or transition for a swapped ring.
  const reducedPage = await openPreviewPage(htmlFile, ["--force-prefers-reduced-motion"]);
  try {
    motion.reduced = await reducedPage.client.evaluate("window.taskLinkMarksPreview.motion()");
    failures.push(...checkMotionRings(motion.reduced, true));
  } finally {
    await reducedPage.close();
  }
  const summary = {
    browser: browserName,
    rendererRevision: spawnSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim(),
    matrix,
    motion,
    failures,
  };
  fs.writeFileSync(path.join(args.out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  const lines = [
    "# Task link marks Chromium preview",
    "",
    `- Browser: ${summary.browser}.`,
    `- Renderer checkout revision: ${summary.rendererRevision}.`,
    "- Fixtures: paragraph, heading, task line, blockquote, struck link, dense sentence.",
    "- Matrix: 900 px in light and dark default-theme colors.",
    "- Checks: every ring box is square and non-empty; line heights match with rings on/off.",
    "- Motion: computed animation and transition of swapped and plain rings, in normal motion and with `--force-prefers-reduced-motion`.",
    "",
    "| Theme | Boxes | Max drift | Result | Screenshot |",
    "| --- | --- | ---: | --- | --- |",
    ...matrix.map((entry) => `| ${entry.theme} | ${entry.boxes.length} | ${Math.max(0, ...entry.drift)}px | ${entry.failures.length ? "FAIL" : "pass"} | ${entry.screenshot} |`),
    "",
    "| Motion | matchMedia reduce | Swap animation-name | Swap transition-duration |",
    "| --- | --- | --- | --- |",
    ...["normal", "reduced"].map((key) => {
      const swap = (motion[key].rings || []).find((ring) => ring.swap) || {};
      return `| ${key} | ${motion[key].reduced} | ${swap.animationName} | ${swap.transitionDuration} |`;
    }),
    "",
    failures.length ? "Failures:" : "All preview checks passed.",
    ...failures.map((failure) => `- ${failure}`),
    "",
  ];
  fs.writeFileSync(path.join(args.out, "summary.md"), `${lines.join("\n")}\n`);
  console.log(`Task link marks preview written to ${args.out}`);
  console.log(`${matrix.length} theme renders, 2 motion renders; ${failures.length} failed checks.`);
  if (failures.length) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}

module.exports = { findChromium, checkMotionRings };
