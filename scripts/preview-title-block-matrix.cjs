#!/usr/bin/env node
"use strict";
// Title-block family preview matrix (bob-cli-o6.6.1.3 visual-matrix).
// Composes the REAL adopter DOM builders into the full eleven-case
// light/dark x 375px/wide matrix, plus grayscale and forced-colors species
// proofs. Every card is built by the owning fragment (no kit approximation):
// album/record/bank via preview-property-cards builders, day/period via the
// intention-card builder. Writes PNGs, report.json, and index.html.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const {
  PAGE_CHROME, previewDocument, serialize,
  CdpClient, freePort, cdpTarget, sleep, sha256,
} = require("./preview-property-cards.cjs");
const { previewCases: intentionPreviewCases } = require("./preview-intention-card.cjs");

const ROOT = path.resolve(__dirname, "..");
const PLUGIN_CSS = path.join(ROOT, "plugins/bob-ledger-tools/styles.css");
const DEFAULT_OBSIDIAN = "/snap/obsidian/current/app/obsidian";
const HELP = [
  "Usage: node scripts/preview-title-block-matrix.cjs [OPTIONS]",
  "",
  "Render the eleven-case title-block family matrix with real builders:",
  "album, record, today, past day, empty day, legacy daily, week, quarter,",
  "year, bank Setup, broken album report. Light/dark x 375px/wide (44), plus",
  "grayscale and forced-colors species proofs. Run under xvfb-run -a.",
  "",
  "Options:",
  "  -e, --executable PATH   Obsidian Electron binary",
  "  -o, --out DIRECTORY     Save screenshots, report.json, and index.html",
  "  -h, --help              Print this help",
].join("\n");

function parseArgs(argv) {
  const args = { executable: DEFAULT_OBSIDIAN, out: null, help: false };
  const list = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < list.length; i += 1) {
    const v = list[i];
    if (["-h", "--help"].includes(v)) { args.help = true; continue; }
    if (["-e", "--executable"].includes(v)) { args.executable = list[++i]; continue; }
    if (["-o", "--out"].includes(v)) { args.out = list[++i]; continue; }
    throw new Error(`Unknown argument: ${v}`);
  }
  return args;
}

function sampleAlbumEntry(overrides = {}) {
  return {
    path: "eat.md", stem: "eat", title: "Restaurants", noun: "restaurant",
    emoji: "🍽️", parent: "body", owner: "body", root: "body",
    schema_fingerprint: "sha256:property-card-preview", records: 12,
    label: "Restaurant", plural: "restaurants", singular: "restaurant",
    dated_notes: true, index_by: "status", group_field: "status",
    fields: [
      { key: "status", label: "Status", kind: "text", required: true, choices: [
        { value: "to_try", label: "🔖 To try", count: 4 },
        { value: "liked", label: "💚 Liked", count: 8 },
      ] },
      { key: "location", label: "Location", kind: "text", required: true, choices: [] },
      { key: "category", label: "Category", kind: "text", choices: [] },
    ],
    issues: [], index: { state: "current" },
    ...overrides,
  };
}

function albumApp(extraFiles = {}) {
  const files = new Map([
    ["eat.md", { path: "eat.md" }], ["body.md", { path: "body.md" }], ["type.md", { path: "type.md" }],
    ...Object.entries(extraFiles),
  ]);
  const caches = new Map([
    ["eat.md", { frontmatter: { type: "[[album]]", parent: "[[body]]", emoji: "🍽️",
      summary: "Restaurants Kelly and I have tried, liked, or want to try." },
      headings: [{ level: 1, heading: "Restaurants" }] }],
    ["body.md", { frontmatter: { type: "[[area]]", parent: "[[type]]" }, headings: [{ level: 1, heading: "Body" }] }],
    ["type.md", { frontmatter: { type: "[[type]]" } }],
    ...Object.entries(extraFiles).map(([k, v]) => [k, v.cache || { frontmatter: {}, headings: [] }]),
  ]);
  return {
    vault: { getAbstractFileByPath: (v) => files.get(v) || null },
    metadataCache: {
      getFirstLinkpathDest: (t) => files.get(`${String(t).replace(/\.md$/i, "")}.md`) || null,
      getFileCache: (f) => caches.get(f?.path) || null,
    },
  };
}

