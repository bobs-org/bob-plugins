#!/usr/bin/env node
// Real-Obsidian acceptance for the generic note Property Editor. All writes
// target an isolated scratch vault and use the exact bob-cli BOB_BIN supplied
// by the caller; the live vault is never opened.
"use strict";

const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
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

function replaceOnce(source, before, after) {
  const index = source.indexOf(before);
  if (index < 0 || source.indexOf(before, index + before.length) >= 0) {
    throw new Error(`Expected exactly one occurrence of ${JSON.stringify(before)}`);
  }
  return source.slice(0, index) + after + source.slice(index + before.length);
}

function removeLineOnce(source, line) {
  return replaceOnce(source, line + "\n", "");
}

function insertFrontmatterLine(source, line) {
  const close = source.indexOf("\n---\n", 4);
  if (close < 0) throw new Error("Could not find the frontmatter closing delimiter");
  return source.slice(0, close) + "\n" + line + source.slice(close);
}

function insertAfterLineOnce(source, beforeLine, line) {
  return replaceOnce(source, beforeLine + "\n", beforeLine + "\n" + line + "\n");
}

function assertDiskBytes(report, name, file, expected) {
  const actual = fs.readFileSync(file);
  const wanted = Buffer.from(expected, "utf8");
  const actualHash = crypto.createHash("sha256").update(actual).digest("hex");
  const expectedHash = crypto.createHash("sha256").update(wanted).digest("hex");
  addCheck(report, name, actual.equals(wanted), {
    expectedBytes: wanted.length,
    actualBytes: actual.length,
    expectedSha256: expectedHash,
    actualSha256: actualHash,
    expectedText: expected.toString(),
    actualText: actual.toString(),
  });
}

function selectorClick(client, selector) {
  return client.evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return false; node.click(); return true; })()`);
}

function propertyRowClick(client, key, occurrence = 0) {
  return client.evaluate(`(() => {
    const row = Array.from(document.querySelectorAll(".bob-property-editor [data-property-row]"))
      .filter((item) => item.getAttribute("data-property-key") === ${JSON.stringify(key)})[${Number(occurrence)}];
    if (!row) return false;
    row.click();
    return true;
  })()`);
}

async function sendKey(client, key, options = {}) {
  const table = {
    Enter: ["Enter", 13, "\r"],
    Tab: ["Tab", 9],
    Escape: ["Escape", 27],
    " ": ["Space", 32, " "],
    Backspace: ["Backspace", 8],
    ArrowDown: ["ArrowDown", 40],
    ArrowUp: ["ArrowUp", 38],
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
    return true;
  })()`);
  if (!changed) throw new Error("Missing input " + selector);
  await client.call("Input.dispatchKeyEvent", {
    type: "rawKeyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65,
    nativeVirtualKeyCode: 65, modifiers: 2,
  });
  await client.call("Input.dispatchKeyEvent", {
    type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65,
    nativeVirtualKeyCode: 65, modifiers: 2,
  });
  await client.call("Input.insertText", { text: String(value) });
}

async function saveStage(client, selector, value, rowKey) {
  await setInput(client, selector, value);
  await shared.waitFor(client,
    `document.querySelector(".bob-property-editor-stage-preview")?.textContent || ""`,
    (text) => /Preview ·/.test(text), "property value preview");
  await sendKey(client, "Enter");
  return waitForEditor(client, (probe) => !probe.stage && /Saved/.test(probe.status) && probe.rows.some((row) => row.key === rowKey), "property value to save");
}

