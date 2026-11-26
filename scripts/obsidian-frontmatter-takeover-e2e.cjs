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
const OVERALL_TIMEOUT_MS = 1_500_000;
const COMMAND_ID = "markdown:add-metadata-property";
const MODE_STATE = {
  live: { mode: "source", source: false },
  source: { mode: "source", source: true },
  reading: { mode: "preview" },
};
const { sleep, waitFor } = shared;
const P = lib.PATHS;
let activeRun = null;
const VIM_PROBE_PATH = "2026/20261119.md";
const STALE_CACHE_PROBE_PATH = "2026/20261118.md";
const NATIVE_FALLBACK_PROBE_PATH = "2026/20261117.md";
const FOREIGN_REFRESH_PATH = "unrelated-refresh.md";
const AUTOSAVE_DAY_PATH = "2026/20261116.md";
const AUTOSAVE_RECORD_PATH = "eat/autosave-probe.md";
const SLOW_DAY_PATH = "2026/20261115.md";
const SLOW_RECORD_PATH = "eat/slow-reparse-probe.md";

function fail(message, code = 1) {
  process.stderr.write(String(message) + "\n");
  process.exit(code);
}

function slimSampler(sampled) {
  const samples = Array.isArray(sampled && sampled.samples) ? sampled.samples : [];
  const failures = Array.isArray(sampled && sampled.failures) ? sampled.failures : [];
  const kinds = {};
  for (const row of failures) {
    const kind = row && row.kind || "unknown";
    if (!kinds[kind]) kinds[kind] = { count: 0, firstT: row.t, lastT: row.t };
    kinds[kind].count += 1;
    kinds[kind].lastT = row.t;
  }
  const pick = (row) => (row ? {
    t: row.t,
    containerVisible: row.containerVisible,
    owns: row.owns,
    slotCard: row.slotCard,
    inlineVisible: row.inlineVisible,
    liveCache: row.liveCache,
    settledCache: row.settledCache,
    cardText: String(row.cardText || "").slice(0, 160),
  } : null);
  return {
    count: Number(sampled && sampled.count) || samples.length,
    kinds,
    uniqueCardTexts: new Set(samples.map((row) => row && row.cardText)).size,
    first: pick(samples[0]),
    last: pick(samples[samples.length - 1]),
    failures: failures.slice(0, 12),
  };
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
let result = spawnSync(real, args, {
  encoding: "utf8", env: process.env, input, timeout: 90000, maxBuffer: 32 * 1024 * 1024,
});
if (args[0] === "__catalog" && control.mode === "contractless" && result.status === 0) {
  try {
    const catalog = JSON.parse(result.stdout || "{}");
    catalog.features = Array.isArray(catalog.features)
      ? catalog.features.filter((feature) => feature !== "props_contract_v1")
      : [];
    result.stdout = JSON.stringify(catalog);
  } catch (_) {}
}
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
    waitContract: async (contract, timeoutMs = 20_000) => {
      const deadline = Date.now() + timeoutMs;
      let last = null;
      while (Date.now() < deadline) {
        last = await ev(`(() => {
          const plugin = app.plugins.plugins[${json(PLUGIN_ID)}];
          if (!plugin) return null;
          return plugin.propertyCapabilityState(plugin.propertyCapabilityCurrentBobKey());
        })()`);
        if (last && last.contract === contract) return last;
        await sleep(150);
      }
      throw new Error("contract capability " + contract + " timed out: " + JSON.stringify(last));
    },
    modal: (kind) => ev(lib.modalProbeSource(kind)),
    startOpenerWatch: (kind) => ev(lib.openerWatchSource(kind, "start")),
    openerWatch: (kind) => ev(lib.openerWatchSource(kind, "read")),
    stopOpenerWatch: (kind) => ev(lib.openerWatchSource(kind, "stop")),
    waitOpener: async (kind, label, timeoutMs = 5_000) => {
      const deadline = Date.now() + timeoutMs;
      let last = null;
      while (Date.now() < deadline) {
        last = await page.openerWatch(kind);
        if (last?.called && !last.pending) return last;
        await sleep(75);
      }
      throw new Error((label || kind + " opener") + " did not settle: " + JSON.stringify(last));
    },
    waitModal: async (kind, expectedClass, label, timeoutMs = 10_000) => {
      const deadline = Date.now() + timeoutMs;
      let last = null;
      while (Date.now() < deadline) {
        last = await page.modal(kind);
        if (lib.modalLifecycleFailures(last, expectedClass).length === 0) return last;
        await sleep(100);
      }
      throw new Error((label || kind + " modal") + " timed out: " + JSON.stringify(last));
    },
    bankSnapshot: async (leafId) => {
      const probe = await page.probe(leafId);
      const state = await ev(`(async () => {
        const plugin = app.plugins.plugins[${json(PLUGIN_ID)}];
        const leaf = app.workspace.getLeafById(${json(leafId)});
        const view = leaf?.view || null;
        const viewMode = !view ? "" : view.getMode?.() === "preview" ? "reading"
          : view.getState?.()?.source ? "source" : "live";
        const bankFile = app.vault.getAbstractFileByPath(${json(P.bank)});
        const bankSource = bankFile ? await app.vault.read(bankFile) : null;
        const frontmatter = bankFile ? app.metadataCache.getFileCache(bankFile)?.frontmatter || null : null;
        const scope = viewMode === "reading" ? view?.previewMode?.containerEl : view?.editor?.cm?.dom;
        const drawer = scope?.querySelector?.('.bob-home-card[data-home-source="bank.md"] .bob-property-card-foot-drawer');
        return {
          leafPath: view?.file?.path || "", viewMode,
          bankSource,
          bankCache: frontmatter ? JSON.parse(JSON.stringify(frontmatter)) : null,
          homeCardActive: plugin?.homeCardActive,
          bankSetupActive: plugin?.bankSetupActive,
          bankSetupCardActive: plugin?.bankSetupCardActive,
          propertyEditorEntrypointsActive: plugin?.propertyEditorEntrypointsActive,
          bankSetupExpanded: plugin?.bankSetupModelFor?.("bank.md")?.expanded === true,
          homeDrawerOpen: drawer?.getAttribute?.("data-open") === "true",
          capability: (() => {
            try { return plugin?.propertyCapabilityState?.(plugin.propertyCapabilityCurrentBobKey?.()) || null; }
            catch (_) { return null; }
          })(),
          markdownLeaves: app.workspace.getLeavesOfType("markdown").map((item) => item.id),
        };
      })()`);
      return {
        probe, state,
        bankModal: await page.modal("bank"),
        propertyModal: await page.modal("property"),
        bankOpener: await page.openerWatch("bank"),
        propertyOpener: await page.openerWatch("property"),
      };
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
      process.stderr.write("[frontmatter-takeover] screenshot " + name + " sha256=" + row.sha256 + "\n");
      return row;
    },
    closeEditor: async () => {
      await lib.dismissEditor({
        isOpen: async () => {
          const modal = await page.modal("property");
          return modal.present && !modal.closed;
        },
        escape: () => page.keys("Escape"),
      });
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
    addFilePropertyCommand: null, profile: args.profile || "full", skippedChecks: [],
  };
  const outDir = path.resolve(args.out || path.join(os.tmpdir(), "bob-frontmatter-takeover-e2e-shots-" + crypto.randomBytes(4).toString("hex")));
  const reportPath = path.resolve(args.report || path.join(outDir, "frontmatter-takeover-report.json"));
  Object.assign(report, { reportPath, screenshotDirectory: outDir });
  activeRun = { report, reportPath, outDir, currentCheck: null, client: null, child: null, profile: report.profile };
  let scratch = "";
  let child = null;
  let client = null;
  let vaultReal = "";
  let fixtureNames = [];
  let bobLogPath = "";
  let fixtureWatch = null;
  let bankFixtureWatch = null;
  let fixtureWatchTimer = null;
  let ctxRef = null;
  let testControlPath = "";
  const observeFixtureWatch = (stage) => {
    for (const [watcher, key] of [[fixtureWatch, "fixtureWatch"], [bankFixtureWatch, "bankFixtureWatch"]]) {
      if (!watcher) continue;
      if (stage) watcher.stage = stage;
      let content = "";
      let hash = null;
      try {
        content = fs.readFileSync(watcher.file, "utf8");
        hash = sha256Text(content);
      } catch (_) {}
      if (hash !== watcher.current) {
        let firstDifference = null;
        if (hash && content !== watcher.expectedText) {
          let offset = 0;
          while (offset < content.length && offset < watcher.expectedText.length
            && content[offset] === watcher.expectedText[offset]) offset += 1;
          firstDifference = {
            offset,
            expected: watcher.expectedText.slice(Math.max(0, offset - 80), offset + 160),
            actual: content.slice(Math.max(0, offset - 80), offset + 160),
          };
        }
        watcher.transitions.push({
          at: new Date().toISOString(), stage: watcher.stage,
          from: watcher.current, to: hash, firstDifference,
        });
        watcher.current = hash;
      }
      if (report[key]) report[key].final = hash;
    }
  };
  const check = (name, ok, detail = {}, mandatory = true) => {
    report.checks.push({
      name, surface: lib.surfaceOf(name), status: ok ? "pass" : "fail", mandatory,
      detail: typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 24_000),
    });
    return ok;
  };
  const finalCheck = async (name, fn) => {
    try {
      const result = await fn();
      const ok = Boolean(result && result.ok !== false
        && (result.ok === true || result.ok === undefined || result.failures === undefined || result.failures.length === 0));
      check(name, ok, result || {});
    } catch (error) {
      check(name, false, { error: String(error && error.stack || error).slice(0, 3000) });
    }
  };
  const restoreBankProbe = async (before) => {
    const failures = [];
    if (!ctxRef || !client || !before?.state) return failures;
    const safe = async (label, action) => {
      try { await action(); } catch (error) { failures.push(label + ": " + String(error?.message || error)); }
    };
    await safe("restore opener watches", async () => {
      await ctxRef.page.stopOpenerWatch("bank");
      await ctxRef.page.stopOpenerWatch("property");
    });
    await safe("restore plugin/modal state", async () => {
      const pluginMissing = await ctxRef.page.ev(`!app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]`);
      await ctxRef.page.ev(`(async () => {
        if (${JSON.stringify(pluginMissing)}) {
          await app.plugins.enablePlugin(${JSON.stringify(PLUGIN_ID)});
        }
        const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        try { plugin?.bankSetupCardModal?.close?.(); } catch (_) {}
        try { plugin?.propertyEditorModal?.close?.(); } catch (_) {}
        if (!plugin) return false;
        const flags = ${JSON.stringify({
          homeCardActive: before.state.homeCardActive,
          bankSetupActive: before.state.bankSetupActive,
          bankSetupCardActive: before.state.bankSetupCardActive,
          propertyEditorEntrypointsActive: before.state.propertyEditorEntrypointsActive,
        })};
        for (const [key, value] of Object.entries(flags)) if (value !== undefined) plugin[key] = value;
        try { plugin.scheduleHomeCardRefresh?.(); } catch (_) {}
        try { plugin.scheduleBankSetupRefresh?.(); } catch (_) {}
        return true;
      })()`);
      await waitFor(client, "Boolean(app.plugins.plugins[" + JSON.stringify(PLUGIN_ID) + "])" , Boolean, "Bank probe plugin restore", 30_000);
      if (pluginMissing) await ctxRef.page.install();
    });
    await safe("restore Bank fixture source", async () => {
      if (typeof before.state.bankSource !== "string") return;
      const current = await ctxRef.page.ev(`(async () => {
        const file = app.vault.getAbstractFileByPath(${JSON.stringify(P.bank)});
        return file ? await app.vault.read(file) : null;
      })()`);
      if (current !== before.state.bankSource) {
        await ctxRef.page.ev(`(async () => {
          const file = app.vault.getAbstractFileByPath(${JSON.stringify(P.bank)});
          if (!file) throw new Error("bank.md disappeared during probe");
          await app.vault.modify(file, ${JSON.stringify(before.state.bankSource)});
          return true;
        })()`);
        await waitFor(client,
          "window.__bobFrontmatterTakeover.readNote(" + JSON.stringify(P.bank) + ") === " + JSON.stringify(before.state.bankSource),
          Boolean, "Bank fixture source restore", 15_000);
      }
    });
    await safe("restore capability shim", async () => {
      let control = { mode: "pass" };
      try { control = JSON.parse(fs.readFileSync(testControlPath, "utf8")); } catch (_) {}
      const configPath = path.join(ctxRef.profileDir, ".config", "bob", "config.yml");
      const config = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
      if (control.mode !== "pass" || config.includes("shim-alt")) {
        writeControl(testControlPath, "pass");
        ctxRef.page.writeConfig(null);
        await ctxRef.page.ev(`(() => {
          const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          if (!plugin) return false;
          if (plugin.propertyCapabilityByBobPath instanceof Map) plugin.propertyCapabilityByBobPath.clear();
          plugin.propertyCapabilityGeneration = (plugin.propertyCapabilityGeneration || 0) + 1;
          return plugin.schedulePropertyCapabilityProbes("bank-probe-cleanup");
        })()`);
        await ctxRef.page.waitCapability("confirmed", 25_000);
      }
    });
    await safe("restore Bank setup fold and Area drawer", async () => {
      const now = await ctxRef.page.bankSnapshot(ctxRef.main);
      if (now.state.bankSetupExpanded !== before.state.bankSetupExpanded
        || now.state.homeDrawerOpen !== before.state.homeDrawerOpen) {
        await ctxRef.page.ev(`(() => {
          const leaf = app.workspace.getLeafById(${JSON.stringify(ctxRef.main)});
          const view = leaf?.view;
          const scope = view?.getMode?.() === "preview" ? view.previewMode?.containerEl : view?.editor?.cm?.dom;
          const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          const expanded = plugin?.bankSetupModelFor?.("bank.md")?.expanded === true;
          if (expanded !== ${JSON.stringify(before.state.bankSetupExpanded)}) {
            scope?.querySelector?.('.bob-bank-setup[data-bank-setup-source="bank.md"] .bob-bank-setup-toggle')?.click?.();
          }
          const disclosure = scope?.querySelector?.('.bob-home-card[data-home-source="bank.md"] .bob-property-card-foot-disclosure');
          const drawer = scope?.querySelector?.('.bob-home-card[data-home-source="bank.md"] .bob-property-card-foot-drawer');
          const drawerOpen = drawer?.getAttribute?.("data-open") === "true";
          if (disclosure && drawerOpen !== ${JSON.stringify(before.state.homeDrawerOpen)}) disclosure.click();
          return true;
        })()`);
      }
    });
    await safe("restore pane set", async () => {
      const originalLeaves = new Set(before.state.markdownLeaves || []);
      await ctxRef.page.ev(`(() => {
        const keep = new Set(${JSON.stringify(before.state.markdownLeaves || [])});
        for (const leaf of app.workspace.getLeavesOfType("markdown")) {
          if (!keep.has(leaf.id)) leaf.detach?.();
        }
        return true;
      })()`);
      void originalLeaves;
    });
    await safe("restore active note and mode", async () => {
      if (!before.state.leafPath) return;
      const mode = ["live", "reading", "source"].includes(before.state.viewMode) ? before.state.viewMode : "live";
      await ctxRef.page.open(ctxRef.main, before.state.leafPath, mode);
      await ctxRef.page.settle(250);
    });
    await safe("restore Bank activity flags", async () => {
      await ctxRef.page.ev(`(() => {
        const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        if (!plugin) return false;
        for (const [key, value] of Object.entries(${JSON.stringify({
          homeCardActive: before.state.homeCardActive,
          bankSetupActive: before.state.bankSetupActive,
          bankSetupCardActive: before.state.bankSetupCardActive,
          propertyEditorEntrypointsActive: before.state.propertyEditorEntrypointsActive,
        })})) if (value !== undefined) plugin[key] = value;
        try { plugin.scheduleHomeCardRefresh?.(); } catch (_) {}
        try { plugin.scheduleBankSetupRefresh?.(); } catch (_) {}
        return true;
      })()`);
    });
    return failures;
  };
  const attempt = async (name, fn) => {
    if (args.profile === "bank" && !lib.BANK_PROFILE_PRODUCT_CHECKS.includes(name)) {
      report.skippedChecks.push(name);
      process.stderr.write("[frontmatter-takeover] check skipped by Bank profile " + name + "\n");
      return;
    }
    observeFixtureWatch("before:" + name);
    const startedAt = new Date().toISOString();
    activeRun.currentCheck = { name, startedAt };
    process.stderr.write("[frontmatter-takeover] check start " + name + " " + startedAt + "\n");
    const bankProbe = lib.BANK_PROFILE_PRODUCT_CHECKS.includes(name);
    let before = null;
    let after = null;
    let result = null;
    let error = null;
    let cleanupFailures = [];
    try {
      if (bankProbe && ctxRef?.page) {
        try { before = await ctxRef.page.bankSnapshot(ctxRef.main); }
        catch (snapshotError) { before = { snapshotError: String(snapshotError?.message || snapshotError) }; }
      }
      if (client) await client.evaluate(`(() => {
        const audit = window.__bobFrontmatterTakeoverWriteAudit;
        if (audit) audit.stage = ${JSON.stringify(name)};
      })()`);
      result = await fn();
    } catch (caught) {
      error = caught;
    } finally {
      if (bankProbe && ctxRef?.page) {
        try { after = await ctxRef.page.bankSnapshot(ctxRef.main); }
        catch (snapshotError) { after = { snapshotError: String(snapshotError?.message || snapshotError) }; }
        cleanupFailures = await restoreBankProbe(before);
      }
      const resultOk = Boolean(result && result.ok !== false
        && (result.ok === true || result.ok === undefined || result.failures === undefined || result.failures.length === 0));
      const ok = !error && resultOk && cleanupFailures.length === 0;
      const detail = bankProbe
        ? { result: result || null, error: error ? String(error && error.stack || error).slice(0, 3000) : null,
          bankState: { before, after }, cleanupFailures }
        : error ? { error: String(error && error.stack || error).slice(0, 3000) } : result || {};
      check(name, ok, detail);
      const row = report.checks[report.checks.length - 1];
      if (row?.name === name) Object.assign(row, { startedAt, finishedAt: new Date().toISOString() });
      process.stderr.write("[frontmatter-takeover] check done " + name + " status=" + (row?.status || "unknown") + " " + new Date().toISOString() + "\n");
      activeRun.currentCheck = null;
      observeFixtureWatch("after:" + name);
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
    bobLogPath = bobLog;
    const controlPath = path.join(profileDir, "bob-control.json");
    testControlPath = controlPath;
    fs.mkdirSync(vaultDir, { recursive: true });
    fs.mkdirSync(profileDir, { recursive: true });
    for (const [name, content] of Object.entries(notes)) shared.writeNote(vaultDir, name, content);
    shared.writeNote(vaultDir, FOREIGN_REFRESH_PATH, "---\ntype: scratch\nvalue: before\n---\nUnrelated refresh fixture.\n");
    shared.writeNote(vaultDir, "board.canvas", lib.canvasFixture());
    installVault(vaultDir);
    writeControl(controlPath, "pass");
    const shim = writeBobShim(shimDir, bobLog, controlPath, bob.path);
    writeBobShim(altShimDir, bobLog, controlPath, bob.path);
    shared.initScratchGit(vaultDir);
    vaultReal = fs.realpathSync(vaultDir);
    shared.seedProfile(profileDir, vaultReal);
    const names = Object.keys(notes).sort();
    fixtureNames = names;
    report.fixtures = { names, expected: Object.fromEntries(names.map((name) => [name, sha256Text(notes[name])])), seeded: hashFixtures(vaultReal, names) };
    report.scratch = { root: scratch, vault: vaultReal, profile: profileDir };
    fixtureWatch = {
      file: path.join(vaultReal, P.day), expectedText: notes[P.day],
      current: report.fixtures.expected[P.day], stage: "startup", transitions: [],
    };
    report.fixtureWatch = {
      path: P.day, expected: fixtureWatch.current, transitions: [], final: fixtureWatch.current,
    };
    fixtureWatch.transitions = report.fixtureWatch.transitions;
    bankFixtureWatch = {
      file: path.join(vaultReal, P.bank), expectedText: notes[P.bank],
      current: report.fixtures.expected[P.bank], stage: "startup", transitions: [],
    };
    report.bankFixtureWatch = {
      path: P.bank, expected: bankFixtureWatch.current, transitions: [], final: bankFixtureWatch.current,
    };
    bankFixtureWatch.transitions = report.bankFixtureWatch.transitions;
    fixtureWatchTimer = setInterval(() => observeFixtureWatch(), 100);

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
    activeRun.child = child;
    child.stderr.on("data", () => {});
    report.obsidianProcess = { pid: child.pid, executable, debugPort: port };
    const target = await shared.selectTarget(port, vaultReal, () => child && child.exitCode == null);
    client = target.client;
    activeRun.client = client;
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
    ctxRef = ctx;
    ctx.page = makePage(ctx);
    await ctx.page.install();
    await ctx.page.ev(`(() => {
      const audit = { rows: [], restores: [], stage: "startup" };
      const normalizePath = (value) => String(value?.path ?? value ?? "").replace(/\\\\/g, "/");
      const trackedPaths = new Set(${JSON.stringify([...names, VIM_PROBE_PATH, STALE_CACHE_PROBE_PATH, NATIVE_FALLBACK_PROBE_PATH, FOREIGN_REFRESH_PATH])});
      const wrap = (owner, name, pathAt) => {
        if (!owner || typeof owner[name] !== "function") return;
        const original = owner[name];
        const wrapped = function(...args) {
          const path = normalizePath(pathAt(args));
          if (trackedPaths.has(path)) {
            audit.rows.push({
              api: name, path, stage: audit.stage,
              at: new Date().toISOString(),
              stack: String(new Error().stack || "").split("\\n").slice(2, 12),
            });
          }
          return original.apply(this, args);
        };
        owner[name] = wrapped;
        audit.restores.push(() => { if (owner[name] === wrapped) owner[name] = original; });
      };
      wrap(app.vault, "modify", (args) => args[0]);
      wrap(app.vault, "process", (args) => args[0]);
      wrap(app.fileManager, "processFrontMatter", (args) => args[0]);
      wrap(app.vault.adapter, "write", (args) => args[0]);
      wrap(app.vault.adapter, "writeBinary", (args) => args[0]);
      window.__bobFrontmatterTakeoverWriteAudit = audit;
      return { apis: audit.restores.length };
    })()`);
    ctx.main = await ctx.page.mainLeaf();
    await ctx.page.open(ctx.main, P.day, "live");
    await ctx.page.settle(400);
    await ctx.page.waitCapability("confirmed");

    const ownCase = (name, notePath, mode) => attempt(name, async () => {
      await ctx.page.open(ctx.main, notePath, mode);
      await ctx.page.settle(250);
      const probe = await ctx.page.waitOwned(ctx.main, mode, name);
      const failures = [];
      if (notePath === P.bank && probe.slotAnchor !== "metadata-container") {
        failures.push("bank title-slot anchor is " + probe.slotAnchor);
      }
      return { ok: failures.length === 0, probe, failures };
    });
    await ownCase("own-day-live", P.day, "live");
    await ownCase("own-day-reading", P.day, "reading");
    await ownCase("own-week-live", P.week, "live");
    await ownCase("own-week-reading", P.week, "reading");
    await ownCase("own-record-live", P.record, "live");
    await ownCase("own-record-reading", P.record, "reading");
    await ownCase("own-album-live", P.album, "live");
    await ownCase("own-album-reading", P.album, "reading");
    await attempt("foreign-refresh-keeps-ownership", async () => {
      let extraLeaves = [];
      try {
        extraLeaves = await ctx.page.ev(`(() => {
          const ids = [];
          for (let index = 0; index < 3; index += 1) {
            const leaf = app.workspace.getLeaf("split");
            if (!leaf || typeof leaf.id !== "string") break;
            ids.push(leaf.id);
          }
          return ids;
        })()`);
        if (!Array.isArray(extraLeaves) || extraLeaves.length !== 3 || new Set(extraLeaves).size !== 3) {
          throw new Error("could not create three independent Markdown leaves");
        }
        const targets = [
          { label: "day Live Preview", leaf: ctx.main, path: P.day, mode: "live" },
          { label: "day Reading", leaf: extraLeaves[0], path: P.day, mode: "reading" },
          { label: "album Live Preview", leaf: extraLeaves[1], path: P.album, mode: "live" },
          { label: "record Live Preview", leaf: extraLeaves[2], path: P.record, mode: "live" },
        ];
        const before = [];
        for (const target of targets) {
          await ctx.page.open(target.leaf, target.path, target.mode);
          await ctx.page.settle(250);
          before.push({ label: target.label, probe: await ctx.page.waitOwned(target.leaf, target.mode, target.label) });
        }
        const preWrite = [];
        for (const target of targets) {
          const probe = await ctx.page.probe(target.leaf);
          const failures = lib.ownedFailures(probe, target.mode);
          if (probe?.path !== target.path) failures.push("wrong note remained open");
          if (failures.length) preWrite.push({ label: target.label, failures, probe });
        }
        if (preWrite.length) return { ok: false, reason: "ownership did not remain on every target before the foreign write", before, preWrite };

        const write = await ctx.page.ev(`(async () => {
          const file = app.vault.getAbstractFileByPath(${JSON.stringify(FOREIGN_REFRESH_PATH)});
          if (!file) throw new Error("unrelated scratch note is missing");
          const source = await app.vault.read(file);
          const next = source.replace("value: before", "value: after");
          if (next === source) throw new Error("unrelated scratch note had no expected value to change");
          await app.vault.modify(file, next);
          return { path: file.path, changed: next !== source };
        })()`);
        await sleep(1600);
        const writeAuditCount = await ctx.page.ev(`(() => {
          const rows = window.__bobFrontmatterTakeoverWriteAudit?.rows || [];
          return rows.filter((row) => row.api === "modify" && row.path === ${JSON.stringify(FOREIGN_REFRESH_PATH)}
            && row.stage === "foreign-refresh-keeps-ownership").length;
        })()`);
        const after = [];
        const failures = [];
        if (write?.changed !== true || write?.path !== FOREIGN_REFRESH_PATH) failures.push("the unrelated scratch note was not modified through the vault API");
        if (writeAuditCount !== 1) failures.push("the ownership write audit did not record exactly one unrelated vault modify");
        for (const target of targets) {
          const probe = await ctx.page.probe(target.leaf);
          const probeFailures = lib.ownedFailures(probe, target.mode);
          if (probe?.path !== target.path) probeFailures.push("wrong note remained open");
          if (probeFailures.length) failures.push(target.label + ": " + probeFailures.join("; "));
          after.push({ label: target.label, probe, failures: probeFailures });
        }
        return { ok: failures.length === 0, failures, before, write, writeAuditCount, after, quietMs: 1600 };
      } finally {
        if (extraLeaves.length) {
          try {
            await ctx.page.ev(`(() => {
              for (const id of ${JSON.stringify(extraLeaves)}) app.workspace.getLeafById(id)?.detach?.();
              return true;
            })()`);
          } catch (_) {}
        }
        try { await ctx.page.open(ctx.main, P.day, "live"); } catch (_) {}
      }
    });
    await attempt("bank-cache-parity", async () => {
      await ctx.page.open(ctx.main, P.bank, "live");
      await ctx.page.settle(350);
      const result = await ctx.page.ev(`(async () => {
        const file = app.vault.getAbstractFileByPath(${JSON.stringify(P.bank)});
        const source = file ? await app.vault.read(file) : null;
        const cache = file ? app.metadataCache.getFileCache(file)?.frontmatter : null;
        const helpers = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]?.constructor?.helpers;
        return {
          hasSource: typeof source === "string", hasCache: Boolean(cache),
          cache: cache ? { keys: Object.keys(cache).sort(), createdType: typeof cache.created,
            bankType: typeof cache.bank, type: cache.type, parent: cache.parent } : null,
          evidence: Boolean(helpers?.propertyCardFrontmatterCacheEvidence?.(source, cache)),
        };
      })()`);
      return { ok: result.hasSource && result.hasCache && result.evidence, result,
        failures: result.evidence ? [] : ["bank.md parsed source and Obsidian cache did not match"] };
    });
    await ownCase("own-bank-live", P.bank, "live");
    await ownCase("own-bank-reading", P.bank, "reading");
    await attempt("bank-pane-path-lifecycle", async () => {
      const failures = [];
      const assertSingleOwner = async (leafId, label) => {
        const probe = await ctx.page.waitOwned(leafId, "live", label);
        const bank = probe.bankGate || {};
        if (bank.titleOwnerKind !== "bank") failures.push(label + ": Bank Card does not own the title slot");
        if (!bank.bankCardPresent || !bank.bankCardInTitleSlot) failures.push(label + ": Bank Card is not mounted in the title slot");
        if (!bank.bankFootPresent || bank.cardCount !== 1 || bank.footCount !== 1) {
          failures.push(label + ": expected one Bank Card and one Properties foot");
        }
        return probe;
      };
      await ctx.page.open(ctx.main, P.bank, "live");
      const first = await assertSingleOwner(ctx.main, "first bank pane");
      const secondLeaf = await ctx.page.ev('app.workspace.getLeaf("split", "vertical").id');
      try {
        await ctx.page.open(secondLeaf, P.bank, "live");
        const second = await assertSingleOwner(secondLeaf, "second bank pane");
        await ctx.page.open(secondLeaf, P.ordinary, "live");
        const secondNative = await ctx.page.waitNative(secondLeaf, "second pane path change");
        const firstStillOwned = await assertSingleOwner(ctx.main, "first pane survives other path change");
        await ctx.page.open(secondLeaf, P.bank, "live");
        const secondRestored = await assertSingleOwner(secondLeaf, "second pane bank restore");
        await ctx.page.ev(`(() => {
          const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          plugin.scheduleBankSetupRefresh?.();
          plugin.scheduleBankSetupRefresh?.();
          return true;
        })()`);
        await ctx.page.settle(500);
        const repeated = await assertSingleOwner(secondLeaf, "repeated bank refreshes");
        await ctx.page.ev(`app.workspace.getLeafById(${JSON.stringify(secondLeaf)})?.detach?.()`);
        await ctx.page.settle(300);
        const firstAfterClose = await assertSingleOwner(ctx.main, "first bank pane after sibling close");
        return { ok: failures.length === 0, first, second, secondNative, firstStillOwned,
          secondRestored, repeated, firstAfterClose, failures };
      } finally {
        await ctx.page.ev(`app.workspace.getLeafById(${JSON.stringify(secondLeaf)})?.detach?.()`);
      }
    });
    await attempt("bank-generic-editor-gestures", async () => {
      await ctx.page.open(ctx.main, P.bank, "live");
      await ctx.page.waitOwned(ctx.main, "live", "Bank generic editor setup");
      const failures = [];
      const waitPropertyRead = async (label) => {
        await waitFor(client, `(() => {
          const modal = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]?.propertyEditorModal;
          return Boolean(modal && !modal.closed && !["reading", "checking"].includes(modal.status?.kind));
        })()`, Boolean, label, 15_000);
        return ctx.page.modal("property");
      };
      const plusWatch = await ctx.page.startOpenerWatch("property");
      if (!plusWatch?.installed) failures.push("could not observe the production property editor opener");
      await ctx.page.keys("+");
      await ctx.page.waitModal("property", "bob-property-editor-modal", "bare + generic Property Editor", 15_000);
      const plusOpener = await ctx.page.waitOpener("property", "bare + property editor opener");
      const plus = await waitPropertyRead("bare + property report");
      failures.push(...lib.modalLifecycleFailures(plus, "bob-property-editor-modal", plusOpener));
      if (plus.noteKind !== "bank" || plus.editorMode !== "browse" || plus.hasSettingsGroup || plus.heading) {
        failures.push("bare + did not open a generic bank Property Editor without Area settings");
      }
      const plusEvidence = { modal: plus, opener: plusOpener };
      await ctx.page.stopOpenerWatch("property");
      await ctx.page.closeEditor();

      const bankWatch = await ctx.page.startOpenerWatch("bank");
      if (!bankWatch?.installed) failures.push("could not observe the production Bank Setup handoff");
      await ctx.page.keys("=");
      await ctx.page.keys("=");
      const bankModal = await ctx.page.waitModal("bank", "bob-bank-setup-card-modal", "bank == handoff", 15_000);
      const bankOpener = await ctx.page.waitOpener("bank", "bank == Bank Setup handoff");
      failures.push(...lib.modalLifecycleFailures(bankModal, "bob-bank-setup-card-modal", bankOpener));
      await ctx.page.stopOpenerWatch("bank");
      await ctx.page.ev(`app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]?.bankSetupCardModal?.close?.()`);
      return { ok: failures.length === 0, plus: plusEvidence, bank: { modal: bankModal, opener: bankOpener }, failures };
    });
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
      if (report.profile === "bank") {
        await ctx.page.open(ctx.main, P.bank, "live");
        await ctx.page.settle(300);
      }
      const probe = await ctx.page.probe(ctx.main);
      const failures = lib.variablesOk(probe, "live");
      return { ok: failures.length === 0, probe, failures };
    });
    await attempt("vim-k-gg-up-live", async () => {
      // Use a disposable day note for the typing probe. Obsidian saves the
      // editor buffer through MarkdownView.writeData and may reserialize YAML
      // when that buffer is edited, even after Vim undo restores its text.
      const vimProbeNote = notes[P.day]
        .replaceAll("2026-11-20", "2026-11-19")
        .replaceAll("20261120", "20261119")
        .replace("# 2026-11-19 Fri", "# 2026-11-19 Thu");
      const created = await ctx.page.ev(`(async () => {
        if (app.vault.getAbstractFileByPath(${JSON.stringify(VIM_PROBE_PATH)})) return false;
        await app.vault.create(${JSON.stringify(VIM_PROBE_PATH)}, ${JSON.stringify(vimProbeNote)});
        return true;
      })()`);
      if (!created) throw new Error("could not create disposable Vim probe note");
      await ctx.page.open(ctx.main, VIM_PROBE_PATH, "live");
      await ctx.page.waitOwned(ctx.main, "live", "Vim probe");
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
      const bufferRestored = bufferAfterUndo === vimProbeNote;
      if (!bufferRestored) {
        failures.push("undo did not restore the live editor buffer");
        await ctx.page.ev(`(() => {
          const leaf = app.workspace.getLeafById(${JSON.stringify(ctx.main)});
          const cm = leaf && leaf.view && leaf.view.editor && leaf.view.editor.cm;
          if (!cm) return false;
          cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: ${JSON.stringify(vimProbeNote)} } });
          return cm.state.doc.toString() === ${JSON.stringify(vimProbeNote)};
        })()`);
        await waitFor(client, `window.__bobFrontmatterTakeover.docText(${JSON.stringify(ctx.main)}) === ${JSON.stringify(vimProbeNote)}`,
          Boolean, "Vim probe editor-buffer restoration", 10_000);
      }
      const probe = await ctx.page.probe(ctx.main);
      for (const [label, row] of [["gg", afterGg], ["k", afterK], ["up", afterUp], ["type", afterType]]) {
        if (row.inProperties) failures.push(label + " focused a property input");
      }
      if (!String(bufferText || "").includes("s1ok")) failures.push("inserted body text missing from the editor buffer");
      if (probe.activeInside) failures.push("probe still inside the container");

      // Switching away flushes any delayed Obsidian save to this disposable
      // note; remove it before the suite checks its protected fixture hashes.
      await ctx.page.open(ctx.main, P.day, "live");
      await ctx.page.settle(400);
      const probeFileText = await ctx.page.ev("window.__bobFrontmatterTakeover.readNote(" + JSON.stringify(VIM_PROBE_PATH) + ")");
      if (String(probeFileText || "").includes("s1ok")) failures.push("Vim probe save retained inserted body text");
      const deleted = await ctx.page.ev(`(async () => {
        const file = app.vault.getAbstractFileByPath(${JSON.stringify(VIM_PROBE_PATH)});
        if (file) await app.vault.delete(file);
        return !app.vault.getAbstractFileByPath(${JSON.stringify(VIM_PROBE_PATH)});
      })()`);
      if (!deleted) failures.push("disposable Vim probe note was not removed");
      return { ok: failures.length === 0, path: VIM_PROBE_PATH, afterGg, afterK, afterUp, afterType,
        typed: String(bufferText || "").includes("s1ok"), bufferRestored, probeFileCleared: !String(probeFileText || "").includes("s1ok"),
        probeDeleted: deleted, probe, failures };
    });
    await attempt("tab-live", async () => {
      await ctx.page.open(ctx.main, P.bank, "live");
      await ctx.page.waitOwned(ctx.main, "live", "bank tab-live setup");
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
          const file = app.vault.getAbstractFileByPath(${JSON.stringify(P.bank)});
          await app.vault.modify(file, ${JSON.stringify(notes[P.bank])});
          return true;
        })()`);
        await waitFor(client, `window.__bobFrontmatterTakeover.readNote(${JSON.stringify(P.bank)}) === ${JSON.stringify(notes[P.bank])}`,
          Boolean, "bank fixture restoration after Tab probe", 10_000);
      }
      const failures = [];
      if (!(downTab > downBefore)) failures.push("Tab never reached the page");
      if (afterTab.inProperties) failures.push("Tab entered Properties");
      if (afterShiftTab.inProperties) failures.push("Shift+Tab entered Properties");
      return { ok: failures.length === 0, afterTab, afterShiftTab, bufferChanged, failures };
    });

    await attempt("bank-vim-k-gg-live", async () => {
      await ctx.page.open(ctx.main, P.bank, "live");
      await ctx.page.waitOwned(ctx.main, "live", "bank Vim guard setup");
      const visibleBodyLine = notes[P.bank].split("\n").findIndex((line) => line.startsWith("A disposable fixture"));
      const placed = await ctx.page.ev(
        "window.__bobFrontmatterTakeover.setCursor(" + JSON.stringify(ctx.main) + ", " + visibleBodyLine + ", 0)",
      );
      const downBefore = await ctx.page.ev("window.__bobFrontmatterTakeover.keyDowns()");
      await ctx.page.keys("Escape");
      await ctx.page.keys("g");
      await ctx.page.keys("g");
      await ctx.page.keys("k");
      await ctx.page.keys("ArrowUp");
      const downAfter = await ctx.page.ev("window.__bobFrontmatterTakeover.keyDowns()");
      const active = await ctx.page.active();
      const probe = await ctx.page.probe(ctx.main);
      const failures = [];
      if (visibleBodyLine < 0 || !placed || placed.ok !== true) failures.push("could not place the bank editor cursor on visible body text");
      if (!(downAfter > downBefore)) failures.push("Vim navigation keys never reached the editor");
      if (active.inProperties || probe.activeInside) failures.push("gg/k/Up reached hidden native Properties");
      return { ok: failures.length === 0, placed, active, probe, failures };
    });
    await attempt("bank-focusin-guard", async () => {
      await ctx.page.open(ctx.main, P.bank, "live");
      const owned = await ctx.page.waitOwned(ctx.main, "live", "bank focus guard setup");
      const focus = await ctx.page.ev(`(() => {
        const leaf = app.workspace.getLeafById(${JSON.stringify(ctx.main)});
        const scope = leaf?.view?.editor?.cm?.dom;
        const container = scope?.querySelector(".metadata-container");
        if (!scope || !container) return { found: false };
        const event = new Event("focusin", { bubbles: true, cancelable: true });
        container.dispatchEvent(event);
        return { found: true, prevented: event.defaultPrevented,
          activeInside: Boolean(document.activeElement && container.contains(document.activeElement)),
          inert: Boolean(container.inert || container.hasAttribute("inert")),
          ariaHidden: container.getAttribute("aria-hidden") };
      })()`);
      const after = await ctx.page.probe(ctx.main);
      const failures = [];
      if (!focus.found || !focus.inert || focus.ariaHidden !== "true") failures.push("native Properties guard state is incomplete");
      if (focus.activeInside || after.activeInside) failures.push("focus entered hidden native Properties");
      if (!after.actualOwned || !owned.actualOwned) failures.push("focus guard dropped bank ownership");
      return { ok: failures.length === 0, focus, owned, after, failures };
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
      if (report.profile === "bank") {
        await ctx.page.open(ctx.main, P.bank, "reading");
        await ctx.page.settle(300);
      }
      const probe = await ctx.page.probe(ctx.main);
      const failures = lib.variablesOk(probe, "reading");
      return { ok: failures.length === 0, probe, failures };
    });
    await attempt("tab-reading", async () => {
      await ctx.page.open(ctx.main, P.bank, "reading");
      await ctx.page.waitOwned(ctx.main, "reading", "bank tab-reading setup");
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
      await ctx.page.open(ctx.main, P.bank, "live");
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
        const embeds = Array.from(document.querySelectorAll(".markdown-embed, .internal-embed"));
        const embed = embeds.find((node) => node.textContent.includes("Synthetic bank ownership fixture."));
        const scope = embed?.querySelector(".markdown-preview-view");
        const container = scope?.querySelector(".metadata-container");
        const owned = embed?.querySelector(".bob-property-card-owns-frontmatter");
        return { hasEmbed: Boolean(embed), hasCard: Boolean(embed?.querySelector(".bob-bank-setup")),
          owned: Boolean(owned), containerPresent: Boolean(container),
          containerVisible: Boolean(container && container.getClientRects().length
            && getComputedStyle(container).display !== "none") };
      })()`);
      // Embedded notes keep Obsidian's existing preview behavior: they do not
      // mount a separate property card or acquire whole-container ownership.
      // Obsidian itself can omit the native Properties block from embed layout.
      return { ok: result.hasEmbed && !result.hasCard && !result.owned && result.containerPresent, result };
    });
    await attempt("deny-hover", async () => {
      await ctx.page.open(ctx.main, P.hover, "reading");
      await ctx.page.settle(400);
      const target = await ctx.page.ev(`(() => {
        const leaf = app.workspace.getLeafById(${JSON.stringify(ctx.main)});
        const view = leaf?.view;
        const root = view?.getMode?.() === "preview" ? view.previewMode?.containerEl : view?.contentEl;
        const link = Array.from(root?.querySelectorAll("a.internal-link, .internal-link") || [])
          .find((node) => /bank/i.test(node.textContent || node.getAttribute("data-href") || ""));
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
        const scope = pop?.querySelector(".markdown-preview-view");
        const container = scope?.querySelector(".metadata-container");
        return {
          hasPopover: Boolean(pop),
          owned: Boolean(pop?.querySelector(".bob-property-card-owns-frontmatter")),
          card: Boolean(pop?.querySelector(".bob-bank-setup")),
          containerPresent: Boolean(container),
          containerVisible: Boolean(container && container.getClientRects().length
            && getComputedStyle(container).display !== "none"),
        };
      })()`);
      await ctx.page.ev("(() => { document.querySelectorAll('.hover-popover').forEach((node) => node.remove()); return true; })()");
      return { ok: result.hasPopover && !result.owned && result.containerPresent && result.containerVisible, target, result };
    });
    await attempt("deny-canvas", async () => {
      const result = await ctx.page.ev(`(() => {
        const helpers = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].constructor.helpers;
        const host = document.createElement("div");
        host.className = "canvas-node";
        const scope = document.createElement("div");
        scope.className = "markdown-preview-view";
        const mount = document.createElement("section");
        mount.className = "bob-bank-setup bob-property-card";
        mount.setAttribute("data-bank-setup-source", ${JSON.stringify(P.bank)});
        mount.appendChild(document.createElement("footer")).className = "bob-property-card-foot";
        scope.appendChild(mount);
        host.appendChild(scope);
        document.body.appendChild(host);
        const denied = helpers.propertyCardFrontmatterScopeDenied(scope);
        const handle = helpers.propertyCardFrontmatterOwnMounted(app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}], {
          scope, path: ${JSON.stringify(P.bank)}, kind: "bank", mount, view: null,
          sourceText: ${JSON.stringify("---\\nparent: \"[[cash]]\"\\ntype: \"[[area]]\"\\n---\\n")},
          getSource: () => ${JSON.stringify("---\\nparent: \"[[cash]]\"\\ntype: \"[[area]]\"\\n---\\n")},
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
        const mount = document.createElement("section");
        mount.className = "bob-bank-setup bob-property-card";
        mount.setAttribute("data-bank-setup-source", ${JSON.stringify(P.bank)});
        mount.appendChild(document.createElement("footer")).className = "bob-property-card-foot";
        scope.appendChild(mount);
        host.appendChild(scope);
        document.body.appendChild(host);
        const denied = helpers.propertyCardFrontmatterScopeDenied(scope);
        const handle = helpers.propertyCardFrontmatterOwnMounted(app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}], {
          scope, path: ${JSON.stringify(P.bank)}, kind: "bank", mount, view: null,
          sourceText: ${JSON.stringify("---\\nparent: \"[[cash]]\"\\ntype: \"[[area]]\"\\n---\\n")},
          getSource: () => ${JSON.stringify("---\\nparent: \"[[cash]]\"\\ntype: \"[[area]]\"\\n---\\n")},
        });
        host.remove();
        return { denied, handle: handle == null };
      })()`);
      return { ok: result.denied === true && result.handle === true, result };
    });
    await attempt("deny-mobile", async () => {
      await ctx.page.open(ctx.main, P.bank, "live");
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
          try { plugin.scheduleBankSetupRefresh(); } catch (_) {}
          try { plugin.bankPropertyCardHost?.().scheduleRefresh?.(); } catch (_) {}
          plugin.constructor.helpers.propertyCardFrontmatterCoordinatorReconcile(plugin);
          return true;
        })()`);
      }
      const restored = await ctx.page.waitOwned(ctx.main, "live", "mobile restore");
      return { ok: lib.nativeFailures(probe, "mobile").length === 0, probe, restored };
    });
    await attempt("deny-malformed", async () => {
      await ctx.page.open(ctx.main, P.bank, "live");
      await ctx.page.waitOwned(ctx.main, "live", "malformed bank setup");
      const malformed = notes[P.bank].replace(
        'summary: "Synthetic bank ownership fixture."',
        "summary: [unclosed",
      );
      let live = null;
      let reading = null;
      try {
        await ctx.page.ev(`(async () => {
          const file = app.vault.getAbstractFileByPath(${JSON.stringify(P.bank)});
          await app.vault.modify(file, ${JSON.stringify(malformed)});
          return true;
        })()`);
        live = await ctx.page.waitNative(ctx.main, "malformed bank Live Preview");
        await ctx.page.open(ctx.main, P.bank, "reading");
        reading = await ctx.page.waitNative(ctx.main, "malformed bank Reading");
      } finally {
        await ctx.page.ev(`(async () => {
          const file = app.vault.getAbstractFileByPath(${JSON.stringify(P.bank)});
          if (file) await app.vault.modify(file, ${JSON.stringify(notes[P.bank])});
          return true;
        })()`);
        await ctx.page.open(ctx.main, P.bank, "live");
        await ctx.page.waitOwned(ctx.main, "live", "malformed bank restore");
      }
      return { ok: true, live, reading };
    });
    await attempt("deny-unclosed", async () => {
      await ctx.page.open(ctx.main, P.unclosed, "live");
      await ctx.page.settle(500);
      const probe = await ctx.page.waitNative(ctx.main, "unclosed");
      return { ok: true, probe };
    });
    await attempt("stale-cache-releases", async () => {
      // Deliberate source edits use a disposable note. Passive fixture hashes
      // must not include the writes this test itself requests.
      const cacheProbeNote = notes[P.day]
        .replaceAll("2026-11-20", "2026-11-18")
        .replaceAll("20261120", "20261118")
        .replace("# 2026-11-18 Fri", "# 2026-11-18 Wed");
      const created = await ctx.page.ev(`(async () => {
        if (app.vault.getAbstractFileByPath(${JSON.stringify(STALE_CACHE_PROBE_PATH)})) return false;
        await app.vault.create(${JSON.stringify(STALE_CACHE_PROBE_PATH)}, ${JSON.stringify(cacheProbeNote)});
        return true;
      })()`);
      if (!created) throw new Error("could not create disposable stale-cache probe note");
      await ctx.page.open(ctx.main, STALE_CACHE_PROBE_PATH, "live");
      await ctx.page.waitOwned(ctx.main, "live", "stale setup");
      const staleProbe = await ctx.page.ev(`(() => {
        const file = app.vault.getAbstractFileByPath(${JSON.stringify(STALE_CACHE_PROBE_PATH)});
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
            if (target?.path === ${JSON.stringify(STALE_CACHE_PROBE_PATH)} && current?.frontmatter) {
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
      const summaryLine = /^summary: (.+)$/m.exec(cacheProbeNote);
      if (!summaryLine) throw new Error("day fixture has no summary property to probe");
      const originalSummary = summaryLine[1];
      const changedNote = cacheProbeNote.replace(/^summary: .+$/m, `summary: ${cacheProbe}`);
      await ctx.page.ev(`(async () => {
        const file = app.vault.getAbstractFileByPath(${JSON.stringify(STALE_CACHE_PROBE_PATH)});
        await app.vault.modify(file, ${JSON.stringify(changedNote)});
        return true;
      })()`);
      await waitFor(client, `(() => {
        const file = app.vault.getAbstractFileByPath(${JSON.stringify(STALE_CACHE_PROBE_PATH)});
        const cache = app.metadataCache.getFileCache(file);
        return Boolean(cache && cache.frontmatter
          && cache.frontmatter.type === ${JSON.stringify(expectedType)}
          && cache.frontmatter.summary === ${JSON.stringify(cacheProbe)});
      })()`, Boolean, "metadata cache refresh", 10_000);
      await waitFor(client, `(() => {
        const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        return Boolean(plugin
          && plugin.intentionCardSourceCache?.get?.(${JSON.stringify(STALE_CACHE_PROBE_PATH)})?.source === ${JSON.stringify(changedNote)}
          && plugin.intentionCardRefreshTimer == null);
      })()`, Boolean, "changed source and completed card refresh", 10_000);
      await ctx.page.ev(`(async () => {
        const file = app.vault.getAbstractFileByPath(${JSON.stringify(STALE_CACHE_PROBE_PATH)});
        await app.vault.modify(file, ${JSON.stringify(cacheProbeNote)});
        return true;
      })()`);
      const bufferAfterVaultRestore = await ctx.page.ev(
        "window.__bobFrontmatterTakeover.docText(" + JSON.stringify(ctx.main) + ")",
      );
      const bufferInitiallyRestored = bufferAfterVaultRestore === cacheProbeNote;
      if (!bufferInitiallyRestored) {
        await ctx.page.ev(`(() => {
          const leaf = app.workspace.getLeafById(${JSON.stringify(ctx.main)});
          const cm = leaf && leaf.view && leaf.view.editor && leaf.view.editor.cm;
          if (!cm) return false;
          cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: ${JSON.stringify(cacheProbeNote)} } });
          return cm.state.doc.toString() === ${JSON.stringify(cacheProbeNote)};
        })()`);
        await waitFor(client, `window.__bobFrontmatterTakeover.docText(${JSON.stringify(ctx.main)}) === ${JSON.stringify(cacheProbeNote)}`,
          Boolean, "day editor-buffer restoration after stale-cache probe", 10_000);
      }
      await ctx.page.ev(`(async () => {
        const file = app.vault.getAbstractFileByPath(${JSON.stringify(STALE_CACHE_PROBE_PATH)});
        await app.vault.modify(file, ${JSON.stringify(cacheProbeNote)});
        return true;
      })()`);
      await waitFor(client, `(() => {
        const file = app.vault.getAbstractFileByPath(${JSON.stringify(STALE_CACHE_PROBE_PATH)});
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
          && plugin.intentionCardSourceCache?.get?.(${JSON.stringify(STALE_CACHE_PROBE_PATH)})?.source === ${JSON.stringify(cacheProbeNote)}
          && plugin.intentionCardRefreshTimer == null);
      })()`, Boolean, "restored source and completed card refresh", 10_000);
      await ctx.page.settle(1200);
      const restoredBuffer = await ctx.page.ev(
        "window.__bobFrontmatterTakeover.docText(" + JSON.stringify(ctx.main) + ")",
      );
      const restoredBytes = await ctx.page.ev(
        "window.__bobFrontmatterTakeover.readNote(" + JSON.stringify(STALE_CACHE_PROBE_PATH) + ")",
      );
      if (restoredBuffer !== cacheProbeNote || restoredBytes !== cacheProbeNote) {
        throw new Error("stale-cache fixture teardown did not settle: " + JSON.stringify({
          bufferRestored: restoredBuffer === cacheProbeNote,
          bytesRestored: restoredBytes === cacheProbeNote,
        }));
      }
      const restored = await ctx.page.waitOwned(ctx.main, "live", "stale restore");
      // Do not wait for a native save: this check never requests one. Earlier
      // runs attributed the later native Add-property fallback to this probe,
      // so every increased timeout merely postponed the intentional write.
      const protectedBytes = await ctx.page.ev(
        "window.__bobFrontmatterTakeover.readNote(" + JSON.stringify(P.day) + ")",
      );
      if (protectedBytes !== notes[P.day]) {
        throw new Error("protected day fixture changed while the disposable stale-cache probe was open");
      }
      await ctx.page.open(ctx.main, P.day, "live");
      await ctx.page.settle(400);
      const deleted = await ctx.page.ev(`(async () => {
        const file = app.vault.getAbstractFileByPath(${JSON.stringify(STALE_CACHE_PROBE_PATH)});
        if (file) await app.vault.delete(file);
        return !app.vault.getAbstractFileByPath(${JSON.stringify(STALE_CACHE_PROBE_PATH)});
      })()`);
      if (!deleted) throw new Error("disposable stale-cache probe note was not removed");
      return {
        ok: true,
        staleProbe,
        fixtureRestore: {
          bufferInitiallyRestored,
          bufferRestored: restoredBuffer === cacheProbeNote,
          bytesRestored: restoredBytes === cacheProbeNote,
          protectedBytesRestored: protectedBytes === notes[P.day],
        },
        restored,
      };
    });

    await attempt("bank-cache-skew-releases", async () => {
      await ctx.page.open(ctx.main, P.bank, "live");
      await ctx.page.waitOwned(ctx.main, "live", "bank cache-skew setup");
      const skewed = notes[P.bank].replace(
        'summary: "Synthetic bank ownership fixture."',
        'summary: "Cache-skewed bank fixture."',
      );
      const evidence = await ctx.page.ev(`(() => {
        const file = app.vault.getAbstractFileByPath(${JSON.stringify(P.bank)});
        const cache = app.metadataCache.getFileCache(file)?.frontmatter;
        const helper = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]?.constructor?.helpers?.propertyCardFrontmatterCacheEvidence;
        return Boolean(helper && !helper(${JSON.stringify(skewed)}, cache));
      })()`);
      const skewApplied = await ctx.page.ev(`(() => {
        const leaf = app.workspace.getLeafById(${JSON.stringify(ctx.main)});
        const cm = leaf?.view?.editor?.cm;
        if (!cm) return false;
        cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: ${JSON.stringify(skewed)} } });
        return cm.state.doc.toString() === ${JSON.stringify(skewed)};
      })()`);
      const native = await ctx.page.waitNative(ctx.main, "bank source/cache skew");
      const restoredBuffer = await ctx.page.ev(`(() => {
        const leaf = app.workspace.getLeafById(${JSON.stringify(ctx.main)});
        const cm = leaf?.view?.editor?.cm;
        if (!cm) return false;
        cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: ${JSON.stringify(notes[P.bank])} } });
        return cm.state.doc.toString() === ${JSON.stringify(notes[P.bank])};
      })()`);
      const owned = await ctx.page.waitOwned(ctx.main, "live", "bank source/cache restore");
      const bytes = await ctx.page.ev(
        "window.__bobFrontmatterTakeover.readNote(" + JSON.stringify(P.bank) + ")",
      );
      const failures = [];
      if (!evidence) failures.push("the bank source/cache skew fixture did not fail parity");
      if (!skewApplied) failures.push("could not apply the skewed Live Preview source");
      if (!restoredBuffer || bytes !== notes[P.bank]) failures.push("bank source bytes changed during cache-skew check");
      return { ok: failures.length === 0, evidence, skewApplied, native, restoredBuffer, owned, bytes, failures };
    });

    const disposableDayNote = (iso, id, weekday) => notes[P.day]
      .replaceAll("2026-11-20", iso)
      .replaceAll("20261120", id)
      .replace("# " + iso + " Fri", "# " + iso + " " + weekday);
    const disposableRecordNote = (title, sentinel) => notes[P.record]
      .replace('title: "Corner Bistro"', 'title: ' + JSON.stringify(title))
      .replace("Record body sentinel", sentinel);
    const waitAlbumSyncIdle = async () => {
      await ctx.page.ev(`(async () => {
        const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
          if (plugin && (plugin.albumSyncDebounceTimer || plugin.albumSyncBusy || plugin.albumSyncFlight || plugin.albumUpdateFlight)) {
            try { if (plugin.albumSyncFlight) await plugin.albumSyncFlight; } catch (_) {}
            try { if (plugin.albumUpdateFlight) await plugin.albumUpdateFlight; } catch (_) {}
            await new Promise((resolve) => setTimeout(resolve, 50));
            continue;
          }
          break;
        }
        return {
          busy: Boolean(plugin && plugin.albumSyncBusy),
          flight: Boolean(plugin && plugin.albumSyncFlight),
          debounce: Boolean(plugin && plugin.albumSyncDebounceTimer),
        };
      })()`);
    };
    const restoreFixtureNotes = async () => {
      await ctx.page.ev(`(async () => {
        const notes = ${JSON.stringify(notes)};
        for (const [notePath, text] of Object.entries(notes)) {
          const file = app.vault.getAbstractFileByPath(notePath);
          if (file) await app.vault.modify(file, text);
        }
        return true;
      })()`);
    };
    const restoreAlbumFixture = async () => {
      await waitAlbumSyncIdle();
      await restoreFixtureNotes();
      await waitAlbumSyncIdle();
      await restoreFixtureNotes();
    };
    const runLiveKeepCard = async (notePath, noteText, { slow = false, record = false } = {}) => {
      const created = await ctx.page.ev(`(async () => {
        if (app.vault.getAbstractFileByPath(${JSON.stringify(notePath)})) return false;
        await app.vault.create(${JSON.stringify(notePath)}, ${JSON.stringify(noteText)});
        return true;
      })()`);
      if (!created) throw new Error("could not create disposable probe note " + notePath);
      await ctx.page.open(ctx.main, notePath, "live");
      await ctx.page.waitOwned(ctx.main, "live", notePath + " setup");
      const started = await ctx.page.ev(
        "window.__bobFrontmatterTakeover.startAutosaveSampler(" + JSON.stringify(ctx.main) + ")",
      );
      if (!started || started.ok !== true) throw new Error("could not start autosave sampler: " + JSON.stringify(started));
      const waiting = await ctx.page.ev(
        "window.__bobFrontmatterTakeover.startChangedWait(" + JSON.stringify(notePath) + ")",
      );
      if (!waiting || waiting.ok !== true) throw new Error("could not start changed wait: " + JSON.stringify(waiting));
      try {
        if (slow) {
          const installed = await ctx.page.ev(
            "window.__bobFrontmatterTakeover.installSlowReparse(" + JSON.stringify(notePath) + ", 150)",
          );
          if (!installed || installed.ok !== true) {
            throw new Error("could not install slow reparse: " + JSON.stringify(installed));
          }
        }
        const placed = await ctx.page.ev(
          "window.__bobFrontmatterTakeover.setCursor(" + JSON.stringify(ctx.main) + ", 999, 0)",
        );
        if (!placed || placed.ok !== true) throw new Error("could not place cursor: " + JSON.stringify(placed));
        await ctx.page.keys("Escape");
        await ctx.page.keys("i");
        for (const ch of " probe") await ctx.page.keys(ch);
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
          const seen = await ctx.page.ev("window.__bobFrontmatterTakeover.changedWaitSeen()");
          if (seen) break;
          await sleep(50);
        }
        const seen = await ctx.page.ev("window.__bobFrontmatterTakeover.changedWaitSeen()");
        if (!seen) throw new Error("changed timeout for " + notePath);
        await ctx.page.settle(300);
      } finally {
        try { await ctx.page.ev("window.__bobFrontmatterTakeover.stopChangedWait()"); } catch (_) {}
        if (slow) {
          try { await ctx.page.ev("window.__bobFrontmatterTakeover.restoreSlowReparse()"); } catch (_) {}
        }
      }
      const sampled = slimSampler(await ctx.page.ev("window.__bobFrontmatterTakeover.stopAutosaveSampler()"));
      const failures = Array.isArray(sampled && sampled.failures) ? sampled.failures.slice() : [{ kind: "sampler-missing" }];
      if (!sampled || sampled.count < 1) failures.push({ kind: "no-samples" });
      if (record) await restoreAlbumFixture();
      await ctx.page.open(ctx.main, record ? P.record : P.day, "live");
      await ctx.page.settle(200);
      const deleted = await ctx.page.ev(`(async () => {
        const file = app.vault.getAbstractFileByPath(${JSON.stringify(notePath)});
        if (file) await app.vault.delete(file);
        return !app.vault.getAbstractFileByPath(${JSON.stringify(notePath)});
      })()`);
      if (!deleted) throw new Error("disposable probe note was not removed: " + notePath);
      if (record) {
        await restoreAlbumFixture();
        await ctx.page.settle(400);
      }
      return { ok: failures.length === 0, path: notePath, sampled, failures };
    };

    await attempt("live-autosave-keeps-ownership", async () => {
      const day = await runLiveKeepCard(
        AUTOSAVE_DAY_PATH,
        disposableDayNote("2026-11-16", "20261116", "Mon"),
      );
      const record = await runLiveKeepCard(
        AUTOSAVE_RECORD_PATH,
        disposableRecordNote("Autosave Probe", "Autosave record body sentinel"),
        { record: true },
      );
      return { ok: day.ok && record.ok, day, record };
    });
    await attempt("live-slow-reparse-keeps-card", async () => {
      const day = await runLiveKeepCard(
        SLOW_DAY_PATH,
        disposableDayNote("2026-11-15", "20261115", "Sun"),
        { slow: true },
      );
      const record = await runLiveKeepCard(
        SLOW_RECORD_PATH,
        disposableRecordNote("Slow Reparse Probe", "Slow reparse record body sentinel"),
        { slow: true, record: true },
      );
      return { ok: day.ok && record.ok, day, record };
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
      // A clone is not Obsidian's managed metadata node. Keep this destructive
      // DOM injection out of the pane reused by subsequent checks/screenshots.
      const probeLeaf = await ctx.page.ev('app.workspace.getLeaf("tab").id');
      try {
        await ctx.page.open(probeLeaf, P.day, "live");
        await ctx.page.waitOwned(probeLeaf, "live", "replace setup");
        await ctx.page.ev(`(() => {
          const leaf = app.workspace.getLeafById(${JSON.stringify(probeLeaf)});
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
        const probe = await ctx.page.waitOwned(probeLeaf, "live", "replaced container");
        return { ok: true, probe };
      } finally {
        await ctx.page.ev(`(() => {
          app.workspace.getLeafById(${JSON.stringify(probeLeaf)})?.detach();
          app.workspace.setActiveLeaf(app.workspace.getLeafById(${JSON.stringify(ctx.main)}), { focus: true });
          return true;
        })()`);
      }
    });
    await attempt("disable-unload-restores", async () => {
      await ctx.page.open(ctx.main, P.bank, "live");
      await ctx.page.waitOwned(ctx.main, "live", "disable setup");
      await ctx.page.ev("app.plugins.disablePlugin(" + JSON.stringify(PLUGIN_ID) + ")");
      await waitFor(client, "!app.plugins.plugins[" + JSON.stringify(PLUGIN_ID) + "]", Boolean, "ledger-tools disabled");
      await ctx.page.settle(300);
      const off = await ctx.page.ev(`(() => {
        const container = document.querySelector(".metadata-container");
        return {
          owns: document.querySelectorAll(".bob-property-card-owns-frontmatter").length,
          cards: document.querySelectorAll(".bob-intention-card, .bob-album-header, .bob-record-sheet, .bob-bank-setup").length,
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
      await ctx.page.open(ctx.main, P.bank, "live");
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
        return plugin.schedulePropertyCapabilityProbes(${JSON.stringify(mode)});
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
        return plugin.schedulePropertyCapabilityProbes("restore");
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
      await ctx.page.open(ctx.main, P.bank, "live");
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
      await ctx.page.open(ctx.main, P.bank, "live");
      await ctx.page.settle(400);
      const probe = await ctx.page.waitNative(ctx.main, "old bob");
      await restoreBob();
      return { ok: true, probe };
    });
    await attempt("failed-probe-native", async () => {
      await switchBob("fail", "unconfirmed");
      await ctx.page.open(ctx.main, P.bank, "live");
      await ctx.page.settle(400);
      const probe = await ctx.page.waitNative(ctx.main, "failed probe");
      await restoreBob();
      return { ok: true, probe };
    });
    await attempt("bank-props-v1-only-owned", async () => {
      const probes = [];
      const failures = [];
      let state = null;
      try {
        await switchBob("contractless", "confirmed");
        state = await ctx.page.waitContract("absent", 25_000);
        for (const mode of ["live", "reading"]) {
          await ctx.page.open(ctx.main, P.bank, mode);
          const probe = await ctx.page.waitOwned(ctx.main, mode, "bank with props_v1 and no props_contract_v1 " + mode);
          probes.push(probe);
          const bank = probe.bankGate || {};
          failures.push(...lib.ownedFailures(probe, mode));
          if (probe.capability?.status !== "confirmed" || probe.capability?.contract !== "absent") {
            failures.push("the contractless probe did not retain props_v1 while recording contract absence");
          }
          if (bank.titleOwnerKind !== "bank" || !bank.bankCardInTitleSlot) {
            failures.push("Bank Card did not own the title slot in " + mode);
          }
          if (!bank.bankCardPresent || !bank.bankSetupBodyPresent || !bank.bankEditPresent) {
            failures.push("bank setup body/Edit did not remain available in " + mode);
          }
          if (!bank.bankFootPresent || bank.cardCount !== 1 || bank.footCount !== 1) {
            failures.push("Bank Card scope does not have exactly one card and one Properties foot in " + mode);
          }
        }
      } finally {
        await restoreBob();
      }
      const restored = await ctx.page.waitOwned(ctx.main, "reading", "contract restored after fallback");
      return { ok: failures.length === 0, state, probes, restored, failures };
    });
    await attempt("path-switch-native", async () => {
      await switchBob("fail", "unconfirmed");
      await ctx.page.open(ctx.main, P.bank, "live");
      await ctx.page.settle(400);
      const switched = await ctx.page.waitNative(ctx.main, "path switch");
      await ctx.page.open(ctx.main, P.ordinary, "live");
      const ordinary = await ctx.page.waitNative(ctx.main, "path switch ordinary");
      await restoreBob();
      await ctx.page.open(ctx.main, P.bank, "live");
      const restored = await ctx.page.waitOwned(ctx.main, "live", "path restore");
      return { ok: true, switched, ordinary, restored };
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
      await ctx.page.open(ctx.main, P.bank, "live");
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
      failures.push(...lib.addEditorFailures(after));
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
      failures.push(...lib.addEditorFailures(after));
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
      failures.push(...lib.addEditorFailures(after));
      await ctx.page.closeEditor();
      return { ok: failures.length === 0, after, bind, failures };
    });
    await attempt("bank-add-file-property", async () => {
      await ctx.page.open(ctx.main, P.bank, "live");
      await ctx.page.waitOwned(ctx.main, "live", "bank Add file property setup");
      const command = await ctx.page.ev(`(() => {
        const commands = Object.values(app.commands?.commands || {});
        return commands.find((entry) => /add file property/i.test(String(entry.name || "")))?.id || null;
      })()`);
      if (!command) throw new Error("Add file property command is unavailable");
      await ctx.page.ev(`(async () => { await app.commands.executeCommandById(${JSON.stringify(command)}); return true; })()`);
      await ctx.page.settle(250);
      const probe = await ctx.page.probe(ctx.main);
      const failures = lib.addEditorFailures(probe);
      if (failures.length === 0) await ctx.page.closeEditor();
      return { ok: failures.length === 0, command, probe, failures };
    });
    await attempt("ordinary-native", async () => {
      await ctx.page.open(ctx.main, P.ordinary, "live");
      await ctx.page.settle(300);
      const probe = await ctx.page.waitNative(ctx.main, "ordinary");
      return { ok: true, probe };
    });
    await attempt("bank-sidebar-native", async () => {
      await ctx.page.open(ctx.main, P.bank, "live");
      await ctx.page.waitOwned(ctx.main, "live", "bank sidebar setup");
      const result = await ctx.page.ev(`(async () => {
        const command = app.commands.commands["properties:open-local"];
        if (!command) return { error: "Show file properties command is not registered" };
        await app.commands.executeCommandById(command.id);
        const leaf = app.workspace.getLeavesOfType("file-properties")[0];
        if (leaf) {
          await app.workspace.revealLeaf(leaf);
          if (leaf.loadIfDeferred) await leaf.loadIfDeferred();
        }
        const deadline = Date.now() + 5000;
        let sidebar, input;
        do {
          sidebar = document.querySelector(".workspace-leaf-content[data-type='file-properties']");
          input = sidebar?.querySelector(".metadata-property-key-input");
          if (input?.getBoundingClientRect().width > 0) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        } while (Date.now() < deadline);
        const owned = sidebar?.closest(".bob-property-card-owns-frontmatter")
          || sidebar?.querySelector(".bob-property-card-owns-frontmatter");
        const rect = input?.getBoundingClientRect();
        return { hasSidebar: Boolean(sidebar), owned: Boolean(owned), hasNative: Boolean(input),
          command: { id: command.id, name: command.name },
          visible: Boolean(rect?.width > 0 && rect?.height > 0 && getComputedStyle(input).visibility !== "hidden"),
          inert: Boolean(input?.closest("[inert], [aria-hidden='true']")) };
      })()`);
      const failures = lib.sidebarFailures(result);
      await shared.collapseSidebars(client);
      return { ok: failures.length === 0, result, failures };
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
      // Native Add property can reserialize YAML even without a completed edit.
      // Exercise that intentional native action on its own note and leaf, never
      // on a passive hash fixture or a view later reused by those fixtures.
      const probeNote = notes[P.day]
        .replaceAll("2026-11-20", "2026-11-17")
        .replaceAll("20261120", "20261117")
        .replace("# 2026-11-17 Fri", "# 2026-11-17 Tue");
      const probeLeaf = await ctx.page.ev(`(async () => {
        await app.vault.create(${JSON.stringify(NATIVE_FALLBACK_PROBE_PATH)}, ${JSON.stringify(probeNote)});
        return app.workspace.getLeaf("tab").id;
      })()`);
      try {
        await ctx.page.open(probeLeaf, NATIVE_FALLBACK_PROBE_PATH, "live");
        await ctx.page.waitOwned(probeLeaf, "live", "opener setup");
        const result = await ctx.page.ev(`(async () => {
          const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          const original = plugin.openPropertyEditor;
          plugin.openPropertyEditor = async () => { throw new Error("injected opener failure"); };
          try {
            await app.commands.executeCommandById(${JSON.stringify(COMMAND_ID)});
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const leaf = app.workspace.getLeafById(${JSON.stringify(probeLeaf)});
            const scope = leaf.view.editor.cm.dom;
            const container = scope.querySelector(".metadata-container");
            const active = document.activeElement;
            return { owned: scope.classList.contains("bob-property-card-owns-frontmatter"),
              nativeFocused: Boolean(container && active && container.contains(active)) };
          } finally { plugin.openPropertyEditor = original; }
        })()`);
        await ctx.page.settle(300);
        const probe = await ctx.page.probe(probeLeaf);
        const failures = lib.nativeFailures(probe, "failed opener");
        if (!probe.containerVisible) failures.push("native Properties is not visible after opener failure");
        if (!result.nativeFocused) failures.push("native fallback did not receive focus");
        await ctx.page.closeEditor();
        return { ok: failures.length === 0, path: NATIVE_FALLBACK_PROBE_PATH, result, probe, failures };
      } finally {
        await ctx.page.ev(`(async () => {
          const leaf = app.workspace.getLeafById(${JSON.stringify(probeLeaf)});
          if (leaf) {
            if (typeof leaf.view.save === "function") await leaf.view.save();
            leaf.detach();
          }
          return true;
        })()`);
        await ctx.page.open(ctx.main, P.day, "live");
        // Retain this disposable note for the final audit; the scratch vault is
        // removed only after its Obsidian process exits.
      }
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
      observeFixtureWatch("screenshots:" + label);
      for (const theme of ["light", "dark"]) {
        await shared.setTheme(client, theme);
        for (const [widthName, width] of [["narrow", 720], ["wide", 1400]]) {
          await shared.setViewport(client, width, 1000);
          for (const mode of ["live", "reading"]) {
            const name = label + "-" + mode + "-" + theme + "-" + widthName;
            try {
              await ctx.page.open(ctx.main, notePath, mode);
              await ctx.page.settle(500);
              // Capture the real state even when ownership is failing; the PNG
              // and probes remain useful evidence for the repair phases.
              await ctx.page.ev(`(() => {
                const view = app.workspace.getLeafById(${JSON.stringify(ctx.main)}).view;
                const scope = view.getMode() === "preview" ? view.previewMode.containerEl : view.editor.cm.dom;
                const disclosure = scope.querySelector(".bob-property-card-foot-disclosure");
                if (disclosure?.getAttribute("aria-expanded") === "true") disclosure.click();
                if (view.getMode() !== "preview") view.editor.scrollTo(0, 0);
                for (const node of [scope, ...scope.querySelectorAll(".cm-scroller, .markdown-preview-view")]) node.scrollTop = 0;
                return true;
              })()`);
              await ctx.page.settle(250);
              const before = await ctx.page.probe(ctx.main);
              const row = await ctx.page.shot(name, [label, mode, theme, widthName], width);
              const after = await ctx.page.probe(ctx.main);
              row.captureProbes = { before, after };
              row.captureFailures = [...lib.screenshotFailures(before, notePath, mode),
                ...lib.screenshotFailures(after, notePath, mode)];
            } catch (error) {
              report.screenshots.push({ name, tags: [label, mode, theme, widthName], captureFailures: [String(error?.message || error)] });
              process.stderr.write("[frontmatter-takeover] screenshot failed " + name + ": " + String(error?.message || error) + "\n");
            }
          }
        }
      }
    };
    const screenshotCards = report.profile === "bank"
      ? [["bank", P.bank]]
      : [["day", P.day], ["week", P.week], ["record", P.record], ["album", P.album], ["bank", P.bank]];
    for (const [label, notePath] of screenshotCards) await shotCard(label, notePath);
    if (report.profile !== "bank") for (const theme of ["light", "dark"]) {
      observeFixtureWatch("ordinary-add-screenshots:" + theme);
      await shared.setTheme(client, theme);
      for (const [widthName, width] of [["narrow", 720], ["wide", 1400]]) {
        await shared.setViewport(client, width, 1000);
        await ctx.page.open(ctx.main, P.ordinary, "live");
        await ctx.page.settle(200);
        await ctx.page.ev(`(async () => {
          await app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].openPropertyEditor({ filePath: ${JSON.stringify(P.ordinary)}, mode: "add" });
          return true;
        })()`);
        await waitFor(client, `window.__bobFrontmatterTakeover.leaf(${JSON.stringify(ctx.main)}).editorAdd`,
          Boolean, "ordinary note property editor Add mode", 10_000);
        await ctx.page.shot("ordinary-add-" + theme + "-" + widthName, ["ordinary", "add", theme, widthName], width);
        await ctx.page.closeEditor();
      }
    }
    if (report.profile !== "bank") {
      await shared.setViewport(client, 1400, 1000);
      await shared.setTheme(client, "light");
      observeFixtureWatch("fallback-source-day");
      await ctx.page.open(ctx.main, P.day, "source");
      await ctx.page.settle(200);
      await ctx.page.shot("fallback-source-day", ["source", "fallback", "light", "wide"]);
      await ctx.page.open(ctx.main, P.malformedDay, "live");
      await ctx.page.settle(200);
      await ctx.page.shot("fallback-malformed-day", ["malformed", "fallback", "light", "wide"]);
    }
  } catch (error) {
    report.error = error && error.stack ? error.stack : String(error);
    report.prerequisites.push({ name: "runner", status: "fail", detail: String(error && error.message || error) });
    if (client) {
      try { report.screenshots.push(await shared.capture(client, outDir, "frontmatter-takeover-runner-failure", 1400, "light", "failure state")); }
      catch (_) {}
    }
  } finally {
    await sleep(400);
    await finalCheck("bytes-unchanged", async () => {
      if (!vaultReal || !Array.isArray(fixtureNames) || !report.fixtures || !ctxRef?.page) {
        return { ok: false, reason: "fixture vault or runner page was not initialized" };
      }
      report.fixtures.final = hashFixtures(vaultReal, fixtureNames);
      report.vaultWriteAudit = await ctxRef.page.ev("window.__bobFrontmatterTakeoverWriteAudit?.rows || []");
      const changed = fixtureNames.filter((name) => report.fixtures.final[name] !== report.fixtures.expected[name]);
      return { ok: changed.length === 0, changed, seeded: report.fixtures.seeded, final: report.fixtures.final,
        fixtureWatch: report.bankFixtureWatch };
    });
    await finalCheck("no-paint-spawn", async () => {
      if (!bobLogPath || !ctxRef?.page) return { ok: false, reason: "runner process or page was not initialized" };
      const beforeNativeCheck = readInvocations(bobLogPath).length;
      await ctxRef.page.open(ctxRef.main, P.ordinary, "live");
      await ctxRef.page.settle(1200);
      const baselineInvocations = paintSpawned(readInvocations(bobLogPath).slice(beforeNativeCheck));
      const beforeOwnedCheck = readInvocations(bobLogPath).length;
      const ownedPath = report.profile === "bank" ? P.bank : P.day;
      await ctxRef.page.open(ctxRef.main, ownedPath, "live");
      await ctxRef.page.settle(1200);
      const ownedProbe = await ctxRef.page.probe(ctxRef.main);
      const ownedInvocations = paintSpawned(readInvocations(bobLogPath).slice(beforeOwnedCheck));
      const baselineArgs = new Set(baselineInvocations.map((row) => JSON.stringify(row.args)));
      const extra = ownedInvocations.filter((row) => !baselineArgs.has(JSON.stringify(row.args)));
      const invocations = readInvocations(bobLogPath);
      report.bobInvocations = {
        count: invocations.length,
        baselinePaintSpawnCandidates: baselineInvocations.map((row) => row.args),
        ownedPaintSpawnCandidates: ownedInvocations.map((row) => row.args),
        extra: extra.map((row) => row.args), ownedProbe,
      };
      return { ok: extra.length === 0, extra: extra.map((row) => row.args),
        baselineCandidates: baselineInvocations.length, ownedCandidates: ownedInvocations.length,
        count: invocations.length, ownedProbe };
    });
    await finalCheck("screenshots-captured", async () => {
      const needed = lib.screenshotNeeds(report.profile);
      const have = new Set(report.screenshots.map((row) => row.name));
      const missingShots = needed.filter((name) => !have.has(name));
      const invalidShots = report.screenshots.filter((row) => row.captureFailures?.length)
        .map((row) => ({ name: row.name, failures: row.captureFailures }));
      return { ok: missingShots.length === 0 && invalidShots.length === 0 && report.screenshots.length >= needed.length,
        missingShots, invalidShots, count: report.screenshots.length };
    });
    await finalCheck("no-console-exceptions", async () => ({
      ok: report.consoleExceptions.length === 0, failures: report.consoleExceptions,
    }));
    for (const { name } of lib.requiredChecksForProfile(report.profile)) {
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
      skippedChecks: report.skippedChecks.length,
    };
    if (client) client.close();
    if (child && child.exitCode == null) {
      try { child.kill("SIGTERM"); } catch (_) {}
      await sleep(500);
      try { if (child.exitCode == null) child.kill("SIGKILL"); } catch (_) {}
    }
    observeFixtureWatch("process-exit");
    if (fixtureWatchTimer) {
      clearInterval(fixtureWatchTimer);
      fixtureWatchTimer = null;
    }
    try {
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    } catch (_) {}
    if (scratch) {
      try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (_) {}
    }
    activeRun = null;
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
    const timedOutAt = new Date().toISOString();
    process.stderr.write("frontmatter takeover e2e exceeded " + OVERALL_TIMEOUT_MS + " ms at " + timedOutAt + "\n");
    if (activeRun) {
      const { report, reportPath, outDir, currentCheck, client, child } = activeRun;
      report.error = "Overall runner timeout at " + timedOutAt;
      report.timeout = { at: timedOutAt, currentCheck };
      report.prerequisites.push({ name: "runner-timeout", status: "fail", detail: report.timeout });
      try {
        report.timeout.screenshots = fs.readdirSync(outDir)
          .filter((name) => name.toLowerCase().endsWith(".png"))
          .sort()
          .map((name) => {
            const bytes = fs.readFileSync(path.join(outDir, name));
            return { name, sizeBytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
          });
        report.verdict = lib.computeVerdict(report);
        report.pass = false;
        fs.mkdirSync(path.dirname(reportPath), { recursive: true });
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
      } catch (error) {
        process.stderr.write("Could not write timeout report: " + String(error && error.message || error) + "\n");
      }
      try { if (client) client.close(); } catch (_) {}
      try { if (child && child.exitCode == null) child.kill("SIGTERM"); } catch (_) {}
    }
    process.exit(1);
  }, OVERALL_TIMEOUT_MS);
  try { await run(args); }
  finally { clearTimeout(timer); }
}

if (require.main === module) void main(process.argv.slice(2));
module.exports = { run, parseArgs: lib.parseArgs, findBobProvenance: shared.findBobProvenance };