function albumReport(entry) {
  const H = require("./ledger-tools-harness.cjs").helpers;
  return H.albumIndexReport({ schema_version: 1, ok: true, albums: [entry], catalogs: [], counts: {} });
}

function buildAlbumReal(H, Plugin, broken) {
  const entry = broken
    ? sampleAlbumEntry({ issues: [{ severity: "error", code: "unknown-field", message: "Unknown field 'zzz'.", line: 12, key_path: "fields.zzz", suggestions: [] }], parent: "[[missing-owner]]" })
    : sampleAlbumEntry();
  const app = albumApp();
  const model = H.albumHeaderCardModel(albumReport(entry), "eat.md", {
    sourcePath: "eat.md",
    sourceText: "---\ntype: [[album]]\n---\n",
    metadataCache: app.metadataCache, vault: app.vault,
  });
  assert.ok(model, "albumHeaderCardModel returned a model");
  const plugin = Object.create(Plugin.prototype);
  const card = plugin.albumHeaderBuildEl(model, { desktop: true, expanded: true, hue: "blue", handlers: {} }, previewDocument());
  assert.ok(card, "albumHeaderBuildEl returned a card");
  return card;
}

function buildRecordReal(H) {
  const { previewDocument: docFactory } = require("./preview-property-cards.cjs");
  const app = albumApp();
  const model = {
    gate: { mount: true, state: "healthy", filePath: "eat/cranford.md", albumPath: "eat.md", album: {
      path: "eat.md", stem: "eat", title: "Restaurants", noun: "restaurant", emoji: "🍽️",
      legacy: ["old_place"], group_field: "status",
      schema_fingerprint: "sha256:property-card-preview",
      fields: [
        { key: "status", label: "Status", kind: "text", required: true, choices: [
          { value: "liked", label: "💚 Liked" }, { value: "to_try", label: "🔖 To try" },
        ] },
        { key: "location", label: "Location", kind: "text", required: true, choices: [] },
        { key: "category", label: "Category", kind: "text", choices: [] },
      ], }, hideEligible: true, editable: true },
    frontmatter: { title: "Cranford Ramen", created: "2026-11-18", status: "liked", location: "Cranford", old_place: "Broad Street" },
    heading: "Legacy Heading", hue: "blue", collapsed: false,
    clock: { today: "2026-11-19", now: new Date(2026, 10, 19, 12, 0, 0) },
  };
  const full = H.recordSheetModel(model);
  assert.ok(full, "recordSheetModel produced a model");
  full.choiceChips = [{ key: "status", group: true, chips: [{ text: "💚 Liked" }, { text: "🔖 To try" }] }];
  full.walk = { path: "eat/cranford.md", lineIndex: 8, lineState: "current", state: "ok",
    album: { title: "Restaurants", stem: "eat", emoji: "🍽️", hue: "blue" },
    writtenPrev: { target: "eat/phou-house.md", label: "‹ Pho House" },
    writtenNext: { target: "eat/ramen-ya.md", label: "Ramen Ya ›" },
    position: 3, total: 12, wrapsPrev: false, wrapsNext: false };
  const doc = docFactory();
  const card = H.recordSheetBuildEl(full, { handlers: {} }, doc);
  assert.ok(card, "recordSheetBuildEl returned a card");
  if (card.classList) card.classList.add("docks-record-walk", "has-record-walk");
  const rail = H.recordWalkRailBuildEl(full.walk, { hue: "blue", handlers: {} }, doc);
  if (rail) card.appendChild(rail);
  return card;
}

