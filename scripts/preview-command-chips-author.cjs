#!/usr/bin/env node
// Capture the make-or-edit card (Mod+Shift+Y) in Chromium from the built
// bob-chips main.js and styles.css: the production CopyChipAuthorModal,
// copyChipAuthorResolve, Run validation, and preview builders. Every
// verdict the card asks for comes from Command Mode's own resolver, run in
// Node against the shared fixture catalog by replaying the card's own
// calls. Only the page around the cards, a minimal Obsidian `.modal`
// baseline, and the Lucide icon shim (shared with preview-command-chips)
// are scaffolding.
//   node scripts/preview-command-chips-author.cjs [--out DIR] [--self-test]
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const chipsPreview = require("./preview-command-chips.cjs");

const repoRoot = path.resolve(__dirname, "..");
const chipsRoot = path.join(repoRoot, "plugins", "bob-chips");
const CHIPS_TEMPLATE = path.join(__dirname, "preview-command-chips.template.html");
const RESOLVE_HOST = "athena";
const SEQUENCE = "bob task reconcile && bob ref rename \"Old title\" \"New title\" && bob task archive";

const HELP = [
  "Usage: node scripts/preview-command-chips-author.cjs [--out DIRECTORY] [--self-test]",
  "",
  "Render the make-or-edit card in both kinds and every Run validation state,",
  "in light and dark. Set CHROMIUM_PATH when no Chrome/Chromium is on PATH.",
].join("\n");

// Each case opens the production card on `source` at `cursor` (a needle;
// the cursor sits just inside it) or over `select` (a needle to select),
// with an optional clipboard prefill, then types `label`. `expect` is what
// the card must report.
const CASES = Object.freeze([
  {
    name: "Copy · from a selection",
    source: "Log in with ssh apollo first.",
    select: "ssh apollo",
    label: "SSH",
    expect: { kind: "copy", valid: true, warning: false, addBob: false, preview: "inline" },
  },
  {
    name: "Run · converted code span",
    source: "- [ ] Run `bob task reconcile` daily",
    cursor: "bob task",
    expect: { kind: "run", valid: true, warning: false, addBob: false, preview: "inline" },
  },
  {
    name: "Run · labeled sequence",
    source: "",
    clipboard: SEQUENCE,
    label: "Weekly upkeep",
    expect: { kind: "run", valid: true, warning: false, addBob: false, preview: "inline" },
  },
  {
    name: "Run · Add bob offered",
    source: "Run `task reconcile && plan` now",
    cursor: "task",
    expect: { kind: "run", valid: false, warning: false, addBob: true, preview: "inline" },
  },
  {
    name: "Run · other host warns",
    source: "",
    clipboard: "bob mac-only",
    expect: { kind: "run", valid: true, warning: true, addBob: false, preview: "inline" },
  },
  {
    name: "Run · refused step blocks Save",
    source: "Pipe: `run: bob task reconcile && bob plan | less`",
    cursor: "run:",
    expect: { kind: "run", valid: false, warning: false, addBob: false, preview: "inline" },
  },
  {
    name: "Run · bob-run fence",
    source: "```bob-run Morning upkeep\nbob task reconcile\nbob plan\n```",
    cursor: "bob plan",
    expect: { kind: "run", valid: true, warning: false, addBob: false, preview: "block" },
  },
  {
    name: "Run · no Command Mode",
    source: "Then `run: bob task reconcile`.",
    cursor: "run:",
    engine: false,
    expect: { kind: "run", valid: true, warning: true, addBob: false, preview: "inline" },
  },
]);

function parseArgs(argv) {
  const args = { out: path.join(os.tmpdir(), "bob-command-chips-author-preview"), selfTest: false, help: false };
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

function chipsHelpers() {
  return require("./copy-chips-test-helpers.cjs").helpers;
}

function selectionOf(spec) {
  if (spec.select) {
    const from = spec.source.indexOf(spec.select);
    if (from < 0) throw new Error(spec.name + ": missing " + spec.select);
    return { from, to: from + spec.select.length };
  }
  if (spec.cursor) {
    const at = spec.source.indexOf(spec.cursor);
    if (at < 0) throw new Error(spec.name + ": missing " + spec.cursor);
    return { from: at + 1, to: at + 1 };
  }
  return { from: spec.source.length, to: spec.source.length };
}

// Replay every resolve the card makes for each case through Command Mode's
// real resolver, recording text → verdict for the page.
function computeVerdicts() {
  const { helpers: cm } = require("./command-mode-harness.cjs");
  const H = chipsHelpers();
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "command-mode-resolve-vectors.json"), "utf8")).catalog;
  const verdicts = {};
  const resolve = (text) => {
    const verdict = cm.cmResolveCommandText(catalog, String(text), { host: RESOLVE_HOST, catalogStatus: "ready" });
    verdicts[String(text)] = verdict;
    return verdict;
  };
  const results = [];
  for (const spec of CASES) {
    const live = spec.engine === false ? null : resolve;
    const resolved = H.copyChipAuthorResolve({
      source: spec.source,
      selections: [selectionOf(spec)],
      clipboardText: spec.clipboard || "",
      resolveCommand: live,
    });
    assert.ok(resolved.ok, spec.name + ": " + resolved.reason);
    const snap = resolved.snapshot;
    const kind = spec.engine === false ? "run" : snap.kind;
    const draft = H.copyChipAuthorDraftState(snap, spec.label || snap.label, snap.text, {
      kind,
      resolve: live,
      uncheckedReason: H.RUN_CHIP_AUTHOR_UNCHECKED,
    });
    if (live && kind === "run") resolve(String(snap.text).replace(/\r\n?/g, "\n"));
    if (live && draft.addBob) resolve(draft.addBob.text);
    results.push({ name: spec.name, kind, draft });
  }
  return { verdicts: JSON.parse(JSON.stringify(verdicts)), results };
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

