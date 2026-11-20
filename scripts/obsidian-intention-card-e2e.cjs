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
  "display-source-fails-open", "display-mode-change-restores", "display-empty-fails-open",
  "display-malformed-fails-open", "display-embed-fails-open", "display-unmount-restores",
  "display-failure-restores-and-recovers", "display-plugin-disable-restores", "display-passive-bytes-neutral",
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

// One DOM probe for the card, native Properties rows, and block order.
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
    const cards = Array.from(root?.querySelectorAll(".bob-intention-card") || []).filter((node) => !inEmbed(node));
    const embedCards = Array.from(root?.querySelectorAll(".bob-intention-card") || []).filter(inEmbed);
    const properties = Array.from(root?.querySelectorAll(".metadata-container") || []).find((node) => !inEmbed(node)) || null;
    const rows = Array.from(properties?.querySelectorAll(".metadata-property[data-property-key]") || []).map((row) => ({
      key: row.getAttribute("data-property-key"), owned: row.classList.contains("bob-property-card-owned-property"), ...visible(row),
    }));
    const embedProperties = Array.from(root?.querySelectorAll(".markdown-embed .metadata-property[data-property-key], .internal-embed .metadata-property[data-property-key]") || [])
      .map((row) => ({ key: row.getAttribute("data-property-key"), owned: row.classList.contains("bob-property-card-owned-property"), ...visible(row) }));
    const ownedAnywhere = document.querySelectorAll(".bob-property-card-owned-property").length;
    const card = cards[0] || null;
    const order = (needle) => {
      if (!card) return null;
      const nodes = Array.from(root.querySelectorAll(mode === "preview" ? "p, li, h1, div.el-p, .task-list-item" : ".cm-line"))
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
    return {
      status: "pass", path: notePath, mode, source,
      cardCount: cards.length, embedCardCount: embedCards.length, ownedAnywhere,
      card: card ? {
        label: card.getAttribute("aria-label"), role: card.getAttribute("role"),
        sourceAttr: card.getAttribute("data-intention-source"),
        kicker: card.querySelector(".bob-intention-card-kicker")?.textContent || "",
        chips: Array.from(card.querySelectorAll(".bob-intention-card-chip")).map((node) => node.textContent),
        intentions: Array.from(card.querySelectorAll(".bob-intention-card-intention-body")).map((node) => node.textContent.trim()),
        parent: card.querySelector(".bob-intention-card-parent")?.textContent || "",
        summary: card.querySelector(".bob-intention-card-summary")?.textContent || "",
        reflection: card.querySelector(".bob-intention-card-reflection")?.textContent || "",
        quote: Boolean(card.querySelector(".bob-intention-card-quote")),
        missing: card.querySelector(".bob-intention-card-missing")?.textContent || "",
        text: card.textContent.slice(0, 600), rect: (() => { const r = card.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })(),
        h1Before: h1 ? Boolean(card.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_PRECEDING) : null,
      } : null,
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
    check("screenshots-captured", report.screenshots.length >= 20, { count: report.screenshots.length });
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
  return { key, keys, open, probe, waitCard, waitNoCard, shot, vault, invocations, writerApplies, placeCursor, expandProperties };
}

async function displayPhase(ctx) {
  const { plan, attempt, open, probe, waitCard, waitNoCard, shot, client, vault } = ctx;
  const passive = vault();
  const authored = (name) => Object.keys(Object.fromEntries(lib.frontmatterBlocks(ctx.notes[name]))).filter(Boolean);
  const assertPlacement = (state) => {
    const order = state.order;
    if (!state.card) throw new Error("card absent");
    if (state.card.h1Before !== true) throw new Error("card does not follow the H1: " + JSON.stringify(state.card));
    if (!order.nav?.found || !order.nav.before) throw new Error("card does not follow the navigation line: " + JSON.stringify(order));
    if (!order.gtd?.found || !order.gtd.after) throw new Error("card is not above the ^gtd line: " + JSON.stringify(order));
    if (!order.notes?.found || !order.notes.after) throw new Error("card is not above the body: " + JSON.stringify(order));
    return order;
  };
  const assertRows = (state, notePath, hidden) => {
    const hiddenKeys = lib.assertOwnedRows(state, { hidden, authoredKeys: authored(notePath) });
    return { hiddenKeys, rows: state.rows };
  };

  // Live Preview: today mounts once, after H1 + nav, above ^gtd.
  await open(plan.paths.today, "live");
  let state = await waitCard(plan.paths.today);
  ctx.report.probes.liveToday = state;
  await attempt("display-live-today-mounts-once", () => {
    if (state.cardCount !== 1 || state.embedCardCount !== 0) throw new Error(JSON.stringify(state));
    if (state.card.role !== "group" || !/intention card/.test(state.card.label || "")) throw new Error("card is not a labelled group: " + JSON.stringify(state.card));
    if (JSON.stringify(state.card.intentions) !== JSON.stringify(plan.intentions.today)) throw new Error("intentions mismatch " + JSON.stringify(state.card));
    if (!state.card.chips[0]?.includes("①")) throw new Error("numbered chip missing: " + JSON.stringify(state.card.chips));
    return state.card;
  });
  await attempt("display-live-today-placement", () => assertPlacement(state));
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

  // Reading view: same placement and ownership.
  await open(plan.paths.today, "reading");
  state = await waitCard(plan.paths.today, (value) => value?.cardCount === 1 && value.mode === "preview");
  ctx.report.probes.readingToday = state;
  await attempt("display-reading-today-mounts-once", () => { if (state.cardCount !== 1) throw new Error(JSON.stringify(state)); return state.card; });
  await attempt("display-reading-today-placement", () => assertPlacement(state));
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
  await open(plan.paths.today, "reading");
  await waitCard(plan.paths.today, (value) => value?.cardCount === 1 && value.mode === "preview");
  await shot("intention-card-reading-today-light-375", "Reading", { width: 375 });
  await shared.setViewport(client, 1400, 1000);

  // Recently closed yesterday shows the quiet missing band.
  await open(plan.paths.yesterday, "live");
  state = await waitCard(plan.paths.yesterday);
  await attempt("display-recent-closed-missing-band", () => {
    if (!/✦ summary pending/.test(state.card.missing) || !/＋ reflection r/.test(state.card.missing)) throw new Error("missing band: " + JSON.stringify(state.card));
    return state.card.missing;
  });
  await shot("intention-card-live-yesterday-missing-band", "Live Preview");
  await shared.setTheme(client, "dark");
  await shot("intention-card-live-yesterday-missing-band-dark", "Live Preview", { theme: "dark" });
  await shared.setTheme(client, "light");

  // Source mode fails open: no card and no owned rows anywhere.
  await open(plan.paths.today, "source");
  await attempt("display-source-fails-open", async () => {
    const value = await waitNoCard(plan.paths.today);
    if (value.ownedAnywhere !== 0 || value.source !== true) throw new Error(JSON.stringify(value));
    return { source: value.source, ownedAnywhere: value.ownedAnywhere };
  });
  await attempt("display-mode-change-restores", async () => {
    await open(plan.paths.today, "reading");
    const reading = await waitCard(plan.paths.today, (value) => value?.cardCount === 1 && value.mode === "preview");
    await open(plan.paths.today, "source");
    const source = await waitNoCard(plan.paths.today);
    await open(plan.paths.today, "live");
    const live = await waitCard(plan.paths.today);
    assertRows(live, plan.paths.today, true);
    if (source.ownedAnywhere !== 0) throw new Error("Source kept owned rows: " + source.ownedAnywhere);
    return { reading: reading.cardCount, source: source.cardCount, live: live.cardCount };
  });

  // Empty and malformed notes fail open with all Properties visible.
  for (const [name, notePath] of [["display-empty-fails-open", plan.paths.empty], ["display-malformed-fails-open", plan.paths.malformed]]) {
    await attempt(name, async () => {
      const results = {};
      for (const mode of ["live", "reading"]) {
        await open(notePath, mode);
        await sleep(600);
        const value = await waitNoCard(notePath);
        assertRows(value, notePath, false);
        if (value.ownedAnywhere !== 0) throw new Error("owned rows remain: " + value.ownedAnywhere);
        results[mode] = { rows: value.rows.length };
      }
      return results;
    });
  }
  await shot("intention-card-malformed-fails-open", "Reading");

  // Embeds never host the card.
  await attempt("display-embed-fails-open", async () => {
    const results = {};
    for (const mode of ["reading", "live"]) {
      await open(plan.paths.embed, mode);
      await sleep(900);
      const value = await probe(plan.paths.embed);
      if (value.cardCount !== 0 || value.embedCardCount !== 0) throw new Error("card inside embed: " + JSON.stringify(value));
      // Obsidian folds an embed's Properties itself; the card must never own them.
      if (value.embedProperties.some((row) => row.owned) || value.ownedAnywhere !== 0) throw new Error("embed properties owned: " + JSON.stringify(value.embedProperties));
      results[mode] = { embedProperties: value.embedProperties.length };
    }
    return results;
  });
  await shot("intention-card-embed-fails-open", "Live Preview");

  // Leaving the note releases ownership; recovery after failure repaints.
  await attempt("display-unmount-restores", async () => {
    await open(plan.paths.today, "live");
    await waitCard(plan.paths.today);
    await open(plan.paths.ordinary, "live");
    await sleep(500);
    const owned = await client.evaluate("document.querySelectorAll('.bob-property-card-owned-property').length");
    const cards = await client.evaluate("document.querySelectorAll('.bob-intention-card').length");
    if (owned !== 0 || cards !== 0) throw new Error(JSON.stringify({ owned, cards }));
    return { owned, cards };
  });
  await attempt("display-failure-restores-and-recovers", async () => {
    await open(plan.paths.today, "live");
    await waitCard(plan.paths.today);
    const original = ctx.notes[plan.paths.today];
    const broken = original.replace('intentions:\n  - "Ship the intention card"\n  - "Walk after lunch"\n', "intentions: 7\n");
    if (broken === original) throw new Error("could not build malformed variant");
    await client.evaluate(`app.vault.modify(app.vault.getAbstractFileByPath(${JSON.stringify(plan.paths.today)}), ${JSON.stringify(broken)})`);
    const failed = await waitNoCard(plan.paths.today, "card removal after malformed metadata");
    assertRows(failed, plan.paths.today, false);
    await client.evaluate(`app.vault.modify(app.vault.getAbstractFileByPath(${JSON.stringify(plan.paths.today)}), ${JSON.stringify(original)})`);
    const recovered = await waitCard(plan.paths.today, (value) => value?.cardCount === 1 && value.rows.some((row) => row.key === "intentions" && row.owned));
    assertRows(recovered, plan.paths.today, true);
    const disk = fs.readFileSync(path.join(ctx.vaultDir, plan.paths.today), "utf8");
    if (disk !== original) throw new Error("recovery did not restore exact bytes");
    return { failedRows: failed.rows.length, recoveredOwned: recovered.rows.filter((row) => row.owned).map((row) => row.key) };
  });
  await attempt("display-plugin-disable-restores", async () => {
    await client.evaluate("app.plugins.disablePlugin('bob-ledger-tools')");
    await waitFor(client, "!app.plugins.plugins['bob-ledger-tools']", Boolean, "ledger-tools disabled");
    const off = await waitNoCard(plan.paths.today);
    assertRows(off, plan.paths.today, false);
    await client.evaluate("app.plugins.enablePlugin('bob-ledger-tools')");
    await waitFor(client, "Boolean(app.plugins.plugins['bob-ledger-tools'])", Boolean, "ledger-tools enabled", 30_000);
    await open(plan.paths.today, "live");
    const on = await waitCard(plan.paths.today, (value) => value?.cardCount === 1 && value.rows.some((row) => row.owned));
    assertRows(on, plan.paths.today, true);
    return { offOwned: off.ownedAnywhere, onCards: on.cardCount };
  });
  await attempt("display-passive-bytes-neutral", () => {
    const now = vault();
    if (JSON.stringify(now) !== JSON.stringify(passive)) throw new Error("passive display changed Markdown bytes");
    return { files: Object.keys(now).length };
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
