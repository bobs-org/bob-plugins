#!/usr/bin/env node
"use strict";

// Property-card identity kit preview matrix (bob-cli-o6 identity-kit). Builds
// every species' title block and rail with the real kit builders, renders
// them in Obsidian's Electron through CDP, and asserts one aria-level=1 per
// card, kicker species-word contrast >= 4.5:1, and stripe contrast >= 3:1 in
// light and dark. Also captures 375px, grayscale (identical titles), and
// forced-colors passes, and writes PNGs, report.json, and index.html.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const {
  PAGE_CHROME, previewDocument, escapeHtml, serialize,
  CdpClient, freePort, cdpTarget, sleep, sha256,
} = require("./preview-property-cards.cjs");

const ROOT = path.resolve(__dirname, "..");
const PLUGIN_CSS = path.join(ROOT, "plugins/bob-ledger-tools/styles.css");
const DEFAULT_OBSIDIAN = "/snap/obsidian/current/app/obsidian";
const HELP = [
  "Usage: node scripts/preview-title-block.cjs [OPTIONS]",
  "",
  "Render the property-card identity kit (title block and rail) for every",
  "species in Obsidian, light and dark at 1280px and 375px, plus grayscale",
  "and forced-colors passes. Fails when an in-browser assertion fails.",
  "Run under xvfb-run -a on Linux.",
  "",
  "Options:",
  "  -e, --executable PATH   Obsidian Electron binary",
  "  -o, --out DIRECTORY     Save screenshots, report.json, and index.html",
  "  -h, --help              Print this help",
].join("\n");

function parseArgs(argv) {
  const args = { executable: DEFAULT_OBSIDIAN, out: null, help: false };
  const list = Array.isArray(argv) ? argv : [];
  for (let index = 0; index < list.length; index += 1) {
    const value = list[index];
    if (["-h", "--help"].includes(value)) { args.help = true; continue; }
    const key = ["-e", "--executable"].includes(value) ? "executable"
      : ["-o", "--out"].includes(value) ? "out" : null;
    if (!key) throw new Error(`Unknown argument: ${value}`);
    const next = list[index + 1];
    if (next === undefined || next.startsWith("-")) throw new Error(`${value} requires a value`);
    args[key] = next;
    index += 1;
  }
  return args;
}

