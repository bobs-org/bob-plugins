#!/usr/bin/env node
// Real-Obsidian proof that production album/record/temporal adapters own the
// native Properties container in Live Preview and Reading, restore it on every
// fail-open path, and route Add file property into the property editor. Uses a
// disposable Git vault and profile, an owned Obsidian process under Xvfb, and
// the current-checkout bob binary. Never opens the live vault. Never calls
// propertyCardOwnFrontmatter from the test — adapters must own the mount.
"use strict";

const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const lib = require("./obsidian-frontmatter-takeover-e2e-lib.cjs");
const shared = require("./obsidian-record-card-e2e.cjs");

const repoRoot = path.resolve(__dirname, "..");
const ELECTRON_FALLBACK = "/snap/obsidian/current/app/obsidian";
const PLUGIN_ID = "bob-ledger-tools";
const FIXTURE_TODAY = "2026-11-20";
const OVERALL_TIMEOUT_MS = 1_200_000;
const COMMAND_ID = "markdown:add-metadata-property";
const MODE_STATE = {
  live: { mode: "source", source: false },
  source: { mode: "source", source: true },
  reading: { mode: "preview" },
};
const { sleep, waitFor } = shared;
const P = lib.PATHS;

function fail(message, code = 1) {
  process.stderr.write(String(message) + "\n");
  process.exit(code);
}

function pluginProvenance() {
  const git = (args) => String(spawnSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" }).stdout || "");
  const dir = path.join(repoRoot, "plugins", PLUGIN_ID);
  const files = {};
  for (const name of ["manifest.json", "main.js", "styles.css"]) files[name] = shared.sha256File(path.join(dir, name));
  return {
    head: git(["rev-parse", "HEAD"]).trim() || null,
    dirtyPaths: git(["status", "--porcelain"]).split("\n").filter(Boolean),
    version: JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")).version,
    files,
  };
}

function installVault(vaultDir) {
  const obsidian = path.join(vaultDir, ".obsidian");
  const dest = path.join(obsidian, "plugins", PLUGIN_ID);
  fs.mkdirSync(dest, { recursive: true });
  for (const name of ["manifest.json", "main.js", "styles.css"]) {
    fs.copyFileSync(path.join(repoRoot, "plugins", PLUGIN_ID, name), path.join(dest, name));
  }
  fs.writeFileSync(path.join(obsidian, "community-plugins.json"), JSON.stringify([PLUGIN_ID], null, 2));
  fs.writeFileSync(path.join(obsidian, "core-plugins.json"), JSON.stringify([
    "file-explorer", "command-palette", "page-preview", "properties", "canvas",
  ], null, 2));
  fs.writeFileSync(path.join(obsidian, "app.json"), JSON.stringify({
    livePreview: true, showInlineTitle: true, propertiesInDocument: "visible", readableLineLength: true,
    vimMode: true, showLineNumber: false, alwaysUpdateLinks: false,
  }, null, 2));
  fs.writeFileSync(path.join(obsidian, "appearance.json"), JSON.stringify({ cssTheme: "", theme: "moonstone" }, null, 2));
  fs.writeFileSync(path.join(dest, "data.json"), JSON.stringify({ albumChips: true }, null, 2));
}

function writeControl(file, mode, extra = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ mode, ...extra, at: new Date().toISOString() }) + "\n");
}

function writeBobShim(shimDir, logPath, controlPath, realBob) {
  fs.mkdirSync(shimDir, { recursive: true });
  const file = path.join(shimDir, "bob");
  fs.writeFileSync(file, `#!/usr/bin/env node
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
const controlPath = ${JSON.stringify(controlPath)};
const logPath = ${JSON.stringify(logPath)};
const real = ${JSON.stringify(realBob)};
const inputFlag = args.findIndex((arg, index) => (arg === "-i" || arg === "--input") && args[index + 1] === "-");
const input = inputFlag >= 0 ? fs.readFileSync(0, "utf8") : undefined;
const append = (row) => { try { fs.appendFileSync(logPath, JSON.stringify(row) + "\\n"); } catch (_) {} };
let control = { mode: "pass" };
try { control = JSON.parse(fs.readFileSync(controlPath, "utf8")); } catch (_) {}
append({ event: "start", pid: process.pid, at: new Date().toISOString(), args, input, mode: control.mode || "pass" });
const isShow = args[0] === "props" && args[1] === "show";
const sleep = (ms) => { const end = Date.now() + ms; while (Date.now() < end) {} };
if (isShow && control.mode === "hold") {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try { control = JSON.parse(fs.readFileSync(controlPath, "utf8")); } catch (_) {}
    if (control.mode !== "hold") break;
    sleep(200);
  }
}
if (isShow && control.mode === "delay") sleep(Number(control.delayMs) || 8000);
if (isShow && control.mode === "old") {
  const stderr = "error: unrecognized subcommand 'props'\\n\\nUsage: bob [OPTIONS] <COMMAND>\\n\\nFor more information, try '--help'.\\n";
  append({ event: "finish", args, exitCode: 2, stderr, oldBob: true });
  process.stderr.write(stderr);
  process.exit(2);
}
if (isShow && control.mode === "fail") {
  const stderr = "error: could not contact bob\\n";
  append({ event: "finish", args, exitCode: 1, stderr, failed: true });
  process.stderr.write(stderr);
  process.exit(1);
}
const result = spawnSync(real, args, {
  encoding: "utf8", env: process.env, input, timeout: 90000, maxBuffer: 32 * 1024 * 1024,
});
append({ event: "finish", pid: process.pid, args, exitCode: result.status });
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status == null ? 1 : result.status);
`);
  fs.chmodSync(file, 0o755);
  return file;
}

function hashFixtures(vaultDir, names) {
  return Object.fromEntries(names.map((name) => {
    const file = path.join(vaultDir, name);
    return [name, fs.existsSync(file) ? shared.sha256File(file) : null];
  }));
}

function sha256Text(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function readInvocations(logPath) {
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch (_) { return { raw: line }; }
  });
}

function paintSpawned(invocations) {
  return invocations.filter((row) => {
    if (!row || row.event !== "start" || !Array.isArray(row.args)) return false;
    const args = row.args;
    if (args[0] === "props" && args[1] === "show") return false;
    if (args[0] === "albums" && (args[1] === "list" || args[1] === "sync")) return false;
    if (args[0] === "--version") return false;
    return true;
  });
}

