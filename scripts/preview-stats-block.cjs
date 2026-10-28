#!/usr/bin/env node
// Generate a standalone real-browser preview from the production Stats block.
// The checked-in HTML output is intentionally dev-only; no browser library is
// needed at runtime, only an installed headless Chromium executable.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const repoRoot = path.resolve(__dirname, "..");
const pluginRoot = path.join(repoRoot, "plugins/bob-ledger-tools");
const fixturesDir = path.join(pluginRoot, "scripts/fixtures/stats");

function parseArgs(argv) {
  const args = { out: path.join("/tmp", "bob-stats-preview") };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--out" && argv[index + 1]) {
      args.out = path.resolve(argv[++index]);
    } else if (argv[index] === "--help" || argv[index] === "-h") {
      console.log("Usage: node scripts/preview-stats-block.cjs [--out DIRECTORY]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argv[index]}`);
    }
  }
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function findChromium() {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) {
    return process.env.CHROMIUM_PATH;
  }
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

function makeHtml({ pluginSource, css, fixtures }) {
  const safeJson = (value) => JSON.stringify(value).replace(/</g, "\\u003c");
  // Replacement functions: plugin source and fixtures contain `$``/`$&`
  // sequences that String.replace would otherwise expand (see the day-strip
  // preview, which already replaces this way).
  return fs.readFileSync(path.join(__dirname, "preview-stats-block.template.html"), "utf8")
    .replace("__PRODUCTION_STATS_CSS__", () => css)
    .replace("__PLUGIN_SOURCE_JSON__", () => safeJson(pluginSource))
    .replace("__FIXTURE_REPORTS_JSON__", () => safeJson(fixtures));
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
      try {
        WebSocketClient = require("undici").WebSocket || null;
      } catch (error) {
        WebSocketClient = null;
      }
    }
    if (!WebSocketClient) {
      throw new Error("The preview needs Node 22+ WebSocket or the undici WebSocket client.");
    }
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  while (Date.now() - start < 15000) {
    try {
      if (await client.evaluate("Boolean(window.__statsPreviewReady)")) return;
    } catch (error) {
      // The local HTML document may still be navigating.
    }
    await sleep(100);
  }
  throw new Error("The standalone preview did not finish loading.");
}

async function capture(client, file) {
  const result = await client.call("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: true,
  });
  fs.writeFileSync(file, Buffer.from(result.data, "base64"));
}

async function key(client, value, code = value.length === 1 ? `Key${value.toUpperCase()}` : value) {
  await client.call("Input.dispatchKeyEvent", { type: "keyDown", key: value, code, text: value.length === 1 ? value : undefined });
  await client.call("Input.dispatchKeyEvent", { type: "keyUp", key: value, code });
}

