#!/usr/bin/env node
// Real-Obsidian intention card and card editor acceptance.
// Uses a disposable Git vault/profile, an owned Obsidian process under Xvfb,
// and the supplied current bob binary. Never opens the live vault.
"use strict";

const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const lib = require("./obsidian-intention-card-e2e-lib.cjs");
const shared = require("./obsidian-record-card-e2e.cjs");
const workflows = require("./obsidian-intention-card-workflows.cjs");
const workflowsLanding = require("./obsidian-intention-card-landing-workflows.cjs");

const repoRoot = path.resolve(__dirname, "..");
const ELECTRON_FALLBACK = "/snap/obsidian/current/app/obsidian";
const PLUGIN_IDS = ["bob-ledger-tools", "bob-navigation-hotkeys", "bob-command-mode"];
const { sleep, waitFor, capture } = shared;

// Every mandatory check, in the order the walkthrough proves them. A missing
// row fails the run: a skipped or unrun workflow never counts as acceptance.
const REQUIRED_CHECKS = [
  "plugins-loaded", "test-clock-agrees",
  "display-live-today-mounts-once", "display-live-today-placement", "display-live-today-owned-rows",
  "display-live-today-parent-line", "display-reading-today-mounts-once", "display-reading-today-placement",
  "display-reading-today-owned-rows", "display-seven-owned-keys-reading", "display-seven-owned-keys-live",
  "display-agent-summary-provenance", "display-reflection-quote", "display-recent-closed-missing-band",
  "display-source-fails-open", "display-mode-change-restores", "display-empty-identity-card",
  "display-malformed-fails-open", "display-embed-fails-open", "display-unmount-restores",
  "display-failure-restores-and-recovers", "display-plugin-disable-restores", "display-passive-bytes-neutral",
  "display-reveal-on-cursor", "display-ghost-opens-editor", "display-rail-navigates", "display-period-children",
  "display-legacy-daily", "display-bytes-neutral",
  "editor-empty-double-equals", "editor-open-initial-selection", "editor-closed-initial-selection",
  "close-q-browse", "close-ctrl-bracket-browse", "close-escape-browse", "close-q-types-in-stage",
  "close-ctrl-bracket-stage", "close-escape-stage", "yesterday-prev-note-double-equals-r",
  "yesterday-double-equals-bracket-r", "edit-add-below", "edit-replace", "edit-paste-one-line",
  "edit-soft-cap-hint", "edit-reorder", "edit-remove", "edit-undo", "edit-card-repaints",
  "edit-reflection-multiline-save-close", "edit-reflection-repaints-card",
  "edit-summary-explainer", "edit-summary-provenance-edited", "edit-summary-undo-restores-stamps",
  "nav-next-missing-day-disabled", "nav-parent-chain", "nav-missing-period-hint", "nav-active-note-unchanged",
  "nav-boundary-walk", "entry-palette-edit-intentions", "entry-palette-reflect-yesterday",
  "entry-command-mode-rows", "entry-ctrl-shift-p-fallback", "entry-ctrl-shift-p-task-priority",
  "yaml-done-returns", "yaml-invalid-stays-recoverable", "stale-refusal-keeps-draft",
  "stale-explicit-retry-saves", "body-edit-survives-save", "old-bob-keeps-card-and-recovery",
  ...workflowsLanding.LANDING_CHECKS,
  "screenshots-captured", "no-console-exceptions",
];

function sha256Text(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function writeBobShim(shimDir) {
  fs.mkdirSync(shimDir, { recursive: true });
  const file = path.join(shimDir, "bob");
  // Records every child invocation with stdin and results. When the old-bob
  // flag exists, `periods update` answers exactly like a bob without it.
  fs.writeFileSync(file, `#!/usr/bin/env node
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
const log = process.env.BOB_INTENTION_E2E_LOG;
const hasStdin = args.some((arg, i) => (arg === "-i" || arg === "--input") && args[i + 1] === "-");
const input = hasStdin ? fs.readFileSync(0, "utf8") : undefined;
const append = (entry) => { try { fs.appendFileSync(log, JSON.stringify(entry) + "\\n"); } catch (_) {} };
append({ event: "start", pid: process.pid, at: new Date().toISOString(), args, input });
// The landing proof holds writer applies open to race keys and clicks.
if (args[0] === "periods" && args[1] === "update" && !args.includes("-n") && fs.existsSync(process.env.BOB_INTENTION_E2E_DELAY_FLAG || "")) {
  const ms = Number(fs.readFileSync(process.env.BOB_INTENTION_E2E_DELAY_FLAG, "utf8")) || 1500;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
if (args[0] === "periods" && args[1] === "update" && fs.existsSync(process.env.BOB_INTENTION_E2E_OLD_FLAG)) {
  const stderr = ${JSON.stringify(lib.OLD_BOB_STDERR)};
  append({ event: "finish", pid: process.pid, args, exitCode: 2, stdout: "", stderr, emulatedOldBob: true });
  process.stderr.write(stderr);
  process.exit(2);
}
const result = spawnSync(process.env.BOB_INTENTION_E2E_REAL, args, {
  encoding: "utf8", env: process.env, input, timeout: 90000, maxBuffer: 32 * 1024 * 1024,
});
append({ event: "finish", pid: process.pid, args, exitCode: result.status, stdout: result.stdout, stderr: result.stderr });
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status == null ? 1 : result.status);
`);
  fs.chmodSync(file, 0o755);
  return file;
}

function bobEnv(ctx) {
  return {
    ...process.env,
    HOME: ctx.profileDir,
    BOB_DIR: ctx.vaultDir,
    BOB_NOW: ctx.plan.today + " 12:00:00",
    BOB_CONFIG_FILE: path.join(ctx.profileDir, "missing-test-config.yml"),
    BOB_INTENTION_E2E_LOG: ctx.logPath,
    BOB_INTENTION_E2E_OLD_FLAG: ctx.oldBobFlag,
    BOB_INTENTION_E2E_DELAY_FLAG: ctx.delayFlag,
    BOB_INTENTION_E2E_REAL: ctx.bob.path,
    PATH: ctx.shimDir + path.delimiter + (process.env.PATH || ""),
    NO_COLOR: "1",
  };
}

function runBob(ctx, args, input) {
  const result = spawnSync(ctx.bob.path, args, {
    cwd: ctx.vaultDir, encoding: "utf8", input, timeout: 90_000, maxBuffer: 32 * 1024 * 1024, env: bobEnv(ctx),
  });
  if (result.error) throw result.error;
  let report = null;
  try { report = JSON.parse(String(result.stdout || "")); } catch (_) {}
  const row = { args, input: input || null, exitCode: result.status, signal: result.signal || null, stderr: String(result.stderr || "").slice(0, 1200), report };
  ctx.report.bobRuns.push(row);
  return row;
}

// A fresh real-bob dry run reads disk independently of Obsidian's caches.
function readFields(ctx, subject) {
  const row = runBob(ctx, ["periods", "update", subject, "-i", "-", "-f", "json", "-n"], JSON.stringify({ schema_version: 1, ops: [] }));
  if (row.exitCode !== 0 || !row.report || row.report.ok !== true) {
    throw new Error("bob periods update -n failed for " + subject + ": " + JSON.stringify(row).slice(0, 800));
  }
  return row.report;
}

function installPlugins(vaultDir) {
  for (const id of PLUGIN_IDS) {
    const dest = path.join(vaultDir, ".obsidian", "plugins", id);
    fs.mkdirSync(dest, { recursive: true });
    for (const name of ["manifest.json", "main.js", "styles.css"]) {
      const file = path.join(repoRoot, "plugins", id, name);
      if (fs.existsSync(file)) fs.copyFileSync(file, path.join(dest, name));
    }
  }
  const obsidian = path.join(vaultDir, ".obsidian");
  fs.writeFileSync(path.join(obsidian, "community-plugins.json"), JSON.stringify(PLUGIN_IDS, null, 2));
  fs.writeFileSync(path.join(obsidian, "core-plugins.json"), JSON.stringify([
    "file-explorer", "command-palette", "daily-notes", "page-preview", "editor-status", "properties",
  ], null, 2));
  fs.writeFileSync(path.join(obsidian, "daily-notes.json"), JSON.stringify({ folder: "", format: "YYYY/YYYYMMDD" }, null, 2));
  fs.writeFileSync(path.join(obsidian, "hotkeys.json"), JSON.stringify({
    "bob-navigation-hotkeys:set-bullet-property": [{ modifiers: ["Ctrl", "Shift"], key: "P" }],
    "command-palette:open": [{ modifiers: ["Ctrl"], key: "P" }],
  }));
  fs.writeFileSync(path.join(obsidian, "app.json"), JSON.stringify({
    livePreview: true, showLineNumber: false, showInlineTitle: true, propertiesInDocument: "visible",
    vimMode: true, alwaysUpdateLinks: false,
  }, null, 2));
  fs.writeFileSync(path.join(obsidian, "appearance.json"), JSON.stringify({ cssTheme: "", theme: "moonstone" }, null, 2));
}

function pluginProvenance() {
  const head = spawnSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], { encoding: "utf8" });
  const dirty = spawnSync("git", ["-C", repoRoot, "status", "--porcelain"], { encoding: "utf8" });
  const plugins = {};
  for (const id of PLUGIN_IDS) {
    const dir = path.join(repoRoot, "plugins", id);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
    plugins[id] = { version: manifest.version, files: {} };
    for (const name of ["manifest.json", "main.js", "styles.css"]) {
      const file = path.join(dir, name);
      if (fs.existsSync(file)) plugins[id].files[name] = shared.sha256File(file);
    }
  }
  return {
    head: String(head.stdout || "").trim() || null,
    dirtyPaths: String(dirty.stdout || "").split("\n").filter(Boolean),
    sourceTreeSha256: shared.hashSourceTree(repoRoot),
    plugins,
  };
}

