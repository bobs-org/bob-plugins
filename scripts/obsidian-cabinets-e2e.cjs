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
      visible: visible(panel),
      error: String(error?.textContent || "").replace(/\\s+/g, " ").trim() || null,
      callouts,
      keycap: String(panel.querySelector(".bob-cabinet-keycap")?.textContent || "").trim(),
    };
  });
  const callouts = Array.from(root?.querySelectorAll?.(".callout[data-callout]") || []).filter((node) => !embedded(node)).map((node) => ({
    kind: node.getAttribute("data-callout"), visible: visible(node),
    text: String(node.textContent || "").replace(/\\s+/g, " ").trim(), rows: node.querySelectorAll("li").length,
  }));
  const headings = Array.from(root?.querySelectorAll?.("h2, .cm-line") || []).filter((node) => !embedded(node)).map((node) => ({
    text: String(node.textContent || "").replace(/\\s+/g, " ").trim(), visible: visible(node),
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
    fallback: Boolean(document.querySelector(".bob-cabinet-pick-fallback, .bob-walker-footer-fallback")),
    armed: Boolean(stack?.getAttribute("data-cabinet-pick") === "armed"),
    badges: Array.from(stack?.querySelectorAll?.(".bob-cabinet-keycap") || []).map((node) => String(node.textContent || "").trim()),
    footerText: String(document.querySelector(".bob-walker-footer-overlay")?.textContent || "").replace(/\\s+/g, " ").trim(),
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
  fs.writeFileSync(file, `#!/usr/bin/env node\nconst fs = require("node:fs");\nconst log = ${JSON.stringify(logPath)};\nconst reports = ${JSON.stringify(FIXTURE_BOB_REPORTS)};\nconst args = process.argv.slice(2);\nconst key = args[0] === "albums" && args[1] === "list" ? "albums"\n  : args[0] === "bank" && args[1] === "config" ? "bank" : null;\ntry { fs.appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), args, fixture: key }) + "\\n"); } catch (_) {}\nif (key && args.includes("-f") && args.includes("json")) { process.stdout.write(JSON.stringify(reports[key]) + "\\n"); process.exit(0); }\nprocess.stderr.write("Unexpected bob spawn in cabinet acceptance\\n");\nprocess.exit(87);\n`);
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

async function refreshProbe(client) {
  await sleep(100);
  return client.evaluate(PROBE_SOURCE, OPEN_TIMEOUT);
}

async function sendKey(client, key, modifiers = 0) {
  const base = periods.keyEvents(key);
  for (const event of base) await client.call("Input.dispatchKeyEvent", { ...event, modifiers });
  await sleep(90);
}

async function clickSelector(client, selector, occurrence = 0) {
  const point = await client.evaluate(`(() => {
    const nodes = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
    const node = nodes[${occurrence}] || null;
    if (!node) return null;
    node.scrollIntoView({ block: "nearest" });
    const rect = node.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!point) throw new Error(`Could not find clickable ${selector}[${occurrence}]`);
  await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await client.call("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await sleep(180);
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
    checks: [], screenshots: [], consoleExceptions: [], bobSpawns: [],
  };
  let child = null;
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
      stdio: ["ignore", "ignore", "pipe"],
    });
    const target = await shared.selectTarget(port, fs.realpathSync(vault), () => child && child.exitCode == null);
    client = target.client;
    await client.call("Runtime.enable");
    await client.call("Page.enable");
    client.on("Runtime.exceptionThrown", (row) => report.consoleExceptions.push(row.exceptionDetails?.text || "runtime exception"));
    await shared.trustCommunityPlugins(client);
    await sleep(1_000);
    const pluginLoaded = await client.evaluate(`Boolean(app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}])`);
    check("plugins-loaded", pluginLoaded, { enabled: PLUGIN_IDS });

    // Render every hosted note in both real surfaces, checking species, stack order, and defaults.
    const renderRows = [];
    for (const spec of lib.SPECS) {
      for (const mode of ["live", "reading"]) {
        await openAndProbe(client, spec.path, mode);
        const probe = await settleProbe(client, (value) => value?.path === spec.path
          && value?.mode === mode && value?.cardPresent && value?.cardKind === spec.kind
          && JSON.stringify(value?.cabinetKinds || []) === JSON.stringify(spec.cabinets),
        `settled ${spec.key} ${mode}`);
        const row = { fixture: spec.key, path: spec.path, mode, actualKind: probe.cardKind,
          expectedKind: spec.kind, cabinets: probe.cabinetKinds, expectedCabinets: spec.cabinets,
          propertiesLast: probe.propertiesLast, foldControls: probe.foldControls };
        renderRows.push(row);
        check(`render-${spec.key}-${mode}`, probe.cardPresent && probe.cardKind === spec.kind
          && JSON.stringify(probe.cabinetKinds) === JSON.stringify(spec.cabinets)
          && (spec.cabinets.length === 0 || probe.propertiesLast), row);
      }
    }
    report.renderMatrix = renderRows;
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

    // Gate-closed native rendering gives a real same-vault baseline for byte and row parity.
    const pluginData = path.join(vault, ".obsidian", "plugins", PLUGIN_ID, "data.json");
    const gateClosed = { cabinetsPreview: false, cardPreviewKinds: [], refCardPreview: false };
    await client.evaluate(`app.plugins.disablePlugin(${JSON.stringify(PLUGIN_ID)})`);
    fs.writeFileSync(pluginData, JSON.stringify(gateClosed, null, 2) + "\n");
    await client.evaluate(`app.plugins.enablePlugin(${JSON.stringify(PLUGIN_ID)})`);
    await sleep(1_000);
    probe = await openAndProbe(client, lib.PATHS.area, "reading");
    const inlineBaseline = Object.fromEntries(probe.callouts.map((row) => [row.kind, { text: row.text, rows: row.rows, visible: row.visible }]));
    check("gate-closed-inline-baseline", !probe.stackPresent && ["areas", "projects", "notebooks", "albums"].every((kind) => inlineBaseline[kind]?.visible), inlineBaseline);
    await client.evaluate(`app.plugins.disablePlugin(${JSON.stringify(PLUGIN_ID)})`);
    fs.writeFileSync(pluginData, JSON.stringify(GATE_DATA, null, 2) + "\n");
    await client.evaluate(`app.plugins.enablePlugin(${JSON.stringify(PLUGIN_ID)})`);
    await sleep(900);
    probe = await openAndProbe(client, lib.PATHS.area, "reading");
    const contentParity = [];
    for (const kind of ["areas", "projects", "notebooks", "albums"]) {
      const panel = probe.panels.find((row) => row.kind === kind);
      if (!panel?.expanded) await clickSelector(client, `[data-cabinet-kind="${kind}"] .bob-cabinet-toggle`);
      const mounted = await settleProbe(client, (value) => {
        const candidate = value?.panels?.find((row) => row.kind === kind);
        return candidate?.callouts?.length > 0 || Boolean(candidate?.error);
      }, `rendered ${kind} cabinet body`, 8_000);
      const bodyCallout = mounted.panels.find((row) => row.kind === kind)?.callouts?.[0];
      const baseline = inlineBaseline[kind];
      contentParity.push({ kind, baselineRows: baseline?.rows, cabinetRows: bodyCallout?.rows,
        baselineVisible: baseline?.visible, cabinetText: bodyCallout?.text || null,
        textContainsBaseline: Boolean(baseline && bodyCallout && bodyCallout.text.includes(baseline.text.slice(0, 24))) });
    }
    check("area-content-parity-gate-closed", contentParity.length === 4
      && contentParity.every((row) => row.baselineVisible && row.baselineRows === row.cabinetRows && row.textContainsBaseline), contentParity);
    report.contentParity = contentParity;

    // Full key ownership matrix: zero, one, and multiple extras; digits, aliases, cancel, modifiers, and lifecycle.
    const keyChecks = [];
    const keyCheck = (name, ok, detail = null) => keyChecks.push({ name, status: ok ? "pass" : "fail", detail });
    await openAndProbe(client, lib.PATHS.leaf, "live");
    await sendKey(client, "_");
    probe = await refreshProbe(client);
    keyCheck("zero-extra-underscore-details-fallback", probe.cardKind === "project" && probe.detailsExpanded === true, probe);
    for (const spec of lib.SPECS.filter((row) => row.cabinets.length === 1)) {
      await openAndProbe(client, spec.path, "live");
      const before = await refreshProbe(client);
      await sendKey(client, "_");
      const after = await refreshProbe(client);
      keyCheck(`zero-extra-fallback-${spec.key}`, before.cardKind === spec.kind
        && after.detailsExpanded !== before.detailsExpanded, { before, after });
    }
    await openAndProbe(client, lib.PATHS.singleArea, "live");
    await sendKey(client, "_");
    probe = await refreshProbe(client);
    keyCheck("one-extra-area-underscore-direct-toggle", probe.panels.find((row) => row.kind === "projects")?.expanded === true && !probe.armed, probe);
    await openAndProbe(client, lib.PATHS.bank, "live");
    await sendKey(client, "_");
    probe = await refreshProbe(client);
    keyCheck("one-extra-underscore-toggles-setup", probe.panels.find((row) => row.kind === "setup")?.expanded === true, probe.panels);
    await openAndProbe(client, lib.PATHS.area, "live");
    await sendKey(client, "_");
    probe = await refreshProbe(client);
    keyCheck("multi-extra-underscore-arms", probe.armed && probe.badges.includes("1") && probe.badges.includes("4"), probe);
    await sleep(175);
    probe = await refreshProbe(client);
    keyCheck("pick-overlay-after-150ms", probe.armed && Boolean(probe.footerText), probe.footerText);
    const areaOrder = ["areas", "projects", "notebooks", "albums"];
    const numbered = areaOrder.slice().reverse();
    for (let digit = 1; digit <= 4; digit += 1) {
      if (!probe.armed) await sendKey(client, "_");
      await sendKey(client, String(digit));
      probe = await refreshProbe(client);
      keyCheck(`digit-${digit}-toggles-${numbered[digit - 1]}-and-disarms`, !probe.armed
        && probe.panels.find((row) => row.kind === numbered[digit - 1])?.expanded === true, probe.panels);
      await sendKey(client, "_");
      probe = await refreshProbe(client);
    }
    for (const key of ["0", "9"]) {
      if (!probe.armed) await sendKey(client, "_");
      await sendKey(client, key);
      probe = await refreshProbe(client);
      keyCheck(`out-of-range-${key}-stays-armed`, probe.armed, probe);
      await sendKey(client, "Escape");
      probe = await refreshProbe(client);
    }
    for (const key of ["_", "-"]) {
      await sendKey(client, "_");
      await sendKey(client, key);
      probe = await refreshProbe(client);
      keyCheck(key === "_" ? "double-underscore-toggles-number-one" : "armed-minus-toggles-properties",
        !probe.armed && (key === "_" ? probe.panels.find((row) => row.kind === "albums")?.expanded === true : probe.propertyExpanded), probe);
    }
    for (const [name, key, modifiers] of [
      ["escape", "Escape", 0], ["q", "q", 0], ["Q", "Q", 0], ["ctrl-bracket", "[", 2],
      ["alt", "x", 1], ["meta", "x", 4], ["ctrl", "x", 2], ["other-key", "x", 0],
    ]) {
      await sendKey(client, "_");
      await sendKey(client, key, modifiers);
      probe = await refreshProbe(client);
      keyCheck(`cancel-${name}`, !probe.armed, probe);
    }
    // A fast `_1` completes before the delayed footer can flash.
    await openAndProbe(client, lib.PATHS.area, "live");
    await sendKey(client, "_");
    await sendKey(client, "1");
    probe = await refreshProbe(client);
    keyCheck("fast-underscore-one-no-overlay-flash", !probe.armed && !probe.footerText, probe);
    // Palette command arms in Reading. The walker-footer overlay is an
    // aria-live status message, not an interactive chip; choose a cabinet by
    // its advertised number through the same keyboard path as Live Preview.
    await openAndProbe(client, lib.PATHS.area, "reading");
    const command = await client.evaluate(`app.commands.executeCommandById(${JSON.stringify(`${PLUGIN_ID}:toggle-card-details`)})`);
    await sleep(180);
    probe = await refreshProbe(client);
    keyCheck("reading-palette-arms-pick", command !== false && probe.armed, { command, probe });
    if (probe.armed) {
      keyCheck("reading-pick-overlay-lists-numbered-kinds",
        probe.footerText.includes("1 Albums") && probe.footerText.includes("2 Notebooks")
          && probe.footerText.includes("3 Projects") && probe.footerText.includes("4 Areas"), probe.footerText);
      await sendKey(client, "1");
      probe = await refreshProbe(client);
      keyCheck("reading-palette-number-picks-and-disarms",
        !probe.armed && probe.panels.find((row) => row.kind === "albums")?.expanded === true, probe);
    }
    // Status bar hidden: the view-local fallback stays available for the armed pick.
    await client.evaluate(`document.querySelector(".status-bar")?.style.setProperty("display", "none", "important")`);
    await sendKey(client, "_");
    await sleep(180);
    probe = await refreshProbe(client);
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
    await openAndProbe(client, lib.PATHS.area, "reading");
    probe = await refreshProbe(client);
    failOpenCheck("reading-hides-managed-headings-and-callouts", probe.hiddenCalloutCount >= 4
      && probe.headings.filter((row) => /^## (Areas|Projects|Notebooks|Albums)$/.test(row.text)).every((row) => !row.visible), probe);
    await openAndProbe(client, lib.PATHS.area, "source");
    probe = await refreshProbe(client);
    failOpenCheck("source-shows-stored-section", !probe.stackPresent && probe.headings.some((row) => row.text.includes("## Projects") && row.visible), probe);
    await openAndProbe(client, lib.PATHS.embed, "reading");
    probe = await refreshProbe(client);
    const embeddedStored = await client.evaluate(`(() => {
      const embed = document.querySelector(".markdown-embed, .internal-embed");
      return Boolean(embed && embed.querySelector('h2') && embed.querySelector('.callout[data-callout="projects"]')
        && !embed.querySelector(".bob-property-card-cabinets"));
    })()`);
    failOpenCheck("embed-shows-stored-catalog", embeddedStored, probe);
    await openAndProbe(client, lib.PATHS.ordinary, "reading");
    const hoverReady = await client.evaluate(`(() => {
      const link = Array.from(document.querySelectorAll("a.internal-link" )).find((node) => (node.getAttribute("href") || "").includes("cash"));
      if (!link) return false;
      const r = link.getBoundingClientRect();
      window.__bobHoverPoint = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      return true;
    })()`);
    if (hoverReady) {
      const point = await client.evaluate("window.__bobHoverPoint");
      await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
      await sleep(900);
    }
    const hoverStored = await client.evaluate(`Boolean(document.querySelector(".hover-popover")?.querySelector('h2, .callout[data-callout="projects"]'))`);
    failOpenCheck("hover-shows-stored-catalog", hoverReady && hoverStored, { hoverReady, hoverStored });
    await client.evaluate(`app.workspace.openLinkText(${JSON.stringify("cash.md#Projects")}, ${JSON.stringify(lib.PATHS.area)}, false)`);
    await sleep(500);
    probe = await refreshProbe(client);
    failOpenCheck("heading-navigation-reveals-cabinet", probe.path === lib.PATHS.area
      && probe.panels.find((row) => row.kind === "projects")?.expanded === true, probe);
    await client.call("Emulation.setEmulatedMedia", { media: "print" });
    const printText = await client.evaluate(`(() => ({
      media: matchMedia("print").matches,
      visible: Array.from(document.querySelectorAll(".callout[data-callout='projects']")).some((node) => {
        const r = node.getBoundingClientRect(); const s = getComputedStyle(node);
        return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
      }),
    }))()`);
    let pdfBytes = null;
    try { pdfBytes = await client.call("Page.printToPDF", { printBackground: true }); } catch (_) {}
    failOpenCheck("print-pdf-shows-stored-catalog", printText.media && printText.visible && Boolean(pdfBytes?.data), printText);
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
    await clickSelector(client, `[data-cabinet-kind="areas"] .bob-cabinet-toggle`);
    probe = await refreshProbe(client);
    const failedMount = probe.panels.find((row) => row.kind === "areas");
    const nativeRestored = probe.callouts.some((row) => row.kind === "areas" && row.visible);
    failOpenCheck("forced-mount-error-reveals-native-section", fault.ok && Boolean(failedMount?.error) && nativeRestored, { fault, failedMount, nativeRestored });
    await client.evaluate("window.__bobCabinetRestoreProvider?.(); delete window.__bobCabinetRestoreProvider");
    await client.evaluate(`app.plugins.disablePlugin(${JSON.stringify(PLUGIN_ID)})`);
    probe = await refreshProbe(client);
    const disabledVisible = await client.evaluate(`Boolean(document.querySelector('.callout[data-callout="areas"]'))`);
    failOpenCheck("plugin-disable-restores-stored-section", disabledVisible, probe);
    for (const row of failOpen) check(`fail-open-${row.name}`, row.status === "pass", row.detail);
    report.failOpen = failOpen;

    // Verify Vim navigation never strands the visible cursor in the hidden ranges.
    await client.evaluate(`app.plugins.enablePlugin(${JSON.stringify(PLUGIN_ID)})`);
    await sleep(800);
    await openAndProbe(client, lib.PATHS.area, "live");
    const motionResults = {};
    for (const [key, suffix] of [["j", null], ["k", null], ["g", "g"], ["G", null], ["ArrowDown", null], ["ArrowUp", null]]) {
      await sendKey(client, key);
      if (suffix) await sendKey(client, suffix);
      motionResults[key] = await client.evaluate(`(() => {
        const c = document.querySelector(".cm-vimCursorLayer .cm-fat-cursor.cm-cursor-primary, .cm-cursor-primary");
        if (!c) return false;
        const r = c.getBoundingClientRect(); const s = getComputedStyle(c);
        return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
      })()`);
    }
    check("vim-motions-and-arrows-no-invisible-cursor", Object.values(motionResults).every(Boolean), motionResults);
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
    const passiveBefore = readLog(logPath).length;
    await openAndProbe(client, lib.PATHS.area, "reading");
    await clickSelector(client, `[data-cabinet-kind="areas"] .bob-cabinet-toggle`);
    const beforeHashPassive = shared.markdownFilesHash(vault);
    const passiveKeys = await openAndProbe(client, lib.PATHS.area, "live");
    await sendKey(client, "_"); await sendKey(client, "Escape");
    await sendKey(client, "_"); await sendKey(client, "2");
    const afterHashPassive = shared.markdownFilesHash(vault);
    const passiveAfter = readLog(logPath).length;
    const passiveUnchanged = JSON.stringify(beforeHashPassive) === JSON.stringify(afterHashPassive);
    check("passive-actions-zero-bob-spawns", passiveAfter === passiveBefore, readLog(logPath));
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
            await openAndProbe(client, host.path, mode);
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
            if (shot.width <= 0 || shot.height <= 0) shot.captureFailures.push("screenshot has no dimensions");
            if (state.theme !== theme) shot.captureFailures.push(`theme expected ${theme}, got ${state.theme}`);
            if (host.state === "armed" && !state.armed) shot.captureFailures.push("armed screenshot has no armed pick");
            shot.visualVerdict = "pending visual review";
            report.screenshots.push(shot);
          }
        }
      }
    }
    for (const [name, feature] of [["reduced-motion", "prefers-reduced-motion"], ["forced-colors", "forced-colors"]]) {
      await shared.setViewport(client, 1400);
      await shared.setTheme(client, "light");
      await openAndProbe(client, lib.PATHS.area, "live");
      await client.call("Emulation.setEmulatedMedia", { media: "screen", features: [{ name: feature, value: feature === "forced-colors" ? "active" : "reduce" }] });
      await sleep(180);
      probe = await refreshProbe(client);
      const shot = await shared.capture(client, outDir, `area-live-light-wide-${name}`, 1400, "light", name);
      shot.reducedMotion = probe.reducedMotion;
      shot.forcedColors = probe.forcedColors;
      shot.captureFailures = [];
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
    if (child && child.exitCode == null) {
      try { child.kill("SIGTERM"); } catch (_) {}
      await sleep(250);
      if (child.exitCode == null) { try { child.kill("SIGKILL"); } catch (_) {} }
    }
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
