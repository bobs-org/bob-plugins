#!/usr/bin/env node
// Real-Obsidian S1 go/no-go: own a test note through propertyCardOwnFrontmatter
// and verify focus safety, title-slot anchoring, Mod+; observability, and
// Obsidian visibility variables. Uses a disposable Git vault and profile, an
// owned Obsidian process under Xvfb, and only the working-tree bob-ledger-tools
// build. Never opens the live vault and never runs bob.
"use strict";

const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const lib = require("./obsidian-frontmatter-ownership-spike-lib.cjs");
const shared = require("./obsidian-record-card-e2e.cjs");

const repoRoot = path.resolve(__dirname, "..");
const ELECTRON_FALLBACK = "/snap/obsidian/current/app/obsidian";
const PLUGIN_ID = "bob-ledger-tools";
const MODE_STATE = {
  live: { mode: "source", source: false },
  source: { mode: "source", source: true },
  reading: { mode: "preview" },
};
const { sleep, waitFor } = shared;

function installVault(vaultDir) {
  const obsidian = path.join(vaultDir, ".obsidian");
  const dest = path.join(obsidian, "plugins", PLUGIN_ID);
  fs.mkdirSync(dest, { recursive: true });
  for (const name of ["manifest.json", "main.js", "styles.css"]) {
    fs.copyFileSync(path.join(repoRoot, "plugins", PLUGIN_ID, name), path.join(dest, name));
  }
  fs.writeFileSync(path.join(obsidian, "community-plugins.json"), JSON.stringify([PLUGIN_ID], null, 2));
  fs.writeFileSync(path.join(obsidian, "core-plugins.json"), JSON.stringify([
    "file-explorer", "command-palette", "page-preview", "properties",
  ], null, 2));
  fs.writeFileSync(path.join(obsidian, "app.json"), JSON.stringify({
    livePreview: true, showInlineTitle: true, propertiesInDocument: "visible", readableLineLength: true,
    vimMode: true, showLineNumber: false, alwaysUpdateLinks: false,
  }, null, 2));
  fs.writeFileSync(path.join(obsidian, "appearance.json"), JSON.stringify({ cssTheme: "", theme: "moonstone" }, null, 2));
}