function makePage(ctx) {
  const ev = (expression, timeoutMs = 30_000) => ctx.client.evaluate(expression, timeoutMs);
  const json = (value) => JSON.stringify(value);
  const page = {
    ev,
    install: async () => { await ev(lib.PROBE_SOURCE); },
    settle: async (ms = 350) => {
      await ev("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
      await sleep(ms);
    },
    probe: (leafId) => ev("window.__bobFrontmatterTakeover.leaf(" + json(leafId) + ")"),
    commands: () => ev("window.__bobFrontmatterTakeover.commands()"),
    active: () => ev("window.__bobFrontmatterTakeover.active()"),
    mainLeaf: () => ev("(() => { const leaf = app.workspace.getLeaf(false); app.workspace.setActiveLeaf(leaf, { focus: true }); return leaf.id; })()"),
    open: async (leafId, notePath, mode) => {
      const result = await ev(`(async () => {
        const leaf = app.workspace.getLeafById(${json(leafId)});
        const file = app.vault.getAbstractFileByPath(${json(notePath)});
        if (!leaf || !file) return { ok: false, error: "missing leaf or file" };
        const state = ${json(MODE_STATE[mode] || null)};
        await leaf.openFile(file, Object.assign({ active: true }, state ? { state } : {}));
        if (state && leaf.view && leaf.view.setState) {
          await leaf.view.setState(Object.assign({}, leaf.view.getState(), state), { history: false });
        }
        app.workspace.setActiveLeaf(leaf, { focus: true });
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return { ok: true, path: leaf.view && leaf.view.file ? leaf.view.file.path : null };
      })()`);
      if (!result || !result.ok) throw new Error("open " + notePath + " failed: " + JSON.stringify(result));
      return result;
    },
    setMode: async (leafId, mode) => {
      const result = await ev(`(async () => {
        const leaf = app.workspace.getLeafById(${json(leafId)});
        await leaf.view.setState(Object.assign({}, leaf.view.getState(), ${json(MODE_STATE[mode])}), { history: false });
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const view = leaf.view;
        if (view.getMode && view.getMode() === "preview") return "reading";
        const state = typeof view.getState === "function" ? view.getState() : {};
        return state && state.source ? "source" : "live";
      })()`);
      if (result !== mode) throw new Error("mode switch to " + mode + " landed on " + result);
      return result;
    },
    waitOwned: async (leafId, mode, label, timeoutMs = 20_000) => {
      const deadline = Date.now() + timeoutMs;
      let last = null;
      while (Date.now() < deadline) {
        last = await page.probe(leafId);
        if (lib.ownedFailures(last, mode).length === 0) return last;
        await sleep(150);
      }
      throw new Error((label || "ownership") + " timed out: " + JSON.stringify(last));
    },
    waitNative: async (leafId, label, timeoutMs = 15_000) => {
      const deadline = Date.now() + timeoutMs;
      let last = null;
      while (Date.now() < deadline) {
        last = await page.probe(leafId);
        if (lib.nativeFailures(last, label).length === 0) return last;
        await sleep(150);
      }
      throw new Error((label || "native restore") + " timed out: " + JSON.stringify(last));
    },
    waitCapability: async (status, timeoutMs = 20_000) => {
      const deadline = Date.now() + timeoutMs;
      let last = null;
      while (Date.now() < deadline) {
        last = await ev(`(() => {
          const plugin = app.plugins.plugins[${json(PLUGIN_ID)}];
          if (!plugin) return null;
          const key = plugin.propertyCapabilityCurrentBobKey();
          return plugin.propertyCapabilityState(key);
        })()`);
        if (last && last.status === status) return last;
        await sleep(150);
      }
      throw new Error("capability " + status + " timed out: " + JSON.stringify(last));
    },
    keys: async (key, modifiers = 0) => {
      const code = /^[a-z]$/i.test(key) ? "Key" + key.toUpperCase()
        : (key === "Enter" || key === "Escape" ? key : key);
      const text = !modifiers && key.length === 1 ? key : key === "Enter" ? "\r" : "";
      const payload = { key, code, modifiers, windowsVirtualKeyCode: 0, nativeVirtualKeyCode: 0 };
      if (text) { payload.text = text; payload.unmodifiedText = text; }
      await ctx.client.call("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...payload });
      await sleep(24);
      await ctx.client.call("Input.dispatchKeyEvent", { type: "keyUp", ...payload });
      await sleep(80);
    },
    shot: async (name, tags, width) => {
      const theme = (await ev("document.body.classList.contains('theme-dark')")) ? "dark" : "light";
      const row = await shared.capture(ctx.client, ctx.outDir, name, width || 1400, theme, tags.join(" "));
      row.tags = tags;
      ctx.report.screenshots.push(row);
      return row;
    },
    closeEditor: async () => {
      await ev(`(() => {
        const editor = document.querySelector(".bob-property-editor");
        if (!editor) return false;
        const close = editor.querySelector(".modal-close-button, .bob-property-editor-close, [data-property-close]");
        if (close) { close.click(); return true; }
        return false;
      })()`);
      await page.keys("Escape");
      await page.settle(150);
    },
    writeConfig: (bobPath) => {
      const configDir = path.join(ctx.profileDir, ".config", "bob");
      fs.mkdirSync(configDir, { recursive: true });
      const file = path.join(configDir, "config.yml");
      if (!bobPath) {
        if (fs.existsSync(file)) fs.unlinkSync(file);
        return file;
      }
      fs.writeFileSync(file, "stats:\n  bob_path: " + JSON.stringify(bobPath) + "\n");
      return file;
    },
  };
  return page;
}

async function run(args) {
  const report = {
    startedAt: new Date().toISOString(), checks: [], screenshots: [], consoleExceptions: [], consoleErrors: [],
    prerequisites: [], measurements: {}, bobInvocations: { count: 0 }, pluginSource: pluginProvenance(),
    addFilePropertyCommand: null,
  };
  const outDir = path.resolve(args.out || path.join(os.tmpdir(), "bob-frontmatter-takeover-e2e-shots-" + crypto.randomBytes(4).toString("hex")));
  const reportPath = path.resolve(args.report || path.join(outDir, "frontmatter-takeover-report.json"));
  Object.assign(report, { reportPath, screenshotDirectory: outDir });
  let scratch = "";
  let child = null;
  let client = null;
  const check = (name, ok, detail = {}, mandatory = true) => {
    report.checks.push({
      name, surface: lib.surfaceOf(name), status: ok ? "pass" : "fail", mandatory,
      detail: typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 24_000),
    });
    return ok;
  };
  const attempt = async (name, fn) => {
    try {
      const result = await fn();
      check(name, Boolean(result && result.ok !== false && (result.ok === true || result.ok === undefined || result.failures === undefined || result.failures.length === 0)), result || {});
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
    fs.accessSync(executable, fs.constants.X_OK);
    const help = spawnSync(executable, ["--help"], { encoding: "utf8", timeout: 20_000 });
    if (/unable to find Obsidian/i.test(String(help.stdout || "") + String(help.stderr || ""))) {
      throw new Error("This is the Obsidian CLI shim, not the Electron application.");
    }
    report.prerequisites.push({ name: "Obsidian-Electron-and-Xvfb-host", status: "pass", detail: { executable, display: process.env.DISPLAY || "" } });

    const notes = lib.fixtureNotes();
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "bob-frontmatter-takeover-e2e-"));
    const vaultDir = path.join(scratch, "vault");
    const profileDir = path.join(scratch, "profile");
    const shimDir = path.join(profileDir, "shim");
    const altShimDir = path.join(profileDir, "shim-alt");
    const bobLog = path.join(profileDir, "bob-invocations.jsonl");
    const controlPath = path.join(profileDir, "bob-control.json");
    fs.mkdirSync(vaultDir, { recursive: true });
    fs.mkdirSync(profileDir, { recursive: true });
    for (const [name, content] of Object.entries(notes)) shared.writeNote(vaultDir, name, content);
    shared.writeNote(vaultDir, "board.canvas", lib.canvasFixture());
    installVault(vaultDir);
    writeControl(controlPath, "pass");
    const shim = writeBobShim(shimDir, bobLog, controlPath, bob.path);
    writeBobShim(altShimDir, bobLog, controlPath, bob.path);
    shared.initScratchGit(vaultDir);
    const vaultReal = fs.realpathSync(vaultDir);
    shared.seedProfile(profileDir, vaultReal);
    const names = Object.keys(notes).sort();
    report.fixtures = { names, expected: Object.fromEntries(names.map((name) => [name, sha256Text(notes[name])])), seeded: hashFixtures(vaultReal, names) };
    report.scratch = { root: scratch, vault: vaultReal, profile: profileDir };

    const port = await shared.freePort();
    child = spawn(executable, [
      "--no-sandbox", "--user-data-dir=" + profileDir, "--remote-debugging-port=" + port,
      "--remote-allow-origins=http://127.0.0.1/*", vaultReal,
    ], {
      cwd: os.tmpdir(), stdio: ["ignore", "ignore", "pipe"],
      env: {
        ...process.env, HOME: profileDir, BOB_DIR: vaultReal, BOB_NOW: FIXTURE_TODAY + " 12:00:00",
        BOB_CONFIG_FILE: path.join(profileDir, "missing-test-config.yml"),
        PATH: shimDir + path.delimiter + (process.env.PATH || ""), TMPDIR: "/tmp", NO_COLOR: "1",
      },
    });
    child.stderr.on("data", () => {});
    report.obsidianProcess = { pid: child.pid, executable, debugPort: port };
    const target = await shared.selectTarget(port, vaultReal, () => child && child.exitCode == null);
    client = target.client;
    client.on("Runtime.exceptionThrown", (params) => {
      const details = params.exceptionDetails || {};
      report.consoleExceptions.push({ text: details.text || "", description: details.exception?.description || "", url: details.url || "", lineNumber: details.lineNumber || null });
    });
    client.on("Runtime.consoleAPICalled", (params) => {
      if (params.type === "error") report.consoleErrors.push((params.args || []).map((arg) => arg.value ?? arg.description ?? "").join(" ").slice(0, 1500));
    });
    await client.call("Runtime.enable");
    const trustAction = await shared.trustCommunityPlugins(client);
    report.pluginStartup = { trustAction };
    await waitFor(client, "Boolean(app.plugins.plugins['bob-ledger-tools']) && app.workspace.layoutReady", Boolean, "bob-ledger-tools startup", 45_000);
    report.app = await client.evaluate("({ version: (/obsidian\\/([\\d.]+)/i.exec(navigator.userAgent) || [])[1] || '', enabled: Array.from(app.plugins.enabledPlugins || []), manifest: app.plugins.manifests['bob-ledger-tools']?.version || null, helpers: Boolean(app.plugins.plugins['bob-ledger-tools']?.constructor?.helpers?.propertyCardFrontmatterOwnMounted) })");
    check("plugin-loaded", report.app.enabled.includes(PLUGIN_ID) && report.app.helpers && report.app.manifest === report.pluginSource.version, report.app);
    await shared.collapseSidebars(client);
    await shared.setViewport(client, 1400, 1000);
    await shared.setTheme(client, "light");

    const ctx = { client, report, notes, outDir, profileDir, check, attempt };
    ctx.page = makePage(ctx);
    await ctx.page.install();
    ctx.main = await ctx.page.mainLeaf();
    await ctx.page.open(ctx.main, P.day, "live");
    await ctx.page.settle(400);
    await ctx.page.waitCapability("confirmed");

    const ownCase = (name, notePath, mode) => attempt(name, async () => {
      await ctx.page.open(ctx.main, notePath, mode);
      await ctx.page.settle(250);
      const probe = await ctx.page.waitOwned(ctx.main, mode, name);
      return { ok: true, probe };
    });
    await ownCase("own-day-live", P.day, "live");
    await ownCase("own-day-reading", P.day, "reading");
    await ownCase("own-week-live", P.week, "live");
    await ownCase("own-week-reading", P.week, "reading");
    await ownCase("own-record-live", P.record, "live");
    await ownCase("own-record-reading", P.record, "reading");
    await ownCase("own-album-live", P.album, "live");
    await ownCase("own-album-reading", P.album, "reading");
    await ownCase("own-quarter-live", P.quarter, "live");
    await ownCase("own-year-live", P.year, "live");
    await ownCase("own-identity-day-live", P.identity, "live");
    await ownCase("own-identity-day-reading", P.identity, "reading");

    await attempt("title-slot-anchor-live", async () => {
      await ctx.page.open(ctx.main, P.day, "live");
      const probe = await ctx.page.waitOwned(ctx.main, "live", "title-slot live");
      const failures = [];
      if (probe.slotAnchor !== "metadata-container") failures.push("title slot anchor is " + probe.slotAnchor);
      if (!probe.slotParentConnected) failures.push("title slot parent is not connected");
      if (!(probe.slotParentRect && probe.slotParentRect.height > 0)) failures.push("title slot parent has no geometry");
      return { ok: failures.length === 0, probe, failures };
    });
    await attempt("variables-live", async () => {
      const probe = await ctx.page.probe(ctx.main);
      const failures = lib.variablesOk(probe, "live");
      return { ok: failures.length === 0, probe, failures };
    });
    await attempt("vim-k-gg-up-live", async () => {
      const failures = [];
      const placedTop = await ctx.page.ev("window.__bobFrontmatterTakeover.setCursor(" + JSON.stringify(ctx.main) + ", 15, 0)");
      if (!placedTop || placedTop.ok !== true) failures.push("could not place cursor at the top line: " + JSON.stringify(placedTop));
      const downTop = await ctx.page.ev("window.__bobFrontmatterTakeover.keyDowns()");
      await ctx.page.keys("Escape");
      await ctx.page.keys("g");
      await ctx.page.keys("g");
      const afterGg = await ctx.page.active();
      await ctx.page.keys("k");
      const afterK = await ctx.page.active();
      await ctx.page.keys("ArrowUp");
      const afterUp = await ctx.page.active();
      const downNav = await ctx.page.ev("window.__bobFrontmatterTakeover.keyDowns()");
      if (!(downNav > downTop)) failures.push("navigation keys never reached the page");
      const placedBody = await ctx.page.ev("window.__bobFrontmatterTakeover.setCursor(" + JSON.stringify(ctx.main) + ", 23, 0)");
      if (!placedBody || placedBody.ok !== true) failures.push("could not place cursor on the body line: " + JSON.stringify(placedBody));
      await ctx.page.keys("Escape");
      await ctx.page.keys("i");
      for (const ch of "s1ok") await ctx.page.keys(ch);
      await ctx.page.keys("Escape");
      const afterType = await ctx.page.active();
      const bufferText = await ctx.page.ev("window.__bobFrontmatterTakeover.docText(" + JSON.stringify(ctx.main) + ")");
      await ctx.page.keys("u");
      await ctx.page.settle(1200);
      const bufferAfterUndo = await ctx.page.ev("window.__bobFrontmatterTakeover.docText(" + JSON.stringify(ctx.main) + ")");
      let restored = await ctx.page.ev("window.__bobFrontmatterTakeover.readNote(" + JSON.stringify(P.day) + ")");
      const bufferRestored = bufferAfterUndo === notes[P.day];
      if (!bufferRestored) {
        failures.push("undo did not restore the live editor buffer");
        await ctx.page.ev(`(() => {
          const leaf = app.workspace.getLeafById(${JSON.stringify(ctx.main)});
          const cm = leaf && leaf.view && leaf.view.editor && leaf.view.editor.cm;
          if (!cm) return false;
          cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: ${JSON.stringify(notes[P.day])} } });
          return cm.state.doc.toString() === ${JSON.stringify(notes[P.day])};
        })()`);
        await waitFor(client, `window.__bobFrontmatterTakeover.docText(${JSON.stringify(ctx.main)}) === ${JSON.stringify(notes[P.day])}`,
          Boolean, "day editor-buffer restoration after Vim probe", 10_000);
      }
      if (restored !== notes[P.day]) {
        failures.push("undo did not restore day bytes");
        await ctx.page.ev(`(async () => {
          const file = app.vault.getAbstractFileByPath(${JSON.stringify(P.day)});
          await app.vault.modify(file, ${JSON.stringify(notes[P.day])});
          return true;
        })()`);
        await waitFor(client, `window.__bobFrontmatterTakeover.readNote(${JSON.stringify(P.day)}) === ${JSON.stringify(notes[P.day])}`,
          Boolean, "day file restoration after Vim probe", 10_000);
        restored = await ctx.page.ev("window.__bobFrontmatterTakeover.readNote(" + JSON.stringify(P.day) + ")");
      }
      const probe = await ctx.page.probe(ctx.main);
      for (const [label, row] of [["gg", afterGg], ["k", afterK], ["up", afterUp], ["type", afterType]]) {
        if (row.inProperties) failures.push(label + " focused a property input");
      }
      if (!String(bufferText || "").includes("s1ok")) failures.push("inserted body text missing from the editor buffer");
      if (probe.activeInside) failures.push("probe still inside the container");
      return { ok: failures.length === 0, afterGg, afterK, afterUp, afterType, typed: String(bufferText || "").includes("s1ok"), bufferRestored, restored: restored === notes[P.day], probe, failures };
    });
    await attempt("tab-live", async () => {
      await ctx.page.ev(`(() => { const leaf = app.workspace.getLeafById(${JSON.stringify(ctx.main)}); leaf.view.editor.focus(); return true; })()`);
      const bufferBefore = await ctx.page.ev("window.__bobFrontmatterTakeover.docText(" + JSON.stringify(ctx.main) + ")");
      const downBefore = await ctx.page.ev("window.__bobFrontmatterTakeover.keyDowns()");
      await ctx.page.keys("Tab");
      const afterTab = await ctx.page.active();
      const downTab = await ctx.page.ev("window.__bobFrontmatterTakeover.keyDowns()");
      await ctx.page.keys("Tab", 8);
      const afterShiftTab = await ctx.page.active();
      await ctx.page.settle(150);
      const bufferAfter = await ctx.page.ev("window.__bobFrontmatterTakeover.docText(" + JSON.stringify(ctx.main) + ")");
      const bufferChanged = bufferAfter !== bufferBefore;
      if (bufferChanged) {
        await ctx.page.ev(`(async () => {
          const file = app.vault.getAbstractFileByPath(${JSON.stringify(P.day)});
          await app.vault.modify(file, ${JSON.stringify(notes[P.day])});
          return true;
        })()`);
        await waitFor(client, `window.__bobFrontmatterTakeover.readNote(${JSON.stringify(P.day)}) === ${JSON.stringify(notes[P.day])}`,
          Boolean, "day fixture restoration after Tab probe", 10_000);
      }
      const failures = [];
      if (!(downTab > downBefore)) failures.push("Tab never reached the page");
      if (afterTab.inProperties) failures.push("Tab entered Properties");
      if (afterShiftTab.inProperties) failures.push("Shift+Tab entered Properties");
      return { ok: failures.length === 0, afterTab, afterShiftTab, bufferChanged, failures };
    });

    await attempt("title-slot-anchor-reading", async () => {
      await ctx.page.open(ctx.main, P.day, "reading");
      const probe = await ctx.page.waitOwned(ctx.main, "reading", "title-slot reading");
      const failures = [];
      if (probe.slotAnchor !== "metadata-container") failures.push("title slot anchor is " + probe.slotAnchor);
      if (!probe.slotParentConnected) failures.push("title slot parent is not connected");
      if (!(probe.slotParentRect && probe.slotParentRect.height > 0)) failures.push("title slot parent has no geometry");
      return { ok: failures.length === 0, probe, failures };
    });
    await attempt("variables-reading", async () => {
      const probe = await ctx.page.probe(ctx.main);
      const failures = lib.variablesOk(probe, "reading");
      return { ok: failures.length === 0, probe, failures };
    });
    await attempt("tab-reading", async () => {
      const downBefore = await ctx.page.ev("window.__bobFrontmatterTakeover.keyDowns()");
      await ctx.page.keys("Tab");
      const afterTab = await ctx.page.active();
      await ctx.page.keys("Tab", 8);
      const afterShiftTab = await ctx.page.active();
      const failures = [];
      if (afterTab.inProperties) failures.push("Tab entered Properties");
      if (afterShiftTab.inProperties) failures.push("Shift+Tab entered Properties");
      if (!(await ctx.page.ev("window.__bobFrontmatterTakeover.keyDowns()") > downBefore)) failures.push("Tab never reached the page");
      return { ok: failures.length === 0, afterTab, afterShiftTab, failures };
    });

    await attempt("source-toggle-releases", async () => {
      await ctx.page.open(ctx.main, P.day, "live");
      await ctx.page.waitOwned(ctx.main, "live", "source setup");
      await ctx.page.setMode(ctx.main, "source");
      await ctx.page.settle(250);
      const source = await ctx.page.waitNative(ctx.main, "Source");
      await ctx.page.setMode(ctx.main, "live");
      const live = await ctx.page.waitOwned(ctx.main, "live", "source restore");
      return { ok: true, source, live };
    });

    await attempt("deny-embed", async () => {
      await ctx.page.open(ctx.main, P.embedder, "reading");
      await ctx.page.settle(500);
      const result = await ctx.page.ev(`(() => {
        const embed = document.querySelector(".markdown-embed, .internal-embed");
        const owned = embed ? embed.querySelector(".bob-property-card-owns-frontmatter") : null;
        const card = embed ? embed.querySelector(".bob-intention-card, .bob-album-header, .bob-record-sheet") : null;
        return { hasEmbed: Boolean(embed), owned: Boolean(owned), card: Boolean(card) };
      })()`);
      return { ok: result.hasEmbed && !result.owned && !result.card, result };
    });
    await attempt("deny-hover", async () => {
      await ctx.page.open(ctx.main, P.hover, "reading");
      await ctx.page.settle(400);
      const target = await ctx.page.ev(`(() => {
        const leaf = app.workspace.getLeafById(${JSON.stringify(ctx.main)});
        const view = leaf?.view;
        const root = view?.getMode?.() === "preview" ? view.previewMode?.containerEl : view?.contentEl;
        const link = Array.from(root?.querySelectorAll("a.internal-link, .internal-link") || [])
          .find((node) => /today|20261120/.test(node.textContent || node.getAttribute("data-href") || ""));
        if (!link) return { found: false };
        link.scrollIntoView({ block: "center", inline: "nearest" });
        const rect = link.getBoundingClientRect();
        const event = new MouseEvent("mouseover", {
          bubbles: true, cancelable: true,
          clientX: rect.left + Math.min(8, Math.max(1, rect.width / 2)),
          clientY: rect.top + Math.min(8, Math.max(1, rect.height / 2)),
        });
        app.workspace.trigger("hover-link", {
          event, source: "preview", hoverParent: view, targetEl: link,
          linktext: link.getAttribute("data-href") || link.getAttribute("href") || "",
          sourcePath: view.file.path,
        });
        return { found: true, width: rect.width, height: rect.height };
      })()`);
      if (!target?.found || !(target.width > 0 && target.height > 0)) {
        throw new Error("no visible hover target: " + JSON.stringify(target));
      }
      await waitFor(client, "Boolean(document.querySelector('.popover.hover-popover .markdown-preview-view, .hover-popover .markdown-preview-view'))", Boolean, "hover popover render", 15_000);
      const result = await ctx.page.ev(`(() => {
        const pop = document.querySelector(".popover.hover-popover, .hover-popover");
        return {
          hasPopover: Boolean(pop),
          owned: Boolean(pop?.querySelector(".bob-property-card-owns-frontmatter")),
          card: Boolean(pop?.querySelector(".bob-intention-card, .bob-album-header, .bob-record-sheet")),
        };
      })()`);
      await ctx.page.ev("(() => { document.querySelectorAll('.hover-popover').forEach((node) => node.remove()); return true; })()");
      return { ok: result.hasPopover && !result.owned && !result.card, target, result };
    });
    await attempt("deny-canvas", async () => {
      const result = await ctx.page.ev(`(() => {
        const helpers = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].constructor.helpers;
        const host = document.createElement("div");
        host.className = "canvas-node";
        const scope = document.createElement("div");
        scope.className = "markdown-preview-view";
        host.appendChild(scope);
        document.body.appendChild(host);
        const denied = helpers.propertyCardFrontmatterScopeDenied(scope);
        const handle = helpers.propertyCardFrontmatterOwnMounted(app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}], {
          scope, path: ${JSON.stringify(P.day)}, kind: "day", mount: scope, view: null, getSource: () => "",
        });
        host.remove();
        return { denied, handle: handle == null };
      })()`);
      return { ok: result.denied === true && result.handle === true, result };
    });
    await attempt("deny-print", async () => {
      const result = await ctx.page.ev(`(() => {
        const helpers = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].constructor.helpers;
        const host = document.createElement("div");
        host.className = "print";
        const scope = document.createElement("div");
        scope.className = "markdown-preview-view";
        host.appendChild(scope);
        document.body.appendChild(host);
        const denied = helpers.propertyCardFrontmatterScopeDenied(scope);
        host.remove();
        return { denied };
      })()`);
      return { ok: result.denied === true, result };
    });
    await attempt("deny-mobile", async () => {
      await ctx.page.open(ctx.main, P.day, "live");
      await ctx.page.waitOwned(ctx.main, "live", "mobile setup");
      const toggled = await ctx.page.ev(`(() => {
        const platform = window.__bobFrontmatterTakeover.platform();
        if (!platform) return false;
        const descriptor = Object.getOwnPropertyDescriptor(platform, "isDesktopApp");
        window.__bobFrontmatterTakeover.platformDescriptor = descriptor || null;
        Object.defineProperty(platform, "isDesktopApp", { configurable: true, get: () => false });
        const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        plugin.constructor.helpers.propertyCardFrontmatterCoordinatorReconcile(plugin);
        return true;
      })()`);
      if (!toggled) throw new Error("shared Obsidian Platform object unavailable");
      let probe;
      try {
        await ctx.page.settle(300);
        probe = await ctx.page.probe(ctx.main);
      } finally {
        await ctx.page.ev(`(() => {
          const platform = window.__bobFrontmatterTakeover.platform();
          const descriptor = window.__bobFrontmatterTakeover.platformDescriptor;
          if (descriptor) Object.defineProperty(platform, "isDesktopApp", descriptor);
          else delete platform.isDesktopApp;
          window.__bobFrontmatterTakeover.platformDescriptor = null;
          const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          try { plugin.scheduleIntentionCardRefresh(); } catch (_) {}
          try { plugin.intentionCardHost?.().scheduleRefresh?.(); } catch (_) {}
          plugin.constructor.helpers.propertyCardFrontmatterCoordinatorReconcile(plugin);
          return true;
        })()`);
      }
      const restored = await ctx.page.waitOwned(ctx.main, "live", "mobile restore");
      return { ok: lib.nativeFailures(probe, "mobile").length === 0, probe, restored };
    });
    await attempt("deny-malformed", async () => {
      await ctx.page.open(ctx.main, P.malformedDay, "live");
      await ctx.page.settle(500);
      const live = await ctx.page.waitNative(ctx.main, "malformed live");
      await ctx.page.open(ctx.main, P.malformedDay, "reading");
      await ctx.page.settle(400);
      const reading = await ctx.page.waitNative(ctx.main, "malformed reading");
      return { ok: true, live, reading };
    });
    await attempt("deny-unclosed", async () => {
      await ctx.page.open(ctx.main, P.unclosed, "live");
      await ctx.page.settle(500);
      const probe = await ctx.page.waitNative(ctx.main, "unclosed");
      return { ok: true, probe };
    });
    await attempt("stale-cache-releases", async () => {
      await ctx.page.open(ctx.main, P.day, "live");
      await ctx.page.waitOwned(ctx.main, "live", "stale setup");
      const staleProbe = await ctx.page.ev(`(() => {
        const file = app.vault.getAbstractFileByPath(${JSON.stringify(P.day)});
        const metadataCache = app.metadataCache;
        const originalGetFileCache = metadataCache.getFileCache;
        const originalDescriptor = Object.getOwnPropertyDescriptor(metadataCache, "getFileCache");
        const cache = originalGetFileCache.call(metadataCache, file);
        const expectedType = cache && cache.frontmatter ? cache.frontmatter.type : null;
        const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        let intercepted = 0;
        Object.defineProperty(metadataCache, "getFileCache", {
          configurable: true,
          writable: true,
          value(target) {
            const current = originalGetFileCache.call(this, target);
            if (target?.path === ${JSON.stringify(P.day)} && current?.frontmatter) {
              intercepted += 1;
              return {
                ...current,
                frontmatter: { ...current.frontmatter, summary: "stale-mismatch" },
              };
            }
            return current;
          },
        });
        let released = 0;
        try {
          released = plugin.constructor.helpers.propertyCardFrontmatterCoordinatorReconcile(plugin);
        } finally {
          if (originalDescriptor) Object.defineProperty(metadataCache, "getFileCache", originalDescriptor);
          else delete metadataCache.getFileCache;
        }
        return { expectedType, intercepted, released };
      })()`);
      const expectedType = staleProbe && staleProbe.expectedType;
      if (!expectedType || staleProbe.intercepted < 1 || staleProbe.released < 1) {
        throw new Error("stale cache view was not observed during ownership reconciliation: " + JSON.stringify(staleProbe));
      }
      const cacheProbe = "bob-frontmatter-takeover-refresh";
      const summaryLine = /^summary: (.+)$/m.exec(notes[P.day]);
      if (!summaryLine) throw new Error("day fixture has no summary property to probe");
      const originalSummary = summaryLine[1];
      const changedNote = notes[P.day].replace(/^summary: .+$/m, `summary: ${cacheProbe}`);
      await ctx.page.ev(`(async () => {
        const file = app.vault.getAbstractFileByPath(${JSON.stringify(P.day)});
        await app.vault.modify(file, ${JSON.stringify(changedNote)});
        return true;
      })()`);
      await waitFor(client, `(() => {
        const file = app.vault.getAbstractFileByPath(${JSON.stringify(P.day)});
        const cache = app.metadataCache.getFileCache(file);
        return Boolean(cache && cache.frontmatter
          && cache.frontmatter.type === ${JSON.stringify(expectedType)}
          && cache.frontmatter.summary === ${JSON.stringify(cacheProbe)});
      })()`, Boolean, "metadata cache refresh", 10_000);
      await waitFor(client, `(() => {
        const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        return Boolean(plugin
          && plugin.intentionCardSourceCache?.get?.(${JSON.stringify(P.day)})?.source === ${JSON.stringify(changedNote)}
          && plugin.intentionCardRefreshTimer == null);
      })()`, Boolean, "changed source and completed card refresh", 10_000);
      await ctx.page.ev(`(async () => {
        const file = app.vault.getAbstractFileByPath(${JSON.stringify(P.day)});
        await app.vault.modify(file, ${JSON.stringify(notes[P.day])});
        return true;
      })()`);
      const bufferAfterVaultRestore = await ctx.page.ev(
        "window.__bobFrontmatterTakeover.docText(" + JSON.stringify(ctx.main) + ")",
      );
      const bufferInitiallyRestored = bufferAfterVaultRestore === notes[P.day];
      if (!bufferInitiallyRestored) {
        await ctx.page.ev(`(() => {
          const leaf = app.workspace.getLeafById(${JSON.stringify(ctx.main)});
          const cm = leaf && leaf.view && leaf.view.editor && leaf.view.editor.cm;
          if (!cm) return false;
          cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: ${JSON.stringify(notes[P.day])} } });
          return cm.state.doc.toString() === ${JSON.stringify(notes[P.day])};
        })()`);
        await waitFor(client, `window.__bobFrontmatterTakeover.docText(${JSON.stringify(ctx.main)}) === ${JSON.stringify(notes[P.day])}`,
          Boolean, "day editor-buffer restoration after stale-cache probe", 10_000);
      }
      await ctx.page.ev(`(async () => {
        const file = app.vault.getAbstractFileByPath(${JSON.stringify(P.day)});
        await app.vault.modify(file, ${JSON.stringify(notes[P.day])});
        return true;
      })()`);
      await waitFor(client, `(() => {
        const file = app.vault.getAbstractFileByPath(${JSON.stringify(P.day)});
        const cache = app.metadataCache.getFileCache(file);
        const frontmatter = cache && cache.frontmatter;
        return {
          type: frontmatter?.type ?? null,
          summary: frontmatter?.summary ?? null,
          keys: frontmatter ? Object.keys(frontmatter) : [],
        };
      })()`, (cache) => Boolean(cache
        && cache.type === expectedType
        && cache.summary === originalSummary), "metadata cache restoration", 10_000);
      await waitFor(client, `(() => {
        const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        return Boolean(plugin
          && plugin.intentionCardSourceCache?.get?.(${JSON.stringify(P.day)})?.source === ${JSON.stringify(notes[P.day])}
          && plugin.intentionCardRefreshTimer == null);
      })()`, Boolean, "restored source and completed card refresh", 10_000);
      await ctx.page.settle(1200);
      const restoredBuffer = await ctx.page.ev(
        "window.__bobFrontmatterTakeover.docText(" + JSON.stringify(ctx.main) + ")",
      );
      const restoredBytes = await ctx.page.ev(
        "window.__bobFrontmatterTakeover.readNote(" + JSON.stringify(P.day) + ")",
      );
      if (restoredBuffer !== notes[P.day] || restoredBytes !== notes[P.day]) {
        throw new Error("stale-cache fixture teardown did not settle: " + JSON.stringify({
          bufferRestored: restoredBuffer === notes[P.day],
          bytesRestored: restoredBytes === notes[P.day],
        }));
      }
      const restored = await ctx.page.waitOwned(ctx.main, "live", "stale restore");
      return {
        ok: true,
        staleProbe,
        fixtureRestore: {
          bufferInitiallyRestored,
          bufferRestored: restoredBuffer === notes[P.day],
          bytesRestored: restoredBytes === notes[P.day],
        },
        restored,
      };
    });
    await attempt("same-pane-file-change", async () => {
      await ctx.page.open(ctx.main, P.day, "live");
      await ctx.page.waitOwned(ctx.main, "live", "file-change setup");
      await ctx.page.open(ctx.main, P.ordinary, "live");
      await ctx.page.settle(300);
      const ordinary = await ctx.page.waitNative(ctx.main, "ordinary after path change");
      await ctx.page.open(ctx.main, P.day, "live");
      const restored = await ctx.page.waitOwned(ctx.main, "live", "file-change restore");
      return { ok: true, ordinary, restored };
    });
    await attempt("injected-mount-failure", async () => {
      await ctx.page.open(ctx.main, P.day, "live");
      await ctx.page.waitOwned(ctx.main, "live", "inject setup");
      await ctx.page.ev(`(() => {
        const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        plugin.intentionCardActive = false;
        plugin.constructor.helpers.propertyCardFrontmatterCoordinatorReconcile(plugin);
        return true;
      })()`);
      await ctx.page.settle(250);
      const failed = await ctx.page.waitNative(ctx.main, "injected mount failure");
      await ctx.page.ev(`(() => {
        const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        plugin.intentionCardActive = true;
        try { plugin.scheduleIntentionCardRefresh(); } catch (_) {}
        try { plugin.intentionCardHost?.().scheduleRefresh?.(); } catch (_) {}
        plugin.constructor.helpers.propertyCardFrontmatterCoordinatorReconcile(plugin);
        return true;
      })()`);
      const restored = await ctx.page.waitOwned(ctx.main, "live", "inject restore");
      return { ok: true, failed, restored };
    });
    await attempt("replaced-container-reapplies", async () => {
      await ctx.page.open(ctx.main, P.day, "live");
      await ctx.page.waitOwned(ctx.main, "live", "replace setup");
      await ctx.page.ev(`(() => {
        const leaf = app.workspace.getLeafById(${JSON.stringify(ctx.main)});
        const scope = leaf.view.editor.cm.dom;
        const scroller = Array.from(scope.children).find((node) => node.classList.contains("cm-scroller"));
        const sizer = scroller && Array.from(scroller.children).find((node) => node.classList.contains("cm-sizer"));
        const container = sizer && Array.from(sizer.children).find((node) => node.classList.contains("metadata-container"));
        if (!container) return false;
        const clone = container.cloneNode(true);
        container.replaceWith(clone);
        return true;
      })()`);
      await ctx.page.settle(400);
      const probe = await ctx.page.waitOwned(ctx.main, "live", "replaced container");
      return { ok: true, probe };
    });
    await attempt("disable-unload-restores", async () => {
      await ctx.page.open(ctx.main, P.day, "live");
      await ctx.page.waitOwned(ctx.main, "live", "disable setup");
      await ctx.page.ev("app.plugins.disablePlugin(" + JSON.stringify(PLUGIN_ID) + ")");
      await waitFor(client, "!app.plugins.plugins[" + JSON.stringify(PLUGIN_ID) + "]", Boolean, "ledger-tools disabled");
      await ctx.page.settle(300);
      const off = await ctx.page.ev(`(() => {
        const container = document.querySelector(".metadata-container");
        return {
          owns: document.querySelectorAll(".bob-property-card-owns-frontmatter").length,
          cards: document.querySelectorAll(".bob-intention-card, .bob-album-header, .bob-record-sheet").length,
          inert: Boolean(container && (container.inert === true || container.hasAttribute("inert"))),
          ariaHidden: container ? container.getAttribute("aria-hidden") : null,
          present: Boolean(container),
        };
      })()`);
      const failures = [];
      if (off.owns !== 0) failures.push("owns class leftover");
      if (off.cards !== 0) failures.push("card leftover");
      if (off.inert) failures.push("inert leftover");
      if (off.ariaHidden === "true") failures.push("aria-hidden leftover");
      await ctx.page.ev("app.plugins.enablePlugin(" + JSON.stringify(PLUGIN_ID) + ")");
      await waitFor(client, "Boolean(app.plugins.plugins[" + JSON.stringify(PLUGIN_ID) + "])", Boolean, "ledger-tools enabled", 30_000);
      await ctx.page.install();
      await ctx.page.open(ctx.main, P.day, "live");
      const on = await ctx.page.waitOwned(ctx.main, "live", "re-enable");
      return { ok: failures.length === 0, off, on, failures };
    });

    const switchBob = async (mode, status) => {
      writeControl(controlPath, mode);
      ctx.page.writeConfig(path.join(altShimDir, "bob"));
      await ctx.page.ev(`(() => {
        const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        if (plugin.propertyCapabilityByBobPath instanceof Map) plugin.propertyCapabilityByBobPath.clear();
        plugin.propertyCapabilityGeneration = (plugin.propertyCapabilityGeneration || 0) + 1;
        return plugin.schedulePropertyCapabilityProbe(${JSON.stringify(mode)});
      })()`);
      if (status) await ctx.page.waitCapability(status, 25_000);
    };
    const restoreBob = async () => {
      writeControl(controlPath, "pass");
      ctx.page.writeConfig(null);
      await ctx.page.ev(`(() => {
        const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        if (plugin.propertyCapabilityByBobPath instanceof Map) plugin.propertyCapabilityByBobPath.clear();
        plugin.propertyCapabilityGeneration = (plugin.propertyCapabilityGeneration || 0) + 1;
        return plugin.schedulePropertyCapabilityProbe("restore");
      })()`);
      await ctx.page.waitCapability("confirmed", 25_000);
    };

    await attempt("pending-capability-native", async () => {
      writeControl(controlPath, "hold");
      ctx.page.writeConfig(path.join(altShimDir, "bob"));
      await ctx.page.ev(`(() => {
        const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        if (plugin.propertyCapabilityByBobPath instanceof Map) plugin.propertyCapabilityByBobPath.clear();
        plugin.propertyCapabilityGeneration = (plugin.propertyCapabilityGeneration || 0) + 1;
        return plugin.schedulePropertyCapabilityProbe("pending");
      })()`);
      await ctx.page.open(ctx.main, P.day, "live");
      await ctx.page.settle(400);
      const pending = await ctx.page.probe(ctx.main);
      const failures = lib.nativeFailures(pending, "pending");
      writeControl(controlPath, "pass");
      await ctx.page.waitCapability("confirmed", 25_000);
      const owned = await ctx.page.waitOwned(ctx.main, "live", "pending release");
      await restoreBob();
      return { ok: failures.length === 0, pending, owned, failures };
    });
    await attempt("absent-old-bob-native", async () => {
      await switchBob("old", "absent");
      await ctx.page.open(ctx.main, P.day, "live");
      await ctx.page.settle(400);
      const probe = await ctx.page.waitNative(ctx.main, "old bob");
      await restoreBob();
      return { ok: true, probe };
    });
    await attempt("failed-probe-native", async () => {
      await switchBob("fail", "unconfirmed");
      await ctx.page.open(ctx.main, P.week, "live");
      await ctx.page.settle(400);
      const probe = await ctx.page.waitNative(ctx.main, "failed probe");
      await restoreBob();
      return { ok: true, probe };
    });
    await attempt("path-switch-native", async () => {
      await switchBob("fail", "unconfirmed");
      await ctx.page.open(ctx.main, P.album, "live");
      await ctx.page.settle(400);
      const switched = await ctx.page.waitNative(ctx.main, "path switch");
      await restoreBob();
      const restored = await ctx.page.waitOwned(ctx.main, "live", "path restore");
      return { ok: true, switched, restored };
    });
    await attempt("late-after-unload-native", async () => {
      writeControl(controlPath, "hold");
      ctx.page.writeConfig(path.join(altShimDir, "bob"));
      await ctx.page.ev(`(() => {
        const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        if (plugin.propertyCapabilityByBobPath instanceof Map) plugin.propertyCapabilityByBobPath.clear();
        plugin.propertyCapabilityGeneration = (plugin.propertyCapabilityGeneration || 0) + 1;
        return plugin.schedulePropertyCapabilityProbe("late");
      })()`);
      await ctx.page.ev("app.plugins.disablePlugin(" + JSON.stringify(PLUGIN_ID) + ")");
      await waitFor(client, "!app.plugins.plugins[" + JSON.stringify(PLUGIN_ID) + "]", Boolean, "late disable");
      writeControl(controlPath, "pass");
      await sleep(800);
      const leftovers = await ctx.page.ev(`(() => ({
        owns: document.querySelectorAll(".bob-property-card-owns-frontmatter").length,
        inert: Array.from(document.querySelectorAll(".metadata-container")).some((node) => node.inert === true || node.getAttribute("aria-hidden") === "true"),
      }))()`);
      await ctx.page.ev("app.plugins.enablePlugin(" + JSON.stringify(PLUGIN_ID) + ")");
      await waitFor(client, "Boolean(app.plugins.plugins[" + JSON.stringify(PLUGIN_ID) + "])", Boolean, "late enable", 30_000);
      await ctx.page.install();
      await restoreBob();
      await ctx.page.open(ctx.main, P.day, "live");
      const owned = await ctx.page.waitOwned(ctx.main, "live", "late restore");
      return { ok: leftovers.owns === 0 && leftovers.inert === false, leftovers, owned };
    });

    await attempt("mod-semicolon-add-owned", async () => {
      await ctx.page.open(ctx.main, P.day, "live");
      await ctx.page.waitOwned(ctx.main, "live", "mod-semicolon setup");
      const commands = await ctx.page.commands();
      const exact = (commands || []).filter((row) => /add file property/i.test(row.name));
      const chosen = exact[0];
      const detail = chosen ? await ctx.page.ev("window.__bobFrontmatterTakeover.detail(" + JSON.stringify(chosen.id) + ")") : null;
      report.addFilePropertyCommand = { id: chosen && chosen.id, name: chosen && chosen.name, detail, exactMatches: exact.length };
      const failures = [];
      if (!chosen || chosen.id !== COMMAND_ID) failures.push("expected command id " + COMMAND_ID);
      if (detail && detail.checkCallbackType !== "function" && detail.callbackType !== "function") failures.push("command has neither callback nor checkCallback");
      await ctx.page.ev("window.__bobFrontmatterTakeover.bindHotkey(" + JSON.stringify(COMMAND_ID) + ", ['Mod'], ';')");
      await ctx.page.keys(";", 2);
      await ctx.page.settle(300);
      const after = await ctx.page.probe(ctx.main);
      const active = await ctx.page.active();
      if (!after.editorOpen && !active.inEditor) failures.push("Mod+; did not open the property editor");
      if (active.inProperties && /metadata-property-key-input/.test(active.className || "")) failures.push("Mod+; focused the native key input on an owned note");
      await ctx.page.closeEditor();
      return { ok: failures.length === 0, after, active, command: report.addFilePropertyCommand, failures };
    });
    await attempt("palette-add-owned", async () => {
      await ctx.page.open(ctx.main, P.record, "live");
      await ctx.page.waitOwned(ctx.main, "live", "palette setup");
      await ctx.page.ev("(async () => { await app.commands.executeCommandById(" + JSON.stringify(COMMAND_ID) + "); return true; })()");
      await ctx.page.settle(300);
      const after = await ctx.page.probe(ctx.main);
      const failures = [];
      if (!after.editorOpen) failures.push("palette dispatch did not open the property editor");
      await ctx.page.closeEditor();
      return { ok: failures.length === 0, after, failures };
    });
    await attempt("custom-shortcut-add-owned", async () => {
      await ctx.page.open(ctx.main, P.album, "live");
      await ctx.page.waitOwned(ctx.main, "live", "custom shortcut setup");
      const bind = await ctx.page.ev("window.__bobFrontmatterTakeover.bindHotkey(" + JSON.stringify(COMMAND_ID) + ", ['Alt'], 'p')");
      await ctx.page.keys("p", 1);
      await ctx.page.settle(300);
      const after = await ctx.page.probe(ctx.main);
      const failures = [];
      if (!bind || bind.ok !== true) failures.push("could not bind Alt+P: " + JSON.stringify(bind));
      if (!after.editorOpen) failures.push("custom shortcut did not open the property editor");
      await ctx.page.closeEditor();
      return { ok: failures.length === 0, after, bind, failures };
    });
    await attempt("bank-native", async () => {
      await ctx.page.open(ctx.main, P.bank, "live");
      await ctx.page.settle(400);
      const live = await ctx.page.waitNative(ctx.main, "bank live");
      await ctx.page.open(ctx.main, P.bank, "reading");
      await ctx.page.settle(300);
      const reading = await ctx.page.waitNative(ctx.main, "bank reading");
      return { ok: true, live, reading };
    });
    await attempt("ordinary-native", async () => {
      await ctx.page.open(ctx.main, P.ordinary, "live");
      await ctx.page.settle(300);
      const probe = await ctx.page.waitNative(ctx.main, "ordinary");
      return { ok: true, probe };
    });
    await attempt("sidebar-native", async () => {
      await ctx.page.open(ctx.main, P.day, "live");
      await ctx.page.waitOwned(ctx.main, "live", "sidebar setup");
      const result = await ctx.page.ev(`(async () => {
        await app.commands.executeCommandById("file-properties:open");
        await new Promise((resolve) => setTimeout(resolve, 400));
        const sidebar = document.querySelector(".workspace-leaf-content[data-type='file-properties'], .workspace-leaf-content[data-type='all-properties']");
        const owned = sidebar ? sidebar.querySelector(".bob-property-card-owns-frontmatter") : null;
        const input = sidebar ? sidebar.querySelector(".metadata-property-key-input, .metadata-property") : null;
        return { hasSidebar: Boolean(sidebar), owned: Boolean(owned), hasNative: Boolean(input) };
      })()`);
      return { ok: !result.owned, result };
    });
    await attempt("field-focused-helper", async () => {
      await ctx.page.open(ctx.main, P.album, "live");
      await ctx.page.waitOwned(ctx.main, "live", "helper setup");
      await ctx.page.ev(`(() => {
        const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        const leaf = app.workspace.getLeafById(${JSON.stringify(ctx.main)});
        if (typeof plugin.notebookFocusSummaryProperty === "function") plugin.notebookFocusSummaryProperty(leaf.view);
        else if (typeof plugin.openPropertyEditor === "function") plugin.openPropertyEditor({ filePath: ${JSON.stringify(P.album)}, key: "summary" });
        return true;
      })()`);
      await ctx.page.settle(400);
      const after = await ctx.page.probe(ctx.main);
      const failures = [];
      if (!after.editorOpen) failures.push("field helper did not open the property editor");
      await ctx.page.closeEditor();
      return { ok: failures.length === 0, after, failures };
    });
    await attempt("failed-opener-fallback", async () => {
      await ctx.page.open(ctx.main, P.day, "live");
      await ctx.page.waitOwned(ctx.main, "live", "opener setup");
      const result = await ctx.page.ev(`(async () => {
        const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        const orig = plugin.openPropertyEditor.bind(plugin);
        plugin.openPropertyEditor = async () => { throw new Error("injected opener failure"); };
        let opened = false;
        try { await app.commands.executeCommandById(${JSON.stringify(COMMAND_ID)}); opened = true; } catch (_) {}
        plugin.openPropertyEditor = orig;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const leaf = app.workspace.getLeafById(${JSON.stringify(ctx.main)});
        const view = leaf && leaf.view;
        const scope = view && view.editor && view.editor.cm ? view.editor.cm.dom : null;
        const owned = scope && scope.classList.contains("bob-property-card-owns-frontmatter");
        return { opened, owned: Boolean(owned) };
      })()`);
      await ctx.page.settle(300);
      const probe = await ctx.page.probe(ctx.main);
      await ctx.page.closeEditor();
      const failures = [];
      if (result.owned) failures.push("owned class remained after opener failure");
      if (probe.containerInert) failures.push("container stayed inert after opener failure");
      return { ok: failures.length === 0, result, probe, failures };
    });
    await attempt("drawer-exposes-every-key", async () => {
      await ctx.page.open(ctx.main, P.day, "live");
      await ctx.page.waitOwned(ctx.main, "live", "drawer setup");
      await ctx.page.ev(`(() => {
        const disclosure = document.querySelector(".bob-property-card-foot-disclosure");
        if (disclosure) disclosure.click();
        return Boolean(disclosure);
      })()`);
      await ctx.page.settle(250);
      const probe = await ctx.page.probe(ctx.main);
      const expected = ["parent", "type", "date", "id", "mood", "intentions", "summary", "created", "tags"];
      const missing = expected.filter((key) => !probe.drawerKeys.includes(key));
      return { ok: missing.length === 0 && probe.drawerKeys.length > 0, probe, missing };
    });

    const shotCard = async (label, notePath) => {
      for (const theme of ["light", "dark"]) {
        await shared.setTheme(client, theme);
        for (const [widthName, width] of [["narrow", 720], ["wide", 1400]]) {
          await shared.setViewport(client, width, 1000);
          for (const mode of ["live", "reading"]) {
            await ctx.page.open(ctx.main, notePath, mode);
            await ctx.page.settle(250);
            await ctx.page.shot(label + "-" + mode + "-" + theme + "-" + widthName, [label, mode, theme, widthName], width);
          }
        }
      }
    };
    await shotCard("day", P.day);
    await shotCard("week", P.week);
    await shotCard("record", P.record);
    await shotCard("album", P.album);
    await shotCard("bank", P.bank);
    for (const theme of ["light", "dark"]) {
      await shared.setTheme(client, theme);
      for (const [widthName, width] of [["narrow", 720], ["wide", 1400]]) {
        await shared.setViewport(client, width, 1000);
        await ctx.page.open(ctx.main, P.ordinary, "live");
        await ctx.page.settle(200);
        await ctx.page.ev("(async () => { await app.commands.executeCommandById(" + JSON.stringify(COMMAND_ID) + "); return true; })()");
        await ctx.page.settle(300);
        await ctx.page.shot("ordinary-add-" + theme + "-" + widthName, ["ordinary", "add", theme, widthName], width);
        await ctx.page.closeEditor();
      }
    }
    await shared.setViewport(client, 1400, 1000);
    await shared.setTheme(client, "light");
    await ctx.page.open(ctx.main, P.day, "source");
    await ctx.page.settle(200);
    await ctx.page.shot("fallback-source-day", ["source", "fallback", "light", "wide"]);
    await ctx.page.open(ctx.main, P.malformedDay, "live");
    await ctx.page.settle(200);
    await ctx.page.shot("fallback-malformed-day", ["malformed", "fallback", "light", "wide"]);

    await sleep(400);
    report.fixtures.final = hashFixtures(vaultReal, names);
    const changed = names.filter((name) => report.fixtures.final[name] !== report.fixtures.expected[name]);
    check("bytes-unchanged", changed.length === 0, { changed, seeded: report.fixtures.seeded, final: report.fixtures.final });
    const beforeNativeCheck = readInvocations(bobLog).length;
    await ctx.page.open(ctx.main, P.ordinary, "live");
    await ctx.page.waitNative(ctx.main, "ordinary before paint-spawn comparison");
    await ctx.page.settle(1200);
    const baselineInvocations = paintSpawned(readInvocations(bobLog).slice(beforeNativeCheck));
    const beforeOwnedCheck = readInvocations(bobLog).length;
    await ctx.page.open(ctx.main, P.day, "live");
    await ctx.page.waitOwned(ctx.main, "live", "paint-spawn ownership");
    await ctx.page.settle(1200);
    const ownedInvocations = paintSpawned(readInvocations(bobLog).slice(beforeOwnedCheck));
    const baselineArgs = new Set(baselineInvocations.map((row) => JSON.stringify(row.args)));
    const extra = ownedInvocations.filter((row) => !baselineArgs.has(JSON.stringify(row.args)));
    const invocations = readInvocations(bobLog);
    report.bobInvocations = {
      count: invocations.length,
      baselinePaintSpawnCandidates: baselineInvocations.map((row) => row.args),
      ownedPaintSpawnCandidates: ownedInvocations.map((row) => row.args),
      extra: extra.map((row) => row.args),
    };
    check("no-paint-spawn", extra.length === 0, {
      extra: extra.map((row) => row.args),
      baselineCandidates: baselineInvocations.length,
      ownedCandidates: ownedInvocations.length,
      count: invocations.length,
    });
    const needed = lib.screenshotNeeds();
    const have = new Set(report.screenshots.map((row) => row.name));
    const missingShots = needed.filter((name) => !have.has(name));
    check("screenshots-captured", missingShots.length === 0 && report.screenshots.length >= needed.length, { missingShots, count: report.screenshots.length });
    check("no-console-exceptions", report.consoleExceptions.length === 0, report.consoleExceptions);
  } catch (error) {
    report.error = error && error.stack ? error.stack : String(error);
    report.prerequisites.push({ name: "runner", status: "fail", detail: String(error && error.message || error) });
    if (client) {
      try { report.screenshots.push(await shared.capture(client, outDir, "frontmatter-takeover-runner-failure", 1400, "light", "failure state")); }
      catch (_) {}
    }
  } finally {
    for (const { name } of lib.REQUIRED_CHECKS) {
      if (!report.checks.some((row) => row.name === name)) check(name, false, "Required check was not executed");
    }
    report.verdict = lib.computeVerdict(report);
    report.pass = report.verdict.verdict === "GO" && report.prerequisites.every((row) => row.status === "pass");
    report.summary = {
      obsidian: report.app?.version || null, plugin: report.pluginSource.version, commit: report.pluginSource.head,
      bob: report.bob ? { path: report.bob.path, sha256: report.bob.sha256, version: report.bob.version, sourceSha: report.bob.sourceSha } : null,
      verdict: report.verdict.verdict, fallback: report.verdict.fallback,
      addFilePropertyCommand: report.addFilePropertyCommand,
      failed: Object.values(report.verdict.surfaces).flatMap((value) => value.failed),
      screenshots: report.screenshots.length, consoleExceptions: report.consoleExceptions.length,
    };
    if (client) client.close();
    if (child && child.exitCode == null) {
      try { child.kill("SIGTERM"); } catch (_) {}
      await sleep(500);
      try { if (child.exitCode == null) child.kill("SIGKILL"); } catch (_) {}
    }
    try {
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    } catch (_) {}
    if (scratch) {
      try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (_) {}
    }
  }
  process.stdout.write(JSON.stringify(report.summary, null, 2) + "\n");
  process.stdout.write("report: " + reportPath + "\n");
  process.stdout.write("screenshots: " + outDir + "\n");
  if (!report.pass) process.exitCode = 1;
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
  if (args.help) {
    process.stdout.write(lib.HELP_TEXT + "\n");
    return;
  }
  if (args.selfTest) {
    try {
      lib.selfTest();
      process.stdout.write("offline self-test complete (takeover fixtures, probes, and verdict; no Obsidian launched)\n");
    } catch (error) {
      process.stderr.write(String(error.stack || error) + "\n");
      process.exitCode = 1;
    }
    return;
  }
  const timer = setTimeout(() => {
    process.stderr.write("frontmatter takeover e2e exceeded " + OVERALL_TIMEOUT_MS + " ms\n");
    process.exit(1);
  }, OVERALL_TIMEOUT_MS);
  try { await run(args); }
  finally { clearTimeout(timer); }
}

if (require.main === module) void main(process.argv.slice(2));
module.exports = { run, parseArgs: lib.parseArgs, findBobProvenance: shared.findBobProvenance };
