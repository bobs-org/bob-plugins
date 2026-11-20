#!/usr/bin/env node
// Capture inline command chips in Chromium from the built bob-chips main.js
// and styles.css: production scanner, builders, run store, paint model, and
// painter. Verdicts come from Command Mode's own resolver run in Node
// against the shared fixture catalog. Only the page around the chips and
// the Lucide icon shim are scaffolding.
//   node scripts/preview-command-chips.cjs [--out DIR] [--self-test]
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const repoRoot = path.resolve(__dirname, "..");
const chipsRoot = path.join(repoRoot, "plugins", "bob-chips");
const TEMPLATE = path.join(__dirname, "preview-command-chips.template.html");
const RESOLVE_HOST = "athena";
const BASELINE = [
  ":root { --input-height: 30px; --radius-s: 4px; --layer-tooltip: 40; --font-ui-smaller: 12px;",
  "  --font-interface: Inter, ui-sans-serif, sans-serif; --font-text: Inter, ui-sans-serif, sans-serif; --font-monospace: ui-monospace, 'DejaVu Sans Mono', monospace; }",
  // Obsidian's own button rule, which button.bob-run-chip must override.
  "button { display:inline-flex; align-items:center; justify-content:center; height:var(--input-height); padding:4px 12px; border:1px solid var(--background-modifier-border); border-radius:5px; background:var(--interactive-normal); color:var(--text-normal); font:500 13px var(--font-interface); white-space:nowrap; cursor:var(--cursor); }",
].join("\n");

const HELP = [
  "Usage: node scripts/preview-command-chips.cjs [--out DIRECTORY] [--self-test]",
  "",
  "Render every command-chip face in light, dark, narrow, reduced-motion, and",
  "print captures. Set CHROMIUM_PATH when no Chrome/Chromium is on PATH.",
].join("\n");

const LONG_SEQUENCE = "bob task reconcile && bob plan && bob ref create \"Weekly && notes\"";
const FENCE_SYNC = "bob task reconcile\nbob ref create \"Weekly notes\"\nbob ref rename \"Old title\" \"New title\"";
const FENCE_ASKS = "bob task reconcile\nbob task archive";
const FENCE_HOST = "bob task reconcile\nbob mac-only";
const STATE_LINE = "Then `run: bob task reconcile` before standup.";