// One DOM probe for the card, native Properties rows, block order, and the
// title block: slot placement, inline title, hidden source title lines,
// level-1 headings, the docked rail, and the ghost.
function displayProbeSource(notePath) {
  return `(() => {
    const notePath = ${JSON.stringify(notePath)};
    const leaf = app.workspace.activeLeaf?.view?.file?.path === notePath ? app.workspace.activeLeaf
      : app.workspace.getLeavesOfType("markdown").find((item) => item.view?.file?.path === notePath);
    const view = leaf?.view;
    if (!view) return { status: "missing-view" };
    const mode = view.getMode?.() || null;
    const source = Boolean(view.getState?.().source);
    const root = mode === "preview" ? view.previewMode?.containerEl : view.contentEl?.querySelector(".markdown-source-view") || view.contentEl;
    const inEmbed = (node) => Boolean(node.closest(".markdown-embed, .internal-embed, .hover-popover"));
    const visible = (node) => {
      if (!node) return { present: false };
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return { present: true, display: style.display, visibility: style.visibility, rectVisible: rect.width > 0 && rect.height > 0 };
    };
    const shown = (node) => {
      if (!node || !node.isConnected) return false;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const cards = Array.from(root?.querySelectorAll(".bob-intention-card") || []).filter((node) => !inEmbed(node));
    const embedCards = Array.from(root?.querySelectorAll(".bob-intention-card") || []).filter(inEmbed);
    const properties = Array.from(root?.querySelectorAll(".metadata-container") || []).find((node) => !inEmbed(node)) || null;
    const rows = Array.from(properties?.querySelectorAll(".metadata-property[data-property-key]") || []).map((row) => ({
      key: row.getAttribute("data-property-key"), owned: row.classList.contains("bob-property-card-owned-property"), ...visible(row),
    }));
    const embedProperties = Array.from(root?.querySelectorAll(".markdown-embed .metadata-property[data-property-key], .internal-embed .metadata-property[data-property-key]") || [])
      .map((row) => ({ key: row.getAttribute("data-property-key"), owned: row.classList.contains("bob-property-card-owned-property"), ...visible(row) }));
    const ownedAnywhere = document.querySelectorAll(".bob-property-card-owned-property").length;
    const ownsTitle = document.querySelectorAll(".bob-property-card-owns-title").length;
    const card = cards[0] || null;
    const lineSelector = mode === "preview" ? "p, li, h1, div.el-p, .task-list-item" : ".cm-line";
    const order = (needle) => {
      if (!card) return null;
      const nodes = Array.from(root.querySelectorAll(lineSelector))
        .filter((node) => !inEmbed(node) && !card.contains(node) && (node.textContent || "").includes(needle));
      const node = nodes[nodes.length - 1] || null;
      if (!node) return { found: false, needle };
      const relation = card.compareDocumentPosition(node);
      const contains = Boolean(relation & Node.DOCUMENT_POSITION_CONTAINS);
      const c = card.getBoundingClientRect();
      const n = node.getBoundingClientRect();
      // DOM order and the painted geometry must agree: no containment tricks.
      return { found: true, needle, contains, text: node.textContent.slice(0, 120),
        before: !contains && Boolean(relation & Node.DOCUMENT_POSITION_PRECEDING) && n.bottom <= c.top + 2,
        after: !contains && Boolean(relation & Node.DOCUMENT_POSITION_FOLLOWING) && n.top >= c.bottom - 2,
        cardTop: c.top, cardBottom: c.bottom, nodeTop: n.top, nodeBottom: n.bottom };
    };
    const h1 = card ? Array.from(root.querySelectorAll(mode === "preview" ? "h1" : ".cm-line.HyperMD-header-1, .HyperMD-header-1"))
      .filter((node) => !inEmbed(node) && !card.contains(node))[0] || null : null;
    // Every level-1 heading the pane paints: the card title, native H1s, and
    // Live Preview header lines. The inline title is reported on its own.
    const levelOne = Array.from(root?.querySelectorAll('[aria-level="1"], h1, .cm-line.HyperMD-header-1') || [])
      .filter((node) => !inEmbed(node) && shown(node))
      .map((node) => ({ text: (node.textContent || "").trim().slice(0, 120), card: Boolean(card && card.contains(node)) }));
    const inlineTitle = Array.from(root?.querySelectorAll(".inline-title") || []).find((node) => !inEmbed(node)) || null;
    const lineShown = (needle) => Array.from(root?.querySelectorAll(lineSelector) || [])
      .filter((node) => !inEmbed(node) && !(card && card.contains(node)) && (node.textContent || "").includes(needle) && shown(node)).length;
    const railItem = (direction) => {
      const node = card?.querySelector('.bob-property-card-rail [data-rail="' + direction + '"].bob-property-card-rail-item');
      return node ? { href: node.getAttribute("data-href"), text: node.textContent.trim(), aria: node.getAttribute("aria-label"),
        unresolved: node.classList.contains("is-unresolved"), state: node.getAttribute("data-state") } : null;
    };
    const groupRow = (() => {
      const row = card?.querySelector(".bob-property-card-rail .bob-property-card-group-row");
      return row ? {
        label: row.getAttribute("aria-label"),
        position: row.querySelector(".bob-property-card-group-position-wide")?.textContent || "",
        arms: Array.from(row.querySelectorAll(".bob-property-card-group-arm")).map((arm) => ({
          group: arm.getAttribute("data-group"), state: arm.getAttribute("data-state"), href: arm.getAttribute("href") })),
      } : null;
    })();
    const slotParent = card?.parentElement;
    return {
      status: "pass", path: notePath, mode, source,
      cardCount: cards.length, embedCardCount: embedCards.length, ownedAnywhere, ownsTitle,
      card: card ? {
        label: card.getAttribute("aria-label"), role: card.getAttribute("role"), kind: card.getAttribute("data-card-kind"),
        sourceAttr: card.getAttribute("data-intention-source"),
        kicker: (card.querySelector(".bob-property-card-kicker") || card.querySelector(".bob-intention-card-kicker"))?.textContent || "",
        title: card.querySelector(".bob-property-card-title")?.textContent || "",
        pill: card.querySelector(".bob-property-card-pill")?.textContent || "",
        subtitle: card.querySelector(".bob-property-card-subtitle")?.textContent || "",
        tile: { band: card.querySelector(".bob-property-card-tile-band")?.textContent || "", value: card.querySelector(".bob-property-card-tile-value")?.textContent || "" },
        slot: slotParent?.classList.contains("cm-sizer") ? "cm-sizer" : slotParent?.classList.contains("mod-header") ? "mod-header" : "body",
        beforeProperties: Boolean(properties && card.nextElementSibling === properties),
        rail: card.querySelector(".bob-property-card-rail") ? { prev: railItem("prev"), parent: railItem("parent"), next: railItem("next") } : null,
        groupRow,
        chips: Array.from(card.querySelectorAll(".bob-property-card-rail-chip")).map((node) => ({
          text: node.textContent.trim(), href: node.getAttribute("data-href"), current: node.classList.contains("is-current") })),
        ghost: Boolean(card.querySelector(".bob-intention-card-ghost")),
        intentionChips: Array.from(card.querySelectorAll(".bob-intention-card-chip")).map((node) => node.textContent),
        intentions: Array.from(card.querySelectorAll(".bob-intention-card-intention-body")).map((node) => node.textContent.trim()),
        parent: card.querySelector(".bob-intention-card-parent")?.textContent || "",
        summary: card.querySelector(".bob-intention-card-summary")?.textContent || "",
        reflection: card.querySelector(".bob-intention-card-reflection")?.textContent || "",
        quote: Boolean(card.querySelector(".bob-intention-card-quote")),
        missing: card.querySelector(".bob-intention-card-missing")?.textContent || "",
        text: card.textContent.slice(0, 600), rect: (() => { const r = card.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })(),
        h1Before: h1 ? Boolean(card.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_PRECEDING) : null,
      } : null,
      title: {
        inlineTitle: inlineTitle ? shown(inlineTitle) : null,
        levelOne,
        h1Shown: Array.from(root?.querySelectorAll(mode === "preview" ? "h1" : ".cm-line.HyperMD-header-1") || [])
          .filter((node) => !inEmbed(node) && shown(node)).map((node) => (node.textContent || "").trim().slice(0, 120)),
        navShown: lineShown("prev") + lineShown("‹"),
      },
      order: { nav: order("prev"), gtd: order("GTD-ANCHOR"), notes: order("Body sentinel") },
      properties: properties ? visible(properties) : { present: false }, rows, embedProperties,
    };
  })()`;
}