function buildBankReal(H) {
  const report = { ok: true, state: "valid", path: "bank.md",
    categories: [
      { key: "coffee", label: "Coffee", hotkey: "c", count: 5, line: 13, group: "Everyday" },
      { key: "groceries", label: "Groceries", hotkey: "g", count: 8, line: 14, group: "Everyday" },
      { key: "kids", label: "Kids", hotkey: "k", count: 2, line: 15, group: "Everyday", hidden: true },
    ],
    accounts: [{ alias: "checking", label: "WF Checking", kind: "checking", start: "2026-11-01", line: 3 }],
    rules: [{ match: "Local Market", cat: "groceries", line: 22 }],
    findings: [], free_hotkeys: ["c", "g"], stale_after: { days: 10, explicit: false, line: null } };
  const model = H.bankSetupModel(report, { desktop: true, expanded: true });
  const card = H.bankSetupBuildEl(model, {}, previewDocument());
  assert.ok(card, "bankSetupBuildEl returned a card");
  card?.setAttribute?.("data-root-hue", "blue");
  return card;
}

const PREVIEW_MISSING = ["2026/20261121", "2026/20261122", "2026/20261124", "2026/20261125", "2026/2026-W48", "2027/2027-Q1", "2027",
  ...Array.from({ length: 6 }, (_, i) => `2026/2026-W${48 + i}`)];

function intentionPlugin() {
  const exists = (t) => !PREVIEW_MISSING.includes(String(t || "").replace(/\.md$/i, ""));
  const file = (t) => ({ path: `${String(t).replace(/\.md$/i, "")}.md` });
  return { app: { workspace: {},
    vault: { getAbstractFileByPath: (t) => (exists(t) ? file(t) : null) },
    metadataCache: { getFirstLinkpathDest: (t) => (exists(t) ? file(t) : null), getFileCache: () => null } } };
}

function buildIntentionReal(H, name) {
  const cases = intentionPreviewCases(H);
  const item = cases.find((c) => c.name === name);
  assert.ok(item, `intention preview case ${name} exists`);
  const doc = previewDocument();
  const card = H.intentionCardBuildDom(item.model, intentionPlugin(), doc);
  assert.ok(card?.classList?.contains("bob-property-card"), `${name}: shared card painter ran`);
  return card;
}

// Eleven required cases, every card from its owning real builder.
function buildMatrix(H, Plugin) {
  return [
    { name: "album", species: "album", expectedHeadings: 1, build: () => buildAlbumReal(H, Plugin, false) },
    { name: "record", species: "record", expectedHeadings: 1, build: () => buildRecordReal(H) },
    { name: "today", species: "day", expectedHeadings: 1, build: () => buildIntentionReal(H, "single-intention") },
    { name: "past-day", species: "day", expectedHeadings: 1, build: () => buildIntentionReal(H, "past-empty-day") },
    { name: "empty-day", species: "day", expectedHeadings: 1, build: () => buildIntentionReal(H, "empty-today-ghost") },
    { name: "legacy-daily", species: "day", expectedHeadings: 1, build: () => buildIntentionReal(H, "legacy-daily") },
    { name: "week", species: "week", expectedHeadings: 1, build: () => buildIntentionReal(H, "week-children") },
    { name: "quarter", species: "quarter", expectedHeadings: 1, build: () => buildIntentionReal(H, "quarter") },
    { name: "year", species: "year", expectedHeadings: 1, build: () => buildIntentionReal(H, "year") },
    { name: "bank-setup", species: "bank", expectedHeadings: 0, build: () => buildBankReal(H) },
    { name: "broken-album", species: "album", expectedHeadings: 1, build: () => buildAlbumReal(H, Plugin, true) },
  ];
}

const EXTRA_CHROME = `
body.theme-light { --color-cyan: #00bfbc; }
body.theme-dark { --color-cyan: #53dfdd; }
html.bob-preview-grayscale body { filter: grayscale(1); }
.markdown-preview-sizer { min-width: 0; max-width: 100%; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
`;

