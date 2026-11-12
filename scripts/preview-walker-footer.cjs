#!/usr/bin/env node
// Render the production walker footer (all three panels), the Keep chip, and
// the production bracket-mode selector in Chromium. The page paints every
// panel state from the walker_footers plan state tables plus an integrated
// bar that repaints s → w → n in one host to prove the selector rect never
// moves (invariant 7) and the panel swaps synchronously.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const repoRoot = path.resolve(__dirname, "..");
const ledgerRoot = path.join(repoRoot, "plugins/bob-ledger-tools");
const navRoot = path.join(repoRoot, "plugins/bob-navigation-hotkeys");

function parseArgs(argv) {
  const args = { out: path.join("/tmp", "bob-walker-footer-preview") };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--out" && argv[index + 1]) args.out = path.resolve(argv[++index]);
    else if (argv[index] === "--help" || argv[index] === "-h") {
      console.log("Usage: node scripts/preview-walker-footer.cjs [--out DIRECTORY]");
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

function makeHtml({ ledgerSource, navSource, css, navCss }) {
  return fs.readFileSync(path.join(__dirname, "preview-walker-footer.template.html"), "utf8")
    .replace("__PRODUCTION_CSS__", () => css)
    .replace("__NAV_CSS__", () => navCss)
    .replace("__LEDGER_SOURCE__", () => safeJson(ledgerSource))
    .replace("__NAV_SOURCE__", () => safeJson(navSource));
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
  throw new Error(`Walker footer preview did not become ready: ${JSON.stringify(lastState)}`);
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

function contrastFailures(fixture) {
  const failures = [];
  const check = (label, value) => {
    if (value !== null && value !== undefined && value < 4.5) {
      failures.push(`${fixture.id} ${label} contrast is ${value}:1`);
    }
  };
  check("due", fixture.dueContrast);
  check("context", fixture.contextContrast);
  check("detail", fixture.detailContrast);
  check("hint", fixture.hintContrast);
  check("meter", fixture.meterContrast);
  for (const group of fixture.groups) check(`${group.key} group`, group.contrast);
  if (fixture.linkPrev) check("prev arm", fixture.linkPrev.contrast);
  if (fixture.linkNext) check("next arm", fixture.linkNext.contrast);
  return failures;
}

function validateMatrix(entry) {
  const failures = [];
  const tiers = ["pre", "new", "projects", "pending", "next", "recurring", "tickler", "rotten", "post"];
  const colors = tiers.map((tier) => entry.allTierColors[tier]);
  if (colors.some((color) => !color)) failures.push("the all-tier fixture is missing an ink");
  if (new Set(colors).size !== tiers.length) failures.push("the nine group inks are not pairwise distinct");
  const byId = Object.fromEntries(entry.fixtures.map((item) => [item.id, item]));
  for (const fixture of entry.fixtures) {
    const wantPanel = fixture.id.startsWith("s-") ? "s" : fixture.id.startsWith("w-") ? "w" : "n";
    if (fixture.panel !== wantPanel) failures.push(`${fixture.id} paints panel ${fixture.panel}, not ${wantPanel}`);
    if (fixture.overflow > 1) failures.push(`${fixture.id} overflows its host by ${fixture.overflow}px`);
    failures.push(...contrastFailures(fixture).map((failure) => `${entry.theme} ${entry.width}px: ${failure}`));
  }
  // State-table spot checks: the panel must say what its state row says.
  const linksMatch = (id) => byId[id] && byId[id].linksMatch !== false;
  for (const id of ["n-both", "n-arrows", "n-unicode", "n-dupe"]) {
    if (!linksMatch(id)) failures.push(`${id} painted arms differ from the view arms`);
  }
  if (!byId["n-create"] || !byId["n-create"].linkNext || byId["n-create"].linkNext.dashed !== true) {
    failures.push("n-create next arm is not a dashed creation target");
  }
  if (byId["n-prev-only"] && byId["n-prev-only"].linkNext !== null) {
    failures.push("n-prev-only shows a next arm");
  }
  if (byId["n-none"] && byId["n-none"].linkStatus !== "no ‹ / › links in this note") {
    failures.push(`n-none status is ${JSON.stringify(byId["n-none"] && byId["n-none"].linkStatus)}`);
  }
  if (!byId["w-landed"] || byId["w-landed"].dueText !== "Lanes 3/5") {
    failures.push(`w-landed due is ${JSON.stringify(byId["w-landed"] && byId["w-landed"].dueText)}, not Lanes 3/5`);
  }
  if (!byId["w-landed"] || byId["w-landed"].contextText !== "NEXT 2/7") {
    failures.push(`w-landed context is ${JSON.stringify(byId["w-landed"] && byId["w-landed"].contextText)}, not NEXT 2/7`);
  }
  if (!byId["w-landed"] || byId["w-landed"].hintText !== "Alt+N release") {
    failures.push(`w-landed hint is ${JSON.stringify(byId["w-landed"] && byId["w-landed"].hintText)}, not Alt+N release`);
  }
  if (!byId["s-clear"] || byId["s-clear"].dueText !== "Review clear") {
    failures.push(`s-clear due is ${JSON.stringify(byId["s-clear"] && byId["s-clear"].dueText)}, not Review clear`);
  }
  // Fixed item height: every fixture host must agree within 2px.
  const heights = entry.fixtures.map((item) => item.hostHeight).filter(Number.isFinite);
  if (heights.length && Math.max(...heights) - Math.min(...heights) > 2) {
    failures.push(`fixture host heights vary ${Math.min(...heights)}–${Math.max(...heights)}px`);
  }
  // Invariant 7: the integrated selector rect is identical across s → w → n,
  // immediately and after two frames, while footer widths change.
  const modes = entry.integrated;
  const expectedPanel = { s: "s", w: "w", n: "n" };
  for (const mode of modes) {
    if (mode.panel !== expectedPanel[mode.mode] || mode.settledPanel !== expectedPanel[mode.mode]) {
      failures.push(`integrated ${mode.mode} paints panel ${mode.panel}/${mode.settledPanel}`);
    }
  }
  const rects = modes.map((mode) => mode.selectorRect);
  const settled = modes.map((mode) => mode.settledSelectorRect);
  const same = (a, b) => ["x", "y", "width", "height"].every((key) => Math.abs(a[key] - b[key]) <= 0.5);
  for (let index = 1; index < rects.length; index += 1) {
    if (!same(rects[0], rects[index])) {
      failures.push(`selector rect moved across modes: ${JSON.stringify(rects[0])} vs ${JSON.stringify(rects[index])}`);
    }
    if (!same(rects[index], settled[index])) {
      failures.push(`selector rect drifted after frames in mode ${modes[index].mode}`);
    }
  }
  // The flexed host never changes size (margin-right:auto absorbs panel
  // width changes and pins the selector right); the panel *content* button
  // must differ per panel or the rect check proves nothing.
  const widths = modes.map((mode) => mode.contentWidth);
  if (new Set(widths.map((value) => Math.round(value))).size < 2) {
    failures.push("integrated panel content width never changes across modes; the rect check proves nothing");
  }
  return failures;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.out, { recursive: true });
  const ledgerSource = fs.readFileSync(path.join(ledgerRoot, "main.js"), "utf8");
  const navSource = fs.readFileSync(path.join(navRoot, "main.js"), "utf8");
  const css = fs.readFileSync(path.join(ledgerRoot, "styles.css"), "utf8");
  const navCss = fs.readFileSync(path.join(navRoot, "styles.css"), "utf8");
  const htmlFile = path.join(args.out, "index.html");
  fs.writeFileSync(htmlFile, makeHtml({ ledgerSource, navSource, css, navCss }));
  const chromium = findChromium();
  const profile = fs.mkdtempSync(path.join("/tmp", "bob-walker-footer-chromium-"));
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
          `window.walkerFooterPreview.render(${width}, ${JSON.stringify(theme)})`,
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
      "# Walker footer Chromium preview",
      "",
      `- Browser: ${summary.browser}.`,
      `- Renderer checkout revision: ${summary.rendererRevision}.`,
      "- Fixtures: every walker panel state (s review + clear, w lane states + stress, n compass states + Unicode/dupe), plus an integrated bar (footer + Keep chip + production selector).",
      "- Matrix: 1100, 700, and 460 px in light and dark default-theme colors.",
      "- Checks: AA contrast for every panel ink; no host overflow; panel attribute per fixture id; links arms match the view; dashed create target; selector rect identical across s/w/n immediately and after frames while footer widths change; fixed host height.",
      "",
      "| Width | Theme | Fixtures | Worst contrast | Overflow | Selector stable | Result | Screenshot |",
      "| ---: | --- | --- | ---: | ---: | --- | --- | --- |",
      ...matrix.map((entry) => {
        const worst = Math.min(...entry.fixtures.flatMap((item) => [
          item.dueContrast, item.contextContrast, item.detailContrast,
          item.hintContrast, item.meterContrast,
          ...item.groups.map((group) => group.contrast),
          item.linkPrev ? item.linkPrev.contrast : null,
          item.linkNext ? item.linkNext.contrast : null,
        ].filter((value) => value !== null && value !== undefined)));
        const overflow = Math.max(...entry.fixtures.map((item) => item.overflow));
        const rects = entry.integrated.map((mode) => mode.selectorRect);
        const stable = rects.every((rect) => ["x", "y", "width", "height"].every((key) => Math.abs(rect[key] - rects[0][key]) <= 0.5));
        return `| ${entry.width}px | ${entry.theme} | ${entry.fixtures.length} | ${worst}:1 | ${overflow}px | ${stable ? "yes" : "NO"} | ${entry.failures.length ? "FAIL" : "pass"} | ${entry.screenshot} |`;
      }),
      "",
      failures.length ? "Failures:" : "All preview checks passed.",
      ...failures.map((failure) => `- ${failure}`),
      "",
    ];
    fs.writeFileSync(path.join(args.out, "summary.md"), `${lines.join("\n")}\n`);
    console.log(`Walker footer preview written to ${args.out}`);
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