async function run(args) {
  const report = {
    pass: false, startedAt: new Date().toISOString(), assertions: [], screenshots: [], consoleExceptions: [],
    bobRuns: [], bobInvocations: [], prerequisites: [], probes: {}, noteSafety: {}, workflows: {},
    pluginSource: pluginProvenance(),
  };
  const outDir = path.resolve(args.out || path.join(os.tmpdir(), "bob-intention-card-e2e-shots-" + crypto.randomBytes(4).toString("hex")));
  const reportPath = path.resolve(args.report || path.join(outDir, "intention-card-report.json"));
  Object.assign(report, { reportPath, screenshotDirectory: outDir });
  let scratch = "";
  let child = null;
  let client = null;
  let successful = false;
  const check = (name, ok, detail = {}, mandatory = true) => {
    report.assertions.push({ name, status: ok ? "pass" : "fail", mandatory, detail: typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 6000) });
    return ok;
  };
  const attempt = async (name, fn) => {
    try {
      const detail = await fn();
      check(name, true, detail === undefined ? {} : detail);
    } catch (error) {
      check(name, false, { error: String(error && error.stack || error).slice(0, 3000) });
    }
  };

  try {
    fs.mkdirSync(outDir, { recursive: true });
    let bob;
    try {
      bob = shared.findBobProvenance();
      report.bob = bob;
      report.prerequisites.push({ name: "explicit-current-bob-binary", status: "pass", detail: bob });
    } catch (error) {
      report.prerequisites.push({ name: "explicit-current-bob-binary", status: "fail", detail: error.message });
      throw error;
    }
    const executable = args.executable || process.env.OBSIDIAN_BIN || ELECTRON_FALLBACK;
    report.executable = executable;
    try {
      fs.accessSync(executable, fs.constants.X_OK);
      const help = spawnSync(executable, ["--help"], { encoding: "utf8", timeout: 20_000 });
      if (/unable to find Obsidian/i.test(String(help.stdout || "") + String(help.stderr || ""))) {
        throw new Error("This is the Obsidian CLI shim, not the Electron application.");
      }
      report.prerequisites.push({ name: "Obsidian-Electron-and-Xvfb-host", status: "pass", detail: { executable, display: process.env.DISPLAY || "" } });
    } catch (error) {
      report.prerequisites.push({ name: "Obsidian-Electron-and-Xvfb-host", status: "fail", detail: error.message });
      throw error;
    }

    const today = lib.localToday();
    const { plan, notes } = lib.fixturePlan(today);
    report.testClock = { today, bobNow: today + " 12:00:00", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, runnerStartedAt: new Date().toString() };
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "bob-intention-card-e2e-"));
    const vaultDir = path.join(scratch, "vault");
    const profileDir = path.join(scratch, "profile");
    const shimDir = path.join(profileDir, "shim");
    fs.mkdirSync(vaultDir, { recursive: true });
    for (const [name, content] of Object.entries(notes)) shared.writeNote(vaultDir, name, content);
    installPlugins(vaultDir);
    writeBobShim(shimDir);
    shared.initScratchGit(vaultDir);
    const vaultReal = fs.realpathSync(vaultDir);
    shared.seedProfile(profileDir, vaultReal);
    const ctx = {
      report, bob, plan, notes, vaultDir: vaultReal, profileDir, shimDir, outDir,
      logPath: path.join(profileDir, "bob-invocations.jsonl"), oldBobFlag: path.join(profileDir, "old-bob-mode"),
      delayFlag: path.join(profileDir, "writer-delay-ms"),
    };
    report.scratch = { root: scratch, vault: vaultReal, profile: profileDir, fixturePaths: Object.keys(notes).sort(), plan };

    // Real bob reads every seeded subject before the UI starts.
    const seeded = {};
    for (const key of ["today", "yesterday", "stamped", "empty", "landing", "week", "quarter", "boundaryDay"]) {
      const fields = readFields(ctx, plan.paths[key]);
      seeded[key] = { id: fields.subject.id, path: fields.subject.path, fingerprint: fields.fingerprint_before, after: fields.after };
    }
    if (seeded.stamped.after.summary_state !== "drafted") throw new Error("stamped fixture is not agent-owned for bob: " + JSON.stringify(seeded.stamped));
    report.prerequisites.push({ name: "real-bob-periods-update-reads", status: "pass", detail: seeded });
    ctx.seeded = seeded;
    report.noteSafety.seeded = Object.fromEntries(Object.keys(notes).sort().map((name) => [name, sha256Text(notes[name])]));

    const port = await shared.freePort();
    child = spawn(executable, [
      "--no-sandbox", "--user-data-dir=" + profileDir, "--remote-debugging-port=" + port,
      "--remote-allow-origins=http://127.0.0.1/*", vaultReal,
    ], { cwd: os.tmpdir(), env: { ...bobEnv(ctx), TMPDIR: "/tmp" }, stdio: ["ignore", "ignore", "pipe"] });
    const childErrors = [];
    child.stderr.on("data", (chunk) => childErrors.push(String(chunk).slice(0, 1000)));
    report.obsidianProcess = { pid: child.pid, executable, debugPort: port };
    const target = await shared.selectTarget(port, vaultReal, () => child && child.exitCode == null);
    client = target.client;
    ctx.client = client;
    client.on("Runtime.exceptionThrown", (params) => {
      const details = params.exceptionDetails || {};
      report.consoleExceptions.push({ text: details.text || "", description: details.exception?.description || "", url: details.url || "", lineNumber: details.lineNumber || null });
    });
    report.consoleErrors = [];
    client.on("Runtime.consoleAPICalled", (params) => {
      if (params.type !== "error") return;
      report.consoleErrors.push((params.args || []).map((arg) => arg.value ?? arg.description ?? "").join(" ").slice(0, 2000));
    });
    await client.call("Runtime.enable");
    await client.call("Log.enable");
    client.on("Log.entryAdded", (params) => {
      if (params.entry?.level === "error") report.consoleExceptions.push({ text: params.entry.text || "", url: params.entry.url || "", source: "console" });
    });
    report.pluginStartup = { trustAction: await shared.trustCommunityPlugins(client) };
    await waitFor(client, `(${JSON.stringify(PLUGIN_IDS)}).every((id) => Boolean(app.plugins.plugins[id]))`, Boolean, "Bob plugins startup", 45_000);
    report.app = await client.evaluate("({ version: app.version || '', enabled: Array.from(app.plugins.enabledPlugins || []), manifests: Object.fromEntries(Object.entries(app.plugins.manifests).filter(([id]) => id.startsWith('bob-')).map(([id, m]) => [id, m.version])) })");
    check("plugins-loaded", PLUGIN_IDS.every((id) => report.app.enabled.includes(id)), report.app);
    const pluginToday = await client.evaluate("app.plugins.plugins['bob-ledger-tools'].intentionCardToday()");
    report.testClock.pluginToday = pluginToday;
    check("test-clock-agrees", pluginToday === today, report.testClock);
    // Mirror the vault vimrc's `nnoremap [n :bob_prev_link<CR>` (exmap obcommand).
    report.vimMapping = await client.evaluate(`(() => {
      const Vim = window.CodeMirrorAdapter?.Vim;
      if (!Vim) return { ok: false };
      Vim.defineEx("bobprevlink", "", () => app.commands.executeCommandById("bob-navigation-hotkeys:open-prev-link"));
      (Vim.noremap || Vim.map).call(Vim, "[n", ":bobprevlink<CR>", "normal");
      return { ok: true, mapping: "[n -> bob-navigation-hotkeys:open-prev-link" };
    })()`);
    if (!report.vimMapping?.ok) throw new Error("CodeMirror Vim adapter unavailable for the [n mapping");
    childErrors.length = 0;
    await shared.collapseSidebars(client);
    await shared.setViewport(client, 1400, 1000);

    const helpers = makeHelpers(ctx);
    Object.assign(ctx, helpers, { check, attempt, sleep, waitFor, runBob: (a, i) => runBob(ctx, a, i), readFields: (s) => readFields(ctx, s) });
    await displayPhase(ctx);
    await workflows.runWorkflows(ctx);

    const endToday = await client.evaluate("app.plugins.plugins['bob-ledger-tools'].intentionCardToday()");
    report.testClock.pluginTodayAtEnd = endToday;
    if (endToday !== today) check("test-clock-agrees-at-end", false, report.testClock);
    check("screenshots-captured", report.screenshots.length >= 52, { count: report.screenshots.length });
    check("no-console-exceptions", report.consoleExceptions.length === 0, report.consoleExceptions);
    report.bobInvocations = readInvocations(ctx.logPath);
  } catch (error) {
    report.error = error && error.stack ? error.stack : String(error);
    if (client) {
      try { report.screenshots.push(await capture(client, outDir, "intention-card-runner-failure", 1400, "light", "failure state")); }
      catch (screenshotError) { report.screenshotError = String(screenshotError && screenshotError.message || screenshotError); }
    }
    check("runner-error", false, String(error && error.message || error));
  } finally {
    for (const name of REQUIRED_CHECKS) {
      const rows = report.assertions.filter((row) => row.name === name);
      if (!rows.length) check(name, false, "Required check was not executed");
    }
    report.pass = report.assertions.filter((row) => row.mandatory).every((row) => row.status === "pass")
      && report.prerequisites.every((row) => row.status === "pass");
    successful = report.pass;
    if (client) client.close();
    if (child && child.exitCode == null) {
      try { child.kill("SIGTERM"); } catch (_) {}
      await sleep(400);
      if (child.exitCode == null) { try { child.kill("SIGKILL"); } catch (_) {} }
    }
    if (scratch && fs.existsSync(path.join(scratch, "profile", "bob-invocations.jsonl")) && !report.bobInvocations.length) {
      report.bobInvocations = readInvocations(path.join(scratch, "profile", "bob-invocations.jsonl"));
    }
    report.finishedAt = new Date().toISOString();
    report.scratchPreserved = Boolean(scratch && !successful && fs.existsSync(scratch));
    if (successful && scratch) fs.rmSync(scratch, { recursive: true, force: true });
    report.assertionCounts = report.assertions.reduce((counts, item) => { counts[item.status] = (counts[item.status] || 0) + 1; return counts; }, {});
    report.failedChecks = report.assertions.filter((row) => row.status === "fail").map((row) => row.name);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  }
  process.stdout.write((report.pass ? "PASS" : "FAIL") + " intention card e2e (" + JSON.stringify(report.assertionCounts) + ")\n");
  process.stdout.write("Report: " + reportPath + "\nScreenshots: " + outDir + "\n");
  if (!report.pass) {
    for (const row of report.assertions.filter((item) => item.status === "fail")) process.stderr.write("- " + row.name + ": " + row.detail.slice(0, 1500) + "\n");
    process.exitCode = 1;
  }
}

