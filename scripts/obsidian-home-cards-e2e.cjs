#!/usr/bin/env node
// Real-Obsidian acceptance for the local Area/Project cards. Uses synthetic
// notes in an isolated vault/profile and never opens the live vault's notes.
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const lib = require("./obsidian-home-cards-e2e-lib.cjs");
const shared = require("./obsidian-record-card-e2e.cjs");
const taskReqs = require("./obsidian-task-reqs-e2e.cjs");
const repoRoot = path.resolve(__dirname, "..");
const PLUGIN_ID = "bob-ledger-tools";
const TASKS_DATA = {
  globalFilter: "#task",
  taskFormat: "dataview",
  statusSettings: {
    coreStatuses: [
      { symbol: " ", name: "Ready", type: "TODO" },
      { symbol: "x", name: "Done", type: "DONE" },
    ],
    customStatuses: [
      { symbol: "*", name: "Next", type: "ON_HOLD" },
      { symbol: "?", name: "Blocked", type: "TODO" },
      { symbol: "/", name: "In Progress", type: "IN_PROGRESS" },
      { symbol: "-", name: "Canceled", type: "CANCELLED" },
    ],
  },
};
const HOTKEYS = {
  "bob-navigation-hotkeys:set-bullet-property": [{ modifiers: ["Ctrl", "Shift"], key: "P" }],
  "task-status-cycler:toggle-task-open-done": [{ modifiers: ["Ctrl"], key: "Enter" }],
  "workspace:undo-close-pane": [{ modifiers: ["Ctrl", "Shift"], key: "E" }],
  "switcher:open": [{ modifiers: ["Ctrl", "Shift"], key: "O" }],
  "command-palette:open": [{ modifiers: ["Ctrl"], key: "P" }],
};
const PROBE_SOURCE = `(() => {
  const workspace = app.workspace;
  const leaf = workspace.activeLeaf;
  const view = leaf && leaf.view;
  const root = view && view.containerEl;
  const mode = view && view.getMode && view.getMode() === "preview" ? "reading"
    : view && view.getState && view.getState().source ? "source" : "live";
  const preview = root && root.querySelector ? root.querySelector(".markdown-preview-view") : null;
  const sourceView = root && root.querySelector ? root.querySelector(".markdown-source-view") : null;
  const surface = mode === "reading" ? preview : (mode === "source" || mode === "live" ? sourceView : root);
  const searchRoot = surface || root;
  const card = searchRoot && searchRoot.querySelector ? searchRoot.querySelector(".bob-home-card") : null;
  const visible = (node) => {
    if (!node || !node.getBoundingClientRect) return false;
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.display !== "none"
      && style.visibility !== "hidden" && Number(style.opacity || 1) > 0;
  };
  const properties = searchRoot && searchRoot.querySelectorAll
    ? Array.from(searchRoot.querySelectorAll(".metadata-container")) : [];
  const tile = card && card.querySelector(".bob-property-card-tile");
  const glyph = card && card.querySelector(".bob-property-card-tile-glyph");
  const lifecycle = card && card.querySelector(".bob-home-card-lifecycle-word");
  const title = card && card.querySelector(".bob-property-card-title");
  const rect = card && card.getBoundingClientRect ? card.getBoundingClientRect() : null;
  const foot = card && card.querySelector(".bob-property-card-foot");
  const disclosure = foot && foot.querySelector("[aria-expanded], .bob-property-card-foot-toggle, button");
  const drawer = foot && (foot.querySelector(".bob-property-card-drawer, [data-foot-drawer]")
    || (disclosure && disclosure.getAttribute && disclosure.getAttribute("aria-controls")
      ? document.getElementById(disclosure.getAttribute("aria-controls")) : null));
  const h1 = searchRoot && searchRoot.querySelector
    ? Array.from(searchRoot.querySelectorAll("h1")).find((node) => visible(node)) : null;
  const summary = card && card.querySelector(".bob-home-card-summary");
  const collapsible = card ? Array.from(card.querySelectorAll(".bob-home-card-collapsible")) : [];
  return {
    path: view && view.file && view.file.path || null,
    mode,
    cardPresent: Boolean(card),
    cardCount: searchRoot && searchRoot.querySelectorAll ? searchRoot.querySelectorAll(".bob-home-card").length : 0,
    kind: card && card.getAttribute("data-home-kind") || null,
    ariaLabel: card && card.getAttribute("aria-label") || null,
    title: title && String(title.textContent || "").trim() || null,
    icon: glyph && glyph.getAttribute("data-icon") || null,
    tileForm: tile && tile.getAttribute("data-tile-form") || null,
    lifecycle: lifecycle && String(lifecycle.textContent || "").trim() || null,
    lifecycleDetail: card && String(card.querySelector(".bob-home-card-lifecycle-detail")?.textContent || "").trim() || null,
    lifecycleVisible: Boolean(card && card.querySelector(".bob-home-card-lifecycle") && visible(card.querySelector(".bob-home-card-lifecycle"))),
    pills: card ? Array.from(card.querySelectorAll(".bob-home-card-pill")).map((node) => String(node.textContent || "").trim()) : [],
    crumbs: card ? Array.from(card.querySelectorAll(".bob-property-card-kicker-link")).map((node) => String(node.textContent || "").trim()) : [],
    chips: card ? Array.from(card.querySelectorAll(".bob-home-card-chip")).map((node) => String(node.textContent || "").trim()) : [],
    chipTags: card ? Array.from(card.querySelectorAll(".bob-home-card-chip")).map((node) => node.tagName) : [],
    settingsTag: card && card.querySelector(".bob-home-card-settings")
      ? card.querySelector(".bob-home-card-settings").tagName : null,
    chipCount: card ? card.querySelectorAll(".bob-home-card-chip").length : 0,
    metaPresent: Boolean(card && card.querySelector(".bob-home-card-meta")),
    footPresent: Boolean(foot),
    footId: foot && foot.id || null,
    drawerId: drawer && drawer.id || (disclosure && disclosure.getAttribute && disclosure.getAttribute("aria-controls")) || null,
    drawerOpen: Boolean(disclosure && disclosure.getAttribute && disclosure.getAttribute("aria-expanded") === "true"),
    collapsed: Boolean(card && card.classList && card.classList.contains("is-collapsed")),
    summaryVisible: Boolean(summary && visible(summary)),
    collapsibleHidden: collapsible.filter((node) => !visible(node)).length,
    nativePropertiesVisible: properties.some(visible),
    nativePropertiesCount: properties.length,
    headingVisible: Boolean(h1),
    headingText: h1 && String(h1.textContent || "").trim() || "",
    cardWidth: rect ? rect.width : 0,
    cardHeight: rect ? rect.height : 0,
    cardX: rect ? rect.x : 0,
    cardY: rect ? rect.y : 0,
    reducedMotion: Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches),
    mainWindow: window.activeWindow === window && window.activeDocument === document,
    cardText: card && String(card.textContent || "").replace(/\\s+/g, " ").trim() || "",
  };
})()`;

