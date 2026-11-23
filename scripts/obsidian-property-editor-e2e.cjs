#!/usr/bin/env node
// Real-Obsidian acceptance for the generic note Property Editor. All writes
// target an isolated scratch vault and use the exact bob-cli BOB_BIN supplied
// by the caller; the live vault is never opened.
"use strict";

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const shared = require("./obsidian-record-card-e2e.cjs");
const lib = require("./obsidian-property-editor-e2e-lib.cjs");

const repoRoot = path.resolve(__dirname, "..");
const ELECTRON_FALLBACK = "/snap/obsidian/current/app/obsidian";
const TODAY = "2026-11-23";
const OVERALL_TIMEOUT_MS = 600_000;

function fail(message, code = 1) {
  const error = new Error(message);
  error.exitCode = code;
  throw error;
}

function writeNote(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function installPlugin(vaultDir) {
  const source = path.join(repoRoot, "plugins", "bob-ledger-tools");
  const target = path.join(vaultDir, ".obsidian", "plugins", "bob-ledger-tools");
  fs.mkdirSync(target, { recursive: true });
  for (const name of ["manifest.json", "main.js", "styles.css", "data.json"]) {
    const file = path.join(source, name);
    if (fs.existsSync(file)) fs.copyFileSync(file, path.join(target, name));
  }
  fs.writeFileSync(path.join(vaultDir, ".obsidian", "community-plugins.json"), JSON.stringify(["bob-ledger-tools"], null, 2));
  fs.writeFileSync(path.join(vaultDir, ".obsidian", "core-plugins.json"), JSON.stringify(["command-palette", "properties"], null, 2));
  fs.writeFileSync(path.join(vaultDir, ".obsidian", "app.json"), JSON.stringify({
    livePreview: true,
    showLineNumber: false,
    showInlineTitle: true,
    propertiesInDocument: "visible",
    vimMode: false,
    alwaysUpdateLinks: false,
  }, null, 2));
  fs.writeFileSync(path.join(vaultDir, ".obsidian", "appearance.json"), JSON.stringify({ cssTheme: "", theme: "moonstone" }, null, 2));
}

function writeBobShim(shimDir, logPath, oldFlag) {
  fs.mkdirSync(shimDir, { recursive: true });
  const file = path.join(shimDir, "bob");
  fs.writeFileSync(file, `#!/usr/bin/env node
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
const inputFlag = args.findIndex((arg, index) => (arg === "-i" || arg === "--input") && args[index + 1] === "-");
const input = inputFlag >= 0 ? fs.readFileSync(0, "utf8") : undefined;
const append = row => { try { fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(row) + "\\n"); } catch (_) {} };
append({event:"start", args, input});
if (args[0] === "props" && args[1] === "show" && fs.existsSync(${JSON.stringify(oldFlag)})) {
  const stderr = "error: unrecognized subcommand 'props'\\n\\nUsage: bob [OPTIONS] <COMMAND>\\n\\nFor more information, try '--help'.\\n";
  append({event:"finish", args, exitCode:2, stderr, oldBob:true});
  process.stderr.write(stderr);
  process.exit(2);
}
const result = spawnSync(process.env.BOB_PROPERTY_EDITOR_REAL, args, {
  encoding: "utf8", env: process.env, input, timeout: 90000, maxBuffer: 32 * 1024 * 1024,
});
append({event:"finish", args, exitCode:result.status, stdout:result.stdout, stderr:result.stderr});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status == null ? 1 : result.status);
`);
  fs.chmodSync(file, 0o755);
  return file;
}

function bobEnvironment(ctx) {
  return {
    ...process.env,
    HOME: ctx.profileDir,
    BOB_DIR: ctx.vaultDir,
    BOB_NOW: TODAY + " 12:00:00",
    BOB_CONFIG_FILE: path.join(ctx.profileDir, "missing-test-config.yml"),
    BOB_PROPERTY_EDITOR_LOG: ctx.bobLog,
    BOB_PROPERTY_EDITOR_OLD_FLAG: ctx.oldFlag,
    BOB_PROPERTY_EDITOR_REAL: ctx.bob.path,
    PATH: ctx.shimDir + path.delimiter + (process.env.PATH || ""),
    NO_COLOR: "1",
  };
}

function runBob(ctx, args, input) {
  const result = spawnSync(ctx.bob.path, args, {
    cwd: ctx.vaultDir,
    encoding: "utf8",
    input,
    timeout: 90_000,
    maxBuffer: 32 * 1024 * 1024,
    env: bobEnvironment(ctx),
  });
  if (result.error) throw result.error;
  let report = null;
  try { report = JSON.parse(String(result.stdout || "")); } catch (_) {}
  return {
    args,
    input: input || null,
    exitCode: result.status,
    stderr: String(result.stderr || "").slice(0, 1200),
    report,
  };
}

function addCheck(report, name, ok, detail) {
  report.assertions.push({ name, status: ok ? "pass" : "fail", detail });
  if (!ok) throw new Error(name + " failed: " + JSON.stringify(detail));
}

function selectorClick(client, selector) {
  return client.evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return false; node.click(); return true; })()`);
}

function propertyRowClick(client, key) {
  return client.evaluate(`(() => {
    const row = Array.from(document.querySelectorAll(".bob-property-editor [data-property-row]"))
      .find((item) => item.getAttribute("data-property-key") === ${JSON.stringify(key)});
    if (!row) return false;
    row.click();
    return true;
  })()`);
}

async function sendKey(client, key, options = {}) {
  const table = {
    Enter: ["Enter", 13, "\r"],
    "[": ["BracketLeft", 219, "["],
    ";": ["Semicolon", 186, ";"],
  };
  const entry = table[key] || ["Key" + key.toUpperCase(), key.toUpperCase().charCodeAt(0), key.length === 1 ? key : undefined];
  const modifiers = options.ctrl ? 2 : options.alt ? 1 : options.shift ? 8 : 0;
  const type = modifiers || !entry[2] ? "rawKeyDown" : "keyDown";
  await client.call("Input.dispatchKeyEvent", {
    type,
    key,
    code: entry[0],
    windowsVirtualKeyCode: entry[1],
    nativeVirtualKeyCode: entry[1],
    modifiers,
    ...(type === "keyDown" ? { text: entry[2], unmodifiedText: entry[2] } : {}),
  });
  await client.call("Input.dispatchKeyEvent", {
    type: "keyUp", key, code: entry[0], windowsVirtualKeyCode: entry[1], nativeVirtualKeyCode: entry[1], modifiers,
  });
}

async function waitForEditor(client, predicate, label, timeoutMs = 25_000) {
  return shared.waitFor(client, lib.editorProbeSource(), predicate, label, timeoutMs);
}

async function openPropertyEditor(client, filePath, options = {}) {
  const result = await client.evaluate(`(async () => {
    const plugin = window.app?.plugins?.plugins?.["bob-ledger-tools"];
    if (!plugin || typeof plugin.openPropertyEditor !== "function") return { ok: false, reason: "plugin-api-missing" };
    if (${options.resetCapability === true ? "true" : "false"}) plugin.propertyCapability = null;
    const opened = await plugin.openPropertyEditor(${JSON.stringify({ filePath, ...(options.key ? { key: options.key } : {}), ...(options.mode ? { mode: options.mode } : {}) })});
    return { ok: opened?.ok === true, reason: opened?.reason || null };
  })()`, 30_000);
  if (!result?.ok) throw new Error("openPropertyEditor failed: " + JSON.stringify(result));
  return waitForEditor(client, (probe) => probe.open, "property editor to open");
}

async function setInput(client, selector, value) {
  const changed = await client.evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) return false;
    input.focus();
    input.value = ${JSON.stringify(value)};
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  if (!changed) throw new Error("Missing input " + selector);
}

async function saveStage(client, selector, value, rowKey) {
  await setInput(client, selector, value);
  await shared.waitFor(client,
    `document.querySelector(".bob-property-editor-stage-preview")?.textContent || ""`,
    (text) => /Preview ·/.test(text), "property value preview");
  if (!await selectorClick(client, '.bob-property-editor [data-property-stage-action="save"]')) throw new Error("Property stage Save button missing");
  return waitForEditor(client, (probe) => !probe.stage && /Saved/.test(probe.status) && probe.rows.some((row) => row.key === rowKey && row.text.includes(value)), "property value to save");
}

async function run(args) {
  const report = {
    pass: false,
    startedAt: new Date().toISOString(),
    assertions: [],
    screenshots: [],
    bobRuns: [],
    consoleExceptions: [],
    prerequisites: [],
  };
  let scratch = "";
  let child = null;
  let client = null;
  let successful = false;
  const outDir = path.resolve(args.out || path.join(os.tmpdir(), "bob-property-editor-e2e-" + Math.random().toString(16).slice(2)));
  const reportPath = path.resolve(args.report || path.join(outDir, "property-editor-report.json"));
  report.reportPath = reportPath;
  report.screenshotDirectory = outDir;
  try {
    fs.mkdirSync(outDir, { recursive: true });
    const bob = shared.findBobProvenance();
    report.bob = { path: bob.path, sha256: bob.sha256, version: bob.version, sourceSha: bob.sourceSha };
    report.prerequisites.push({ name: "pinned-current-bob-cli", status: "pass", detail: report.bob });

    const executable = args.executable || process.env.OBSIDIAN_BIN || ELECTRON_FALLBACK;
    fs.accessSync(executable, fs.constants.X_OK);
    const executableProbe = spawnSync(executable, ["--help"], { encoding: "utf8", timeout: 20_000 });
    if (/unable to find Obsidian/i.test(String(executableProbe.stdout || "") + String(executableProbe.stderr || ""))) {
      throw new Error("The selected executable is the Obsidian CLI shim, not the Electron application.");
    }
    report.prerequisites.push({ name: "Obsidian-Electron", status: "pass", detail: executable });

    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "bob-property-editor-"));
    const vaultDir = path.join(scratch, "vault");
    const profileDir = path.join(scratch, "profile");
    const shimDir = path.join(profileDir, "shim");
    fs.mkdirSync(vaultDir, { recursive: true });
    const notes = lib.fixtureNotes(TODAY);
    for (const [name, content] of Object.entries(notes)) writeNote(vaultDir, name, content);
    installPlugin(vaultDir);
    const bobLog = path.join(profileDir, "bob-invocations.jsonl");
    const oldFlag = path.join(profileDir, "simulate-old-bob");
    writeBobShim(shimDir, bobLog, oldFlag);
    shared.initScratchGit(vaultDir);
    const vaultReal = fs.realpathSync(vaultDir);
    shared.seedProfile(profileDir, vaultReal);
    const ctx = { bob, vaultDir, profileDir, shimDir, bobLog, oldFlag };

    const showProject = runBob(ctx, ["props", "show", "projects/project-note.md", "-f", "json"]);
    report.bobRuns.push(showProject);
    if (showProject.exitCode !== 0 || showProject.report?.ok !== true || !showProject.report.capabilities?.includes("props_v1")) {
      throw new Error("Current bob did not report props_v1 for the project fixture: " + JSON.stringify(showProject));
    }
    const showDay = runBob(ctx, ["props", "show", "2026/20261123.md", "-f", "json"]);
    report.bobRuns.push(showDay);
    if (showDay.exitCode !== 0 || showDay.report?.ok !== true) {
      throw new Error("Current bob could not read the day fixture: " + JSON.stringify(showDay));
    }
    const albums = runBob(ctx, ["albums", "sync", "-f", "json"]);
    report.bobRuns.push(albums);
    if (albums.exitCode !== 0 || albums.report?.ok !== true) throw new Error("Could not prepare the record fixture: " + JSON.stringify(albums));

    const port = await shared.freePort();
    child = spawn(executable, [
      "--no-sandbox",
      "--user-data-dir=" + profileDir,
      "--remote-debugging-port=" + port,
      "--remote-allow-origins=http://127.0.0.1/*",
      vaultReal,
    ], {
      cwd: os.tmpdir(),
      env: { ...bobEnvironment(ctx), TMPDIR: "/tmp" },
      stdio: ["ignore", "ignore", "pipe"],
    });
    const startupErrors = [];
    child.stderr.on("data", (chunk) => startupErrors.push(String(chunk).slice(0, 1000)));
    const target = await shared.selectTarget(port, vaultReal, () => child && child.exitCode == null);
    client = target.client;
    client.on("Runtime.exceptionThrown", (params) => {
      const details = params.exceptionDetails || {};
      report.consoleExceptions.push({ text: details.text || "", description: details.exception?.description || "", url: details.url || "" });
    });
    await client.call("Runtime.enable");
    await client.call("Log.enable");
    await shared.trustCommunityPlugins(client);
    report.obsidian = { pid: child.pid, executable, startupErrors: startupErrors.slice(-8) };

    const projectBefore = fs.readFileSync(path.join(vaultDir, "projects/project-note.md"), "utf8");
    await shared.openNote(client, "projects/project-note.md", "live");
    let probe = await openPropertyEditor(client, "projects/project-note.md", { key: "status", mode: "edit" });
    probe = await waitForEditor(client, (value) => value.rows.some((row) => row.key === "status"), "project property rows");
    addCheck(report, "project header and loose rows", probe.heading === "PROJECT · PROPERTIES" && probe.rows.some((row) => row.key === "keep_exact"), probe);

    await shared.waitFor(client, `Boolean(document.querySelector(".bob-property-editor [data-property-stage]"))`, Boolean, "project status stage");
    await saveStage(client, "[data-property-stage-input]", "ready", "status");
    await sendKey(client, "u");
    await waitForEditor(client, (value) => value.rows.some((row) => row.key === "status" && /draft/.test(row.text)), "Undo of project edit");
    await sendKey(client, "r", { ctrl: true });
    await waitForEditor(client, (value) => value.rows.some((row) => row.key === "status" && /ready/.test(row.text)), "Redo of project edit");
    addCheck(report, "project edit and undo redo", true, "status returned to draft on Undo and ready on Redo");

    await sendKey(client, "o");
    await shared.waitFor(client, `Boolean(document.querySelector(".bob-property-editor [data-property-add='name']"))`, Boolean, "add-property name stage");
    await setInput(client, "[data-property-add-input]", "added_field");
    if (!await selectorClick(client, '.bob-property-editor [data-property-add-action="literal"]')) throw new Error("Add property text action missing");
    await shared.waitFor(client, `Boolean(document.querySelector(".bob-property-editor [data-property-stage]"))`, Boolean, "added property value stage");
    await saveStage(client, "[data-property-stage-input]", "from-editor", "added_field");
    addCheck(report, "project add", true, "added_field was written through the property value stage");

    if (!await propertyRowClick(client, "remove_me")) throw new Error("Could not select remove_me");
    await sendKey(client, "d", { ctrl: true });
    await waitForEditor(client, (value) => !value.rows.some((row) => row.key === "remove_me"), "property deletion");
    await sendKey(client, "u");
    await waitForEditor(client, (value) => value.rows.some((row) => row.key === "remove_me"), "Undo of property deletion");
    await propertyRowClick(client, "remove_me");
    await sendKey(client, "d", { ctrl: true });
    await waitForEditor(client, (value) => !value.rows.some((row) => row.key === "remove_me"), "final property deletion");
    addCheck(report, "project delete and undo", true, "delete removed the row and Undo restored it before the final delete");

    const projectAfter = fs.readFileSync(path.join(vaultDir, "projects/project-note.md"), "utf8");
    addCheck(report, "untouched frontmatter bytes preserved",
      projectAfter.includes("# Keep this comment exactly as authored\n") &&
        projectAfter.includes('keep_exact: "keep : and # exactly"\n') &&
        projectAfter.includes("Body bytes stay outside the property edit.\n") &&
        projectAfter.includes('status: "ready"') &&
        projectAfter.includes('added_field: "from-editor"') &&
        !projectAfter.includes("remove_me:"),
      { before: projectBefore, after: projectAfter });

    await client.evaluate("app.plugins.plugins['bob-ledger-tools'].propertyEditorModal?.close?.()");
    await shared.openNote(client, "2026/20261123.md", "live");
    probe = await openPropertyEditor(client, "2026/20261123.md", { key: "day_marker" });
    await waitForEditor(client, (value) => value.rows.some((row) => row.key === "day_marker"), "day properties");
    await propertyRowClick(client, "day_marker");
    await sendKey(client, "Enter");
    await shared.waitFor(client, `Boolean(document.querySelector(".bob-property-editor [data-property-stage]"))`, Boolean, "day marker stage");
    await saveStage(client, "[data-property-stage-input]", "day-edited", "day_marker");
    addCheck(report, "day-note edit", true, "canonical day note value edited through bob props");

    await client.evaluate("app.plugins.plugins['bob-ledger-tools'].propertyEditorModal?.close?.()");
    await shared.openNote(client, "projects-album/acceptance.md", "live");
    probe = await openPropertyEditor(client, "projects-album/acceptance.md", { key: "status" });
    await waitForEditor(client, (value) => value.rows.some((row) => row.key === "status"), "record property rows");
    await propertyRowClick(client, "status");
    await sendKey(client, "Enter");
    const handoff = await shared.waitFor(client,
      `Boolean(document.querySelector(".bob-record-card-modal"))`, Boolean, "record field handoff", 25_000);
    addCheck(report, "record-field handoff", handoff === true, "status handed off to the Record Card editor");

    await client.evaluate("app.plugins.plugins['bob-ledger-tools'].propertyEditorModal?.close?.()");
    await shared.openNote(client, "projects/project-note.md", "live");
    probe = await openPropertyEditor(client, "projects/project-note.md", { key: "project_digest" });
    probe = await waitForEditor(client, (value) => value.rows.some((row) => row.key === "project_digest"), "derived project property");
    const derived = probe.rows.find((row) => row.key === "project_digest");
    addCheck(report, "derived key locked", derived.action === "locked" && derived.disabled, derived);

    await client.evaluate("app.plugins.plugins['bob-ledger-tools'].propertyEditorModal?.close?.()");
    await shared.openNote(client, "invalid.md", "live");
    probe = await openPropertyEditor(client, "invalid.md", { resetCapability: true });
    probe = await waitForEditor(client, (value) => Boolean(value.recovery), "invalid YAML recovery banner");
    addCheck(report, "invalid YAML recovery", /Frontmatter doesn't parse/.test(probe.recovery), probe.recovery);

    await client.evaluate("app.plugins.plugins['bob-ledger-tools'].propertyEditorModal?.close?.()");
    fs.writeFileSync(oldFlag, "simulate old bob\n");
    await shared.openNote(client, "old-bob.md", "live");
    probe = await openPropertyEditor(client, "old-bob.md", { resetCapability: true });
    probe = await waitForEditor(client, (value) => /Update bob to edit properties here/.test(value.banner), "old bob read-only mode");
    if (!await propertyRowClick(client, "custom")) throw new Error("Old-bob cached property row missing");
    await sendKey(client, "Enter");
    await shared.sleep(250);
    probe = await waitForEditor(client, (value) => value.open, "old bob modal stays open");
    addCheck(report, "old-bob read-only", /Update bob to edit properties here/.test(probe.banner) && !probe.stage, probe);
    fs.rmSync(oldFlag, { force: true });

    await client.evaluate("app.plugins.plugins['bob-ledger-tools'].propertyEditorModal?.close?.()");
    await shared.openNote(client, "projects/project-note.md", "live");
    await openPropertyEditor(client, "projects/project-note.md");
    await shared.collapseSidebars(client);
    const screenshotSpecs = [
      [1400, "light", "wide-light"], [1400, "dark", "wide-dark"],
      [390, "light", "narrow-light"], [390, "dark", "narrow-dark"],
    ];
    for (const [width, theme, name] of screenshotSpecs) {
      await shared.setTheme(client, theme);
      await shared.setViewport(client, width, 900);
      const shot = await shared.capture(client, outDir, "property-editor-" + name, width, theme, "Live Preview");
      report.screenshots.push(shot);
      if (shot.bytes < 1000) throw new Error("Property Editor screenshot is unexpectedly small: " + name);
    }
    addCheck(report, "screenshots light dark narrow wide", report.screenshots.length === 4,
      report.screenshots.map(({ name, width, theme, bytes }) => ({ name, width, theme, bytes })));

    const logRows = fs.readFileSync(bobLog, "utf8").trim().split("\n").filter(Boolean).map((row) => JSON.parse(row));
    const updates = logRows.filter((row) => row.event === "start" && row.args?.[0] === "props" && row.args?.[1] === "update");
    addCheck(report, "writes use bob props update", updates.length >= 7 && updates.every((row) => row.args.includes("-i") && row.args.includes("-")),
      { count: updates.length, examples: updates.slice(0, 4).map((row) => row.args) });
    report.pluginErrors = report.consoleExceptions.filter((row) => /bob-ledger-tools|property/i.test(`${row.text} ${row.description} ${row.url}`));
    if (report.pluginErrors.length) throw new Error("Property Editor raised console exceptions: " + JSON.stringify(report.pluginErrors));
    report.pass = true;
    successful = true;
  } catch (error) {
    report.error = error && error.message ? error.message : String(error);
    report.scratch = scratch || null;
  } finally {
    if (client) client.close();
    if (child && child.exitCode == null) {
      try { child.kill("SIGTERM"); } catch (_) {}
      await shared.sleep(250);
      if (child.exitCode == null) { try { child.kill("SIGKILL"); } catch (_) {} }
    }
    report.finishedAt = new Date().toISOString();
    report.scratchPreserved = Boolean(scratch && !successful && fs.existsSync(scratch));
    if (successful && scratch) fs.rmSync(scratch, { recursive: true, force: true });
    report.assertionCounts = report.assertions.reduce((counts, item) => {
      counts[item.status] = (counts[item.status] || 0) + 1;
      return counts;
    }, {});
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  }
  process.stdout.write((report.pass ? "PASS" : "FAIL") + " Property Editor e2e (" + JSON.stringify(report.assertionCounts) + ")\n");
  process.stdout.write("Report: " + reportPath + "\nScreenshots: " + outDir + "\n");
  if (!report.pass) {
    process.stderr.write("- " + (report.error || "acceptance failed") + "\n");
    process.exitCode = 1;
  }
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
    try { lib.selfTest(); }
    catch (error) { process.stderr.write(String(error.stack || error) + "\n"); process.exitCode = 1; }
    return;
  }
  const timeout = setTimeout(() => {
    process.stderr.write("Property Editor acceptance exceeded " + OVERALL_TIMEOUT_MS + " ms\n");
    process.exit(1);
  }, OVERALL_TIMEOUT_MS);
  timeout.unref();
  await run(args);
}

if (require.main === module) void main(process.argv.slice(2));
module.exports = { run, parseArgs: lib.parseArgs };
