#!/usr/bin/env node
// Real-Obsidian `((` walkthrough (epic bob-cli-oz, phase task-walkthrough).
// One owned Obsidian on a scratch profile and Git vault drives the real hosts
// over CDP with trusted key events:
//
//   S1        Unlink Work summary          (block-id-prompt Ctrl+Shift+Enter)
//   S6        Successor inline cancel      (dense reason; api.successors.pick)
//   S10       Task Card schedule review    (reason field)
//   S11       Task Card scheduled reason   (`3 waiting on ((...` after minOffset)
//   S14       Intention Card reflection
//   S15-text  Record Card text stage
//   S15-link  Record Card link stage       (field mode; `((` only at offset 0)
//
// Each host: accept an identified task, NAME an ID-less task (cycle a
// suggestion), confirm ` ^id` plus the freshness stamp, undo once, check
// Enter safety and the Esc ladder, submit, and confirm `[[target#^id]]` in
// the written note. Then `bob task reconcile` must mint 💬 mention chips
// without a Task Link or relation. The live vault is never opened.
//
//   BOB_BIN=<bob> xvfb-run -a node scripts/obsidian-prose-task-e2e.cjs \
//     -e /snap/obsidian/current/app/obsidian -r /tmp/prose-task-walk.json \
//     -o /tmp/prose-task-shots
//
// Node 20 needs --experimental-websocket (the CDP client uses the global WebSocket).
"use strict";

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const ELECTRON_FALLBACK = "/snap/obsidian/current/app/obsidian";
const PLUGIN_IDS = ["bob-navigation-hotkeys", "block-id-prompt", "bob-ledger-tools"];
const TASKS_PATH = "tasks.md";
const OMEGA_PATH = "omega.md";
const RECORD_PATH = "movies/equilibrium.md";
const IDENTIFIED_LINK = "[[omega#^omega]]";
const SURFACES = ["S1", "S6", "S10", "S11", "S14", "S15-text", "S15-link"];
const HELP = [
  "Usage: node scripts/obsidian-prose-task-e2e.cjs [options]",
  "",
  "Walk (( task-link completion through real Bob prose prompts in an isolated Obsidian.",
  "",
  "Options:",
  "  -e, --executable PATH  Obsidian Electron binary (default: $OBSIDIAN_BIN or " + ELECTRON_FALLBACK + ")",
  "  -o, --out DIR          Screenshot directory (default: a new temp directory)",
  "  -r, --report PATH      JSON report path (default: <out>/prose-task-report.json)",
  "      --only IDS         Comma-separated subset of " + SURFACES.join(","),
  "  -s, --self-test        Offline fixture checks; never launches Obsidian",
  "  -h, --help             Show this help",
  "",
  "Environment: BOB_BIN (required for a live run) is the bob binary the plugins spawn.",
].join("\n");

function parseArgs(argv) {
  const args = { executable: null, out: null, report: null, only: null, selfTest: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = () => {
      const next = argv[++index];
      if (!next || next.startsWith("-")) throw new Error(token + " requires a value");
      return next;
    };
    if (token === "-e" || token === "--executable") args.executable = value();
    else if (token === "-o" || token === "--out") args.out = path.resolve(value());
    else if (token === "-r" || token === "--report") args.report = path.resolve(value());
    else if (token === "--only") args.only = value().split(",").map((item) => item.trim()).filter(Boolean);
    else if (token === "-s" || token === "--self-test") args.selfTest = true;
    else if (token === "-h" || token === "--help") args.help = true;
    else throw new Error("Unknown argument: " + token);
  }
  for (const id of args.only || []) if (!SURFACES.includes(id)) throw new Error("Unknown surface: " + id);
  return args;
}

function dateText(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
}

function bobConfigYaml() {
  return [
    "timezone: America/New_York",
    "properties:",
    "  - name: scheduled",
    "    values: date",
    "relations:",
    "  linked_from_mentions: true",
    "",
  ].join("\n");
}

function albumNotes() {
  const album = [
    "---", 'type: "[[album]]"', 'parent: "[[proj]]"', "summary: Movies record fixtures.", "record:",
    "  noun: movie", "  fields:",
    "    status: {required: true, values: {planned: Planned, watched: Watched}}",
    "    service: {}",
    "    reference: {values: link}",
    "---", "", "# Movies", "",
  ].join("\n");
  const record = [
    "---", 'type: "[[record]]"', 'parent: "[[movies]]"', 'title: "Equilibrium"', "created: 2026-11-15",
    "status: watched", "---", "", "## Notes", "", "- A record for the (( walkthrough.", "",
  ].join("\n");
  return {
    "type.md": "# Type\n",
    "area.md": '---\ntype: "[[area]]"\nparent: "[[type]]"\n---\n\n# Home\n\n## Albums\n',
    "body.md": '---\ntype: "[[area]]"\nparent: "[[area]]"\n---\n\n# Body\n\n## Albums\n',
    "proj.md": '---\ntype: "[[project]]"\nparent: "[[body]]"\nstatus: wip\n---\n\n# Project\n\n## Albums\n',
    "movies.md": album,
    [RECORD_PATH]: record,
  };
}

function fixture(today) {
  const intention = require("./obsidian-intention-card-e2e-lib.cjs");
  const { plan, notes: periodNotes } = intention.fixturePlan(today);
  const notes = {};
  for (const key of ["today", "yesterday", "week", "quarter"]) notes[plan.paths[key]] = periodNotes[plan.paths[key]];
  notes["gtd_daily.md"] = periodNotes["gtd_daily.md"];
  notes[plan.paths.today] = notes[plan.paths.today].replace(/\n*$/, "\n") + [
    "",
    "## Pomodoros",
    "",
    "- [ ] (**0900-0925** [t:: 25m]) — BUILD",
    "\t- 🍅 [[tasks#^alpha]]",
    "",
  ].join("\n");
  notes[OMEGA_PATH] = [
    "# Omega",
    "",
    "- [ ] #task Omega identified ^omega",
    "",
  ].join("\n");
  notes[TASKS_PATH] = [
    "# Tasks",
    "",
    "- [/] #task Alpha unlink summary ^alpha",
    "- [/] #task Beta schedule review ^beta",
    "- [ ] #task Gamma scheduled reason ^gamma",
    "- [ ] #task Sigma successor ^sigma",
    "- [ ] #task Zxqone nameless",
    "- [ ] #task Zxqsix nameless",
    "- [ ] #task Zxqten nameless",
    "- [ ] #task Zxqelv nameless",
    "- [ ] #task Zxqref nameless",
    "- [ ] #task Zxqtxt nameless",
    "- [ ] #task Zxqlnk nameless",
    "",
  ].join("\n");
  Object.assign(notes, albumNotes());
  return { plan, notes };
}