function pluginProvenance() {
  const git = (args) => {
    const result = require("node:child_process").spawnSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" });
    return String(result.stdout || "").trim();
  };
  const dir = path.join(repoRoot, "plugins", PLUGIN_ID);
  return {
    head: git(["rev-parse", "HEAD"]),
    dirtyPaths: git(["status", "--porcelain"]).split("\n").filter(Boolean),
    version: JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")).version,
  };
}

function tasksPluginSource() {
  const candidate = process.env.OBSIDIAN_TASKS_PLUGIN_DIR
    || path.join(os.homedir(), "bob", ".obsidian", "plugins", "obsidian-tasks-plugin");
  return ["main.js", "manifest.json"].every((name) => fs.existsSync(path.join(candidate, name)))
    ? candidate : null;
}

function copyPlugin(vaultDir, id, sourceDir, data) {
  const destination = path.join(vaultDir, ".obsidian", "plugins", id);
  fs.mkdirSync(destination, { recursive: true });
  for (const name of ["manifest.json", "main.js", "styles.css"]) {
    const source = path.join(sourceDir, name);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(destination, name));
  }
  if (data) fs.writeFileSync(path.join(destination, "data.json"), JSON.stringify(data, null, 2) + "\n");
}

function installVault(vaultDir, profileDir, tasksSource) {
  const notes = lib.fixtureNotes();
  for (const [notePath, content] of Object.entries(notes)) shared.writeNote(vaultDir, notePath, content);
  const obsidian = path.join(vaultDir, ".obsidian");
  fs.mkdirSync(obsidian, { recursive: true });
  const enabled = ["obsidian-tasks-plugin", PLUGIN_ID, "bob-navigation-hotkeys", "task-status-cycler"];
  copyPlugin(vaultDir, "obsidian-tasks-plugin", tasksSource, TASKS_DATA);
  for (const id of [PLUGIN_ID, "bob-navigation-hotkeys", "task-status-cycler"]) {
    copyPlugin(vaultDir, id, path.join(repoRoot, "plugins", id), id === PLUGIN_ID ? {} : undefined);
  }
  fs.writeFileSync(path.join(obsidian, "community-plugins.json"), JSON.stringify(enabled, null, 2) + "\n");
  fs.writeFileSync(path.join(obsidian, "core-plugins.json"), JSON.stringify([
    "file-explorer", "global-search", "switcher", "page-preview", "command-palette", "properties",
  ], null, 2) + "\n");
  fs.writeFileSync(path.join(obsidian, "app.json"), JSON.stringify({
    livePreview: true, showInlineTitle: true, propertiesInDocument: "visible", readableLineLength: true,
    vimMode: true, showLineNumber: false, alwaysUpdateLinks: false,
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(obsidian, "appearance.json"), JSON.stringify({ cssTheme: "", theme: "moonstone" }, null, 2) + "\n");
  fs.writeFileSync(path.join(obsidian, "hotkeys.json"), JSON.stringify(HOTKEYS, null, 2) + "\n");
  shared.seedProfile(profileDir, fs.realpathSync(vaultDir));
  shared.initScratchGit(vaultDir);
  const configDir = path.join(profileDir, ".config", "bob");
  fs.mkdirSync(configDir, { recursive: true });
  const configPath = path.join(configDir, "config.yml");
  fs.writeFileSync(configPath, lib.bobConfigYaml());
  return { notes, enabled, configPath };
}

function writeBobShim(shimDir, logPath) {
  fs.mkdirSync(shimDir, { recursive: true });
  const shim = path.join(shimDir, "bob");
  fs.writeFileSync(shim, `#!/usr/bin/env node
const fs = require("node:fs");
const row = { at: new Date().toISOString(), args: process.argv.slice(2) };
try { fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(row) + "\\n"); } catch (_) {}
process.stderr.write("Unexpected bob subprocess in local home-card acceptance\\n");
process.exit(87);
`);
  fs.chmodSync(shim, 0o755);
}

function readBobInvocations(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch (_) { return { raw: line }; }
  });
}

function waitForCard(client, notePath, mode) {
  return shared.waitFor(client, PROBE_SOURCE,
    (probe) => probe?.path === notePath && probe?.mode === mode && probe.cardPresent,
    `${mode} home card for ${notePath}`, 25_000);
}

async function openCardNote(client, notePath, mode = "live") {
  const state = mode === "reading" ? { mode: "preview", source: false }
    : mode === "source" ? { mode: "source", source: true }
      : { mode: "source", source: false };
  const opened = await shared.openNote(client, notePath, mode);
  const probe = await client.evaluate(PROBE_SOURCE);
  if (probe?.path === notePath) return opened;
  const recovered = await client.evaluate(`(async () => {
    const workspace = app.workspace;
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(notePath)});
    const leafPaths = () => workspace.getLeavesOfType("markdown").map((leaf) => leaf.view?.file?.path || null);
    if (!file) return { ok: false, error: "missing", leaves: leafPaths() };
    for (const leaf of workspace.getLeavesOfType("markdown")) {
      if (!leaf.view?.file) leaf.detach();
    }
    const leaf = workspace.getLeaf(true);
    await leaf.openFile(file, { state: ${JSON.stringify(state)} });
    if (leaf.view?.setState) {
      await leaf.view.setState(Object.assign({}, leaf.view.getState?.() || {}, ${JSON.stringify(state)}), { history: false });
    }
    workspace.setActiveLeaf(leaf, { focus: true });
    await new Promise((resolve) => setTimeout(resolve, 300));
    return { ok: leaf.view?.file?.path === ${JSON.stringify(notePath)}, path: leaf.view?.file?.path || null, leaves: leafPaths() };
  })()`);
  if (recovered?.ok !== true) {
    throw new Error(`openCardNote(${notePath}, ${mode}) left ${probe?.path}: ${JSON.stringify({ opened, recovered }).slice(0, 800)}`);
  }
  return recovered;
}