function readInvocations(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => {
    const entry = JSON.parse(line);
    if (typeof entry.stdout === "string" && entry.stdout.length > 4000) entry.stdout = entry.stdout.slice(0, 4000) + "…";
    return entry;
  });
}

function snapshot(root) {
  const result = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if ([".git", ".obsidian"].includes(entry.name)) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && entry.name.endsWith(".md")) result[path.relative(root, file).split(path.sep).join("/")] = fs.readFileSync(file, "utf8");
    }
  };
  walk(root);
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

function makeHelpers(ctx) {
  const { client, report, outDir } = ctx;
  const key = async (name, modifiers = 0) => {
    for (const event of lib.keyEvents(name, modifiers)) await client.call("Input.dispatchKeyEvent", event);
  };
  const keys = async (sequence, delay = 0) => {
    for (const name of sequence) { await key(name); if (delay) await sleep(delay); }
  };
  const open = async (notePath, mode = "live") => {
    const state = mode === "reading" ? { mode: "preview", source: false } : mode === "source" ? { mode: "source", source: true } : { mode: "source", source: false };
    // Always open into a root-split leaf and make it active with focus, so
    // keyboard input reaches that note (never a collapsed sidebar leaf).
    const opened = await client.evaluate(`(async () => {
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(notePath)});
      if (!file) return { ok: false, error: "missing file" };
      const active = app.workspace.activeLeaf;
      const leaf = active && active.getRoot?.() === app.workspace.rootSplit ? active : app.workspace.getLeaf(false);
      await leaf.openFile(file, { state: ${JSON.stringify(state)}, active: true });
      if (leaf.view?.setState) await leaf.view.setState(Object.assign({}, leaf.view.getState?.() || {}, ${JSON.stringify(state)}), { history: false });
      app.workspace.setActiveLeaf(leaf, { focus: true });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await new Promise((resolve) => setTimeout(resolve, 450));
      return { ok: leaf.view?.file?.path === ${JSON.stringify(notePath)}, path: leaf.view?.file?.path || null, mode: leaf.view?.getMode?.() || null,
        active: app.workspace.activeLeaf === leaf, root: leaf.getRoot?.() === app.workspace.rootSplit };
    })()`, 30_000);
    if (!opened.ok) throw new Error("Could not open " + notePath + ": " + JSON.stringify(opened) + " console: " + JSON.stringify((report.consoleErrors || []).slice(-3)));
    if (mode !== "source") await expandProperties(notePath);
    return opened;
  };
  const expandProperties = async (notePath) => client.evaluate(`(() => {
    const leaf = app.workspace.getLeavesOfType("markdown").find((item) => item.view?.file?.path === ${JSON.stringify(notePath)});
    const view = leaf?.view;
    const root = view?.getMode?.() === "preview" ? view.previewMode?.containerEl : view?.contentEl;
    const properties = Array.from(root?.querySelectorAll(".metadata-container") || []).find((node) => !node.closest(".markdown-embed, .internal-embed"));
    if (properties?.classList.contains("is-collapsed")) properties.querySelector(".metadata-properties-heading")?.click();
    return Boolean(properties);
  })()`);
  const probe = (notePath) => client.evaluate(displayProbeSource(notePath));
  const waitCard = (notePath, predicate = (value) => value?.cardCount === 1, label = "intention card on " + notePath) =>
    waitFor(client, displayProbeSource(notePath), predicate, label, 25_000);
  const waitNoCard = (notePath, label = "no intention card on " + notePath) =>
    waitFor(client, displayProbeSource(notePath), (value) => value?.status === "pass" && value.cardCount === 0, label, 25_000);
  const shot = async (name, mode, options = {}) => {
    const width = options.width || 1400;
    const theme = options.theme || "light";
    const row = await capture(client, outDir, name, width, theme, mode);
    report.screenshots.push(row);
    return row;
  };
  const vault = () => snapshot(ctx.vaultDir);
  const invocations = () => readInvocations(ctx.logPath);
  const writerApplies = (since = 0) => invocations().slice(since).filter((entry) => entry.event === "start"
    && entry.args?.[0] === "periods" && entry.args[1] === "update" && !entry.args.includes("-n"));
  const placeCursor = async (needle, notePath) => client.evaluate(`(() => {
    const view = app.workspace.activeLeaf?.view;
    if (!view?.editor || view.file?.path !== ${JSON.stringify(notePath)}) return { ok: false, path: view?.file?.path || null };
    const lines = view.editor.getValue().split("\\n");
    const line = lines.findIndex((text) => text.includes(${JSON.stringify(needle)}));
    if (line < 0) return { ok: false, reason: "needle missing" };
    view.editor.setCursor({ line, ch: 0 });
    view.editor.focus();
    return { ok: true, line };
  })()`);
  const placeCursorBlankAfter = async (needle, notePath) => client.evaluate(`(() => {
    const view = app.workspace.activeLeaf?.view;
    if (!view?.editor || view.file?.path !== ${JSON.stringify(notePath)}) return { ok: false, path: view?.file?.path || null };
    const lines = view.editor.getValue().split("\\n");
    const line = lines.findIndex((text) => text.includes(${JSON.stringify(needle)}));
    const blankLine = line + 1;
    if (line < 0 || lines[blankLine] !== "") return { ok: false, line, blankLine, next: lines[blankLine] || null };
    view.editor.focus();
    view.editor.setCursor({ line: blankLine, ch: 0 });
    return { ok: true, line, blankLine };
  })()`);
  // A real mouse click (CDP) at the center of the first matching node in the
  // note's own pane, never inside an embed.
  const clickIn = async (notePath, selector) => {
    const box = await client.evaluate(`(() => {
      const leaf = app.workspace.getLeavesOfType("markdown").find((item) => item.view?.file?.path === ${JSON.stringify(notePath)});
      const view = leaf?.view;
      const root = view?.getMode?.() === "preview" ? view.previewMode?.containerEl : view?.contentEl;
      const node = Array.from(root?.querySelectorAll(${JSON.stringify(selector)}) || []).find((item) => !item.closest(".markdown-embed, .internal-embed"));
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height };
    })()`);
    if (!box || !(box.width > 0)) throw new Error("nothing to click for " + selector + " on " + notePath);
    await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
    await client.call("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
    await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 });
    return box;
  };
  return { key, keys, open, probe, waitCard, waitNoCard, shot, vault, invocations, writerApplies,
    placeCursor, placeCursorBlankAfter, expandProperties, clickIn };
}

