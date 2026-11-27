#!/usr/bin/env node
// Real-Obsidian property-card Cabinets acceptance in a synthetic scratch vault.
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const lib = require("./obsidian-cabinets-e2e-lib.cjs");
const home = require("./obsidian-home-cards-e2e-lib.cjs");
const periods = require("./obsidian-intention-card-e2e-lib.cjs");
const shared = require("./obsidian-record-card-e2e.cjs");
const repoRoot = path.resolve(__dirname, "..");
const ELECTRON_FALLBACK = "/snap/obsidian/current/app/obsidian";
const PLUGIN_ID = "bob-ledger-tools";
const PLUGIN_IDS = [PLUGIN_ID, "bob-navigation-hotkeys"];
const GATE_DATA = { cabinetsPreview: true, cardPreviewKinds: ["notebook", "prose"], refCardPreview: true };
const OPEN_TIMEOUT = 30_000;
const { sleep, waitFor } = shared;

function areaEntry({ stem, title, parent = null, depth = 0, summary = null }) {
  return {
    path: `${stem}.md`, stem, link: `[[${stem}]]`, title, titled: true, summary,
    parent, parent_raw: parent ? `[[${parent.replace(/\.md$/i, "")}]]` : null,
    depth, top: stem, hue: "blue", hue_source: "color", children: [],
    projects: { direct: 0, subtree: 0 }, today: { direct: 0, subtree: 0 }, issues: [],
  };
}

function projectEntry(stem, parent = null) {
  return {
    path: `${stem}.md`, stem, status: "wip", state: "open", criterion: null,
    parent, children: [], closed_on: null,
    prj: { line: null, mark: null, hidden: null, scheduled: null },
    blocked: null, tasks: { open: 0, shown: 0, today: null },
  };
}

const FIXTURE_BOB_REPORTS = Object.freeze({
  albums: {
    schema_version: 1,
    ok: true,
    albums: [
      albumFixture("eat", "Eat", "restaurant", 106, [
        { key: "status", label: "Status", kind: "enum", required: true, list: false, choices: [
          { value: "to_try", label: "To try" }, { value: "liked", label: "Liked" },
        ] },
        { key: "location", label: "Location", kind: "text", required: true, list: false, choices: [] },
        { key: "category", label: "Category", kind: "text", required: true, list: false, choices: [] },
      ]),
      albumFixture("empty", "Empty", "spot", 0, [
        { key: "status", label: "Status", kind: "enum", required: false, list: false, choices: [
          { value: "to_try", label: "To try" },
        ] },
      ]),
      albumFixture("subscriptions", "Subscriptions", "subscription", 2, [
        { key: "status", label: "Status", kind: "enum", required: true, list: false, choices: [
          { value: "active", label: "Active" }, { value: "cancelled", label: "Cancelled" },
        ] },
        { key: "amount", label: "Amount", kind: "number", required: true, list: false, choices: [] },
        { key: "cadence", label: "Cadence", kind: "enum", required: true, list: false, choices: [
          { value: "monthly", label: "Monthly" }, { value: "yearly", label: "Yearly" },
        ] },
      ]),
    ],
    catalogs: [],
    counts: { albums: 3, records: 108, roots: 3 },
  },
  bank: {
    schema_version: 1,
    ok: true,
    state: "valid",
    teaching_empty: false,
    partial: false,
    today: "2026-11-27",
    path: "bank.md",
    line: 6,
    fingerprint: "sha256:cabinets-fixture",
    accounts: [{
      alias: "checking", label: "Checking", kind: "checking", default: true,
      start: "2026-11-01", line: 8, source_line: 8, rows: 0, journal_events: 0,
      status: "balanced", hint: "Ledger balance matches.", last_import: null,
      balance_cents: 0, balance_asof: "2026-11-01", delta_cents: 0,
    }],
    categories: [{
      key: "food", emoji: "🍲", label: "Food", builtin: false, declared: true,
      hotkey: "f", hotkey_source: "explicit", group: "Everyday", hidden: false,
      line: 12, source_line: 12, rows: 0, rule_refs: 0,
    }],
    free_hotkeys: ["b"],
    rules: [],
    stale_after: { days: 10, explicit: false, line: null },
    findings: [],
    issues: { errors: 0, warnings: 0 },
    starter: null,
  },
  areas: {
    schema_version: 1, ok: true, command: "list",
    root: { state: "found", path: "cash.md", stem: "cash" },
    areas: [areaEntry({ stem: "home", title: "Home", parent: "cash.md", depth: 1, summary: "Household systems." })],
    catalogs: [{ host: "cash", path: "cash.md", kind: "root", state: "current",
      rows: [{ path: "home.md", link: "[[home]]", depth: 1 }], issues: [] }],
    findings: [],
    counts: { areas: 1, top_level: 1, hosts: 1, errors: 0, warnings: 0,
      catalogs: { current: 1, missing: 0, stale: 0, damaged: 0 } },
  },
  projects: (() => {
    // Rows 63 and 64 are closed, matching the stored catalog's Closed group.
    const rows = Array.from({ length: 64 }, (_, index) => {
      const entry = projectEntry(`sase-row-${String(index + 1).padStart(2, "0")}`, "sase.md");
      return index < 62 ? entry : { ...entry, status: "done", state: "done", closed_on: "2026-11-20" };
    });
    return {
      schema_version: 1, ok: true, command: "list", today: "2026-11-27",
      projects: [projectEntry("sase", "cash.md"), projectEntry("leaf", "cash.md"), ...rows],
      catalogs: [
        { host: "cash", path: "cash.md", kind: "area", state: "current",
          rows: { open: 1, blocked: 0, warning: 0, closed: 0 }, issues: [] },
        { host: "single", path: "single.md", kind: "area", state: "current",
          rows: { open: 1, blocked: 0, warning: 0, closed: 0 }, issues: [] },
        { host: "sase", path: "sase.md", kind: "project", state: "current",
          rows: { open: 62, blocked: 0, warning: 0, closed: 2 }, issues: [] },
      ],
      findings: [], counts: { projects: 66, catalogs: 3, errors: 0, warnings: 0 },
    };
  })(),
  notebooks: {
    schema_version: 1, ok: true,
    notebooks: [{ stem: "tools", path: "tools.md", title: "Tools", summary: "Tools and workflow.",
      parent: "cash", parent_kind: "area", owner: "cash", root: "cash", breadcrumb: ["Cash"],
      children: [], notes: 0, sections: [], last_note: null, issues: [] }],
    catalogs: [{ host: "cash", path: "cash.md", root: "cash", state: "current", notebooks: 1, issues: [] }],
    counts: { notebooks: 1, roots: 1, errors: 0, warnings: 0 }, findings: [],
  },
  capabilityCatalog: { ok: true, protocol: 1, features: ["props_contract_v1"] },
});

function albumFixture(stem, title, noun, records, fields) {
  return {
    stem, path: `${stem}.md`, title, emoji: null, summary: null, noun,
    label: null, plural: null, singular: null, dated_notes: false, legacy: [],
    schema_fingerprint: `sha256:${stem}-schema`, parent: "cash", parent_kind: "area",
    owner: "cash", root: "cash", breadcrumb: ["Cash"], fields,
    group_field: null, index_by: null, index_facets: [], records, groups: [],
    needs_status: 0, last_record: null, index: { state: "current" }, issues: [],
  };
}

function obsidianChildEnvironment(profile, shimDir, inherited = process.env) {
  const env = inherited && typeof inherited === "object" ? inherited : {};
  return {
    ...env,
    HOME: profile,
    XDG_CONFIG_HOME: path.join(profile, ".config"),
    PATH: shimDir + path.delimiter + (env.PATH || ""),
    TMPDIR: env.TMPDIR || os.tmpdir(),
  };
}

const PROBE_SOURCE = `(() => {
  const leaf = app.workspace.activeLeaf;
  const view = leaf?.view;
  const plugin = app.plugins?.plugins?.["bob-ledger-tools"] || null;
  const path = view?.file?.path || null;
  const mode = view?.getMode?.() === "preview" ? "reading"
    : view?.getState?.().source ? "source" : "live";
  const root = mode === "reading" ? (view?.previewMode?.containerEl || view?.containerEl)
    : (view?.contentEl?.querySelector?.(".markdown-source-view") || view?.containerEl);
  const visible = (node) => {
    if (!node?.getBoundingClientRect) return false;
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.display !== "none"
      && style.visibility !== "hidden" && Number(style.opacity || 1) > 0;
  };
  const embedded = (node) => Boolean(node?.closest?.(".markdown-embed, .internal-embed, .hover-popover, .canvas-node"));
  const cards = Array.from(root?.querySelectorAll?.("[data-card-kind]") || []).filter((node) => !embedded(node));
  const card = cards[0] || null;
  const details = card?.querySelector?.("[data-card-fold-role='details'][data-card-fold]") || null;
  const foldControls = Array.from(card?.querySelectorAll?.("[data-card-fold]") || []).map((button) => ({
    kind: button.getAttribute("data-card-fold"),
    role: button.getAttribute("data-card-fold-role"),
    source: button.getAttribute("data-card-fold-source"),
    text: String(button.textContent || "").replace(/\\s+/g, " ").trim(),
  }));
  const stack = card?.querySelector?.(".bob-property-card-cabinets") || root?.querySelector?.(".bob-property-card-cabinets");
  const panels = Array.from(stack?.querySelectorAll?.("[data-cabinet-kind]") || []).map((panel) => {
    const button = panel.querySelector(".bob-cabinet-toggle, [data-card-fold]");
    const body = panel.querySelector(".bob-cabinet-provider-content, .bob-cabinet-content, .bob-cabinet-drawer-inner");
    const summary = panel.querySelector(".bob-cabinet-summary");
    const attention = panel.querySelector(".bob-cabinet-attention");
    const error = panel.querySelector(".bob-cabinet-render-error");
    const callouts = Array.from(body?.querySelectorAll?.(".callout[data-callout]") || []).map((node) => ({
      kind: node.getAttribute("data-callout"), text: String(node.textContent || "").replace(/\\s+/g, " ").trim(),
      rows: node.querySelectorAll("li").length,
    }));
    return {
      kind: panel.getAttribute("data-cabinet-kind"),
      expanded: button?.getAttribute("aria-expanded") === "true",
      buttonText: String(button?.textContent || "").replace(/\\s+/g, " ").trim(),
      summary: String(summary?.textContent || "").replace(/\\s+/g, " ").trim(),
      attention: String(attention?.textContent || "").replace(/\\s+/g, " ").trim(),
      text: String(body?.textContent || "").replace(/\\s+/g, " ").trim(),
      linkCount: body?.querySelectorAll?.("a.internal-link")?.length || 0,
      bodyClass: body?.className || "",
      visible: visible(panel),
      error: String(error?.textContent || "").replace(/\\s+/g, " ").trim() || null,
      callouts,
      keycap: String(panel.querySelector(".bob-cabinet-keycap")?.textContent || "").trim(),
    };
  });
  const callouts = Array.from(root?.querySelectorAll?.(".callout[data-callout]") || [])
    .filter((node) => !embedded(node) && !node.closest?.(".bob-property-card-cabinets")).map((node) => ({
    kind: node.getAttribute("data-callout"), visible: visible(node),
    absorbed: node.classList?.contains("bob-cabinet-absorbed") === true,
    text: String(node.textContent || "").replace(/\\s+/g, " ").trim(), rows: node.querySelectorAll("li").length,
  }));
  const headings = Array.from(root?.querySelectorAll?.("h2, .cm-line") || [])
    .filter((node) => !embedded(node) && !node.closest?.(".bob-property-card-cabinets")).map((node) => ({
    text: String(node.textContent || "").replace(/\\s+/g, " ").trim(), visible: visible(node),
    absorbed: node.classList?.contains("bob-cabinet-absorbed") === true,
  }));
  const props = Array.from(card?.querySelectorAll?.("[data-cabinet-kind='properties']") || [])[0] || null;
  return {
    path, mode,
    cardKind: card?.getAttribute("data-card-kind") || null,
    cardPresent: Boolean(card),
    cardCount: cards.length,
    cardText: String(card?.textContent || "").replace(/\\s+/g, " ").trim(),
    foldControls,
    stackPresent: Boolean(stack),
    cabinetKinds: panels.map((row) => row.kind),
    panels,
    propertiesLast: panels.length > 0 && panels[panels.length - 1].kind === "properties",
    propertyExpanded: props?.querySelector(".bob-cabinet-toggle")?.getAttribute("aria-expanded") === "true",
    detailsExpanded: details?.getAttribute("aria-expanded") === "true",
    callouts, headings,
    hiddenCalloutCount: callouts.filter((row) => !row.visible).length,
    statusBarDisplay: getComputedStyle(document.querySelector(".status-bar") || document.body).display,
    fallback: Boolean(plugin?.walkerFooterOverlayFallback?.isConnected
      && plugin.walkerFooterOverlayFallback.classList?.contains("bob-walker-footer-fallback")),
    armed: Boolean(stack?.getAttribute("data-cabinet-pick") === "armed"),
    badges: Array.from(stack?.querySelectorAll?.(".bob-cabinet-keycap") || []).map((node) => String(node.textContent || "").trim()),
    footerText: String(plugin?.walkerFooterOverlayFallback?.textContent
      || plugin?.freshnessStatusEl?.querySelector?.(".bob-walker-footer-overlay")?.textContent || "")
      .replace(/\\s+/g, " ").trim(),
    scrollY: window.scrollY,
    width: card?.getBoundingClientRect?.().width || 0,
    height: card?.getBoundingClientRect?.().height || 0,
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    forcedColors: matchMedia("(forced-colors: active)").matches,
    theme: document.body.classList.contains("theme-dark") ? "dark" : "light",
  };
})()`;