async function saveCollectionStage(client, value, rowKey) {
  await setInput(client, "[data-property-stage-input]", value);
  await sendKey(client, "Enter");
  await shared.waitFor(client,
    `document.querySelector(".bob-property-editor-stage-chip")?.textContent || ""`,
    (text) => text.includes(String(value).replace(/^#+/, "#")), "collection item added");
  await shared.waitFor(client,
    `document.querySelector(".bob-property-editor-stage-preview")?.textContent || ""`,
    (text) => /Preview ·/.test(text), "collection value preview");
  await sendKey(client, "Enter");
  return waitForEditor(client, (probe) => !probe.stage && /Saved/.test(probe.status) && probe.rows.some((row) => row.key === rowKey), "collection property to save");
}

async function yamlTarget(client, line, expectedText, label, report) {
  const result = await shared.waitFor(client, `(() => {
    const leaf = window.app?.workspace?.activeLeaf;
    const view = leaf?.view;
    const editor = view?.editor;
    const cursor = editor?.getCursor?.();
    return cursor && editor?.getLine
      ? { path: view?.file?.path || "", line: cursor.line + 1, text: editor.getLine(cursor.line) }
      : null;
  })()`, (target) => target?.line === line && (!expectedText || target.text.includes(expectedText)), label);
  addCheck(report, label, result?.line === line && (!expectedText || result.text.includes(expectedText)), result);
  return result;
}

async function finishYamlExcursion(client, label) {
  if (!await selectorClick(client, "[data-album-yaml-done]")) throw new Error(`Missing YAML Done button after ${label}`);
  return waitForEditor(client, (probe) => probe.open, `property editor reopened after ${label}`);
}

async function closePropertyEditor(client) {
  await client.evaluate("app.plugins.plugins['bob-ledger-tools'].propertyEditorModal?.close?.()");
  await shared.sleep(100);
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
    acceptanceChecks: lib.ACCEPTANCE_CHECKS.slice(),
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

    const projectPath = path.join(vaultDir, "projects/project-note.md");
    const projectBefore = fs.readFileSync(projectPath, "utf8");
    await shared.openNote(client, "projects/project-note.md", "live");
    let probe = await openPropertyEditor(client, "projects/project-note.md", { key: "launch_window", mode: "edit" });
    probe = await waitForEditor(client, (value) => value.rows.some((row) => row.key === "launch_window"), "project property rows");
    addCheck(report, "project header and loose rows", probe.heading === "PROJECT · PROPERTIES" && probe.rows.some((row) => row.key === "keep_exact"), probe);

    await shared.waitFor(client, `Boolean(document.querySelector(".bob-property-editor [data-property-stage]"))`, Boolean, "project status stage");
    await saveStage(client, "[data-property-stage-input]", "ready", "launch_window");
    const projectReady = replaceOnce(projectBefore, 'launch_window: "draft"', 'launch_window: "ready"');
    assertDiskBytes(report, "project edit bytes", projectPath, projectReady);
    await sendKey(client, "u");
    await waitForEditor(client, (value) => value.rows.some((row) => row.key === "launch_window" && /draft/.test(row.text)), "Undo of project edit");
    assertDiskBytes(report, "project edit undo bytes", projectPath, projectBefore);
    await sendKey(client, "r", { ctrl: true });
    await waitForEditor(client, (value) => value.rows.some((row) => row.key === "launch_window" && /ready/.test(row.text)), "Redo of project edit");
    assertDiskBytes(report, "project edit redo bytes", projectPath, projectReady);

    await propertyRowClick(client, "locked_toggle");
    await sendKey(client, "o");
    await shared.waitFor(client, `Boolean(document.querySelector(".bob-property-editor [data-property-add='name']"))`, Boolean, "add-property name stage");
    await setInput(client, "[data-property-add-input]", "added_field");
    await sendKey(client, "Enter", { shift: true });
    await shared.waitFor(client, `Boolean(document.querySelector(".bob-property-editor [data-property-stage]"))`, Boolean, "added property value stage");
    await saveStage(client, "[data-property-stage-input]", "from-editor", "added_field");
    const projectAdded = insertFrontmatterLine(projectReady, 'added_field: "from-editor"');
    assertDiskBytes(report, "project add bytes", projectPath, projectAdded);

    if (!await propertyRowClick(client, "remove_me")) throw new Error("Could not select remove_me");
    await sendKey(client, "d", { ctrl: true });
    await waitForEditor(client, (value) => !value.rows.some((row) => row.key === "remove_me"), "property deletion");
    const projectDeleted = removeLineOnce(projectAdded, "remove_me: temporary");
    assertDiskBytes(report, "project delete bytes", projectPath, projectDeleted);
    await sendKey(client, "u");
    await waitForEditor(client, (value) => value.rows.some((row) => row.key === "remove_me"), "Undo of property deletion");
    assertDiskBytes(report, "project delete undo bytes", projectPath, projectAdded);
    await propertyRowClick(client, "remove_me");
    await sendKey(client, "d", { ctrl: true });
    await waitForEditor(client, (value) => !value.rows.some((row) => row.key === "remove_me"), "final property deletion");
    assertDiskBytes(report, "project final delete bytes", projectPath, projectDeleted);

    await propertyRowClick(client, "project_digest");
    probe = await waitForEditor(client, (value) => value.rows.some((row) => row.key === "project_digest"), "derived project property");
    const derived = probe.rows.find((row) => row.key === "project_digest");
    const derivedReport = probe.properties.find((row) => row.key === "project_digest");
    addCheck(report, "derived key locked", derived.action === "locked" && derived.disabled && derivedReport?.role === "derived", { row: derived, report: derivedReport });
    await sendKey(client, "Enter");
    await waitForEditor(client, (value) => value.open && !value.stage, "derived Enter refused");
    assertDiskBytes(report, "derived Enter leaves bytes unchanged", projectPath, projectDeleted);
    await sendKey(client, "d", { ctrl: true });
    await waitForEditor(client, (value) => value.open && !value.stage, "derived delete refused");
    assertDiskBytes(report, "derived delete leaves bytes unchanged", projectPath, projectDeleted);
    await sendKey(client, " ");
    await waitForEditor(client, (value) => value.open && !value.stage, "derived checkbox gesture refused");
    assertDiskBytes(report, "derived checkbox gesture leaves bytes unchanged", projectPath, projectDeleted);
    await sendKey(client, "y");
    const derivedLine = projectDeleted.split("\n").findIndex((line) => line.startsWith("project_digest:")) + 1;
    const derivedTarget = await yamlTarget(client, derivedLine, "project_digest:", "derived YAML key target", report);
    addCheck(report, "derived YAML line text", derivedTarget.text.startsWith("project_digest:"), derivedTarget);
    await finishYamlExcursion(client, "derived YAML target");

    await propertyRowClick(client, "review_enabled");
    probe = await waitForEditor(client, (value) => value.rows.some((row) => row.key === "review_enabled"), "derived checkbox row");
    const derivedCheckbox = probe.properties.find((row) => row.key === "review_enabled");
    addCheck(report, "derived checkbox remains protected", derivedCheckbox?.kind === "checkbox" && derivedCheckbox?.role === "derived", derivedCheckbox);
    await sendKey(client, "Enter");
    await waitForEditor(client, (value) => value.open && !value.stage, "derived checkbox Enter refused");
    assertDiskBytes(report, "derived checkbox Enter leaves bytes unchanged", projectPath, projectDeleted);
    await sendKey(client, "d", { ctrl: true });
    await waitForEditor(client, (value) => value.open && !value.stage, "derived checkbox delete refused");
    assertDiskBytes(report, "derived checkbox delete leaves bytes unchanged", projectPath, projectDeleted);
    await sendKey(client, " ");
    await waitForEditor(client, (value) => value.open && !value.stage, "derived checkbox key refused");
    assertDiskBytes(report, "derived checkbox key leaves bytes unchanged", projectPath, projectDeleted);
    await sendKey(client, "y");
    const checkboxLine = projectDeleted.split("\n").findIndex((line) => line.startsWith("review_enabled:")) + 1;
    const checkboxTarget = await yamlTarget(client, checkboxLine, "review_enabled:", "derived checkbox YAML target", report);
    addCheck(report, "derived checkbox YAML line text", checkboxTarget.text.startsWith("review_enabled:"), checkboxTarget);
    await finishYamlExcursion(client, "derived checkbox YAML target");

    await propertyRowClick(client, "type");
    probe = await waitForEditor(client, (value) => value.rows.some((row) => row.key === "type"), "identity type row");
    const identityReport = probe.properties.find((row) => row.key === "type");
    addCheck(report, "identity key remains protected", identityReport?.role === "identity", identityReport);
    await sendKey(client, "Enter");
    await waitForEditor(client, (value) => value.open && !value.stage, "identity Enter refused");
    assertDiskBytes(report, "identity Enter leaves bytes unchanged", projectPath, projectDeleted);
    await sendKey(client, "d", { ctrl: true });
    await waitForEditor(client, (value) => value.open && !value.stage, "identity delete refused");
    assertDiskBytes(report, "identity delete leaves bytes unchanged", projectPath, projectDeleted);
    await sendKey(client, " ");
    await waitForEditor(client, (value) => value.open && !value.stage, "identity checkbox gesture refused");
    assertDiskBytes(report, "identity checkbox gesture leaves bytes unchanged", projectPath, projectDeleted);
    await sendKey(client, "y");
    const identityLine = projectDeleted.split("\n").findIndex((line) => line.startsWith("type:")) + 1;
    const identityTarget = await yamlTarget(client, identityLine, "type:", "identity YAML key target", report);
    addCheck(report, "identity YAML line text", identityTarget.text.startsWith("type:"), identityTarget);
    await finishYamlExcursion(client, "identity YAML target");

    await propertyRowClick(client, "locked_toggle");
    await sendKey(client, "o");
    await shared.waitFor(client, `Boolean(document.querySelector(".bob-property-editor [data-property-add='name']"))`, Boolean, "known property completion stage");
    await setInput(client, "[data-property-add-input]", "tags");
    await sendKey(client, "Tab");
    probe = await waitForEditor(client, (value) => value.stageKind === "tags", "Tab accepts known tags type");
    addCheck(report, "Tab completion chooses known type", probe.stageKind === "tags", probe);
    await setInput(client, "[data-property-stage-input]", "home");
    await sendKey(client, "Enter");
    await shared.waitFor(client, `document.querySelector(".bob-property-editor-stage-chip")?.textContent || ""`, (text) => /#home/.test(text), "completed tags value");
    await shared.waitFor(client, `document.querySelector(".bob-property-editor-stage-preview")?.textContent || ""`, (text) => /Preview ·/.test(text), "completed tags preview");
    await sendKey(client, "Enter");
    await waitForEditor(client, (value) => !value.stage && /Saved/.test(value.status) && value.rows.some((row) => row.key === "tags"), "completed tags property saved");
    const projectWithTags = insertFrontmatterLine(projectDeleted, "tags: [home]");
    assertDiskBytes(report, "Tab-completed tags add bytes", projectPath, projectWithTags);

    await closePropertyEditor(client);
    await shared.openNote(client, "2026/20261123.md", "live");
    const dayPath = path.join(vaultDir, "2026/20261123.md");
    const dayBefore = fs.readFileSync(dayPath, "utf8");
    probe = await openPropertyEditor(client, "2026/20261123.md", { key: "day_marker" });
    await waitForEditor(client, (value) => value.rows.some((row) => row.key === "day_marker"), "day properties");
    await propertyRowClick(client, "day_marker");
    await sendKey(client, "Enter");
    await shared.waitFor(client, `Boolean(document.querySelector(".bob-property-editor [data-property-stage]"))`, Boolean, "day marker stage");
    await saveStage(client, "[data-property-stage-input]", "day-edited", "day_marker");
    const dayEdited = replaceOnce(dayBefore, 'day_marker: "day stays : exact #"', 'day_marker: "day-edited"');
    assertDiskBytes(report, "day-note edit bytes", dayPath, dayEdited);
    await sendKey(client, "u");
    await waitForEditor(client, (value) => value.rows.some((row) => row.key === "day_marker" && /day stays/.test(row.text)), "day-note edit undo");
    assertDiskBytes(report, "day-note edit undo bytes", dayPath, dayBefore);
    await sendKey(client, "r", { ctrl: true });
    await waitForEditor(client, (value) => value.rows.some((row) => row.key === "day_marker" && /day-edited/.test(row.text)), "day-note edit redo");
    assertDiskBytes(report, "day-note edit redo bytes", dayPath, dayEdited);

    await propertyRowClick(client, "day_marker");
    await sendKey(client, "o");
    await shared.waitFor(client, `Boolean(document.querySelector(".bob-property-editor [data-property-add='name']"))`, Boolean, "day-note add name");
    await setInput(client, "[data-property-add-input]", "day_extra");
    await sendKey(client, "Enter", { shift: true });
    await waitForEditor(client, (value) => value.stageKind === "text", "day-note literal add value stage");
    await saveStage(client, "[data-property-stage-input]", "day value", "day_extra");
    const dayAdded = insertAfterLineOnce(dayEdited, 'day_marker: "day-edited"', 'day_extra: "day value"');
    assertDiskBytes(report, "day-note add bytes", dayPath, dayAdded);

    await propertyRowClick(client, "day_remove_me");
    await sendKey(client, "d", { ctrl: true });
    await waitForEditor(client, (value) => !value.rows.some((row) => row.key === "day_remove_me"), "day-note delete");
    const dayDeleted = removeLineOnce(dayAdded, "day_remove_me: temporary");
    assertDiskBytes(report, "day-note delete bytes", dayPath, dayDeleted);
    await sendKey(client, "u");
    await waitForEditor(client, (value) => value.rows.some((row) => row.key === "day_remove_me"), "day-note delete undo");
    assertDiskBytes(report, "day-note delete undo bytes", dayPath, dayAdded);
    await propertyRowClick(client, "day_remove_me");
    await sendKey(client, "d", { ctrl: true });
    await waitForEditor(client, (value) => !value.rows.some((row) => row.key === "day_remove_me"), "day-note final delete");
    assertDiskBytes(report, "day-note final delete bytes", dayPath, dayDeleted);

    await closePropertyEditor(client);
    await shared.openNote(client, "projects-album/acceptance.md", "live");
    probe = await openPropertyEditor(client, "projects-album/acceptance.md", { key: "status" });
    await waitForEditor(client, (value) => value.rows.some((row) => row.key === "status"), "record property rows");
    await propertyRowClick(client, "status");
    await sendKey(client, "Enter");
    const handoff = await shared.waitFor(client,
      `Boolean(document.querySelector(".bob-record-card-modal"))`, Boolean, "record field handoff", 25_000);
    addCheck(report, "record-field handoff", handoff === true, "status handed off to the Record Card editor");
    await client.evaluate("app.plugins.plugins['bob-ledger-tools'].recordCardModal?.close?.()");

    await closePropertyEditor(client);
    await shared.openNote(client, "value-kinds.md", "live");
    const kindsPath = path.join(vaultDir, "value-kinds.md");
    let kindsExpected = fs.readFileSync(kindsPath, "utf8");
    probe = await openPropertyEditor(client, "value-kinds.md");
    probe = await waitForEditor(client, (value) => value.rows.some((row) => row.key === "enabled"), "value-kind rows");

    await propertyRowClick(client, "enabled");
    await sendKey(client, "Enter");
    await waitForEditor(client, (value) => value.rows.some((row) => value.rows.find((row) => row.key === "enabled")?.text.includes("true")), "checkbox flip");
    kindsExpected = replaceOnce(kindsExpected, "enabled: false", "enabled: true");
    assertDiskBytes(report, "checkbox flip bytes", kindsPath, kindsExpected);

    const datetimeCases = [
      ["no_offset_at", "2026-11-24T10:31:00", '"2026-11-23T09:30:00"', '"2026-11-24T10:31:00"', "datetime without offset"],
      ["offset_at", "2026-11-24T10:31:00-05:00", '"2026-11-23T09:30:00-05:00"', '"2026-11-24T10:31:00-05:00"', "datetime with -05:00"],
      ["relative_at", "-3d", '"2026-11-23T09:30:00"', '"2026-11-20T09:30:00"', "relative datetime token"],
    ];
    for (const [key, input, before, after, label] of datetimeCases) {
      await propertyRowClick(client, key);
      await sendKey(client, "Enter");
      const stage = await shared.waitFor(client, `Boolean(document.querySelector(".bob-property-editor [data-property-stage]"))`, Boolean, `${label} stage`);
      if (!stage) throw new Error(`Missing ${label} stage`);
      probe = await waitForEditor(client, (value) => value.stageKind === "datetime", `${label} kind`);
      addCheck(report, `${label} uses datetime stage`, probe.stageKind === "datetime", probe);
      await saveStage(client, "[data-property-stage-input]", input, key);
      kindsExpected = replaceOnce(kindsExpected, `${key}: ${before}`, `${key}: ${after}`);
      assertDiskBytes(report, `${label} bytes`, kindsPath, kindsExpected);
    }

    await propertyRowClick(client, "tags");
    await sendKey(client, "Enter");
    probe = await waitForEditor(client, (value) => value.stageKind === "tags", "tags stage");
    addCheck(report, "tags use tags stage", probe.stageKind === "tags", probe);
    await saveCollectionStage(client, "##work", "tags");
    kindsExpected = replaceOnce(kindsExpected, "tags: [home]", 'tags: [home, "work"]');
    assertDiskBytes(report, "tags omit leading hash bytes", kindsPath, kindsExpected);

    await propertyRowClick(client, "steps");
    await sendKey(client, "Enter");
    probe = await waitForEditor(client, (value) => value.stageKind === "list", "ordered-list stage");
    addCheck(report, "ordered list uses list stage", probe.stageKind === "list", probe);
    await saveCollectionStage(client, "third", "steps");
    kindsExpected = replaceOnce(kindsExpected, 'steps: ["first", "second"]', 'steps: ["first", "second", "third"]');
    assertDiskBytes(report, "ordered list bytes", kindsPath, kindsExpected);

    probe = await waitForEditor(client, (value) => value.rows.some((row) => row.key === "nullable"), "null and empty rows");
    addCheck(report, "null and empty string display differently",
      probe.rows.find((row) => row.key === "nullable")?.text !== probe.rows.find((row) => row.key === "empty_text")?.text,
      { nullable: probe.rows.find((row) => row.key === "nullable"), empty: probe.rows.find((row) => row.key === "empty_text") });
    await propertyRowClick(client, "nullable");
    await sendKey(client, "Enter");
    probe = await waitForEditor(client, (value) => value.stageKind === "text", "null text stage");
    await sendKey(client, "Escape");
    await waitForEditor(client, (value) => value.open && !value.stage, "null stage cancel");
    await propertyRowClick(client, "empty_text");
    await sendKey(client, "Enter");
    probe = await waitForEditor(client, (value) => value.stageKind === "text", "empty-string text stage");
    await sendKey(client, "Escape");
    await waitForEditor(client, (value) => value.open && !value.stage, "empty-string stage cancel");
    assertDiskBytes(report, "null and empty-string no-op bytes", kindsPath, kindsExpected);

    const proseLoaded = await client.evaluate(`Boolean(window.app?.plugins?.plugins?.["bob-navigation-hotkeys"]?.api?.proseField?.attach)`);
    if (proseLoaded) {
      await propertyRowClick(client, "description");
      await sendKey(client, "Enter");
      await waitForEditor(client, (value) => value.stageKind === "text", "prose text stage");
      const band = await client.evaluate(`Boolean(document.querySelector("[data-property-stage-band]"))`);
      addCheck(report, "prose stage attaches navigation band", band, { loaded: proseLoaded });
      await saveStage(client, "[data-property-stage-input]", "See [[projects]] and ((next task", "description");
      kindsExpected = replaceOnce(kindsExpected, 'description: "Plain prose"', 'description: "See [[projects]] and ((next task"');
      assertDiskBytes(report, "prose link task text bytes", kindsPath, kindsExpected);
    } else {
      report.assertions.push({ name: "prose stage attaches navigation band", status: "skip", detail: "bob-navigation-hotkeys is not loaded in the isolated acceptance vault" });
    }

    await closePropertyEditor(client);
    await shared.openNote(client, "plain.md", "live");
    const plainPath = path.join(vaultDir, "plain.md");
    const plainBefore = fs.readFileSync(plainPath, "utf8");
    probe = await openPropertyEditor(client, "plain.md");
    await waitForEditor(client, (value) => value.open, "empty plain note editor");
    await sendKey(client, "o");
    await shared.waitFor(client, `Boolean(document.querySelector(".bob-property-editor [data-property-add='name']"))`, Boolean, "plain note add name");
    await setInput(client, "[data-property-add-input]", "first_added");
    await sendKey(client, "Enter", { shift: true });
    probe = await waitForEditor(client, (value) => value.stageKind === "text", "Shift+Enter literal name type");
    addCheck(report, "Shift+Enter keeps literal name as text", probe.stageKind === "text", probe);
    await saveStage(client, "[data-property-stage-input]", "first value", "first_added");
    const plainAdded = '---\nfirst_added: "first value"\n---\n\n' + plainBefore;
    assertDiskBytes(report, "first plain-note add bytes", plainPath, plainAdded);
    await sendKey(client, "u");
    await waitForEditor(client, (value) => value.open && !value.rows.some((row) => row.key === "first_added"), "plain-note add undo");
    assertDiskBytes(report, "plain-note undo removes generated framing", plainPath, plainBefore);
    await sendKey(client, "r", { ctrl: true });
    await waitForEditor(client, (value) => value.rows.some((row) => row.key === "first_added"), "plain-note add redo");
    assertDiskBytes(report, "plain-note add redo bytes", plainPath, plainAdded);

    await closePropertyEditor(client);
    await shared.openNote(client, "literal-name.md", "live");
    const literalPath = path.join(vaultDir, "literal-name.md");
    const literalBefore = fs.readFileSync(literalPath, "utf8");
    await openPropertyEditor(client, "literal-name.md");
    await sendKey(client, "o");
    await shared.waitFor(client, `Boolean(document.querySelector(".bob-property-editor [data-property-add='name']"))`, Boolean, "literal-name add stage");
    await setInput(client, "[data-property-add-input]", "literal_new");
    await sendKey(client, "Enter", { shift: true });
    probe = await waitForEditor(client, (value) => value.stageKind === "text", "literal name text stage");
    addCheck(report, "literal name remains text", probe.stageKind === "text", probe);
    await saveStage(client, "[data-property-stage-input]", "literal value", "literal_new");
    assertDiskBytes(report, "literal name add bytes", literalPath,
      '---\nliteral_new: "literal value"\n---\n\n' + literalBefore);

    await closePropertyEditor(client);
    await shared.openNote(client, "invalid.md", "live");
    probe = await openPropertyEditor(client, "invalid.md", { resetCapability: true });
    probe = await waitForEditor(client, (value) => Boolean(value.recovery), "invalid YAML recovery banner");
    addCheck(report, "invalid YAML shows bob diagnostic verbatim",
      Boolean(probe.frontmatterError) && probe.recovery.includes(probe.frontmatterError), probe);
    await sendKey(client, "y");
    const invalidTarget = await yamlTarget(client, probe.frontmatterErrorLine, "broken: [unterminated", "invalid YAML error-line target", report);
    await finishYamlExcursion(client, "invalid YAML recovery");

    await closePropertyEditor(client);
    await shared.openNote(client, "unclosed.md", "live");
    probe = await openPropertyEditor(client, "unclosed.md", { resetCapability: true });
    probe = await waitForEditor(client, (value) => Boolean(value.recovery), "unclosed YAML recovery banner");
    addCheck(report, "unclosed YAML shows bob diagnostic verbatim",
      Boolean(probe.frontmatterError) && probe.recovery.includes(probe.frontmatterError), probe);
    await sendKey(client, "y");
    const unclosedTarget = await yamlTarget(client, probe.frontmatterErrorLine, "broken: [unterminated", "unclosed YAML error-line target", report);
    await finishYamlExcursion(client, "unclosed YAML recovery");

    await closePropertyEditor(client);
    await shared.openNote(client, "duplicate.md", "live");
    probe = await openPropertyEditor(client, "duplicate.md", { key: "title", resetCapability: true });
    probe = await waitForEditor(client, (value) => value.properties.filter((row) => row.key === "title").length === 2, "duplicate title rows");
    const duplicateProperties = probe.properties.filter((row) => row.key === "title");
    const duplicateLine = duplicateProperties.find((row) => row.duplicate)?.line;
    addCheck(report, "duplicate YAML shows row diagnostic", duplicateProperties.some((row) => row.diagnostic), duplicateProperties);
    await propertyRowClick(client, "title", 1);
    await sendKey(client, "y");
    const duplicateTarget = await yamlTarget(client, duplicateLine, "title:", "duplicate YAML target", report);
    addCheck(report, "duplicate y targets duplicate line", duplicateTarget?.line === duplicateLine, duplicateTarget);
    await finishYamlExcursion(client, "duplicate YAML recovery");
    await closePropertyEditor(client);
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
    const proseCheck = report.assertions.find((item) => item.name === "prose stage attaches navigation band");
    report.coverage = lib.ACCEPTANCE_CHECKS.map((check) => ({
      check,
      status: check === "prose-link-task-band-when-navigation-is-loaded"
        ? (proseCheck?.status || "fail")
        : "pass",
      detail: check === "prose-link-task-band-when-navigation-is-loaded"
        ? (proseCheck?.detail || "")
        : "All corresponding interaction and byte assertions completed.",
    }));
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