async function displayPhase(ctx) {
  const { plan, attempt, open, probe, waitCard, waitNoCard, shot, client, vault, placeCursor,
    placeCursorBlankAfter, clickIn, sleep, waitFor } = ctx;
  const passive = vault();
  const authored = (name) => Object.keys(Object.fromEntries(lib.frontmatterBlocks(ctx.notes[name]))).filter(Boolean);
  const linkOf = (notePath) => notePath.replace(/\.md$/, "");
  const weekLink = (date) => { const id = lib.weekId(date); return id.slice(0, 4) + "/" + id; };
  const dayRail = (date) => ({
    prev: linkOf(lib.dayPath(lib.shiftDays(date, -1))), parent: weekLink(date), next: linkOf(lib.dayPath(lib.shiftDays(date, 1))),
  });
  const slotOf = (mode) => (mode === "reading" ? "mod-header" : "cm-sizer");
  // The card is the title block: in the title slot right before Properties,
  // the inline title, recognized H1, and nav line hidden, and exactly one
  // visible level-1 heading in the pane (the card title).
  const assertTitleSlot = (state, { mode, title, rail = null, hidesSource = true }) => {
    if (!state.card) throw new Error("card absent");
    if (state.card.slot !== slotOf(mode)) throw new Error("card is not in the title slot: " + JSON.stringify(state.card.slot));
    if (state.properties.present && !state.card.beforeProperties) throw new Error("card is not right before Properties");
    if (state.title.inlineTitle !== false) throw new Error("inline title is visible: " + JSON.stringify(state.title));
    if (hidesSource && state.title.h1Shown.length) throw new Error("source H1 is visible: " + JSON.stringify(state.title.h1Shown));
    if (hidesSource && state.title.navShown) throw new Error("nav line is visible: " + state.title.navShown);
    const level = state.title.levelOne;
    if (level.length !== 1 || !level[0].card || level[0].text !== title) throw new Error("level-1 headings: " + JSON.stringify(level));
    if (state.card.title !== title) throw new Error("card title: " + state.card.title);
    if (rail) {
      for (const direction of ["prev", "parent", "next"]) {
        if (state.card.rail?.[direction]?.href !== rail[direction]) throw new Error("rail " + direction + ": " + JSON.stringify(state.card.rail));
      }
    }
    if (state.order.notes?.found && !state.order.notes.after) throw new Error("card is not above the body: " + JSON.stringify(state.order));
    return { slot: state.card.slot, levelOne: level, rail: state.card.rail, order: state.order };
  };
  // Native rendering is back: inline title and source H1 visible, no owner.
  const assertNative = (state, label) => {
    if (state.ownsTitle !== 0) throw new Error(label + ": a title owner remains: " + state.ownsTitle);
    if (state.title.inlineTitle === false) throw new Error(label + ": the inline title is hidden");
    if (!state.title.h1Shown.length) throw new Error(label + ": the source H1 is hidden");
    return { inlineTitle: state.title.inlineTitle, h1: state.title.h1Shown };
  };
  const assertRows = (state, notePath, hidden) => {
    const hiddenKeys = lib.assertOwnedRows(state, { hidden, authoredKeys: authored(notePath) });
    return { hiddenKeys, rows: state.rows };
  };
  const mounted = (mode) => (value) => value?.cardCount === 1 && value.card?.slot === slotOf(mode)
    && value.title?.inlineTitle === false && value.title?.levelOne?.length === 1;
  const todayTitle = lib.dayCardTitle(plan.today);
  const todayRail = dayRail(plan.today);
  const week = lib.weekId(plan.today);

  // Live Preview: today mounts once, as the title block in the title slot.
  await open(plan.paths.today, "live");
  let state = await waitCard(plan.paths.today, mounted("live"));
  ctx.report.probes.liveToday = state;
  await attempt("display-live-today-mounts-once", () => {
    if (state.cardCount !== 1 || state.embedCardCount !== 0) throw new Error(JSON.stringify(state));
    if (state.card.role !== "group" || state.card.label !== "Day: " + todayTitle || state.card.kind !== "day") {
      throw new Error("card is not a labelled day group: " + JSON.stringify(state.card));
    }
    if (state.card.kicker !== "Day·" + week.slice(5) + "·" + week.slice(0, 4)) throw new Error("kicker: " + state.card.kicker);
    if (state.card.pill !== "TODAY") throw new Error("pill: " + state.card.pill);
    if (JSON.stringify(state.card.intentions) !== JSON.stringify(plan.intentions.today)) throw new Error("intentions mismatch " + JSON.stringify(state.card));
    if (!state.card.intentionChips[0]?.includes("①")) throw new Error("numbered chip missing: " + JSON.stringify(state.card.intentionChips));
    if (state.card.ghost) throw new Error("a day with intentions shows the ghost");
    return state.card;
  });
  await attempt("display-live-today-placement", () => {
    const result = assertTitleSlot(state, { mode: "live", title: todayTitle, rail: todayRail });
    if (state.card.rail.next.unresolved !== true) throw new Error("the missing next day does not look unresolved");
    return result;
  });
  await attempt("display-live-today-owned-rows", () => {
    const result = assertRows(state, plan.paths.today, true);
    if (JSON.stringify(result.hiddenKeys) !== JSON.stringify(["intentions"])) throw new Error("hidden rows: " + JSON.stringify(result.hiddenKeys));
    return result;
  });
  await attempt("display-live-today-parent-line", async () => {
    state = await waitCard(plan.paths.today, (value) => value?.cardCount === 1 && /Land the card epic/.test(value.card?.parent || ""), "parent intentions line");
    return state.card.parent;
  });
  await shot("intention-card-live-today-light", "Live Preview");

  // Reading view: the same title block in .mod-header, same ownership.
  await open(plan.paths.today, "reading");
  state = await waitCard(plan.paths.today, (value) => mounted("reading")(value) && value.mode === "preview");
  ctx.report.probes.readingToday = state;
  await attempt("display-reading-today-mounts-once", () => { if (state.cardCount !== 1) throw new Error(JSON.stringify(state)); return state.card; });
  await attempt("display-reading-today-placement", () => assertTitleSlot(state, { mode: "reading", title: todayTitle, rail: todayRail }));
  await attempt("display-reading-today-owned-rows", () => {
    const result = assertRows(state, plan.paths.today, true);
    if (JSON.stringify(result.hiddenKeys) !== JSON.stringify(["intentions"])) throw new Error("hidden rows: " + JSON.stringify(result.hiddenKeys));
    return result;
  });
  await shot("intention-card-reading-today-light", "Reading");

  // All seven owned keys hide on the stamped day; unrelated keys stay.
  const sevenCheck = async (mode, name) => {
    await open(plan.paths.stamped, mode);
    const value = await waitCard(plan.paths.stamped, (item) => item?.cardCount === 1 && item.rows.filter((row) => row.owned).length === 7);
    ctx.report.probes[name] = value;
    await attempt(name, () => {
      const result = assertRows(value, plan.paths.stamped, true);
      if (JSON.stringify(result.hiddenKeys) !== JSON.stringify([...lib.OWNED_KEYS].sort())) throw new Error("hidden rows: " + JSON.stringify(result.hiddenKeys));
      return result;
    });
    return value;
  };
  state = await sevenCheck("reading", "display-seven-owned-keys-reading");
  await attempt("display-agent-summary-provenance", () => {
    const expected = "✦ agent · " + lib.monthDayLabel(plan.stampedDrafted);
    if (!state.card.summary.includes(expected) || !state.card.summary.includes(plan.stampedSummary)) throw new Error("summary band: " + state.card.summary);
    return state.card.summary;
  });
  await attempt("display-reflection-quote", () => {
    if (!state.card.quote || !/landed cleanly/.test(state.card.reflection) || !/two passes/.test(state.card.reflection)) throw new Error(JSON.stringify(state.card));
    return state.card.reflection;
  });
  await shot("intention-card-reading-stamped-light", "Reading");
  for (const theme of ["dark", "light"]) {
    await shared.setTheme(client, theme);
    if (theme === "dark") await shot("intention-card-reading-stamped-dark", "Reading", { theme });
  }
  await sevenCheck("live", "display-seven-owned-keys-live");
  await shot("intention-card-live-stamped-light", "Live Preview");
  await shared.setTheme(client, "dark");
  await shot("intention-card-live-stamped-dark", "Live Preview", { theme: "dark" });
  await shared.setViewport(client, 375, 900);
  await shot("intention-card-live-stamped-dark-375", "Live Preview", { theme: "dark", width: 375 });
  await shared.setTheme(client, "light");
  await shot("intention-card-live-stamped-light-375", "Live Preview", { width: 375 });
  await shared.setViewport(client, 1400, 1000);

  // Recently closed yesterday shows the quiet missing band.
  await open(plan.paths.yesterday, "live");
  state = await waitCard(plan.paths.yesterday);
  await attempt("display-recent-closed-missing-band", () => {
    if (!/✦ summary pending/.test(state.card.missing) || !/＋ reflection r/.test(state.card.missing)) throw new Error("missing band: " + JSON.stringify(state.card));
    if (state.card.pill !== "YESTERDAY") throw new Error("pill: " + state.card.pill);
    return state.card.missing;
  });
  await shot("intention-card-live-yesterday-missing-band", "Live Preview");
  await shared.setTheme(client, "dark");
  await shot("intention-card-live-yesterday-missing-band-dark", "Live Preview", { theme: "dark" });
  await shared.setTheme(client, "light");

  // Source mode fails open: no card, no owned rows, native title rendering.
  await open(plan.paths.today, "source");
  await attempt("display-source-fails-open", async () => {
    const value = await waitNoCard(plan.paths.today);
    if (value.ownedAnywhere !== 0 || value.source !== true) throw new Error(JSON.stringify(value));
    const native = assertNative(value, "Source");
    return { source: value.source, ownedAnywhere: value.ownedAnywhere, native };
  });
  await attempt("display-mode-change-restores", async () => {
    await open(plan.paths.today, "reading");
    const reading = await waitCard(plan.paths.today, (value) => mounted("reading")(value) && value.mode === "preview");
    await open(plan.paths.today, "source");
    const source = await waitNoCard(plan.paths.today);
    assertNative(source, "Source after Reading");
    await open(plan.paths.today, "live");
    const live = await waitCard(plan.paths.today, mounted("live"));
    assertRows(live, plan.paths.today, true);
    assertTitleSlot(live, { mode: "live", title: todayTitle, rail: todayRail });
    if (source.ownedAnywhere !== 0) throw new Error("Source kept owned rows: " + source.ownedAnywhere);
    return { reading: reading.cardCount, source: source.cardCount, live: live.cardCount };
  });

  // An empty note gets the identity-only card: title and rail, every
  // Properties row visible, nothing owned, and no ghost on a past day.
  await attempt("display-empty-identity-card", async () => {
    const results = {};
    for (const mode of ["live", "reading"]) {
      await open(plan.paths.empty, mode);
      const value = await waitCard(plan.paths.empty, mounted(mode));
      assertTitleSlot(value, { mode, title: lib.dayCardTitle(plan.empty), rail: dayRail(plan.empty) });
      assertRows(value, plan.paths.empty, false);
      if (value.ownedAnywhere !== 0) throw new Error("owned rows on an empty note: " + value.ownedAnywhere);
      if (value.card.ghost) throw new Error("a past empty day shows the ghost");
      if (value.card.intentions.length || value.card.summary || value.card.reflection) throw new Error("bands on an empty note: " + JSON.stringify(value.card));
      results[mode] = { rows: value.rows.length, title: value.card.title };
    }
    return results;
  });
  // Malformed fields fail open: no card, native Properties and title.
  await attempt("display-malformed-fails-open", async () => {
    const results = {};
    for (const mode of ["live", "reading"]) {
      await open(plan.paths.malformed, mode);
      await sleep(600);
      const value = await waitNoCard(plan.paths.malformed);
      assertRows(value, plan.paths.malformed, false);
      if (value.ownedAnywhere !== 0) throw new Error("owned rows remain: " + value.ownedAnywhere);
      results[mode] = { rows: value.rows.length, native: assertNative(value, "malformed " + mode) };
    }
    return results;
  });
  await shot("intention-card-malformed-fails-open", "Reading");

  // Embeds never host the card or own a title.
  await attempt("display-embed-fails-open", async () => {
    const results = {};
    for (const mode of ["reading", "live"]) {
      await open(plan.paths.embed, mode);
      await sleep(900);
      const value = await probe(plan.paths.embed);
      if (value.cardCount !== 0 || value.embedCardCount !== 0) throw new Error("card inside embed: " + JSON.stringify(value));
      // Obsidian folds an embed's Properties itself; the card must never own them.
      if (value.embedProperties.some((row) => row.owned) || value.ownedAnywhere !== 0) throw new Error("embed properties owned: " + JSON.stringify(value.embedProperties));
      if (value.ownsTitle !== 0) throw new Error("an embed owns a title: " + value.ownsTitle);
      results[mode] = { embedProperties: value.embedProperties.length };
    }
    return results;
  });
  await shot("intention-card-embed-fails-open", "Live Preview");

  // Leaving the note releases ownership; recovery after failure repaints.
  await attempt("display-unmount-restores", async () => {
    await open(plan.paths.today, "live");
    await waitCard(plan.paths.today, mounted("live"));
    await open(plan.paths.ordinary, "live");
    await sleep(500);
    const counts = await client.evaluate("({ owned: document.querySelectorAll('.bob-property-card-owned-property').length, cards: document.querySelectorAll('.bob-intention-card').length, owns: document.querySelectorAll('.bob-property-card-owns-title').length, sources: document.querySelectorAll('.bob-property-card-title-source').length })");
    if (counts.owned !== 0 || counts.cards !== 0 || counts.owns !== 0 || counts.sources !== 0) throw new Error(JSON.stringify(counts));
    const value = await probe(plan.paths.ordinary);
    if (value.title.inlineTitle !== true) throw new Error("the ordinary note's inline title is hidden");
    return counts;
  });
  await attempt("display-failure-restores-and-recovers", async () => {
    await open(plan.paths.today, "live");
    await waitCard(plan.paths.today, mounted("live"));
    const original = ctx.notes[plan.paths.today];
    const broken = original.replace('intentions:\n  - "Ship the intention card"\n  - "Walk after lunch"\n', "intentions: 7\n");
    if (broken === original) throw new Error("could not build malformed variant");
    await client.evaluate(`app.vault.modify(app.vault.getAbstractFileByPath(${JSON.stringify(plan.paths.today)}), ${JSON.stringify(broken)})`);
    const failed = await waitNoCard(plan.paths.today, "card removal after malformed metadata");
    assertRows(failed, plan.paths.today, false);
    const native = assertNative(failed, "malformed today");
    await client.evaluate(`app.vault.modify(app.vault.getAbstractFileByPath(${JSON.stringify(plan.paths.today)}), ${JSON.stringify(original)})`);
    const recovered = await waitCard(plan.paths.today, (value) => mounted("live")(value) && value.rows.some((row) => row.key === "intentions" && row.owned));
    assertRows(recovered, plan.paths.today, true);
    assertTitleSlot(recovered, { mode: "live", title: todayTitle, rail: todayRail });
    const disk = fs.readFileSync(path.join(ctx.vaultDir, plan.paths.today), "utf8");
    if (disk !== original) throw new Error("recovery did not restore exact bytes");
    return { failedRows: failed.rows.length, native, recoveredOwned: recovered.rows.filter((row) => row.owned).map((row) => row.key) };
  });
  await attempt("display-plugin-disable-restores", async () => {
    await client.evaluate("app.plugins.disablePlugin('bob-ledger-tools')");
    await waitFor(client, "!app.plugins.plugins['bob-ledger-tools']", Boolean, "ledger-tools disabled");
    const off = await waitNoCard(plan.paths.today);
    assertRows(off, plan.paths.today, false);
    const native = assertNative(off, "plugin disabled");
    const leftovers = await client.evaluate("({ slots: document.querySelectorAll('.bob-property-card-title-slot').length, sources: document.querySelectorAll('.bob-property-card-title-source').length })");
    if (leftovers.slots !== 0 || leftovers.sources !== 0) throw new Error("disable left title-block DOM: " + JSON.stringify(leftovers));
    await client.evaluate("app.plugins.enablePlugin('bob-ledger-tools')");
    await waitFor(client, "Boolean(app.plugins.plugins['bob-ledger-tools'])", Boolean, "ledger-tools enabled", 30_000);
    await open(plan.paths.today, "live");
    const on = await waitCard(plan.paths.today, (value) => mounted("live")(value) && value.rows.some((row) => row.owned));
    assertRows(on, plan.paths.today, true);
    return { offOwned: off.ownedAnywhere, native, onCards: on.cardCount };
  });
  await attempt("display-passive-bytes-neutral", () => {
    const now = vault();
    if (JSON.stringify(now) !== JSON.stringify(passive)) throw new Error("passive display changed Markdown bytes");
    return { files: Object.keys(now).length };
  });

  // Placing the cursor on a consumed blank reveals the raw Markdown; the
  // first body task stays outside the range and keeps the title hidden.
  await attempt("display-reveal-on-cursor", async () => {
    await open(plan.paths.today, "live");
    const initial = await waitCard(plan.paths.today, (value) => mounted("live")(value) && value.title.h1Shown.length === 0);
    const hiddenGap = initial.order.gtd?.nodeTop - initial.order.gtd?.cardBottom;
    const onBlank = await placeCursorBlankAfter("|prev]]", plan.paths.today);
    if (!onBlank.ok) throw new Error("could not place the cursor on a consumed blank: " + JSON.stringify(onBlank));
    const revealed = await waitFor(client, displayProbeSource(plan.paths.today),
      (value) => value?.cardCount === 1 && value.title.h1Shown.length === 1 && value.title.navShown > 0, "raw H1 and nav revealed", 10_000);
    const revealedGap = revealed.order.gtd?.nodeTop - revealed.order.gtd?.cardBottom;
    const bodyStaysVisible = revealed.order.gtd?.found === true && revealed.order.gtd?.after === true;
    const blankExpanded = Number.isFinite(hiddenGap) && Number.isFinite(revealedGap) && revealedGap - hiddenGap > 8;
    await shot("intention-card-live-reveal", "Live Preview");
    const away = await placeCursor("GTD-ANCHOR", plan.paths.today);
    if (!away.ok) throw new Error("could not move the cursor to ^gtd: " + JSON.stringify(away));
    const afterBody = await waitFor(client, displayProbeSource(plan.paths.today),
      (value) => value?.cardCount === 1 && value.title.h1Shown.length === 0 && value.title.navShown === 0, "title lines hidden again at the next body line", 10_000);
    const cardRetainedOnReveal = Boolean(revealed.cardCount === 1 && revealed.card?.rail);
    const bodySelectionKeepsTitleHidden = afterBody.title.h1Shown.length === 0 && afterBody.title.navShown === 0;
    if (!blankExpanded || !bodyStaysVisible || !cardRetainedOnReveal || !bodySelectionKeepsTitleHidden) {
      throw new Error(JSON.stringify({ blank: onBlank, hiddenGap, revealedGap, blankExpanded, bodyStaysVisible,
        cardRetainedOnReveal, bodySelectionKeepsTitleHidden }));
    }
    return { blank: onBlank, hiddenGap, revealedGap, blankExpanded, bodyStaysVisible,
      cardRetainedOnReveal, bodySelectionKeepsTitleHidden,
      revealed: revealed.title, hidden: afterBody.title };
  });

  // The set-intentions ghost opens the editor on the intention stage. All
  // four editor headers use the shared identity badge and keep their temporal
  // accent across themes and a narrow viewport.
  await attempt("display-ghost-opens-editor", async () => {
    await open(plan.paths.future, "live");
    const value = await waitCard(plan.paths.future, (item) => mounted("live")(item) && item.card?.ghost === true);
    if (value.ownedAnywhere !== 0) throw new Error("the ghost owns Properties rows");
    await shot("intention-card-live-future-ghost", "Live Preview");
    const before = vault();
    await clickIn(plan.paths.future, ".bob-intention-card .bob-intention-card-ghost");
    const modal = await waitFor(client, workflows.MODAL, (item) => item && item.path === plan.paths.future
      && item.stage === "intention" && item.stageField === "add", "card editor on the intention stage", 15_000);
    await shot("intention-card-ghost-editor", "Card editor");

    const futureDate = new Date(`${plan.future}T00:00:00Z`);
    const cases = [
      { path: plan.paths.future, kind: "day", word: "Day",
        band: new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(futureDate).toUpperCase(),
        value: String(Number(plan.future.slice(8))), name: "day", current: modal },
      { path: plan.paths.week, kind: "week", word: "Week", band: "WEEK", value: plan.week.slice(6), name: "week" },
      { path: plan.paths.quarter, kind: "quarter", word: "Quarter", band: "QTR", value: plan.quarter.slice(-2), name: "quarter" },
      { path: plan.paths.year, kind: "year", word: "Year", band: "YEAR", value: plan.year, name: "year" },
    ];
    const headers = [];
    for (const expected of cases) {
      if (!expected.current) {
        // openIntentionCard resolves with the live modal, which CDP cannot
        // return by value; return only the serializable outcome.
        const opened = await client.evaluate(`(async () => {
          const result = await app.plugins.plugins['bob-ledger-tools'].openIntentionCard({ filePath: ${JSON.stringify(expected.path)} });
          return { ok: result?.ok === true, reason: result?.reason || null };
        })()`);
        if (!opened?.ok) throw new Error(`${expected.name} editor did not open: ` + JSON.stringify(opened));
      }
      const current = expected.current || await waitFor(client, workflows.MODAL,
        (item) => item && item.path === expected.path, `${expected.name} editor opened`, 15_000);
      const header = await client.evaluate(`(() => {
        const content = app.plugins.plugins['bob-ledger-tools'].intentionCardEditorModal?.contentEl;
        const rows = Array.from(content?.querySelectorAll('.bob-intention-editor-identity') || []);
        const row = rows[0];
        const badges = Array.from(row?.querySelectorAll('.bob-property-card-identity') || []);
        const badge = badges[0];
        const word = badge?.querySelector('.bob-property-card-identity-word');
        const rowStyle = row ? getComputedStyle(row) : null;
        const badgeStyle = badge ? getComputedStyle(badge) : null;
        return row ? {
          kind: row.getAttribute('data-card-kind'), rowCount: rows.length,
          badgeKind: badge?.getAttribute('data-card-kind') || '', badgeCount: badges.length,
          word: word?.textContent || '', band: badge?.querySelector('.bob-property-card-tile-band')?.textContent || '',
          value: badge?.querySelector('.bob-property-card-tile-value')?.textContent || '',
          legacySpeciesWords: row.querySelectorAll('.bob-property-card-kicker-species').length,
          levelOneCount: content.querySelectorAll('h1, [aria-level="1"]').length,
          title: content.querySelector('.bob-intention-editor-title')?.textContent || '',
          fields: Boolean(content.querySelector('[role="listbox"]')),
          dayAccent: rowStyle.getPropertyValue('--bob-day-accent').trim(),
          cardAccent: rowStyle.getPropertyValue('--bob-property-card-accent').trim(),
          badgeAccent: badgeStyle.getPropertyValue('--bob-property-card-identity-accent').trim(),
        } : null;
      })()`);
      if (!header || header.kind !== expected.kind || header.badgeKind !== expected.kind
        || header.word !== expected.word || header.band !== expected.band || header.value !== expected.value
        || header.rowCount !== 1 || header.badgeCount !== 1 || header.legacySpeciesWords !== 0
        || header.levelOneCount !== 0 || !header.title || !header.fields
        || !header.dayAccent || header.cardAccent !== header.dayAccent || header.badgeAccent !== header.dayAccent) {
        throw new Error(`${expected.name} editor identity: ` + JSON.stringify({ expected, header }));
      }
      await shared.setTheme(client, "light");
      await shared.setViewport(client, 1400, 1000);
      await shot(`intention-card-editor-${expected.name}-light`, "Card editor", { theme: "light" });
      await shared.setTheme(client, "dark");
      await shot(`intention-card-editor-${expected.name}-dark`, "Card editor", { theme: "dark" });
      await shared.setViewport(client, 375, 900);
      await shot(`intention-card-editor-${expected.name}-dark-375`, "Card editor", { theme: "dark", width: 375 });
      await shared.setViewport(client, 1400, 1000);
      await shared.setTheme(client, "light");
      headers.push({ kind: expected.kind, word: header.word, band: header.band, value: header.value,
        rowCount: header.rowCount, badgeCount: header.badgeCount, levelOneCount: header.levelOneCount,
        temporalAccent: header.dayAccent });
      await client.evaluate("app.plugins.plugins['bob-ledger-tools'].intentionCardEditorModal?.close()");
      await waitFor(client, workflows.MODAL, (item) => item === null, `${expected.name} editor closed`, 10_000);
    }
    if (JSON.stringify(vault()) !== JSON.stringify(before)) throw new Error("opening the editor from the ghost changed bytes");
    return { stage: modal.stage, field: modal.stageField, headers };
  });

  // Rail next on yesterday opens today in the same leaf.
  await attempt("display-rail-navigates", async () => {
    // The ghost-editor assertion can encounter the CDP object-reference limit
    // after opening its modal. Close any leftover editor so it cannot intercept
    // this rail click and make the navigation check depend on assertion order.
    await client.evaluate("app.plugins.plugins['bob-ledger-tools'].intentionCardEditorModal?.close()");
    await waitFor(client, workflows.MODAL, (item) => item === null, "no editor before rail navigation", 10_000);
    await open(plan.paths.yesterday, "live");
    await waitCard(plan.paths.yesterday, (value) => mounted("live")(value) && value.card?.rail?.next?.href === linkOf(plan.paths.today));
    const before = await client.evaluate("(() => { window.__railLeaf = app.workspace.activeLeaf; return { path: window.__railLeaf?.view?.file?.path || null, leaves: app.workspace.getLeavesOfType('markdown').length }; })()");
    const clickBox = await clickIn(plan.paths.yesterday, '.bob-intention-card .bob-property-card-rail-item[data-rail="next"]');
    const after = await waitFor(client, "(() => ({ path: window.__railLeaf?.view?.file?.path || null, same: app.workspace.activeLeaf === window.__railLeaf, leaves: app.workspace.getLeavesOfType('markdown').length }))()",
      (value) => value?.path === plan.paths.today, "rail next opens today", 15_000);
    if (!after.same || after.leaves !== before.leaves) throw new Error("rail next left the leaf: " + JSON.stringify({ before, after }));
    await client.evaluate("delete window.__railLeaf");
    return { before, clickBox, after };
  });

  // The week card docks its children strip with today's chip current.
  await attempt("display-period-children", async () => {
    const results = {};
    for (const mode of ["live", "reading"]) {
      await open(plan.paths.week, mode);
      const value = await waitCard(plan.paths.week, (item) => mounted(mode)(item) && item.card?.chips?.length === 7);
      assertTitleSlot(value, { mode, title: week });
      const current = value.card.chips.filter((chip) => chip.current);
      if (current.length !== 1 || current[0].href !== linkOf(plan.paths.today)) throw new Error("current chip: " + JSON.stringify(value.card.chips));
      if (value.card.kind !== "week" || value.card.pill !== "THIS WEEK" || value.card.tile.band !== "WEEK") throw new Error("week identity: " + JSON.stringify(value.card));
      if (!value.card.rail?.prev || !value.card.rail.parent || !value.card.rail.next) throw new Error("week rail: " + JSON.stringify(value.card.rail));
      results[mode] = { current: current[0], subtitle: value.card.subtitle };
    }
    return results;
  });

  // The H1-less legacy daily gets a title and hides nothing in the body. With
  // no nav line, its step row is derived from the calendar (bob-cli-oj
  // group-rail): prev / parent / next by date, each missing stop stated
  // creatable or ghost, never children, and the week group row beneath.
  await attempt("display-legacy-daily", async () => {
    const results = {};
    for (const mode of ["live", "reading"]) {
      await open(plan.paths.legacy, mode);
      const value = await waitCard(plan.paths.legacy, (item) => mounted(mode)(item) && Boolean(item.card?.groupRow));
      assertTitleSlot(value, { mode, title: lib.dayCardTitle(plan.legacy), hidesSource: false, rail: dayRail(plan.legacy) });
      for (const direction of ["prev", "parent", "next"]) {
        const item = value.card.rail[direction];
        const stated = item.state === "creatable" || item.state === "ghost";
        if (item.unresolved !== stated) throw new Error("derived " + direction + " is not stated: " + JSON.stringify(item));
      }
      if (value.card.chips.length) throw new Error("a legacy daily invents children: " + JSON.stringify(value.card.chips));
      if (value.card.groupRow.label !== "Week groups" || value.card.groupRow.position !== "day 6 of 7") {
        throw new Error("legacy group row: " + JSON.stringify(value.card.groupRow));
      }
      if (!value.order.notes?.found || !value.order.notes.after) throw new Error("legacy body line is not below the card: " + JSON.stringify(value.order));
      const bodyLine = await client.evaluate(`(() => {
        const leaf = app.workspace.getLeavesOfType("markdown").find((item) => item.view?.file?.path === ${JSON.stringify(plan.paths.legacy)});
        const root = leaf?.view?.getMode?.() === "preview" ? leaf.view.previewMode?.containerEl : leaf?.view?.contentEl;
        return Array.from(root?.querySelectorAll("p, .cm-line") || []).some((node) => (node.textContent || "").includes("day::${plan.legacy}")
          && node.getBoundingClientRect().height > 0);
      })()`);
      if (!bodyLine) throw new Error("the legacy day:: line is hidden");
      results[mode] = { title: value.card.title, slot: value.card.slot, rail: value.card.rail, groupRow: value.card.groupRow };
    }
    return results;
  });

  // Screenshot matrix: light, dark, and 375px, Live Preview and Reading.
  for (const [name, notePath] of [["today", plan.paths.today], ["empty", plan.paths.empty], ["week", plan.paths.week], ["legacy", plan.paths.legacy]]) {
    for (const mode of ["live", "reading"]) {
      await open(notePath, mode);
      await waitCard(notePath, mounted(mode)).catch(() => null);
      const label = mode === "live" ? "Live Preview" : "Reading";
      await shot("day-card-" + name + "-" + mode + "-light", label);
      await shared.setTheme(client, "dark");
      await shot("day-card-" + name + "-" + mode + "-dark", label, { theme: "dark" });
      await shared.setViewport(client, 375, 900);
      await shot("day-card-" + name + "-" + mode + "-dark-375", label, { theme: "dark", width: 375 });
      await shared.setTheme(client, "light");
      await shot("day-card-" + name + "-" + mode + "-light-375", label, { width: 375 });
      await shared.setViewport(client, 1400, 1000);
    }
  }

  // Hash every fixture before and after opening, revealing, and closing.
  await attempt("display-bytes-neutral", async () => {
    const hash = (snap) => Object.fromEntries(Object.entries(snap).map(([name, text]) => [name, sha256Text(text)]));
    const before = hash(vault());
    for (const notePath of [plan.paths.today, plan.paths.empty, plan.paths.future, plan.paths.legacy, plan.paths.week, plan.paths.quarter]) {
      for (const mode of ["live", "reading"]) {
        await open(notePath, mode);
        await waitCard(notePath).catch(() => null);
      }
    }
    await open(plan.paths.today, "live");
    await waitCard(plan.paths.today, mounted("live"));
    await placeCursor("# " + plan.today, plan.paths.today);
    await sleep(300);
    await placeCursor("GTD-ANCHOR", plan.paths.today);
    await open(plan.paths.ordinary, "live");
    await sleep(500);
    const after = hash(vault());
    const changed = Object.keys({ ...before, ...after }).filter((name) => before[name] !== after[name]);
    if (changed.length) throw new Error("fixture bytes changed: " + changed.join(", "));
    return { files: Object.keys(after).length };
  });
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
      workflows.selfTest();
      workflowsLanding.selfTest();
      const missing = REQUIRED_CHECKS.filter((name, index) => REQUIRED_CHECKS.indexOf(name) !== index);
      if (missing.length) throw new Error("duplicate required checks: " + missing.join(", "));
      const source = displayProbeSource("2026/20261120.md");
      new Function("return " + source); // syntax only; never evaluated here
      process.stdout.write("offline self-test complete (intention fixtures, clocks, byte boundaries, probes; no Obsidian or bob launched)\n");
    } catch (error) {
      process.stderr.write(String(error.stack || error) + "\n");
      process.exitCode = 1;
    }
    return;
  }
  await run(args);
}

if (require.main === module) void main(process.argv.slice(2));
module.exports = { REQUIRED_CHECKS, displayProbeSource, installPlugins, writeBobShim, snapshot };