// Every row names the face the production paint model must report.
const MATRIX = Object.freeze({
  tables: [
    {
      title: "Run states (one command)",
      rows: [
        { name: "Ready", line: STATE_LINE, expect: "ready", group: "single" },
        { name: "Armed", line: STATE_LINE, drive: { armed: true }, expect: "armed", group: "single" },
        { name: "Queued", line: STATE_LINE, drive: { state: "queued" }, expect: "queued", group: "single" },
        { name: "Running", line: STATE_LINE, drive: { state: "running" }, expect: "running", group: "single" },
        { name: "Completed", line: STATE_LINE, drive: { state: "completed" }, expect: "completed", group: "single" },
        { name: "Attention", line: STATE_LINE, drive: { state: "attention", reason: "2 tasks need a decision" }, expect: "attention", group: "single" },
        { name: "Failed", line: STATE_LINE, drive: { state: "failed", reason: "error: the vault is locked by another bob run\nsee bob doctor" }, expect: "failed", group: "single" },
      ],
    },
    {
      title: "Labels and sequences",
      rows: [
        { name: "Label · 3 steps", line: "Morning `run[Morning upkeep]: " + LONG_SEQUENCE + "` first.", expect: "ready", group: "labeled" },
        { name: "Label, step 2 of 3", line: "Morning `run[Morning upkeep]: " + LONG_SEQUENCE + "` first.", drive: { state: "running", step: 2 }, expect: "running", group: "labeled" },
        { name: "Literal · 3 steps", line: "`run: " + LONG_SEQUENCE + "`", expect: "ready", group: "literal" },
        { name: "Literal, step 2 of 3", line: "`run: " + LONG_SEQUENCE + "`", drive: { state: "running", step: 2 }, expect: "running", group: "literal" },
        { name: "Literal, failed at 2", line: "`run: " + LONG_SEQUENCE + "`", drive: { state: "failed", step: 2, reason: "error: plan needs a daily note\nstep 3 did not run" }, expect: "failed", group: "literal" },
        { name: "Alias as written", line: "Hooks: `run: bob task-status-hooks`", expect: "ready" },
        { name: "Skips preview", line: "Rename: `run: bob ref rename \"Old title\" \"New title\"`", expect: "ready" },
        { name: "Asks first", line: "Archive: `run: bob task archive`", expect: "ready" },
        { name: "Report", line: "Plan: `run: bob plan`", expect: "ready" },
      ],
    },
    {
      title: "Copy-only, loading, and refusals",
      rows: [
        { name: "Catalog loading", line: STATE_LINE, variant: { catalog: "loading" }, expect: "loading" },
        { name: "Note in ref/", line: STATE_LINE, variant: { sourcePath: "ref/Paper notes.md" }, expect: "copy" },
        { name: "Note in mail/", line: STATE_LINE, variant: { sourcePath: "mail/2026/Thread.md" }, expect: "copy" },
        { name: "Query, unknown source", line: STATE_LINE, variant: { origin: "query", sourcePath: "dash.md" }, expect: "copy" },
        { name: "Mobile", line: STATE_LINE, variant: { mobile: true }, expect: "copy" },
        { name: "Command Mode off", line: STATE_LINE, variant: { engine: false }, expect: "copy" },
        { name: "Other host only", line: "Mac: `run: bob mac-only`", expect: "unavailable" },
        { name: "Excluded command", line: "Capture: `run: bob capture now`", expect: "unavailable" },
        { name: "Shell syntax", line: "Pipe: `run: bob plan | less`", expect: "unavailable" },
      ],
    },
  ],
  mixed: {
    title: "Mixed copy and run chips on one line",
    rows: [
      { line: "Log in with `copy: ssh apollo`, then `run: bob task reconcile` and `run[Plan]: bob plan`; plain `bob plan` stays code.", expect: "ready" },
      { line: "Copy `copy[Prompt]: Summarize today` beside a finished `run: bob task reconcile`.", drive: { state: "completed" }, expect: "completed" },
    ],
  },
  wrap: {
    title: "Wrapping in a narrow column",
    rows: [
      { line: "Before review run `run: " + LONG_SEQUENCE + "` and continue.", drive: { state: "running", step: 2 }, expect: "running" },
      { line: "Or the labeled `run[Weekly review upkeep before the planning session]: " + LONG_SEQUENCE + "` chip.", expect: "ready" },
    ],
  },
  // `bob-run` cards, one per state. Drives add per-step durations the way
  // the engine reports them.
  fences: {
    title: "bob-run sequence cards",
    rows: [
      { name: "Ready", label: "Morning upkeep", text: FENCE_SYNC, expect: "ready" },
      { name: "Unlabeled", text: FENCE_SYNC, expect: "ready" },
      { name: "Armed (⌘↵ target)", label: "Morning upkeep", text: FENCE_SYNC, drive: { armed: true }, expect: "armed" },
      { name: "Queued", label: "Morning upkeep", text: FENCE_SYNC, drive: { state: "queued" }, expect: "queued" },
      { name: "Running, step 2 of 3", label: "Morning upkeep", text: FENCE_SYNC, drive: { state: "running", step: 2 }, expect: "running" },
      { name: "Completed", label: "Morning upkeep", text: FENCE_SYNC, drive: { state: "completed" }, expect: "completed" },
      { name: "Needs attention", label: "Morning upkeep", text: FENCE_SYNC, drive: { state: "attention", at: 2, reason: "2 tasks need a decision" }, expect: "attention" },
      { name: "Failed at step 2", label: "Morning upkeep", text: FENCE_SYNC, drive: { state: "failed", at: 2, reason: "error: ref create needs a unique title\nsee bob ref list" }, expect: "failed" },
      { name: "Asks first", label: "Weekly archive", text: FENCE_ASKS, expect: "ready" },
      { name: "Unavailable here", label: "Mac upkeep", text: FENCE_HOST, expect: "unavailable" },
      { name: "Copy only (ref/)", label: "Morning upkeep", text: FENCE_SYNC, variant: { sourcePath: "ref/Paper notes.md" }, expect: "copy" },
      { name: "Catalog loading", label: "Morning upkeep", text: FENCE_SYNC, variant: { catalog: "loading" }, expect: "loading" },
    ],
  },
  // ⌘↵ cues in Live Preview with the cursor on each row's first line: the
  // armed chip from the real store, and the keycap from the production
  // element builder and binding formatter (Meta+Enter on macOS).
  keymap: {
    title: "⌘↵ target and keycap (cursor on the first line)",
    rows: [
      { name: "Armed line chip", line: "- [ ] Reconcile tasks `run: bob task reconcile` ^rec", drive: { armed: true }, hint: { verb: "Run" }, expect: "armed" },
      { name: "Task fallback", line: "- [ ] Morning upkeep ^up", child: "`run[Morning upkeep]: " + LONG_SEQUENCE + "`", drive: { armed: true }, hint: { verb: "Run", label: "Morning upkeep" }, expect: "armed" },
      { name: "Target running", line: "- [ ] Reconcile tasks `run: bob task reconcile` ^rec", drive: { state: "running" }, hint: { verb: "Output" }, expect: "running" },
      { name: "Two chips: no keycap", line: "- [ ] Both `run: bob task reconcile` and `run[Plan]: bob plan`", expect: "ready" },
    ],
  },
  force: {
    title: "Tooltip on hover, keyboard focus",
    rows: [
      { line: "Hover `run: " + LONG_SEQUENCE + "` mid-run.", drive: { state: "running", step: 2 }, force: "hover", expect: "running" },
      { line: "Focus `run[Reconcile]: bob task reconcile` with Tab.", force: "focus", surface: "live", expect: "ready" },
      { line: "Hover a failed `run: bob task archive`.", drive: { state: "failed", reason: "error: archive found an open Pomodoro\nclose it first" }, force: "hover", expect: "failed" },
    ],
  },
});