// The theme variables and the Lucide icon shim, shared with the command
// chips preview so both pages paint the same palette and glyphs.
function sharedScaffolding() {
  const template = fs.readFileSync(CHIPS_TEMPLATE, "utf8");
  const light = /body\[data-theme="light"\] \{[^}]*\}/.exec(template);
  const dark = /body\[data-theme="dark"\] \{[^}]*\}/.exec(template);
  const shimStart = template.indexOf("const PREVIEW_ICONS = {");
  const shimEnd = template.indexOf("window.BobChipsModule");
  if (!light || !dark || shimStart < 0 || shimEnd < shimStart) throw new Error("preview-command-chips.template.html changed shape");
  const icons = template.slice(shimStart, shimEnd).replace(/const PREVIEW_OBSIDIAN = \{[\s\S]*$/, "");
  return { themes: light[0] + "\n" + dark[0], icons };
}

const PAGE_CSS = [
  ":root { --input-height: 30px; --radius-s: 4px; --radius-m: 8px; --font-ui-smaller: 12px;",
  "  --font-interface: Inter, ui-sans-serif, sans-serif; --font-text: Inter, ui-sans-serif, sans-serif; --font-monospace: ui-monospace, 'DejaVu Sans Mono', monospace; }",
  "button { display:inline-flex; align-items:center; justify-content:center; height:var(--input-height); padding:4px 12px; border:1px solid var(--background-modifier-border); border-radius:5px; background:var(--interactive-normal); color:var(--text-normal); font:500 13px var(--font-interface); white-space:nowrap; cursor:pointer; }",
  "input, textarea { font:14px var(--font-text); }",
  // Obsidian's modal frame, minimally.
  ".modal { position:relative; box-sizing:border-box; background:var(--background-primary); border:1px solid var(--background-modifier-border); border-radius:12px; box-shadow:var(--shadow-l); color:var(--text-normal); font:14px/1.5 var(--font-interface); }",
  ".modal-content { padding:0; }",
  "body { margin:0; padding:24px; background:var(--background-secondary); color:var(--text-normal); }",
  ".preview-grid { display:grid; grid-template-columns:repeat(2, 640px); gap:22px 24px; align-items:start; }",
  ".preview-case h2 { margin:0 0 6px; color:var(--text-muted); font:650 10px var(--font-interface); letter-spacing:.08em; text-transform:uppercase; }",
  ".preview-case .modal { width:640px; max-width:640px; }",
].join("\n");

