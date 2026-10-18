#!/usr/bin/env node
// Render the production Reading Board block in a real headless browser and
// screenshot it (dev-only; never part of `npm test`). The page loads the
// built plugin `main.js` and `styles.css` unchanged, so the pictures show
// exactly what Obsidian renders. Needs an installed headless Chromium:
// Playwright's cached `chromium_headless_shell` / `chromium`, or set
// CHROMIUM_PATH.
//
//   node scripts/preview-reading-board.cjs [--out DIR] [--input FILE] [--today YYYY-MM-DD]
//
// Without --input it renders the checked-in `bob ref list` fixture and a
// larger synthetic 45-card fixture. With --input FILE it renders any
// `bob ref list -s ready,next,wip -A -f json` output (keep real-title
// screenshots out of git).
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { TODAY, syntheticReport, syntheticTodayPaths } = require("./preview-reading-board-fixture.cjs");

const repoRoot = path.resolve(__dirname, "..");
const pluginRoot = path.join(repoRoot, "plugins/bob-ledger-tools");
const fixturePath = path.join(pluginRoot, "scripts/fixtures/reading-board/ref-list.json");

const DEFAULT_TASK_STATUS_CSS = `body {
  --task-status-in-progress: var(--color-yellow);
  --task-status-next: var(--color-green);
  --task-status-blocked: var(--color-red);
}`;

function parseArgs(argv) {
  const args = { out: path.join("/tmp", "bob-reading-board-preview"), input: null, today: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--out" && argv[index + 1]) args.out = path.resolve(argv[++index]);
    else if (flag === "--input" && argv[index + 1]) args.input = path.resolve(argv[++index]);
    else if (flag === "--today" && /^\d{4}-\d{2}-\d{2}$/.test(argv[index + 1] || "")) args.today = argv[++index];
    else if (flag === "--help" || flag === "-h") {
      console.log("Usage: node scripts/preview-reading-board.cjs [--out DIRECTORY] [--input FILE] [--today YYYY-MM-DD]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${flag}`);
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
      const layouts = browserDir.startsWith("chromium_headless_shell-")
        ? [["chrome-headless-shell-linux64", "chrome-headless-shell"], ["chrome-headless-shell-mac-arm64", "chrome-headless-shell"]]
        : browserDir.startsWith("chromium-")
          ? [["chrome-linux64", "chrome"], ["chrome-linux", "chrome"], ["chrome-mac/Chromium.app/Contents/MacOS", "Chromium"]]
          : [];
      for (const [dir, exe] of layouts) {
        const executable = path.join(cache, browserDir, dir, exe);
        if (fs.existsSync(executable)) candidates.push(executable);
      }
    }
    // Prefer the headless shell: no display stack needed.
    candidates.sort((a, b) => Number(b.includes("headless")) - Number(a.includes("headless")) || b.localeCompare(a));
    if (candidates.length) return candidates[0];
  }
  throw new Error("Could not find headless Chromium. Set CHROMIUM_PATH to an installed browser executable.");
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
    const socket = new WebSocket(endpoint);
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
    const response = await this.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (response.exceptionDetails) {
      throw new Error((response.exceptionDetails.exception && response.exceptionDetails.exception.description) || response.exceptionDetails.text);
    }
    return response.result && response.result.value;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, label, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (await predicate()) return;
    } catch (error) {
      // The page may still be navigating.
    }
    await sleep(60);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const MODIFIERS = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
const KEY_CODES = {
  Tab: 9, Enter: 13, Escape: 27, End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
};

async function key(client, value, modifiers = 0) {
  const code = KEY_CODES[value];
  const text = value.length === 1 ? value : value === "Enter" ? "\r" : undefined;
  const base = { key: value, code: value.length === 1 ? `Key${value.toUpperCase()}` : value, windowsVirtualKeyCode: code || value.toUpperCase().charCodeAt(0), modifiers };
  await client.call("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...base, text });
  await client.call("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  await sleep(40);
}

async function mouse(client, rect, { button = "left", modifiers = 0, move = false } = {}) {
  const x = rect.x + Math.min(rect.width / 2, 120);
  const y = rect.y + rect.height / 2;
  await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, modifiers });
  if (move) {
    await sleep(120);
    return;
  }
  await client.call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount: 1, modifiers });
  await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount: 1, modifiers });
  await sleep(40);
}

