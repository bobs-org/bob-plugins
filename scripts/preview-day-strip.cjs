#!/usr/bin/env node
// Render the production Day strip model, painter, and stylesheet in Chromium,
// under mock plan badges and an Obsidian baseline stylesheet. The output is
// dev-only; no browser dependency is needed beyond Chromium.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const repoRoot = path.resolve(__dirname, "..");
const pluginRoot = path.join(repoRoot, "plugins/bob-ledger-tools");

// Obsidian's app.css rules that reach plugin DOM. This commented baseline
// is what once broke the strip: every tile was a <button>, so the 30 px
// input height clipped each label, value, and history mark. It loads
// before the production CSS so a <button> regression fails the matrix.
const OBSIDIAN_BASELINE_CSS = [
  "/* Obsidian app.css baseline (excerpt).",
  "   These rules reach plugin DOM in both Live Preview and Reading view:",
  "   buttons render as 30 px inline-flex inputs, links take the accent",
  "   colour, and rendered Markdown sets the surrounding line-height. */",
  ":root { --input-height: 30px; }",
  "button {",
  "  display: inline-flex;",
  "  align-items: center;",
  "  justify-content: center;",
  "  height: var(--input-height);",
  "  padding: 4px 12px;",
  "  border: 1px solid var(--background-modifier-border);",
  "  border-radius: 5px;",
  "  background: var(--interactive-normal);",
  "  box-shadow: var(--input-shadow);",
  "  color: var(--text-normal);",
  "  font-family: var(--font-interface);",
  "  font-size: 13px;",
  "  font-weight: 500;",
  "  white-space: nowrap;",
  "}",
  "a { color: var(--text-accent); text-decoration-line: underline; }",
  ".markdown-rendered { line-height: 1.5; }",
  ".markdown-source-view.mod-cm6 .cm-content { line-height: 1.5; }",
].join("\n");

