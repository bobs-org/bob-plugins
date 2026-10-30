#!/usr/bin/env node
// Render the production review footer model, painter, and stylesheet in Chromium.
// The page uses synthetic queue fixtures and Obsidian's default theme colors.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const repoRoot = path.resolve(__dirname, "..");
const pluginRoot = path.join(repoRoot, "plugins/bob-ledger-tools");
const tiers = ["pre", "new", "projects", "pending", "next", "recurring", "tickler", "rotten", "post"];

function parseArgs(argv) {
  const args = { out: path.join("/tmp", "bob-review-footer-preview") };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--out" && argv[index + 1]) args.out = path.resolve(argv[++index]);
    else if (argv[index] === "--help" || argv[index] === "-h") {
      console.log("Usage: node scripts/preview-review-footer.cjs [--out DIRECTORY]");
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
      for (const platformDir of ["chrome-linux64", "chrome-linux", "chrome-headless-shell-linux64", "chrome-mac/Chromium.app/Contents/MacOS"]) {
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

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function makeHtml({ pluginSource, css }) {
  return fs.readFileSync(path.join(__dirname, "preview-review-footer.template.html"), "utf8")
    .replace("__PRODUCTION_CSS__", () => css)
    .replace("__PLUGIN_SOURCE__", () => safeJson(pluginSource));
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
  throw new Error(`Review footer preview did not become ready: ${JSON.stringify(lastState)}`);
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

function validateMatrix(entry) {
  const failures = [];
  const colors = tiers.map((tier) => entry.allTierColors[tier]);
  if (colors.some((color) => !color)) failures.push("the all-tier fixture is missing an ink");
  if (new Set(colors).size !== tiers.length) failures.push("the nine group inks are not pairwise distinct");
  if (entry.theme === "light" && entry.allTierColors.post !== "rgb(34, 34, 34)") {
    failures.push(`POST is ${entry.allTierColors.post}, not the light normal text ink`);
  }
  if (entry.theme === "dark" && entry.allTierColors.post !== "rgb(218, 218, 218)") {
    failures.push(`POST is ${entry.allTierColors.post}, not the dark normal text ink`);
  }
  for (const fixture of entry.fixtures) {
    if (fixture.overflow > 1) failures.push(`${fixture.id} overflows its host by ${fixture.overflow}px`);
    if (!fixture.prefixOk) failures.push(`${fixture.id} visible groups are not a walk-order prefix`);
    if (!fixture.markerOk) failures.push(`${fixture.id} has an incorrect ellipsis state`);
    if (!fixture.contextMatchesTier) failures.push(`${fixture.id} context ink differs from its tier ink`);
    if (fixture.contextContrast === null || fixture.contextContrast < 4.5) {
      failures.push(`${fixture.id} context contrast is ${fixture.contextContrast}:1`);
    }
    for (const group of fixture.groups) {
      if (group.contrast === null || group.contrast < 4.5) {
        failures.push(`${fixture.id} ${group.key} contrast is ${group.contrast}:1`);
      }
    }
  }
  return failures;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.out, { recursive: true });
  const pluginSource = fs.readFileSync(path.join(pluginRoot, "main.js"), "utf8");
  const css = fs.readFileSync(path.join(pluginRoot, "styles.css"), "utf8");
  const htmlFile = path.join(args.out, "index.html");
  fs.writeFileSync(htmlFile, makeHtml({ pluginSource, css }));
  const chromium = findChromium();
  const profile = fs.mkdtempSync(path.join("/tmp", "bob-review-footer-chromium-"));
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
    const browser = await client.call("Browser.getVersion");
    const matrix = [];
    const failures = [];
    for (const width of [1100, 700, 460]) {
      for (const theme of ["light", "dark"]) {
        await client.call("Emulation.setDeviceMetricsOverride", {
          width: width + 32, height: 1600, deviceScaleFactor: 1, mobile: false,
        });
        const entry = await client.evaluate(
          `window.reviewFooterPreview.render(${width}, ${JSON.stringify(theme)})`,
        );
        const screenshot = path.join(args.out, `${theme}-${width}.png`);
        await capturePage(client, screenshot);
        entry.screenshot = path.basename(screenshot);
        entry.failures = validateMatrix(entry);
        failures.push(...entry.failures.map((failure) => `${theme} ${width}px: ${failure}`));
        matrix.push(entry);
      }
    }
    const summary = {
      browser: browser.product || "Chromium",
      rendererRevision: spawnSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim(),
      matrix,
      failures,
    };
    fs.writeFileSync(path.join(args.out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
    const lines = [
      "# Review footer Chromium preview",
      "",
      `- Browser: ${summary.browser}.`,
      `- Renderer checkout revision: ${summary.rendererRevision}.`,
      "- Fixtures: all nine groups, a typical morning, NEW, NEXT with quickRoll, and ROTTEN.",
      "- Matrix: 1100, 700, and 460 px in light and dark default-theme colors.",
      "- Checks: AA contrast for every group/context ink, nine distinct group inks, no host overflow, walk-order prefixes, and ellipsis only for a partial cut.",
      "",
      "| Width | Theme | Visible groups | Context contrast | Worst group contrast | Overflow | Result | Screenshot |",
      "| ---: | --- | --- | ---: | ---: | ---: | --- | --- |",
      ...matrix.map((entry) => {
        const fixture = entry.fixtures[0];
        const visible = entry.fixtures.map((item) => item.visibleKeys.length).join(" / ");
        const worst = Math.min(...entry.fixtures.flatMap((item) => item.groups.map((group) => group.contrast)));
        const overflow = Math.max(...entry.fixtures.map((item) => item.overflow));
        return `| ${entry.width}px | ${entry.theme} | ${visible} | ${fixture.contextContrast}:1 | ${worst}:1 | ${overflow}px | ${entry.failures.length ? "FAIL" : "pass"} | ${entry.screenshot} |`;
      }),
      "",
      failures.length ? "Failures:" : "All preview checks passed.",
      ...failures.map((failure) => `- ${failure}`),
      "",
    ];
    fs.writeFileSync(path.join(args.out, "summary.md"), `${lines.join("\n")}\n`);
    console.log(`Review footer preview written to ${args.out}`);
    console.log(`${matrix.length} theme/width renders; ${failures.length} failed checks.`);
    if (failures.length) process.exitCode = 1;
  } finally {
    if (client) {
      try { client.socket.close(); } catch (error) { /* best-effort */ }
    }
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise((resolve) => {
        child.once("exit", resolve);
        child.kill("SIGTERM");
      });
    }
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