function parseArgs(argv) {
  const args = { out: path.join(os.tmpdir(), "bob-command-chips-preview"), selfTest: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--out" || token === "-o") {
      const value = argv[++index];
      if (!value || value.startsWith("-")) throw new Error("--out requires a DIRECTORY");
      args.out = path.resolve(value);
    } else if (token === "--self-test" || token === "-s") args.selfTest = true;
    else if (token === "--help" || token === "-h") args.help = true;
    else throw new Error("Unknown argument: " + token);
  }
  return args;
}

function matrixRows() {
  const rows = [];
  for (const spec of MATRIX.tables) rows.push(...spec.rows);
  rows.push(...MATRIX.mixed.rows, ...MATRIX.wrap.rows, ...MATRIX.force.rows, ...MATRIX.keymap.rows);
  for (const row of MATRIX.keymap.rows) if (row.child) rows.push({ line: row.child, expect: row.expect });
  return rows;
}

function chipsHelpers() {
  return require("./copy-chips-test-helpers.cjs").helpers;
}

// Resolve every run payload with Command Mode's real resolver: once against
// the fixture catalog and once with no catalog yet (loading).
function computeVerdicts() {
  const { helpers: cm } = require("./command-mode-harness.cjs");
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "command-mode-resolve-vectors.json"), "utf8")).catalog;
  const scan = chipsHelpers().chipScanLine;
  const verdicts = { ready: {}, loading: {} };
  for (const row of matrixRows()) {
    for (const chip of scan(row.line)) {
      if (chip.kind !== "run") continue;
      verdicts.ready[chip.text] = cm.cmResolveCommandText(catalog, chip.text, { host: RESOLVE_HOST, catalogStatus: "ready" });
      verdicts.loading[chip.text] = cm.cmResolveCommandText(null, chip.text, { host: RESOLVE_HOST, catalogStatus: "loading" });
    }
  }
  for (const row of MATRIX.fences.rows) {
    verdicts.ready[row.text] = cm.cmResolveCommandText(catalog, row.text, { host: RESOLVE_HOST, catalogStatus: "ready" });
    verdicts.loading[row.text] = cm.cmResolveCommandText(null, row.text, { host: RESOLVE_HOST, catalogStatus: "loading" });
  }
  return JSON.parse(JSON.stringify(verdicts));
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function makeHtml() {
  const main = fs.readFileSync(path.join(chipsRoot, "main.js"), "utf8");
  if (/<\/script/i.test(main)) throw new Error("main.js contains a closing script tag; cannot inline it");
  const template = fs.readFileSync(TEMPLATE, "utf8");
  return template
    .replace("__OBSIDIAN_BASELINE_CSS__", () => BASELINE)
    .replace("__PRODUCTION_CSS__", () => fs.readFileSync(path.join(chipsRoot, "styles.css"), "utf8"))
    .replace("__BOB_CHIPS_MAIN__", () => main)
    .replace("__VERDICTS__", () => safeJson(computeVerdicts()))
    .replace("__MATRIX__", () => safeJson(MATRIX));
}