function parseArgs(argv) {
  const args = { out: path.join("/tmp", "bob-day-strip-preview") };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--out" && argv[index + 1]) args.out = path.resolve(argv[++index]);
    else if (argv[index] === "--help" || argv === "-h") {
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
    .replace("__OBSIDIAN_BASELINE_CSS__", () => OBSIDIAN_BASELINE_CSS)
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

function checkMeasurement(item, context) {
  const failures = [];
  if (item.maxOverflow > 0.5) failures.push(`overflow ${item.maxOverflow}px escapes the strip box`);
  if (item.maxFactOverlap > 0.5) failures.push(`facts overlap by ${item.maxFactOverlap}px`);
  if (item.linesOverlap > 0.5) failures.push(`line 1 and line 2 overlap by ${item.linesOverlap}px`);
  if (item.legendOverlap > 0.5) failures.push(`legend items or meta overlap`);
  if (item.valueBaselineSpread > 1) failures.push(`value baselines spread ${item.valueBaselineSpread}px`);
  if (item.hasButton) failures.push(`strip contains a <button> element`);
  if (!item.relaxed) {
    if (item.factRows > 2 && item.state !== "unavailable") failures.push(`${item.factRows} fact rows (max 2)`);
    const budget = item.factRows <= 1 ? 56 : 80;
    if (item.stripHeight > budget + 0.5) failures.push(`height ${item.stripHeight}px over the ${budget}px budget`);
  }
  // (i) the strip precedes .bob-plan with a calm 6–16 px gap.
  if (item.domOrderOk === false && item.state !== "unavailable" && item.state !== "skeleton") {
    failures.push(`strip does not precede .bob-plan in the DOM`);
  }
  if (typeof item.stripToBadges === "number" && (item.stripToBadges < 6 || item.stripToBadges > 16)) {
    failures.push(`strip bottom sits ${item.stripToBadges}px above the badges (want 6–16px)`);
  }
  // (j) the bar spans the strip and ends it.
  if (typeof item.barWidthDelta === "number" && item.barWidthDelta > 1) {
    failures.push(`bar misses the strip width by ${item.barWidthDelta}px`);
  }
  if (item.barIsLast === false && item.state !== "unavailable" && !item.mixOmitted) {
    failures.push(`bar is not the strip's last line box`);
  }
  // (k) no legend label is truncated.
  if (item.legendTruncation > 0.5) failures.push(`legend label truncates by ${item.legendTruncation}px`);
  // (l) narrow cells show at most two legend labels with a true counter.
  if (context.width === 410 && typeof item.segments === "number" && item.segments > 0 && item.state !== "skeleton") {
    if (item.visibleLegend > 2) failures.push(`narrow strip shows ${item.visibleLegend} legend labels (max 2)`);
    if (item.segments > item.visibleLegend && item.visibleCounter !== item.segments - item.visibleLegend) {
      failures.push(`narrow counter is +${item.visibleCounter} for ${item.segments} segments and ${item.visibleLegend} labels`);
    }
  }
  // (m) distinct hues: ready cells with <=8 non-gray segments carry pairwise
  // distinct bar hues and matching legend dots.
  if (!item.mixOmitted && item.state !== "skeleton" && item.state !== "unavailable" && Array.isArray(item.barHues)) {
    const nonGray = item.barHues.filter((hue) => hue !== "gray");
    if (nonGray.length > 0 && nonGray.length <= 8) {
      const seen = new Set();
      for (const hue of nonGray) {
        if (seen.has(hue)) {
          failures.push(`bar hues repeat ${hue} (want distinct hues)`);
          break;
        }
        seen.add(hue);
      }
      const byTitle = new Map();
      (Array.isArray(item.barTitles) ? item.barTitles : []).forEach((title, index) => {
        if (title) byTitle.set(title, item.barHues[index]);
      });
      for (const dot of (Array.isArray(item.legendDots) ? item.legendDots : [])) {
        const expected = byTitle.get(dot.title);
        if (expected && dot.hue !== expected) {
          failures.push(`legend dot ${dot.title} is ${dot.hue} but its segment is ${expected}`);
        }
      }
    }
  }
  if (item.state === "today" && context.width >= 540 && item.factRows !== 1) {
    failures.push(`facts wrap to ${item.factRows} rows at ${context.width}px (must fit on one line)`);
  }
  if (item.state === "wide-values" && context.width >= 700 && item.factRows !== 1) {
    failures.push(`wide facts wrap to ${item.factRows} rows at ${context.width}px (must fit on one line)`);
  }
  return failures;
}

function matrixMarkdown(matrix, browser, revision, interactionChecks) {
  const measurements = matrix.flatMap((entry) => entry.measurements.map((item) => ({ ...item, width: entry.width, theme: entry.theme, screenshot: entry.screenshot })));
  return [
    "# Day strip Chromium preview matrix",
    "",
    `- Renderer checkout revision: ${revision}.`,
    `- Browser: ${browser}.`,
    "- Source: production `main.js`, `styles.css`, and synthetic presentation fixtures; no fixture is captured vault data.",
    "- Each strip renders above mock plan badges (TODAY / PENDING / NEXT / READY plus a ★ theme line) inside a Live Preview code-block container, with a bare `## Pomodoros` heading below; one extra Reading-view cell renders today.",
    "- An Obsidian baseline stylesheet (30 px inline-flex buttons, link colours, rendered line-height) loads before the production CSS, so a `<button>` regression fails the matrix.",
    "- Grid: light and dark themes × 410, 540, and 700 px note columns × 16 states plus Reading view.",
    "- Height budgets (16 px base): ≤56 px when the facts fit on one line, ≤80 px when they wrap once. The long-labels case is relaxed: geometry is enforced, height is reported.",
    "- Geometry checks: (a) every strip descendant's box lies inside the strip's box (±0.5 px); (b) no two facts overlap, line 1 and line 2 never overlap, and legend items and meta never overlap; (c) values share a baseline within each wrapped line (≤1 px); (d) skeleton height equals today's height at every width (≤0.5 px); (e) the height budget holds; (f) the today and wide-values facts fit on one line at 540 and 700; (g) the strip contains no `button` element; (h) forcing hover on a fact never shifts its box, and forcing `:focus-visible` shows an outline; (i) the strip precedes `.bob-plan` in the DOM with its bottom 6–16 px above the badges' top; (j) the bar spans the strip's content width (±1 px) and is its last line box; (k) no legend label is truncated; (l) narrow cells show at most 2 legend items and the visible counter equals segments minus visible items; (m) ready cells with ≤8 non-gray segments carry pairwise distinct bar hues and matching legend dots.",
    "",
    "| Width | Theme | State | Strip height | Budget | Fact rows | Overflow | Facts overlap | Lines overlap | Legend overlap | Value baseline spread | Skeleton delta | Button | Result | Screenshot |",
    "| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |",
    ...measurements.map((item) => `| ${item.width}px | ${item.theme} | ${item.state} | ${item.stripHeight}px | ${item.relaxed ? "—" : `${item.factRows <= 1 ? 56 : 80}px`} | ${item.factRows} | ${item.maxOverflow}px | ${item.maxFactOverlap}px | ${item.linesOverlap}px | ${item.legendOverlap}px | ${item.valueBaselineSpread}px | ${item.skeletonHeightDelta === null ? "—" : `${item.skeletonHeightDelta}px`} | ${item.hasButton ? "yes" : "no"} | ${item.result} | ${item.screenshot} |`),
    "",
    "Interaction checks (forced pseudo-states, per width × theme):",
    "",
    ...interactionChecks.map((item) => `- ${item.width}px ${item.theme}: ${item.label} — ${item.result}${item.detail ? ` (${item.detail})` : ""}`),
    "",
    "Synthetic cases: today in progress, complete past day, skeleton, stale cached frame, unavailable, no Pomodoros, not tracked with a journal warning, seven areas with `+N`, an old-bob report without `root_parent`, same-area roots get distinct hues, seven roots with `+N`, a redefined `worked` without area parts, long labels (with a long `job_2026_apply_29` root), wide values (`10h 05m`, three-digit counts, `not yet`), forced hover, forced `:focus-visible`, and a Reading-view today cell.",
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
    // DOM and CSS domains reset on navigation; enable them on the live page.
    await client.call("DOM.enable");
    await client.call("CSS.enable");
    const browserVersion = await client.call("Browser.getVersion");
    const revision = spawnSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim();
    const matrix = [];
    const interactionChecks = [];
    for (const width of [410, 540, 700]) {
      for (const theme of ["light", "dark"]) {
        await client.call("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
        const result = await client.evaluate(`window.dayStripPreview.renderMatrix(${width}, ${JSON.stringify(theme)})`);
        const readyHeight = result.measurements.find((item) => item.state === "today").stripHeight;
        const skeletonHeight = result.measurements.find((item) => item.state === "skeleton").stripHeight;
        const skeletonHeightDelta = Math.round(Math.abs(readyHeight - skeletonHeight) * 10) / 10;
        const measurements = result.measurements.map((item) => {
          const failures = checkMeasurement(item, { width, theme });
          if (item.state === "skeleton" && skeletonHeightDelta > 0.5) {
            failures.push(`skeleton height differs from today by ${skeletonHeightDelta}px`);
          }
          return {
            ...item,
            skeletonHeightDelta: item.state === "skeleton" ? skeletonHeightDelta : null,
            result: failures.length ? "FAIL" : "pass",
            failures,
          };
        });

        // (h) Forced hover must never shift the fact's box; forced
        // :focus-visible must show an outline on the focused fact.
        // Nodes resolve through the DOM domain so CSS sees the same ids.
        const domRoot = await client.call("DOM.getDocument", { depth: 0, pierce: true });
        const forcePseudo = async (selector, pseudos) => {
          const found = await client.call("DOM.querySelector", { nodeId: domRoot.root.nodeId, selector });
          if (!found || !found.nodeId) throw new Error("no node for " + selector);
          await client.call("CSS.forcePseudoState", { nodeId: found.nodeId, forcedPseudoClasses: pseudos });
        };
        const hoverSelector = '[data-strip="hover"] .bob-day-strip-fact';
        const before = await client.evaluate(`(() => { const n = document.querySelector(${JSON.stringify(hoverSelector)}); if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
        if (before) {
          await forcePseudo(hoverSelector, ["hover"]);
          const after = await client.evaluate(`(() => { const n = document.querySelector(${JSON.stringify(hoverSelector)}); if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
          if (!after) {
            interactionChecks.push({ width, theme, label: "forced hover never shifts the fact", result: "FAIL", detail: "hover strip vanished" });
          } else {
            const shift = Math.max(Math.abs(after.x - before.x), Math.abs(after.y - before.y), Math.abs(after.width - before.width), Math.abs(after.height - before.height));
            interactionChecks.push({ width, theme, label: "forced hover never shifts the fact", result: shift <= 0.5 ? "pass" : "FAIL", detail: `shift ${Math.round(shift * 10) / 10}px` });
          }
        } else {
          interactionChecks.push({ width, theme, label: "forced hover never shifts the fact", result: "FAIL", detail: "no hover strip rendered" });
        }
        const focusSelector = '[data-strip="focus"] .bob-day-strip-fact';
        const focusState = await client.evaluate(`(() => { const n = document.querySelector(${JSON.stringify(focusSelector)}); if (!n) return null; n.focus(); const style = getComputedStyle(n); return { active: document.activeElement === n, outline: style.outlineWidth, role: n.getAttribute("role"), tab: n.getAttribute("tabindex") }; })()`);
        if (focusState && focusState.active) {
          await forcePseudo(focusSelector, ["focus-visible"]);
          const outlined = await client.evaluate(`(() => { const n = document.querySelector(${JSON.stringify(focusSelector)}); return getComputedStyle(n).outlineWidth; })()`);
          const pass = focusState.role === "link" && outlined !== "0px";
          interactionChecks.push({ width, theme, label: "focus-visible shows an outline on the fact", result: pass ? "pass" : "FAIL", detail: `role=${focusState.role} tabindex=${focusState.tab} outline=${outlined}` });
        } else {
          interactionChecks.push({ width, theme, label: "focus-visible shows an outline on the fact", result: "FAIL", detail: "fact is not focusable" });
        }

        const screenshot = `day-strip-${width}-${theme}.png`;
        await capturePage(client, path.join(args.out, screenshot));
        matrix.push({ ...result, measurements, screenshot });
      }
    }
    const report = matrixMarkdown(matrix, browserVersion.product, revision, interactionChecks);
    fs.writeFileSync(path.join(args.out, "matrix-report.md"), report);
    const failures = matrix.flatMap((entry) => entry.measurements.filter((item) => item.result !== "pass").map((item) => `${entry.width}px ${entry.theme} ${item.state}: ${item.failures.join("; ")}`));
    const interactionFailures = interactionChecks.filter((item) => item.result !== "pass").map((item) => `${item.width}px ${item.theme} ${item.label}: ${item.detail}`);
    const overflow = matrix.filter((item) => item.pageScrollWidth > item.viewportWidth);
    if (process.env.DAYSTRIP_WIDTHS) {
      for (const entry of matrix) {
        for (const item of entry.measurements) {
          if ((item.state === "today" || item.state === "wide-values") && (entry.width === 540 || entry.width === 700)) {
            console.error(`${entry.width}px ${entry.theme} ${item.state}: facts=${JSON.stringify(item.factWidths)} rows=${item.factRows} strip=${item.stripHeight}px`);
          }
        }
      }
    }
    console.log(JSON.stringify({ output: args.out, html: htmlFile, chromium, browser: browserVersion.product, screenshots: matrix.map((item) => path.join(args.out, item.screenshot)), cells: matrix.reduce((sum, item) => sum + item.measurements.length, 0), failures: [...failures, ...interactionFailures], overflow: overflow.map((item) => `${item.width}px ${item.theme}`) }, null, 2));
    const allFailures = [...failures, ...interactionFailures];
    if (allFailures.length || overflow.length) throw new Error("Preview matrix failed its geometry or no-overflow checks; inspect matrix-report.md and screenshots.");
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