async function pinFixtureClock(client) {
  return client.evaluate(`(() => {
    const frozen = new Date(${JSON.stringify(lib.FIXTURE_CLOCK)});
    const RealDate = Date;
    function FrozenDate(...args) {
      if (new.target) {
        if (args.length === 0) return new RealDate(frozen.getTime());
        return new RealDate(...args);
      }
      return args.length === 0 ? frozen.toString() : RealDate(...args);
    }
    FrozenDate.now = () => frozen.getTime();
    FrozenDate.parse = RealDate.parse.bind(RealDate);
    FrozenDate.UTC = RealDate.UTC.bind(RealDate);
    FrozenDate.prototype = RealDate.prototype;
    window.Date = FrozenDate;
    return { now: Date.now(), iso: new Date().toISOString(), year: new Date().getFullYear() };
  })()`);
}

async function ensureMainWindow(client) {
  return client.evaluate(`(async () => {
    const closed = [];
    for (let i = 0; i < 3 && window.activeWindow && window.activeWindow !== window; i += 1) {
      const title = window.activeDocument ? window.activeDocument.title : "";
      if (!/^Settings\\b/.test(title)) break;
      try { window.activeWindow.close(); closed.push(title); } catch (_) { break; }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    window.dispatchEvent(new FocusEvent("focus"));
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { closed, mainActive: window.activeWindow === window && window.activeDocument === document };
  })()`);
}

