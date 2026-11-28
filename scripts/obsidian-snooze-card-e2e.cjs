#!/usr/bin/env node
// Real Obsidian acceptance for the Snooze Card. All edits happen in a fresh
// scratch vault and an owned Obsidian process; the live vault is never opened.
// Run under Xvfb on Linux:
//   xvfb-run -a node scripts/obsidian-snooze-card-e2e.cjs [--out DIR]
"use strict";

const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const shared = require("./obsidian-record-card-e2e.cjs");
const scratchLifecycle = require("./e2e-scratch.cjs");
const sleep = shared.sleep;

const repoRoot = path.resolve(__dirname, "..");
const pluginIds = ["block-id-prompt", "bob-ledger-tools", "bob-navigation-hotkeys", "bob-command-mode"];
const electronFallback = "/snap/obsidian/current/app/obsidian";
// Chromium's process-singleton socket lives under TMPDIR and is capped at
// ~107 bytes. Keep the scratch root on /tmp so SASE workspace clones can
// still launch Obsidian.
const ownedRoot = "/tmp/bob-sn-e2e";
const required = [
  "plugins-loaded", "snooze-runtime-api-installed", "alt-z-opens-and-preselects-event", "keyboard-navigation-and-invalid-input",
  "same-note-transaction-undo", "task-card-z-opens-same-card", "task-card-z-from-live-link-moves-subtree", "task-card-z-from-live-link-undo", "blocked-event-done-refusals",
  "footer-counts-use-fixture-postimage", "ready-footer-counts-use-fixture-postimage", "ready-promotes-and-stamps", "next-and-inprogress-stay-byte-identical",
  "snoozed-header-state-renders",
  "unnamed-task-naming-cancel-is-no-write", "retime-and-unsnooze", "wake-now-runs-current-bob",
  "resnooze-replaces-struck-history-and-closed-ledger-history-stays", "closed-daily-note-uses-vault-process",
  "ordinary-and-snoozed-screenshots", "over-cap-and-forced-colors-screenshots", "hotkey-conflict-preserves-config",
];

function parseArgs(argv) {
  const args = { executable: null, out: null, report: null, selfTest: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--self-test" || token === "-s") args.selfTest = true;
    else if (token === "--help" || token === "-h") args.help = true;
    else if (["--executable", "-e"].includes(token)) args.executable = argv[++i];
    else if (["--out", "-o"].includes(token)) args.out = argv[++i];
    else if (["--report", "-r"].includes(token)) args.report = argv[++i];
    else throw new Error("Unknown argument: " + token);
  }
  if (args.executable && args.executable.startsWith("-")) throw new Error("--executable needs a path");
  if (args.out && args.out.startsWith("-")) throw new Error("--out needs a directory");
  if (args.report && args.report.startsWith("-")) throw new Error("--report needs a path");
  return args;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function partsForDate(date, zone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    year: parts.year,
    stamp: `${parts.year}${parts.month}${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function hhmm(minutes) {
  const value = Math.max(0, Math.min(1439, minutes));
  return String(Math.floor(value / 60)).padStart(2, "0") + String(value % 60).padStart(2, "0");
}

function colon(minutes) {
  const value = hhmm(minutes);
  return value.slice(0, 2) + ":" + value.slice(2);
}

function fixture(now = new Date()) {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  const clock = partsForDate(now, zone);
  if (clock.minutes > 1410) throw new Error("Snooze Card acceptance needs at least 30 minutes before midnight");
  const eventEnd = Math.min(1435, clock.minutes + 20);
  const eventStart = Math.max(0, eventEnd - 10);
  const wakeAt = Math.min(1430, clock.minutes + 5);
  const retimeAt = Math.min(1435, clock.minutes + 90);
  const blockedAt = Math.min(1435, clock.minutes + 60);
  const daily = `${clock.year}/${clock.stamp}.md`;
  const tasks = [
    "# Scratch tasks", "",
    "- [*] #task Wake now task [type:: WRITE] ^wake-now",
    "- [*] #task Retime task [type:: WRITE] ^retime",
    "- [?] #task Blocked task [type:: WRITE] ^blocked",
    "- [ ] #task Ready task [type:: WRITE] ^ready",
    "- [*] #task Next stable task [type:: WRITE] ^next-stable",
    "- [/] #task In progress stable task [type:: WRITE] ^progress-stable",
    "- [*] #task Task Card live-link task [type:: WRITE] ^task-card-link",
    "- [ ] #task Unnamed eligible task [type:: WRITE]",
    "- [*] #task History task [type:: WRITE] ^history",
    "- [*] #task Closed daily task [type:: WRITE] ^closed-daily",
    "- [x] #task Done task [type:: WRITE] ^done",
    "- [-] #task Cancelled task [type:: WRITE] ^cancelled",
    "- [/] #task **" + hhmm(eventStart) + "-" + hhmm(eventEnd) + "** Event task [root:: bob] [type:: MEET] ^event-task",
    "",
  ].join("\n");
  const dailyText = [
    `# ${clock.date}`, "",
    "## Events", "",
    `- [/] #task **${hhmm(eventStart)}-${hhmm(eventEnd)}** Yogi interview [root:: bob] [type:: MEET] ^event-suggestion`, "",
    "## Pomodoros", "",
    "- [ ] () — WRITE",
    "  - [[#^same-note]]",
    "    - preserve this authored note",
    "  - [[jobs#^task-card-link]]",
    "    - preserve Task Card link note",
    "- [/] (**" + hhmm(Math.max(0, clock.minutes - 10)) + "-" + hhmm(eventEnd) + "** [t:: 25m]) — MEET",
    "  - [[#^event-suggestion]]",
    "- [x] () — WRITE",
    "  - [[jobs#^history]]", "",
    "## Snoozed", "",
    `- **${hhmm(wakeAt)}** [[jobs#^wake-now]]`,
    `- **${hhmm(retimeAt)}** [[jobs#^retime]]`,
    `- **${hhmm(blockedAt)}** [[jobs#^blocked]]`, "",
    "## Tasks", "",
    "- [*] #task Same-note task [type:: WRITE] ^same-note", "",
  ].join("\n");
  return {
    zone, date: clock.date, year: clock.year, stamp: clock.stamp, daily,
    nowMinutes: clock.minutes, eventStart, eventEnd, wakeAt, retimeAt, blockedAt, planCap: 1, initialOnClockLinks: 3,
    tasks, dailyText,
  };
}

function writeNote(root, relative, text) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function taskPluginSource() {
  const candidate = path.join(os.homedir(), "bob", ".obsidian", "plugins", "obsidian-tasks-plugin");
  return fs.existsSync(path.join(candidate, "main.js")) ? candidate : null;
}