function writeNote(root, notePath, content) {
  const file = path.join(root, notePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function copyPlugin(vault, id, data = null) {
  const source = path.join(repoRoot, "plugins", id);
  const target = path.join(vault, ".obsidian", "plugins", id);
  fs.mkdirSync(target, { recursive: true });
  for (const name of ["manifest.json", "main.js", "styles.css"]) {
    const file = path.join(source, name);
    if (fs.existsSync(file)) fs.copyFileSync(file, path.join(target, name));
  }
  if (data) fs.writeFileSync(path.join(target, "data.json"), JSON.stringify(data, null, 2) + "\n");
}

function writeBobFixture(profileDir) {
  const shimDir = path.join(profileDir, "shim");
  const logPath = path.join(profileDir, "bob-spawns.jsonl");
  fs.mkdirSync(shimDir, { recursive: true });
  const file = path.join(shimDir, "bob");
  fs.writeFileSync(file, `#!/usr/bin/env node\nconst fs = require("node:fs");\nconst log = ${JSON.stringify(logPath)};\nconst reports = ${JSON.stringify(FIXTURE_BOB_REPORTS)};\nconst args = process.argv.slice(2);\nconst key = args[0] === "albums" && args[1] === "list" ? "albums"\n  : args[0] === "bank" && args[1] === "config" ? "bank"\n  : ["areas", "projects", "notebooks"].includes(args[0]) && args[1] === "list" ? args[0]\n  : args[0] === "__catalog" && args[1] === "--protocol" && args[2] === "1" ? "capabilityCatalog" : null;\ntry { fs.appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), args, fixture: key }) + "\\n"); } catch (_) {}\nif (key && (key === "capabilityCatalog" || (args.includes("-f") && args.includes("json")))) { process.stdout.write(JSON.stringify(reports[key]) + "\\n"); process.exit(0); }\nprocess.stderr.write("Unexpected bob spawn in cabinet acceptance\\n");\nprocess.exit(87);\n`);
  fs.chmodSync(file, 0o755);
  return { shimDir, logPath };
}

function installVault(vault, profileDir) {
  const notes = lib.fixtureNotes();
  for (const [notePath, content] of Object.entries(notes)) writeNote(vault, notePath, content);
  const obsidian = path.join(vault, ".obsidian");
  fs.mkdirSync(obsidian, { recursive: true });
  for (const id of PLUGIN_IDS) copyPlugin(vault, id, id === PLUGIN_ID ? GATE_DATA : null);
  fs.writeFileSync(path.join(obsidian, "community-plugins.json"), JSON.stringify(PLUGIN_IDS, null, 2) + "\n");
  fs.writeFileSync(path.join(obsidian, "core-plugins.json"), JSON.stringify([
    "file-explorer", "global-search", "switcher", "page-preview", "command-palette", "properties", "canvas",
  ], null, 2) + "\n");
  fs.writeFileSync(path.join(obsidian, "app.json"), JSON.stringify({
    livePreview: true, showInlineTitle: true, propertiesInDocument: "visible", readableLineLength: true,
    vimMode: true, showLineNumber: false, showStatusBar: true, alwaysUpdateLinks: false,
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(obsidian, "appearance.json"), JSON.stringify({ cssTheme: "", theme: "moonstone" }, null, 2) + "\n");
  shared.seedProfile(profileDir, fs.realpathSync(vault));
  shared.initScratchGit(vault);
  return notes;
}

function readLog(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch (_) { return { raw: line }; }
  });
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function sourceFiles() {
  const relative = [
    "plugins/bob-ledger-tools/manifest.json", "plugins/bob-ledger-tools/main.js", "plugins/bob-ledger-tools/styles.css",
    "plugins/bob-navigation-hotkeys/manifest.json", "plugins/bob-navigation-hotkeys/main.js", "plugins/bob-navigation-hotkeys/styles.css",
    "scripts/obsidian-cabinets-e2e.cjs", "scripts/obsidian-cabinets-e2e-lib.cjs",
    "scripts/obsidian-home-cards-e2e-lib.cjs", "scripts/obsidian-record-card-e2e.cjs",
    "scripts/obsidian-record-card-e2e-lib.cjs", "scripts/obsidian-record-card-workflows.cjs",
    "scripts/obsidian-record-card-workflow-lib.cjs", "scripts/obsidian-intention-card-e2e-lib.cjs",
  ];
  return Object.fromEntries(relative.filter((name) => fs.existsSync(path.join(repoRoot, name)))
    .map((name) => [name, sha256File(path.join(repoRoot, name))]));
}

async function openAndProbe(client, notePath, mode) {
  await shared.openNote(client, notePath, mode);
  const probe = await waitFor(client, PROBE_SOURCE,
    (value) => value?.path === notePath && value?.mode === mode,
    `${mode} view for ${notePath}`, OPEN_TIMEOUT);
  await sleep(220);
  return probe;
}

function waitForChildExit(child, timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener("exit", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once("exit", onExit);
  });
}

function writeStartupDiagnostics(directory, profile, processInfo, bobLog) {
  try {
    const target = path.join(directory, "startup-diagnostics");
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "obsidian-stdout.txt"), processInfo?.stdout || "(no stdout captured)\\n");
    fs.writeFileSync(path.join(target, "obsidian-stderr.txt"), processInfo?.stderr || "(no stderr captured)\\n");
    fs.writeFileSync(path.join(target, "obsidian-process.json"), JSON.stringify(processInfo || {}, null, 2) + "\\n");
    fs.writeFileSync(path.join(target, "obsidian-exit-status.json"), JSON.stringify({
      exitCode: processInfo?.exitCode ?? null,
      signalCode: processInfo?.signalCode ?? null,
      terminationRequested: processInfo?.terminationRequested ?? null,
      exitObserved: processInfo?.exitObserved ?? false,
    }, null, 2) + "\\n");
    const profileLog = path.join(profile, "obsidian.log");
    if (fs.existsSync(profileLog)) fs.copyFileSync(profileLog, path.join(target, "obsidian-log.txt"));
    const profileState = path.join(profile, "obsidian.json");
    if (fs.existsSync(profileState)) fs.copyFileSync(profileState, path.join(target, "profile-obsidian.json"));
    if (bobLog && fs.existsSync(bobLog)) fs.copyFileSync(bobLog, path.join(target, "bob-spawns.jsonl"));
    fs.writeFileSync(path.join(target, "README.md"), [
      "# Obsidian startup diagnostics",
      "",
      "Captured by the acceptance runner after startup and during child-process cleanup.",
      "The stdout/stderr files explicitly say when the process emitted no captured output.",
      "The exit-status record distinguishes a recorded exit code from a runner-requested signal.",
      "",
    ].join("\\n"));
  } catch (_) {}
}

async function settleProbe(client, predicate, label, timeout = 5_000) {
  const deadline = Date.now() + timeout;
  let latest = null;
  do {
    latest = await client.evaluate(PROBE_SOURCE, OPEN_TIMEOUT);
    if (predicate(latest)) return latest;
    await sleep(180);
  } while (Date.now() < deadline);
  return latest;
}

async function settleExpectedCard(client, spec, mode, label) {
  return settleProbe(client, (value) => value?.path === spec.path
    && value?.mode === mode && value?.cardPresent && value?.cardKind === spec.kind
    && JSON.stringify(value?.cabinetKinds || []) === JSON.stringify(spec.cabinets),
  label || `settled ${spec.key} ${mode}`, 10_000);
}

async function openAndSettleExpectedCard(client, spec, mode, label) {
  await openAndProbe(client, spec.path, mode);
  let probe = await settleExpectedCard(client, spec, mode, label);
  const settled = probe?.path === spec.path && probe?.mode === mode
    && probe?.cardPresent && probe?.cardKind === spec.kind
    && JSON.stringify(probe?.cabinetKinds || []) === JSON.stringify(spec.cabinets);
  if (settled) return probe;
  // Reading can receive its postprocessor before Obsidian has attached the
  // preview surface. Re-open once after the bounded wait so the probe sees a
  // real settled surface instead of retaining a transient first-open miss.
  await sleep(300);
  await openAndProbe(client, spec.path, mode);
  return settleExpectedCard(client, spec, mode, `${label || `settled ${spec.key} ${mode}`} after reopen`);
}

async function settleEvaluate(client, expression, predicate, timeout = 5_000) {
  const deadline = Date.now() + timeout;
  let latest = null;
  do {
    latest = await client.evaluate(expression, OPEN_TIMEOUT);
    if (predicate(latest)) return latest;
    await sleep(180);
  } while (Date.now() < deadline);
  return latest;
}

// Content cabinets that are open but painted no body text. A blank open
// cabinet hides the catalog it stands in for, so captures must reject it.
function emptyOpenCabinets(probe) {
  const content = new Set(["areas", "projects", "notebooks", "albums", "records"]);
  return (probe?.panels || []).filter((row) => content.has(row.kind) && row.expanded && !row.error
    && String(row.text || "").trim() === "").map((row) => row.kind);
}