async function clickAt(client, rect, modifiers = 0) {
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, modifiers });
  await client.call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1, modifiers });
  await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1, modifiers });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.out, { recursive: true });
  const manifest = readJson(path.join(pluginRoot, "manifest.json"));
  const fixtureMetadata = readJson(path.join(fixturesDir, "canonical.meta.json"));
  const fixtures = {
    canonical: readJson(path.join(fixturesDir, "canonical.json")),
    month: readJson(path.join(fixturesDir, "synthetic-presentation.json")),
    week: readJson(path.join(fixturesDir, "synthetic-week.json")),
    homes: readJson(path.join(fixturesDir, "synthetic-homes.json")),
    homesBuckets: readJson(path.join(fixturesDir, "synthetic-homes-buckets.json")),
    lanes: readJson(path.join(fixturesDir, "synthetic-lanes.json")),
    empty: readJson(path.join(fixturesDir, "synthetic-empty.json")),
    allNull: readJson(path.join(fixturesDir, "synthetic-all-null.json")),
  };
  const pluginSource = fs.readFileSync(path.join(pluginRoot, "main.js"), "utf8");
  const css = fs.readFileSync(path.join(pluginRoot, "styles.css"), "utf8");
  const pluginRevision = spawnSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim();
  const rendererHash = sha256(pluginSource);
  const fixtureHash = sha256(fs.readFileSync(path.join(fixturesDir, "canonical.json")));
  const htmlFile = path.join(args.out, "index.html");
  fs.writeFileSync(htmlFile, makeHtml({ pluginSource, css, fixtures }));

  const chromium = findChromium();
  const profile = fs.mkdtempSync(path.join("/tmp", "bob-stats-chromium-"));
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
    const matrix = [];
    for (const width of [360, 1000]) {
      for (const theme of ["light", "dark"]) {
        await client.call("Emulation.setDeviceMetricsOverride", {
          width, height: 900, deviceScaleFactor: 1, mobile: false,
        });
        await client.evaluate(`window.statsPreview.renderMatrix(${width}, ${JSON.stringify(theme)})`);
        const hoverRect = await client.evaluate(`(() => {
          const hit = window.statsPreview.views[0].chartHitNodes.find((node) => node.getAttribute('data-date') === '2026-10-09');
          const rect = hit.getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        })()`);
        await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: hoverRect.x, y: hoverRect.y });
        await sleep(350);
        const observation = await client.evaluate(`(() => {
          const shell = window.statsPreview.shell;
          const root = shell;
          const titles = Array.from(root.querySelectorAll('.preview-case-title')).map((node) => node.textContent);
          const families = Array.from(root.querySelectorAll('.bob-stats-panel')).map((node) => node.getAttribute('aria-label'));
          return {
            containerWidth: shell.getBoundingClientRect().width,
            chartCount: root.querySelectorAll('.bob-stats-chart-section').length,
            panelCount: root.querySelectorAll('.bob-stats-panel').length,
            tableVisible: Boolean(root.querySelector('.bob-stats-table')),
            definitionVisible: Boolean(root.querySelector('.bob-stats-definition-panel')),
            tooltipVisible: Array.from(root.querySelectorAll('.bob-stats-chart-tooltip')).some((node) => !node.hasAttribute('hidden')),
            pageScrollWidth: document.documentElement.scrollWidth,
            viewportWidth: window.innerWidth,
            titles, families
          };
        })()`);
        const screenshot = path.join(args.out, `stats-${width}-${theme}.png`);
        await capture(client, screenshot);
        matrix.push({ width, theme, screenshot: path.basename(screenshot), ...observation });
      }
    }

    await client.call("Emulation.setDeviceMetricsOverride", { width: 1000, height: 900, deviceScaleFactor: 1, mobile: false });
    await client.evaluate("window.statsPreview.renderSingle('canonical', 'worked', 1000, 'light')");
    await sleep(250);
    const interactionChecks = [];
    const check = (name, condition, detail = "") => {
      if (!condition) throw new Error(`Browser check failed: ${name}${detail ? ` (${detail})` : ""}`);
      interactionChecks.push({ name, result: "PASS", detail });
    };
    const initial = await client.evaluate(`(() => ({
      fetchCount: window.statsPreview.fetchCount,
      rect: (() => { const n = document.querySelector('.bob-stats-chart-hit[tabindex="0"]'); const r = n.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()
    }))()`);
    check("direct production render uses cached report", initial.fetchCount === 0);
    await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: initial.rect.x + initial.rect.width / 2, y: initial.rect.y + initial.rect.height / 2 });
    await sleep(80);
    check("pointer hover shows tooltip", await client.evaluate("Boolean(window.statsPreview.views[0].chartTooltip && !window.statsPreview.views[0].chartTooltip.hasAttribute('hidden'))"));
    await clickAt(client, initial.rect);
    const pinnedAfterPointer = await client.evaluate("window.statsPreview.stateFor(window.statsPreview.views[0]).pinnedDay");
    check("pointer click pins a chart day without opening a note", Boolean(pinnedAfterPointer) && (await client.evaluate("window.statsPreview.openedLinks.length")) === 0, String(pinnedAfterPointer));

    const hitTarget = await client.evaluate(`(() => { const node = document.querySelector('.bob-stats-chart-hit[tabindex="0"]'); node.focus(); const r=node.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()`);
    await key(client, "Enter");
    check("Enter pins the focused chart column without opening it", (await client.evaluate("window.statsPreview.openedLinks.length")) === 0);
    const openRect = await client.evaluate(`(() => { const node = document.querySelector('[data-stats-focus-key="open-daily-note"]'); const r=node.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()`);
    await client.evaluate("document.querySelector('[data-stats-focus-key=\\\"open-daily-note\\\"]').click()");
    const normalOpen = await client.evaluate("window.statsPreview.openedLinks");
    check("Open daily note control opens the selected existing day", normalOpen.length === 1 && normalOpen[0][0].match(/^\d{4}\/\d{8}\.md$/) && normalOpen[0][2] === false, JSON.stringify(normalOpen));
    await client.evaluate(`(() => {
      window.statsPreview.openedLinks.length = 0;
      const button = document.querySelector('[data-stats-focus-key="open-daily-note"]');
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
    })()`);
    const modifiedOpen = await client.evaluate("window.statsPreview.openedLinks");
    check("Ctrl-click opens the selected daily note in a new leaf", modifiedOpen.length === 1 && modifiedOpen[0][0].match(/^\d{4}\/\d{8}\.md$/) && modifiedOpen[0][2] === true, JSON.stringify(modifiedOpen));

    const focusResult = await client.evaluate(`(() => {
      const selector = document.querySelector('.bob-stats-focus-select');
      selector.focus(); selector.value = 'habits'; selector.dispatchEvent(new Event('change', {bubbles:true}));
      const replacement = document.querySelector('.bob-stats-focus-select');
      return { focus: window.statsPreview.stateFor(window.statsPreview.views[0]).focus, restored: document.activeElement === replacement };
    })()`);
    check("focus selector redraw preserves focus", focusResult.focus === "habits" && focusResult.restored, JSON.stringify(focusResult));
    await client.evaluate("window.statsPreview.shell.querySelector('.bob-stats').focus()");
    await key(client, "j");
    check("j keyboard shortcut changes the metric", await client.evaluate("window.statsPreview.stateFor(window.statsPreview.views[0]).focus") === "keep_rate");
    await client.evaluate("window.statsPreview.shell.querySelector('.bob-stats').focus()");
    await key(client, "t");
    check("t keyboard shortcut toggles the table locally", Boolean(await client.evaluate("window.statsPreview.shell.querySelector('.bob-stats-table')")) && await client.evaluate("window.statsPreview.fetchCount") === 0);

    const definitionRect = await client.evaluate(`(() => { const n=document.querySelector('.bob-stats-definition-toggle'); const r=n.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()`);
    await clickAt(client, definitionRect);
    check("definition disclosure opens", Boolean(await client.evaluate("window.statsPreview.shell.querySelector('.bob-stats-definition-panel')")));
    await client.evaluate("window.statsPreview.shell.querySelector('[data-stats-focus-key=\\\"definition-close\\\"]').focus()");
    await key(client, "Escape");
    const definitionClosed = await client.evaluate(`(() => ({
      closed: !window.statsPreview.shell.querySelector('.bob-stats-definition-panel'),
      restored: document.activeElement && document.activeElement.getAttribute('data-stats-focus-key') === 'definition-toggle'
    }))()`);
    check("Escape closes definition and restores trigger focus", definitionClosed.closed && definitionClosed.restored, JSON.stringify(definitionClosed));

    await client.evaluate("window.statsPreview.renderSingle('week', 'worked', 1000, 'light')");
    const weekHit = await client.evaluate(`(() => {
      const hits = window.statsPreview.views[0].chartHitNodes;
      const index = hits.findIndex((node) => node.getAttribute('data-date') === '2026-10-05');
      const hit = hits[index]; hit.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      const select = window.statsPreview.shell.querySelector('.bob-stats-day-select');
      const options = select ? Array.from(select.options).map((option) => option.value) : [];
      if (select && options.includes('2026-10-06')) { select.value='2026-10-06'; select.dispatchEvent(new Event('change',{bubbles:true})); }
      return { index, options, pinned: window.statsPreview.stateFor(window.statsPreview.views[0]).pinnedDay, bucket: window.statsPreview.stateFor(window.statsPreview.views[0]).pinnedBucket };
    })()`);
    check("grouped bucket keeps a separate daily selector", weekHit.index >= 0 && weekHit.options.includes("2026-10-06") && weekHit.pinned === "2026-10-06" && weekHit.bucket.start === "2026-10-05", JSON.stringify(weekHit));

    await client.evaluate("window.statsPreview.renderSingle('canonical', 'worked', 1000, 'light')");
    const resize = await client.evaluate(`(() => {
      const shell = window.statsPreview.shell;
      shell.style.width='340px';
      return window.statsPreview.views[0].chartWidth || 0;
    })()`);
    await sleep(280);
    const afterResize = await client.evaluate(`(() => ({
      measured: window.statsPreview.views[0].chartWidth,
      containerWidth: window.statsPreview.shell.getBoundingClientRect().width,
      fetchCount: window.statsPreview.fetchCount
    }))()`);
    check("ResizeObserver redraws cached geometry without fetching", afterResize.containerWidth === 340 && afterResize.measured > 200 && afterResize.measured < 300 && afterResize.fetchCount === 0, `${resize} → ${JSON.stringify(afterResize)}`);

    await client.call("Emulation.setEmulatedMedia", { features: [
      { name: "prefers-reduced-motion", value: "reduce" },
      { name: "forced-colors", value: "active" },
    ] });
    const media = await client.evaluate(`({
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      forcedColors: matchMedia('(forced-colors: active)').matches
    })`);
    check("reduced-motion and forced-colors media modes activate", media.reducedMotion && media.forcedColors, JSON.stringify(media));
    await client.call("Emulation.setEmulatedMedia", { features: [
      { name: "prefers-reduced-motion", value: "no-preference" },
      { name: "forced-colors", value: "none" },
    ] });

    await client.evaluate("window.statsPreview.renderSingle('lanes', 'worked', 1000, 'light')");
    await sleep(250);
    const lanesLayout = await client.evaluate(`(() => {
      const root = document.querySelector('.bob-stats');
      const children = Array.from(root.children).map((node) => node.className);
      const header = children.findIndex((name) => name.split(/\\s+/).includes('bob-stats-header'));
      const lanes = children.findIndex((name) => name.split(/\\s+/).includes('bob-stats-lanes'));
      const tiles = children.findIndex((name) => name.split(/\\s+/).includes('bob-stats-tiles'));
      return { header, lanes, tiles, fetchCount: window.statsPreview.fetchCount };
    })()`);
    check("window lanes render above the tiles", lanesLayout.header >= 0 && lanesLayout.lanes === lanesLayout.header + 1 && lanesLayout.tiles === lanesLayout.lanes + 1, JSON.stringify(lanesLayout));
    const beforeThemes = await client.evaluate("window.statsPreview.fetchCount");
    await client.evaluate(`document.querySelector('[data-stats-focus-key="lanes-themes"]').click()`);
    const afterThemes = await client.evaluate(`({
      focus: window.statsPreview.stateFor(window.statsPreview.views[0]).focus,
      homesView: window.statsPreview.stateFor(window.statsPreview.views[0]).homesView,
      fetchCount: window.statsPreview.fetchCount,
      themesOn: Boolean(document.querySelector('[data-stats-focus-key="panel-home-view-themes"][aria-pressed="true"]'))
    })`);
    check("themes legend focuses Worked and Themes without fetching", afterThemes.focus === "worked" && afterThemes.homesView === "themes" && afterThemes.fetchCount === beforeThemes && afterThemes.themesOn, JSON.stringify(afterThemes));
    await client.evaluate("window.statsPreview.renderSingle('lanes', 'worked', 1000, 'light')");
    await sleep(150);
    const hover = await client.evaluate(`(() => new Promise((resolve) => {
      const lane = document.querySelector('.bob-stats-lane[data-lane="roots"]');
      const segments = Array.from(lane.querySelectorAll('.bob-stats-lane-segment'));
      segments[0].dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      setTimeout(() => {
        const styles = segments.map((node) => getComputedStyle(node).opacity);
        resolve({
          hot: lane.getAttribute('data-hot'),
          first: styles[0],
          other: styles[1],
          firstHot: segments[0] && segments[0].getAttribute('data-hot'),
          otherHot: segments[1] && segments[1].getAttribute('data-hot'),
          count: segments.length,
        });
      }, 160);
    }))()`);
    check("lane hover dims the other segments", hover.hot === "true" && hover.firstHot === "true" && hover.otherHot !== "true" && Number(hover.first) > 0.9 && Number(hover.other) < 0.4, JSON.stringify(hover));

    const overflow = matrix.filter((item) => item.pageScrollWidth > item.viewportWidth);
    if (overflow.length) throw new Error(`Preview page overflow at ${overflow.map((item) => `${item.width}px ${item.theme}`).join(", ")}`);
    if (matrix.some((item) => item.chartCount < 9 || item.panelCount < 6 || !item.tableVisible || !item.definitionVisible || !item.tooltipVisible)) {
      throw new Error(`The screenshot matrix is missing a chart family or requested state: ${JSON.stringify(matrix)}`);
    }

    const report = [
      "# Stats browser preview checked matrix",
      "",
      `- Renderer: bob-ledger-tools@${manifest.version}; source checkout ${pluginRevision}; main.js SHA-256 ${rendererHash}.`,
      `- Fixture: ${fixtureMetadata.fixture_version}; schema ${fixtureMetadata.schema_version}; bob-cli@${fixtureMetadata.bob_cli_version} (${fixtureMetadata.bob_cli_revision}); SHA-256 ${fixtureHash}.`,
      `- Canonical source: ${fixtureMetadata.source}; BOB_NOW=${fixtureMetadata.bob_now}; requested range ${fixtureMetadata.requested_range}.`,
      `- Browser: ${browserVersion.product} (${browserVersion.revision}).`,
      `- Synthetic fixtures: month, week, empty, and all-null presentation cases; no synthetic values represent vault metrics.`,
      "- Families rendered: Pomodoro themes, task breakdown, signed task flow, review answers, Keep rate, checklist calendar/chore grid.",
      "- Each screenshot contains all family views plus the table, open definition, and hover tooltip states.",
      "",
      "| Container | Theme | Charts | Context panels | Table | Definition | Tooltip | Page overflow | Screenshot |",
      "| ---: | --- | ---: | ---: | --- | --- | --- | --- | --- |",
      ...matrix.map((item) => `| ${item.width}px | ${item.theme} | ${item.chartCount} | ${item.panelCount} | yes | yes | yes | none | ${item.screenshot} |`),
      "",
      "## Browser interaction checks",
      "",
      ...interactionChecks.map((item) => `- ${item.result}: ${item.name}${item.detail ? ` — ${item.detail}` : ""}`),
      "",
      "The `dataviz` skill was absent from the available skill catalog and local skill caches during this run; its validator was not run. The approved Stats visual contract and unchanged palette were used.",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(args.out, "matrix-report.md"), report);
    console.log(JSON.stringify({ output: args.out, html: htmlFile, chromium, browser: browserVersion.product, screenshots: matrix.map((item) => path.join(args.out, item.screenshot)), interactions: interactionChecks.length }, null, 2));
  } finally {
    if (client) client.socket.close();
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch (error) {
      // Chromium can leave lock files in the profile after SIGTERM.
    }
  }
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