function installPlugins(vault, conflict, bobPath, configPath) {
  const enabled = pluginIds.slice();
  for (const id of pluginIds) {
    const source = path.join(repoRoot, "plugins", id);
    const target = path.join(vault, ".obsidian", "plugins", id);
    fs.mkdirSync(target, { recursive: true });
    for (const file of ["manifest.json", "main.js", "styles.css"]) {
      const from = path.join(source, file);
      if (fs.existsSync(from)) fs.copyFileSync(from, path.join(target, file));
    }
  }
  const tasks = taskPluginSource();
  if (tasks) {
    const target = path.join(vault, ".obsidian", "plugins", "obsidian-tasks-plugin");
    fs.mkdirSync(target, { recursive: true });
    for (const file of ["manifest.json", "main.js", "styles.css"]) {
      if (fs.existsSync(path.join(tasks, file))) fs.copyFileSync(path.join(tasks, file), path.join(target, file));
    }
    fs.writeFileSync(path.join(target, "data.json"), JSON.stringify({
      globalFilter: "#task", taskFormat: "dataview",
      statusSettings: { coreStatuses: [{ symbol: " ", name: "Ready", type: "TODO" }, { symbol: "x", name: "Done", type: "DONE" }],
        customStatuses: [{ symbol: "*", name: "Next", type: "ON_HOLD" }, { symbol: "?", name: "Blocked", type: "TODO" }, { symbol: "/", name: "In Progress", type: "IN_PROGRESS" }, { symbol: "-", name: "Canceled", type: "CANCELLED" }] },
    }, null, 2));
    enabled.push("obsidian-tasks-plugin");
  }
  const obsidian = path.join(vault, ".obsidian");
  fs.mkdirSync(obsidian, { recursive: true });
  fs.writeFileSync(path.join(obsidian, "community-plugins.json"), JSON.stringify(enabled, null, 2));
  fs.writeFileSync(path.join(obsidian, "core-plugins.json"), JSON.stringify(["file-explorer", "command-palette", "daily-notes", "editor-status"], null, 2));
  fs.writeFileSync(path.join(obsidian, "app.json"), JSON.stringify({ livePreview: true, showLineNumber: false, showInlineTitle: false }, null, 2));
  fs.writeFileSync(path.join(obsidian, "appearance.json"), JSON.stringify({ cssTheme: "", theme: "moonstone" }, null, 2));
  const hotkeys = {
    "bob-navigation-hotkeys:set-bullet-property": [{ modifiers: ["Ctrl", "Shift"], key: "P" }],
    ...(conflict ? { "command-palette:open": [{ modifiers: ["Alt"], key: "Z" }] } : {}),
  };
  const hotkeysPath = path.join(obsidian, "hotkeys.json");
  fs.writeFileSync(hotkeysPath, JSON.stringify(hotkeys, null, 2) + "\n");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `timezone: ${JSON.stringify(Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York")}\nproperties:\n  - name: scheduled\n    values: date\nsnooze:\n  notify: off\nplan:\n  max_links: 1\nstats:\n  bob_path: ${JSON.stringify(bobPath)}\n`);
  return { enabled, hotkeysPath, hotkeysBytes: fs.readFileSync(hotkeysPath) };
}

function keyCode(key) {
  const known = {
    "[": ["BracketLeft", 219], "]": ["BracketRight", 221], " ": ["Space", 32],
    Enter: ["Enter", 13], Escape: ["Escape", 27], Tab: ["Tab", 9], ArrowDown: ["ArrowDown", 40], ArrowUp: ["ArrowUp", 38],
    Backspace: ["Backspace", 8], Delete: ["Delete", 46],
  };
  if (known[key]) return { code: known[key][0], windowsVirtualKeyCode: known[key][1] };
  if (/^[a-z]$/i.test(key)) return { code: "Key" + key.toUpperCase(), windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) };
  if (/^[0-9]$/.test(key)) return { code: "Digit" + key, windowsVirtualKeyCode: key.charCodeAt(0) };
  return { code: key, windowsVirtualKeyCode: 0 };
}