// Perf (records-cabinet budget): open a large catalog host in Reading from a
// neutral note and time until its rows are painted, recording long tasks.
// Gate open counts rows in the cabinet body; gate closed counts the inline
// callout the painter decorates. Returns { elapsed, rows, maxLongTask }.
async function measureCatalogPaint(client, notePath, kind, expectRows, gateOpen) {
  return client.evaluate(`(async () => {
    const state = { mode: "preview", source: false };
    const leaf = app.workspace.getLeaf(false);
    const neutral = app.vault.getAbstractFileByPath(${JSON.stringify(lib.PATHS.leaf)});
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(notePath)});
    if (!neutral || !file) return { elapsed: null, rows: 0, longTasks: [], maxLongTask: 0, error: "missing fixture" };
    await leaf.openFile(neutral, { state });
    await new Promise((resolve) => setTimeout(resolve, 500));
    const longTasks = [];
    let observer = null;
    try {
      observer = new PerformanceObserver((list) => { for (const entry of list.getEntries()) longTasks.push(Math.round(entry.duration)); });
      observer.observe({ type: "longtask" });
    } catch (_) {}
    const rows = () => {
      const root = leaf.view?.previewMode?.containerEl || leaf.view?.containerEl;
      if (!root) return 0;
      if (${gateOpen ? "true" : "false"}) {
        const body = root.querySelector(${JSON.stringify(`.bob-property-card-cabinets [data-cabinet-kind="${kind}"] .bob-cabinet-provider-content`)});
        return body ? body.querySelectorAll("li").length : 0;
      }
      const callout = Array.from(root.querySelectorAll(${JSON.stringify(`.callout[data-callout="${kind}"]`)}))
        .find((node) => !node.closest(".bob-property-card-cabinets") && node.getBoundingClientRect().height > 0);
      return callout ? callout.querySelectorAll("li").length : 0;
    };
    const started = performance.now();
    await leaf.openFile(file, { state });
    let elapsed = null;
    while (performance.now() - started < 15000) {
      if (rows() >= ${Number(expectRows)}) { elapsed = performance.now() - started; break; }
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    try { observer?.disconnect(); } catch (_) {}
    return { elapsed: elapsed == null ? null : Math.round(elapsed), rows: rows(), longTasks, maxLongTask: Math.max(0, ...longTasks) };
  })()`, 45_000);
}

async function measureCatalogRounds(client, notePath, kind, expectRows, gateOpen, rounds = 3) {
  const samples = [];
  for (let index = 0; index < rounds; index += 1) samples.push(await measureCatalogPaint(client, notePath, kind, expectRows, gateOpen));
  const times = samples.map((row) => row.elapsed).filter((value) => typeof value === "number").sort((a, b) => a - b);
  return {
    samples,
    complete: times.length === samples.length,
    median: times.length ? times[Math.floor(times.length / 2)] : null,
    maxLongTask: Math.max(0, ...samples.map((row) => row.maxLongTask || 0)),
  };
}

// The records-cabinet budget: cabinet paint at most 2x the inline paint, and
// no long task over 100 ms that the inline paint does not already have.
function perfWithinBudget(cabinet, inline) {
  if (!cabinet?.complete || !inline?.complete || !inline.median) return false;
  return cabinet.median <= 2 * inline.median
    && (cabinet.maxLongTask <= 100 || cabinet.maxLongTask <= inline.maxLongTask);
}

// Evidence for an intermittent Reading miss: what the shared property-card
// host tracks for the active note, and what the preview DOM holds.
async function readingHostDiagnostics(client, notePath) {
  try {
    return await client.evaluate(`(() => {
      const plugin = app.plugins?.plugins?.["bob-ledger-tools"];
      const view = app.workspace.activeLeaf?.view;
      const preview = view?.previewMode?.containerEl || null;
      const sizer = preview?.querySelector?.(".markdown-preview-sizer") || null;
      const widgets = Array.from(plugin?.homeCardReading || []).map((item) => ({
        path: item.path, hasSurface: Boolean(item.surface), retries: item.surfaceRetryCount ?? null,
        retryArmed: item.surfaceRetryTimer != null, elConnected: Boolean(item.el?.isConnected),
        elInPreview: Boolean(item.el?.closest?.(".markdown-preview-view")),
      }));
      return {
        notePath: ${JSON.stringify(notePath)}, activePath: view?.file?.path || null, mode: view?.getMode?.() || null,
        hostActive: plugin?.homeCardActive ?? null, widgets,
        pending: Array.from(plugin?.homeCardReadingPending?.keys?.() || []),
        previewConnected: Boolean(preview?.isConnected), previewVisible: Boolean(preview && preview.offsetParent !== null),
        sizerSections: sizer ? sizer.children.length : null,
        cards: preview ? preview.querySelectorAll(".bob-property-card").length : null,
      };
    })()`);
  } catch (error) {
    return { error: error?.message || String(error) };
  }
}

async function refreshProbe(client) {
  await sleep(100);
  return client.evaluate(PROBE_SOURCE, OPEN_TIMEOUT);
}

async function sendKey(client, key, modifiers = 0) {
  await client.evaluate(`(() => {
    const view = app.workspace.activeLeaf?.view;
    if (!view) return false;
    const mode = view.getMode?.() === "preview" ? "reading"
      : view.getState?.().source ? "source" : "live";
    if (mode === "live") {
      view.editor?.cm?.contentDOM?.focus?.();
      return true;
    }
    const target = view.previewMode?.containerEl || view.containerEl;
    if (target && typeof target.focus === "function") {
      if (!target.hasAttribute?.("tabindex")) target.setAttribute?.("tabindex", "-1");
      target.focus();
      return true;
    }
    return false;
  })()`);
  const physicalModifiers = key === "_" ? modifiers | 8 : modifiers;
  const base = key === "_" || key === "-"
    ? [
      { type: "keyDown", key, code: "Minus", modifiers: physicalModifiers,
        windowsVirtualKeyCode: 189, nativeVirtualKeyCode: 189, text: key, unmodifiedText: key },
      { type: "keyUp", key, code: "Minus", modifiers: physicalModifiers,
        windowsVirtualKeyCode: 189, nativeVirtualKeyCode: 189 },
    ]
    : periods.keyEvents(key, physicalModifiers);
  for (const event of base) await client.call("Input.dispatchKeyEvent", event);
  await sleep(90);
}

async function clickSelector(client, selector, occurrence = 0) {
  const point = await settleEvaluate(client, `(() => {
    const view = app.workspace.activeLeaf?.view;
    const mode = view?.getMode?.() === "preview" ? "reading"
      : view?.getState?.().source ? "source" : "live";
    const root = mode === "reading" ? (view?.previewMode?.containerEl || view?.containerEl)
      : (view?.contentEl?.querySelector?.(".markdown-source-view") || view?.containerEl);
    const visible = (node) => {
      if (!node?.getBoundingClientRect) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none"
        && style.visibility !== "hidden" && !node.closest?.(".markdown-embed, .internal-embed, .hover-popover, .canvas-node");
    };
    const nodes = Array.from(root?.querySelectorAll?.(${JSON.stringify(selector)}) || []).filter(visible);
    const node = nodes[${occurrence}] || null;
    if (!node) return null;
    node.scrollIntoView({ block: "nearest" });
    const rect = node.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`, (value) => Boolean(value), 5_000);
  if (!point) throw new Error(`Could not find clickable ${selector}[${occurrence}]`);
  await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await client.call("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await sleep(180);
}

async function clickCabinetToggle(client, kind) {
  return client.evaluate(`(() => {
    const view = app.workspace.activeLeaf?.view;
    const root = view?.getMode?.() === "preview"
      ? (view?.previewMode?.containerEl || view?.containerEl)
      : (view?.contentEl?.querySelector?.(".markdown-source-view") || view?.containerEl);
    const panel = root?.querySelector?.(${JSON.stringify(`[data-cabinet-kind="${kind}"]`)});
    const control = panel?.querySelector?.(".bob-cabinet-toggle");
    if (!control) return { found: false, before: null, after: null };
    const before = control.getAttribute("aria-expanded") === "true";
    control.click();
    return { found: true, before, after: control.getAttribute("aria-expanded") === "true" };
  })()`);
}

async function resetPanels(client) {
  let probe = await refreshProbe(client);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const expanded = (probe.panels || []).filter((panel) => panel.expanded);
    if (!expanded.length) return probe;
    for (const panel of expanded) await clickCabinetToggle(client, panel.kind);
    probe = await settleProbe(client, (value) => Array.isArray(value?.panels)
      && value.panels.every((panel) => !panel.expanded), "all active-view cabinets closed", 5_000);
    if ((probe.panels || []).every((panel) => !panel.expanded)) return probe;
  }
  probe.resetFailure = "One or more active-view cabinets stayed open after three close attempts";
  return probe;
}

async function setMode(client, notePath, mode) {
  return openAndProbe(client, notePath, mode);
}

