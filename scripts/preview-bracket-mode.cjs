#!/usr/bin/env node
// Render the production bracket-mode indicator plus styles.css in headless Chromium.
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const repoRoot = path.resolve(__dirname, "..");
const pluginRoot = path.join(repoRoot, "plugins/bob-navigation-hotkeys");

function parseArgs(argv) {
  const args = { out: path.join("/tmp", "bob-bracket-mode-preview") };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--out" && argv[index + 1]) args.out = path.resolve(argv[++index]);
    else if (argv[index] === "--help" || argv[index] === "-h") {
      console.log("Usage: node scripts/preview-bracket-mode.cjs [--out DIRECTORY]");
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
  for (const candidate of ["/usr/bin/google-chrome", "/snap/bin/chromium"]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  const cache = path.join(os.homedir(), ".cache/ms-playwright");
  if (fs.existsSync(cache)) {
    const candidates = [];
    for (const browserDir of fs.readdirSync(cache)) {
      if (!browserDir.startsWith("chromium-")) continue;
      for (const platformDir of ["chrome-linux64", "chrome-linux", "chrome-headless-shell-linux64"]) {
        for (const name of ["chrome", "chrome-headless-shell", "headless_shell"]) {
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

function escapeHtml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

class FakeEl {
  constructor(tag) {
    this.tag = tag;
    this.classes = [];
    this.attrs = {};
    this.children = [];
    this.text = null;
    this.styleProps = {};
  }

  createEl(tag, options = {}) {
    const el = new FakeEl(tag);
    if (typeof options.cls === "string" && options.cls) el.classes.push(...options.cls.split(/\s+/).filter(Boolean));
    if (typeof options.text === "string") el.text = options.text;
    if (options.attr && typeof options.attr === "object") {
      for (const [key, value] of Object.entries(options.attr)) el.attrs[String(key)] = String(value);
    }
    this.children.push(el);
    return el;
  }

  createDiv(options = {}) {
    return this.createEl("div", options);
  }

  createSpan(options = {}) {
    return this.createEl("span", options);
  }

  setAttribute(key, value) {
    this.attrs[String(key)] = String(value);
  }

  getAttribute(key) {
    return this.attrs[String(key)] ?? null;
  }

  removeAttribute(key) {
    delete this.attrs[String(key)];
  }

  setText(text) {
    this.text = String(text);
    this.children = [];
  }

  empty() {
    this.children = [];
    this.text = null;
  }

  get style() {
    const self = this;
    return {
      setProperty(name, value) {
        self.styleProps[String(name)] = String(value);
      },
      getPropertyValue(name) {
        return self.styleProps[String(name)] || "";
      },
    };
  }

  get classList() {
    const self = this;
    return {
      add: (...classes) => {
        for (const cls of classes.flatMap((c) => String(c || "").split(/\s+/))) {
          if (cls && !self.classes.includes(cls)) self.classes.push(cls);
        }
      },
      remove: (...classes) => {
        const flat = classes.flatMap((c) => String(c || "").split(/\s+/));
        self.classes = self.classes.filter((c) => !flat.includes(c));
      },
      toggle: (cls, force) => {
        const has = self.classes.includes(cls);
        const want = force === undefined ? !has : Boolean(force);
        if (want && !has) self.classes.push(cls);
        if (!want && has) self.classes = self.classes.filter((c) => c !== cls);
        return want;
      },
      contains: (cls) => self.classes.includes(cls),
    };
  }

  toHtml() {
    const cls = this.classes.length ? ` class="${escapeHtml(this.classes.join(" "))}"` : "";
    const styleKeys = Object.keys(this.styleProps);
    const style = styleKeys.length
      ? ` style="${escapeHtml(styleKeys.map((k) => `${k}: ${this.styleProps[k]}`).join("; "))}"`
      : "";
    const attrs = Object.entries(this.attrs)
      .map(([key, value]) => ` ${key}="${escapeHtml(value)}"`)
      .join("");
    const body = escapeHtml(this.text || "") + this.children.map((child) => child.toHtml()).join("");
    return `<${this.tag}${cls}${style}${attrs}>${body}</${this.tag}>`;
  }
}

function loadProductionHelpers() {
  class TestPlugin {}
  const originalLoad = Module._load;
  Module._load = function loadWithObsidianStubs(request) {
    if (request === "obsidian") {
      return {
        MarkdownView: class {},
        Modal: class {},
        Notice: class {},
        Platform: { isDesktopApp: true },
        Plugin: TestPlugin,
        normalizePath: (value) => value,
        parseYaml: (text) => JSON.parse(text),
      };
    }
    if (request === "@codemirror/state") return { Prec: { highest: (value) => value } };
    if (request === "@codemirror/view") {
      return { EditorView: { updateListener: { of: (listener) => ({ listener }) } }, keymap: { of: (value) => value } };
    }
    return originalLoad.apply(this, arguments);
  };
  let helpers;
  try {
    helpers = require("../plugins/bob-navigation-hotkeys/main.js").helpers;
    if (!helpers || typeof helpers.buildBracketModeView !== "function") {
      throw new Error("Bracket-mode helpers missing from the built bundle; run npm run build first.");
    }
  } finally {
    Module._load = originalLoad;
  }
  return helpers;
}

function renderIndicator(helpers, mode, flash = null) {
  const root = new FakeEl("div");
  root.classes.push("status-bar-item", "bob-bracket-mode");
  const view = helpers.buildBracketModeView(mode);
  const parts = helpers.ensureBracketModeDom(root);
  helpers.paintBracketModeIndicator(root, parts, view, undefined);
  // Clear the async is-instant for a stable screenshot (first paint fades in).
  root.classes = root.classes.filter((c) => c !== "is-instant");
  if (flash) {
    root.attrs["data-bracket-flash"] = flash;
  }
  // Serialize: root already has data-bracket-mode, style, aria-label, title.
  return { html: root.toHtml(), view };
}

function buildCases(helpers) {
  const cases = [];
  for (const mode of [null, "s", "w", "n"]) {
    const id = mode === null ? "none" : mode;
    const { html } = renderIndicator(helpers, mode);
    cases.push({ id, title: mode === null ? "unset (no thumb)" : `mode ${mode}`, html });
  }
  for (const flash of ["forward", "backward"]) {
    const { html } = renderIndicator(helpers, "s", flash);
    cases.push({ id: `flash-${flash}`, title: `flash ${flash} (reduced motion)`, html });
  }
  cases.push({ id: "flash-empty", title: "cold press (empty flash)", html: renderIndicator(helpers, null, "empty").html });
  return cases;
}

function makeHtml({ css, cases }) {
  const cards = cases
    .map(
      (item) =>
        `<section class="preview-case" data-case="${escapeHtml(item.id)}"><h2>${escapeHtml(item.title)}</h2><div class="preview-status-bar"><span class="preview-vim">\uD83D\uDFE2</span><span class="preview-review">\u27F3 Review 3/12 \u00B7 NEXT 1/4</span>${item.html}</div></section>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Bob bracket-mode preview</title>
<style>
body[data-theme="light"] {
  --background-primary:#fcfcfd; --background-secondary:#f0f1f4; --background-modifier-border:#d7d9df;
  --status-bar-background:#f0f1f4;
  --text-normal:#252832; --text-muted:#727783; --text-faint:#a0a4ad;
  --interactive-accent:#624bb8; --font-ui-smaller:12px; --radius-s:5px; --radius-m:8px;
  --font-monospace:ui-monospace, monospace;
  color-scheme:light;
}
body[data-theme="dark"] {
  --background-primary:#202226; --background-secondary:#292c32; --background-modifier-border:#41454d;
  --status-bar-background:#292c32;
  --text-normal:#e4e5e9; --text-muted:#a3a7b0; --text-faint:#6b7078;
  --interactive-accent:#b6a0ff; --font-ui-smaller:12px; --radius-s:5px; --radius-m:8px;
  --font-monospace:ui-monospace, monospace;
  color-scheme:dark;
}
body { margin:0; padding:28px; background:var(--background-secondary); color:var(--text-normal); font:14px sans-serif; }
.preview-shell { max-width:760px; margin:0 auto; padding:22px; border:1px solid var(--background-modifier-border); border-radius:14px; background:var(--background-primary); }
.preview-case { margin-bottom:12px; padding:10px; border:1px solid var(--background-modifier-border); border-radius:10px; background:var(--background-secondary); }
.preview-case h2 { margin:0 0 9px; color:var(--text-muted); font-size:10px; letter-spacing:.08em; text-transform:uppercase; }
.preview-status-bar { display:flex; align-items:center; gap:10px; width:100%; min-width:0; background:var(--status-bar-background); color:var(--text-normal); border:1px solid var(--background-modifier-border); padding:5px 8px; overflow:hidden; }
.preview-vim { flex:0 0 auto; }
.preview-review { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text-muted); font-size:12px; }
${css}
</style>
</head>
<body data-theme="light">
<main class="preview-shell">${cards}</main>
<script>
window.bracketModePreview = {
  measure() {
    const out = [];
    for (const section of document.querySelectorAll(".preview-case")) {
      const bar = section.querySelector(".preview-status-bar");
      const indicator = section.querySelector(".bob-bracket-mode");
      const thumb = section.querySelector(".bob-bracket-mode-thumb");
      const overflow = bar ? bar.scrollWidth - bar.clientWidth : 0;
      let baseline = null;
      let centered = true;
      try {
        const barRect = bar.getBoundingClientRect();
        const thumbRect = thumb.getBoundingClientRect();
        const indicatorRect = indicator.getBoundingClientRect();
        centered = Math.abs((thumbRect.top + thumbRect.bottom) / 2 - (barRect.top + barRect.bottom) / 2) < 3;
        const glyphs = Array.from(indicator.querySelectorAll("span, button")).filter((n) => !n.classList.contains("bob-bracket-mode-thumb"));
        const centers = glyphs.map((n) => {
          const rect = n.getBoundingClientRect();
          return (rect.top + rect.bottom) / 2;
        });
        baseline = Math.max(...centers) - Math.min(...centers);
      } catch (e) { baseline = 0; }
      out.push({ id: section.dataset.case, overflow, baseline, centered });
    }
    return out;
  }
};
window.bracketModePreviewReady = true;
</script>
</body>
</html>`;
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
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("Chromium exited before publishing its DevTools port.");
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
  const response = await client.call("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height, scale: 1 },
  });
  fs.writeFileSync(output, Buffer.from(response.data, "base64"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.out, { recursive: true });
  const helpers = loadProductionHelpers();
  const cases = buildCases(helpers);
  const css = fs.readFileSync(path.join(pluginRoot, "styles.css"), "utf8");
  const htmlFile = path.join(args.out, "index.html");
  fs.writeFileSync(htmlFile, makeHtml({ css, cases }));
  const chromium = findChromium();
  const profile = fs.mkdtempSync(path.join("/tmp", "bob-bracket-preview-"));
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
    await client.call("Emulation.setDeviceMetricsOverride", { width: 900, height: 900, deviceScaleFactor: 1, mobile: false });
    await client.call("Page.navigate", { url: pathToFileURL(htmlFile).href });
    const start = Date.now();
    while (Date.now() - start < 15000) {
      if (await client.evaluate("Boolean(window.bracketModePreviewReady)")) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    // Emulate reduced motion so flash static colors are visible in screenshots.
    try {
      await client.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    } catch (error) {
      // Older Chromium without feature emulation still shows static flash colors.
    }
    const screenshots = [];
    const failures = [];
    for (const theme of ["light", "dark"]) {
      await client.evaluate(`document.body.dataset.theme = ${safeJson(theme)}`);
      const measurements = await client.evaluate("window.bracketModePreview.measure()");
      for (const item of measurements) {
        if (item.overflow > 0.5) failures.push(`${theme}/${item.id}: status bar overflows by ${item.overflow}px`);
        if (item.baseline > 2) failures.push(`${theme}/${item.id}: glyphs off baseline by ${item.baseline}px`);
        if (!item.centered) failures.push(`${theme}/${item.id}: thumb not vertically centered`);
      }
      const output = path.join(args.out, `bracket-mode-${theme}.png`);
      await capture(client, output);
      screenshots.push(output);
    }
    // Best-effort forced-colors frame.
    try {
      await client.call("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }] });
      await client.evaluate(`document.body.dataset.theme = "light"`);
      const output = path.join(args.out, "bracket-mode-forced-colors.png");
      await capture(client, output);
      screenshots.push(output);
    } catch (error) {
      // Forced-colors emulation unsupported; light/dark PNGs are the bar.
    }
    fs.writeFileSync(path.join(args.out, "summary.md"), [
      "# Bob bracket-mode preview",
      "",
      "Rendered from the production bracket-mode helpers plus `styles.css` in a mock status bar.",
      "",
      ...screenshots.map((file) => `- ${path.basename(file)}`),
      "",
    ].join("\n"));
    if (failures.length > 0) {
      console.error(failures.join("\n"));
      process.exitCode = 1;
    }
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

main().catch((error) => {
  console.error((error && error.stack) || error);
  process.exitCode = 1;
});