async function press(client, key, modifiers = 0) {
  const target = await modalInputClient(client);
  const code = keyCode(key);
  const common = { key, code: code.code, modifiers, windowsVirtualKeyCode: code.windowsVirtualKeyCode, nativeVirtualKeyCode: code.windowsVirtualKeyCode };
  const text = modifiers & 7 ? "" : key === "Enter" ? "\r" : key.length === 1 ? key : "";
  try { await target.call("Page.bringToFront", {}); } catch (_) {}
  await target.call("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...common, ...(text ? { text, unmodifiedText: text } : {}) });
  await target.call("Input.dispatchKeyEvent", { type: "keyUp", ...common });
}

async function click(client, selector, text) {
  const target = await modalInputClient(client);
  const point = await target.evaluate(`(() => {
    const nodes = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
    const node = nodes.find((item) => (!${JSON.stringify(text)} || (item.textContent || "").includes(${JSON.stringify(text)})) && item.getClientRects().length);
    if (!node) return null;
    node.scrollIntoView({ block: "center" });
    const rect = node.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2), text: (node.textContent || "").trim() };
  })()`);
  if (!point) throw new Error("Could not find clickable " + selector + (text ? " containing " + text : ""));
  await target.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await target.call("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await target.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  return point;
}

async function insertText(client, text) {
  const target = await modalInputClient(client);
  await target.call("Input.insertText", { text });
}

async function modalInputClient(client) {
  if (!client?.cardClient) return client;
  try {
    const open = await client.cardClient.evaluate(`(() => {
      const card = document.querySelector(".bob-snooze-card-modal, .bob-task-card-modal");
      return Boolean(card && card.getClientRects().length && getComputedStyle(card).visibility !== "hidden");
    })()`);
    if (open) return client.cardClient;
  } catch (_) {}
  return client;
}

async function attachModalTarget(ctx, selector = null) {
  let targets = [];
  try { targets = await (await fetch("http://127.0.0.1:" + ctx.cdpPort + "/json/list")).json(); } catch (_) {}
  const candidates = targets.filter((item) => item.type === "page" && item.url === "about:blank" && /^Settings - /.test(item.title || ""));
  for (const target of candidates) {
    if (!target.webSocketDebuggerUrl) continue;
    let candidate;
    try {
      candidate = await shared.CdpClient.connect(target.webSocketDebuggerUrl);
      await candidate.call("Runtime.enable");
      await candidate.call("Log.enable");
      const found = selector ? await candidate.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`) : true;
      if (!found) { candidate.close(); continue; }
      if (ctx.modalClient) { try { ctx.modalClient.close(); } catch (_) {} }
      ctx.modalClient = candidate;
      await shared.setViewport(ctx.modalClient, 1440, 1000);
      await ctx.modalClient.evaluate(`(() => {
        if (window.__snoozeCardKeyListener) return;
        window.__snoozeCardKeyListener = true;
        window.__snoozeCardKeys = [];
        document.addEventListener("keydown", (event) => window.__snoozeCardKeys.push({ key: event.key, code: event.code, ctrl: event.ctrlKey, alt: event.altKey, target: event.target?.tagName, repeat: event.repeat }), true);
      })()`);
      ctx.client.cardClient = ctx.modalClient;
      return ctx.modalClient;
    } catch (_) {
      try { candidate?.close(); } catch (_) {}
    }
  }
  return null;
}

async function cardProbe(client) {
  let target = client;
  if (client?.cardClient) {
    try {
      const exists = await client.cardClient.evaluate(`Boolean(document.querySelector(".bob-snooze-card-modal"))`);
      if (exists) target = client.cardClient;
    } catch (_) {}
  }
  return target.evaluate(`(() => {
    const card = document.querySelector(".bob-snooze-card-modal");
    if (!card) return { open: false, notices: Array.from(document.querySelectorAll(".notice"), (n) => (n.textContent || "").trim()) };
    const one = (selector) => card.querySelector(selector);
    const rows = Array.from(card.querySelectorAll(".bob-snooze-card-list > *")).map((node) => ({
      text: (node.textContent || "").replace(/\\s+/g, " ").trim(),
      selected: node.getAttribute("aria-selected") === "true" || node.classList.contains("is-selected"),
      disabled: node.getAttribute("aria-disabled") === "true",
    }));
    return {
      open: true,
      title: (one(".bob-decay-card-title")?.textContent || "").trim(),
      subtitle: (one(".bob-decay-card-subtitle")?.textContent || "").trim(),
      input: one(".bob-snooze-card-input")?.value || "",
      focused: document.activeElement === one(".bob-snooze-card-input"),
      footer: (one(".bob-snooze-card-footer")?.textContent || "").trim(),
      hint: (one(".bob-snooze-card-hint")?.textContent || "").trim(),
      notices: Array.from(document.querySelectorAll(".notice"), (n) => (n.textContent || "").trim()),
      rows,
      actions: Array.from(card.querySelectorAll(".bob-snooze-card-actions > *")).map((node) => ({ text: (node.textContent || "").replace(/\\s+/g, " ").trim(), disabled: node.getAttribute("aria-disabled") === "true" })),
    };
  })()`);
}

async function setCursor(client, notePath, needle) {
  const result = await client.evaluate(`(() => {
    const leaf = app.workspace.activeLeaf;
    const view = leaf?.view;
    const editor = view?.editor;
    if (view?.file?.path !== ${JSON.stringify(notePath)} || !editor) return { ok: false, error: "active editor path mismatch" };
    const lines = editor.getValue().split("\\n");
    const line = lines.findIndex((text) => text.includes(${JSON.stringify(needle)}));
    if (line < 0) return { ok: false, error: "line not found", needle: ${JSON.stringify(needle)} };
    editor.setCursor({ line, ch: Math.max(0, lines[line].indexOf(${JSON.stringify(needle)})) });
    editor.focus();
    return { ok: true, line, text: lines[line] };
  })()`);
  if (!result?.ok) throw new Error("Could not position cursor: " + JSON.stringify(result));
  return result;
}

async function editorText(client, notePath) {
  return client.evaluate(`(() => {
    const leaf = app.workspace.getLeavesOfType("markdown").find((item) => item.view?.file?.path === ${JSON.stringify(notePath)});
    return leaf?.view?.editor?.getValue?.() ?? null;
  })()`);
}

async function fileText(client, notePath) {
  return client.evaluate(`(async () => {
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(notePath)});
    return file ? await app.vault.read(file) : null;
  })()`);
}

async function openCardFromLink(ctx, needle, notePath = ctx.fixture.daily) {
  if (ctx.client.cardClient) ctx.client.cardClient = null;
  await ctx.client.evaluate(`document.querySelectorAll(".notice").forEach((node) => node.remove())`);
  if (ctx.modalClient) await ctx.modalClient.evaluate(`document.querySelectorAll(".notice").forEach((node) => node.remove())`);
  await shared.openNote(ctx.client, notePath, "live");
  const cursor = await setCursor(ctx.client, notePath, needle);
  await ctx.client.evaluate(`(() => {
    window.__snoozeE2EKeys = [];
    const plugin = app.plugins.plugins["bob-navigation-hotkeys"];
    if (plugin && !plugin.__snoozeE2ECommitWrapped && typeof plugin.runSnoozeCommit === "function") {
      const run = plugin.runSnoozeCommit;
      plugin.runSnoozeCommit = async function (...args) {
        try { const result = await run.apply(this, args); window.__snoozeE2ECommit = { result }; return result; }
        catch (error) { window.__snoozeE2ECommit = { error: String(error?.stack || error) }; throw error; }
      };
      if (typeof plugin.writeLinkPickerNoteChange === "function") {
        const write = plugin.writeLinkPickerNoteChange;
        plugin.writeLinkPickerNoteChange = async function (...args) {
          try {
            const result = await write.apply(this, args);
            (window.__snoozeWriteTrace ||= []).push({ path: args[0], ok: true });
            return result;
          } catch (error) {
            (window.__snoozeWriteTrace ||= []).push({ path: args[0], error: String(error?.stack || error) });
            throw error;
          }
        };
      }
      plugin.__snoozeE2ECommitWrapped = true;
    }
    document.addEventListener("keydown", (event) => window.__snoozeE2EKeys.push({ key: event.key, code: event.code, alt: event.altKey, ctrl: event.ctrlKey, target: event.target?.tagName }), true);
  })()`);
  await press(ctx.client, "Z", 1); // CDP Alt modifier; Obsidian stores the default key as uppercase Z.
  await sleep(600);
  let state = await cardProbe(ctx.client);
  if (!state.open) {
    try {
      await attachModalTarget(ctx, ".bob-snooze-card-modal");
      await shared.waitFor(ctx.modalClient, `document.querySelector(".bob-snooze-card-modal") ? "open" : ""`, Boolean, "Snooze Card in Obsidian modal window", 5_000);
    } catch (_) {}
    state = await cardProbe(ctx.client);
  }
  if (!state.open) {
    const diagnostic = await ctx.client.evaluate(`(() => {
      const command = app.commands.findCommand("bob-navigation-hotkeys:snooze-task");
      const view = app.workspace.activeLeaf?.view;
      return {
        command: command ? { id: command.id, hotkeys: command.hotkeys || null, callback: typeof command.editorCallback } : null,
        file: view?.file?.path || null,
        cursor: view?.editor?.getCursor?.() || null,
        line: view?.editor?.getLine?.(${cursor.line}) || null,
        active: document.activeElement?.tagName + "." + String(document.activeElement?.className || ""),
        seenKeys: window.__snoozeE2EKeys || [],
      };
    })()`);
    throw new Error("Alt+Z did not open the Snooze Card: " + JSON.stringify({ state, diagnostic }));
  }
  return state;
}

async function takeShot(ctx, name, theme) {
  await shared.setTheme(ctx.client, theme);
  const row = await shared.capture(ctx.client.cardClient || ctx.client, ctx.outDir, name, 1440, theme, "snooze-card");
  ctx.report.screenshots.push(row);
  return row;
}

function installFixture(vault, data) {
  writeNote(vault, "jobs.md", data.tasks);
  writeNote(vault, data.daily, data.dailyText);
  writeNote(vault, "README.md", "# Scratch Snooze acceptance\n");
}

async function launch(ctx, executable, conflict) {
  const port = await shared.freePort();
  ctx.cdpPort = port;
    const env = {
    ...process.env,
    HOME: ctx.profileDir,
    BOB_DIR: ctx.vaultDir,
    BOB_CONFIG_FILE: ctx.configPath,
    BOB_NOW: ctx.fixture.date + " " + colon(ctx.fixture.nowMinutes) + ":00",
    XDG_CONFIG_HOME: path.dirname(path.dirname(ctx.configPath)),
    TMPDIR: ctx.tempDir,
    NO_COLOR: "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  ctx.child = spawn(executable, ["--no-sandbox", "--headless=new", "--ozone-platform=headless", "--disable-gpu", "--use-gl=swiftshader", "--window-size=1440,1000", "--user-data-dir=" + ctx.profileDir,
    "--remote-debugging-port=" + port, "--remote-allow-origins=http://127.0.0.1/*", ctx.vaultDir], {
    cwd: ctx.vaultDir, env, stdio: ["ignore", "pipe", "pipe"],
  });
  ctx.childOutput = [];
  for (const stream of [ctx.child.stdout, ctx.child.stderr]) {
    stream?.on("data", (chunk) => {
      const text = String(chunk);
      ctx.childOutput.push(text.slice(0, 2000));
      if (ctx.childOutput.length > 30) ctx.childOutput.shift();
    });
  }
  ctx.child.once("exit", (code, signal) => {
    ctx.report.sessions.push({ conflict, exited: true, code, signal });
  });
  const alive = () => ctx.child && ctx.child.exitCode == null;
  let selected;
  try { selected = await shared.selectTarget(port, ctx.vaultDir, alive); }
  catch (error) {
    ctx.report.startupFailure = { message: String(error && error.message || error), exitCode: ctx.child.exitCode, output: ctx.childOutput };
    throw error;
  }
  ctx.client = selected.client;
  await ctx.client.call("Runtime.enable");
  await ctx.client.call("Log.enable");
  ctx.client.on("Runtime.exceptionThrown", (params) => ctx.report.exceptions.push({ text: params.exceptionDetails?.text || "", url: params.exceptionDetails?.url || "" }));
  await shared.trustCommunityPlugins(ctx.client);
  await shared.waitFor(ctx.client, `(${JSON.stringify(pluginIds)}).every((id) => Boolean(app.plugins.plugins[id]))`, Boolean, "Bob plugins loaded", 45_000);
  await shared.waitFor(ctx.client, `Boolean(app.commands.findCommand("bob-navigation-hotkeys:snooze-task"))`, Boolean, "Snooze task command registered after layout readiness", 15_000);
  await shared.setViewport(ctx.client, 1440, 1000);
  ctx.report.sessions.push({ conflict, vault: ctx.vaultDir, pid: ctx.child.pid, cdpPort: port });
}

async function stop(ctx) {
  if (ctx.client) { ctx.client.close(); ctx.client = null; }
  if (ctx.child && ctx.child.exitCode == null) {
    try { ctx.child.kill("SIGTERM"); } catch (_) {}
    await shared.sleep(500);
    if (ctx.child.exitCode == null) { try { ctx.child.kill("SIGKILL"); } catch (_) {} }
  }
  ctx.child = null;
}

async function runNormal(ctx) {
  const { client, fixture: f, report } = ctx;
  const check = (name, ok, detail = {}) => {
    report.assertions.push({ name, status: ok ? "pass" : "fail", detail });
    if (!ok) throw new Error(name + " failed: " + JSON.stringify(detail));
  };
  check("plugins-loaded", await client.evaluate(`(${JSON.stringify(pluginIds)}).every((id) => Boolean(app.plugins.plugins[id]))`), { ids: pluginIds });
  await client.evaluate(`(() => {
    const vault = app.vault;
    if (vault && typeof vault.process === "function" && !vault.__snoozeProcessWrapped) {
      const original = vault.process;
      vault.process = function (file, callback) {
        window.__snoozeVaultProcessPaths = window.__snoozeVaultProcessPaths || [];
        window.__snoozeVaultProcessPaths.push(file?.path || null);
        return original.apply(this, arguments);
      };
      vault.__snoozeProcessWrapped = true;
    }
  })()`);
  const runtimeApi = await client.evaluate(`(() => {
    const plugin = app.plugins.plugins["bob-navigation-hotkeys"];
    return { cursor: typeof plugin?.openSnoozeCardAtCursor, taskCard: typeof plugin?.openSnoozeCardFromTaskCard, resolver: typeof plugin?.resolveSnoozeAtCursor };
  })()`);
  check("snooze-runtime-api-installed", runtimeApi.cursor === "function" && runtimeApi.taskCard === "function" && runtimeApi.resolver === "function", runtimeApi);
  const baseline = f.dailyText;

  // Alt+Z is a real editor keypress. The first event end time is selected,
  // and Enter commits through the open editor transaction.
  await openCardFromLink(ctx, "[[#^same-note]]");
  let card = await cardProbe(client);
  check("alt-z-opens-and-preselects-event", card.open && card.focused && card.rows[0]?.text.includes("after Yogi interview"), card);
  const expectedLiveFooter = `TODAY ${f.initialOnClockLinks - 1}/${f.planCap} now, ${f.initialOnClockLinks}/${f.planCap} after`;
  check("footer-counts-use-fixture-postimage", card.rows[0]?.text.includes(`${colon(f.eventEnd)} · after Yogi interview`)
    && card.footer.includes(expectedLiveFooter), { eventLabel: card.rows[0]?.text, expectedLiveFooter, footer: card.footer });
  await takeShot(ctx, "ordinary-light", "light");
  await takeShot(ctx, "ordinary-dark", "dark");
  await press(client, "Enter");
  await sleep(900);
  let updated = await editorText(client, f.daily);
  if (!updated.includes("- **" + hhmm(f.eventEnd) + "** [[#^same-note]]")) {
    await takeShot(ctx, "after-enter-failure", "light");
    check("event-suggestion-moved-link-and-note", false, { card: await cardProbe(client), commit: await client.evaluate("window.__snoozeE2ECommit || null"), excerpt: updated.split("## Snoozed")[1]?.slice(0, 260) });
  }
  check("event-suggestion-moved-link-and-note", !updated.includes("- [[#^same-note]]") && updated.includes("- **" + hhmm(f.eventEnd) + "** [[#^same-note]]") && updated.includes("preserve this authored note"), { event: hhmm(f.eventEnd), excerpt: updated.split("## Snoozed")[1]?.slice(0, 260) });
  await press(client, "z", 2); // Ctrl+Z: a single daily-editor undo restores both row and source subtree.
  await shared.waitFor(client, "app.workspace.activeLeaf?.view?.editor?.getValue?.()", (value) => value === baseline, "single undo restores daily preimage", 12_000);
  check("same-note-transaction-undo", await editorText(client, f.daily) === baseline, { oneUndoRestoredExactPreimage: true });

  // Exercise the list movement aliases and prove an authored invalid time
  // cannot fall through to the still-selected suggestion.
  await openCardFromLink(ctx, "[[#^same-note]]");
  card = await cardProbe(client);
  const originalSelection = card.rows.findIndex((row) => row.selected);
  await press(client, "ArrowDown");
  const afterArrow = await cardProbe(client);
  await press(client, "p", 2);
  const afterCtrlP = await cardProbe(client);
  await press(client, "n", 2);
  const afterCtrlN = await cardProbe(client);
  await press(client, "Tab");
  await press(client, "a", 2); // Ctrl+A
  await insertText(client, "00:01");
  await sleep(150);
  card = await cardProbe(client);
  await takeShot(ctx, "invalid-time-light", "light");
  const beforeInvalid = await editorText(client, f.daily);
  await press(client, "Enter");
  await sleep(250);
  const afterInvalid = await editorText(client, f.daily);
  const navigationWorked = afterArrow.rows.some((row, i) => row.selected && i !== originalSelection)
    && afterCtrlP.rows.some((row, i) => row.selected && i === originalSelection)
    && afterCtrlN.rows.some((row, i) => row.selected && i !== originalSelection);
  const popupKeys = await client.cardClient?.evaluate("window.__snoozeCardKeys || []") || [];
  check("keyboard-navigation-and-invalid-input", navigationWorked && card.hint.includes("same-day only") && beforeInvalid === afterInvalid && (await cardProbe(client)).open, {
    originalSelection, arrow: afterArrow.rows.findIndex((row) => row.selected), ctrlP: afterCtrlP.rows.findIndex((row) => row.selected), ctrlN: afterCtrlN.rows.findIndex((row) => row.selected), hint: card.hint,
    popupKeys: popupKeys.slice(-12),
  });
  await press(client, "Escape");
  client.cardClient = null;

  // Task Card's actual Ctrl+Shift+P entry and the `z` row open the same card.
  await shared.openNote(client, "jobs.md", "live");
  await setCursor(client, "jobs.md", "^ready");
  await press(client, "P", 10); // Ctrl+Shift+P
  await sleep(500);
  await attachModalTarget(ctx, ".bob-task-card-modal");
  let taskCardOpenedByShortcut = true;
  try {
    await shared.waitFor(ctx.modalClient, "document.querySelector('.bob-task-card-modal') ? 'open' : ''", Boolean, "Task Card", 1_500);
  } catch (error) {
    taskCardOpenedByShortcut = false;
    const command = await client.evaluate(`app.commands.executeCommandById("bob-navigation-hotkeys:set-bullet-property")`);
    if (command === false) throw new Error("Ctrl+Shift+P did not open Task Card, and the registered command could not be invoked: " + error.message);
    await sleep(500);
    await attachModalTarget(ctx, ".bob-task-card-modal");
    await shared.waitFor(ctx.modalClient, "document.querySelector('.bob-task-card-modal') ? 'open' : ''", Boolean, "Task Card command fallback", 12_000);
  }
  await press(client, "z");
  await sleep(300);
  await attachModalTarget(ctx, ".bob-snooze-card-modal");
  card = await shared.waitFor(ctx.modalClient, "document.querySelector('.bob-snooze-card-modal') ? 'open' : ''", Boolean, "Snooze Card from Task Card z", 12_000).then(() => cardProbe(client));
  check("task-card-z-opens-same-card", card.open && /Ready task/.test(card.title), { ...card, taskCardOpenedByShortcut });
  await press(client, "Escape");
  await sleep(180);
  client.cardClient = null;

  // Task Card `z` uses its original source line for a live Task Link, keeping
  // the same Pomodoro context and moving that link's authored subtree once.
  await shared.openNote(client, f.daily, "live");
  const taskCardLinkBaseline = await editorText(client, f.daily);
  await setCursor(client, f.daily, "[[jobs#^task-card-link]]");
  await press(client, "P", 10); // Ctrl+Shift+P
  await sleep(500);
  await attachModalTarget(ctx, ".bob-task-card-modal");
  let taskCardLinkOpenedByShortcut = true;
  try {
    await shared.waitFor(ctx.modalClient, "document.querySelector('.bob-task-card-modal') ? 'open' : ''", Boolean, "Task Card on Task Link", 1_500);
  } catch (error) {
    taskCardLinkOpenedByShortcut = false;
    const command = await client.evaluate(`app.commands.executeCommandById("bob-navigation-hotkeys:set-bullet-property")`);
    if (command === false) throw new Error("Ctrl+Shift+P did not open the Task Link's Task Card, and the registered command could not be invoked: " + error.message);
    await sleep(500);
    await attachModalTarget(ctx, ".bob-task-card-modal");
    await shared.waitFor(ctx.modalClient, "document.querySelector('.bob-task-card-modal') ? 'open' : ''", Boolean, "Task Link Task Card command fallback", 12_000);
  }
  await press(client, "z");
  await sleep(300);
  await attachModalTarget(ctx, ".bob-snooze-card-modal");
  card = await shared.waitFor(ctx.modalClient, "document.querySelector('.bob-snooze-card-modal') ? 'open' : ''", Boolean, "Snooze Card from Task Link Task Card z", 12_000).then(() => cardProbe(client));
  const linkCardFactsMatch = /Task Card live-link task/.test(card.title) && card.footer.includes("leaves WRITE");
  const taskCardTaskBaseline = await fileText(client, "jobs.md");
  await press(client, "Enter");
  await sleep(700);
  const taskCardLinkSnoozed = await editorText(client, f.daily);
  const taskCardTaskAfter = await fileText(client, "jobs.md");
  const taskCardLinkPomodoros = taskCardLinkSnoozed.split("## Pomodoros")[1]?.split("## Snoozed")[0] || "";
  const taskCardLinkSnoozedRows = taskCardLinkSnoozed.split(/\r?\n/).filter((line) => line.includes("[[jobs#^task-card-link]]") && /^- \*\*\d{4}\*\*/.test(line));
  check("task-card-z-from-live-link-moves-subtree", linkCardFactsMatch
    && taskCardLinkSnoozedRows.length === 1
    && taskCardLinkSnoozed.includes("preserve Task Card link note")
    && taskCardTaskAfter === taskCardTaskBaseline
    && !taskCardLinkPomodoros.includes("[[jobs#^task-card-link]]")
    && taskCardLinkPomodoros.includes("[[#^same-note]]")
    && taskCardLinkPomodoros.includes("preserve this authored note"), {
    ...card,
    taskCardLinkOpenedByShortcut,
    snoozedRows: taskCardLinkSnoozedRows,
    sourcePomodoros: taskCardLinkPomodoros,
  });
  await press(client, "z", 2); // Ctrl+Z restores the Task Link and its nested note in one editor undo.
  await shared.waitFor(client, "app.workspace.activeLeaf?.view?.editor?.getValue?.()", (value) => value === taskCardLinkBaseline, "Task Card Task Link undo restores preimage", 12_000);
  check("task-card-z-from-live-link-undo", await editorText(client, f.daily) === taskCardLinkBaseline, { oneUndoRestoredExactPreimage: true });
  client.cardClient = null;

  // The fixture has three on-clock links and a cap of one. Waking this Ready
  // task adds one more dedicated Task Link, so the over-cap result is explicit.
  await openCardFromLink(ctx, "^ready", "jobs.md");
  card = await cardProbe(client);
  const expectedReadyFooter = `TODAY ${f.initialOnClockLinks}/${f.planCap} now, ${f.initialOnClockLinks + 1}/${f.planCap} after`;
  check("ready-footer-counts-use-fixture-postimage", card.footer.includes(expectedReadyFooter), { expectedReadyFooter, footer: card.footer });
  await takeShot(ctx, "over-cap-footer-light", "light");
  await client.call("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }] });
  await takeShot(ctx, "forced-colors-snooze-card", "light");
  await client.call("Emulation.setEmulatedMedia", { features: [] });
  await press(client, "a", 2);
  await insertText(client, "+30m");
  await sleep(150);
  const readyInput = await cardProbe(client);
  check("ready-time-entry-is-preserved", readyInput.open && readyInput.input === "+30m", readyInput);
  await press(client, "Enter");
  await sleep(500);
  const readyCommit = await client.evaluate("window.__snoozeE2ECommit || null");
  check("ready-commit-succeeded", Boolean(readyCommit && readyCommit.result && readyCommit.result.ok === true), { readyCommit, writes: await client.evaluate("window.__snoozeWriteTrace || []"), card: await cardProbe(client) });
  await shared.waitFor(client, `app.vault.read(app.vault.getAbstractFileByPath("jobs.md"))`, (text) => /\[\*\] #task Ready task/.test(text) && text.includes("fresh::"), "Ready task promoted and freshness stamped", 12_000);
  const afterReady = await fileText(client, "jobs.md");
  check("ready-promotes-and-stamps", /\[\*\] #task Ready task/.test(afterReady) && new RegExp(`\\[fresh::\\s*${f.date}\\s*\\]`).test(afterReady), { line: afterReady.split("\n").find((line) => line.includes("^ready")) });

  let stableTasks = true;
  const stableResults = [];
  for (const [needle, label] of [["^next-stable", "Next"], ["^progress-stable", "In Progress"]]) {
    const before = await fileText(client, "jobs.md");
    await openCardFromLink(ctx, needle, "jobs.md");
    const opened = await cardProbe(client);
    await press(client, "Escape");
    await sleep(180);
    client.cardClient = null;
    const after = await fileText(client, "jobs.md");
    const same = before === after;
    stableResults.push({ label, opened: opened.open, same });
    stableTasks = stableTasks && opened.open && same;
  }
  check("next-and-inprogress-stay-byte-identical", stableTasks, stableResults);

  // A task definition without a block ID opens the existing Block ID naming
  // modal. Escape cancels the proposal without editing either note.
  const namingTaskBefore = await fileText(client, "jobs.md");
  const namingDayBefore = await fileText(client, f.daily);
  await shared.openNote(client, "jobs.md", "live");
  await setCursor(client, "jobs.md", "Unnamed eligible task");
  await press(client, "Z", 1);
  let namingTarget = null;
  for (let attempt = 0; attempt < 20 && !namingTarget; attempt += 1) {
    const mainHas = await client.evaluate(`document.body.innerText.includes("Block ID")`);
    if (mainHas) { namingTarget = client; break; }
    const modal = await attachModalTarget(ctx);
    if (modal && await modal.evaluate(`document.body.innerText.includes("Block ID")`)) namingTarget = modal;
    if (!namingTarget) await sleep(150);
  }
  check("unnamed-task-naming-prompt-opens", Boolean(namingTarget), { found: Boolean(namingTarget) });
  await press(namingTarget, "Escape");
  await sleep(250);
  const namingTaskAfter = await fileText(client, "jobs.md");
  const namingDayAfter = await fileText(client, f.daily);
  check("unnamed-task-naming-cancel-is-no-write", namingTaskAfter === namingTaskBefore && namingDayAfter === namingDayBefore, {
    taskUnchanged: namingTaskAfter === namingTaskBefore,
    dailyUnchanged: namingDayAfter === namingDayBefore,
  });
  client.cardClient = null;

  // Refusals are checked against real fixture definitions and must not write.
  const refusalBefore = await fileText(client, f.daily);
  const refusalResults = [];
  for (const [needle, expected] of [["^blocked", /Blocked|blocked/i], ["^done", /done/i], ["^cancelled", /cancel|cannot/i], ["^event-task", /Event|Calendar/i]]) {
    await client.evaluate(`document.querySelectorAll(".notice").forEach((node) => node.remove())`);
    if (ctx.modalClient) await ctx.modalClient.evaluate(`document.querySelectorAll(".notice").forEach((node) => node.remove())`);
    await shared.openNote(client, "jobs.md", "live");
    await setCursor(client, "jobs.md", needle);
    await press(client, "Z", 1);
    await sleep(450);
    const state = await cardProbe(client);
    const popupNotices = ctx.modalClient ? await ctx.modalClient.evaluate(`Array.from(document.querySelectorAll(".notice"), (node) => node.textContent || "")`) : [];
    const notice = [...state.notices, ...popupNotices].join(" ");
    refusalResults.push({ needle, cardOpen: state.open, notice });
    check("refusal-" + needle.slice(1), !state.open && expected.test(notice), { notice, expected: String(expected) });
  }
  check("blocked-event-done-refusals", refusalResults.length === 4, refusalResults);
  check("refusals-preserve-notes", await fileText(client, f.daily) === refusalBefore, { unchanged: true });

  // Retiming and unsnoozing use keyboard input and an actual CDP click on the
  // distinct action row. The blocked row remains removable without a lane edit.
  await openCardFromLink(ctx, `**${hhmm(f.retimeAt)}** [[jobs#^retime]]`);
  card = await cardProbe(client);
  check("snoozed-mode-and-actions", /Snoozed until|asleep|Blocked/.test(card.subtitle) && card.actions.some((row) => row.text.includes("Unsnooze")), card);
  check("snoozed-header-state-renders", new RegExp(`^Snoozed until ${colon(f.retimeAt)} · in \\d+h(?: \\d+m)?$`).test(card.subtitle), { subtitle: card.subtitle });
  await takeShot(ctx, "snoozed-light", "light");
  await takeShot(ctx, "snoozed-dark", "dark");
  await press(client, "a", 2);
  await insertText(client, "+30m");
  await press(client, "Enter");
  await shared.waitFor(client, `!app.workspace.activeLeaf?.view?.editor?.getValue?.().includes("**${hhmm(f.retimeAt)}** [[jobs#^retime]]")`, Boolean, "retime committed", 12_000);
  const retimed = await editorText(client, f.daily);
  const retimedLine = retimed.split("\n").find((line) => line.includes("^retime")) || "";
  const retimedAt = /\*\*(\d{4})\*\* \[\[jobs#\^retime\]\]/.exec(retimedLine)?.[1] || "";
  const retimedMinutes = retimedAt ? Number(retimedAt.slice(0, 2)) * 60 + Number(retimedAt.slice(2)) : null;
  const actualNow = partsForDate(new Date(), f.zone).minutes;
  const retimeDelta = Number.isInteger(retimedMinutes) ? (retimedMinutes - actualNow + 1440) % 1440 : null;
  check("retime-row", Boolean(retimedAt) && retimeDelta >= 25 && retimeDelta <= 35 && retimedAt !== hhmm(f.retimeAt), { row: retimedLine, retimeDelta, original: hhmm(f.retimeAt) });
  await openCardFromLink(ctx, `**${hhmm(f.blockedAt)}** [[jobs#^blocked]]`);
  card = await cardProbe(client);
  await takeShot(ctx, "blocked-snoozed-light", "light");
  const blockedWake = card.actions.find((row) => row.text.includes("Wake now"));
  check("blocked-header-and-wake-reason", card.subtitle === `Snoozed until ${colon(f.blockedAt)} · blocked — waits on prerequisites`
    && blockedWake?.disabled === true && blockedWake.text.includes("waits on prerequisites"), { subtitle: card.subtitle, wake: blockedWake });
  const unsnooze = card.actions.find((row) => row.text.includes("Unsnooze"));
  check("blocked-row-can-unsnooze", Boolean(unsnooze) && unsnooze.disabled !== true, card);
  await click(client, ".bob-snooze-card-actions > *", "Unsnooze");
  await shared.waitFor(client, `!app.workspace.activeLeaf?.view?.editor?.getValue?.().includes("[[jobs#^blocked]]")`, Boolean, "blocked row unsnoozed", 12_000);
  const afterDrop = await editorText(client, f.daily);
  const blockedTask = await fileText(client, "jobs.md");
  check("retime-and-unsnooze", !afterDrop.includes("**" + hhmm(f.blockedAt) + "** [[jobs#^blocked]]") && blockedTask.includes("[?] #task Blocked task"), { laneUnchanged: true });

  // Wake now delegates to the current Bob binary against this scratch vault.
  await openCardFromLink(ctx, `**${hhmm(f.wakeAt)}** [[jobs#^wake-now]]`);
  card = await cardProbe(client);
  check("wake-now-row-available", card.actions.some((row) => row.text.includes("Wake now") && !row.disabled), card);
  await click(client, ".bob-snooze-card-actions > *", "Wake now");
  await shared.waitFor(client, `app.workspace.activeLeaf?.view?.editor?.getValue?.().includes("[[jobs#^wake-now]]") && app.workspace.activeLeaf.view.editor.getValue().includes("woke")`, Boolean, "current bob woke scratch task", 20_000);
  const wokeText = await editorText(client, f.daily);
  const invocation = fs.existsSync(ctx.bobLog) ? fs.readFileSync(ctx.bobLog, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];
  check("wake-now-runs-current-bob", invocation.some((args) => args[0] === "snooze" && args[1] === "wake" && args.some((value) => /jobs(?:\.md)?#\^wake-now/.test(value)) && args.includes("-q") && args.includes("json"))
    && /- ~~\*\*/.test(wokeText) && wokeText.includes("[[jobs#^wake-now]]"), { invocation, wokeRow: wokeText.split("\n").find((line) => line.includes("wake-now")) });
  const wakeHistory = wokeText.split("\n").find((line) => line.includes("[[jobs#^wake-now]]") && line.includes("~~")) || "";
  const wokenLinkLine = wokeText.split("\n").find((line) => line.includes("[[jobs#^wake-now]]") && !line.includes("~~")) || "";
  if (wakeHistory && wokenLinkLine) {
    await openCardFromLink(ctx, wokenLinkLine.trim());
    await press(client, "a", 2);
    await insertText(client, "+30m");
    await press(client, "Enter");
    await shared.waitFor(client, `app.workspace.activeLeaf?.view?.editor?.getValue?.()`, (text) => typeof text === "string" && /^- \*\*\d{4}\*\* \[\[jobs#\^wake-now\]\]$/m.test(text) && !text.split("\n").some((line) => line.includes("[[jobs#^wake-now]]") && line.includes("~~")), "woken task re-snoozed and struck history replaced", 12_000);
  }
  let currentDaily = await editorText(client, f.daily);
  let dailyLines = currentDaily.split("\n");
  const historyLinkIndex = dailyLines.findIndex((line) => line.includes("[[jobs#^history]]"));
  const closedHistoryBlock = historyLinkIndex > 0 ? dailyLines.slice(historyLinkIndex - 1, historyLinkIndex + 1).join("\n") : "";
  if (closedHistoryBlock) {
    await openCardFromLink(ctx, "[[jobs#^history]]");
    await press(client, "a", 2);
    await insertText(client, "+30m");
    await press(client, "Enter");
    await shared.waitFor(client, `app.workspace.activeLeaf?.view?.editor?.getValue?.()`, (text) => typeof text === "string" && text.includes("[[jobs#^history]]") && text.includes("## Snoozed"), "closed history link snoozed", 12_000);
  }
  currentDaily = await editorText(client, f.daily);
  const afterWakeHistory = currentDaily.split("\n").find((line) => line.includes("[[jobs#^wake-now]]") && line.includes("~~")) || "";
  const resnoozedActive = currentDaily.split("\n").find((line) => /^- \*\*\d{4}\*\* \[\[jobs#\^wake-now\]\]$/.test(line)) || "";
  const historySnoozed = currentDaily.split("\n").find((line) => /^- \*\*\d{4}\*\* \[\[jobs#\^history\]\]$/.test(line)) || "";
  check("resnooze-replaces-struck-history-and-closed-ledger-history-stays",
    Boolean(wakeHistory && wokenLinkLine && closedHistoryBlock && resnoozedActive && historySnoozed)
      && afterWakeHistory === ""
      && currentDaily.includes(closedHistoryBlock),
    { wakeHistoryBefore: wakeHistory, wakeHistoryAfter: afterWakeHistory, resnoozedActive, historySnoozed, closedHistoryBlock, foundWokenLink: Boolean(wokenLinkLine) });

  await client.evaluate(`(() => {
    app.workspace.iterateAllLeaves((leaf) => {
      if (leaf?.view?.file?.path === ${JSON.stringify(f.daily)} && typeof leaf.detach === "function") leaf.detach();
    });
  })()`);
  const dailyClosed = await client.evaluate(`!app.workspace.getLeavesOfType("markdown").some((leaf) => leaf.view?.file?.path === ${JSON.stringify(f.daily)})`);
  if (dailyClosed) {
    await openCardFromLink(ctx, "^closed-daily", "jobs.md");
    await press(client, "a", 2);
    await insertText(client, "+30m");
    await press(client, "Enter");
    await shared.waitFor(client, `app.vault.cachedRead(app.vault.getAbstractFileByPath(${JSON.stringify(f.daily)}))`, (text) => typeof text === "string" && text.includes("[[jobs#^closed-daily]]"), "closed daily note snoozed through vault.process", 12_000);
  }
  const processPaths = await client.evaluate("window.__snoozeVaultProcessPaths || []");
  const afterClosedDaily = await fileText(client, f.daily);
  check("closed-daily-note-uses-vault-process", dailyClosed && processPaths.includes(f.daily) && afterClosedDaily.includes("[[jobs#^closed-daily]]"), { dailyClosed, processPaths, row: afterClosedDaily.split("\n").find((line) => line.includes("^closed-daily")) });

  check("ordinary-and-snoozed-screenshots", report.screenshots.some((s) => s.name === "ordinary-light") && report.screenshots.some((s) => s.name === "ordinary-dark")
    && report.screenshots.some((s) => s.name === "snoozed-light") && report.screenshots.some((s) => s.name === "snoozed-dark")
    && report.screenshots.some((s) => s.name === "invalid-time-light") && report.screenshots.some((s) => s.name === "blocked-snoozed-light"), { screenshots: report.screenshots.map((s) => s.name) });
  check("over-cap-and-forced-colors-screenshots", report.screenshots.some((s) => s.name === "over-cap-footer-light") && report.screenshots.some((s) => s.name === "forced-colors-snooze-card"), { screenshots: report.screenshots.map((s) => s.name) });
}

async function runConflict(ctx, executable) {
  const { client, report, fixture: f } = ctx;
  const before = fs.readFileSync(ctx.hotkeysPath);
  const info = await client.evaluate(`(() => {
    const plugin = app.plugins.plugins["bob-navigation-hotkeys"];
    const command = app.commands.findCommand("bob-navigation-hotkeys:snooze-task");
    return { command: Boolean(command), hotkeys: command?.hotkeys || [], conflicts: plugin?.snoozeAltZConflict || [] };
  })()`);
  assert.equal(info.command, true, "Snooze command stays registered under a conflict");
  assert.ok(info.conflicts.some((item) => item.commandId === "command-palette:open"), JSON.stringify(info));
  assert.equal(info.hotkeys.some((hotkey) => hotkey && String(hotkey.key).toLowerCase() === "z" && (hotkey.modifiers || []).some((modifier) => String(modifier).toLowerCase() === "alt")), false, "a conflict leaves no Alt+Z default on snooze-task");
  await shared.openNote(client, f.daily, "live");
  await setCursor(client, f.daily, "[[#^same-note]]");
  await press(client, "z", 1);
  await sleep(350);
  assert.equal((await cardProbe(client)).open, false, "conflicting Alt+Z must not dispatch Snooze Card");
  await client.evaluate("app.commands.executeCommandById('bob-navigation-hotkeys:snooze-task')");
  await sleep(500);
  await attachModalTarget(ctx, ".bob-snooze-card-modal");
  await shared.waitFor(ctx.modalClient, "document.querySelector('.bob-snooze-card-modal') ? 'open' : ''", Boolean, "command remains manually available", 12_000);
  await press(client, "Escape");
  const after = fs.readFileSync(ctx.hotkeysPath);
  assert.deepEqual(after, before, "the existing hotkey config bytes remain unchanged");
  report.assertions.push({ name: "hotkey-conflict-preserves-config", status: "pass", detail: { conflicts: info.conflicts, hotkeys: info.hotkeys, configSha256: sha256(after) } });
  await stop(ctx);
  void executable;
}

async function run(args) {
  const executable = args.executable || process.env.OBSIDIAN_BIN || electronFallback;
  const bob = shared.findBobProvenance();
  fs.mkdirSync(ownedRoot, { recursive: true });
  const scratchRun = scratchLifecycle.createScratch({ root: ownedRoot, prefix: "run-" });
  const scratch = scratchRun.dir;
  const runtimeTemp = path.join(scratch, "runtime");
  const outDir = path.resolve(args.out || path.join(scratch, "evidence"));
  const reportPath = path.resolve(args.report || path.join(outDir, "snooze-card-e2e.json"));
  const out = { pass: false, startedAt: new Date().toISOString(), executable, bob, outDir, reportPath, assertions: [], screenshots: [], exceptions: [], sessions: [], fixture: null };
  let current = null;
  const check = (name, ok, detail = {}) => {
    out.assertions.push({ name, status: ok ? "pass" : "fail", detail });
    if (!ok) throw new Error(name + " failed: " + JSON.stringify(detail));
  };
  try {
    fs.mkdirSync(runtimeTemp, { recursive: true });
    fs.accessSync(executable, fs.constants.X_OK);
    if (!process.env.DISPLAY && !process.env.XVFB_RUN_TMPDIR) throw new Error("No X display; launch with xvfb-run -a");
    const help = spawnSync(executable, ["--help"], { encoding: "utf8", timeout: 15_000, env: { ...process.env, TMPDIR: ownedRoot } });
    if (/unable to find Obsidian/i.test(String(help.stdout || "") + String(help.stderr || ""))) throw new Error("--executable is the Obsidian CLI shim, not Electron");
    fs.mkdirSync(outDir, { recursive: true });
    const f = fixture();
    out.fixture = { date: f.date, timezone: f.zone, daily: f.daily, now: colon(f.nowMinutes), eventEnd: colon(f.eventEnd), planCap: f.planCap, initialOnClockLinks: f.initialOnClockLinks };
    const bobLog = path.join(scratch, "bob-argv.jsonl");
    const bobWrapper = path.join(scratch, "bob-wrapper.cjs");
    fs.writeFileSync(bobWrapper, `#!/usr/bin/env node\nconst fs=require('node:fs'); const {spawnSync}=require('node:child_process'); const args=process.argv.slice(2); fs.appendFileSync(${JSON.stringify(bobLog)},JSON.stringify(args)+"\\n"); const r=spawnSync(${JSON.stringify(bob.path)},args,{encoding:'utf8',env:process.env,timeout:90000,maxBuffer:32*1024*1024}); if(r.stdout)process.stdout.write(r.stdout); if(r.stderr)process.stderr.write(r.stderr); process.exit(r.status==null?1:r.status);\n`);
    fs.chmodSync(bobWrapper, 0o755);

    const createContext = (conflict) => {
      const runRoot = path.join(scratch, conflict ? "conflict" : "normal");
      const vaultDir = path.join(runRoot, "vault");
      const profileDir = path.join(runRoot, "profile");
      const tempDir = runtimeTemp;
      const configPath = path.join(runRoot, "xdg", "bob", "config.yml");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.mkdirSync(profileDir, { recursive: true });
      fs.mkdirSync(vaultDir, { recursive: true });
      installFixture(vaultDir, f);
      const installed = installPlugins(vaultDir, conflict, bobWrapper, configPath);
      shared.seedProfile(profileDir, fs.realpathSync(vaultDir));
      return { report: out, fixture: f, outDir, vaultDir: fs.realpathSync(vaultDir), profileDir, tempDir, configPath, bobLog, hotkeysPath: installed.hotkeysPath, hotkeysBytes: installed.hotkeysBytes, child: null, client: null };
    };
    current = createContext(false);
    await launch(current, executable, false);
    await runNormal(current);
    await stop(current);

    current = createContext(true);
    await launch(current, executable, true);
    await runConflict(current, executable);
    check("hotkey-conflict-preserves-config", out.assertions.some((row) => row.name === "hotkey-conflict-preserves-config" && row.status === "pass"), { checked: true });
    for (const name of required) check(name, out.assertions.some((row) => row.name === name && row.status === "pass"), { missing: true });
    check("no-renderer-exceptions", out.exceptions.length === 0, out.exceptions);
    out.pass = true;
  } catch (error) {
    out.error = error && error.stack ? error.stack : String(error);
    out.assertions.push({ name: "runner-error", status: "fail", detail: String(error && error.message || error) });
    if (current?.client) {
      try { out.screenshots.push(await shared.capture(current.client, outDir, "runner-failure", 1440, "light", "failure")); } catch (_) {}
    }
  } finally {
    if (current) await stop(current);
    out.finishedAt = new Date().toISOString();
    out.scratchPreserved = Boolean(scratchLifecycle.keepEverythingFromEnv() || !out.pass);
    out.counts = out.assertions.reduce((result, row) => { result[row.status] = (result[row.status] || 0) + 1; return result; }, {});
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(out, null, 2) + "\n");
    scratchLifecycle.finishScratch(scratchRun, { success: out.pass });
  }
  process.stdout.write((out.pass ? "PASS" : "FAIL") + " Snooze Card Obsidian acceptance " + JSON.stringify(out.counts) + "\n");
  process.stdout.write("Report: " + reportPath + "\nScreenshots: " + outDir + "\n");
  if (!out.pass) {
    process.stderr.write((out.error || "Acceptance failed") + "\n");
    process.exitCode = 1;
  }
}

function selfTest() {
  const args = parseArgs(["--self-test", "--out", "out", "--report", "report"]);
  assert.equal(args.selfTest, true);
  const f = fixture(new Date("2026-11-27T15:00:00.000Z"));
  assert.ok(pluginIds.includes("block-id-prompt"), "the snooze planner API provider is installed");
  assert.match(f.dailyText, /## Snoozed/);
  assert.match(f.dailyText, /\*\*\d{4}-\d{4}\*\* Yogi interview/);
  assert.match(f.dailyText, /preserve this authored note/);
  assert.match(f.dailyText, /\[\[jobs#\^task-card-link\]\]/);
  assert.match(f.dailyText, /preserve Task Card link note/);
  assert.match(f.tasks, /\^event-task/);
  assert.match(f.tasks, /\[\*\] #task Task Card live-link task \[type:: WRITE\] \^task-card-link/);
  assert.deepEqual(required.length, 22);
  console.log("offline self-test complete (fixtures and required evidence only; no Obsidian or bob launched)");
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (error) { process.stderr.write(String(error.message || error) + "\n"); process.exitCode = 2; return; }
  if (args.help) {
    process.stdout.write("Usage: node scripts/obsidian-snooze-card-e2e.cjs [--out DIR] [-e OBSIDIAN] [-r REPORT] [--self-test]\n");
    return;
  }
  if (args.selfTest) { selfTest(); return; }
  await run(args);
}

if (require.main === module) void main();
module.exports = { fixture, parseArgs, required, selfTest };