async function run(args) {
  const executable = args.executable || process.env.OBSIDIAN_BIN || ELECTRON_FALLBACK;
  if (!process.env.DISPLAY) throw new Error("No DISPLAY; run real acceptance with xvfb-run");
  fs.accessSync(executable, fs.constants.X_OK);
  const outDir = path.resolve(args.out || path.join(os.tmpdir(), `bob-cabinets-shots-${crypto.randomBytes(4).toString("hex")}`));
  const reportPath = path.resolve(args.report || path.join(outDir, "cabinets-e2e.json"));
  fs.mkdirSync(outDir, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "bob-cabinets-e2e-"));
  const vault = path.join(scratch, "vault");
  const profile = path.join(scratch, "profile");
  fs.mkdirSync(vault, { recursive: true });
  fs.mkdirSync(profile, { recursive: true });
  const notes = installVault(vault, profile);
  const { shimDir, logPath } = writeBobFixture(profile);
  const protectedHashes = shared.markdownFilesHash(vault);
  const report = {
    startedAt: new Date().toISOString(),
    verdict: "NO-GO",
    gates: GATE_DATA,
    source: {
      head: require("node:child_process").spawnSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim()
        || process.env.BOB_CABINETS_SOURCE_HEAD || null,
      dirtyPaths: require("node:child_process").spawnSync("git", ["-C", repoRoot, "status", "--porcelain"], { encoding: "utf8" }).stdout.trim().split("\n").filter(Boolean)
        .concat(process.env.BOB_CABINETS_DIRTY_PATHS ? process.env.BOB_CABINETS_DIRTY_PATHS.split(",").filter(Boolean) : []),
      files: sourceFiles(),
    },
    scratch: { root: scratch, vault: fs.realpathSync(vault), profile, fixturePaths: Object.keys(notes).sort() },
    checks: [], screenshots: [], consoleExceptions: [], consoleErrors: [], bobSpawns: [],
  };
  let child = null;
  let childStdout = "";
  let childStderr = "";
  let client = null;
  let successful = false;
  const check = (name, ok, detail = null) => {
    report.checks.push({ name, status: ok ? "pass" : "fail", mandatory: true, detail });
    return ok;
  };
  try {
    const port = await shared.freePort();
    child = spawn(executable, [
      "--no-sandbox", `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
      "--remote-allow-origins=http://127.0.0.1/*", fs.realpathSync(vault),
    ], {
      cwd: os.tmpdir(),
      env: obsidianChildEnvironment(profile, shimDir),
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => {
      if (childStdout.length < 12_000) childStdout += String(chunk).slice(0, 12_000 - childStdout.length);
    });
    child.stderr.on("data", (chunk) => {
      if (childStderr.length < 12_000) childStderr += String(chunk).slice(0, 12_000 - childStderr.length);
    });
    child.on("error", (error) => {
      if (childStderr.length < 12_000) childStderr += String(error.stack || error).slice(0, 12_000 - childStderr.length);
    });
    report.obsidianProcess = { pid: child.pid, executable, profile };
    let target;
    try {
      target = await shared.selectTarget(port, fs.realpathSync(vault), () => child && child.exitCode == null);
    } catch (error) {
      const profileLog = path.join(profile, "obsidian.log");
      report.obsidianProcess.exitCode = child.exitCode;
      report.obsidianProcess.signalCode = child.signalCode;
      report.obsidianProcess.stdout = childStdout || null;
      report.obsidianProcess.stderr = childStderr || null;
      report.obsidianProcess.startupLog = fs.existsSync(profileLog)
        ? fs.readFileSync(profileLog, "utf8").slice(-12_000)
        : null;
      throw new Error(`${error.message}; Obsidian startup diagnostics: ${JSON.stringify(report.obsidianProcess)}`);
    }
    client = target.client;
    await client.call("Runtime.enable");
    await client.call("Page.enable");
    client.on("Runtime.exceptionThrown", (row) => report.consoleExceptions.push(row.exceptionDetails?.text || "runtime exception"));
    client.on("Runtime.consoleAPICalled", (row) => {
      if (row.type !== "error") return;
      const text = (row.args || []).map((arg) => arg.value ?? arg.description ?? "").filter(Boolean).join(" ");
      report.consoleErrors.push({
        text: text || "console.error",
        url: row.stackTrace?.callFrames?.[0]?.url || null,
        lineNumber: row.stackTrace?.callFrames?.[0]?.lineNumber ?? null,
      });
    });
    await shared.trustCommunityPlugins(client);
    await sleep(1_000);
    const pluginLoaded = await client.evaluate(`Boolean(app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}])`);
    check("plugins-loaded", pluginLoaded, { enabled: PLUGIN_IDS });

    // Render every hosted note in both real surfaces, checking species, stack order, and defaults.
    const renderRows = [];
    for (const spec of lib.SPECS) {
      for (const mode of ["live", "reading"]) {
        const probe = await openAndSettleExpectedCard(client, spec, mode);
        const row = { fixture: spec.key, path: spec.path, mode, actualKind: probe.cardKind,
          expectedKind: spec.kind, cabinets: probe.cabinetKinds, expectedCabinets: spec.cabinets,
          propertiesLast: probe.propertiesLast, foldControls: probe.foldControls };
        if (spec.key === "empty-album" && mode === "reading") {
          row.albumDiagnostics = await client.evaluate(`(() => {
            const plugin = app.plugins?.plugins?.["bob-ledger-tools"];
            const path = ${JSON.stringify(spec.path)};
            const file = app.vault?.getAbstractFileByPath?.(path) || null;
            const cache = file ? app.metadataCache?.getFileCache?.(file) : null;
            const state = plugin?.albumHeaderState?.() || null;
            const cachedSource = plugin?.albumHeaderSourceCache?.get?.(path) || null;
            const metadataCard = plugin?.albumHeaderCardModelFor?.(path, state) || null;
            const sourceCard = cachedSource ? plugin?.albumHeaderCardModelFor?.(path, state, cachedSource) || null : null;
            const reportEntry = Array.isArray(state?.report?.albums)
              ? state.report.albums.find((entry) => entry.path === path || entry.stem === "empty") || null : null;
            return {
              file: Boolean(file),
              frontmatterType: cache?.frontmatter?.type ?? null,
              cachedSource: Boolean(cachedSource),
              sourceHasAlbumType: typeof cachedSource === "string" && /type:\\s*['\"]?\\[\\[album\\]\\]/i.test(cachedSource),
              metadataCard: metadataCard ? { title: metadataCard.title, body: Boolean(metadataCard.body) } : null,
              sourceCard: sourceCard ? { title: sourceCard.title, body: Boolean(sourceCard.body) } : null,
              reportEntry: reportEntry ? { path: reportEntry.path, stem: reportEntry.stem, records: reportEntry.records } : null,
              pluginActive: plugin?.albumHeaderActive === true,
              readingWidgets: Array.from(plugin?.albumHeaderReading || []).map((item) => ({ path: item.path, hasSurface: Boolean(item.surface) })),
            };
          })()`);
        }
        const rendered = probe.cardPresent && probe.cardKind === spec.kind
          && JSON.stringify(probe.cabinetKinds) === JSON.stringify(spec.cabinets)
          && (spec.cabinets.length === 0 || probe.propertiesLast);
        if (!rendered && mode === "reading") row.readingDiagnostics = await readingHostDiagnostics(client, spec.path);
        renderRows.push(row);
        check(`render-${spec.key}-${mode}`, rendered, row);
      }
    }
    report.renderMatrix = renderRows;
    const areaTitleProbe = await openAndProbe(client, lib.PATHS.area, "live");
    for (const kind of ["areas", "projects"]) {
      if (areaTitleProbe.panels.find((row) => row.kind === kind)?.expanded === false) await clickCabinetToggle(client, kind);
    }
    const areasTitleRows = await client.evaluate(`(() => {
      const stack = document.querySelector('.bob-property-card-cabinets');
      const rows = ["areas", "projects"].map((kind) => {
        const panel = stack?.querySelector('[data-cabinet-kind="' + kind + '"]');
        const duplicate = panel?.querySelector(kind === "areas" ? ".bob-areas-header" : ".bob-projects-header");
        return { kind, cabinetHeader: Boolean(panel?.querySelector(".bob-cabinet-head")), duplicatePresent: Boolean(duplicate), duplicateVisible: Boolean(duplicate && getComputedStyle(duplicate).display !== "none") };
      });
      return rows;
    })()`);
    check("areas-cabinet-single-title-row", areasTitleRows.length === 2 && areasTitleRows.every((row) => row.cabinetHeader && !row.duplicateVisible), areasTitleRows);
    const untyped = await openAndProbe(client, lib.PATHS.untyped, "reading");
    check("untyped-area-fails-open", !untyped.cardPresent && !untyped.stackPresent, untyped);

    // Defaults and provider summaries on the representative high-content cards.
    let probe = await openAndProbe(client, lib.PATHS.album, "live");
    const recordsPanel = probe.panels.find((row) => row.kind === "records");
    const schemaPanel = probe.panels.find((row) => row.kind === "schema");
    check("album-records-open-schema-closed", recordsPanel?.expanded === true && schemaPanel?.expanded === false,
      { records: recordsPanel, schema: schemaPanel });
    probe = await openAndProbe(client, lib.PATHS.bank, "live");
    check("bank-setup-default-closed", probe.panels.find((row) => row.kind === "setup")?.expanded === false, probe.panels);
    probe = await openAndProbe(client, lib.PATHS.prose, "live");
    check("outline-default-closed", probe.panels.find((row) => row.kind === "outline")?.expanded === false, probe.panels);
    probe = await openAndProbe(client, lib.PATHS.area, "live");
    const areaPanels = probe.panels.filter((row) => row.kind !== "properties");
    check("area-summaries-visible", areaPanels.length === 4 && areaPanels.every((row) => row.summary || row.attention), areaPanels);
    probe = await openAndProbe(client, lib.PATHS.project, "live");
    const projectPanel = probe.panels.find((row) => row.kind === "projects");
    check("project-64-line-summary-and-attention", Boolean(projectPanel && (projectPanel.summary || projectPanel.attention)), projectPanel);

    // Perf, gate open: the 106-record album (Records open by default) and the
    // 64-row Projects host with its Projects cabinet open.
    await openAndSettleExpectedCard(client, lib.SPECS.find((row) => row.path === lib.PATHS.project), "reading", "perf project warm-up");
    probe = await refreshProbe(client);
    if (probe.panels.find((row) => row.kind === "projects")?.expanded === false) await clickCabinetToggle(client, "projects");
    const perfCabinet = {
      album: await measureCatalogRounds(client, lib.PATHS.album, "records", 106, true),
      project: await measureCatalogRounds(client, lib.PATHS.project, "projects", 64, true),
    };

    // Gate-closed native rendering gives a real same-vault baseline for byte and row parity.
    const pluginData = path.join(vault, ".obsidian", "plugins", PLUGIN_ID, "data.json");
    const gateClosed = { cabinetsPreview: false, cardPreviewKinds: [], refCardPreview: false };
    await client.evaluate(`app.plugins.disablePlugin(${JSON.stringify(PLUGIN_ID)})`);
    fs.writeFileSync(pluginData, JSON.stringify(gateClosed, null, 2) + "\n");
    await client.evaluate(`app.plugins.enablePlugin(${JSON.stringify(PLUGIN_ID)})`);
    await sleep(1_000);
    probe = await openAndProbe(client, lib.PATHS.area, "reading");
    probe = await settleProbe(client, (value) => value?.path === lib.PATHS.area
      && value?.mode === "reading"
      && ["areas", "projects", "notebooks", "albums"].every((kind) => {
        const row = value.callouts?.find((candidate) => candidate.kind === kind);
        return row?.visible === true && !/refreshing|loading/i.test(row.text || "");
      }), "gate-closed native catalog body finished refreshing", 12_000);
    const inlineBaseline = Object.fromEntries(probe.callouts.map((row) => [row.kind, { text: row.text, rows: row.rows, visible: row.visible }]));
    check("gate-closed-inline-baseline", !probe.stackPresent && ["areas", "projects", "notebooks", "albums"].every((kind) => inlineBaseline[kind]?.visible), inlineBaseline);
    const perfInline = {
      album: await measureCatalogRounds(client, lib.PATHS.album, "records", 106, false),
      project: await measureCatalogRounds(client, lib.PATHS.project, "projects", 64, false),
    };
    report.perf = { cabinet: perfCabinet, inline: perfInline, budget: "cabinet median <= 2x inline median; no added long task over 100 ms" };
    check("perf-106-record-album-within-budget", perfWithinBudget(perfCabinet.album, perfInline.album),
      { cabinet: perfCabinet.album, inline: perfInline.album });
    check("perf-64-line-projects-host-within-budget", perfWithinBudget(perfCabinet.project, perfInline.project),
      { cabinet: perfCabinet.project, inline: perfInline.project });
    await client.evaluate(`app.plugins.disablePlugin(${JSON.stringify(PLUGIN_ID)})`);
    fs.writeFileSync(pluginData, JSON.stringify(GATE_DATA, null, 2) + "\n");
    await client.evaluate(`app.plugins.enablePlugin(${JSON.stringify(PLUGIN_ID)})`);
    await sleep(900);
    const areaSpec = lib.SPECS.find((row) => row.path === lib.PATHS.area);
    probe = await openAndSettleExpectedCard(client, areaSpec, "reading", "reopened area Reading card after plugin reload");
    const parityReady = probe?.cardPresent && probe.cardKind === areaSpec.kind
      && JSON.stringify(probe.cabinetKinds || []) === JSON.stringify(areaSpec.cabinets);
    check("area-reading-ready-after-plugin-reload", parityReady,
      parityReady ? probe : { ...probe, readingDiagnostics: await readingHostDiagnostics(client, lib.PATHS.area) });
    const contentParity = [];
    for (const kind of ["areas", "projects", "notebooks", "albums"]) {
      const panel = probe.panels.find((row) => row.kind === kind);
      if (!panel) {
        contentParity.push({ kind, baselineRows: inlineBaseline[kind]?.rows,
          baselineVisible: inlineBaseline[kind]?.visible, cabinetText: null,
          drawerExpanded: false, textContainsBaseline: false,
          runnerIssue: "cabinet panel absent from settled Reading view" });
        continue;
      }
      if (!panel.expanded) {
        const clicked = await clickCabinetToggle(client, kind);
        if (!clicked.found) {
          contentParity.push({ kind, baselineRows: inlineBaseline[kind]?.rows,
            baselineVisible: inlineBaseline[kind]?.visible, cabinetText: null,
            drawerExpanded: false, textContainsBaseline: false,
            runnerIssue: "Could not find a mounted cabinet toggle in the active Markdown view" });
          continue;
        }
      }
      let opened = await settleProbe(client, (value) =>
        value?.panels?.find((row) => row.kind === kind)?.expanded === true,
      `opened ${kind} cabinet for parity`, 5_000);
      if (opened.panels.find((row) => row.kind === kind)?.expanded !== true) {
        const retry = await clickCabinetToggle(client, kind);
        if (retry.found) {
          opened = await settleProbe(client, (value) =>
            value?.panels?.find((row) => row.kind === kind)?.expanded === true,
          `opened ${kind} cabinet after re-reading its mounted control`, 5_000);
        }
      }
      if (opened.panels.find((row) => row.kind === kind)?.expanded !== true) {
        contentParity.push({ kind, baselineRows: inlineBaseline[kind]?.rows,
          baselineVisible: inlineBaseline[kind]?.visible, cabinetText: null,
          drawerExpanded: false, textContainsBaseline: false,
          runnerIssue: "Cabinet toggle did not settle open before parity sampling" });
        continue;
      }
      const mounted = await settleProbe(client, (value) => {
        const candidate = value?.panels?.find((row) => row.kind === kind);
        return candidate?.expanded === true
          && (candidate?.linkCount > 0 || candidate?.text || Boolean(candidate?.error));
      }, `rendered ${kind} cabinet body`, 8_000);
      const bodyPanel = mounted.panels.find((row) => row.kind === kind);
      const baseline = inlineBaseline[kind];
      const comparableText = (text) => String(text || "")
        .replace(new RegExp(kind, "ig"), "")
        .replace(/Refreshing\s+[^…]+…?/gi, "")
        .replace(/[＋+]\s*project\b/gi, "")
        .replace(/\s+/g, " ").trim();
      const baselineText = comparableText(baseline?.text);
      const cabinetText = comparableText(bodyPanel?.text);
      contentParity.push({ kind, baselineRows: baseline?.rows, cabinetRows: bodyPanel?.linkCount,
        baselineVisible: baseline?.visible, cabinetText: cabinetText || null,
        baselineText,
        bodyClass: bodyPanel?.bodyClass || "",
        drawerExpanded: bodyPanel?.expanded === true,
        textContainsBaseline: Boolean(baselineText && cabinetText
          && cabinetText.includes(baselineText.slice(0, 16))) });
    }
    check("area-content-parity-gate-closed", contentParity.length === 4
      && contentParity.every((row) => row.baselineVisible && row.drawerExpanded
        && row.baselineRows === row.cabinetRows && row.textContainsBaseline), contentParity);
    report.contentParity = contentParity;

    // Full key ownership matrix: zero, one, and multiple extras; digits, aliases, cancel, modifiers, and lifecycle.
    const keyChecks = [];
    const keyCheck = (name, ok, detail = null) => keyChecks.push({ name, status: ok ? "pass" : "fail", detail });
    await openAndProbe(client, lib.PATHS.leaf, "live");
    const leafBefore = await refreshProbe(client);
    await sendKey(client, "_");
    probe = await refreshProbe(client);
    keyCheck("zero-extra-underscore-details-fallback", probe.cardKind === "project"
      && probe.detailsExpanded !== leafBefore.detailsExpanded, { before: leafBefore, after: probe });
    const compactDetailsKinds = new Set(["project", "notebook", "record", "ref"]);
    for (const spec of lib.SPECS.filter((row) => row.key !== "leaf"
      && row.cabinets.length === 1 && compactDetailsKinds.has(row.kind))) {
      await openAndProbe(client, spec.path, "live");
      const before = await refreshProbe(client);
      await sendKey(client, "_");
      const after = await refreshProbe(client);
      keyCheck(`zero-extra-fallback-${spec.key}`, before.cardKind === spec.kind
        && after.detailsExpanded !== before.detailsExpanded, { before, after });
    }
    await openAndProbe(client, lib.PATHS.singleArea, "live");
    await resetPanels(client);
    await sendKey(client, "_");
    probe = await settleProbe(client, (value) => value?.panels?.find((row) => row.kind === "projects")?.expanded === true
      && !value.armed, "single-area project toggled by underscore", 5_000);
    keyCheck("one-extra-area-underscore-direct-toggle", probe.panels.find((row) => row.kind === "projects")?.expanded === true && !probe.armed, probe);
    await openAndProbe(client, lib.PATHS.bank, "live");
    await resetPanels(client);
    await sendKey(client, "_");
    probe = await settleProbe(client, (value) => value?.panels?.find((row) => row.kind === "setup")?.expanded === true,
      "bank setup toggled by underscore", 5_000);
    keyCheck("one-extra-underscore-toggles-setup", probe.panels.find((row) => row.kind === "setup")?.expanded === true, probe.panels);
    await openAndProbe(client, lib.PATHS.area, "live");
    await resetPanels(client);
    await sendKey(client, "_");
    probe = await settleProbe(client, (value) => value?.armed === true,
      "area cabinet picker armed", 5_000);
    keyCheck("multi-extra-underscore-arms", probe.armed && probe.badges.includes("1") && probe.badges.includes("4"), probe);
    await sleep(175);
    probe = await refreshProbe(client);
    keyCheck("pick-overlay-after-150ms", probe.armed && Boolean(probe.footerText), probe.footerText);
    const areaOrder = ["areas", "projects", "notebooks", "albums"];
    const numbered = areaOrder.slice().reverse();
    for (let digit = 1; digit <= 4; digit += 1) {
      if (probe.armed) {
        await sendKey(client, "Escape");
        probe = await settleProbe(client, (value) => value?.armed === false,
          `disarmed picker before digit ${digit}`, 5_000);
      }
      probe = await resetPanels(client);
      const closedBefore = (probe.panels || []).every((panel) => !panel.expanded);
      if (!closedBefore) throw new Error(`Could not reset cabinets before digit ${digit}: ${JSON.stringify(probe.panels)}`);
      await sendKey(client, "_");
      probe = await settleProbe(client, (value) => value?.armed === true,
        `armed cabinet picker before digit ${digit}`, 5_000);
      const armedBefore = probe.armed === true;
      await sendKey(client, String(digit));
      probe = await settleProbe(client, (value) => !value?.armed
        && value?.panels?.find((row) => row.kind === numbered[digit - 1])?.expanded === true,
      `cabinet ${numbered[digit - 1]} opened by digit ${digit}`, 5_000);
      keyCheck(`digit-${digit}-toggles-${numbered[digit - 1]}-and-disarms`, !probe.armed
        && probe.panels.find((row) => row.kind === numbered[digit - 1])?.expanded === true,
      { closedBefore, armedBefore, panels: probe.panels });
    }
    for (const key of ["0", "9"]) {
      if (!probe.armed) await sendKey(client, "_");
      await sendKey(client, key);
      probe = await refreshProbe(client);
      keyCheck(`out-of-range-${key}-stays-armed`, probe.armed, probe);
      await sendKey(client, "Escape");
      probe = await refreshProbe(client);
    }
    await resetPanels(client);
    for (const key of ["_", "-"]) {
      await sendKey(client, "_");
      await sendKey(client, key);
      if (key === "_") {
        probe = await settleProbe(client, (value) => !value?.armed
          && value?.panels?.find((row) => row.kind === "albums")?.expanded === true,
        "double underscore toggled the first cabinet", 5_000);
      } else {
        probe = await settleProbe(client, (value) => !value?.armed && value?.propertyExpanded,
          "armed minus toggled Properties", 5_000);
      }
      keyCheck(key === "_" ? "double-underscore-toggles-number-one" : "armed-minus-toggles-properties",
        !probe.armed && (key === "_" ? probe.panels.find((row) => row.kind === "albums")?.expanded === true : probe.propertyExpanded), probe);
    }
    for (const [name, key, modifiers] of [
      ["escape", "Escape", 0], ["q", "q", 0], ["Q", "Q", 0], ["ctrl-bracket", "[", 2],
      ["alt", "F12", 1], ["meta", "F12", 4], ["ctrl", "F12", 2], ["other-key", "F12", 0],
    ]) {
      await sendKey(client, "_");
      await sendKey(client, key, modifiers);
      probe = await refreshProbe(client);
      keyCheck(`cancel-${name}`, !probe.armed, probe);
    }
    // A fast `_1` completes before the delayed footer can flash.
    await openAndProbe(client, lib.PATHS.area, "live");
    await resetPanels(client);
    await sendKey(client, "_");
    await sendKey(client, "1");
    probe = await refreshProbe(client);
    keyCheck("fast-underscore-one-no-overlay-flash", !probe.armed && !probe.footerText, probe);
    // Palette command arms in Reading. The walker-footer overlay is an
    // aria-live status message, not an interactive chip; choose a cabinet by
    // its advertised number through the same keyboard path as Live Preview.
    await openAndProbe(client, lib.PATHS.area, "reading");
    await resetPanels(client);
    const command = await client.evaluate(`app.commands.executeCommandById(${JSON.stringify(`${PLUGIN_ID}:toggle-card-details`)})`);
    probe = await settleProbe(client, (value) => value?.armed === true,
      "Reading palette command armed cabinet picker", 5_000);
    keyCheck("reading-palette-arms-pick", command !== false && probe.armed, { command, probe });
    if (probe.armed) {
      probe = await settleProbe(client, (value) => value?.armed === true
        && value.footerText.includes("1 Albums") && value.footerText.includes("2 Notebooks")
        && value.footerText.includes("3 Projects") && value.footerText.includes("4 Areas"),
      "Reading pick overlay lists numbered kinds", 5_000);
      keyCheck("reading-pick-overlay-lists-numbered-kinds",
        probe.armed && probe.footerText.includes("1 Albums") && probe.footerText.includes("2 Notebooks")
          && probe.footerText.includes("3 Projects") && probe.footerText.includes("4 Areas"), probe.footerText);
      await sendKey(client, "1");
      probe = await settleProbe(client, (value) => !value?.armed
        && value?.panels?.find((row) => row.kind === "albums")?.expanded === true,
      "Reading digit one opened Albums", 5_000);
      keyCheck("reading-palette-number-picks-and-disarms",
        !probe.armed && probe.panels.find((row) => row.kind === "albums")?.expanded === true, probe);
    }
    // Status bar hidden: the view-local fallback stays available for the armed pick.
    await client.evaluate(`document.querySelector(".status-bar")?.style.setProperty("display", "none", "important")`);
    await client.evaluate(`app.commands.executeCommandById(${JSON.stringify(`${PLUGIN_ID}:toggle-card-details`)})`);
    probe = await settleProbe(client, (value) => value?.armed === true && value?.fallback === true,
      "hidden status bar rendered the view fallback", 5_000);
    keyCheck("hidden-status-bar-uses-fallback-strip", probe.armed && probe.fallback, probe);
    await sendKey(client, "Escape");
    await client.evaluate(`document.querySelector(".status-bar")?.style.removeProperty("display")`);
    // File, view-mode, and blur lifecycle all release the transient pick.
    await openAndProbe(client, lib.PATHS.area, "live");
    await sendKey(client, "_");
    await openAndProbe(client, lib.PATHS.project, "live");
    probe = await refreshProbe(client);
    keyCheck("file-change-disarms", !probe.armed, probe);
    await openAndProbe(client, lib.PATHS.area, "live");
    await sendKey(client, "_");
    await setMode(client, lib.PATHS.area, "reading");
    probe = await refreshProbe(client);
    keyCheck("mode-change-disarms", !probe.armed, probe);
    await openAndProbe(client, lib.PATHS.area, "live");
    await sendKey(client, "_");
    await client.evaluate("document.activeElement?.blur(); window.dispatchEvent(new Event('blur'))");
    probe = await refreshProbe(client);
    keyCheck("window-blur-disarms", !probe.armed, probe);
    for (const row of keyChecks) check(`keys-${row.name}`, row.status === "pass", row.detail);
    report.keyMatrix = keyChecks;

    // Absorption and fail-open contexts: stored bytes stay available in source, embeds, hover, print, malformed input, and teardown.
    const failOpen = [];
    const failOpenCheck = (name, ok, detail) => failOpen.push({ name, status: ok ? "pass" : "fail", detail });
    // Live Preview hides every claimed catalog at once (one claim per kind in
    // the editor), not just the last cabinet mounted; authored sections stay.
    await openAndProbe(client, lib.PATHS.area, "live");
    probe = await refreshProbe(client);
    const managedKinds = ["areas", "projects", "notebooks", "albums"];
    const liveAbsorption = (row) => {
      const stored = row.callouts.filter((callout) => managedKinds.includes(callout.kind));
      const headings = row.headings.map((heading) => ({ ...heading, label: heading.text.replace(/^#+\s*/, "").trim() }));
      const managed = headings.filter((heading) => ["Areas", "Projects", "Notebooks", "Albums"].includes(heading.label));
      const notes = headings.filter((heading) => heading.label === "Notes");
      return {
        ok: row.stackPresent && stored.every((callout) => !callout.visible) && managed.every((heading) => !heading.visible)
          && notes.some((heading) => heading.visible),
        detail: { liveStored: stored, liveManagedHeadings: managed, notes, cabinetKinds: row.cabinetKinds },
      };
    };
    const liveFirst = liveAbsorption(probe);
    failOpenCheck("live-preview-hides-managed-headings-and-callouts", liveFirst.ok, liveFirst.detail);
    // A toggle repaints the card: the new stack claims before the old stack
    // releases, and the stored sections must stay hidden across that swap.
    const clickNotebooks = `(() => {
      const view = app.workspace.activeLeaf?.view;
      const root = view?.contentEl || view?.containerEl;
      const button = root?.querySelector?.('.bob-property-card-cabinets [data-cabinet-kind="notebooks"] .bob-cabinet-toggle');
      button?.click();
      return button?.getAttribute?.("aria-expanded") || null;
    })()`;
    const notebooksBefore = probe.panels.find((row) => row.kind === "notebooks")?.expanded;
    const clickedTo = await client.evaluate(clickNotebooks);
    await sleep(600);
    probe = await refreshProbe(client);
    const liveRepainted = liveAbsorption(probe);
    const notebooksAfter = probe.panels.find((row) => row.kind === "notebooks")?.expanded;
    failOpenCheck("live-preview-absorption-survives-cabinet-repaint", liveRepainted.ok
      && typeof notebooksBefore === "boolean" && notebooksAfter === !notebooksBefore,
    { ...liveRepainted.detail, notebooksBefore, notebooksAfter, clickedTo });
    await client.evaluate(clickNotebooks);
    await sleep(400);
    await openAndProbe(client, lib.PATHS.area, "reading");
    probe = await refreshProbe(client);
    const managedHeadings = probe.headings.filter((row) => ["Areas", "Projects", "Notebooks", "Albums"].includes(row.text.trim()));
    failOpenCheck("reading-hides-managed-headings-and-callouts", probe.callouts.length >= 4
      && probe.callouts.every((row) => row.absorbed && !row.visible)
      && managedHeadings.length >= 4 && managedHeadings.every((row) => row.absorbed && !row.visible), probe);
    // bob's projects writer nests closed rows under a link-free `**Closed**`
    // label. That catalog is still bob-owned, so it absorbs; authored prose
    // under the same H2 keeps the heading visible.
    await openAndProbe(client, lib.PATHS.project, "reading");
    probe = await refreshProbe(client);
    const projectStored = probe.callouts.filter((row) => row.kind === "projects");
    const projectHeadings = probe.headings.filter((row) => row.text.trim() === "Projects");
    const projectCabinet = probe.panels.find((row) => row.kind === "projects");
    failOpenCheck("closed-group-catalog-absorbed-with-kept-heading", projectStored.length === 1
      && projectStored.every((row) => row.absorbed && !row.visible)
      && projectHeadings.length >= 1 && projectHeadings.every((row) => row.visible && !row.absorbed)
      && Boolean(projectCabinet) && !projectCabinet.error,
    { projectStored, projectHeadings, projectCabinet: projectCabinet && { ...projectCabinet, text: undefined } });
    await openAndProbe(client, lib.PATHS.area, "source");
    probe = await refreshProbe(client);
    failOpenCheck("source-shows-stored-section", !probe.stackPresent && probe.headings.some((row) => row.text.includes("## Projects") && row.visible), probe);
    await openAndProbe(client, lib.PATHS.embed, "reading");
    const embeddedProbe = await settleEvaluate(client, `(() => {
      const view = app.workspace.activeLeaf?.view;
      const root = view?.previewMode?.containerEl || view?.containerEl;
      const visible = (node) => {
        if (!node?.getBoundingClientRect) return false;
        const rect = node.getBoundingClientRect(); const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const embed = Array.from(root?.querySelectorAll?.(".markdown-embed, .internal-embed") || []).find(visible);
      if (!embed) return { present: false, text: "", headings: [], cabinetStack: false, href: null };
      return {
        present: true,
        href: embed.getAttribute("data-href") || embed.querySelector(".markdown-embed-link")?.getAttribute("href") || null,
        text: String(embed.textContent || "").replace(/\\s+/g, " ").trim(),
        headings: Array.from(embed.querySelectorAll("h2")).map((node) => String(node.textContent || "").trim()),
        cabinetStack: Boolean(embed.querySelector(".bob-property-card-cabinets")),
      };
    })()`, (value) => value?.present && value.text.includes("Project catalog sentinel"), 7_000);
    const embeddedStored = Boolean(embeddedProbe?.present
      && embeddedProbe.headings.includes("Areas") && embeddedProbe.headings.includes("Projects")
      && embeddedProbe.text.includes("Household systems") && embeddedProbe.text.includes("Project catalog sentinel")
      && !embeddedProbe.cabinetStack);
    probe = await refreshProbe(client);
    failOpenCheck("embed-shows-stored-catalog", embeddedStored, { probe, embeddedProbe });
    await openAndProbe(client, lib.PATHS.ordinary, "reading");
    const hoverReady = await client.evaluate(`(() => {
      const view = app.workspace.activeLeaf?.view;
      const root = view?.previewMode?.containerEl || view?.containerEl;
      const link = Array.from(root?.querySelectorAll?.("a.internal-link") || []).find((node) => {
        const rect = node.getBoundingClientRect(); const style = getComputedStyle(node);
        return (node.getAttribute("href") || "").includes("cash") && rect.width > 0 && rect.height > 0
          && style.display !== "none" && !node.closest?.(".markdown-embed, .internal-embed");
      });
      if (!link) return false;
      link.scrollIntoView({ block: "center" });
      const r = link.getBoundingClientRect();
      window.__bobHoverPoint = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      window.__bobHoverHref = link.getAttribute("href");
      return true;
    })()`);
    if (hoverReady) {
      const point = await client.evaluate("window.__bobHoverPoint");
      await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: 4, y: 4, buttons: 0 });
      await sleep(100);
      await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, buttons: 0 });
      await sleep(800);
    }
    const hoverProbe = await settleEvaluate(client, `(() => {
      const visible = (node) => {
        if (!node?.getBoundingClientRect) return false;
        const rect = node.getBoundingClientRect(); const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const popover = Array.from(document.querySelectorAll(".hover-popover")).find(visible);
      return { present: Boolean(popover), text: String(popover?.textContent || "").replace(/\\s+/g, " ").trim(),
        headings: Array.from(popover?.querySelectorAll?.("h2") || []).map((node) => String(node.textContent || "").trim()),
        callouts: Array.from(popover?.querySelectorAll?.('.callout[data-callout="projects"]') || []).map((node) => String(node.textContent || "").trim()),
        cabinetStack: Boolean(popover?.querySelector?.(".bob-property-card-cabinets")) };
    })()`, (value) => value?.present && !value?.cabinetStack
      && (value.headings?.includes("Projects") || value.text?.includes("Project catalog sentinel")), 5_000);
    const hoverStored = hoverProbe.present && !hoverProbe.cabinetStack
      && (hoverProbe.headings.includes("Projects") || hoverProbe.text.includes("Project catalog sentinel"));
    const hoverHref = await client.evaluate("window.__bobHoverHref || null");
    const pagePreviewEnabled = await client.evaluate(`Boolean(app.internalPlugins?.plugins?.["page-preview"]?.enabled)`);
    failOpenCheck("hover-shows-stored-catalog", hoverReady && pagePreviewEnabled && hoverStored,
      { hoverReady, pagePreviewEnabled, hoverHref, hoverProbe });
    // This probe hovered the same same-note heading link tested below. Move
    // away and wait for Obsidian's page preview to close before clicking it;
    // otherwise the still-open hover surface can intercept the next click.
    await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: 4, y: 4, buttons: 0 });
    const hoverDismissed = await settleEvaluate(client, `(() => {
      const visible = (node) => {
        if (!node?.getBoundingClientRect) return false;
        const rect = node.getBoundingClientRect(); const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      return !Array.from(document.querySelectorAll(".hover-popover")).some(visible);
    })()`, (value) => value === true, 3_000) === true;
    await openAndProbe(client, lib.PATHS.area, "reading");
    await resetPanels(client);
    const navigationTarget = await client.evaluate(`(() => {
      const view = app.workspace.activeLeaf?.view;
      const root = view?.previewMode?.containerEl || view?.containerEl;
      const link = Array.from(root?.querySelectorAll?.("a.internal-link") || []).find((node) =>
        (node.getAttribute("href") || "").includes("#Projects") && String(node.textContent || "").includes("Jump to Projects"));
      return link ? { href: link.getAttribute("href"), text: String(link.textContent || "").trim() } : null;
    })()`);
    await client.evaluate(`(() => {
      window.__bobCabinetNavigationClick = null;
      document.addEventListener("click", (event) => {
        const origin = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
        const link = origin?.closest?.("a.internal-link, a[data-href]");
        const href = link?.getAttribute?.("data-href") || link?.getAttribute?.("href") || "";
        if (!href.includes("#Projects")) return;
        window.__bobCabinetNavigationClick = {
          href,
          text: String(link.textContent || "").trim(),
          defaultPrevented: event.defaultPrevented,
          eventPhase: event.eventPhase,
        };
      }, true);
      return true;
    })()`);
    if (navigationTarget) await clickSelector(client, 'a.internal-link[href*="#Projects"]');
    const navigationClick = await client.evaluate("window.__bobCabinetNavigationClick || null");
    probe = await settleProbe(client, (value) => value?.path === lib.PATHS.area
      && value?.panels?.find((row) => row.kind === "projects")?.expanded === true,
    "same-note heading link revealed the Projects cabinet", 5_000);
    failOpenCheck("heading-navigation-reveals-cabinet", Boolean(navigationTarget) && probe.path === lib.PATHS.area
      && hoverDismissed && navigationClick?.href?.includes("#Projects") && navigationClick.defaultPrevented === true
      && probe.panels.find((row) => row.kind === "projects")?.expanded === true,
    { navigationTarget, hoverDismissed, navigationClick, probe });
    await client.call("Emulation.setEmulatedMedia", { media: "print" });
    await sleep(250);
    const printText = await client.evaluate(`(() => ({
      media: matchMedia("print").matches,
      callouts: Array.from((() => {
        const view = app.workspace.activeLeaf?.view;
        const root = view?.previewMode?.containerEl || view?.containerEl;
        return root?.querySelectorAll?.(".callout[data-callout='projects']") || [];
      })()).map((node) => {
        const r = node.getBoundingClientRect(); const s = getComputedStyle(node);
        return { visible: s.display !== "none" && s.visibility !== "hidden"
            && !node.closest?.(".bob-property-card-cabinets"), display: s.display, visibility: s.visibility,
          absorbed: node.classList?.contains("bob-cabinet-absorbed") === true,
          rect: { width: r.width, height: r.height },
          ancestors: (() => { const out = []; let current = node; while (current && out.length < 6) {
            const cs = getComputedStyle(current); const box = current.getBoundingClientRect();
            out.push({ tag: current.tagName, className: String(current.className || ""), display: cs.display,
              visibility: cs.visibility, width: box.width, height: box.height }); current = current.parentElement;
          } return out; })() };
      }),
    }))()`);
    printText.visible = printText.callouts.some((row) => row.visible);
    let pdfBytes = null;
    let pdfPrintError = null;
    let pageDomainEnabled = false;
    let pageDomainEnableError = null;
    try { await client.call("Page.enable"); pageDomainEnabled = true; }
    catch (error) { pageDomainEnableError = error?.message || String(error); }
    let printToPDFAdvertised = null;
    try {
      const domains = await client.call("Schema.getDomains");
      const page = domains.domains?.find((domain) => domain.name === "Page");
      printToPDFAdvertised = Array.isArray(page?.commands) ? page.commands.some((command) => command.name === "printToPDF") : null;
    } catch (_) {}
    try { pdfBytes = await client.call("Page.printToPDF", { printBackground: true }); }
    catch (error) { pdfPrintError = error?.message || String(error); }
    let pdfText = "";
    let pdfTextError = null;
    if (pdfBytes?.data) {
      const pdfPath = path.join(outDir, "cabinets-print-proof.pdf");
      try {
        fs.writeFileSync(pdfPath, Buffer.from(pdfBytes.data, "base64"));
        pdfText = require("node:child_process").execFileSync("pdftotext", [pdfPath, "-"], { encoding: "utf8" });
      } catch (error) {
        pdfTextError = error?.message || String(error);
      }
    }
    const storedPrintCallout = printText.callouts.find((row) => row.absorbed
      && row.display !== "none" && row.visibility !== "hidden");
    const pdfAvailable = Boolean(pdfBytes?.data);
    const printFallbackVisible = Boolean(storedPrintCallout);
    failOpenCheck("print-media-reveals-stored-catalog", printText.media
      && printFallbackVisible && (!pdfAvailable || pdfText.includes("Project catalog sentinel")), {
      ...printText, pdfBytes: Boolean(pdfBytes?.data), pdfTextIncludesCatalog: pdfText.includes("Project catalog sentinel"),
      pdfTextError, pdfPrintError, pageDomainEnabled, pageDomainEnableError,
      printToPDFAdvertised, evidenceMode: pdfAvailable ? "generated-pdf-text" : "computed-print-styles",
      screenVisibility: printText.visible,
    });
    await client.call("Emulation.setEmulatedMedia", { media: "screen" });
    for (const notePath of [lib.PATHS.malformed, lib.PATHS.duplicate]) {
      await openAndProbe(client, notePath, "reading");
      probe = await refreshProbe(client);
      const visibleStored = probe.callouts.some((row) => row.kind === "projects" && row.visible);
      failOpenCheck(`${path.basename(notePath, ".md")}-ambiguous-region-stays-visible`, visibleStored, probe);
    }
    // Replace one provider with a controlled throw. The production fallback must release absorption.
    await openAndProbe(client, lib.PATHS.leaf, "reading");
    const fault = await client.evaluate(`(() => {
      const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      const H = plugin?.constructor?.helpers;
      const original = H?.propertyCardCabinetProviderFor?.("areas");
      if (!plugin || !H || !original) return { ok: false, reason: "provider test API unavailable" };
      H.propertyCardRegisterCabinetProvider(plugin, "areas", {
        ...original,
        applies: (context) => original.applies(context),
        paintKey: () => "forced-failure",
        buildBody: () => { throw new Error("forced cabinet mount failure"); },
      });
      window.__bobCabinetRestoreProvider = () => H.propertyCardRegisterCabinetProvider(plugin, "areas", original);
      return { ok: true };
    })()`);
    await openAndProbe(client, lib.PATHS.area, "reading");
    await resetPanels(client);
    await clickSelector(client, `[data-cabinet-kind="areas"] .bob-cabinet-toggle`);
    probe = await settleProbe(client, (value) => {
      const panel = value?.panels?.find((row) => row.kind === "areas");
      return Boolean(panel?.error || (panel?.expanded && panel?.text));
    }, "forced provider body mounted or failed", 5_000);
    const failedMount = probe.panels.find((row) => row.kind === "areas");
    const nativeRestored = probe.callouts.some((row) => row.kind === "areas" && row.visible);
    failOpenCheck("forced-mount-error-reveals-native-section", fault.ok && Boolean(failedMount?.error) && nativeRestored, { fault, failedMount, nativeRestored });
    await client.evaluate("window.__bobCabinetRestoreProvider?.(); delete window.__bobCabinetRestoreProvider");
    await client.evaluate(`app.plugins.disablePlugin(${JSON.stringify(PLUGIN_ID)})`);
    probe = await settleProbe(client, (value) => value?.callouts?.some((row) => row.kind === "areas" && row.visible),
      "native area section restored after plugin disable", 5_000);
    const disabledVisible = probe.callouts.some((row) => row.kind === "areas" && row.visible);
    failOpenCheck("plugin-disable-restores-stored-section", disabledVisible, probe);
    for (const row of failOpen) check(`fail-open-${row.name}`, row.status === "pass", row.detail);
    report.failOpen = failOpen;

    // Verify Vim navigation never strands the visible cursor in the hidden ranges.
    await client.evaluate(`app.plugins.enablePlugin(${JSON.stringify(PLUGIN_ID)})`);
    // The log-history mixin schedules a known 5-second fetch after enable.
    // Drain it before the passive-action measurement so it cannot be blamed
    // on a cabinet click or key.
    await sleep(5_500);
    await openAndProbe(client, lib.PATHS.area, "live");
    const motionResults = {};
    for (const [key, suffix] of [["j", null], ["k", null], ["g", "g"], ["G", null], ["ArrowDown", null], ["ArrowUp", null]]) {
      const errorsBefore = report.consoleErrors.length;
      await sendKey(client, key);
      if (suffix) await sendKey(client, suffix);
      const cursorVisible = await client.evaluate(`(() => {
        const c = document.querySelector(".cm-vimCursorLayer .cm-fat-cursor.cm-cursor-primary, .cm-cursor-primary");
        if (!c) return false;
        const r = c.getBoundingClientRect(); const s = getComputedStyle(c);
        return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
      })()`);
      motionResults[key] = { cursorVisible, consoleErrors: report.consoleErrors.length - errorsBefore };
    }
    check("vim-motions-and-arrows-no-invisible-cursor", Object.values(motionResults).every((row) => row.cursorVisible), motionResults);
    check("cursor-motions-no-console-errors", Object.values(motionResults).every((row) => row.consoleErrors === 0), motionResults);
    const offscreen = await client.evaluate(`(() => {
      const card = document.querySelector('[data-card-kind="area"]');
      if (!card) return null;
      window.scrollTo(0, 0);
      return { before: window.scrollY, cardTop: card.getBoundingClientRect().top };
    })()`);
    await sendKey(client, "_");
    await sendKey(client, "1");
    const afterToggleScroll = await client.evaluate("window.scrollY");
    check("offscreen-toggle-keeps-viewport", offscreen && offscreen.cardTop > 900 ? afterToggleScroll === offscreen.before : true,
      { offscreen, afterToggleScroll });

    // Passive spy surrounds only paint, toggles, arm, pick, cancel, and overlay actions.
    await openAndProbe(client, lib.PATHS.area, "reading");
    await openAndProbe(client, lib.PATHS.area, "live");
    await sleep(500);
    const passiveBaseline = readLog(logPath).length;
    const beforeHashPassive = shared.markdownFilesHash(vault);
    await clickSelector(client, `[data-cabinet-kind="areas"] .bob-cabinet-toggle`);
    const passiveKeys = await refreshProbe(client);
    await sendKey(client, "_"); await sendKey(client, "Escape");
    await sendKey(client, "_"); await sendKey(client, "2");
    const afterHashPassive = shared.markdownFilesHash(vault);
    const passiveLog = readLog(logPath);
    const passiveAfter = passiveLog.length;
    const passiveUnchanged = JSON.stringify(beforeHashPassive) === JSON.stringify(afterHashPassive);
    check("passive-actions-zero-bob-spawns", passiveAfter === passiveBaseline, {
      beforeCount: passiveBaseline, afterCount: passiveAfter, newSpawns: passiveLog.slice(passiveBaseline),
    });
    check("passive-actions-zero-markdown-writes", passiveUnchanged, { beforeHashPassive, afterHashPassive });
    void passiveKeys;

    // Layout/accessibility review matrix. All screenshots are synthetic and recorded by hash.
    for (const host of lib.SCREENSHOT_HOSTS) {
      for (const theme of ["light", "dark"]) {
        for (const widthName of ["narrow", "wide"]) {
          for (const mode of ["live", "reading"]) {
            const width = widthName === "narrow" ? 420 : 1400;
            await shared.setViewport(client, width);
            const sidebarState = await shared.collapseSidebars(client);
            if (!sidebarState.ok) throw new Error("Cannot isolate the screenshot viewport: " + JSON.stringify(sidebarState));
            await shared.setTheme(client, theme);
            const hostSpec = lib.SPECS.find((row) => row.path === host.path);
            const cardState = await openAndSettleExpectedCard(client, hostSpec, mode,
              `screenshot card ${host.key} ${mode} ${theme} ${widthName}`);
            if (host.state === "armed") {
              if (mode === "reading") {
                await client.evaluate(`app.commands.executeCommandById(${JSON.stringify(`${PLUGIN_ID}:toggle-card-details`)})`);
              } else await sendKey(client, "_");
              await sleep(180);
            }
            const state = await refreshProbe(client);
            const name = `${host.key}-${mode}-${theme}-${widthName}${host.state === "armed" ? "-armed" : ""}`;
            const shot = await shared.capture(client, outDir, name, width, theme, mode + (host.state === "armed" ? "+armed" : ""));
            shot.armed = state.armed;
            shot.themeClass = state.theme;
            shot.viewportWidth = width;
            shot.cardWidth = state.width;
            shot.captureFailures = [];
            if (!(cardState?.cardPresent && cardState.cardKind === hostSpec.kind
              && JSON.stringify(cardState.cabinetKinds || []) === JSON.stringify(hostSpec.cabinets))) {
              shot.captureFailures.push("expected card or cabinet stack did not settle before capture");
            }
            if (shot.width <= 0 || shot.height <= 0) shot.captureFailures.push("screenshot has no dimensions");
            if (state.theme !== theme) shot.captureFailures.push(`theme expected ${theme}, got ${state.theme}`);
            if (host.state === "armed" && !state.armed) shot.captureFailures.push("armed screenshot has no armed pick");
            for (const row of emptyOpenCabinets(state)) shot.captureFailures.push(`open ${row} cabinet shows an empty body`);
            shot.visualVerdict = "pending visual review";
            report.screenshots.push(shot);
          }
        }
      }
    }
    // Layout diagnostics (evidence only): computed boxes of every cabinet head
    // on the config-cabinet hosts at the narrow width, for visual review.
    report.layoutDiagnostics = [];
    for (const key of ["bank", "prose", "album"]) {
      const hostSpec = lib.SPECS.find((row) => row.key === key);
      if (!hostSpec) continue;
      await shared.setViewport(client, 420);
      await shared.setTheme(client, "light");
      await openAndSettleExpectedCard(client, hostSpec, "live", `layout diagnostics ${key}`);
      const heads = await client.evaluate(`(() => {
        const view = app.workspace.activeLeaf?.view;
        const root = view?.contentEl || view?.containerEl;
        const describe = (el) => {
          if (!el?.getBoundingClientRect) return null;
          const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
          return { tag: el.tagName, cls: String(el.className || ""), text: String(el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 60),
            x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
            display: s.display, justify: s.justifyContent, align: s.alignItems, flex: s.flex, wrap: s.flexWrap,
            width: s.width, margin: s.margin, textAlign: s.textAlign, position: s.position };
        };
        return Array.from(root?.querySelectorAll?.(".bob-property-card-cabinets .bob-cabinet-head") || []).map((head) => ({
          kind: head.closest("[data-cabinet-kind]")?.getAttribute("data-cabinet-kind") || null,
          parent: describe(head.parentElement), head: describe(head),
          children: Array.from(head.children).map((child) => ({ ...describe(child), children: Array.from(child.children).map(describe) })),
        }));
      })()`);
      report.layoutDiagnostics.push({ key, heads });
    }
    // One chrome: every head reads from the left edge on a single line, so a
    // summary-less Outline or a long Setup summary never centers or wraps.
    const headLayout = report.layoutDiagnostics.flatMap((host) => host.heads.map((row) => {
      const toggle = row.children.find((child) => child?.tag === "BUTTON") || null;
      const parts = (toggle?.children || []).filter((child) => child && child.display !== "none" && child.w > 0);
      const chevron = parts[0] || null;
      const leftAligned = Boolean(toggle && chevron) && chevron.x - toggle.x <= 8;
      // Compare vertical centers: an open chevron is rotated, so its box top moves.
      const middle = (child) => child.y + child.h / 2;
      const oneLine = parts.length > 0 && parts.every((child) => Math.abs(middle(child) - middle(parts[0])) <= 3);
      return { host: host.key, kind: row.kind, leftAligned, oneLine, toggle: toggle && { x: toggle.x, w: toggle.w, justify: toggle.justify, wrap: toggle.wrap } };
    }));
    check("cabinet-heads-left-aligned-single-line", headLayout.length >= 6
      && headLayout.every((row) => row.leftAligned && row.oneLine), headLayout);
    for (const [name, feature] of [["reduced-motion", "prefers-reduced-motion"], ["forced-colors", "forced-colors"]]) {
      await shared.setViewport(client, 1400);
      await shared.setTheme(client, "light");
      const areaScreenshotState = await openAndSettleExpectedCard(client, lib.SPECS.find((row) => row.path === lib.PATHS.area),
        "live", `area card before ${name} screenshot`);
      await client.call("Emulation.setEmulatedMedia", { media: "screen", features: [{ name: feature, value: feature === "forced-colors" ? "active" : "reduce" }] });
      await sleep(180);
      probe = await refreshProbe(client);
      const shot = await shared.capture(client, outDir, `area-live-light-wide-${name}`, 1400, "light", name);
      shot.reducedMotion = probe.reducedMotion;
      shot.forcedColors = probe.forcedColors;
      shot.panels = probe.panels.map((row) => ({ kind: row.kind, expanded: row.expanded, error: row.error,
        linkCount: row.linkCount, bodyClass: row.bodyClass, text: String(row.text || "").slice(0, 120) }));
      shot.bodyStates = await client.evaluate(`(() => {
        const view = app.workspace.activeLeaf?.view;
        const root = view?.contentEl || view?.containerEl;
        return Array.from(root?.querySelectorAll?.(".bob-property-card-cabinets .bob-cabinet-panel") || []).map((panel) => {
          const content = panel.querySelector(".bob-cabinet-provider-content");
          const state = content?.__bobCabinetBodyState || null;
          return { kind: panel.getAttribute("data-cabinet-kind"), cards: root.querySelectorAll(".bob-property-card-cabinets").length,
            content: Boolean(content), children: content ? content.childElementCount : null,
            state: state ? { built: state.built, pending: state.pending, error: state.error, sameContainer: state.container === content } : null };
        });
      })()`);
      shot.captureFailures = [];
      if (!areaScreenshotState.cardPresent || areaScreenshotState.cardKind !== "area") {
        shot.captureFailures.push("area card did not settle before capture");
      }
      for (const row of emptyOpenCabinets(probe)) shot.captureFailures.push(`open ${row} cabinet shows an empty body`);
      if (feature === "prefers-reduced-motion" && !probe.reducedMotion) shot.captureFailures.push("reduced motion emulation did not apply");
      if (feature === "forced-colors" && !probe.forcedColors) shot.captureFailures.push("forced colors emulation did not apply");
      shot.visualVerdict = "pending visual review";
      report.screenshots.push(shot);
      await client.call("Emulation.setEmulatedMedia", { media: "screen", features: [] });
    }
    const needs = lib.screenshotNeeds();
    const names = new Set(report.screenshots.map((row) => row.name));
    const missingShots = needs.filter((name) => !names.has(name));
    check("screenshot-matrix-captured", missingShots.length === 0 && report.screenshots.every((row) => row.captureFailures.length === 0), {
      expected: needs.length, actual: report.screenshots.length, missingShots,
      captureFailures: report.screenshots.filter((row) => row.captureFailures.length).map((row) => ({ name: row.name, failures: row.captureFailures })),
    });
    check("no-runtime-exceptions", report.consoleExceptions.length === 0, report.consoleExceptions);
    check("no-console-errors", report.consoleErrors.length === 0, report.consoleErrors);
    report.bobSpawns = readLog(logPath);
    const markdownAfter = shared.markdownFilesHash(vault);
    check("scratch-markdown-unchanged", JSON.stringify(protectedHashes) === JSON.stringify(markdownAfter), { before: protectedHashes, after: markdownAfter });
    report.visualReview = { status: "pending", instruction: "Inspect every PNG, then mark each screenshot visualVerdict pass in the retained report." };
    report.verdict = report.checks.every((row) => row.status === "pass") ? "GO-PENDING-VISUAL-REVIEW" : "NO-GO";
    successful = report.verdict === "GO-PENDING-VISUAL-REVIEW";
  } catch (error) {
    report.error = error?.stack || String(error);
    check("runner-error", false, String(error?.message || error));
    if (client) {
      try { report.screenshots.push(await shared.capture(client, outDir, "cabinets-runner-failure", 1400, "light", "failure")); } catch (_) {}
    }
  } finally {
    report.finishedAt = new Date().toISOString();
    if (client) client.close();
    let terminationRequested = null;
    let exitObserved = Boolean(child && (child.exitCode !== null || child.signalCode !== null));
    if (child && child.exitCode == null) {
      try { child.kill("SIGTERM"); terminationRequested = "SIGTERM"; } catch (_) {}
      exitObserved = await waitForChildExit(child, 1_000);
      if (!exitObserved && child.exitCode == null && child.signalCode == null) {
        try { child.kill("SIGKILL"); terminationRequested = "SIGKILL"; } catch (_) {}
        exitObserved = await waitForChildExit(child, 1_000);
      }
    }
    report.obsidianProcess = {
      ...(report.obsidianProcess || {}),
      pid: child?.pid ?? report.obsidianProcess?.pid ?? null,
      executable,
      profile,
      exitCode: child?.exitCode ?? null,
      signalCode: child?.signalCode ?? null,
      stdout: childStdout || null,
      stderr: childStderr || null,
      terminationRequested,
      exitObserved,
    };
    const profileLog = path.join(profile, "obsidian.log");
    report.obsidianProcess.startupLog = fs.existsSync(profileLog)
      ? fs.readFileSync(profileLog, "utf8").slice(-12_000) : null;
    writeStartupDiagnostics(path.dirname(reportPath), profile, report.obsidianProcess, logPath);
    report.scratchPreserved = Boolean(!successful && fs.existsSync(scratch));
    if (successful && fs.existsSync(scratch)) fs.rmSync(scratch, { recursive: true, force: true });
    report.assertionCounts = report.checks.reduce((counts, row) => {
      counts[row.status] = (counts[row.status] || 0) + 1;
      return counts;
    }, {});
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  }
  process.stdout.write(`${report.verdict} Cabinets acceptance (${JSON.stringify(report.assertionCounts)}, ${report.screenshots.length} screenshots)\n`);
  process.stdout.write(`Report: ${reportPath}\nScreenshots: ${outDir}\n`);
  for (const row of report.checks.filter((item) => item.status === "fail")) process.stderr.write(`- ${row.name}: ${JSON.stringify(row.detail)}\n`);
  if (!successful) process.exitCode = 1;
  return report;
}

async function main(argv) {
  let args;
  try { args = lib.parseArgs(argv); }
  catch (error) { process.stderr.write(String(error.message || error) + "\n" + lib.HELP_TEXT + "\n"); process.exitCode = 2; return; }
  if (args.help) { process.stdout.write(lib.HELP_TEXT + "\n"); return; }
  if (args.selfTest) {
    try {
      lib.selfTest();
      new Function("return " + PROBE_SOURCE);
      process.stdout.write("offline self-test complete (synthetic fixtures and probes; no Obsidian launched)\n");
    } catch (error) { process.stderr.write(String(error.stack || error) + "\n"); process.exitCode = 1; }
    return;
  }
  try { await run(args); }
  catch (error) { process.stderr.write(String(error.stack || error) + "\n"); process.exitCode = error?.exitCode || 1; }
}

if (require.main === module) void main(process.argv.slice(2));
module.exports = {
  FIXTURE_BOB_REPORTS, PROBE_SOURCE, installVault, obsidianChildEnvironment,
  parseArgs: lib.parseArgs, run,
};
