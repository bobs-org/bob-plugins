#!/usr/bin/env node
// Real-Obsidian acceptance for the local Area/Project cards. Uses synthetic
// notes in an isolated vault/profile and never opens the live vault's notes.
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const lib = require("./obsidian-home-cards-e2e-lib.cjs");
const shared = require("./obsidian-record-card-e2e.cjs");
const taskReqs = require("./obsidian-task-reqs-e2e.cjs");
const repoRoot = path.resolve(__dirname, "..");
const PLUGIN_ID = "bob-ledger-tools";
const MODE_STATE = {
  live: { mode: "source", source: false },
  reading: { mode: "preview", source: false },
};
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
};
const PROBE_SOURCE = `(() => {
  const workspace = app.workspace;
  const leaf = workspace.activeLeaf;
  const view = leaf && leaf.view;
  const root = view && view.containerEl;
  const card = root && root.querySelector ? root.querySelector(".bob-home-card") : null;
  const mode = view && view.getMode && view.getMode() === "preview" ? "reading"
    : view && view.getState && view.getState().source ? "source" : "live";
  const visible = (node) => {
    if (!node || !node.getBoundingClientRect) return false;
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.display !== "none"
      && style.visibility !== "hidden" && Number(style.opacity || 1) > 0;
  };
  const properties = root && root.querySelectorAll
    ? Array.from(root.querySelectorAll(".metadata-container")) : [];
  const tile = card && card.querySelector(".bob-property-card-tile");
  const glyph = card && card.querySelector(".bob-property-card-tile-glyph");
  const lifecycle = card && card.querySelector(".bob-home-card-lifecycle-word");
  const title = card && card.querySelector(".bob-property-card-title");
  return {
    path: view && view.file && view.file.path || null,
    mode,
    cardPresent: Boolean(card),
    kind: card && card.getAttribute("data-home-kind") || null,
    ariaLabel: card && card.getAttribute("aria-label") || null,
    title: title && String(title.textContent || "").trim() || null,
    icon: glyph && glyph.getAttribute("data-icon") || null,
    tileForm: tile && tile.getAttribute("data-tile-form") || null,
    lifecycle: lifecycle && String(lifecycle.textContent || "").trim() || null,
    lifecycleDetail: card && String(card.querySelector(".bob-home-card-lifecycle-detail")?.textContent || "").trim() || null,
    pills: card ? Array.from(card.querySelectorAll(".bob-home-card-pill")).map((node) => String(node.textContent || "").trim()) : [],
    crumbs: card ? Array.from(card.querySelectorAll(".bob-property-card-kicker-link")).map((node) => String(node.textContent || "").trim()) : [],
    chips: card ? Array.from(card.querySelectorAll(".bob-home-card-chip")).map((node) => String(node.textContent || "").trim()) : [],
    chipCount: card ? card.querySelectorAll(".bob-home-card-chip").length : 0,
    metaPresent: Boolean(card && card.querySelector(".bob-home-card-meta")),
    footPresent: Boolean(card && card.querySelector(".bob-property-card-foot")),
    nativePropertiesVisible: properties.some(visible),
    nativePropertiesCount: properties.length,
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
  return { notes, enabled };
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
    checks: [], screenshots: [], consoleErrors: [],
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
    const { notes, enabled } = installVault(vaultDir, profileDir, tasksSource);
    writeBobShim(shimDir, bobLog);
    report.scratch = { root: scratch, vault: fs.realpathSync(vaultDir), profile: profileDir, fixtures: Object.keys(notes).sort() };
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
        BOB_DIR: fs.realpathSync(vaultDir),
        BOB_CONFIG_FILE: path.join(profileDir, "missing-test-config.yml"),
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
    await shared.setViewport(client, 1400, 1000);
    await shared.setTheme(client, "light");
    for (const [notePath, expected] of Object.entries(lib.EXPECTED)) {
      for (const mode of ["live", "reading"]) {
        await shared.openNote(client, notePath, mode);
        const probe = await waitForCard(client, notePath, mode);
        const failures = lib.cardFailures(probe, notePath, mode);
        check(`card:${notePath}:${mode}`, failures.length === 0, { probe, failures, expected });
      }
    }

    for (const notePath of [lib.PATHS.area, lib.PATHS.wip, lib.PATHS.done]) {
      const expected = lib.EXPECTED[notePath];
      for (const mode of ["live", "reading"]) {
        for (const theme of ["light", "dark"]) {
          await shared.setTheme(client, theme);
          for (const [widthName, width] of [["narrow", 720], ["wide", 1400]]) {
            await shared.setViewport(client, width, 1000);
            await shared.openNote(client, notePath, mode);
            const probe = await waitForCard(client, notePath, mode);
            const failures = lib.cardFailures(probe, notePath, mode);
            if (failures.length) throw new Error(`Refusing invalid screenshot ${notePath}/${mode}/${theme}/${widthName}: ${failures.join("; ")}`);
            const name = `${notePath.replace(/\.md$/, "")}-${mode}-${theme}-${widthName}`;
            const shot = await shared.capture(client, outDir, name, width, theme, mode);
            shot.notePath = notePath;
            shot.captureFailures = shot.width === width && shot.height === 1000 ? [] : ["captured viewport dimensions differ from the requested matrix"];
            report.screenshots.push(shot);
          }
        }
      }
    }
    // Opening and switching notes schedules existing workspace lifecycle
    // probes (property capability and report refreshes). They are not card
    // paint work. The home-card host unit suite spies on the paint/build path
    // directly and asserts it does not spawn Bob.
    report.fixtureHashesAfterPaint = shared.markdownFilesHash(vaultDir);
    check("painting-does-not-write-markdown", report.fixtureHashesBefore === report.fixtureHashesAfterPaint,
      { before: report.fixtureHashesBefore, after: report.fixtureHashesAfterPaint });

    const taskPath = lib.PATHS.wip;
    await shared.openNote(client, taskPath, "live");
    await waitForCard(client, taskPath, "live");
    await taskReqs.setMode(client, true, true);
    const cursor = await client.evaluate(`(() => {
      const editor = app.workspace.activeLeaf.view.editor;
      const lines = editor.getValue().split(/\\r?\\n/);
      const line = lines.findIndex((value) => value.includes("^prj"));
      const ch = lines[line]?.indexOf("root rollout") ?? -1;
      if (line < 0 || ch < 0) return { ok: false, line, ch, value: editor.getValue() };
      editor.setCursor({ line, ch });
      editor.focus();
      return { ok: true, line, ch, text: lines[line] };
    })()`);
    await taskReqs.key(client, "Escape");
    await taskReqs.key(client, "i");
    await taskReqs.key(client, "Z");
    let editProbe = await taskReqs.readEditor(client);
    const inserted = editProbe?.doc?.includes("Ship the Zroot rollout");
    await taskReqs.key(client, "Backspace");
    await taskReqs.key(client, "Escape");
    editProbe = await taskReqs.readEditor(client);
    check("prj-cursor-integrity", cursor.ok && inserted && editProbe?.doc === notes[taskPath], {
      cursor, inserted, restored: editProbe?.doc === notes[taskPath],
    });

    await taskReqs.setMode(client, false, true);
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
      return { text, editor: editor.getValue(), done: /- \\[x\\] #task #prj Ship the root rollout.*\\^prj/.test(text) };
    })()`, (value) => value && value.done, "Ctrl+Enter closes the ^prj task", 20_000);
    const doneProbe = await shared.waitFor(client, PROBE_SOURCE,
      (value) => value?.path === taskPath && value?.lifecycle === "DONE", "done Project Card after task close", 15_000);
    check("prj-close-gesture", closeState.done && doneProbe.lifecycle === "DONE", {
      task: taskPath, line: prjLine, persisted: closeState.done,
      editorHasDone: /- \\[x\\]/.test(closeState.editor), lifecycle: doneProbe.lifecycle,
    });
    report.fixtureHashesAfterGesture = shared.markdownFilesHash(vaultDir);
    const otherFixtureChanges = [];
    for (const notePath of Object.keys(notes)) {
      if (notePath === taskPath) continue;
      const actual = require("node:crypto").createHash("sha256").update(fs.readFileSync(path.join(vaultDir, notePath))).digest("hex");
      const expected = require("node:crypto").createHash("sha256").update(notes[notePath]).digest("hex");
      if (actual !== expected) otherFixtureChanges.push(notePath);
    }
    check("gesture-only-writes-its-project-note", otherFixtureChanges.length === 0, otherFixtureChanges);

    const expectedShots = lib.screenshotNeeds();
    const haveShots = new Set(report.screenshots.map((row) => row.name));
    const missingShots = expectedShots.filter((name) => !haveShots.has(name));
    const badShots = report.screenshots.filter((row) => row.captureFailures?.length).map((row) => ({ name: row.name, failures: row.captureFailures }));
    check("screenshots-captured", missingShots.length === 0 && badShots.length === 0, { missingShots, badShots, count: report.screenshots.length });
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
  const failed = report.checks.filter((row) => row.status !== "pass");
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
module.exports = { PROBE_SOURCE, installVault, parseArgs: lib.parseArgs, run, tasksPluginSource };