const PAGE_SCRIPT = `
const H = window.BobChipsModule.helpers;
const NO_VERDICT = { ok: false, state: "invalid", signature: null, steps: [], reason: "preview has no verdict for this text", step: null };
window.previewMisses = [];
function previewResolve(text) {
  const verdict = window.PREVIEW_VERDICTS[String(text)];
  if (!verdict) window.previewMisses.push(String(text));
  return verdict || NO_VERDICT;
}
function selectionOf(spec) {
  if (spec.select) { const from = spec.source.indexOf(spec.select); return { from, to: from + spec.select.length }; }
  if (spec.cursor) { const at = spec.source.indexOf(spec.cursor); return { from: at + 1, to: at + 1 }; }
  return { from: spec.source.length, to: spec.source.length };
}
function renderAll(theme) {
  document.body.dataset.theme = theme;
  window.previewMisses = [];
  const grid = document.getElementById("grid");
  grid.replaceChildren();
  const report = [];
  for (const spec of window.PREVIEW_CASES) {
    const live = spec.engine === false ? null : previewResolve;
    const snap = H.copyChipAuthorResolve({ source: spec.source, selections: [selectionOf(spec)], clipboardText: spec.clipboard || "", resolveCommand: live }).snapshot;
    const cell = document.createElement("section");
    cell.className = "preview-case";
    const title = document.createElement("h2");
    title.textContent = spec.name;
    cell.appendChild(title);
    const modalEl = document.createElement("div");
    modalEl.className = "modal";
    const contentEl = document.createElement("div");
    contentEl.className = "modal-content";
    modalEl.appendChild(contentEl);
    cell.appendChild(modalEl);
    grid.appendChild(cell);
    const plugin = { app: null, copyChipAuthorModal: null, commandChipRunHotkey: null };
    const modal = new H.CopyChipAuthorModal(null, {
      plugin,
      snapshot: snap,
      engine: () => (live ? { resolve: live, reason: null } : { resolve: null, reason: H.RUN_CHIP_AUTHOR_UNCHECKED }),
    });
    modal.modalEl = modalEl;
    modal.contentEl = contentEl;
    modal.open();
    if (spec.engine === false) modal.copyChipSetKind("run", { user: true });
    if (spec.label) {
      modal.labelEl.value = spec.label;
      modal.labelEl.dispatchEvent(new Event("input"));
    }
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    const draft = modal.copyChipLastDraft;
    const attrs = [];
    for (const el of [modalEl, ...modalEl.querySelectorAll("*")]) {
      // The Command field's fixed placeholder is not payload.
      for (const attr of Array.from(el.attributes || [])) if (attr.name !== "placeholder") attrs.push(attr.value);
    }
    const payloadInAttrs = attrs.some((value) => draft.text.length > 3 && value.includes(draft.text));
    const box = modalEl.getBoundingClientRect();
    const overflow = Array.from(modalEl.querySelectorAll("*")).filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.right > box.right + 0.5 || r.left < box.left - 0.5);
    }).map((el) => el.className && el.className.baseVal === undefined ? el.className : "svg");
    report.push({
      name: spec.name,
      kind: draft.kind,
      valid: draft.valid,
      warning: Boolean(draft.warning),
      addBob: Boolean(draft.addBob) && !modal.addBobEl.classList.contains("is-hidden"),
      preview: modal.previewHost.querySelector(".bob-run-fence, .bob-copy-fence") ? "block" : (modal.previewHost.firstChild ? "inline" : null),
      title: modal.titleEl.textContent,
      status: modal.statusEl.textContent,
      steps: modal.stepsEl.children.length,
      payloadInAttrs,
      overflow,
    });
  }
  return { report, misses: window.previewMisses.slice() };
}
window.authorPreview = { renderAll };
window.authorPreviewReady = true;
`;

function makeHtml() {
  const main = fs.readFileSync(path.join(chipsRoot, "main.js"), "utf8");
  if (/<\/script/i.test(main)) throw new Error("main.js contains a closing script tag; cannot inline it");
  const shared = sharedScaffolding();
  const { verdicts } = computeVerdicts();
  return [
    "<!doctype html>",
    "<html lang=\"en\"><head><meta charset=\"utf-8\"><title>Bob make-or-edit card preview</title>",
    "<style>",
    PAGE_CSS,
    shared.themes,
    fs.readFileSync(path.join(chipsRoot, "styles.css"), "utf8"),
    "</style></head>",
    "<body data-theme=\"light\"><main id=\"grid\" class=\"preview-grid\"></main>",
    "<script>",
    shared.icons,
    "const PREVIEW_OBSIDIAN = { setIcon(el, name) { el.replaceChildren(); const svg = previewIconSvg(name); if (svg) el.appendChild(svg); }, getIcon(name) { return previewIconSvg(name); }, Platform: { isMobile: false, isMobileApp: false } };",
    "window.BobChipsModule = (function loadBuiltPlugin() {",
    "  const module = { exports: {} };",
    "  const exports = module.exports;",
    "  const require = (name) => { if (name === \"obsidian\") return PREVIEW_OBSIDIAN; throw new Error(\"not available in the preview: \" + name); };",
    "  (function () {",
    main,
    "  })();",
    "  return module.exports;",
    "})();",
    "window.PREVIEW_VERDICTS = " + safeJson(verdicts) + ";",
    "window.PREVIEW_CASES = " + safeJson(CASES) + ";",
    "</script>",
    "<script>",
    PAGE_SCRIPT,
    "</script>",
    "</body></html>",
  ].join("\n");
}