function writeBobRefusal(shimDir, logPath) {
  fs.mkdirSync(shimDir, { recursive: true });
  const file = path.join(shimDir, "bob");
  fs.writeFileSync(file, "#!/usr/bin/env node\n"
    + "try { require('node:fs').appendFileSync(" + JSON.stringify(logPath) + ", JSON.stringify({ at: new Date().toISOString(), args: process.argv.slice(2) }) + '\\n'); } catch (_) {}\n"
    + "process.stderr.write('bob is disabled in the frontmatter-ownership spike\\n');\nprocess.exit(3);\n");
  fs.chmodSync(file, 0o755);
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

function hashFixtures(vaultDir, names) {
  return Object.fromEntries(names.map((name) => {
    const file = path.join(vaultDir, name);
    return [name, fs.existsSync(file) ? shared.sha256File(file) : null];
  }));
}

function sha256Text(text) { return crypto.createHash("sha256").update(text).digest("hex"); }

function makePage(ctx) {
  const ev = (expression, timeoutMs = 30_000) => ctx.client.evaluate(expression, timeoutMs);
  const json = (value) => JSON.stringify(value);
  const page = {
    ev,
    install: async () => {
      await ev(lib.ADAPTER_SOURCE);
      await ev(lib.PROBE_SOURCE);
    },
    settle: async (ms = 350) => {
      await ev("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
      await sleep(ms);
    },
    spike: (call) => ev("window.__bobFrontmatterSpike." + call),
    probe: (leafId) => ev("window.__bobFrontmatterProbe.leaf(" + json(leafId) + ")"),
    commands: () => ev("window.__bobFrontmatterProbe.commands()"),
    active: () => ev("window.__bobFrontmatterProbe.active()"),
    mainLeaf: () => ev("(() => { const leaf = app.workspace.getLeaf(false); app.workspace.setActiveLeaf(leaf, { focus: true }); return leaf.id; })()"),
    open: async (leafId, notePath, mode) => {
      const result = await ev(`(async () => {
        const leaf = app.workspace.getLeafById(${json(leafId)});
        const file = app.vault.getAbstractFileByPath(${json(notePath)});
        if (!leaf || !file) return { ok: false, error: "missing leaf or file" };
        const state = ${json(MODE_STATE[mode] || null)};
        await leaf.openFile(file, Object.assign({ active: true }, state ? { state } : {}));
        if (state && leaf.view && leaf.view.setState && window.__bobFrontmatterSpike.modeOf(leaf.view) !== ${json(mode)}) {
          await leaf.view.setState(Object.assign({}, leaf.view.getState(), state), { history: false });
        }
        app.workspace.setActiveLeaf(leaf, { focus: true });
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return { ok: true, path: leaf.view && leaf.view.file ? leaf.view.file.path : null, mode: window.__bobFrontmatterSpike.modeOf(leaf.view) };
      })()`);
      if (!result || !result.ok) throw new Error("open " + notePath + " failed: " + JSON.stringify(result));
      return result;
    },
    setMode: async (leafId, mode) => {
      const result = await ev(`(async () => {
        const leaf = app.workspace.getLeafById(${json(leafId)});
        await leaf.view.setState(Object.assign({}, leaf.view.getState(), ${json(MODE_STATE[mode])}), { history: false });
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return window.__bobFrontmatterSpike.modeOf(leaf.view);
      })()`);
      if (result !== mode) throw new Error("mode switch to " + mode + " landed on " + result);
      return result;
    },
    own: async (leafId) => {
      const result = await ev("(async () => { const row = window.__bobFrontmatterSpike.own(" + json(leafId) + "); await Promise.resolve(); await Promise.resolve(); return row; })()");
      if (!result || !result.ok) throw new Error("own failed: " + JSON.stringify(result));
      return result;
    },
    keys: async (key, modifiers = 0) => {
      // Vim-proof payloads matching the proven yank-flash/window-prefix
      // runners: zeroed virtual key codes, code echoing the key itself, and a
      // short gap between down and up. The generic keyEvents charCode shape
      // never reaches CodeMirror Vim or Obsidian hotkeys through CDP.
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
    shot: async (name, tags, width = 1400) => {
      const theme = (await ev("document.body.classList.contains('theme-dark')")) ? "dark" : "light";
      const row = await shared.capture(ctx.client, ctx.outDir, name, width, theme, tags.join(" "));
      row.tags = tags;
      ctx.report.screenshots.push(row);
      return row;
    },
  };
  return page;
}

function ownedOk(probe, mode) {
  const failures = [];
  if (probe.mode !== mode) failures.push("mode " + probe.mode);
  if (!probe.scopeClass) failures.push("missing owns-frontmatter class");
  if (!probe.containerPresent) failures.push("metadata-container missing from DOM");
  if (probe.containerVisible) failures.push("native Properties still visible");
  if (!probe.containerInert) failures.push("container is not inert");
  if (probe.ariaHidden !== "true") failures.push("aria-hidden is " + probe.ariaHidden);
  if (probe.display !== "none") failures.push("computed display is " + probe.display);
  return failures;
}

function variablesOk(probe, mode) {
  const failures = [];
  if (mode === "live" && probe.editingVar !== "none") failures.push("--metadata-display-editing is " + JSON.stringify(probe.editingVar));
  if (mode === "reading" && probe.readingVar !== "none") failures.push("--metadata-display-reading is " + JSON.stringify(probe.readingVar));
  return failures;
}

async function run(args) {
  const report = {
    startedAt: new Date().toISOString(), checks: [], screenshots: [], consoleExceptions: [], consoleErrors: [],
    prerequisites: [], measurements: {}, bobInvocations: { count: 0 }, pluginSource: pluginProvenance(),
    addFilePropertyCommand: null,
  };
  const outDir = path.resolve(args.out || path.join(os.tmpdir(), "bob-frontmatter-ownership-spike-shots-" + crypto.randomBytes(4).toString("hex")));
  const reportPath = path.resolve(args.report || path.join(outDir, "frontmatter-ownership-spike-report.json"));
  Object.assign(report, { reportPath, screenshotDirectory: outDir });
  let scratch = "";
  let child = null;
  let client = null;
  const check = (name, ok, detail = {}, mandatory = true) => {
    report.checks.push({ name, surface: lib.surfaceOf(name), status: ok ? "pass" : "fail", mandatory,
      detail: typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 24_000) });
    return ok;
  };
  const attempt = async (name, fn) => {
    try {
      const result = await fn();
      check(name, Boolean(result && result.ok), result || {});
    } catch (error) {
      check(name, false, { error: String(error && error.stack || error).slice(0, 3000) });
    }
  };
  try {
    fs.mkdirSync(outDir, { recursive: true });
    const executable = args.executable || process.env.OBSIDIAN_BIN || ELECTRON_FALLBACK;
    report.executable = executable;
    fs.accessSync(executable, fs.constants.X_OK);
    const help = spawnSync(executable, ["--help"], { encoding: "utf8", timeout: 20_000 });
    if (/unable to find Obsidian/i.test(String(help.stdout || "") + String(help.stderr || ""))) {
      throw new Error("This is the Obsidian CLI shim, not the Electron application.");
    }
    report.prerequisites.push({ name: "Obsidian-Electron-and-Xvfb-host", status: "pass", detail: { executable, display: process.env.DISPLAY || "" } });

    const notes = lib.fixtureNotes();
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "bob-frontmatter-ownership-spike-"));
    const vaultDir = path.join(scratch, "vault");
    const profileDir = path.join(scratch, "profile");
    const shimDir = path.join(profileDir, "shim");
    const bobLog = path.join(profileDir, "bob-invocations.jsonl");
    fs.mkdirSync(vaultDir, { recursive: true });
    for (const [name, content] of Object.entries(notes)) shared.writeNote(vaultDir, name, content);
    installVault(vaultDir);
    writeBobRefusal(shimDir, bobLog);
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
      env: { ...process.env, HOME: profileDir, BOB_DIR: vaultReal, PATH: shimDir + path.delimiter + (process.env.PATH || ""), TMPDIR: "/tmp", NO_COLOR: "1" },
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
    report.app = await client.evaluate("({ version: (/obsidian\\/([\\d.]+)/i.exec(navigator.userAgent) || [])[1] || '', enabled: Array.from(app.plugins.enabledPlugins || []), manifest: app.plugins.manifests['bob-ledger-tools']?.version || null, helpers: Boolean(app.plugins.plugins['bob-ledger-tools']?.constructor?.helpers?.propertyCardOwnFrontmatter) })");
    check("plugin-loaded", report.app.enabled.includes(PLUGIN_ID) && report.app.helpers && report.app.manifest === report.pluginSource.version, report.app);
    await shared.collapseSidebars(client);
    await shared.setViewport(client, 1400, 1000);
    await shared.setTheme(client, "light");

    const ctx = { client, report, notes, outDir, check, attempt };
    ctx.page = makePage(ctx);
    await ctx.page.install();
    ctx.main = await ctx.page.mainLeaf();

    await attempt("own-live", async () => {
      await ctx.page.open(ctx.main, "alpha.md", "live");
      await ctx.page.settle();
      const owned = await ctx.page.own(ctx.main);
      await ctx.page.settle(200);
      const probe = await ctx.page.probe(ctx.main);
      await ctx.page.shot("owned-live-light", ["live", "light", "wide"]);
      const failures = ownedOk(probe, "live");
      return { ok: failures.length === 0, owned, probe, failures };
    });

    await attempt("variables-live", async () => {
      const probe = await ctx.page.probe(ctx.main);
      const failures = variablesOk(probe, "live");
      return { ok: failures.length === 0, probe, failures };
    });

    await attempt("title-slot-anchor-live", async () => {
      const probe = await ctx.page.probe(ctx.main);
      const failures = [];
      if (!probe.containerPresent) failures.push("container left the DOM");
      if (probe.slotAnchor !== "metadata-container") failures.push("title slot anchor is " + probe.slotAnchor);
      if (!probe.slotParentConnected) failures.push("title slot parent is not connected");
      if (!(probe.slotParentRect && probe.slotParentRect.height > 0)) failures.push("title slot parent has no geometry");
      return { ok: failures.length === 0, probe, failures };
    });

    await attempt("vim-k-gg-up-live", async () => {
      const failures = [];
      // Live Preview refuses cursor positions inside the frontmatter block
      // (verified: anchor 0 resolves to offset 64, the first line after the
      // fence), so the top-of-document checks start at that clamp line.
      const placedTop = await ctx.page.ev("window.__bobFrontmatterProbe.setCursor(" + JSON.stringify(ctx.main) + ", 5, 0)");
      if (!placedTop || placedTop.ok !== true) failures.push("could not place cursor at the top line: " + JSON.stringify(placedTop));
      const downTop = await ctx.page.ev("window.__bobFrontmatterProbe.keyDowns()");
      await ctx.page.keys("Escape");
      await ctx.page.keys("g");
      await ctx.page.keys("g");
      const afterGg = await ctx.page.active();
      await ctx.page.keys("k");
      const afterK = await ctx.page.active();
      await ctx.page.keys("ArrowUp");
      const afterUp = await ctx.page.active();
      const downNav = await ctx.page.ev("window.__bobFrontmatterProbe.keyDowns()");
      if (!(downNav > downTop)) failures.push("navigation keys never reached the page");
      // Body insert plus undo: typing must reach the editor buffer (never a
      // property input). The buffer is the ground truth for typing; the disk
      // must be identical afterwards, so the passive-write gate stays
      // meaningful. Undo runs before any autosave can flush the marker.
      const placedBody = await ctx.page.ev("window.__bobFrontmatterProbe.setCursor(" + JSON.stringify(ctx.main) + ", 10, 0)");
      if (!placedBody || placedBody.ok !== true) failures.push("could not place cursor on the body line: " + JSON.stringify(placedBody));
      await ctx.page.keys("Escape");
      await ctx.page.keys("i");
      for (const ch of "s1ok") await ctx.page.keys(ch);
      await ctx.page.keys("Escape");
      const afterType = await ctx.page.active();
      const bufferText = await ctx.page.ev("window.__bobFrontmatterProbe.docText(" + JSON.stringify(ctx.main) + ")");
      await ctx.page.keys("u");
      await ctx.page.settle(1200);
      const restored = await ctx.page.ev("window.__bobFrontmatterProbe.readNote('alpha.md')");
      const probe = await ctx.page.probe(ctx.main);
      for (const [label, row] of [["gg", afterGg], ["k", afterK], ["up", afterUp], ["type", afterType]]) {
        if (row.inProperties) failures.push(label + " focused a property input");
      }
      if (!String(bufferText || "").includes("s1ok")) failures.push("inserted body text missing from the editor buffer (typing did not reach the editor)");
      if (restored !== notes["alpha.md"]) failures.push("undo did not restore alpha.md bytes");
      if (probe.activeInside) failures.push("probe still inside the container");
      return { ok: failures.length === 0, afterGg, afterK, afterUp, afterType, withMarker: String(bufferText || "").includes("s1ok"), restored: restored === notes["alpha.md"], probe, failures };
    });

    await attempt("tab-live", async () => {
      await ctx.page.ev(`(() => { const leaf = app.workspace.getLeafById(${JSON.stringify(ctx.main)}); leaf.view.editor.focus(); return true; })()`);
      const downBefore = await ctx.page.ev("window.__bobFrontmatterProbe.keyDowns()");
      await ctx.page.keys("Tab");
      const afterTab = await ctx.page.active();
      const downTab = await ctx.page.ev("window.__bobFrontmatterProbe.keyDowns()");
      await ctx.page.keys("Tab", 8);
      const afterShiftTab = await ctx.page.active();
      const downShiftTab = await ctx.page.ev("window.__bobFrontmatterProbe.keyDowns()");
      const failures = [];
      if (!(downTab > downBefore)) failures.push("Tab never reached the page");
      if (!(downShiftTab > downTab)) failures.push("Shift+Tab never reached the page");
      if (afterTab.inProperties) failures.push("Tab entered Properties");
      if (afterShiftTab.inProperties) failures.push("Shift+Tab entered Properties");
      return { ok: failures.length === 0, afterTab, afterShiftTab, failures };
    });

    await attempt("add-file-property-command", async () => {
      // Run on an unowned note so the native effect (focus the property key
      // input) stays observable and no owned scope is disturbed.
      await ctx.page.open(ctx.main, "beta.md", "live");
      await ctx.page.settle();
      const bytesBefore = await ctx.page.ev("window.__bobFrontmatterProbe.readNote('beta.md')");
      const commands = await ctx.page.commands();
      const exact = (commands || []).filter((row) => /add file property/i.test(row.name));
      if (exact.length === 0) {
        return { ok: false, commands, failures: ["no Add file property command in the registry (refusing fallback)"] };
      }
      const chosen = exact[0];
      const detail = await ctx.page.ev("window.__bobFrontmatterProbe.detail(" + JSON.stringify(chosen.id) + ")");
      report.addFilePropertyCommand = { id: chosen.id, name: chosen.name, detail, exactMatches: exact.length };
      const failures = [];
      if (exact.length !== 1) failures.push("expected exactly one Add file property command, saw " + exact.length);
      if (!detail || detail.found !== true) failures.push("command missing from the registry at dispatch time");
      if (detail && detail.callbackType !== "function" && detail.checkCallbackType !== "function") {
        failures.push("command has neither callback nor checkCallback");
      }
      const effective = [].concat(detail?.registeredHotkeys || [], detail?.defaultHotkeys || [], detail?.commandHotkeys || []);
      const hasModBinding = effective.some((hotkey) => hotkey && hotkey.key === ";"
        && Array.isArray(hotkey.modifiers)
        && (hotkey.modifiers.indexOf("Mod") !== -1 || hotkey.modifiers.indexOf("Ctrl") !== -1));
      if (!hasModBinding) failures.push("no Mod+; binding for " + chosen.id);
      const dry = await ctx.page.ev("window.__bobFrontmatterProbe.dryRun(" + JSON.stringify(chosen.id) + ")");
      if (!dry || dry.ok !== true || (dry.via === "checkCallback" && dry.returned !== true)) {
        failures.push("registered dispatch dry-run failed: " + JSON.stringify(dry));
      }
      // Bind explicitly only when the scratch profile lacks a Mod+; binding;
      // the shipped default already carries one.
      const bind = hasModBinding
        ? { ok: true, bound: false, skipped: true }
        : await ctx.page.ev("window.__bobFrontmatterProbe.bindMod(" + JSON.stringify(chosen.id) + ")");
      if (!bind || bind.ok !== true) failures.push("could not ensure an explicit Mod+; binding: " + JSON.stringify(bind));
      // Hotkey-triggered commands bypass executeCommandById (proven: Ctrl+P
      // opens the palette with no page keydown and no dispatch record), so a
      // Mod+; press is verified by its native effect: focus must land in the
      // property key input. The registered dispatch is verified separately
      // through the wrapped executeCommandById call.
      const focusBody = async () => {
        await ctx.page.ev("window.__bobFrontmatterProbe.setCursor(" + JSON.stringify(ctx.main) + ", 6, 0)");
        await ctx.page.settle(120);
      };
      await focusBody();
      await ctx.page.keys(";", 2);
      await ctx.page.settle(200);
      const afterCtrl = await ctx.page.active();
      const sawCtrlEffect = Boolean(afterCtrl.inProperties
        && /metadata-property-key-input/.test(afterCtrl.className || ""));
      await ctx.page.keys("Escape");
      await ctx.page.settle(150);
      await focusBody();
      await ctx.page.keys(";", 4);
      await ctx.page.settle(200);
      const afterMeta = await ctx.page.active();
      const sawMetaEffect = Boolean(afterMeta.inProperties
        && /metadata-property-key-input/.test(afterMeta.className || ""));
      await ctx.page.keys("Escape");
      await ctx.page.settle(150);
      await ctx.page.ev("(function() { window.__bobFrontmatterExecuteWrap = window.__bobFrontmatterProbe.wrapExecute(); return true; })()");
      await ctx.page.ev("(async () => { await app.commands.executeCommandById(" + JSON.stringify(chosen.id) + "); return true; })()");
      const seenDirect = await ctx.page.ev("window.__bobFrontmatterExecuteWrap.seen()");
      await ctx.page.ev("window.__bobFrontmatterExecuteWrap.restore()");
      const sawDirect = seenDirect.indexOf(chosen.id) !== -1;
      if (!sawDirect) failures.push("registered dispatch did not invoke " + chosen.id);
      if (!sawCtrlEffect) failures.push("Mod+; (Ctrl+; on Linux) did not focus the property key input");
      await ctx.page.keys("Escape");
      await ctx.page.settle(150);
      const after = await ctx.page.ev("(async () => ({ modal: window.__bobFrontmatterProbe.modalOpen(), active: window.__bobFrontmatterProbe.active(), bytes: await window.__bobFrontmatterProbe.readNote('beta.md') }))()");
      if (after.modal) failures.push("native UI still open after Escape");
      let restored = null;
      if (bytesBefore !== after.bytes) {
        await ctx.page.ev("(async () => { const file = app.vault.getAbstractFileByPath('beta.md'); await app.vault.modify(file, " + JSON.stringify(bytesBefore) + "); return true; })()");
        await ctx.page.settle(200);
        restored = await ctx.page.ev("window.__bobFrontmatterProbe.readNote('beta.md')");
        if (restored !== bytesBefore) failures.push("could not restore beta.md after the command wrote");
      }
      return {
        ok: failures.length === 0, command: report.addFilePropertyCommand, dry, bind,
        sawCtrlEffect, sawMetaEffect, sawDirect, bytesUnchanged: bytesBefore === after.bytes,
        restored: restored === null ? null : restored === bytesBefore,
        afterActive: after.active, failures,
      };
    });

    await attempt("source-toggle-releases", async () => {
      await ctx.page.open(ctx.main, "alpha.md", "live");
      await ctx.page.own(ctx.main);
      await ctx.page.settle(200);
      await ctx.page.setMode(ctx.main, "source");
      await ctx.page.settle(250);
      const source = await ctx.page.probe(ctx.main);
      const failures = [];
      if (source.scopeClass) failures.push("owns class remained in Source");
      if (source.containerInert) failures.push("container stayed inert in Source");
      await ctx.page.setMode(ctx.main, "live");
      await ctx.page.settle(250);
      return { ok: failures.length === 0, source, failures };
    });

    await attempt("path-change-releases", async () => {
      await ctx.page.open(ctx.main, "alpha.md", "live");
      await ctx.page.own(ctx.main);
      await ctx.page.settle(200);
      await ctx.page.open(ctx.main, "beta.md", "live");
      await ctx.page.settle(250);
      const probe = await ctx.page.probe(ctx.main);
      const failures = [];
      if (probe.scopeClass) failures.push("owns class leaked onto beta.md");
      if (probe.containerInert) failures.push("beta.md container is inert without a new own()");
      // Navigate back, re-own, and type in the body: focus must never enter
      // Properties and the typed text must land in the note. The marker is
      // undone so the passive-write gate stays meaningful.
      await ctx.page.open(ctx.main, "alpha.md", "live");
      await ctx.page.own(ctx.main);
      await ctx.page.settle(200);
      const placedNav = await ctx.page.ev("window.__bobFrontmatterProbe.setCursor(" + JSON.stringify(ctx.main) + ", 12, 0)");
      if (!placedNav || placedNav.ok !== true) failures.push("could not place cursor for navigation typing: " + JSON.stringify(placedNav));
      await ctx.page.keys("Escape");
      await ctx.page.keys("i");
      for (const ch of "navok") await ctx.page.keys(ch);
      await ctx.page.keys("Escape");
      const afterType = await ctx.page.active();
      const bufferText = await ctx.page.ev("window.__bobFrontmatterProbe.docText(" + JSON.stringify(ctx.main) + ")");
      await ctx.page.keys("u");
      await ctx.page.settle(1200);
      const restored = await ctx.page.ev("window.__bobFrontmatterProbe.readNote('alpha.md')");
      if (afterType.inProperties) failures.push("body typing after navigation entered Properties");
      if (!String(bufferText || "").includes("navok")) failures.push("typed body text missing from the editor buffer after navigation");
      if (restored !== notes["alpha.md"]) failures.push("undo did not restore alpha.md bytes after navigation typing");
      return { ok: failures.length === 0, probe, afterType, typed: String(bufferText || "").includes("navok"), restored: restored === notes["alpha.md"], failures };
    });

    await attempt("modify-keeps-ownership-live", async () => {
      await ctx.page.open(ctx.main, "alpha.md", "live");
      await ctx.page.own(ctx.main);
      await ctx.page.settle(200);
      const before = await ctx.page.ev("window.__bobFrontmatterProbe.readNote('alpha.md')");
      await ctx.page.ev("(async () => { const file = app.vault.getAbstractFileByPath('alpha.md'); await app.vault.modify(file, (await app.vault.read(file)) + '\\nExternal line\\n'); return true; })()");
      await ctx.page.settle(400);
      const probe = await ctx.page.probe(ctx.main);
      const after = await ctx.page.ev("window.__bobFrontmatterProbe.readNote('alpha.md')");
      const failures = ownedOk(probe, "live");
      if (after !== before + "\nExternal line\n") failures.push("external modify did not land as expected");
      await ctx.page.ev("(async () => { const file = app.vault.getAbstractFileByPath('alpha.md'); await app.vault.modify(file, " + JSON.stringify(notes["alpha.md"]) + "); return true; })()");
      await ctx.page.settle(200);
      const restored = await ctx.page.ev("window.__bobFrontmatterProbe.readNote('alpha.md')");
      if (restored !== notes["alpha.md"]) failures.push("could not restore alpha.md after external modify");
      return { ok: failures.length === 0, probe, restored: restored === notes["alpha.md"], failures };
    });

    await attempt("own-reading", async () => {
      await ctx.page.open(ctx.main, "alpha.md", "reading");
      await ctx.page.settle();
      const owned = await ctx.page.own(ctx.main);
      await ctx.page.settle(200);
      const probe = await ctx.page.probe(ctx.main);
      await ctx.page.shot("owned-reading-light", ["reading", "light", "wide"]);
      const failures = ownedOk(probe, "reading");
      return { ok: failures.length === 0, owned, probe, failures };
    });

    await attempt("variables-reading", async () => {
      const probe = await ctx.page.probe(ctx.main);
      const failures = variablesOk(probe, "reading");
      return { ok: failures.length === 0, probe, failures };
    });

    await attempt("title-slot-anchor-reading", async () => {
      const probe = await ctx.page.probe(ctx.main);
      const failures = [];
      if (!probe.containerPresent) failures.push("container left the DOM");
      if (probe.slotAnchor !== "metadata-container") failures.push("title slot anchor is " + probe.slotAnchor);
      if (!probe.slotParentConnected) failures.push("title slot parent is not connected");
      if (!(probe.slotParentRect && probe.slotParentRect.height > 0)) failures.push("title slot parent has no geometry");
      return { ok: failures.length === 0, probe, failures };
    });

    await attempt("tab-reading", async () => {
      const downBefore = await ctx.page.ev("window.__bobFrontmatterProbe.keyDowns()");
      await ctx.page.keys("Tab");
      const afterTab = await ctx.page.active();
      const downTab = await ctx.page.ev("window.__bobFrontmatterProbe.keyDowns()");
      await ctx.page.keys("Tab", 8);
      const afterShiftTab = await ctx.page.active();
      const downShiftTab = await ctx.page.ev("window.__bobFrontmatterProbe.keyDowns()");
      const failures = [];
      if (!(downTab > downBefore)) failures.push("Tab never reached the page");
      if (!(downShiftTab > downTab)) failures.push("Shift+Tab never reached the page");
      if (afterTab.inProperties) failures.push("Tab entered Properties");
      if (afterShiftTab.inProperties) failures.push("Shift+Tab entered Properties");
      return { ok: failures.length === 0, afterTab, afterShiftTab, failures };
    });

    await attempt("deny-embed", async () => {
      await ctx.page.open(ctx.main, "embedder.md", "reading");
      await ctx.page.settle(400);
      const result = await ctx.page.ev(`(() => {
        const embed = document.querySelector(".markdown-embed, .internal-embed");
        const scope = embed && embed.querySelector(".markdown-preview-view");
        const helpers = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].constructor.helpers;
        const handle = helpers.propertyCardOwnFrontmatter(scope, { path: "alpha.md" });
        return { ok: handle == null, hasEmbed: Boolean(embed), hasScope: Boolean(scope) };
      })()`);
      return result;
    });

    await shared.setTheme(ctx.client, "dark");
    await ctx.page.open(ctx.main, "alpha.md", "live");
    await ctx.page.own(ctx.main);
    await ctx.page.settle(200);
    await ctx.page.shot("owned-live-dark", ["live", "dark", "wide"]);
    await ctx.page.open(ctx.main, "alpha.md", "reading");
    await ctx.page.own(ctx.main);
    await ctx.page.settle(200);
    await ctx.page.shot("owned-reading-dark", ["reading", "dark", "wide"]);
    await shared.setTheme(ctx.client, "light");
    await ctx.page.spike("stop()");

    await sleep(400);
    report.fixtures.final = hashFixtures(vaultReal, names);
    const changed = names.filter((name) => report.fixtures.final[name] !== report.fixtures.expected[name]);
    check("bytes-unchanged", changed.length === 0, { changed, seeded: report.fixtures.seeded, final: report.fixtures.final });
    const tags = new Set(report.screenshots.flatMap((row) => row.tags || []));
    const needed = ["live", "reading", "light", "dark"];
    check("screenshots-captured", report.screenshots.length >= 4 && needed.every((tag) => tags.has(tag)),
      { count: report.screenshots.length, missingTags: needed.filter((tag) => !tags.has(tag)) });
    check("no-console-exceptions", report.consoleExceptions.length === 0, report.consoleExceptions);
    const invocations = fs.existsSync(bobLog) ? fs.readFileSync(bobLog, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
    report.bobInvocations = { count: invocations.length, refused: true };
  } catch (error) {
    report.error = error && error.stack ? error.stack : String(error);
    report.prerequisites.push({ name: "runner", status: "fail", detail: String(error && error.message || error) });
    if (client) {
      try { report.screenshots.push(await shared.capture(client, outDir, "frontmatter-ownership-runner-failure", 1400, "light", "failure state")); }
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
      verdict: report.verdict.verdict, fallback: report.verdict.fallback,
      addFilePropertyCommand: report.addFilePropertyCommand,
      failed: Object.values(report.verdict.surfaces).flatMap((value) => value.failed),
      screenshots: report.screenshots.length, consoleExceptions: report.consoleExceptions.length,
    };
    if (client) client.close();
    if (child && child.exitCode == null) {
      try { child.kill("SIGTERM"); } catch (_) {}
      await sleep(400);
      if (child.exitCode == null) { try { child.kill("SIGKILL"); } catch (_) {} }
    }
    report.finishedAt = new Date().toISOString();
    if (report.pass && scratch) fs.rmSync(scratch, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  }
  process.stdout.write("FRONTMATTER OWNERSHIP: " + report.verdict.verdict + "\n");
  process.stdout.write("Add file property command: " + JSON.stringify(report.addFilePropertyCommand) + "\n");
  process.stdout.write("Report: " + reportPath + "\nScreenshots: " + outDir + "\n");
  for (const row of report.checks.filter((item) => item.status === "fail")) process.stderr.write("- " + row.name + ": " + row.detail.slice(0, 1500) + "\n");
  if (!report.pass) process.exitCode = 1;
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
      new Function("return " + lib.ADAPTER_SOURCE);
      new Function("return " + lib.PROBE_SOURCE);
      process.stdout.write("offline self-test complete (frontmatter-ownership fixtures, probes, verdict; no Obsidian launched)\n");
    } catch (error) {
      process.stderr.write(String(error.stack || error) + "\n");
      process.exitCode = 1;
    }
    return;
  }
  await run(args);
}

if (require.main === module) void main(process.argv.slice(2));
module.exports = { MODE_STATE, installVault, pluginProvenance };