function pageHtml(css, cardHtml, theme, grayscale) {
  const safe = css.replace(/<\/style/gi, "<\/style");
  return `<!doctype html><html${grayscale ? ' class="bob-preview-grayscale"' : ""}><head><meta charset="utf-8"><style>${PAGE_CHROME}${EXTRA_CHROME}</style><style>${safe}</style></head><body class="theme-${theme}"><main class="markdown-preview-view"><div class="markdown-preview-sizer">${cardHtml}</div></main></body></html>`;
}

async function installPage(client, html) {
  const encoded = Buffer.from(html).toString("base64");
  const result = await client.call("Runtime.evaluate", {
    expression: `(() => { const html = new TextDecoder("utf-8").decode(Uint8Array.from(atob("${encoded}"), (c) => c.charCodeAt(0))); document.open(); document.write(html); document.close(); return true; })()`,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Could not install preview page");
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const state = await client.call("Runtime.evaluate", {
      expression: "document.readyState === 'complete' && Boolean(document.querySelector('.bob-property-card'))",
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

// In-page probe: headings, species word, tile, contrast, focus, card width.
const MEASURE = `(() => {
  const probe = document.createElement("span");
  probe.style.forcedColorAdjust = "none";
  document.body.appendChild(probe);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const rgb = (value) => {
    probe.style.color = ""; probe.style.color = value;
    const resolved = getComputedStyle(probe).color;
    let m = /^rgba?\\(([^)]+)\\)$/.exec(resolved);
    if (m) { const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], resolved }; }
    ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = "#000"; ctx.fillStyle = resolved; ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], resolved };
  };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const card = document.querySelector(".bob-property-card");
  const species = card.querySelector(".bob-property-card-kicker-species, .bob-property-card-identity-word");
  const cardStyle = getComputedStyle(card);
  const cardBg = rgb(cardStyle.backgroundColor);
  const pageBg = rgb(getComputedStyle(document.body).backgroundColor);
  const stripe = rgb(cardStyle.borderInlineStartColor || cardStyle.borderLeftColor);
  const word = species ? rgb(getComputedStyle(species).color) : { r: 0, g: 0, b: 0, resolved: "none" };
  const rect = card.getBoundingClientRect();
  const speciesRect = species ? species.getBoundingClientRect() : { width: 0, height: 0 };
  const focusable = card.querySelector("button, a[href], [tabindex]");
  let focusOutline = "";
  if (focusable) { focusable.focus({ preventScroll: true }); focusOutline = getComputedStyle(focusable).outlineStyle + " " + getComputedStyle(focusable).outlineWidth; }
  const titleEl = card.querySelector('[aria-level="1"]');
  const cardText = (card.textContent || "").trim().slice(0, 120);
  return {
    headings: card.querySelectorAll('[aria-level="1"]').length,
    title: ((titleEl ? titleEl.textContent : "") || cardText).trim().slice(0, 120),
    speciesText: species ? species.textContent.trim() : "",
    speciesVisible: speciesRect.width > 0 && speciesRect.height > 0,
    speciesContrast: species ? Math.round(ratio(word, cardBg) * 100) / 100 : 0,
    stripeContrast: Math.round(ratio(stripe, pageBg) * 100) / 100,
    cardWidth: Math.round(rect.width * 10) / 10,
    cardHeight: Math.round(rect.height * 10) / 10,
    focusOutline,
    hasFocusable: Boolean(focusable),
    forcedBorder: cardStyle.borderInlineStartColor || cardStyle.borderLeftColor,
    colors: { cardBg: cardBg.resolved, pageBg: pageBg.resolved, stripe: stripe.resolved, word: word.resolved },
  };
})()`;

async function captureCard(client, outPath) {
  const bounds = await client.call("Runtime.evaluate", {
    expression: "(() => { const r = document.querySelector('.bob-property-card').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()",
    returnByValue: true,
  });
  const rect = bounds.result?.value;
  if (!rect || !(rect.width > 0 && rect.height > 0)) throw new Error("Rendered card has no visible bounds");
  const pad = 12;
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
    list.push(row); groups.set(row.scenario, list);
  }
  const sections = [...groups.entries()].map(([scenario, list]) => {
    const figures = list.map((row) => {
      const status = row.failures.length ? `<b class="fail">FAIL: ${row.failures.join("; ")}</b>` : "ok";
      const m = row.metrics ? ` · card ${row.metrics.cardWidth}px · species ${row.metrics.speciesContrast}:1 · stripe ${row.metrics.stripeContrast}:1` : "";
      return `<figure><img src="${row.screenshot.file}" alt="${row.case}"><figcaption>${row.pass} · ${row.theme} · viewport ${row.width}px${m} · ${status}</figcaption></figure>`;
    }).join("");
    return `<section><h2>${scenario}</h2><div class="grid">${figures}</div></section>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Title-block family matrix (real builders)</title><style>
body{font:14px/1.4 system-ui,sans-serif;margin:24px;background:#fafafa;color:#222}
.grid{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}
figure{margin:0;padding:8px;background:#fff;border:1px solid #ddd;border-radius:6px;max-width:100%}
img{display:block;max-width:100%;height:auto}figcaption{margin-top:6px;font-size:12px;color:#555}.fail{color:#b00020}
</style></head><body><h1>Title-block family matrix — real adopter builders</h1><p>Eleven cases (album, record, today, past day, empty day, legacy daily, week, quarter, year, bank Setup, broken album report) in light/dark at 375px and wide viewports, plus grayscale and forced-colors species proofs. Every card is built by its owning fragment.</p>${sections}</body></html>\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(`${HELP}\n`); return; }
  if (!args.out) throw new Error("--out is required");
  if (!fs.existsSync(args.executable)) throw new Error(`Obsidian executable not found: ${args.executable}`);
  const { helpers: H, LedgerToolsPlugin: Plugin } = require("./ledger-tools-harness.cjs");
  const css = fs.readFileSync(PLUGIN_CSS, "utf8");
  const outDir = path.resolve(args.out);
  fs.mkdirSync(outDir, { recursive: true });

  // Build every card offline first so builder failures surface without Electron.
  const matrix = buildMatrix(H, Plugin);
  const built = matrix.map((entry) => ({ ...entry, html: serialize(entry.build()) }));
  // Titles must be non-empty (bank Setup keeps its local Setup title, broken keeps local title).
  for (const item of built) {
    if (!/aria-level="1"|Setup|Bank/.test(item.html)) throw new Error(`${item.name}: built card carries no title`);
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "title-matrix-"));
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
    try { endpoint = await cdpTarget(port, child); } catch (e) { throw new Error(`${e.message}; run under xvfb-run -a`); }
    let WS = globalThis.WebSocket;
    if (typeof WS !== "function") { try { WS = require("undici").WebSocket; } catch (_) { WS = null; } }
    if (!WS) throw new Error("WebSocket is required (Node 22+ or undici)");
    client = new CdpClient(endpoint, WS);
    await client.call("Page.enable");
    await client.call("Runtime.enable");
    await client.call("Page.navigate", { url: "about:blank" });
    await sleep(250);

    const rows = [];
    const render = async (item, html, pass, theme, width, forced, grayscale) => {
      const caseName = `${item.name}-${pass}-${theme}-${width}`;
      await client.call("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
      await client.call("Emulation.setEmulatedMedia", { media: "screen",
        features: [
          { name: "prefers-color-scheme", value: theme },
          { name: "prefers-reduced-motion", value: "reduce" },
          { name: "forced-colors", value: forced ? "active" : "none" },
        ] });
      await installPage(client, pageHtml(css, html, theme, grayscale));
      const measured = await client.call("Runtime.evaluate", { expression: MEASURE, returnByValue: true });
      if (measured.exceptionDetails) throw new Error(`${caseName}: ${measured.exceptionDetails.text}`);
      const metrics = measured.result?.value || {};
      const failures = [];
      if (metrics.headings !== item.expectedHeadings) failures.push(`expected ${item.expectedHeadings} aria-level=1, saw ${metrics.headings}`);
      if (item.expectedHeadings > 0 && !metrics.speciesVisible) failures.push("species word is not visible");
      if (!metrics.title) failures.push("title text is empty (broken/pending must retain local title)");
      if (item.name === "bank-setup" && !/Setup|Bank/i.test(metrics.title || "") && !/Setup|Bank/i.test(metrics.speciesText || "")) failures.push("bank Setup badge/title missing");
      if (pass === "normal") {
        if (item.expectedHeadings > 0 && !(metrics.speciesContrast >= 4.5)) failures.push(`species contrast ${metrics.speciesContrast}:1 < 4.5:1`);
        if (!(metrics.stripeContrast >= 3)) failures.push(`stripe contrast ${metrics.stripeContrast}:1 < 3:1`);
        if (width === 375 && !(metrics.cardWidth > 0 && metrics.cardWidth <= 420)) failures.push(`375px viewport produced card width ${metrics.cardWidth}px`);
        if (width === 1280 && !(metrics.cardWidth > 500)) failures.push(`wide viewport produced narrow card ${metrics.cardWidth}px`);
      }
      if (pass === "forced-colors" && !metrics.forcedBorder) failures.push("forced-colors stripe border is missing");
      const screenshot = await captureCard(client, path.join(outDir, `${caseName}.png`));
      rows.push({ case: caseName, scenario: item.name, species: item.species, pass, theme, width, forced, metrics, failures, screenshot });
    };

    for (const item of built) {
      for (const theme of ["light", "dark"]) {
        for (const width of [375, 1280]) await render(item, item.html, "normal", theme, width, false, false);
      }
    }
    // Grayscale: same eleven cards through a grayscale filter; titles must be identical.
    for (const item of built) {
      for (const theme of ["light", "dark"]) await render(item, item.html, "grayscale", theme, 1280, false, true);
    }
    // Forced colors: every species once (eleven cards), light, OS emulation.
    for (const item of built) await render(item, item.html, "forced-colors", "light", 1280, true, false);

    const normalRows = rows.filter((r) => r.pass === "normal");
    const errors = rows.filter((r) => r.failures.length).map((r) => `${r.case}: ${r.failures.join("; ")}`);
    // Grayscale title identity: same card title in normal and grayscale.
    const titleBy = new Map();
    for (const r of rows) {
      if (r.pass === "normal" && r.theme === "light" && r.width === 1280) titleBy.set(r.scenario, r.metrics.title);
    }
    for (const r of rows) {
      if (r.pass === "grayscale" && r.theme === "light" && r.metrics.title !== titleBy.get(r.scenario)) {
        errors.push(`${r.case}: grayscale title ${JSON.stringify(r.metrics.title)} differs from normal ${JSON.stringify(titleBy.get(r.scenario))}`);
        r.failures.push("grayscale title differs");
      }
    }
    const report = {
      sourceSha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
      cssSha256: sha256(Buffer.from(css)),
      requiredCases: built.map((b) => b.name),
      screenshotCount: rows.length,
      normalCount: normalRows.length,
      assertions: ["headings per species (bank 0, else 1)", "species word visible", "local title retained (incl. broken)", "species contrast >=4.5 (normal)", "stripe >=3 (normal)", "375px card width", "wide card width", "grayscale title identity", "forced-colors border present"],
      cases: rows,
      errors,
      outcome: errors.length ? "fail" : "pass",
    };
    fs.writeFileSync(path.join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(path.join(outDir, "index.html"), indexHtml(rows));
    process.stdout.write(`Title-block matrix: ${rows.length} screenshots (${normalRows.length} normal), ${errors.length} failing → ${outDir}\n`);
    if (errors.length) throw new Error(`Assertions failed:\n${errors.join("\n")}`);
  } finally {
    client?.close();
    try { if (child.pid && child.exitCode === null) { if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM"); else child.kill("SIGTERM"); } } catch (_) {}
    await sleep(200);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((error) => { process.stderr.write(`preview-title-block-matrix: ${error.stack || error.message}\n`); process.exitCode = 1; });
}

module.exports = { parseArgs, buildMatrix };

