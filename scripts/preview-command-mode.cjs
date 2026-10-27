#!/usr/bin/env node
// Capture command-mode feedback using production fragments and styles in Chromium.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const repoRoot = path.resolve(__dirname, "..");
const pluginRoot = path.join(repoRoot, "plugins/bob-command-mode");
const BASELINE = [
  ":root { --input-height: 30px; --font-interface: Inter, sans-serif; --font-monospace: ui-monospace, monospace; }",
  "button { display:inline-flex; align-items:center; justify-content:center; height:var(--input-height); padding:4px 12px; border:1px solid var(--background-modifier-border); border-radius:5px; background:var(--interactive-normal); color:var(--text-normal); font:500 13px var(--font-interface); white-space:nowrap; }",
  "a { color:var(--text-accent); text-decoration:underline; }",
].join("\n");

function parseArgs(argv) {
  const result = { out: path.join(os.tmpdir(), "bob-command-mode-preview") };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--out" && argv[index + 1]) result.out = path.resolve(argv[++index]);
    else if (argv[index] === "--help" || argv[index] === "-h") {
      console.log("Usage: node scripts/preview-command-mode.cjs [--out DIRECTORY]");
      process.exit(0);
    } else throw new Error("Unknown argument: " + argv[index]);
  }
  return result;
}

function findChromium() {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH;
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    const found = spawnSync("which", [name], { encoding: "utf8" });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  throw new Error("Could not find Chromium. Set CHROMIUM_PATH to a browser executable.");
}

function safeJson(value) { return JSON.stringify(value).replace(/</g, "\\u003c"); }

function makeHtml(css, utility, toasts, chip, ansi, pager) {
  const template = fs.readFileSync(path.join(__dirname, "preview-command-mode.template.html"), "utf8");
  return template
    .replace("__OBSIDIAN_BASELINE_CSS__", () => BASELINE)
    .replace("__PRODUCTION_CSS__", () => css)
    .replace("__UTILITY_SOURCE__", () => utility)
    .replace("__TOAST_SOURCE__", () => toasts)
    .replace("__CHIP_SOURCE__", () => chip)
    .replace("__ANSI_SOURCE__", () => ansi)
    .replace("__PAGER_SOURCE__", () => pager);
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
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("Chromium exited before publishing its DevTools port (exit " + child.exitCode + ", signal " + child.signalCode + ").");
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
  const screenshot = await client.call("Page.captureScreenshot", {
    format: "png", fromSurface: true, captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height, scale: 1 },
  });
  fs.writeFileSync(output, Buffer.from(screenshot.data, "base64"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.out, { recursive: true });
  const htmlFile = path.join(args.out, "index.html");
  const html = makeHtml(
    fs.readFileSync(path.join(pluginRoot, "styles.css"), "utf8"),
    fs.readFileSync(path.join(pluginRoot, "src/020-util.js"), "utf8"),
    fs.readFileSync(path.join(pluginRoot, "src/110-toasts.js"), "utf8"),
    fs.readFileSync(path.join(pluginRoot, "src/120-status-chip.js"), "utf8"),
    fs.readFileSync(path.join(pluginRoot, "src/140-ansi-and-links.js"), "utf8"),
    fs.readFileSync(path.join(pluginRoot, "src/150-pager.js"), "utf8"),
  );
  fs.writeFileSync(htmlFile, html);
  const chromium = findChromium();
  // Keep Chromium's UNIX-domain singleton socket under the short /tmp prefix.
  const profile = fs.mkdtempSync(path.join("/tmp", "bob-cmd-preview-"));
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
      if (await client.evaluate("Boolean(window.commandModePreviewReady)")) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const screenshots = [];
    for (const theme of ["light", "dark"]) {
      await client.evaluate("window.commandModePreview.render(" + safeJson(theme) + ")");
      const output = path.join(args.out, "command-mode-" + theme + ".png");
      await capture(client, output);
      screenshots.push(output);
    }
    fs.writeFileSync(path.join(args.out, "matrix-report.md"), [
      "# Bob Command Mode feedback preview",
      "",
      "Rendered from production toast, chip, ANSI, and pager fragments plus `styles.css` under an Obsidian baseline stylesheet.",
      "",
      "Cases: completed, attention with Scan intake, failed stderr summary, unknown, stopped; one run, two runs, queued, overdue, settled completed, and settled failed; pager running, completed with ANSI and links, failed stderr, and JSON.",
      "",
      ...screenshots.map((file) => "- " + path.basename(file)),
      "",
    ].join("\n"));
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

main().catch((error) => { console.error(error && error.stack || error); process.exitCode = 1; });