function expectationFailures(report) {
  const failures = [];
  if (report.misses.length) failures.push("verdicts missing for: " + JSON.stringify(report.misses));
  if (report.report.length !== CASES.length) failures.push("rendered " + report.report.length + " cards, expected " + CASES.length);
  CASES.forEach((spec, index) => {
    const got = report.report[index];
    if (!got) return;
    for (const field of ["kind", "valid", "warning", "addBob", "preview"]) {
      if (got[field] !== spec.expect[field]) failures.push(spec.name + ": " + field + " " + JSON.stringify(got[field]) + ", expected " + JSON.stringify(spec.expect[field]));
    }
    const wantTitle = spec.expect.kind === "run" ? "COMMAND CHIP" : "COPY CHIP";
    if (got.title !== wantTitle) failures.push(spec.name + ": title " + got.title);
    if (spec.expect.kind === "run" && got.steps < 1) failures.push(spec.name + ": no step rows");
    if (got.payloadInAttrs) failures.push(spec.name + ": payload leaked into an attribute");
    if (got.overflow.length) failures.push(spec.name + ": content overflows the card: " + got.overflow.slice(0, 4).join(", "));
  });
  return failures;
}

function selfTest() {
  const H = chipsHelpers();
  const { verdicts, results } = computeVerdicts();
  CASES.forEach((spec, index) => {
    const got = results[index];
    assert.equal(got.kind, spec.expect.kind, spec.name + " kind");
    assert.equal(got.draft.valid, spec.expect.valid, spec.name + " valid");
    assert.equal(Boolean(got.draft.warning), spec.expect.warning, spec.name + " warning");
    assert.equal(Boolean(got.draft.addBob), spec.expect.addBob, spec.name + " addBob");
    assert.equal(got.draft.previewKind, spec.expect.preview, spec.name + " preview");
  });
  assert.equal(verdicts["bob task reconcile"].state, "ready");
  assert.equal(verdicts["bob mac-only"].state, "unavailable");
  assert.equal(verdicts["bob task reconcile && bob plan"].state, "ready");
  const html = makeHtml();
  assert.match(html, /CopyChipAuthorModal/);
  assert.match(html, /\.bob-copy-author-kind-option/);
  assert.match(html, /PREVIEW_ICONS/);
  assert.doesNotMatch(html, /__[A-Z_]+__/);
  assert.ok(H.RUN_CHIP_AUTHOR_UNCHECKED);
  assert.deepEqual(parseArgs(["--out", "/tmp/x", "--self-test"]), { out: "/tmp/x", selfTest: true, help: false });
  assert.throws(() => parseArgs(["--wat"]));
  console.log("offline self-test complete (no browser; not a visual pass)");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  const htmlFile = path.join(args.out, "author.html");
  fs.writeFileSync(htmlFile, makeHtml());
  const chromium = chipsPreview.findChromium();
  const profile = fs.mkdtempSync(path.join("/tmp", "bob-author-preview-"));
  const child = spawn(chromium, [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--force-color-profile=srgb",
    "--remote-debugging-port=0", "--user-data-dir=" + profile, "about:blank",
  ], { stdio: "ignore", env: { ...process.env, TMPDIR: "/tmp" } });
  let client = null;
  try {
    const portFile = path.join(profile, "DevToolsActivePort");
    await chipsPreview.waitForFile(portFile, child);
    const port = fs.readFileSync(portFile, "utf8").split(/\s+/)[0];
    const pages = await fetch("http://127.0.0.1:" + port + "/json/list").then((response) => response.json());
    const page = pages.find((item) => item.type === "page");
    if (!page) throw new Error("Chromium did not publish a DevTools page.");
    client = await chipsPreview.CdpClient.connect(page.webSocketDebuggerUrl);
    await client.call("Page.enable");
    await client.call("Runtime.enable");
    await client.call("Emulation.setDeviceMetricsOverride", { width: 1400, height: 1600, deviceScaleFactor: 1, mobile: false });
    await client.call("Page.navigate", { url: pathToFileURL(htmlFile).href });
    const start = Date.now();
    while (Date.now() - start < 15000) {
      if (await client.evaluate("Boolean(window.authorPreviewReady)")) break;
      await sleep(50);
    }
    const screenshots = [];
    const failures = [];
    for (const theme of ["light", "dark"]) {
      const report = await client.evaluate("window.authorPreview.renderAll(" + JSON.stringify(theme) + ")");
      await client.evaluate("document.fonts && document.fonts.ready");
      await client.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
      if (theme === "light") failures.push(...expectationFailures(report));
      const metrics = await client.call("Page.getLayoutMetrics");
      const clip = { x: 0, y: 0, width: Math.ceil(metrics.cssContentSize.width), height: Math.ceil(metrics.cssContentSize.height), scale: 1 };
      const shot = await client.call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: true, clip });
      const file = path.join(args.out, "command-chips-author-" + theme + ".png");
      fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
      screenshots.push(file);
      if (theme === "light") fs.writeFileSync(path.join(args.out, "author-report.json"), JSON.stringify({ ...report, failures }, null, 2));
    }
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

module.exports = { CASES, parseArgs, computeVerdicts, makeHtml };