function writeVault(vaultDir, notes) {
  for (const [name, content] of Object.entries(notes)) {
    const file = path.join(vaultDir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  const obsidian = path.join(vaultDir, ".obsidian");
  for (const id of PLUGIN_IDS) {
    const target = path.join(obsidian, "plugins", id);
    fs.mkdirSync(target, { recursive: true });
    for (const name of ["manifest.json", "main.js", "styles.css"]) {
      const source = path.join(repoRoot, "plugins", id, name);
      if (fs.existsSync(source)) fs.copyFileSync(source, path.join(target, name));
    }
  }
  fs.writeFileSync(path.join(obsidian, "community-plugins.json"), JSON.stringify(PLUGIN_IDS, null, 2));
  fs.writeFileSync(path.join(obsidian, "core-plugins.json"), JSON.stringify([
    "file-explorer", "command-palette", "daily-notes", "page-preview", "editor-status", "properties",
  ], null, 2));
  fs.writeFileSync(path.join(obsidian, "daily-notes.json"), JSON.stringify({ folder: "", format: "YYYY/YYYYMMDD" }, null, 2));
  fs.writeFileSync(path.join(obsidian, "app.json"), JSON.stringify({
    livePreview: true, showLineNumber: false, showInlineTitle: true, propertiesInDocument: "visible", vimMode: false,
  }, null, 2));
  fs.writeFileSync(path.join(obsidian, "appearance.json"), JSON.stringify({ cssTheme: "", theme: "moonstone" }, null, 2));
}

const KEY_CODES = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8, ArrowDown: 40, ArrowUp: 38 };

function keyPayload(key, modifiers) {
  const vk = KEY_CODES[key] || key.toUpperCase().charCodeAt(0);
  const code = /^[a-z]$/i.test(key) ? "Key" + key.toUpperCase() : key === "[" ? "BracketLeft" : key;
  const text = modifiers & 7 ? "" : key === "Enter" ? "\r" : key.length === 1 ? key : "";
  return { key, code, modifiers, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text };
}

function keyDownEvent(key, modifiers = 0, autoRepeat = false) {
  const { text, ...payload } = keyPayload(key, modifiers);
  return { type: text ? "keyDown" : "rawKeyDown", ...payload, ...(text ? { text, unmodifiedText: text } : {}), autoRepeat };
}

function keyUpEvent(key, modifiers = 0) {
  const { text: _text, ...payload } = keyPayload(key, modifiers);
  return { type: "keyUp", ...payload };
}

const FIELD_PROBE = `(() => {
  const el = document.activeElement;
  const textual = Boolean(el && typeof el.value === "string");
  const containers = Array.from(document.querySelectorAll(".modal-container"));
  const scope = (el && el.closest && el.closest(".modal-container")) || containers[containers.length - 1] || document;
  const band = Array.from(scope.querySelectorAll(".bob-link-band"))
    .find((node) => !node.classList.contains("is-hidden") && node.getClientRects().length > 0) || null;
  const rows = band ? Array.from(band.querySelectorAll(".bob-link-band-row:not(.is-empty)")) : [];
  return {
    tag: el ? el.tagName : null, id: el ? el.id || null : null, className: el ? String(el.className || "") : "",
    value: textual ? el.value : null, start: textual ? el.selectionStart : null, end: textual ? el.selectionEnd : null,
    bandOpen: Boolean(band),
    tasks: Boolean(band && band.classList.contains("is-tasks")),
    naming: Boolean(band && band.classList.contains("is-naming")),
    dense: Boolean(band && band.classList.contains("is-dense")),
    title: band ? (band.querySelector(".bob-link-band-title")?.textContent || "") : "",
    idLine: band ? (band.querySelector(".bob-task-band-id-entry")?.textContent || "") : "",
    detail: band ? (band.querySelector(".bob-link-band-result")?.textContent || "") : "",
    rows: rows.map((row) => (row.innerText || row.textContent || "").replace(/\\s+/g, " ").trim()),
    selected: rows.findIndex((row) => row.classList.contains("is-selected")),
    selectedText: (rows.find((row) => row.classList.contains("is-selected")) || { innerText: "" }).innerText
      ? (rows.find((row) => row.classList.contains("is-selected")).innerText || "").replace(/\\s+/g, " ").trim()
      : "",
    modals: containers.length,
  };
})()`;

function noteTextExpression(notePath) {
  return `(async () => {
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(notePath)});
    if (!file) return null;
    for (const leaf of app.workspace.getLeavesOfType("markdown")) {
      if (leaf.view?.file?.path === file.path && leaf.view.editor) {
        try { await leaf.view.save(); } catch (_) {}
      }
    }
    return app.vault.read(file);
  })()`;
}

const HOSTS = {
  S1: `(() => { const modal = document.querySelector(".modal.bid-wlp-modal"); return { open: Boolean(modal && modal.isConnected), stage: modal ? "work-summary" : null }; })()`,
  S6: `(() => { const m = app.plugins.plugins["bob-navigation-hotkeys"]?.activeSuccessorPicker; return { open: Boolean(m && m.modalEl?.isConnected), stage: m && m.reasonEditKey ? "reason" : "picker", reason: m && m.reasonEditKey && m.verdicts instanceof Map ? (m.verdicts.get(m.reasonEditKey) || null) : null }; })()`,
  picker: `(() => { const p = app.plugins.plugins["bob-navigation-hotkeys"]?.activeBulletPropertyPicker; return { open: Boolean(p && p.pickerOpen !== false && p.modalEl?.isConnected), stage: p ? p.stage : null }; })()`,
  intention: `(() => { const m = app.plugins.plugins["bob-ledger-tools"]?.intentionCardEditorModal; return { open: Boolean(m && !m.closed), stage: m && m.stage ? m.stage.kind : null, pending: Boolean(m && m.pendingApply), status: m ? m.statusKind : null }; })()`,
  record: `(() => { const m = app.plugins.plugins["bob-ledger-tools"]?.recordCardModal; return { open: Boolean(m && !m.closed), stage: m && m.stage ? m.stage.kind : null, pending: Boolean(m && m.pendingApply), status: m ? m.statusKind : null, ready: Boolean(m && m.session), sessionStatus: m?.sessionState?.status || null, canApply: Boolean(m?.sessionState?.canApply), draftOps: m?.sessionState?.draftOps || null }; })()`,
};

const NAMED = {
  S1: { title: "Zxqone nameless", query: "zxqone", needle: "Zxqone nameless" },
  S6: { title: "Zxqsix nameless", query: "zxqsix", needle: "Zxqsix nameless" },
  S10: { title: "Zxqten nameless", query: "zxqten", needle: "Zxqten nameless" },
  S11: { title: "Zxqelv nameless", query: "zxqelv", needle: "Zxqelv nameless" },
  S14: { title: "Zxqref nameless", query: "zxqref", needle: "Zxqref nameless" },
  "S15-text": { title: "Zxqtxt nameless", query: "zxqtxt", needle: "Zxqtxt nameless" },
  "S15-link": { title: "Zxqlnk nameless", query: "zxqlnk", needle: "Zxqlnk nameless" },
};

async function live(args, report) {
  const shared = require("./obsidian-record-card-e2e.cjs");
  const { sleep, waitFor } = shared;
  const bobBin = process.env.BOB_BIN;
  if (!bobBin) throw new Error("Set BOB_BIN to the bob binary the walkthrough should spawn.");
  const bobPath = fs.realpathSync(bobBin);
  const version = spawnSync(bobPath, ["--version"], { encoding: "utf8", timeout: 15_000 });
  if (version.status !== 0) throw new Error("BOB_BIN --version failed: " + (version.stderr || version.stdout));
  report.bob = { path: bobPath, version: String(version.stdout || "").trim(), sha256: shared.sha256File(bobPath) };
  if (process.env.BOB_CLI_DIR) {
    const head = spawnSync("git", ["-C", process.env.BOB_CLI_DIR, "rev-parse", "HEAD"], { encoding: "utf8" });
    report.bob.sourceSha = String(head.stdout || "").trim() || null;
  }
  const executable = args.executable || process.env.OBSIDIAN_BIN || ELECTRON_FALLBACK;
  fs.accessSync(executable, fs.constants.X_OK);
  report.executable = executable;

  const today = dateText(new Date());
  const { plan, notes } = fixture(today);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "bob-prose-task-e2e-"));
  const vaultDir = path.join(scratch, "vault");
  const profileDir = path.join(scratch, "profile");
  const shimDir = path.join(profileDir, "shim");
  const configDir = path.join(profileDir, ".config", "bob");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "config.yml"), bobConfigYaml());
  writeVault(vaultDir, notes);
  shared.writeBobShim(shimDir);
  shared.initScratchGit(vaultDir);
  const vaultReal = fs.realpathSync(vaultDir);
  shared.seedProfile(profileDir, vaultReal);
  const logPath = path.join(profileDir, "bob-invocations.jsonl");
  const env = {
    ...process.env,
    HOME: profileDir,
    XDG_CONFIG_HOME: path.join(profileDir, ".config"),
    BOB_DIR: vaultReal,
    BOB_NOW: today + " 12:00:00",
    BOB_CONFIG_FILE: path.join(configDir, "config.yml"),
    BOB_RECORD_CARD_E2E_LOG: logPath,
    BOB_RECORD_CARD_E2E_REAL: bobPath,
    PATH: shimDir + path.delimiter + (process.env.PATH || ""),
    NO_COLOR: "1",
    TMPDIR: "/tmp",
  };
  report.scratch = { root: scratch, vault: vaultReal, today, fixturePaths: Object.keys(notes).sort() };
  const sync = spawnSync(bobPath, ["albums", "sync", "-f", "json"], { cwd: vaultReal, env, encoding: "utf8", timeout: 90_000 });
  report.albumSync = { exitCode: sync.status, stderr: String(sync.stderr || "").slice(0, 800) };

  let child = null;
  let client = null;
  const outDir = report.screenshotDirectory;
  try {
    const port = await shared.freePort();
    child = spawn(executable, [
      "--no-sandbox", "--user-data-dir=" + profileDir, "--remote-debugging-port=" + port,
      "--remote-allow-origins=http://127.0.0.1/*", vaultReal,
    ], { cwd: os.tmpdir(), env, stdio: ["ignore", "ignore", "pipe"] });
    child.stderr.on("data", () => {});
    const target = await shared.selectTarget(port, vaultReal, () => child && child.exitCode == null);
    client = target.client;
    await client.call("Runtime.enable");
    await client.call("Page.enable");
    client.on("Runtime.exceptionThrown", (params) => {
      const details = params.exceptionDetails || {};
      report.consoleExceptions.push({ text: details.text || "", description: (details.exception?.description || "").slice(0, 800) });
    });
    report.pluginStartup = { trust: await shared.trustCommunityPlugins(client) };
    await waitFor(client, `(() => {
      const nav = app.plugins.plugins["bob-navigation-hotkeys"];
      const bip = app.plugins.plugins["block-id-prompt"];
      const ok = ${JSON.stringify(PLUGIN_IDS)}.every((id) => Boolean(app.plugins.plugins[id]));
      const omega = Boolean(app.metadataCache.getCache(${JSON.stringify(OMEGA_PATH)}));
      return ok && Number(nav?.api?.proseField?.version) >= 2 && Number(bip?.api?.taskLinks?.version) >= 1 && omega;
    })()`, Boolean, "plugins, proseField v2, taskLinks v1, and omega", 60_000);
    await client.call("Page.bringToFront").catch(() => null);
    await client.call("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => null);
    const settingsDeadline = Date.now() + 6000;
    let settings = null;
    while (Date.now() < settingsDeadline && !settings) {
      const targets = await fetch("http://127.0.0.1:" + port + "/json/list").then((r) => r.json()).catch(() => []);
      settings = targets.find((item) => item.type === "page" && /^Settings\b/.test(item.title || "") && item.webSocketDebuggerUrl) || null;
      if (!settings) await sleep(200);
    }
    let settingsClosed = false;
    if (settings) {
      try {
        const settingsClient = await shared.CdpClient.connect(settings.webSocketDebuggerUrl);
        await settingsClient.evaluate("window.close(), true").catch(() => null);
        settingsClient.close();
        settingsClosed = true;
      } catch (_) {}
      await sleep(400);
    }
    report.windowFocus = { settingsSeen: Boolean(settings), settingsClosed, startup: await ensureMainWindow(client) };
    if (!report.windowFocus.startup.mainActive) throw new Error("the vault window is not Obsidian's active window: " + JSON.stringify(report.windowFocus));
    report.app = await client.evaluate(`({ version: app.version || "", plugins: Object.fromEntries(${JSON.stringify(PLUGIN_IDS)}.map((id) => [id, app.plugins.manifests[id]?.version || null])) })`);
    await shared.collapseSidebars(client);
    await shared.setViewport(client, 1280, 900);
    await client.evaluate(`(() => {
      window.__bobProseNotices = [];
      const seen = () => {
        for (const node of document.querySelectorAll(".notice")) {
          const text = (node.textContent || "").trim();
          if (text && !window.__bobProseNotices.includes(text)) window.__bobProseNotices.push(text);
        }
      };
      new MutationObserver(seen).observe(document.body, { childList: true, subtree: true });
      return true;
    })()`);

    const ctx = { client, report, outDir, plan, sleep, waitFor, shared, env, bobPath, vaultReal, today };
    const only = args.only ? new Set(args.only) : null;
    const run = async (id, fn) => {
      if (only && !only.has(id)) return;
      const entry = { id, checks: [], screenshots: [] };
      report.surfaces.push(entry);
      await client.evaluate("window.__bobProseNotices.length = 0").catch(() => null);
      entry.window = await ensureMainWindow(client);
      try {
        await recover(ctx);
        await fn({ ...ctx, entry });
      } catch (error) {
        entry.error = String(error && error.stack || error);
        check(entry, "surface-completed", false, entry.error.slice(0, 600));
        try { await shot(ctx, entry, "failure"); } catch (_) {}
        await recover(ctx);
      }
      entry.notices = await client.evaluate("window.__bobProseNotices.slice()").catch(() => null);
    };
    await run("S1", surfaceS1);
    await run("S6", surfaceS6);
    await run("S10", surfaceS10);
    await run("S11", surfaceS11);
    await run("S14", surfaceS14);
    await run("S15-text", surfaceS15Text);
    await run("S15-link", surfaceS15Link);
    report.mentions = await mentionRoundTrip(ctx);
    report.bobInvocations = fs.existsSync(logPath)
      ? fs.readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((line) => {
        const row = JSON.parse(line);
        return { event: row.event, args: row.args, exitCode: row.exitCode ?? null };
      })
      : [];
  } finally {
    try { client?.close(); } catch (_) {}
    try { child?.kill("SIGTERM"); } catch (_) {}
    await sleep(500);
    try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (_) {}
    try { fs.rmSync(vaultDir + ".origin.git", { recursive: true, force: true }); } catch (_) {}
  }
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

function check(entry, name, ok, detail) {
  entry.checks.push({ name: name, ok: Boolean(ok), detail: detail === undefined ? null : detail });
  return Boolean(ok);
}

async function shot(ctx, entry, label, theme = "light") {
  if (theme === "dark" && ctx.shared.setTheme) await ctx.shared.setTheme(ctx.client, "dark");
  const name = entry.id + "-" + String(entry.screenshots.length + 1).padStart(2, "0") + "-" + label + "-" + theme;
  const result = await ctx.shared.capture(ctx.client, ctx.outDir, name, 1280, theme === "dark" ? "obsidian" : "moonstone", label);
  entry.screenshots.push(result);
  if (theme === "dark" && ctx.shared.setTheme) await ctx.shared.setTheme(ctx.client, "light");
  return result;
}

async function stageShots(ctx, entry, label) {
  if (entry.id !== "S1") return;
  await shot(ctx, entry, label, "light");
  await shot(ctx, entry, label, "dark");
  await ctx.client.evaluate(`(() => {
    const el = document.querySelector("#bid-wlp-summary, .bob-cnp-input, textarea, input");
    if (el && typeof el.focus === "function") el.focus();
    return true;
  })()`);
  await ctx.sleep(80);
}

async function recover(ctx) {
  await ctx.client.evaluate(`(() => {
    try { app.plugins.plugins["bob-ledger-tools"]?.intentionCardEditorModal?.close(); } catch (_) {}
    try { app.plugins.plugins["bob-ledger-tools"]?.recordCardModal?.close(); } catch (_) {}
    try { app.plugins.plugins["bob-navigation-hotkeys"]?.activeBulletPropertyPicker?.close(); } catch (_) {}
    try { app.plugins.plugins["bob-navigation-hotkeys"]?.activeSuccessorPicker?.close(); } catch (_) {}
    for (const button of Array.from(document.querySelectorAll(".modal-container .modal-close-button"))) { try { button.click(); } catch (_) {} }
    return true;
  })()`).catch(() => null);
  await ctx.sleep(400);
}

async function refocusPrompt(ctx) {
  await ctx.client.evaluate(`(() => {
    const selectors = [
      "#bid-wlp-summary",
      "#bob-schedule-review-reason",
      ".bob-successor-reason-input",
      ".bob-cnp-input",
      "textarea[data-intention-input]",
      "input[data-intention-input]",
      ".bob-record-card textarea",
      ".bob-record-card input",
      ".modal-container input:not([type='hidden'])",
      ".modal-container textarea",
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.offsetParent !== null && typeof el.focus === "function") {
        el.focus();
        return el.id || el.className || el.tagName;
      }
    }
    return null;
  })()`);
  await ctx.sleep(80);
}

function io(ctx) {
  const { client, sleep, waitFor } = ctx;
  const press = async (key, modifiers = 0) => {
    await client.call("Input.dispatchKeyEvent", keyDownEvent(key, modifiers));
    await client.call("Input.dispatchKeyEvent", keyUpEvent(key, modifiers));
    await sleep(60);
  };
  const type = async (text) => {
    for (const ch of Array.from(text)) {
      await client.call("Input.insertText", { text: ch });
      await sleep(25);
    }
    await sleep(120);
  };
  const field = () => client.evaluate(FIELD_PROBE);
  const waitField = (predicate, label, timeoutMs = 12_000) => waitFor(client, FIELD_PROBE, predicate, label, timeoutMs);
  const host = (expr) => client.evaluate(expr);
  const waitHost = (expr, predicate, label, timeoutMs = 15_000) => waitFor(client, expr, predicate, label, timeoutMs);
  return { press, type, field, waitField, host, waitHost };
}

async function selectRowContaining(ctx, needle) {
  const { press, field } = io(ctx);
  for (let index = 0; index < 12; index += 1) {
    const view = await field();
    const selected = view.selectedText || (view.selected >= 0 ? view.rows[view.selected] : "");
    if (selected && selected.includes(needle)) return view;
    await press("ArrowDown");
  }
  throw new Error("could not select row containing " + needle);
}

async function openTasksAt(ctx, needle) {
  const opened = await ctx.shared.openNote(ctx.client, TASKS_PATH, "source");
  if (!opened.ok) throw new Error("could not open " + TASKS_PATH + ": " + JSON.stringify(opened));
  const placed = await ctx.client.evaluate(`(() => {
    const view = app.workspace.activeLeaf?.view;
    const editor = view?.editor;
    if (!editor) return { ok: false };
    const line = editor.getValue().split("\\n").findIndex((text) => text.includes(${JSON.stringify(needle)}));
    if (line < 0) return { ok: false, reason: "missing line" };
    editor.setCursor({ line, ch: 0 });
    editor.focus();
    return { ok: true, line };
  })()`);
  if (!placed.ok) throw new Error("could not place the cursor on " + needle + ": " + JSON.stringify(placed));
  await ctx.sleep(250);
}

async function runCommand(ctx, id) {
  const ran = await ctx.client.evaluate(`(() => { try { return app.commands.executeCommandById(${JSON.stringify(id)}) !== false; } catch (error) { return String(error && error.message || error); } })()`);
  if (ran !== true) throw new Error("command " + id + " did not run: " + JSON.stringify(ran));
}

async function confirmNamedLine(ctx, entry, title, id) {
  const pattern = new RegExp(
    "^- \\[[ x/-]\\] #task " + title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      + "(?: \\[[^\\]]+:: [^\\]]+\\])* \\^" + id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?:\\s|$)",
    "m",
  );
  const text = await ctx.waitFor(ctx.client, noteTextExpression(TASKS_PATH),
    (value) => typeof value === "string" && pattern.test(value),
    "named " + title, 20_000).catch((error) => ({ error: error.message }));
  const ok = typeof text === "string";
  const line = ok ? text.split("\n").find((row) => row.includes(title)) : null;
  const stamped = ok && /\[[a-zA-Z]+:: [^\]]+\]/.test(line || "") && line.includes(" ^" + id);
  check(entry, "named-line-gained-id-and-stamp", ok && (stamped || (line || "").includes(" ^" + id)),
    { line, id, stamped });
  return { ok, line, id };
}