// Obsidian's setIcon is unavailable offline; emulate it with Lucide paths so
// icon tiles render in the captures.
const ICON_SHAPES = {
  library: [["path", { d: "m16 6 4 14" }], ["path", { d: "M12 6v14" }], ["path", { d: "M8 8v12" }], ["path", { d: "M4 4v16" }]],
  "file-text": [
    ["path", { d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" }], ["path", { d: "M14 2v4a2 2 0 0 0 2 2h4" }],
    ["path", { d: "M10 9H8" }], ["path", { d: "M16 13H8" }], ["path", { d: "M16 17H8" }],
  ],
  landmark: [
    ["line", { x1: "3", x2: "21", y1: "22", y2: "22" }], ["line", { x1: "6", x2: "6", y1: "18", y2: "11" }],
    ["line", { x1: "10", x2: "10", y1: "18", y2: "11" }], ["line", { x1: "14", x2: "14", y1: "18", y2: "11" }],
    ["line", { x1: "18", x2: "18", y1: "18", y2: "11" }], ["polygon", { points: "12 2 20 7 4 7" }],
  ],
};

function emulateIcons(doc, root) {
  for (const glyph of root.querySelectorAll(".bob-property-card-tile-glyph")) {
    const shapes = ICON_SHAPES[glyph.getAttribute("data-icon")];
    if (!shapes || glyph.children.length) continue;
    const svg = doc.createElement("svg");
    const attrs = {
      xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
      "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", class: "svg-icon",
    };
    for (const [name, value] of Object.entries(attrs)) svg.setAttribute(name, value);
    for (const [tag, shapeAttrs] of shapes) {
      const shape = doc.createElement(tag);
      for (const [name, value] of Object.entries(shapeAttrs)) shape.setAttribute(name, value);
      svg.appendChild(shape);
    }
    glyph.appendChild(svg);
  }
}

function button(doc, text, label) {
  const node = doc.createElement("button");
  node.setAttribute("class", "bob-preview-action");
  node.setAttribute("type", "button");
  if (label) node.setAttribute("aria-label", label);
  node.appendChild(doc.createTextNode(text));
  return node;
}

function body(doc, text) {
  const node = doc.createElement("div");
  node.setAttribute("class", "bob-preview-body");
  node.appendChild(doc.createTextNode(text));
  return node;
}

function dayChips(current) {
  return ["Mon 16", "Tue 17", "Wed 18", "Thu 19", "Fri 20", "Sat 21", "Sun 22"].map((label, index) => ({
    label, target: `2026/202611${16 + index}`, current: label === current,
  }));
}

function weekChips(current) {
  const chips = [];
  for (let week = 40; week <= 53; week += 1) {
    chips.push({ label: `W${week}`, target: `2026/2026-W${week}`, current: week === current, unresolved: week > 48 });
  }
  return chips;
}

// Fixture specs. `title` may be overridden for the grayscale pass.
function caseSpecs() {
  return [
    {
      name: "album", kind: "album", hue: "orange", title: "Restaurants",
      tile: { emoji: "🍽" }, kicker: [{ text: "Body", target: "body" }],
      subtitle: "Restaurants Kelly and I have tried, liked, or want to try.",
      actions: [["＋ Restaurant", "New restaurant"], ["⊞", "Edit schema"]],
      body: "▸ Schema · 5 fields · grouped by Location · dated notes · 104 restaurants",
    },
    {
      name: "album-icon", kind: "album", hue: "green", title: "Reading list",
      tile: {}, kicker: [{ text: "Mind", target: "mind" }],
      subtitle: "Books and long reads worth finishing.",
      actions: [["＋ Book", "New book"], ["⊞", "Edit schema"]],
      body: "▸ Schema · 4 fields · 37 books",
    },
    {
      name: "record", kind: "record", hue: "orange", title: "Cranford Ramen",
      tile: { emoji: "🍽" }, kicker: [{ text: "Restaurants", target: "eat" }, { text: "Restaurant" }],
      body: "Status 💚 Liked · Location Cranford · Category Ramen",
    },
    {
      name: "day-today", kind: "day", hue: "violet", title: "Fri, Nov 20, 2026",
      tile: { band: "FRI", value: "20" }, kicker: [{ text: "W47", target: "2026/2026-W47" }, { text: "2026", target: "2026" }],
      pill: { text: "TODAY", tone: "solid" },
      body: "① Protect the first quiet hour",
      rail: {
        prev: { label: "Thu 19", shortLabel: "Thu", target: "2026/20261119", ariaLabel: "Previous day: Thu, Nov 19, 2026" },
        parent: { label: "W47 · Nov 16 – 22", shortLabel: "W47", target: "2026/2026-W47", ariaLabel: "Week: 2026-W47" },
        next: { label: "Sat 21", shortLabel: "Sat", target: "2026/20261121", unresolved: true, ariaLabel: "Next day: Sat, Nov 21, 2026" },
      },
    },
    {
      name: "day-past", kind: "day", hue: "violet", title: "Wed, Nov 18, 2026",
      tile: { band: "WED", value: "18" }, kicker: [{ text: "W47", target: "2026/2026-W47" }, { text: "2026", target: "2026" }],
      rail: {
        prev: { label: "Tue 17", shortLabel: "Tue", target: "2026/20261117" },
        parent: { label: "W47 · Nov 16 – 22", shortLabel: "W47", target: "2026/2026-W47" },
        next: { label: "Thu 19", shortLabel: "Thu", target: "2026/20261119" },
      },
    },
    {
      name: "week", kind: "week", hue: "blue", title: "2026-W47",
      tile: { value: "47" }, kicker: [{ text: "2026-Q4", target: "2026/2026-Q4" }],
      subtitle: "Nov 16 – 22, 2026", pill: { text: "THIS WEEK", tone: "solid" },
      rail: {
        prev: { label: "W46 · Nov 9 – 15", shortLabel: "W46", target: "2026/2026-W46" },
        parent: { label: "2026-Q4", shortLabel: "Q4", target: "2026/2026-Q4" },
        next: { label: "W48 · Nov 23 – 29", shortLabel: "W48", target: "2026/2026-W48", unresolved: true },
        children: dayChips("Fri 20"),
      },
    },
    {
      name: "quarter", kind: "quarter", hue: "blue", title: "2026-Q4",
      tile: { value: "Q4" }, kicker: [{ text: "2026", target: "2026" }],
      subtitle: "W40–W53 · Sep 28, 2026 – Jan 3, 2027", pill: { text: "THIS QUARTER", tone: "solid" },
      rail: {
        prev: { label: "2026-Q3", shortLabel: "Q3", target: "2026/2026-Q3" },
        parent: { label: "2026", target: "2026" },
        next: { label: "2027-Q1", shortLabel: "Q1", target: "2027/2027-Q1", unresolved: true },
        children: weekChips(47),
      },
    },
    {
      name: "year", kind: "year", hue: "blue", title: "2026",
      tile: { value: "2026" }, kicker: [{ text: "All time", target: "all_time" }],
      subtitle: "Dec 29, 2025 – Jan 3, 2027 · 53 weeks", pill: { text: "THIS YEAR", tone: "solid" },
      rail: {
        prev: { label: "2025", target: "2025" },
        parent: { label: "All time", target: "all_time" },
        next: { label: "2027", target: "2027", unresolved: true },
        children: ["Q1", "Q2", "Q3", "Q4"].map((label) => ({ label, target: `2026/2026-${label}`, current: label === "Q4" })),
      },
    },
    {
      name: "bank", kind: "bank", hue: "blue", title: "Setup",
      tile: {}, kicker: [], body: "Everyday · Coffee c · Groceries g · Kids k",
    },
    {
      name: "long-title", kind: "album", hue: "red",
      title: "Every restaurant, café, food truck, and late-night noodle counter Kelly and I have ever argued about on the drive home",
      tile: { emoji: "🍜" }, kicker: [{ text: "Body", target: "body" }, { text: "Food" }],
      subtitle: "A deliberately long title that must wrap and never truncate.",
      actions: [["＋ Restaurant", "New restaurant"], ["⊞", "Edit schema"]],
    },
  ];
}

function buildCase(H, doc, spec) {
  const card = doc.createElement("div");
  card.setAttribute("class", "bob-property-card bob-preview-card");
  card.setAttribute("data-root-hue", spec.hue);
  H.propertyCardApplyIdentity(card, { kind: spec.kind, title: spec.title });
  const block = H.propertyCardBuildTitleBlock(doc, {
    kind: spec.kind, title: spec.title, kicker: spec.kicker, pill: spec.pill,
    subtitle: spec.subtitle, tile: spec.tile, onLink: () => {},
  });
  if (!block) throw new Error(`${spec.name}: title block builder returned null`);
  for (const [text, label] of spec.actions || []) block.actions.appendChild(button(doc, text, label));
  card.appendChild(block.element);
  if (spec.body) card.appendChild(body(doc, spec.body));
  if (spec.rail) {
    const rail = H.propertyCardBuildRail(doc, { ...spec.rail, onNavigate: () => {} });
    if (!rail) throw new Error(`${spec.name}: rail builder returned null`);
    card.appendChild(rail.element);
  }
  emulateIcons(doc, card);
  return card;
}

// Build every fixture offline with the real kit builders. Returns
// [{ name, kind, hue, title, card }]; grayscale twins share one title.
function buildCases(H, doc, options = {}) {
  const specs = caseSpecs();
  const out = specs.map((spec) => ({ name: spec.name, kind: spec.kind, hue: spec.hue, title: spec.title, card: buildCase(H, doc, spec) }));
  if (options.grayscale !== false) {
    for (const name of ["album", "record", "day-today"]) {
      const spec = { ...specs.find((item) => item.name === name), title: "Northfield", pill: undefined };
      out.push({ name: `gray-${name}`, kind: spec.kind, hue: spec.hue, title: spec.title, grayscale: true, card: buildCase(H, doc, spec) });
    }
  }
  return out;
}

const EXTRA_CHROME = `
body.theme-light { --color-cyan: #00bfbc; }
body.theme-dark { --color-cyan: #53dfdd; }
html.bob-preview-grayscale { filter: grayscale(1); }
.bob-preview-card { margin-block-end: 0; }
.bob-preview-body { margin-block-start: 0.6em; color: var(--text-normal); font-size: var(--font-ui-small); }
.bob-preview-action { font: inherit; padding: 0.1em 0.55em; border: 1px solid var(--background-modifier-border); border-radius: 4px; background: var(--background-primary); color: var(--text-normal); }
`;

function pageHtml(css, cardHtml, theme, grayscale) {
  const safeCss = css.replace(/<\/style/gi, "<\\/style");
  return `<!doctype html><html${grayscale ? " class=\"bob-preview-grayscale\"" : ""}><head><meta charset="utf-8"><style>${PAGE_CHROME}${EXTRA_CHROME}</style><style>${safeCss}</style></head><body class="theme-${theme}"><main class="markdown-preview-view"><div class="markdown-preview-sizer">${cardHtml}</div></main></body></html>`;
}

async function installPage(client, html) {
  const encoded = Buffer.from(html).toString("base64");
  const result = await client.call("Runtime.evaluate", {
    expression: `(() => { const bytes = Uint8Array.from(atob("${encoded}"), (c) => c.charCodeAt(0)); document.open(); document.write(new TextDecoder("utf-8").decode(bytes)); document.close(); return true; })()`,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Could not install preview page");
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const state = await client.call("Runtime.evaluate", {
      expression: "document.readyState === \"complete\" && Boolean(document.querySelector(\".bob-property-card\"))",
      returnByValue: true,
    });
    if (state.result?.value === true) {
      await client.call("Runtime.evaluate", { expression: "document.fonts.ready.then(() => true)", awaitPromise: true, returnByValue: true });
      return;
    }
    await sleep(50);
  }
  throw new Error("Preview page did not finish rendering a property card");
}

// Evaluated in the page: resolve colors through a probe element, then
// compute WCAG contrast for the species word and the stripe.
const MEASURE = `(() => {
  const probe = document.createElement("span");
  probe.style.forcedColorAdjust = "none";
  document.body.appendChild(probe);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const rgb = (value) => {
    probe.style.color = "";
    probe.style.color = value;
    const resolved = getComputedStyle(probe).color;
    let m = /^rgba?\\(([^)]+)\\)$/.exec(resolved);
    if (m) { const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1, resolved }; }
    m = /^color\\(srgb ([^)]+)\\)$/.exec(resolved);
    if (m) { const p = m[1].split(/[ \\/]+/).filter(Boolean).map(Number); return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: p.length > 3 ? p[3] : 1, resolved }; }
    ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = "#000"; ctx.fillStyle = resolved; ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] / 255, resolved };
  };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const card = document.querySelector(".bob-property-card");
  const species = card.querySelector(".bob-property-card-kicker-species");
  const cardStyle = getComputedStyle(card);
  const cardBg = rgb(cardStyle.backgroundColor);
  const pageBg = rgb(getComputedStyle(document.body).backgroundColor);
  const stripe = rgb(cardStyle.borderInlineStartColor || cardStyle.borderLeftColor);
  const word = rgb(getComputedStyle(species).color);
  const rect = species.getBoundingClientRect();
  const result = {
    headings: card.querySelectorAll("[aria-level=\\"1\\"]").length,
    speciesText: species.textContent,
    speciesVisible: rect.width > 0 && rect.height > 0 && getComputedStyle(species).visibility !== "hidden",
    speciesContrast: Math.round(ratio(word, cardBg) * 100) / 100,
    stripeContrast: Math.round(ratio(stripe, pageBg) * 100) / 100,
    colors: { cardBg: cardBg.resolved, pageBg: pageBg.resolved, stripe: stripe.resolved, word: word.resolved },
  };
  probe.remove();
  return result;
})()`;

async function captureCard(client, outPath) {
  const bounds = await client.call("Runtime.evaluate", {
    expression: "(() => { const r = document.querySelector(\".bob-property-card\").getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()",
    returnByValue: true,
  });
  const rect = bounds.result?.value;
  if (!rect || !(rect.width > 0 && rect.height > 0)) throw new Error("Rendered card has no visible bounds");
  const pad = 10;
  const image = await client.call("Page.captureScreenshot", {
    format: "png", fromSurface: true, captureBeyondViewport: true,
    clip: { x: Math.max(0, Math.floor(rect.x) - pad), y: Math.max(0, Math.floor(rect.y) - pad), width: Math.ceil(rect.width) + pad * 2, height: Math.ceil(rect.height) + pad * 2, scale: 1 },
  });
  const bytes = Buffer.from(image.data, "base64");
  fs.writeFileSync(outPath, bytes);
  return { file: path.basename(outPath), sha256: sha256(bytes), bytes: bytes.length };
}

function indexHtml(rows) {
  const groups = new Map();
  for (const row of rows) {
    const list = groups.get(row.scenario) || [];
    list.push(row);
    groups.set(row.scenario, list);
  }
  const sections = [...groups.entries()].map(([scenario, list]) => {
    const figures = list.map((row) => {
      const status = row.failures.length ? `<b class="fail">FAIL: ${escapeHtml(row.failures.join("; "))}</b>` : "ok";
      const metrics = row.metrics ? ` · species ${row.metrics.speciesContrast}:1 · stripe ${row.metrics.stripeContrast}:1` : "";
      return `<figure><img src="${escapeHtml(row.screenshot.file)}" alt="${escapeHtml(row.case)}"><figcaption>${escapeHtml(row.pass)} · ${escapeHtml(row.theme)} · ${row.width}px${metrics} · ${status}</figcaption></figure>`;
    }).join("");
    return `<section><h2>${escapeHtml(scenario)}</h2><div class="grid">${figures}</div></section>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Property-card title block preview</title><style>
body{font:14px/1.4 system-ui,sans-serif;margin:24px;background:#fafafa;color:#222}
.grid{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}
figure{margin:0;padding:8px;background:#fff;border:1px solid #ddd;border-radius:6px;max-width:100%}
img{display:block;max-width:100%;height:auto}figcaption{margin-top:6px;font-size:12px;color:#555}.fail{color:#b00020}
</style></head><body><h1>Property-card title block preview</h1>${sections}</body></html>\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(`${HELP}\n`); return; }
  if (!args.out) throw new Error("--out is required");
  if (!fs.existsSync(args.executable)) throw new Error(`Obsidian executable not found: ${args.executable}`);
  const { helpers: H } = require("./ledger-tools-harness.cjs");
  const css = fs.readFileSync(PLUGIN_CSS, "utf8");
  const outDir = path.resolve(args.out);
  fs.mkdirSync(outDir, { recursive: true });

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "title-block-"));
  const vaultPath = path.join(tempRoot, "vault");
  fs.mkdirSync(path.join(vaultPath, ".obsidian"), { recursive: true });
  fs.writeFileSync(path.join(vaultPath, "README.md"), "# Preview scratch vault\n");
  const port = await freePort();
  const child = spawn(args.executable, [
    "--no-sandbox", `--user-data-dir=${path.join(tempRoot, "profile")}`, `--remote-debugging-port=${port}`,
    "--remote-allow-origins=http://127.0.0.1/*", vaultPath,
  ], { cwd: vaultPath, env: { ...process.env, TMPDIR: "/tmp" }, detached: process.platform !== "win32", stdio: "ignore" });

  let client = null;
  try {
    let endpoint;
    try { endpoint = await cdpTarget(port, child); } catch (error) { throw new Error(`${error.message}; run under xvfb-run -a`); }
    let WebSocketClient = globalThis.WebSocket;
    if (typeof WebSocketClient !== "function") {
      try { WebSocketClient = require("undici").WebSocket; } catch (_) { WebSocketClient = null; }
    }
    if (!WebSocketClient) throw new Error("WebSocket is required for the CDP client (Node 22+ or undici)");
    client = new CdpClient(endpoint, WebSocketClient);
    await client.call("Page.enable");
    await client.call("Runtime.enable");
    await client.call("Page.navigate", { url: "about:blank" });
    await sleep(250);

    const rows = [];
    const render = async (item, pass, theme, width, forced) => {
      const caseName = `${item.name}-${pass}-${theme}-${width}`;
      await client.call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await client.call("Emulation.setEmulatedMedia", {
        media: "screen",
        features: [
          { name: "prefers-color-scheme", value: theme },
          { name: "prefers-reduced-motion", value: "reduce" },
          { name: "forced-colors", value: forced ? "active" : "none" },
        ],
      });
      await installPage(client, pageHtml(css, serialize(item.card), theme, item.grayscale === true));
      const measured = await client.call("Runtime.evaluate", { expression: MEASURE, returnByValue: true });
      if (measured.exceptionDetails) throw new Error(`${caseName}: ${measured.exceptionDetails.text}`);
      const metrics = measured.result?.value || {};
      const failures = [];
      if (metrics.headings !== 1) failures.push(`expected one aria-level=1, saw ${metrics.headings}`);
      if (!metrics.speciesVisible) failures.push("species word is not visible");
      if (pass === "normal") {
        if (!(metrics.speciesContrast >= 4.5)) failures.push(`species contrast ${metrics.speciesContrast}:1 < 4.5:1`);
        if (!(metrics.stripeContrast >= 3)) failures.push(`stripe contrast ${metrics.stripeContrast}:1 < 3:1`);
      }
      const screenshot = await captureCard(client, path.join(outDir, `${caseName}.png`));
      rows.push({ case: caseName, scenario: item.name, kind: item.kind, pass, theme, width, metrics, failures, screenshot });
    };

    const items = buildCases(H, previewDocument());
    for (const item of items.filter((entry) => !entry.grayscale)) {
      for (const theme of ["light", "dark"]) {
        for (const width of [1280, 375]) await render(item, "normal", theme, width, false);
      }
    }
    for (const item of items.filter((entry) => entry.grayscale)) {
      for (const theme of ["light", "dark"]) await render(item, "grayscale", theme, 1280, false);
    }
    for (const item of items.filter((entry) => !entry.grayscale)) {
      await render(item, "forced-colors", "light", 1280, true);
    }

    const errors = rows.filter((row) => row.failures.length).map((row) => `${row.case}: ${row.failures.join("; ")}`);
    const report = {
      sourceSha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
      cssSha256: sha256(Buffer.from(css)),
      screenshotCount: rows.length,
      assertions: ["one aria-level=1 per card", "species word visible", "species-word contrast >= 4.5:1 (light/dark)", "stripe contrast >= 3:1 (light/dark)"],
      cases: rows,
      errors,
      outcome: errors.length ? "fail" : "pass",
    };
    fs.writeFileSync(path.join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(path.join(outDir, "index.html"), indexHtml(rows));
    process.stdout.write(`Title block preview: ${rows.length} screenshots, ${errors.length} failing assertions → ${outDir}\n`);
    if (errors.length) throw new Error(`Assertions failed:\n${errors.join("\n")}`);
  } finally {
    client?.close();
    try {
      if (child.pid && child.exitCode === null) {
        if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
        else child.kill("SIGTERM");
      }
    } catch (_) {}
    await sleep(200);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`preview-title-block: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, caseSpecs, buildCases, pageHtml, indexHtml };