async function clickSelector(client, selector) {
  const clicked = await client.evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return { ok: false, reason: "missing" };
    node.click();
    return { ok: true, tag: node.tagName, text: String(node.textContent || "").trim().slice(0, 80) };
  })()`);
  if (!clicked?.ok) throw new Error("cannot click " + selector);
  await shared.sleep(120);
  return clicked;
}

async function setReducedMotion(client, on) {
  await client.call("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: on ? "reduce" : "no-preference" }],
  });
  await shared.sleep(80);
}

function inspectShot(shot, probe, expect) {
  const geometry = lib.inspectGeometry(probe, expect);
  const failures = [...geometry.failures];
  if (!shot?.bytes) failures.push("screenshot is empty");
  if (expect.viewportWidth && shot.width !== expect.viewportWidth) {
    failures.push(`viewport width ${shot.width} !== ${expect.viewportWidth}`);
  }
  shot.container = geometry.container;
  shot.probePath = probe?.path || null;
  shot.visualVerdict = failures.length ? `fail: ${failures.join("; ")}` : "pass";
  shot.inspectFailures = failures;
  return failures;
}

async function run(args) {
  const executable = args.executable || process.env.OBSIDIAN_BIN || "/snap/bin/obsidian";
  fs.accessSync(executable, fs.constants.X_OK);
  const tasksSource = tasksPluginSource();
  if (!tasksSource) throw new Error("The real Obsidian Tasks plugin is required for the ^prj close-gesture check; set OBSIDIAN_TASKS_PLUGIN_DIR to its installed plugin directory.");
  const outDir = args.out || path.join(os.tmpdir(), `bob-home-cards-shots-${process.pid}`);
  const reportPath = args.report || path.join(os.tmpdir(), `bob-home-cards-report-${process.pid}.json`);
  fs.mkdirSync(outDir, { recursive: true });
  let scratch = null;
  let client = null;
  let child = null;
  const report = {
    startedAt: new Date().toISOString(),
    plugin: pluginProvenance(),
    tasksPlugin: path.basename(tasksSource),
    fixtureToday: lib.FIXTURE_TODAY,
    checks: [], screenshots: [], consoleErrors: [], bobInvocations: [],
    screenshotDirectory: outDir,
  };
  const check = (name, ok, detail = null) => report.checks.push({ name, status: ok ? "pass" : "fail", detail });
  try {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "bob-home-cards-"));
    const vaultDir = path.join(scratch, "vault");
    const profileDir = path.join(scratch, "profile");
    const shimDir = path.join(profileDir, "shim");
    const bobLog = path.join(profileDir, "bob-invocations.jsonl");
    fs.mkdirSync(profileDir, { recursive: true });
    const { notes, enabled, configPath } = installVault(vaultDir, profileDir, tasksSource);
    writeBobShim(shimDir, bobLog);
    report.scratch = { root: scratch, vault: fs.realpathSync(vaultDir), profile: profileDir, fixtures: Object.keys(notes).sort(), config: configPath };
    report.enabledPlugins = enabled;
    report.fixtureHashesBefore = shared.markdownFilesHash(vaultDir);

    const port = await shared.freePort();
    child = spawn(executable, [
      "--no-sandbox", `--user-data-dir=${profileDir}`, `--remote-debugging-port=${port}`,
      "--remote-allow-origins=http://127.0.0.1/*", fs.realpathSync(vaultDir),
    ], {
      cwd: os.tmpdir(),
      env: {
        ...process.env,
        HOME: profileDir,
        XDG_CONFIG_HOME: path.join(profileDir, ".config"),
        BOB_DIR: fs.realpathSync(vaultDir),
        BOB_CONFIG_FILE: configPath,
        BOB_NOW: `${lib.FIXTURE_TODAY} 12:00:00`,
        PATH: shimDir + path.delimiter + (process.env.PATH || ""),
        DBUS_SESSION_BUS_ADDRESS: "disabled:",
        TMPDIR: "/tmp",
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    const stderr = [];
    child.stderr.on("data", (chunk) => stderr.push(String(chunk).slice(0, 1000)));
    report.obsidianProcess = { pid: child.pid, executable };
    const target = await shared.selectTarget(port, fs.realpathSync(vaultDir), () => child && child.exitCode == null);
    client = target.client;
    client.on("Runtime.exceptionThrown", (params) => {
      const details = params.exceptionDetails || {};
      report.consoleErrors.push({ text: details.text || "", description: details.exception?.description || "", url: details.url || "" });
    });
    client.on("Log.entryAdded", (params) => {
      if (params.entry?.level === "error") report.consoleErrors.push({ text: params.entry.text || "", url: params.entry.url || "" });
    });
    await client.call("Runtime.enable");
    await client.call("Log.enable");
    report.pluginStartup = { trust: await shared.trustCommunityPlugins(client), stderr: stderr.slice(-8) };
    await shared.waitFor(client, `(() => {
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      const n = app.plugins.plugins["bob-navigation-hotkeys"];
      const t = app.plugins.plugins["task-status-cycler"];
      const tasks = app.plugins.plugins["obsidian-tasks-plugin"];
      return p?.homeCardActive === true && n && t && tasks ? { ledger: true, navigation: true, cycler: true, tasks: true } : null;
    })()`, (value) => value && value.ledger && value.navigation && value.cycler && value.tasks,
    "home-card and task gesture plugins", 40_000);
    await client.call("Page.bringToFront").catch(() => null);
    await client.call("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => null);
    report.windowFocus = await ensureMainWindow(client);
    if (!report.windowFocus?.mainActive) {
      throw new Error("the vault window is not Obsidian's active window: " + JSON.stringify(report.windowFocus));
    }
    report.pinnedClock = await pinFixtureClock(client);
    check("fixture-clock-pinned", report.pinnedClock?.year === 2026, report.pinnedClock);
    await shared.collapseSidebars(client);
    await shared.setViewport(client, lib.WIDE_VIEWPORT, 1000);
    await shared.setTheme(client, "light");

    const bobBeforeMatrix = readBobInvocations(bobLog).length;
    const hashBeforeMatrix = shared.markdownFilesHash(vaultDir);
    for (const [notePath, expected] of Object.entries(lib.EXPECTED)) {
      for (const mode of ["live", "reading"]) {
        await openCardNote(client, notePath, mode);
        const probe = await waitForCard(client, notePath, mode);
        const failures = lib.cardFailures(probe, notePath, mode);
        check(`card:${notePath}:${mode}`, failures.length === 0, { probe, failures, expected });
      }
    }
    for (const [notePath, expected] of Object.entries(lib.EXTRA_EXPECTED)) {
      await openCardNote(client, notePath, "live");
      const probe = await waitForCard(client, notePath, "live");
      const failures = lib.cardFailures(probe, notePath, "live", lib.EXTRA_EXPECTED);
      check(`extra:${notePath}:live`, failures.length === 0, { probe, failures, expected });
    }
    await openCardNote(client, lib.PATHS.untyped, "live");
    const untyped = await shared.waitFor(client, PROBE_SOURCE, (probe) => probe?.path === lib.PATHS.untyped, "untyped note", 15_000);
    check("untyped-has-no-home-card", untyped.cardPresent !== true && untyped.nativePropertiesVisible === true, untyped);
    const bobAfterMatrix = readBobInvocations(bobLog);
    const matrixBob = bobAfterMatrix.slice(bobBeforeMatrix);
    const matrixHomeCardBob = lib.homeCardTriggeredBob(matrixBob);
    check("matrix-spawns-no-home-card-bob", matrixHomeCardBob.length === 0, {
      before: bobBeforeMatrix, after: bobAfterMatrix.length,
      attributed: matrixBob.map(lib.classifyBobInvocation),
      homeCardTriggered: matrixHomeCardBob,
    });
    check("matrix-writes-no-markdown", shared.markdownFilesHash(vaultDir) === hashBeforeMatrix, {
      before: hashBeforeMatrix, after: shared.markdownFilesHash(vaultDir),
    });

    await openCardNote(client, lib.PATHS.area, "source");
    const sourceProbe = await shared.waitFor(client, PROBE_SOURCE, (probe) => probe?.path === lib.PATHS.area && probe?.mode === "source", "source mode", 15_000);
    check("source-mode-has-no-card", sourceProbe.cardPresent !== true, sourceProbe);

    await openCardNote(client, lib.PATHS.long, "live");
    await waitForCard(client, lib.PATHS.long, "live");
    await clickSelector(client, ".bob-home-card-collapse");
    const collapsed = await shared.waitFor(client, PROBE_SOURCE, (probe) => probe?.collapsed === true, "collapsed area card", 10_000);
    check("collapse-hides-summary-keeps-foot", collapsed.collapsed && collapsed.footPresent && collapsed.summaryVisible !== true && collapsed.nativePropertiesVisible, collapsed);
    await openCardNote(client, lib.PATHS.wip, "live");
    await waitForCard(client, lib.PATHS.wip, "live");
    await clickSelector(client, ".bob-home-card-collapse");
    const collapsedProject = await shared.waitFor(client, PROBE_SOURCE, (probe) => probe?.path === lib.PATHS.wip && probe?.collapsed === true, "collapsed project", 10_000);
    check("collapse-keeps-project-lifecycle", collapsedProject.lifecycleVisible === true && collapsedProject.collapsed, collapsedProject);
    await openCardNote(client, lib.PATHS.long, "reading");
    const readingCollapse = await waitForCard(client, lib.PATHS.long, "reading");
    check("collapse-state-shared-across-modes", readingCollapse.collapsed === true, readingCollapse);
    await clickSelector(client, ".bob-home-card-collapse");
    await shared.waitFor(client, PROBE_SOURCE, (probe) => probe?.collapsed !== true, "expand area", 10_000);

    await openCardNote(client, lib.PATHS.long, "live");
    await waitForCard(client, lib.PATHS.long, "live");
    await ensureMainWindow(client);
    await client.evaluate(`(() => {
      const editor = document.querySelector(".markdown-source-view .cm-content");
      if (editor && editor.focus) editor.focus();
      return Boolean(editor);
    })()`);
    await taskReqs.key(client, "Escape");
    await taskReqs.key(client, "-");
    const drawer = await shared.waitFor(client, PROBE_SOURCE, (probe) => probe?.drawerOpen === true, "drawer opens on -", 12_000);
    check("minus-opens-drawer", drawer.drawerOpen === true && drawer.footPresent, drawer);
    const drawerId = drawer.drawerId;
    await taskReqs.key(client, "-");
    const drawerClosed = await shared.waitFor(client, PROBE_SOURCE, (probe) => probe?.drawerOpen !== true, "drawer closes on -", 12_000);
    check("minus-closes-drawer", drawerClosed.drawerOpen !== true, drawerClosed);
    await openCardNote(client, lib.PATHS.long, "reading");
    await waitForCard(client, lib.PATHS.long, "reading");
    await clickSelector(client, ".bob-property-card-foot [aria-expanded], .bob-property-card-foot button");
    const readingDrawer = await shared.waitFor(client, PROBE_SOURCE, (probe) => probe?.drawerOpen === true, "reading drawer", 10_000);
    check("reading-drawer-independent-ids", Boolean(readingDrawer.drawerId), { live: drawerId, reading: readingDrawer.drawerId });

    await openCardNote(client, lib.PATHS.legacy, "live");
    await waitForCard(client, lib.PATHS.legacy, "live");
    await ensureMainWindow(client);
    await clickSelector(client, ".bob-home-card-chip");
    const editorOpen = await shared.waitFor(client, `Boolean(document.querySelector(".bob-property-editor"))`, Boolean, "chip opens browse editor", 12_000);
    check("chip-opens-browse-editor", editorOpen === true, { editorOpen });
    await taskReqs.key(client, "Escape");
    await shared.waitFor(client, `!document.querySelector(".bob-property-editor")`, Boolean, "editor closed", 10_000);
    await clickSelector(client, ".bob-home-card-settings");
    const settingsOpen = await shared.waitFor(client, `Boolean(document.querySelector(".bob-property-editor"))`, Boolean, "Settings opens browse editor", 12_000);
    check("settings-opens-browse-editor", settingsOpen === true, { settingsOpen });
    await taskReqs.key(client, "Escape");
    await shared.waitFor(client, `!document.querySelector(".bob-property-editor")`, Boolean, "settings editor closed", 10_000);

    const inert = await client.evaluate(`(() => {
      const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      plugin.__homeCardOpenPropertyEditor = plugin.openPropertyEditor;
      plugin.openPropertyEditor = undefined;
      plugin.scheduleHomeCardRefresh();
      return true;
    })()`);
    const inertProbe = await shared.waitFor(client, PROBE_SOURCE, (probe) => (
      probe?.path === lib.PATHS.legacy && probe?.settingsTag === "SPAN"
      && Array.isArray(probe.chipTags) && probe.chipTags.every((tag) => tag === "SPAN")
    ), "missing editor API renders inert chips", 12_000);
    check("missing-editor-api-is-inert", inertProbe.chipTags.every((tag) => tag === "SPAN") && inertProbe.settingsTag === "SPAN", inertProbe);
    await client.evaluate(`(() => {
      const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      plugin.openPropertyEditor = plugin.__homeCardOpenPropertyEditor;
      plugin.scheduleHomeCardRefresh();
      return true;
    })()`);
    void inert;

    await openCardNote(client, lib.PATHS.subarea, "live");
    const crumb = await waitForCard(client, lib.PATHS.subarea, "live");
    check("crumb-present", crumb.crumbs.includes("Development"), crumb);
    const crumbClick = await client.evaluate(`(() => {
      const link = document.querySelector(".bob-property-card-kicker-link");
      if (!link) return { ok: false };
      const event = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true, button: 0 });
      link.dispatchEvent(event);
      const aux = new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 });
      link.dispatchEvent(aux);
      return { ok: true, text: String(link.textContent || "").trim(), leaves: app.workspace.getLeavesOfType("markdown").length };
    })()`);
    check("modifier-crumbs-dispatch", crumbClick?.ok === true, crumbClick);

    await openCardNote(client, lib.PATHS.area, "live");
    await waitForCard(client, lib.PATHS.area, "live");
    const eligibility = await client.evaluate(`(async () => {
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(lib.PATHS.area)});
      const previous = await app.vault.read(file);
      await app.vault.modify(file, previous.replace('type: "[[area]]"', "type: note"));
      return { previous };
    })()`);
    const ineligible = await shared.waitFor(client, PROBE_SOURCE, (probe) => probe?.path === lib.PATHS.area && probe?.cardPresent !== true, "eligibility dropped", 15_000);
    check("eligibility-change-removes-card", ineligible.cardPresent !== true && ineligible.nativePropertiesVisible, ineligible);
    await client.evaluate(`(async () => {
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(lib.PATHS.area)});
      await app.vault.modify(file, ${JSON.stringify(eligibility.previous)});
      return true;
    })()`);
    await waitForCard(client, lib.PATHS.area, "live");

    const renamed = await client.evaluate(`(async () => {
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(lib.PATHS.lateTitle)});
      await app.fileManager.renameFile(file, "renamed_late.md");
      return app.vault.getAbstractFileByPath("renamed_late.md") ? "renamed_late.md" : null;
    })()`);
    await openCardNote(client, renamed, "live");
    const renamedProbe = await waitForCard(client, renamed, "live");
    check("rename-remounts-card", renamedProbe.cardPresent === true && renamedProbe.lifecycle === "WIP", renamedProbe);
    await client.evaluate(`(async () => {
      const file = app.vault.getAbstractFileByPath("renamed_late.md");
      await app.fileManager.renameFile(file, ${JSON.stringify(lib.PATHS.lateTitle)});
      return true;
    })()`);

    await openCardNote(client, lib.PATHS.createdInvalid, "live");
    await waitForCard(client, lib.PATHS.createdInvalid, "live");
    await client.evaluate(`(async () => {
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(lib.PATHS.createdInvalid)});
      await app.vault.delete(file);
      return true;
    })()`);
    const deleted = await shared.waitFor(client, PROBE_SOURCE, (probe) => probe?.path !== lib.PATHS.createdInvalid || probe?.cardPresent !== true, "deleted note", 15_000);
    check("delete-releases-card", deleted.path !== lib.PATHS.createdInvalid || deleted.cardPresent !== true, deleted);
    shared.writeNote(vaultDir, lib.PATHS.createdInvalid, notes[lib.PATHS.createdInvalid]);

    await openCardNote(client, lib.PATHS.area, "live");
    await waitForCard(client, lib.PATHS.area, "live");
    const denied = await client.evaluate(`(() => {
      const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      const view = app.workspace.activeLeaf.view;
      const results = {};
      for (const cls of ["markdown-embed", "hover-popover", "canvas-node", "print"]) {
        view.containerEl.classList.add(cls);
        plugin.scheduleHomeCardRefresh();
      }
      results.classes = Array.from(view.containerEl.classList);
      plugin.homeCardDesktop = () => false;
      plugin.scheduleHomeCardRefresh();
      return results;
    })()`);
    await shared.sleep(500);
    const deniedProbe = await shared.waitFor(client, PROBE_SOURCE, (probe) => probe?.path === lib.PATHS.area, "denied contexts", 10_000);
    check("denied-contexts-drop-card", deniedProbe.cardPresent !== true, { denied, probe: deniedProbe });
    await client.evaluate(`(() => {
      const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      const view = app.workspace.activeLeaf.view;
      for (const cls of ["markdown-embed", "hover-popover", "canvas-node", "print"]) view.containerEl.classList.remove(cls);
      delete plugin.homeCardDesktop;
      plugin.scheduleHomeCardRefresh();
      return true;
    })()`);
    await waitForCard(client, lib.PATHS.area, "live");

    await openCardNote(client, lib.PATHS.missing, "reading");
    await waitForCard(client, lib.PATHS.missing, "reading");
    await client.evaluate(`(() => {
      const workspace = app.workspace;
      const active = workspace.activeLeaf;
      for (const leaf of workspace.getLeavesOfType("markdown")) {
        if (leaf !== active) leaf.detach();
      }
      const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      plugin.__homeCardBuildMounted = plugin.homeCardBuildMounted.bind(plugin);
      plugin.homeCardBuildMounted = () => null;
      plugin.homeCardSetCollapsed(${JSON.stringify(lib.PATHS.missing)}, true);
      return true;
    })()`);
    const failedMount = await shared.waitFor(client, PROBE_SOURCE, (probe) => (
      probe?.path === lib.PATHS.missing && probe?.cardPresent !== true && probe?.headingVisible === true
    ), "injected mount failure", 15_000);
    check("failed-mount-restores-native-title", failedMount.cardPresent !== true && failedMount.headingVisible === true, failedMount);
    await client.evaluate(`(() => {
      const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      plugin.homeCardBuildMounted = plugin.__homeCardBuildMounted;
      plugin.scheduleHomeCardRefresh();
      return true;
    })()`);
    await waitForCard(client, lib.PATHS.missing, "reading");

    await taskReqs.setMode(client, false, true);
    await client.call("Page.bringToFront").catch(() => null);
    await client.call("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => null);
    await ensureMainWindow(client);
    const cancelKeys = [
      { name: "Escape", key: "Escape" },
      { name: "q", key: "q" },
      { name: "ctrl-bracket", key: { key: "[", modifiers: taskReqs.CTRL, vk: 219 } },
    ];
    for (const row of cancelKeys) {
      await openCardNote(client, lib.PATHS.wip, "source");
      const focused = await client.evaluate(`(() => {
        const workspace = app.workspace;
        const leaf = workspace.activeLeaf;
        const editor = leaf?.view?.editor;
        if (!editor) return { ok: false };
        workspace.setActiveLeaf(leaf, { focus: true });
        const lines = editor.getValue().split(/\\r?\\n/);
        const line = lines.findIndex((value) => value.includes("^prj"));
        editor.setCursor({ line, ch: 3 });
        editor.focus();
        const content = document.querySelector(".markdown-source-view .cm-content");
        if (content && content.focus) content.focus();
        return {
          ok: line >= 0, line,
          main: window.activeWindow === window,
          active: document.activeElement?.className || "",
          mode: leaf?.view?.getMode?.() || null,
          source: leaf?.view?.getState?.()?.source === true,
        };
      })()`);
      check(`task-card-focus:${row.name}`, focused.ok && focused.main, focused);
      await shared.sleep(300);
      const opened = await client.evaluate(`(() => {
        const dump = () => {
          const nav = app.plugins.plugins["bob-navigation-hotkeys"];
          const picker = nav && nav.activeBulletPropertyPicker;
          return {
            registered: Boolean(app.commands.commands?.["bob-navigation-hotkeys:set-bullet-property"]),
            hasEditorCallback: typeof app.commands.commands?.["bob-navigation-hotkeys:set-bullet-property"]?.editorCallback === "function",
            notices: Array.from(document.querySelectorAll(".notice")).map((node) => String(node.textContent || "").trim()).filter(Boolean).slice(0, 8),
            modals: Array.from(document.querySelectorAll(".modal")).map((node) => node.className),
            title: Boolean(document.querySelector(".bob-task-card-title")),
            pickerOpen: picker ? picker.pickerOpen === true : false,
            pickerStage: picker && picker.stage || null,
            pickerConnected: Boolean(picker && picker.modalEl && picker.modalEl.isConnected),
            cursor: (() => {
              try { return app.workspace.activeLeaf?.view?.editor?.getCursor?.() || null; }
              catch (_) { return null; }
            })(),
            line: (() => {
              try {
                const editor = app.workspace.activeLeaf?.view?.editor;
                const cursor = editor && editor.getCursor && editor.getCursor();
                return cursor && editor.getLine ? editor.getLine(cursor.line) : null;
              } catch (_) { return null; }
            })(),
          };
        };
        const nav = app.plugins.plugins["bob-navigation-hotkeys"];
        const editor = app.workspace.activeLeaf?.view?.editor;
        if (nav && nav.activeBulletPropertyPicker && typeof nav.activeBulletPropertyPicker.close === "function") {
          try { nav.activeBulletPropertyPicker.close(); } catch (_) {}
        }
        const command = app.commands.commands?.["bob-navigation-hotkeys:set-bullet-property"];
        let ran;
        let via = "missing";
        try {
          if (command && typeof command.editorCallback === "function" && editor) {
            via = "editorCallback";
            ran = command.editorCallback(editor);
          } else if (nav && typeof nav.openBulletPropertyPicker === "function" && editor) {
            via = "openBulletPropertyPicker";
            ran = nav.openBulletPropertyPicker(editor);
          } else {
            via = "executeCommandById";
            ran = app.commands.executeCommandById("bob-navigation-hotkeys:set-bullet-property");
          }
        } catch (error) {
          ran = String(error && error.message || error);
        }
        let state = dump();
        if (!state.pickerConnected && !state.title && nav && typeof nav.openBulletPropertyPicker === "function" && editor && via !== "openBulletPropertyPicker") {
          via = "openBulletPropertyPicker-fallback";
          try { ran = nav.openBulletPropertyPicker(editor); } catch (error) { ran = String(error && error.message || error); }
          state = dump();
        }
        return { ran, via, ...state };
      })()`);
      if (opened?.pickerConnected !== true && opened?.title !== true && opened?.pickerOpen !== true) {
        throw new Error("Task Card " + row.name + " did not open: " + JSON.stringify(opened).slice(0, 1800));
      }
      const visible = await shared.waitFor(client, `(() => {
        const nav = app.plugins.plugins["bob-navigation-hotkeys"];
        const picker = nav && nav.activeBulletPropertyPicker;
        return Boolean(document.querySelector(".bob-task-card-modal, .bob-cnp-modal, .bob-task-card-title"))
          || Boolean(picker && (picker.pickerOpen === true || (picker.modalEl && picker.modalEl.isConnected)));
      })()`, Boolean, `Task Card ${row.name}`, 12_000);
      check(`task-card-open:${row.name}`, visible === true && opened.ran !== false, opened);
      await taskReqs.key(client, row.key);
      const closed = await shared.waitFor(client, `(() => {
        const nav = app.plugins.plugins["bob-navigation-hotkeys"];
        const picker = nav && nav.activeBulletPropertyPicker;
        return !document.querySelector(".bob-task-card-modal, .bob-cnp-modal")
          && !(picker && picker.modalEl && picker.modalEl.isConnected);
      })()`, Boolean, `Task Card close ${row.name}`, 12_000);
      check(`task-card-close:${row.name}`, closed === true, { closed });
      await openCardNote(client, lib.PATHS.wip, "live");
      const after = await waitForCard(client, lib.PATHS.wip, "live");
      check(`task-card-leaves-wip:${row.name}`, after.lifecycle === "WIP" && fs.readFileSync(path.join(vaultDir, lib.PATHS.wip), "utf8") === notes[lib.PATHS.wip], after);
    }

    await client.evaluate(`(() => {
      const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      for (const notePath of ${JSON.stringify([lib.PATHS.area, lib.PATHS.wip, lib.PATHS.done, lib.PATHS.long])}) {
        plugin.homeCardSetCollapsed(notePath, false);
      }
      return true;
    })()`);
    const hashBeforeShots = shared.markdownFilesHash(vaultDir);
    const bobBeforeShots = readBobInvocations(bobLog).length;
    for (const notePath of [lib.PATHS.area, lib.PATHS.wip, lib.PATHS.done]) {
      const expected = lib.EXPECTED[notePath];
      for (const mode of ["live", "reading"]) {
        for (const theme of ["light", "dark"]) {
          await shared.setTheme(client, theme);
          for (const [widthName, width] of [["narrow", lib.NARROW_VIEWPORT], ["wide", lib.WIDE_VIEWPORT]]) {
            await shared.setViewport(client, width, 1000);
            await shared.collapseSidebars(client);
            await openCardNote(client, notePath, mode);
            const probe = await waitForCard(client, notePath, mode);
            const failures = lib.cardFailures(probe, notePath, mode);
            if (failures.length) throw new Error(`Refusing invalid screenshot ${notePath}/${mode}/${theme}/${widthName}: ${failures.join("; ")}`);
            const name = `${notePath.replace(/\.md$/, "")}-${mode}-${theme}-${widthName}`;
            const shot = await shared.capture(client, outDir, name, width, theme, mode);
            shot.notePath = notePath;
            const inspect = inspectShot(shot, probe, {
              viewportWidth: width,
              narrow: widthName === "narrow",
              wide: widthName === "wide",
              collapsed: false,
              nativePropertiesVisible: true,
            });
            shot.captureFailures = inspect;
            report.screenshots.push(shot);
            void expected;
          }
        }
      }
    }

    await shared.setTheme(client, "light");
    await shared.setViewport(client, lib.WIDE_VIEWPORT, 1000);
    await openCardNote(client, lib.PATHS.long, "live");
    await waitForCard(client, lib.PATHS.long, "live");
    await clickSelector(client, ".bob-home-card-collapse");
    const collapsedShotProbe = await shared.waitFor(client, PROBE_SOURCE, (probe) => probe?.collapsed === true, "collapsed shot", 10_000);
    const collapsedShot = await shared.capture(client, outDir, "long_area-live-light-wide-collapsed", lib.WIDE_VIEWPORT, "light", "live");
    collapsedShot.captureFailures = inspectShot(collapsedShot, collapsedShotProbe, { viewportWidth: lib.WIDE_VIEWPORT, wide: true, collapsed: true, nativePropertiesVisible: true });
    report.screenshots.push(collapsedShot);
    await clickSelector(client, ".bob-home-card-collapse");
    await taskReqs.setMode(client, true, true);
    await client.evaluate(`(() => {
      const editor = document.querySelector(".markdown-source-view .cm-content");
      if (editor && editor.focus) editor.focus();
      return Boolean(editor);
    })()`);
    await taskReqs.key(client, "Escape");
    await taskReqs.key(client, "-");
    const drawerShotProbe = await shared.waitFor(client, PROBE_SOURCE, (probe) => probe?.drawerOpen === true, "drawer shot", 12_000);
    const drawerShot = await shared.capture(client, outDir, "long_area-live-light-wide-drawer", lib.WIDE_VIEWPORT, "light", "live");
    drawerShot.captureFailures = inspectShot(drawerShot, drawerShotProbe, { viewportWidth: lib.WIDE_VIEWPORT, wide: true, drawerOpen: true, nativePropertiesVisible: true });
    report.screenshots.push(drawerShot);

    await setReducedMotion(client, true);
    await openCardNote(client, lib.PATHS.wip, "live");
    const reducedProbe = await waitForCard(client, lib.PATHS.wip, "live");
    const reducedShot = await shared.capture(client, outDir, "root_plan-live-light-wide-reduced", lib.WIDE_VIEWPORT, "light", "live");
    reducedShot.captureFailures = inspectShot(reducedShot, reducedProbe, { viewportWidth: lib.WIDE_VIEWPORT, wide: true, nativePropertiesVisible: true });
    report.screenshots.push(reducedShot);
    await setReducedMotion(client, false);

    await shared.setTheme(client, "dark");
    await shared.setViewport(client, lib.NARROW_VIEWPORT, 1000);
    await openCardNote(client, lib.PATHS.long, "live");
    await waitForCard(client, lib.PATHS.long, "live");
    await clickSelector(client, ".bob-home-card-collapse");
    const darkNarrow = await shared.waitFor(client, PROBE_SOURCE, (probe) => probe?.collapsed === true, "dark narrow collapsed", 10_000);
    const darkNarrowShot = await shared.capture(client, outDir, "long_area-live-dark-narrow-collapsed", lib.NARROW_VIEWPORT, "dark", "live");
    darkNarrowShot.captureFailures = inspectShot(darkNarrowShot, darkNarrow, { viewportWidth: lib.NARROW_VIEWPORT, narrow: true, collapsed: true, nativePropertiesVisible: true });
    report.screenshots.push(darkNarrowShot);
    await shared.setTheme(client, "light");
    await shared.setViewport(client, lib.WIDE_VIEWPORT, 1000);

    check("screenshot-ops-write-no-markdown", shared.markdownFilesHash(vaultDir) === hashBeforeShots, {
      before: hashBeforeShots, after: shared.markdownFilesHash(vaultDir),
    });
    const bobAfterShots = readBobInvocations(bobLog);
    const shotBob = bobAfterShots.slice(bobBeforeShots);
    const shotHomeCardBob = lib.homeCardTriggeredBob(shotBob);
    check("screenshot-ops-spawn-no-home-card-bob", shotHomeCardBob.length === 0, {
      before: bobBeforeShots, after: bobAfterShots.length,
      attributed: shotBob.map(lib.classifyBobInvocation),
      homeCardTriggered: shotHomeCardBob,
    });

    const taskPath = lib.PATHS.complete;
    await openCardNote(client, taskPath, "live");
    await waitForCard(client, taskPath, "live");
    await taskReqs.setMode(client, true, true);
    const cursor = await client.evaluate(`(() => {
      const editor = app.workspace.activeLeaf.view.editor;
      const lines = editor.getValue().split(/\\r?\\n/);
      const line = lines.findIndex((value) => value.includes("^prj"));
      const ch = lines[line]?.indexOf("completion fixture") ?? -1;
      if (line < 0 || ch < 0) return { ok: false, line, ch, value: editor.getValue() };
      editor.setCursor({ line, ch });
      editor.focus();
      return { ok: true, line, ch, text: lines[line] };
    })()`);
    await taskReqs.key(client, "Escape");
    await taskReqs.key(client, "i");
    await taskReqs.key(client, "Z");
    let editProbe = await taskReqs.readEditor(client);
    const inserted = editProbe?.doc?.includes("Close this Zcompletion fixture");
    await taskReqs.key(client, "Backspace");
    await taskReqs.key(client, "Escape");
    editProbe = await taskReqs.readEditor(client);
    check("prj-cursor-integrity", cursor.ok && inserted && editProbe?.doc === notes[taskPath], {
      cursor, inserted, restored: editProbe?.doc === notes[taskPath],
    });

    await taskReqs.setMode(client, false, true);
    await ensureMainWindow(client);
    const prjLine = await client.evaluate(`(() => {
      const workspace = app.workspace;
      const leaf = workspace.activeLeaf;
      const editor = leaf?.view?.editor;
      if (!editor) return -1;
      workspace.setActiveLeaf(leaf, { focus: true });
      const lines = editor.getValue().split(/\\r?\\n/);
      const line = lines.findIndex((value) => value.includes("^prj"));
      editor.setCursor({ line, ch: 3 }); editor.focus();
      return line;
    })()`);
    await taskReqs.key(client, { key: "Enter", modifiers: taskReqs.CTRL, vk: 13 });
    const closeState = await shared.waitFor(client, `(async () => {
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(taskPath)});
      const text = file ? await app.vault.read(file) : "";
      const editor = app.workspace.activeLeaf.view.editor;
      return { text, editor: editor.getValue(), done: /- \\[x\\] #task #prj Close this completion fixture.*\\^prj/.test(text) };
    })()`, (value) => value && value.done, "Ctrl+Enter closes the completion fixture", 20_000);
    const doneProbe = await shared.waitFor(client, PROBE_SOURCE,
      (value) => value?.path === taskPath && value?.lifecycle === "DONE", "done Project Card after task close", 15_000);
    check("prj-close-gesture", closeState.done && doneProbe.lifecycle === "DONE", {
      task: taskPath, line: prjLine, persisted: closeState.done,
      editorHasDone: /- \\[x\\]/.test(closeState.editor), lifecycle: doneProbe.lifecycle,
    });
    const wipStill = fs.readFileSync(path.join(vaultDir, lib.PATHS.wip), "utf8");
    check("completion-uses-separate-fixture", wipStill === notes[lib.PATHS.wip], { wipUnchanged: wipStill === notes[lib.PATHS.wip] });
    report.fixtureHashesAfterGesture = shared.markdownFilesHash(vaultDir);
    const otherFixtureChanges = [];
    for (const notePath of Object.keys(notes)) {
      if (notePath === taskPath) continue;
      const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(vaultDir, notePath))).digest("hex");
      const expectedHash = crypto.createHash("sha256").update(notes[notePath]).digest("hex");
      if (actual !== expectedHash) otherFixtureChanges.push(notePath);
    }
    check("gesture-only-writes-its-project-note", otherFixtureChanges.length === 0, otherFixtureChanges);

    report.bobInvocations = readBobInvocations(bobLog);
    const expectedShots = lib.screenshotNeeds();
    const haveShots = new Set(report.screenshots.map((row) => row.name));
    const missingShots = expectedShots.filter((name) => !haveShots.has(name));
    const badShots = report.screenshots.filter((row) => row.captureFailures?.length).map((row) => ({ name: row.name, failures: row.captureFailures, verdict: row.visualVerdict, container: row.container }));
    check("screenshots-captured", missingShots.length === 0 && badShots.length === 0, { missingShots, badShots, count: report.screenshots.length });
    check("screenshots-inspected", report.screenshots.every((row) => row.visualVerdict === "pass" && row.container && row.container.width > 0), report.screenshots.map((row) => ({ name: row.name, verdict: row.visualVerdict, container: row.container })));
    check("no-console-errors", report.consoleErrors.length === 0, report.consoleErrors);
    report.pass = report.checks.every((row) => row.status === "pass");
  } catch (error) {
    report.error = error && error.stack ? error.stack : String(error);
    check("runner-error", false, String(error && error.message || error));
    if (client) {
      try { report.failureScreenshot = await shared.capture(client, outDir, "home-cards-runner-failure", 1400, "light", "failure"); }
      catch (_) {}
    }
    report.pass = false;
  } finally {
    if (client) client.close();
    if (child && child.exitCode == null) {
      try { child.kill("SIGTERM"); } catch (_) {}
      await shared.sleep(300);
      if (child.exitCode == null) { try { child.kill("SIGKILL"); } catch (_) {} }
    }
    if (scratch && fs.existsSync(scratch)) {
      if (report.pass) fs.rmSync(scratch, { recursive: true, force: true });
      else report.scratchPreserved = true;
    }
    report.finishedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  }
  const failed = report.checks.filter((row) => row.status === "pass" ? false : true);
  process.stdout.write(`${report.pass ? "PASS" : "FAIL"} home-card Obsidian acceptance (${report.checks.length} checks, ${report.screenshots.length} screenshots)\n`);
  process.stdout.write(`Report: ${reportPath}\nScreenshots: ${outDir}\n`);
  if (failed.length) {
    for (const row of failed) process.stderr.write(`- ${row.name}: ${JSON.stringify(row.detail)}\n`);
    process.exitCode = 1;
  }
  return report;
}

async function main(argv) {
  let args;
  try { args = lib.parseArgs(argv); }
  catch (error) {
    process.stderr.write(String(error.message || error) + "\n" + lib.HELP_TEXT + "\n");
    process.exitCode = 2;
    return;
  }
  if (args.help) { process.stdout.write(lib.HELP_TEXT + "\n"); return; }
  if (args.selfTest) {
    try {
      lib.selfTest();
      new Function("return " + PROBE_SOURCE);
      process.stdout.write("offline self-test complete (synthetic fixtures and probes; no Obsidian launched)\n");
    } catch (error) {
      process.stderr.write(String(error.stack || error) + "\n");
      process.exitCode = 1;
    }
    return;
  }
  await run(args);
}

if (require.main === module) void main(process.argv.slice(2));
module.exports = { PROBE_SOURCE, installVault, parseArgs: lib.parseArgs, run, tasksPluginSource, pinFixtureClock, ensureMainWindow };