async function walkTasks(ctx, entry, hostExpr, prefix, named, options = {}) {
  const { press, type, field, waitField, host } = io(ctx);
  const fieldMode = options.fieldMode === true;
  const identifiedQuery = "omega";
  const identifiedToken = "((" + identifiedQuery;
  const idlessToken = "((" + named.query;
  const identifiedInserted = IDENTIFIED_LINK;

  if (!fieldMode) await type(prefix);
  await type(identifiedToken);
  const filtered = await waitField(
    (v) => v.bandOpen && v.tasks && v.rows.some((row) => /Omega identified/.test(row)),
    "tasks band lists Omega",
    60_000,
  );
  check(entry, "paren-opens-tasks-band-and-filters",
    filtered.tasks && filtered.value === (fieldMode ? identifiedToken : prefix + identifiedToken),
    { value: filtered.value, title: filtered.title, rows: filtered.rows, tasks: filtered.tasks });
  await stageShots(ctx, entry, "list");

  await ctx.client.call("Input.dispatchKeyEvent", keyDownEvent("Enter"));
  await ctx.sleep(150);
  const accepted = await field();
  await ctx.client.call("Input.dispatchKeyEvent", keyDownEvent("Enter", 0, true));
  await ctx.client.call("Input.dispatchKeyEvent", keyDownEvent("Enter", 0, true));
  await ctx.sleep(250);
  const heldHost = await host(hostExpr);
  await ctx.client.call("Input.dispatchKeyEvent", keyUpEvent("Enter"));
  await ctx.sleep(100);
  const identifiedValue = fieldMode ? identifiedInserted : prefix + identifiedInserted;
  check(entry, "enter-accepts-identified-without-submitting",
    accepted.value === identifiedValue && !accepted.bandOpen && accepted.start === identifiedValue.length,
    { value: accepted.value, caret: accepted.start, bandOpen: accepted.bandOpen });
  check(entry, "held-enter-never-submits-after-identified",
    heldHost.open && (await field()).value === identifiedValue,
    { host: heldHost, value: (await field()).value });

  if (fieldMode) {
    await press("z", 2);
    await ctx.sleep(200);
    await press("a", 2);
    await press("Backspace");
  } else {
    await type(" ");
  }

  await type(idlessToken);
  const idless = await waitField(
    (v) => v.bandOpen && v.tasks && !v.naming && v.rows.some((row) => row.includes(named.title) && /⊕/.test(row)),
    "tasks band lists the ID-less row",
    20_000,
  );
  check(entry, "idless-row-listed", idless.rows.some((row) => row.includes(named.title)),
    { rows: idless.rows, value: idless.value });
  const selectedIdless = await selectRowContaining(ctx, named.title);
  check(entry, "idless-row-selected", (selectedIdless.selectedText || "").includes(named.title),
    { selected: selectedIdless.selectedText, rows: selectedIdless.rows });

  const beforeName = await ctx.client.evaluate(noteTextExpression(TASKS_PATH));
  await ctx.client.call("Input.dispatchKeyEvent", keyDownEvent("Enter"));
  await ctx.sleep(150);
  const namedOpen = await field();
  await ctx.client.call("Input.dispatchKeyEvent", keyDownEvent("Enter", 0, true));
  await ctx.sleep(200);
  const stillNaming = await field();
  const noteDuringHold = await ctx.client.evaluate(noteTextExpression(TASKS_PATH));
  await ctx.client.call("Input.dispatchKeyEvent", keyUpEvent("Enter"));
  check(entry, "enter-on-idless-opens-name", namedOpen.naming && namedOpen.value === idless.value,
    { naming: namedOpen.naming, value: namedOpen.value, title: namedOpen.title });
  check(entry, "held-enter-never-writes-from-list-to-name",
    stillNaming.naming && stillNaming.value === idless.value && noteDuringHold === beforeName,
    { naming: stillNaming.naming, value: stillNaming.value });
  await stageShots(ctx, entry, "name");

  const beforeCycle = (await field()).idLine;
  await press("Tab");
  await ctx.sleep(120);
  let cycled = await field();
  if (cycled.naming && cycled.idLine === beforeCycle) {
    await press("ArrowDown");
    await ctx.sleep(80);
    cycled = await field();
  }
  check(entry, "tab-cycles-name-suggestion", cycled.naming && typeof cycled.idLine === "string" && cycled.idLine.length > 0,
    { before: beforeCycle, after: cycled.idLine });

  const naming = await field();
  const id = String((naming && naming.idLine) || "").trim();
  check(entry, "name-id-ready", Boolean(naming && naming.naming && id), { id, title: naming && naming.title, naming: naming && naming.naming });
  if (!(naming && naming.naming)) {
    throw new Error("NAME was not open for the write: " + JSON.stringify(naming));
  }
  await press("Enter");
  await ctx.sleep(400);
  const namedLink = "[[tasks#^" + id + "]]";
  const afterName = fieldMode ? namedLink : (prefix + identifiedInserted + " " + namedLink);
  const inserted = await waitField((v) => !v.bandOpen && typeof v.value === "string" && v.value.includes("[[tasks#^"),
    "NAME write inserted the link", 20_000);
  check(entry, "name-enter-inserts-link-without-submitting",
    inserted.value === afterName || (inserted.value || "").includes(namedLink),
    { value: inserted.value, expected: afterName, id });
  const namedHost = await host(hostExpr);
  check(entry, "name-enter-never-submits", namedHost.open, { host: namedHost });
  await confirmNamedLine(ctx, entry, named.title, id);

  await press("z", 2);
  await ctx.sleep(200);
  const undone = await field();
  const undoneExpected = fieldMode ? idlessToken : (prefix + identifiedInserted + " " + idlessToken);
  check(entry, "one-ctrl-z-restores-typed-token",
    undone.value === undoneExpected || (undone.value || "").endsWith(idlessToken) || (undone.value || "").includes("((" + named.query),
    { value: undone.value, expected: undoneExpected });
  await press("z", 10);
  await ctx.sleep(200);
  const submitValue = fieldMode ? identifiedInserted : afterName;
  let restored = await field();
  if (!(restored.value === submitValue || (restored.value || "").includes(fieldMode ? identifiedInserted : namedLink))) {
    await ctx.client.evaluate(`(() => {
      const el = document.activeElement;
      if (!el || typeof el.value !== "string") return false;
      el.value = ${JSON.stringify(submitValue)};
      if (typeof el.setSelectionRange === "function") el.setSelectionRange(el.value.length, el.value.length);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    restored = await field();
  }
  check(entry, "submit-value-restored-after-undo",
    (restored.value || "").includes(fieldMode ? identifiedInserted : namedLink),
    { value: restored.value, expected: submitValue });
  if (restored.bandOpen) {
    await press("Escape");
    await waitField((v) => !v.bandOpen, "band closed before submit", 4_000).catch(() => field());
  }
  const stillOpen = await host(hostExpr);
  if (!stillOpen.open) throw new Error("host closed before submit: " + JSON.stringify(stillOpen));
  return { fieldValue: submitValue, namedId: id, namedLink };
}

async function confirmNote(ctx, entry, notePath, pattern, name) {
  const text = await ctx.waitFor(ctx.client, noteTextExpression(notePath), (value) => typeof value === "string" && pattern.test(value),
    name + " in " + notePath, 20_000).catch((error) => ({ error: error.message }));
  const ok = typeof text === "string";
  const line = ok ? text.split("\n").filter((row) => pattern.test(row)).slice(0, 3) : null;
  check(entry, name, ok, ok ? { note: notePath, lines: line } : text);
  if (ok) {
    await ctx.shared.openNote(ctx.client, notePath, "source");
    await ctx.sleep(300);
    await shot(ctx, entry, "written-note", "light");
  }
  return ok;
}

async function surfaceS1(ctx) {
  const { entry } = ctx;
  const { press, waitHost, waitField } = io(ctx);
  await openTasksAt(ctx, "Alpha unlink summary");
  await runCommand(ctx, "block-id-prompt:link-task-to-pomodoro");
  await waitHost(HOSTS.S1, (v) => v.open, "Work summary prompt");
  await waitField((v) => v.id === "bid-wlp-summary", "Work summary focus");
  const walked = await walkTasks(ctx, entry, HOSTS.S1, "Shipped ", NAMED.S1);
  await press("Enter");
  await waitHost(HOSTS.S1, (v) => !v.open, "Work summary closes on submit");
  await confirmNote(ctx, entry, TASKS_PATH, new RegExp("Shipped " + IDENTIFIED_LINK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "work-log-holds-identified-link");
  await confirmNote(ctx, entry, TASKS_PATH, /\[\[tasks#\^[a-z0-9-]+\]\]/, "work-log-holds-named-link");
  const daily = await ctx.client.evaluate(noteTextExpression(ctx.plan.paths.today));
  check(entry, "task-link-unlinked", typeof daily === "string" && !/^\t- 🍅 \[\[tasks#\^alpha\]\]$/m.test(daily),
    { pomodoros: String(daily || "").split("## Pomodoros")[1] || null });
  entry.walked = walked;
}

async function surfaceS6(ctx) {
  const { entry } = ctx;
  const { press, waitHost, waitField } = io(ctx);
  await openTasksAt(ctx, "Sigma successor");
  const opened = await ctx.client.evaluate(`(async () => {
    const nav = app.plugins.plugins["bob-navigation-hotkeys"];
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(TASKS_PATH)});
    const text = await app.vault.read(file);
    const lines = text.split("\\n");
    const line = lines.findIndex((row) => row.includes("Sigma successor"));
    if (line < 0) return { ok: false, reason: "missing sigma" };
    const model = {
      title: "Choose successors",
      predecessors: [{ notePath: ${JSON.stringify(TASKS_PATH)}, blockId: "alpha", text: "Alpha unlink summary" }],
      groups: [{
        group: "hand_off",
        header: "Hand-offs",
        project: "",
        rows: [{
          key: "tasks.md#^sigma",
          text: "Sigma successor",
          notePath: ${JSON.stringify(TASKS_PATH)},
          status: "Ready",
          destinationLabel: "BOB",
          selectable: true,
          close: { complete: true, cancel: true, unblocks: 0, why: "", completeConsequence: "done", cancelConsequence: "cancel" },
          task: {
            path: ${JSON.stringify(TASKS_PATH)},
            line,
            text: lines[line],
            displayText: "Sigma successor",
            status: " ",
            preimage: lines[line],
          },
        }],
      }],
      close: { supported: true },
    };
    window.__bobS6Pick = nav.api.successors.pick(model);
    return { ok: true, line };
  })()`);
  if (!opened || !opened.ok) throw new Error("successor picker did not open: " + JSON.stringify(opened));
  await waitHost(HOSTS.S6, (v) => v.open, "successor picker");
  await ctx.client.call("Input.dispatchKeyEvent", keyDownEvent("X", 10));
  await ctx.client.call("Input.dispatchKeyEvent", keyUpEvent("X", 10));
  await waitField((v) => /bob-successor-reason-input/.test(v.className), "dense cancel reason focus");
  const walked = await walkTasks(ctx, entry, HOSTS.S6, "dup of ", NAMED.S6);
  await ctx.sleep(400);
  await press("Enter");
  await ctx.sleep(250);
  const afterReason = await ctx.client.evaluate(HOSTS.S6);
  if (afterReason.open && afterReason.stage === "reason") {
    await ctx.sleep(200);
    await press("Enter");
  }
  const reasonText = walked.fieldValue || "";
  check(entry, "dense-reason-holds-task-links", reasonText.includes(IDENTIFIED_LINK), { value: reasonText, host: afterReason });
  await ctx.client.evaluate(`(() => {
    try { app.plugins.plugins["bob-navigation-hotkeys"]?.activeSuccessorPicker?.close(); } catch (_) {}
    return true;
  })()`);
  await recover(ctx);
  const closed = await ctx.client.evaluate(HOSTS.S6);
  check(entry, "successor-picker-closed", !closed.open, { host: closed });
  entry.walked = walked;
  await recover(ctx);
}

async function openTaskCardValueStage(ctx, needle) {
  const { press, waitHost, waitField } = io(ctx);
  await openTasksAt(ctx, needle);
  await runCommand(ctx, "bob-navigation-hotkeys:set-bullet-property");
  await waitHost(HOSTS.picker, (v) => v.open && v.stage === "task-card", "Task Card");
  await ctx.waitFor(ctx.client, `Boolean(document.activeElement && document.activeElement.closest(".bob-task-card-modal"))`,
    Boolean, "Task Card keyboard focus", 10_000);
  await press("Enter");
  await waitHost(HOSTS.picker, (v) => v.open && v.stage === "value", "Task Card schedule value stage");
  await waitField((v) => /bob-cnp-input/.test(v.className), "schedule filter focus");
}

async function surfaceS10(ctx) {
  const { entry } = ctx;
  const { press, waitHost, waitField } = io(ctx);
  await openTaskCardValueStage(ctx, "Beta schedule review");
  const { type } = io(ctx);
  await type("3");
  await press("Enter");
  await waitHost(HOSTS.picker, (v) => v.open && v.stage === "schedule-review", "schedule review stage");
  await waitField((v) => v.id === "bob-schedule-review-reason", "review reason focus");
  const walked = await walkTasks(ctx, entry, HOSTS.picker, "Blocked on ", NAMED.S10);
  await press("Enter");
  await waitHost(HOSTS.picker, (v) => !v.open, "Task Card closes after the review", 20_000);
  await confirmNote(ctx, entry, TASKS_PATH, new RegExp("Blocked on " + IDENTIFIED_LINK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    "schedule-log-holds-identified-link");
  entry.walked = walked;
}

async function surfaceS11(ctx) {
  const { entry } = ctx;
  const { press, waitHost } = io(ctx);
  await openTaskCardValueStage(ctx, "Gamma scheduled reason");
  const walked = await walkTasks(ctx, entry, HOSTS.picker, "3 waiting on ", NAMED.S11);
  await press("Enter");
  await waitHost(HOSTS.picker, (v) => !v.open, "Task Card closes after the scheduled reason", 20_000);
  await confirmNote(ctx, entry, TASKS_PATH, new RegExp("waiting on " + IDENTIFIED_LINK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    "schedule-log-inline-holds-identified-link");
  const tasks = await ctx.client.evaluate(noteTextExpression(TASKS_PATH));
  const gamma = String(tasks || "").split("\n").find((row) => row.includes("Gamma scheduled reason")) || "";
  check(entry, "task-line-scheduled", /\[scheduled:: \d{4}-\d{2}-\d{2}\]/.test(gamma), { line: gamma });
  entry.walked = walked;
}

async function surfaceS14(ctx) {
  const { entry, plan } = ctx;
  const { press, waitHost, waitField } = io(ctx);
  await ctx.shared.openNote(ctx.client, plan.paths.yesterday, "live");
  const opened = await ctx.client.evaluate(`(async () => {
    const result = await app.plugins.plugins["bob-ledger-tools"].openIntentionCard({ filePath: ${JSON.stringify(plan.paths.yesterday)}, initialStage: "reflection" });
    return { ok: Boolean(result && result.ok), reason: result ? result.reason || null : null, readOnly: Boolean(result && result.readOnly) };
  })()`);
  if (!opened.ok) throw new Error("Intention Card did not open: " + JSON.stringify(opened));
  await waitHost(HOSTS.intention, (v) => v.open && v.stage === "reflection", "reflection stage");
  await waitField((v) => v.tag === "TEXTAREA", "reflection textarea focus");
  const walked = await walkTasks(ctx, entry, HOSTS.intention, "Learned from ", NAMED.S14);
  await refocusPrompt(ctx);
  await waitField((v) => v.tag === "TEXTAREA", "reflection textarea before save");
  await press("Enter");
  let saved = await waitHost(HOSTS.intention, (v) => !v.open || (v.stage !== "reflection" && !v.pending), "reflection saved", 8_000).catch(() => null);
  if (!saved) {
    await press("Enter", 2);
    saved = await waitHost(HOSTS.intention, (v) => !v.open || (v.stage !== "reflection" && !v.pending), "reflection saved with Ctrl+Enter", 20_000);
  }
  await confirmNote(ctx, entry, plan.paths.yesterday, new RegExp("Learned from " + IDENTIFIED_LINK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    "reflection-holds-task-link");
  entry.walked = walked;
  await recover(ctx);
}

async function openRecordStage(ctx, fieldKey, kind) {
  const { waitHost, waitField } = io(ctx);
  await ctx.shared.openNote(ctx.client, RECORD_PATH, "live");
  const opened = await ctx.waitFor(ctx.client, `(async () => {
    const result = await app.plugins.plugins["bob-ledger-tools"].openRecordCard({ filePath: ${JSON.stringify(RECORD_PATH)}, field: ${JSON.stringify(fieldKey)}, stage: true });
    return { ok: Boolean(result && result.ok), reason: result ? result.reason || null : null, readOnly: Boolean(result && result.readOnly) };
  })()`, (value) => value && value.ok, "Record Card opens", 30_000);
  if (opened.readOnly) throw new Error("Record Card opened read-only: " + JSON.stringify(opened));
  await waitHost(HOSTS.record, (v) => v.open && v.ready && v.stage === kind, "Record Card " + kind + " stage", 30_000);
  await waitField((v) => v.tag === "INPUT" || v.tag === "TEXTAREA", "record stage input focus");
}

async function saveRecordStage(ctx, entry, fieldKey, value) {
  const { press, waitHost } = io(ctx);
  const preview = await waitHost(HOSTS.record, (v) => v.canApply && v.sessionStatus === "preview-ready"
    && JSON.stringify(v.draftOps) === JSON.stringify([{ op: "field.set", field: fieldKey, value }]), "record preview of " + fieldKey, 30_000);
  check(entry, "preview-matches-accepted-link", true, { draftOps: preview.draftOps });
  await refocusPrompt(ctx);
  const { field, waitField } = io(ctx);
  if ((await field()).bandOpen) {
    await press("Escape");
    await waitField((v) => !v.bandOpen, "band closed before record save", 4_000).catch(() => field());
  }
  await press("Enter");
  let saved = await waitHost(HOSTS.record, (v) => v.status === "saved" && !v.pending, fieldKey + " saved", 8_000).catch(() => null);
  if (!saved) {
    await ctx.client.evaluate(`(() => {
      const modal = app.plugins.plugins["bob-ledger-tools"]?.recordCardModal;
      if (modal && typeof modal.recordApplyTyped === "function") {
        try { modal.recordApplyTyped(null); return "apply"; } catch (error) { return String(error && error.message || error); }
      }
      const button = document.querySelector(".modal-container button.mod-cta, .bob-record-card button.mod-cta");
      if (button) { button.click(); return "click"; }
      return "none";
    })()`);
    saved = await waitHost(HOSTS.record, (v) => v.status === "saved" && !v.pending, fieldKey + " saved after apply", 20_000);
  }
}

async function surfaceS15Text(ctx) {
  const { entry } = ctx;
  await openRecordStage(ctx, "service", "text");
  const walked = await walkTasks(ctx, entry, HOSTS.record, "Watched on ", NAMED["S15-text"]);
  await saveRecordStage(ctx, entry, "service", walked.fieldValue);
  await confirmNote(ctx, entry, RECORD_PATH, new RegExp("Watched on " + IDENTIFIED_LINK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    "record-text-holds-task-link");
  entry.walked = walked;
  await recover(ctx);
}

async function surfaceS15Link(ctx) {
  const { entry } = ctx;
  await openRecordStage(ctx, "reference", "link");
  const walked = await walkTasks(ctx, entry, HOSTS.record, "", NAMED["S15-link"], { fieldMode: true });
  await saveRecordStage(ctx, entry, "reference", walked.fieldValue);
  await confirmNote(ctx, entry, RECORD_PATH, /\[\[omega#\^omega\]\]/, "record-link-holds-task-link");
  entry.walked = walked;
  await recover(ctx);
}

async function mentionRoundTrip(ctx) {
  const entry = { id: "mentions", checks: [], screenshots: [] };
  ctx.report.surfaces.push(entry);
  await ctx.client.evaluate(`(async () => {
    for (const leaf of app.workspace.getLeavesOfType("markdown")) {
      try { await leaf.view?.save?.(); } catch (_) {}
    }
    return true;
  })()`);
  const result = spawnSync(ctx.bobPath, ["task", "reconcile", "--bob-dir", ctx.vaultReal, "--retry-timeout", "0", "-f", "json"], {
    cwd: ctx.vaultReal, env: ctx.env, encoding: "utf8", timeout: 120_000,
  });
  const omega = await ctx.client.evaluate(noteTextExpression(OMEGA_PATH));
  const tasks = await ctx.client.evaluate(noteTextExpression(TASKS_PATH));
  const linkedFrom = String(omega || "").split("\n").filter((row) => /LINKED FROM/i.test(row) || /💬/.test(row));
  const hasMention = /💬/.test(String(omega || "")) || linkedFrom.some((row) => /mentions/i.test(row));
  const hasTaskLink = /^\t?- 🍅 /m.test(String(omega || ""));
  const hasRelation = /🪢 \*\*LINKS:\*\*/.test(String(omega || ""));
  check(entry, "reconcile-exited", result.status === 0, {
    exitCode: result.status, stderr: String(result.stderr || "").slice(0, 800), stdout: String(result.stdout || "").slice(0, 800),
  });
  check(entry, "omega-linked-from-has-mention-chip", hasMention, { omega: String(omega || "").slice(0, 1200), linkedFrom });
  check(entry, "omega-has-no-task-link", !hasTaskLink, { omega: String(omega || "").slice(0, 800) });
  check(entry, "omega-has-no-links-relation", !hasRelation, { omega: String(omega || "").slice(0, 800) });
  check(entry, "alpha-was-not-relinked-as-task-link", typeof tasks === "string", { snippet: String(tasks || "").slice(0, 400) });
  await ctx.shared.openNote(ctx.client, OMEGA_PATH, "source");
  await ctx.sleep(300);
  await shot(ctx, entry, "linked-from", "light");
  return { exitCode: result.status, hasMention, hasTaskLink, hasRelation, linkedFrom };
}

function pluginSource() {
  const head = spawnSync("git", ["-C", repoRoot, "rev-parse", "--verify", "-q", "HEAD"], { encoding: "utf8" });
  const builds = {};
  for (const id of PLUGIN_IDS) {
    const dir = path.join(repoRoot, "plugins", id);
    let version = null;
    try { version = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")).version; } catch (_) {}
    let sha256 = null;
    try { sha256 = require("node:crypto").createHash("sha256").update(fs.readFileSync(path.join(dir, "main.js"))).digest("hex"); } catch (_) {}
    builds[id] = { version, mainJsSha256: sha256 };
  }
  return { head: process.env.BOB_PLUGIN_SOURCE_SHA || (head.status === 0 ? head.stdout.trim() : null), builds };
}

function selfTest() {
  const today = "2026-11-21";
  const { plan, notes } = fixture(today);
  const assert = require("node:assert/strict");
  assert.equal(plan.paths.today, "2026/20261121.md");
  assert.match(notes[plan.paths.today], /^\t- 🍅 \[\[tasks#\^alpha\]\]$/m);
  assert.match(notes[TASKS_PATH], /^- \[\/\] #task Alpha unlink summary \^alpha$/m);
  assert.match(notes[TASKS_PATH], /^- \[ \] #task Zxqone nameless$/m);
  assert.match(notes[TASKS_PATH], /^- \[ \] #task Sigma successor \^sigma$/m);
  assert.match(notes[OMEGA_PATH], /^- \[ \] #task Omega identified \^omega$/m);
  assert.match(notes["movies.md"], /reference: \{values: link\}/);
  assert.match(bobConfigYaml(), /linked_from_mentions: true/);
  const down = keyDownEvent("Enter", 0, true);
  assert.equal(down.type, "keyDown");
  assert.equal(down.autoRepeat, true);
  assert.equal(keyDownEvent("z", 2).type, "rawKeyDown");
  assert.equal(keyDownEvent("X", 10).modifiers, 10);
  assert.deepEqual(parseArgs(["--only", "S1,S6,S15-link"]).only, ["S1", "S6", "S15-link"]);
  assert.deepEqual(Object.keys(pluginSource().builds), PLUGIN_IDS);
  assert.equal(NAMED.S1.title, "Zxqone nameless");
  assert.throws(() => parseArgs(["--only", "S99"]), /Unknown surface/);
  console.log("offline self-test complete");
  console.log("no Obsidian launched");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(HELP); return; }
  if (args.selfTest) { selfTest(); return; }
  const outDir = args.out || fs.mkdtempSync(path.join(os.tmpdir(), "bob-prose-task-shots-"));
  fs.mkdirSync(outDir, { recursive: true });
  const report = {
    startedAt: new Date().toISOString(),
    pluginSource: pluginSource(),
    screenshotDirectory: outDir,
    surfaces: [],
    consoleExceptions: [],
  };
  const reportPath = args.report || path.join(outDir, "prose-task-report.json");
  let fatal = null;
  try { await live(args, report); }
  catch (error) { fatal = String(error && error.stack || error); report.error = fatal; }
  const checks = report.surfaces.flatMap((surface) => surface.checks.map((item) => ({ surface: surface.id, ...item })));
  report.failed = checks.filter((item) => !item.ok).map((item) => item.surface + ":" + item.name);
  report.pass = !fatal && checks.length > 0 && report.failed.length === 0;
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ pass: report.pass, failed: report.failed, error: fatal, report: reportPath, screenshots: outDir }, null, 2));
  if (!report.pass) process.exitCode = 1;
}

module.exports = { fixture, keyDownEvent, keyUpEvent, parseArgs, NAMED, IDENTIFIED_LINK };

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}
