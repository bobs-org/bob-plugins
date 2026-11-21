#!/usr/bin/env node
// Real-Obsidian prose-field walkthrough (plan prose_wikilink_completion, phase
// prose-lint). One owned Obsidian on a scratch profile and Git vault drives the
// real hosts over CDP with trusted key events:
//
//   S1   Unlink Work summary          (block-id-prompt Ctrl+Shift+Enter on an In Progress task)
//   S10  Task Card schedule review    (reason and summary fields)
//   S11  Task Card scheduled reason   (`3 waiting on [[...` in the value filter)
//   S14  Intention Card reflection    (saved by bob periods update)
//   S15  Record Card text and link    (saved by bob albums; the link stage runs in field mode)
//
// Each host is walked the same way: type `[[`, filter, drill `#`, accept with
// Enter, hold Enter, undo once with Ctrl+Z, re-accept, Escape with the band
// open, then submit with Enter and confirm the written note text. The live vault
// is never opened; bob runs from BOB_BIN against the scratch vault only.
//
//   BOB_BIN=<bob> xvfb-run -a node scripts/obsidian-prose-field-e2e.cjs \
//     -e /snap/obsidian/current/app/obsidian -r /tmp/prose-walk.json -o /tmp/prose-walk-shots
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
const RECORD_PATH = "movies/equilibrium.md";
const SURFACES = ["S1", "S10", "S11", "S14", "S15-text", "S15-link"];
const HELP = [
  "Usage: node scripts/obsidian-prose-field-e2e.cjs [options]",
  "",
  "Walk [[ completion through real Bob prose prompts in an isolated Obsidian.",
  "",
  "Options:",
  "  -e, --executable PATH  Obsidian Electron binary (default: $OBSIDIAN_BIN or " + ELECTRON_FALLBACK + ")",
  "  -o, --out DIR          Screenshot directory (default: a new temp directory)",
  "  -r, --report PATH      JSON report path (default: <out>/prose-field-report.json)",
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

// ---- Fixture ----

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
    "status: watched", "---", "", "## Notes", "", "- A record for the prose walkthrough.", "",
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
  notes["sase.md"] = "# Sase\n\n## Overview\n\nWhat sase is.\n\n## Restart readiness\n\nHow restarts stay safe.\n";
  notes["api.md"] = "# API\n\n## Endpoints\n\nThe public surface.\n";
  notes[TASKS_PATH] = [
    "# Tasks",
    "",
    "- [/] #task Alpha unlink summary ^alpha",
    "- [/] #task Beta schedule review ^beta",
    "- [ ] #task Gamma scheduled reason ^gamma",
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

// ---- Trusted keys ----

const KEY_CODES = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8, ArrowDown: 40, ArrowUp: 38 };

function keyPayload(key, modifiers) {
  const vk = KEY_CODES[key] || key.toUpperCase().charCodeAt(0);
  const code = /^[a-z]$/i.test(key) ? "Key" + key.toUpperCase() : key;
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

// ---- Probes (run inside Obsidian) ----

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
    bandOpen: Boolean(band), title: band ? (band.querySelector(".bob-link-band-title")?.textContent || "") : "",
    rows: rows.map((row) => (row.innerText || row.textContent || "").replace(/\\s+/g, " ").trim()),
    selected: rows.findIndex((row) => row.classList.contains("is-selected")),
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
  picker: `(() => { const p = app.plugins.plugins["bob-navigation-hotkeys"]?.activeBulletPropertyPicker; return { open: Boolean(p && p.pickerOpen !== false && p.modalEl?.isConnected), stage: p ? p.stage : null }; })()`,
  intention: `(() => { const m = app.plugins.plugins["bob-ledger-tools"]?.intentionCardEditorModal; return { open: Boolean(m && !m.closed), stage: m && m.stage ? m.stage.kind : null, pending: Boolean(m && m.pendingApply), status: m ? m.statusKind : null }; })()`,
  record: `(() => { const m = app.plugins.plugins["bob-ledger-tools"]?.recordCardModal; return { open: Boolean(m && !m.closed), stage: m && m.stage ? m.stage.kind : null, pending: Boolean(m && m.pendingApply), status: m ? m.statusKind : null, ready: Boolean(m && m.session), sessionStatus: m?.sessionState?.status || null, canApply: Boolean(m?.sessionState?.canApply), draftOps: m?.sessionState?.draftOps || null }; })()`,
};

// ---- Live run ----

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
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "bob-prose-field-e2e-"));
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
      const ok = ${JSON.stringify(PLUGIN_IDS)}.every((id) => Boolean(app.plugins.plugins[id]));
      const links = ["sase.md", "api.md"].every((p) => app.metadataCache.getCache(p)?.headings?.length);
      return ok && Number(nav?.api?.proseField?.version) >= 1 && links;
    })()`, Boolean, "plugins, proseField, and the link fixture index", 60_000);
    // The trust step opens Obsidian's separate Settings window, which becomes
    // the active window; without a window manager nothing refocuses the vault,
    // so modals would mount in the Settings document. Wait for it, close it,
    // and refocus the vault window, as a user would.
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

    const ctx = { client, report, outDir, plan, sleep, waitFor, shared };
    const only = args.only ? new Set(args.only) : null;
    const run = async (id, fn) => {
      if (only && !only.has(id)) return;
      const entry = { id, checks: [], screenshots: [] };
      report.surfaces.push(entry);
      await client.evaluate("window.__bobProseNotices.length = 0").catch(() => null);
      entry.window = await ensureMainWindow(client);
      try {
        await fn({ ...ctx, entry });
      } catch (error) {
        entry.error = String(error && error.stack || error);
        check(entry, "surface-completed", false, entry.error.slice(0, 600));
        try { entry.screenshots.push(await shot(ctx, entry, "failure")); } catch (_) {}
        await recover(ctx);
      }
      entry.notices = await client.evaluate("window.__bobProseNotices.slice()").catch(() => null);
    };
    await run("S1", surfaceS1);
    await run("S10", surfaceS10);
    await run("S11", surfaceS11);
    await run("S14", surfaceS14);
    await run("S15-text", surfaceS15Text);
    await run("S15-link", surfaceS15Link);
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
  entry.checks.push({ name, ok: Boolean(ok), detail: detail === undefined ? null : detail });
  return Boolean(ok);
}

async function shot(ctx, entry, label) {
  const name = entry.id + "-" + String(entry.screenshots.length + 1).padStart(2, "0") + "-" + label;
  const result = await ctx.shared.capture(ctx.client, ctx.outDir, name, 1280, "moonstone", label);
  entry.screenshots.push(result);
  return result;
}

async function recover(ctx) {
  await ctx.client.evaluate(`(() => {
    try { app.plugins.plugins["bob-ledger-tools"]?.intentionCardEditorModal?.close(); } catch (_) {}
    try { app.plugins.plugins["bob-ledger-tools"]?.recordCardModal?.close(); } catch (_) {}
    try { app.plugins.plugins["bob-navigation-hotkeys"]?.activeBulletPropertyPicker?.close(); } catch (_) {}
    for (const button of Array.from(document.querySelectorAll(".modal-container .modal-close-button"))) { try { button.click(); } catch (_) {} }
    return true;
  })()`).catch(() => null);
  await ctx.sleep(400);
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
  const waitField = (predicate, label, timeoutMs = 8000) => waitFor(client, FIELD_PROBE, predicate, label, timeoutMs);
  const host = (expr) => client.evaluate(expr);
  const waitHost = (expr, predicate, label, timeoutMs = 15_000) => waitFor(client, expr, predicate, label, timeoutMs);
  return { press, type, field, waitField, host, waitHost };
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

// The shared inline walk: `[[` → filter → `#` drill → Enter accept (+ held
// Enter) → Ctrl+Z undo → re-accept → Escape with the band open. Leaves the
// field holding `prefix + [[sase#Overview]]` with the band closed.
async function walkInline(ctx, entry, hostExpr, prefix) {
  const { press, type, field, waitField, host } = io(ctx);
  const target = prefix + "[[sase#Overview]]";
  const drilled = prefix + "[[sase#ov";
  await type(prefix);
  await type("[[sa");
  const filtered = await waitField((v) => v.bandOpen && v.rows.some((row) => /\bsase\b/.test(row)), "LINK band lists sase");
  check(entry, "bracket-opens-band-and-filters", filtered.value === prefix + "[[sa", { value: filtered.value, title: filtered.title, rows: filtered.rows });
  await shot(ctx, entry, "filter");
  await type("se#ov");
  const drill = await waitField((v) => v.bandOpen && v.rows.some((row) => /Overview/.test(row)), "LINK band drills to the Overview heading");
  check(entry, "hash-drills-headings", drill.value === drilled, { value: drill.value, title: drill.title, rows: drill.rows });
  await shot(ctx, entry, "drill");

  await ctx.client.call("Input.dispatchKeyEvent", keyDownEvent("Enter"));
  await ctx.sleep(150);
  const accepted = await field();
  await ctx.client.call("Input.dispatchKeyEvent", keyDownEvent("Enter", 0, true));
  await ctx.client.call("Input.dispatchKeyEvent", keyDownEvent("Enter", 0, true));
  await ctx.sleep(250);
  const held = await field();
  const heldHost = await host(hostExpr);
  await ctx.client.call("Input.dispatchKeyEvent", keyUpEvent("Enter"));
  await ctx.sleep(100);
  check(entry, "enter-accepts-without-submitting", accepted.value === target && !accepted.bandOpen && accepted.start === target.length,
    { value: accepted.value, caret: accepted.start, bandOpen: accepted.bandOpen });
  check(entry, "held-enter-never-submits", heldHost.open && held.value === target, { host: heldHost, value: held.value });
  await shot(ctx, entry, "accepted");

  await press("z", 2);
  await ctx.sleep(200);
  const undone = await field();
  check(entry, "one-ctrl-z-restores-typed-link", undone.value === drilled, { value: undone.value, expected: drilled });
  if (undone.value !== drilled) {
    // Put the field back in a known state so the remaining checks still run.
    await press("a", 2);
    await type(drilled);
  }
  await press("Backspace");
  await type("v");
  await waitField((v) => v.bandOpen && v.rows.some((row) => /Overview/.test(row)), "LINK band reopens after undo");
  await press("Enter");
  const reaccepted = await waitField((v) => v.value === target && !v.bandOpen, "re-accepted link");
  check(entry, "re-accept-after-undo", reaccepted.value === target, { value: reaccepted.value });

  await type(" [[ap");
  await waitField((v) => v.bandOpen && v.rows.some((row) => /\bapi\b/i.test(row)), "LINK band lists api");
  await press("Escape");
  await ctx.sleep(200);
  const escaped = await field();
  const escapedHost = await host(hostExpr);
  check(entry, "escape-closes-band-only", !escaped.bandOpen && escapedHost.open && escaped.value === target + " [[ap",
    { bandOpen: escaped.bandOpen, host: escapedHost, value: escaped.value });
  await shot(ctx, entry, "escape-band-closed");
  for (let i = 0; i < 5; i += 1) await press("Backspace");
  const cleaned = await waitField((v) => v.value === target, "trailing [[ap removed");
  if (cleaned.bandOpen) {
    await press("Escape");
    await waitField((v) => !v.bandOpen, "band closed before submit");
  }
  const stillOpen = await host(hostExpr);
  if (!stillOpen.open) throw new Error("host closed before submit: " + JSON.stringify(stillOpen));
  return target;
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
    await shot(ctx, entry, "written-note");
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
  await walkInline(ctx, entry, HOSTS.S1, "Shipped ");
  await press("Enter");
  await waitHost(HOSTS.S1, (v) => !v.open, "Work summary closes on submit");
  await confirmNote(ctx, entry, TASKS_PATH, /— Shipped \[\[sase#Overview\]\]$/m, "work-log-entry-written");
  const daily = await ctx.client.evaluate(noteTextExpression(ctx.plan.paths.today));
  check(entry, "task-link-unlinked", typeof daily === "string" && !/^\t- 🍅 \[\[tasks#\^alpha\]\]$/m.test(daily), { pomodoros: String(daily || "").split("## Pomodoros")[1] || null });
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
  const { press, type, waitHost, waitField } = io(ctx);
  await openTaskCardValueStage(ctx, "Beta schedule review");
  await type("3");
  await press("Enter");
  await waitHost(HOSTS.picker, (v) => v.open && v.stage === "schedule-review", "schedule review stage");
  await waitField((v) => v.id === "bob-schedule-review-reason", "review reason focus");
  await walkInline(ctx, entry, HOSTS.picker, "Blocked on ");
  await press("Tab");
  await waitField((v) => v.id === "bob-schedule-review-summary", "review summary focus");
  await type("Drafted [[ap");
  await waitField((v) => v.bandOpen && v.rows.some((row) => /\bapi\b/i.test(row)), "summary LINK band lists api");
  await shot(ctx, entry, "summary-band");
  await press("Enter");
  const summary = await waitField((v) => v.value === "Drafted [[api]]" && !v.bandOpen, "summary link accepted");
  const stage = await ctx.client.evaluate(HOSTS.picker);
  check(entry, "summary-enter-accepts-without-submitting", stage.open && stage.stage === "schedule-review", { value: summary.value, host: stage });
  await press("Enter");
  await waitHost(HOSTS.picker, (v) => !v.open, "Task Card closes after the review");
  await confirmNote(ctx, entry, TASKS_PATH, /— Blocked on \[\[sase#Overview\]\]$/m, "schedule-log-reason-written");
  await confirmNote(ctx, entry, TASKS_PATH, /— Drafted \[\[api\]\]$/m, "work-log-summary-written");
}

async function surfaceS11(ctx) {
  const { entry } = ctx;
  const { press, waitHost } = io(ctx);
  await openTaskCardValueStage(ctx, "Gamma scheduled reason");
  await walkInline(ctx, entry, HOSTS.picker, "3 waiting on ");
  await press("Enter");
  await waitHost(HOSTS.picker, (v) => !v.open, "Task Card closes after the scheduled reason");
  await confirmNote(ctx, entry, TASKS_PATH, /— waiting on \[\[sase#Overview\]\]$/m, "schedule-log-inline-reason-written");
  const tasks = await ctx.client.evaluate(noteTextExpression(TASKS_PATH));
  const gamma = String(tasks || "").split("\n").find((row) => row.includes("Gamma scheduled reason")) || "";
  check(entry, "task-line-scheduled", /\[scheduled:: \d{4}-\d{2}-\d{2}\]/.test(gamma), { line: gamma });
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
  await walkInline(ctx, entry, HOSTS.intention, "Learned from ");
  await press("Enter");
  await waitHost(HOSTS.intention, (v) => !v.open || (v.stage !== "reflection" && !v.pending), "reflection saved", 30_000);
  await confirmNote(ctx, entry, plan.paths.yesterday, /Learned from \[\[sase#Overview\]\]/, "reflection-written");
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

// The Record Card applies only a settled bob preview: wait for it, press
// Enter, then wait for the card to report the save.
async function saveRecordStage(ctx, entry, fieldKey, value) {
  const { press, waitHost } = io(ctx);
  const preview = await waitHost(HOSTS.record, (v) => v.canApply && v.sessionStatus === "preview-ready"
    && JSON.stringify(v.draftOps) === JSON.stringify([{ op: "field.set", field: fieldKey, value }]), "record preview of " + fieldKey, 30_000);
  check(entry, "preview-matches-accepted-link", true, { draftOps: preview.draftOps });
  await press("Enter");
  await waitHost(HOSTS.record, (v) => v.status === "saved" && !v.pending, fieldKey + " saved", 30_000);
}

async function surfaceS15Text(ctx) {
  const { entry } = ctx;
  await openRecordStage(ctx, "service", "text");
  const value = await walkInline(ctx, entry, HOSTS.record, "Watched on ");
  await saveRecordStage(ctx, entry, "service", value);
  await confirmNote(ctx, entry, RECORD_PATH, /^service: .*Watched on \[\[sase#Overview\]\]/m, "record-text-written");
  await recover(ctx);
}

async function surfaceS15Link(ctx) {
  const { entry } = ctx;
  const { press, type, field, waitField, waitHost, host } = io(ctx);
  await openRecordStage(ctx, "reference", "link");
  await type("sa");
  const filtered = await waitField((v) => v.bandOpen && v.rows.some((row) => /\bsase\b/.test(row)), "field-mode band lists sase");
  check(entry, "field-mode-filters-without-brackets", filtered.value === "sa", { value: filtered.value, rows: filtered.rows });
  await shot(ctx, entry, "filter");
  await press("Escape");
  await ctx.sleep(200);
  const escaped = await field();
  const escapedHost = await host(HOSTS.record);
  check(entry, "escape-closes-band-only", !escaped.bandOpen && escapedHost.open && escapedHost.stage === "link" && escaped.value === "sa",
    { value: escaped.value, host: escapedHost });
  await press("Backspace");
  await type("a");
  await waitField((v) => v.bandOpen && v.rows.some((row) => /\bsase\b/.test(row)), "field-mode band reopens");
  await ctx.client.call("Input.dispatchKeyEvent", keyDownEvent("Enter"));
  await ctx.sleep(150);
  const accepted = await field();
  await ctx.client.call("Input.dispatchKeyEvent", keyDownEvent("Enter", 0, true));
  await ctx.sleep(250);
  const heldHost = await host(HOSTS.record);
  await ctx.client.call("Input.dispatchKeyEvent", keyUpEvent("Enter"));
  check(entry, "field-mode-accept-replaces-value", accepted.value === "[[sase]]" && !accepted.bandOpen, { value: accepted.value });
  check(entry, "held-enter-never-submits", heldHost.open && heldHost.stage === "link" && (await field()).value === "[[sase]]", { host: heldHost });
  await shot(ctx, entry, "accepted");
  await press("z", 2);
  await ctx.sleep(200);
  const undone = await field();
  check(entry, "one-ctrl-z-restores-typed-query", undone.value === "sa", { value: undone.value });
  await press("a", 2);
  await type("[[sase#ov");
  const drill = await waitField((v) => v.bandOpen && v.rows.some((row) => /Overview/.test(row)), "field-mode drill lists Overview");
  check(entry, "hash-drills-headings", drill.value === "[[sase#ov", { value: drill.value, rows: drill.rows });
  await shot(ctx, entry, "drill");
  await press("Enter");
  await waitField((v) => v.value === "[[sase#Overview]]" && !v.bandOpen, "drilled link accepted");
  await saveRecordStage(ctx, entry, "reference", "[[sase#Overview]]");
  await confirmNote(ctx, entry, RECORD_PATH, /^reference: .*\[\[sase#Overview\]\]/m, "record-link-written");
  await recover(ctx);
}

// ---- Entry ----

// Ties the run to the exact plugin bytes; BOB_PLUGIN_SOURCE_SHA names the
// commit when the tree was copied out of a checkout.
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
  assert.match(notes[plan.paths.today], /^## Pomodoros$/m);
  assert.match(notes[plan.paths.today], /^\t- 🍅 \[\[tasks#\^alpha\]\]$/m);
  assert.match(notes[TASKS_PATH], /^- \[\/\] #task Alpha unlink summary \^alpha$/m);
  assert.match(notes["sase.md"], /^## Overview$/m);
  assert.match(notes["movies.md"], /reference: \{values: link\}/);
  const down = keyDownEvent("Enter", 0, true);
  assert.equal(down.type, "keyDown");
  assert.equal(down.autoRepeat, true);
  assert.equal(keyDownEvent("z", 2).type, "rawKeyDown");
  assert.deepEqual(parseArgs(["--only", "S1,S15-link"]).only, ["S1", "S15-link"]);
  assert.deepEqual(Object.keys(pluginSource().builds), PLUGIN_IDS);
  assert.throws(() => parseArgs(["--only", "S99"]), /Unknown surface/);
  console.log("offline self-test complete");
  console.log("no Obsidian launched");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(HELP); return; }
  if (args.selfTest) { selfTest(); return; }
  const outDir = args.out || fs.mkdtempSync(path.join(os.tmpdir(), "bob-prose-field-shots-"));
  fs.mkdirSync(outDir, { recursive: true });
  const report = {
    startedAt: new Date().toISOString(),
    pluginSource: pluginSource(),
    screenshotDirectory: outDir,
    surfaces: [],
    consoleExceptions: [],
  };
  const reportPath = args.report || path.join(outDir, "prose-field-report.json");
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

module.exports = { fixture, keyDownEvent, keyUpEvent, parseArgs };

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}