async function capture(client, file) {
  const result = await client.call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: true });
  fs.writeFileSync(file, Buffer.from(result.data, "base64"));
}

const ev = (client, expression) => client.evaluate(expression);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.out, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, "manifest.json"), "utf8"));
  const pluginSource = fs.readFileSync(path.join(pluginRoot, "main.js"), "utf8");
  const css = fs.readFileSync(path.join(pluginRoot, "styles.css"), "utf8");
  const vaultStatusCss = path.join(os.homedir(), "bob/.obsidian/snippets/task-statuses.css");
  const taskStatusCss = fs.existsSync(vaultStatusCss) ? fs.readFileSync(vaultStatusCss, "utf8") : DEFAULT_TASK_STATUS_CSS;
  const synthetic = syntheticReport();
  let fixtures;
  let today = args.today || TODAY;
  if (args.input) {
    const input = JSON.parse(fs.readFileSync(args.input, "utf8"));
    if (!args.today && typeof input.generated_at === "string") today = input.generated_at.slice(0, 10);
    fixtures = { input };
  } else {
    fixtures = { synthetic, canonical: JSON.parse(fs.readFileSync(fixturePath, "utf8")) };
  }
  const data = { fixtures, todayPaths: args.input ? [] : syntheticTodayPaths(synthetic), today };
  const safeJson = (value) => JSON.stringify(value).replace(/</g, "\\u003c");
  const html = fs.readFileSync(path.join(__dirname, "preview-reading-board.template.html"), "utf8")
    .replace("__TASK_STATUS_CSS__", () => taskStatusCss)
    .replace("__PRODUCTION_CSS__", () => css)
    .replace("__PLUGIN_SOURCE_JSON__", () => safeJson(pluginSource))
    .replace("__DATA_JSON__", () => safeJson(data));
  const htmlFile = path.join(args.out, "index.html");
  fs.writeFileSync(htmlFile, html);

  const chromium = findChromium();
  const headlessShell = chromium.includes("headless-shell");
  // Launch one browser. `mouse` emulates a desktop pointer (hover and fine
  // pointer); without it the browser reports a touch-style device.
  async function launch({ mouse }) {
    const profile = fs.mkdtempSync(path.join("/tmp", "bob-reading-board-chromium-"));
    const child = spawn(chromium, [
      ...(headlessShell ? [] : ["--headless=new"]),
      "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--force-color-profile=srgb",
      ...(mouse ? ["--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4"] : []),
      "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
    ], { stdio: "ignore", env: { ...process.env, TMPDIR: "/tmp" } });
    const portFile = path.join(profile, "DevToolsActivePort");
    await waitFor(() => fs.existsSync(portFile), "DevTools port file");
    const port = fs.readFileSync(portFile, "utf8").split(/\s+/)[0];
    let pageInfo = null;
    for (let attempt = 0; attempt < 40 && !pageInfo; attempt += 1) {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      pageInfo = pages.find((page) => page.type === "page");
      if (!pageInfo) await sleep(100);
    }
    if (!pageInfo) throw new Error("Chromium did not publish a DevTools page.");
    const connection = await CdpClient.connect(pageInfo.webSocketDebuggerUrl);
    await connection.call("Page.enable");
    await connection.call("Runtime.enable");
    await connection.call("Page.navigate", { url: pathToFileURL(htmlFile).href });
    await waitFor(() => connection.evaluate("Boolean(window.__boardPreviewReady)"), "the preview page");
    return {
      client: connection,
      async close() {
        connection.socket.close();
        child.kill("SIGTERM");
        await new Promise((resolve) => child.once("exit", resolve));
        fs.rmSync(profile, { recursive: true, force: true });
      },
    };
  }
  const browsers = [];
  let client = null;
  try {
    const desktop = await launch({ mouse: true });
    browsers.push(desktop);
    client = desktop.client;
    const browserVersion = await client.call("Browser.getVersion");

    const failures = [];
    const checks = [];
    const check = (name, condition, detail = "") => {
      checks.push({ name, ok: Boolean(condition), detail });
      if (!condition) failures.push(`${name}${detail ? ` (${detail})` : ""}`);
    };
    const shot = async (name) => {
      const file = path.join(args.out, `${name}.png`);
      await capture(client, file);
      return path.basename(file);
    };
    const viewport = (width) => client.call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    const render = (options) => ev(client, `window.boardPreview.render(${JSON.stringify(options)})`);
    const rect = (selector, index = 0) => ev(client, `window.boardPreview.rectOf(${JSON.stringify(selector)}, ${index})`);

    const mainFixture = args.input ? "input" : "synthetic";
    const expectedColumns = { 420: 1, 700: 2, 1200: 4 };
    const matrix = [];
    for (const theme of ["light", "dark"]) {
      for (const width of [420, 700, 1200]) {
        await viewport(width);
        const observed = await render({ fixture: mainFixture, width, theme, state: "board" });
        const name = `board-${width}-${theme}`;
        check(`${name}: board renders`, observed.hasBoard && observed.cards + observed.rows > 0);
        check(`${name}: ${expectedColumns[width]} lane column(s)`, observed.columns === expectedColumns[width], `${observed.columns} columns`);
        check(`${name}: no page overflow`, observed.pageScrollWidth <= observed.viewportWidth, `${observed.pageScrollWidth} > ${observed.viewportWidth}`);
        check(`${name}: nothing spills out of its card`, observed.overflowing.length === 0, observed.overflowing.join(", "));
        if (!args.input) {
          check(`${name}: lane counts match the fixture`, JSON.stringify(observed.laneCounts) === JSON.stringify(["1", "6", "15", "23"]), observed.laneCounts.join("/"));
        }
        matrix.push({ name, width, theme, ...observed, screenshot: await shot(name) });
      }
    }

    if (!args.input) {
      // Contrast of the text a reader actually reads, in both themes.
      const contrastSelectors = [
        ".bob-reading-board-title-text", ".bob-reading-board-kind", ".bob-reading-board-summary",
        ".bob-reading-board-lane-label", ".bob-reading-board-lane-snoozed .bob-reading-board-row-title",
        ".bob-reading-board-reason", ".bob-reading-board-group", ".bob-reading-board-when",
      ];
      const contrast = [];
      for (const theme of ["light", "dark"]) {
        await viewport(1200);
        await render({ fixture: "synthetic", width: 1200, theme, state: "board" });
        for (const selector of contrastSelectors) {
          const result = await ev(client, `window.boardPreview.contrastOf(${JSON.stringify(selector)})`);
          contrast.push({ theme, ...result });
          check(`${theme} contrast ${selector} >= 4.5`, result && result.ratio >= 4.5, result ? String(result.ratio) : "missing");
        }
      }
      matrix.contrast = contrast;

      // Hover: card actions appear; a Waiting-on row outlines its prerequisite.
      await viewport(1200);
      await render({ fixture: "synthetic", width: 1200, theme: "light", state: "board" });
      const nextCard = await rect('.bob-reading-board-lane-next .bob-reading-board-card', 1);
      await mouse(client, nextCard, { move: true });
      await sleep(250);
      const actionOpacity = await ev(client, `getComputedStyle(document.querySelectorAll('.bob-reading-board-lane-next .bob-reading-board-actions')[1]).opacity`);
      check("hover reveals the card actions", actionOpacity === "1", actionOpacity);
      matrix.hover = await shot("hover-card-1200-light");
      await render({ fixture: "synthetic", width: 1200, theme: "dark", state: "board" });
      const waiting = await ev(client, `(() => {
        const rows = Array.from(document.querySelectorAll('.bob-reading-board-row[data-group="waiting_on"]'));
        const target = rows.find((row) => /Merge queues, compared/.test(row.textContent));
        target.scrollIntoView({ block: 'center' });
        const r = target.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      })()`);
      await mouse(client, waiting, { move: true });
      const lit = await ev(client, `Array.from(document.querySelectorAll('.bob-reading-board-prerequisite')).map((n) => n.getAttribute('data-path'))`);
      check("hovering a Waiting-on row outlines its on-board prerequisite", lit.length === 1 && /native_merge_queue/.test(lit[0]), JSON.stringify(lit));
      matrix.prerequisite = await shot("hover-waiting-1200-dark");

      // Keyboard and mouse routing through real input events.
      await viewport(1200);
      await render({ fixture: "synthetic", width: 1200, theme: "light", state: "board" });
      await ev(client, "document.body.focus(); true");
      await key(client, "Tab");
      const focusedLane = () => ev(client, "(document.activeElement && document.activeElement.getAttribute('data-lane')) || ''");
      const focusedPath = () => ev(client, "(document.activeElement && document.activeElement.getAttribute('data-path')) || ''");
      check("Tab lands on the board's single Tab stop", (await focusedLane()) === "reading", await focusedLane());
      await key(client, "Tab");
      check("the board is one Tab stop", !(await ev(client, "Boolean(document.activeElement && document.activeElement.closest && document.activeElement.closest('.bob-reading-board'))")));
      await key(client, "Tab", MODIFIERS.shift);
      check("Shift+Tab returns to the board", (await focusedLane()) === "reading");
      await key(client, "ArrowRight");
      check("ArrowRight moves to the Next lane", (await focusedLane()) === "next");
      await key(client, "j");
      await key(client, "j");
      await key(client, "k");
      const second = await focusedPath();
      await key(client, "End");
      const last = await focusedPath();
      await key(client, "Home");
      const first = await focusedPath();
      check("j/k/Home/End move within a lane", second && last && first && new Set([second, last, first]).size === 3, `${first} ${second} ${last}`);
      await key(client, "l");
      check("l moves to the Ready lane", (await focusedLane()) === "ready");
      await key(client, "Enter");
      let opened = await ev(client, "window.boardPreview.opened");
      check("Enter opens the reference in this tab", opened.length === 1 && opened[0][2] === false && opened[0][0] === (await focusedPath()), JSON.stringify(opened));
      await key(client, "Enter", MODIFIERS.ctrl);
      const pdfs = await ev(client, "window.boardPreview.pdfs");
      const withPdf = await ev(client, "document.activeElement.querySelector('.bob-reading-board-action-pdf') !== null");
      check("Ctrl+Enter hands the PDF to Highlights (or opens a new tab without one)", withPdf ? pdfs.length === 1 : (await ev(client, "window.boardPreview.opened")).at(-1)[2] === true, JSON.stringify(pdfs));
      await key(client, "Enter", MODIFIERS.alt);
      opened = await ev(client, "window.boardPreview.opened");
      check("Alt+Enter goes to the reading task", /#\^ref$/.test(opened.at(-1)[0]), JSON.stringify(opened.at(-1)));
      await key(client, "c");
      check("c collapses Snoozed", await ev(client, "Boolean(document.querySelector('.bob-reading-board-lane-snoozed.bob-reading-board-lane-collapsed'))"));
      await key(client, "c");
      check("c expands Snoozed again", !(await ev(client, "Boolean(document.querySelector('.bob-reading-board-lane-snoozed.bob-reading-board-lane-collapsed'))")));
      const card = await rect('.bob-reading-board-lane-ready .bob-reading-board-card', 2);
      await ev(client, "window.boardPreview.opened.length = 0; true");
      await mouse(client, card, {});
      await mouse(client, card, { modifiers: MODIFIERS.ctrl });
      await mouse(client, card, { button: "middle" });
      opened = await ev(client, "window.boardPreview.opened");
      check("click opens in place; Ctrl-click and middle-click open a new tab", opened.length === 3 && opened[0][2] === false && opened[1][2] === true && opened[2][2] === true, JSON.stringify(opened));
      await ev(client, "window.boardPreview.hovers.length = 0; true");
      await mouse(client, await rect('.bob-reading-board-lane-ready .bob-reading-board-title', 3), { move: true });
      const hovered = await ev(client, "window.boardPreview.hovers.length");
      check("hovering a title requests the page preview", hovered > 0, String(hovered));
      await client.call("Emulation.setEmulatedMedia", { features: [
        { name: "prefers-reduced-motion", value: "reduce" },
        { name: "forced-colors", value: "active" },
      ] });
      const media = await ev(client, "({ reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, forced: matchMedia('(forced-colors: active)').matches, ghostAnimation: getComputedStyle(document.querySelector('.bob-reading-board-card')).transitionDuration })");
      check("reduced motion and forced colors activate", media.reduced && media.forced && /^0s/.test(media.ghostAnimation), JSON.stringify(media));
      matrix.forced = await shot("forced-colors-1200");
      await client.call("Emulation.setEmulatedMedia", { features: [] });
    }

    // Honest states at a typical readable width, in both themes.
    const generatedTime = /T(\d{2}:\d{2})/.exec(fixtures[mainFixture].generated_at || "")[1];
    const states = [
      ["empty", "Nothing queued ✓"],
      ["error", "bob was not found"],
      ["desktop", "needs the desktop app"],
      ["older", "Update bob-cli to see why references are snoozed"],
      ["collapsed", "Snoozed"],
      ["loading", "Reading Board"],
      ["stale-error", `Showing the board from ${generatedTime}`],
    ];
    const stateShots = [];
    for (const theme of ["light", "dark"]) {
      await viewport(700);
      for (const [state, expected] of states) {
        const observed = await render({ fixture: mainFixture, width: 700, theme, state, title: state });
        const name = `state-${state}-700-${theme}`;
        check(`${name}: shows "${expected}"`, observed.text.includes(expected), observed.text.slice(0, 160));
        check(`${name}: no page overflow`, observed.pageScrollWidth <= observed.viewportWidth);
        stateShots.push({ name, screenshot: await shot(name) });
      }
    }
    if (!args.input) {
      for (const [theme, width] of [["light", 1200], ["dark", 700]]) {
        await viewport(width);
        await render({ fixture: "canonical", width, theme, state: "board", title: "canonical bob output" });
        stateShots.push({ name: `canonical-${width}-${theme}`, screenshot: await shot(`canonical-${width}-${theme}`) });
      }
    }

    // Touch devices have no hover: the actions must stay visible.
    const touch = await launch({ mouse: false });
    browsers.push(touch);
    for (const theme of ["light"]) {
      await touch.client.call("Emulation.setDeviceMetricsOverride", { width: 420, height: 900, deviceScaleFactor: 1, mobile: false });
      await touch.client.evaluate(`window.boardPreview.render(${JSON.stringify({ fixture: mainFixture, width: 420, theme, state: "board", title: "touch (hover: none)" })})`);
      const hiddenActions = await touch.client.evaluate("getComputedStyle(document.querySelector('.bob-reading-board-actions')).opacity");
      check("without hover the card actions stay visible", hiddenActions === "1", hiddenActions);
      const file = path.join(args.out, `touch-420-${theme}.png`);
      await capture(touch.client, file);
      stateShots.push({ name: `touch-420-${theme}`, screenshot: path.basename(file) });
    }

    const report = [
      "# Reading Board browser preview",
      "",
      `- Renderer: bob-ledger-tools@${manifest.version}; main.js and styles.css as built.`,
      `- Browser: ${browserVersion.product} (${browserVersion.revision}).`,
      `- Data: ${args.input ? `--input ${path.basename(args.input)} (today ${today})` : "checked-in bob fixture plus a 45-card synthetic fixture (today 2026-10-20)"}.`,
      `- ${checks.filter((item) => item.ok).length}/${checks.length} browser checks passed.`,
      "",
      "| Board | Columns | Cards | Snoozed rows | Screenshot |",
      "| --- | ---: | ---: | ---: | --- |",
      ...matrix.map((item) => `| ${item.name} | ${item.columns} | ${item.cards} | ${item.rows} | ${item.screenshot} |`),
      "",
      "## States",
      "",
      ...stateShots.map((item) => `- ${item.name}: ${item.screenshot}`),
      "",
      "## Checks",
      "",
      ...checks.map((item) => `- ${item.ok ? "PASS" : "FAIL"}: ${item.name}${item.detail ? ` — ${item.detail}` : ""}`),
      "",
    ].join("\n");
    fs.writeFileSync(path.join(args.out, "report.md"), report);
    console.log(JSON.stringify({
      output: args.out,
      chromium,
      browser: browserVersion.product,
      checks: checks.length,
      failed: failures,
      screenshots: [...matrix.map((item) => item.screenshot), ...stateShots.map((item) => item.screenshot)]
        .map((name) => path.join(args.out, name)),
    }, null, 2));
    if (failures.length) process.exitCode = 1;
  } finally {
    for (const browser of browsers) await browser.close();
  }
}

main().catch((error) => {
  console.error((error && error.stack) || error);
  process.exitCode = 1;
});