function findChromium() {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH;
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    const found = spawnSync("which", [name], { encoding: "utf8" });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  const cache = path.join(os.homedir(), ".cache", "ms-playwright");
  if (fs.existsSync(cache)) {
    const builds = fs.readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name)).sort().reverse();
    for (const build of builds) {
      for (const sub of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
        const candidate = path.join(cache, build, sub);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  throw new Error("Could not find Chromium. Set CHROMIUM_PATH to a browser executable.");
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

async function waitForFile(file, child, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(file)) return;
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("Chromium exited before publishing its DevTools port (exit " + child.exitCode + ").");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for Chromium's DevTools port file.");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Hover the hover cases and keyboard-focus the focus case, through
// DevTools' forced pseudo-classes, then freeze every animation.
async function forceStates(client) {
  const { root } = await client.call("DOM.getDocument", { depth: -1 });
  for (const [selector, classes] of [
    [".preview-force-hover > .bob-run-chip", ["hover"]],
    [".preview-force-focus > .bob-run-chip", ["focus", "focus-visible"]],
  ]) {
    const { nodeIds } = await client.call("DOM.querySelectorAll", { nodeId: root.nodeId, selector });
    for (const nodeId of nodeIds) await client.call("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: classes });
  }
  await sleep(60);
  return client.evaluate("window.commandChipsPreview.settleAnimations()");
}

async function render(client, theme, options = {}) {
  const mounted = await client.evaluate("window.commandChipsPreview.render(" + safeJson(theme) + ")");
  await client.evaluate("document.fonts && document.fonts.ready");
  await client.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  if (options.force !== false) await forceStates(client);
  return mounted;
}

// The whole page, or only `selector`'s box (plus a small margin).
async function capture(client, output, selector) {
  await client.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  let clip;
  if (selector) {
    const box = await client.evaluate("(() => { const r = document.querySelector(" + JSON.stringify(selector) + ").getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }; })()");
    clip = { x: Math.max(0, Math.floor(box.x) - 12), y: Math.max(0, Math.floor(box.y) - 12), width: Math.ceil(box.width) + 24, height: Math.ceil(box.height) + 24, scale: 1 };
  } else {
    const metrics = await client.call("Page.getLayoutMetrics");
    clip = { x: 0, y: 0, width: Math.ceil(metrics.cssContentSize.width), height: Math.ceil(metrics.cssContentSize.height), scale: 1 };
  }
  const screenshot = await client.call("Page.captureScreenshot", {
    format: "png", fromSurface: true, captureBeyondViewport: true, clip,
  });
  fs.writeFileSync(output, Buffer.from(screenshot.data, "base64"));
  return output;
}

function expectationFailures(mounted) {
  // The page reports faces in render order; rows render a Live Preview and
  // a Reading copy in tables and in the mixed/wrap pairs.
  const expected = [];
  const runCount = (line) => chipsHelpers().chipScanLine(line).filter((chip) => chip.kind === "run").length;
  const push = (row, times) => {
    for (let n = 0; n < times; n += 1) for (let k = 0; k < runCount(row.line); k += 1) expected.push(row);
  };
  for (const spec of MATRIX.tables) for (const row of spec.rows) push(row, 2);
  for (let pass = 0; pass < 2; pass += 1) for (const row of MATRIX.mixed.rows) push(row, 1);
  for (let pass = 0; pass < 2; pass += 1) for (const row of MATRIX.wrap.rows) push(row, 1);
  for (const row of MATRIX.force.rows) push(row, 1);
  for (const row of MATRIX.keymap.rows) {
    push(row, 1);
    if (row.child) push({ ...row, line: row.child }, 1);
  }
  const failures = [];
  if (expected.length !== mounted.length) failures.push("rendered " + mounted.length + " run chips, expected " + expected.length);
  for (let index = 0; index < Math.min(expected.length, mounted.length); index += 1) {
    const row = expected[index];
    const want = row.expect;
    // A row with two run chips drives only the first; others stay ready.
    if (mounted[index].face !== want && !(mounted[index].face === "ready" && runCount(row.line) > 1)) {
      failures.push((row.name || row.line.slice(0, 40)) + ": face " + mounted[index].face + ", expected " + want);
    }
  }
  return failures;
}

let cachedHtml = null;
function html0() {
  if (cachedHtml === null) cachedHtml = makeHtml();
  return cachedHtml;
}

function selfTest() {
  const helpers = chipsHelpers();
  const faces = new Set(matrixRows().map((row) => row.expect));
  for (const face of helpers.COMMAND_CHIP_FACES) assert.ok(faces.has(face), "matrix covers face " + face);
  const verdicts = computeVerdicts();
  const states = (text) => verdicts.ready[text] && verdicts.ready[text].state;
  assert.equal(states("bob task reconcile"), "ready");
  assert.equal(states(LONG_SEQUENCE), "ready");
  assert.equal(verdicts.ready[LONG_SEQUENCE].steps.length, 3, "quoted && stays inside one step");
  assert.equal(verdicts.ready["bob task-status-hooks"].steps[0].text, "bob task-status-hooks", "alias keeps its written text");
  assert.equal(states("bob mac-only"), "unavailable");
  assert.equal(states("bob capture now"), "invalid");
  assert.equal(states("bob plan | less"), "invalid");
  // Syntax faults refuse even before the catalog arrives; the rest wait.
  assert.equal(verdicts.loading["bob task reconcile"].state, "loading");
  assert.equal(verdicts.loading["bob plan | less"].state, "invalid");
  const fenceFaces = new Set(MATRIX.fences.rows.map((row) => row.expect));
  for (const face of helpers.COMMAND_CHIP_FACES) assert.ok(fenceFaces.has(face), "fence matrix covers face " + face);
  assert.equal(states(FENCE_SYNC), "ready");
  assert.equal(verdicts.ready[FENCE_SYNC].steps.length, 3, "one fence step per line");
  assert.deepEqual(verdicts.ready[FENCE_SYNC].steps.map((step) => step.effect), ["writes", "writes", "syncs"]);
  assert.equal(verdicts.ready[FENCE_ASKS].steps[1].policy, "confirm");
  assert.equal(states(FENCE_HOST), "unavailable");
  assert.equal(verdicts.ready[FENCE_HOST].step, 2);
  assert.match(html0(), /commandFenceBuild/);
  const html = html0();
  assert.doesNotMatch(html, /__[A-Z_]+__/, "every template placeholder is filled");
  assert.match(html, /\.bob-run-fence\.is-running/);
  assert.match(html, /commandChipBuildInline/);
  assert.match(html, /\.bob-run-chip\.is-running/);
  assert.match(html, /\.bob-run-chip-hint \{/, "the keycap style ships in styles.css");
  assert.ok(MATRIX.keymap.rows.some((row) => row.hint && row.hint.label) && MATRIX.keymap.rows.some((row) => !row.hint), "keymap rows cover a named fallback and a refused line");
  assert.deepEqual(parseArgs(["--out", "/tmp/x", "--self-test"]), { out: "/tmp/x", selfTest: true, help: false });
  assert.throws(() => parseArgs(["--out"]));
  assert.throws(() => parseArgs(["--wat"]));
  console.log("offline self-test complete (no browser; not a visual pass)");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }
  if (args.selfTest) {
    selfTest();
    return;
  }
  fs.mkdirSync(args.out, { recursive: true });
  const htmlFile = path.join(args.out, "index.html");
  fs.writeFileSync(htmlFile, makeHtml());
  const chromium = findChromium();
  // Keep Chromium's UNIX-domain singleton socket under the short /tmp prefix.
  const profile = fs.mkdtempSync(path.join("/tmp", "bob-run-chip-preview-"));
  const child = spawn(chromium, [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--force-color-profile=srgb",
    "--remote-debugging-port=0", "--user-data-dir=" + profile, "about:blank",
  ], { stdio: "ignore", env: { ...process.env, TMPDIR: "/tmp" } });
  let client = null;
  try {
    const portFile = path.join(profile, "DevToolsActivePort");
    await waitForFile(portFile, child);
    const port = fs.readFileSync(portFile, "utf8").split(/\s+/)[0];
    const pages = await fetch("http://127.0.0.1:" + port + "/json/list").then((response) => response.json());
    const page = pages.find((item) => item.type === "page");
    if (!page) throw new Error("Chromium did not publish a DevTools page.");
    client = await CdpClient.connect(page.webSocketDebuggerUrl);
    await client.call("Page.enable");
    await client.call("Runtime.enable");
    await client.call("DOM.enable");
    await client.call("CSS.enable");
    const wide = { width: 1040, height: 1400, deviceScaleFactor: 1, mobile: false };
    await client.call("Emulation.setDeviceMetricsOverride", wide);
    await client.call("Page.navigate", { url: pathToFileURL(htmlFile).href });
    const start = Date.now();
    while (Date.now() - start < 15000) {
      if (await client.evaluate("Boolean(window.commandChipsPreviewReady)")) break;
      await sleep(50);
    }
    const screenshots = [];
    const report = { checks: null, motion: null, reducedMotion: null, print: null, expectations: [] };
    for (const theme of ["light", "dark"]) {
      await render(client, theme);
      if (theme === "light") report.checks = await client.evaluate("window.commandChipsPreview.checks()");
      screenshots.push(await capture(client, path.join(args.out, "command-chips-" + theme + ".png")));
      screenshots.push(await capture(client, path.join(args.out, "command-fences-" + theme + ".png"), "#preview-fences"));
    }
    const mountedFaces = await client.evaluate("Array.from(document.querySelectorAll('.bob-run-chip')).map((el) => ({ face: ['ready','armed','loading','queued','running','completed','attention','failed','unavailable','copy'].find((name) => el.classList.contains('is-' + name)) || null }))");
    report.expectations = expectationFailures(mountedFaces);
    const fenceFaces = await client.evaluate("Array.from(document.querySelectorAll('.bob-run-fence')).map((el) => ['ready','armed','loading','queued','running','completed','attention','failed','unavailable','copy'].find((name) => el.classList.contains('is-' + name)) || null)");
    if (fenceFaces.length !== MATRIX.fences.rows.length) report.expectations.push("rendered " + fenceFaces.length + " fence cards, expected " + MATRIX.fences.rows.length);
    MATRIX.fences.rows.forEach((row, index) => {
      if (fenceFaces[index] !== row.expect) report.expectations.push("fence " + row.name + ": face " + fenceFaces[index] + ", expected " + row.expect);
    });
    report.motion = await client.evaluate("window.commandChipsPreview.motionCheck()");
    await client.call("Emulation.setDeviceMetricsOverride", { ...wide, width: 390 });
    await render(client, "light");
    screenshots.push(await capture(client, path.join(args.out, "command-chips-narrow-light.png")));
    await client.call("Emulation.setDeviceMetricsOverride", wide);
    await client.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await render(client, "dark");
    report.reducedMotion = await client.evaluate("window.commandChipsPreview.motionCheck()");
    screenshots.push(await capture(client, path.join(args.out, "command-chips-reduced-motion-dark.png")));
    await client.call("Emulation.setEmulatedMedia", { media: "print", features: [] });
    await render(client, "light", { force: false });
    report.print = await client.evaluate("window.commandChipsPreview.printCheck()");
    screenshots.push(await capture(client, path.join(args.out, "command-chips-print.png")));
    await client.call("Emulation.setEmulatedMedia", { media: "", features: [] });

    const failures = [...(report.checks ? report.checks.failures : ["checks did not run"]), ...report.expectations];
    if (!(report.motion && report.motion.spin > 0 && report.motion.pulse > 0)) failures.push("normal motion shows no spinner or pulse");
    if (!(report.reducedMotion && report.reducedMotion.spin === 0 && report.reducedMotion.pulse === 0)) failures.push("reduced motion still animates: " + JSON.stringify(report.reducedMotion));
    if (!report.print || !report.print.chips) failures.push("print check found no chips");
    if (!report.print || !report.print.fences) failures.push("print check found no fence cards");
    else for (const failure of report.print.failures) failures.push("print: " + failure);
    const geometry = report.checks ? report.checks.geometry : [];
    fs.writeFileSync(path.join(args.out, "checks.json"), JSON.stringify({ ...report, failures }, null, 2));
    fs.writeFileSync(path.join(args.out, "matrix-report.md"), [
      "# Bob command chips preview",
      "",
      "Rendered from the built `plugins/bob-chips/main.js` (chipScanLine, copyChipBuildInline, commandChipBuildInline, commandFenceBuild, CommandChipRunStore, commandChipPaintModel, commandChipPaint, commandFencePaint) and `styles.css` under an Obsidian baseline stylesheet. Verdicts come from Command Mode's resolver against `scripts/fixtures/command-mode-resolve-vectors.json`.",
      "",
      "Cases: every face (ready, armed, loading, queued, running, completed, attention, failed, unavailable, copy) as a Live Preview span and a Reading button, and as a `bob-run` sequence card (labeled and unlabeled, running at step 2 of 3, failed at step 2 with ✓/✗/– marks and an Output link, needs attention, asks first, unavailable on this host, copy-only in ref/, loading); labeled and literal three-step sequences at rest, at step 2 of 3, and failed at step 2; alias, skipped-preview, confirm, and report policy lines; copy-only for ref/, mail/, unknown query source, mobile, and Command Mode off; host, excluded, and shell refusals; mixed copy/run lines; wrapping in a 240px column and a 390px viewport; hover tooltips and keyboard focus; the ⌘↵ armed chip and end-of-line keycap (line chip, task fallback naming its label, Output while running, none on an ambiguous line); reduced motion; print.",
      "",
      "Checks: " + (failures.length ? "FAILED" : "passed") + " — " + (report.checks ? report.checks.mounted : 0) + " faces, " + (report.checks ? report.checks.attributesChecked : 0) + " attributes free of payload text, ARIA names, run-state geometry " + geometry.map((entry) => entry.group + " Δw " + entry.widthDelta.toFixed(2) + " Δh " + entry.heightDelta.toFixed(2)).join("; ") + ", reduced motion " + JSON.stringify(report.reducedMotion) + ", print " + (report.print ? report.print.chips + " faces, " + report.print.failures.length + " failures" : "not run") + ".",
      ...failures.map((failure) => "- FAIL " + failure),
      "",
      ...screenshots.map((file) => "- " + path.basename(file)),
      "",
    ].join("\n"));
    console.log(JSON.stringify({ output: args.out, html: htmlFile, chromium, screenshots, failures }, null, 2));
    if (failures.length) process.exitCode = 1;
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

if (require.main === module) {
  main().catch((error) => { console.error(error && error.stack || error); process.exitCode = 1; });
}

module.exports = { MATRIX, parseArgs, computeVerdicts, makeHtml };
