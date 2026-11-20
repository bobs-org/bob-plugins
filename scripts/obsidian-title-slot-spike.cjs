#!/usr/bin/env node
// Real-Obsidian title-slot spike: mounts a probe card through the
// property-card title-slot primitive and measures survival, settings,
// tall-card geometry, denials, and teardown. Uses a disposable Git vault and
// profile, an owned Obsidian process under Xvfb, and only the working-tree
// bob-ledger-tools build. Never opens the live vault and never runs bob.
"use strict";

const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const lib = require("./obsidian-title-slot-spike-lib.cjs");
const shared = require("./obsidian-record-card-e2e.cjs");
const { keyEvents } = require("./obsidian-intention-card-e2e-lib.cjs");

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
    "file-explorer", "command-palette", "page-preview", "properties", "canvas",
  ], null, 2));
  fs.writeFileSync(path.join(obsidian, "app.json"), JSON.stringify({
    livePreview: true, showInlineTitle: true, propertiesInDocument: "visible", readableLineLength: true,
    vimMode: true, showLineNumber: false, alwaysUpdateLinks: false,
  }, null, 2));
  fs.writeFileSync(path.join(obsidian, "appearance.json"), JSON.stringify({ cssTheme: "", theme: "moonstone" }, null, 2));
}

// A refusing bob shim on PATH: the spike needs no bob, and nothing it starts
// may reach a real bob or the live vault.
function writeBobRefusal(shimDir, logPath) {
  fs.mkdirSync(shimDir, { recursive: true });
  const file = path.join(shimDir, "bob");
  fs.writeFileSync(file, "#!/usr/bin/env node\n"
    + "try { require('node:fs').appendFileSync(" + JSON.stringify(logPath) + ", JSON.stringify({ at: new Date().toISOString(), args: process.argv.slice(2) }) + '\\n'); } catch (_) {}\n"
    + "process.stderr.write('bob is disabled in the title-slot spike\\n');\nprocess.exit(3);\n");
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

// Node-side wrappers around the page sources and the Obsidian workspace.
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
    spike: (call) => ev("window.__bobTitleSlotSpike." + call),
    probe: (leafId) => ev("window.__bobTitleSlotProbe.leaf(" + json(leafId) + ")"),
    doc: () => ev("window.__bobTitleSlotProbe.doc()"),
    call: (call) => ev("window.__bobTitleSlotProbe." + call),
    mainLeaf: () => ev("(() => { const leaf = app.workspace.getLeaf(false); app.workspace.setActiveLeaf(leaf, { focus: true }); return leaf.id; })()"),
    split: (fromId) => ev(`(() => {
      const from = app.workspace.getLeafById(${json(fromId)});
      const leaf = app.workspace.createLeafBySplit(from, "vertical");
      return leaf.id;
    })()`),
    detach: (leafId) => ev(`(() => { const leaf = app.workspace.getLeafById(${json(leafId)}); if (leaf) leaf.detach(); return Boolean(leaf); })()`),
    open: async (leafId, notePath, mode, eState = null) => {
      const result = await ev(`(async () => {
        const leaf = app.workspace.getLeafById(${json(leafId)});
        const file = app.vault.getAbstractFileByPath(${json(notePath)});
        if (!leaf || !file) return { ok: false, error: "missing leaf or file" };
        const state = ${json(MODE_STATE[mode] || null)};
        const eState = ${json(eState)};
        await leaf.openFile(file, Object.assign({ active: true }, state ? { state } : {}, eState ? { eState } : {}));
        const spike = window.__bobTitleSlotSpike;
        if (state && leaf.view && leaf.view.setState && spike.modeOf(leaf.view) !== ${json(mode)}) {
          await leaf.view.setState(Object.assign({}, leaf.view.getState(), state), { history: false });
        }
        app.workspace.setActiveLeaf(leaf, { focus: true });
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return { ok: true, path: leaf.view && leaf.view.file ? leaf.view.file.path : null, mode: spike.modeOf(leaf.view) };
      })()`);
      if (!result || !result.ok) throw new Error("open " + notePath + " failed: " + JSON.stringify(result));
      return result;
    },
    setMode: async (leafId, mode) => {
      const result = await ev(`(async () => {
        const leaf = app.workspace.getLeafById(${json(leafId)});
        await leaf.view.setState(Object.assign({}, leaf.view.getState(), ${json(MODE_STATE[mode])}), { history: false });
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        window.__bobTitleSlotSpike.nudge();
        return window.__bobTitleSlotSpike.modeOf(leaf.view);
      })()`);
      if (result !== mode) throw new Error("mode switch to " + mode + " landed on " + result);
      return result;
    },
    frontmatter: (notePath, script) => ev(`(async () => {
      const file = app.vault.getAbstractFileByPath(${json(notePath)});
      await app.fileManager.processFrontMatter(file, (fm) => { ${script} });
      return true;
    })()`),
    restore: async (notePath) => {
      await ev(`(async () => {
        const file = app.vault.getAbstractFileByPath(${json(notePath)});
        await app.vault.modify(file, ${json(ctx.notes[notePath])});
        return true;
      })()`);
      await sleep(500);
    },
    config: (settings) => ev(`(() => {
      const settings = ${json(settings)};
      for (const [key, value] of Object.entries(settings)) app.vault.setConfig(key, value);
      return Object.fromEntries(Object.keys(settings).map((key) => [key, app.vault.getConfig(key)]));
    })()`),
    keys: async (key, modifiers = 0) => {
      for (const event of keyEvents(key, modifiers)) await ctx.client.call("Input.dispatchKeyEvent", event);
      await sleep(60);
    },
    click: async (x, y) => {
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
        await ctx.client.call("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1 });
      }
      await sleep(120);
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

function placementRow(label, probe, extra = []) {
  const failures = lib.placementFailures(probe).concat(extra);
  return { label, ok: failures.length === 0, failures, placement: lib.placementSummary(probe) };
}

// ---- Scenarios ----

async function survival(ctx) {
  const { page, main } = ctx;
  for (const mode of ["live", "reading"]) {
    await ctx.attempt("switch-file-" + mode, async () => {
      const rows = [];
      for (const note of ["alpha.md", "beta.md", "nofm.md", "alpha.md"]) {
        await page.open(main, note, mode);
        await page.settle();
        const probe = await page.probe(main);
        const doc = await page.doc();
        const extra = probe.probePaths?.filter((item) => item !== note).map((item) => "stale probe for " + item) || [];
        if (doc.orphans) extra.push(doc.orphans + " orphaned probes");
        rows.push(placementRow(note, probe, extra));
      }
      return { ok: rows.every((row) => row.ok), rows };
    });
  }
  await page.config({ propertiesInDocument: "visible" });
  for (const theme of ["light", "dark"]) {
    await shared.setTheme(ctx.client, theme);
    for (const mode of ["live", "reading"]) {
      await page.open(main, "alpha.md", mode);
      await page.settle(400);
      await page.shot("wide-" + mode + "-" + theme, [mode, theme, "wide", "visible"]);
    }
  }
  await shared.setTheme(ctx.client, "light");

  await ctx.attempt("mode-live-reading-source", async () => {
    const rows = [];
    await page.open(main, "alpha.md", "live");
    await page.settle();
    rows.push(placementRow("live", await page.probe(main)));
    await page.setMode(main, "reading");
    await page.settle();
    rows.push(placementRow("reading", await page.probe(main)));
    const before = await page.spike("stats()");
    await page.setMode(main, "source");
    await page.settle();
    const source = await page.probe(main);
    const after = await page.spike("stats()");
    await page.shot("source-mode-native", ["source-mode", "light", "wide"]);
    const sourceFailures = [];
    if (source.visibleProbesInLeaf !== 0) sourceFailures.push("probe visible in Source");
    if (!source.title?.visible) sourceFailures.push("native inline title hidden in Source");
    if (!source.properties?.visible && !(source.frontmatterLines > 0)) sourceFailures.push("frontmatter not visible in Source");
    if (!(after.counts.released > before.counts.released || Object.values(after.counts.lost).reduce((a, b) => a + b, 0) > Object.values(before.counts.lost).reduce((a, b) => a + b, 0))) {
      sourceFailures.push("no release or onLost fired");
    }
    rows.push({ label: "source", ok: sourceFailures.length === 0, failures: sourceFailures, nulls: after.counts.nulls,
      title: source.title?.visible, properties: source.properties?.visible, frontmatterLines: source.frontmatterLines });
    await page.setMode(main, "live");
    await page.settle();
    rows.push(placementRow("live again", await page.probe(main)));
    // The primitive alone: Live Preview straight to Source with the adapter paused.
    await page.spike("pause()");
    const lostBefore = (await page.spike("stats()")).counts.lost.denied || 0;
    await page.setMode(main, "source");
    await page.settle();
    const paused = await page.probe(main);
    const lostAfter = (await page.spike("stats()")).counts.lost.denied || 0;
    const pausedFailures = [];
    if (lostAfter !== lostBefore + 1) pausedFailures.push("onLost(denied) fired " + (lostAfter - lostBefore) + " times");
    if (paused.probesInLeaf !== 0) pausedFailures.push("primitive left " + paused.probesInLeaf + " probes in Source");
    rows.push({ label: "paused live to source", ok: pausedFailures.length === 0, failures: pausedFailures });
    await page.setMode(main, "live");
    await page.spike("resume()");
    await page.settle();
    rows.push(placementRow("live after paused source", await page.probe(main)));
    return { ok: rows.every((row) => row.ok), rows };
  });

  await ctx.attempt("split-panes", async () => {
    const rows = [];
    await page.open(main, "alpha.md", "live");
    ctx.right = await page.split(main);
    await page.open(ctx.right, "beta.md", "live");
    await page.settle(450);
    rows.push(placementRow("left alpha live", await page.probe(main)));
    rows.push(placementRow("right beta live", await page.probe(ctx.right)));
    await page.shot("split-panes-live", ["live", "light", "split"]);
    await page.setMode(main, "reading");
    await page.setMode(ctx.right, "reading");
    await page.settle(450);
    rows.push(placementRow("left alpha reading", await page.probe(main)));
    rows.push(placementRow("right beta reading", await page.probe(ctx.right)));
    const doc = await page.doc();
    rows.push({ label: "document", ok: doc.probeNodes === 2 && doc.orphans === 0, failures: [], doc });
    return { ok: rows.every((row) => row.ok), rows };
  });

  await ctx.attempt("same-file-two-panes", async () => {
    const rows = [];
    await page.open(main, "alpha.md", "live");
    await page.open(ctx.right, "alpha.md", "live");
    await page.settle(450);
    rows.push(placementRow("left", await page.probe(main)));
    rows.push(placementRow("right", await page.probe(ctx.right)));
    const both = await page.doc();
    await page.spike("pause()");
    await page.detach(ctx.right);
    ctx.right = null;
    await page.settle();
    const closed = await page.doc();
    rows.push(placementRow("left after closing right", await page.probe(main)));
    const remounted = await page.spike("remount(" + JSON.stringify(main) + ")");
    const pruned = await page.doc();
    const lost = (await page.spike("stats()")).counts.lost;
    await page.spike("resume()");
    const failures = [];
    if (both.probeNodes !== 2 || both.liveCount !== 2) failures.push("expected two probes and entries, saw " + both.probeNodes + " / " + both.liveCount);
    if (closed.probeNodes !== 1 || closed.orphans !== 0) failures.push("closing a pane left " + closed.probeNodes + " probes / " + closed.orphans + " orphans");
    if (!(remounted && pruned.liveCount === 1)) failures.push("liveCount did not drop to 1: " + closed.liveCount + " -> " + pruned.liveCount);
    // The adapter is paused, so the drop comes from the primitive itself: its
    // observer sees the closed leaf ("disconnected") or the next mount prunes.
    const via = closed.liveCount === 1 ? "observer self-release (disconnected)" : "pruning on the next mount";
    rows.push({ label: "prune", ok: failures.length === 0, failures, via, lost, liveCount: { both: both.liveCount, afterClose: closed.liveCount, afterMount: pruned.liveCount } });
    return { ok: rows.every((row) => row.ok), rows };
  });

  for (const mode of ["live", "reading"]) {
    await ctx.attempt("metadata-rerender-" + mode, async () => {
      const rows = [];
      await page.open(main, "alpha.md", mode);
      await page.settle();
      await page.spike("pause()");
      const steps = [
        ["add key", "alpha.md", "fm.spike_added = 'one';"],
        ["change key", "alpha.md", "fm.spike_added = 'two'; fm.status = 'paused';"],
        ["remove key", "alpha.md", "delete fm.spike_added;"],
      ];
      for (const [label, note, script] of steps) {
        await page.frontmatter(note, script);
        await sleep(650);
        rows.push(placementRow(label, await page.probe(main)));
      }
      await page.restore("alpha.md");
      rows.push(placementRow("bytes restored", await page.probe(main)));
      await page.spike("resume()");
      await page.open(main, "nofm.md", mode);
      await page.settle();
      await page.spike("pause()");
      await page.frontmatter("nofm.md", "fm.spike_added = 'fresh';");
      await sleep(700);
      const added = await page.probe(main);
      const extra = added.properties?.present ? [] : ["new Properties never rendered"];
      rows.push(placementRow("frontmatter added to nofm", added, extra));
      await page.restore("nofm.md");
      rows.push(placementRow("nofm restored", await page.probe(main)));
      await page.spike("resume()");
      const reinserts = rows.map((row) => row.placement.reinserts);
      return { ok: rows.every((row) => row.ok), reinserts, rows };
    });
  }

  await ctx.attempt("window-resize", async () => {
    const rows = [];
    rows.push({ label: "sidebars", ok: true, failures: [], sidebars: await shared.collapseSidebars(ctx.client) });
    for (const mode of ["live", "reading"]) {
      await page.open(main, "alpha.md", mode);
      await page.settle();
      await page.spike("pause()");
      for (const width of [1400, 900, 375, 1400]) {
        await shared.setViewport(ctx.client, width, 1000);
        await page.settle(300);
        rows.push(placementRow(mode + " " + width, await page.probe(main)));
        if (width === 375) await page.shot("narrow-375-" + mode, [mode, "light", "narrow"], 375);
      }
      await page.spike("resume()");
    }
    await shared.setViewport(ctx.client, 1400, 1000);
    return { ok: rows.every((row) => row.ok), rows };
  });
}

async function settingsMatrix(ctx) {
  const { page, main } = ctx;
  const matrix = lib.settingsMatrix();
  for (const surface of ["live", "reading"]) {
    await ctx.attempt("settings-matrix-" + surface, async () => {
      const rows = [];
      for (const combo of matrix) {
        const key = lib.comboKey(combo);
        const applied = await page.config({
          propertiesInDocument: combo.propertiesInDocument, showInlineTitle: combo.showInlineTitle, readableLineLength: combo.readableLineLength,
        });
        await shared.setTheme(ctx.client, combo.theme);
        await page.open(main, "nofm.md", surface);
        await page.open(main, "alpha.md", surface);
        await page.settle(350);
        await page.spike("refresh()");
        const probe = await page.probe(main);
        const row = placementRow(key, probe);
        row.applied = applied;
        row.native = { title: probe.title?.visible ?? null, properties: probe.properties?.visible ?? null, frontmatterLines: probe.frontmatterLines };
        rows.push(row);
        if (lib.MATRIX_SHOTS[surface].includes(key)) {
          await page.shot("matrix-" + surface + "-" + key, [surface, combo.theme, "wide", combo.propertiesInDocument,
            combo.showInlineTitle ? "title" : "no-title", combo.readableLineLength ? "readable" : "full-width"]);
        }
      }
      const passed = rows.filter((row) => row.ok).length;
      return { ok: passed === matrix.length, passed, total: matrix.length, rows };
    });
  }
  await page.config({ propertiesInDocument: "visible", showInlineTitle: true, readableLineLength: true });
  await shared.setTheme(ctx.client, "light");
}

async function measureLines(ctx, lines, phase, { click }) {
  const { page, main } = ctx;
  const rows = [];
  for (const [label, line] of Object.entries(lines)) {
    await page.call("scrollLine(" + JSON.stringify(main) + ", " + line + ", 'center')");
    await page.settle(250);
    const geometry = await page.call("lineGeometry(" + JSON.stringify(main) + ", " + line + ")");
    const row = {
      phase, label, line, text: geometry.text,
      coordsDelta: geometry.coordsTop == null || geometry.lineTop == null ? null : lib.round(geometry.coordsTop - geometry.lineTop),
      blockDelta: geometry.lineTop == null ? null : lib.round(geometry.blockTop - geometry.lineTop),
    };
    const native = ctx.report.measurements.nativeCoords?.[label];
    row.nativeCoordsDelta = native ?? null;
    row.coordsVsNative = row.coordsDelta === null || native == null ? null : lib.round(row.coordsDelta - native);
    // coordsAtPos returns the text box, which sits a fixed font-metrics offset
    // below the .cm-line box even with no card: compare against that native
    // offset, and require CodeMirror's own line geometry to match the DOM.
    row.coordsOk = row.text === geometry.expected && row.coordsVsNative !== null && Math.abs(row.coordsVsNative) <= 2
      && row.blockDelta !== null && Math.abs(row.blockDelta) <= 2;
    if (click) {
      const x = Math.round(geometry.lineLeft + 80);
      const y = Math.round((geometry.lineTop + geometry.lineBottom) / 2);
      await page.click(x, y);
      const cursor = await page.call("cursor(" + JSON.stringify(main) + ")");
      row.click = { x, y, cursorLine: cursor.line, delta: cursor.line - line };
      row.clickOk = cursor.line === line;
    }
    rows.push(row);
  }
  return rows;
}

async function tallCard(ctx) {
  const { page, main } = ctx;
  await page.open(main, "alpha.md", "live");
  await page.settle(400);
  const lines = {};
  for (const [label, n] of [["top", 2], ["middle", 80], ["scroll", 150]]) {
    lines[label] = await page.call("lineOf(" + JSON.stringify(main) + ", " + JSON.stringify(lib.bodyLineText(n)) + ")");
  }
  ctx.report.measurements.tallLines = lines;
  // Native baseline: the same lines with no card mounted.
  await page.spike("stop()");
  await page.settle(300);
  const nativeRows = await measureLines(ctx, lines, "native (no card)", { click: false });
  ctx.report.measurements.nativeCoords = Object.fromEntries(nativeRows.map((row) => [row.label, row.coordsDelta]));
  ctx.report.measurements.nativeCoordsRows = nativeRows;
  await page.spike("start(600)");
  await page.settle(400);
  await page.ev(`(() => { app.workspace.getLeafById(${JSON.stringify(main)}).view.editor.cm.scrollDOM.scrollTop = 0; return true; })()`);
  await page.settle(300);
  await page.shot("tall-live-600", ["live", "light", "wide", "tall"]);
  const clickRows = [];
  const phases = [["mounted 600px", 600], ["grown to 1400px", 1400], ["shrunk to 200px", 200]];
  for (const [phase, height] of phases) {
    await page.spike("setHeight(" + height + ")");
    await page.settle(350);
    if (height === 1400) {
      await page.call("scrollLine(" + JSON.stringify(main) + ", " + lines.top + ", 'end')");
      await page.settle(300);
      await page.shot("tall-live-grown-1400", ["live", "light", "wide", "tall", "grown"]);
    }
    clickRows.push(...await measureLines(ctx, lines, phase, { click: true }));
  }
  ctx.check("click-accuracy", clickRows.every((row) => row.clickOk), {
    deltas: clickRows.map((row) => row.click.delta), rows: clickRows,
  });
  // Unmeasured control: the same card without the view option.
  await page.spike("stop()");
  await page.spike("setMeasured(false)");
  await page.spike("start(600)");
  await page.settle(350);
  const controlRows = [];
  for (const [phase, height] of phases) {
    await page.spike("setHeight(" + height + ")");
    await page.settle(350);
    controlRows.push(...await measureLines(ctx, lines, "control " + phase, { click: false }));
  }
  await page.spike("stop()");
  await page.spike("setMeasured(true)");
  await page.spike("start(600)");
  await page.settle(350);
  ctx.check("coords-at-pos", clickRows.every((row) => row.coordsOk), {
    coordsDeltas: clickRows.map((row) => row.coordsDelta), blockDeltas: clickRows.map((row) => row.blockDelta), rows: clickRows,
  });
  ctx.check("coords-at-pos-unmeasured-control", controlRows.every((row) => row.coordsOk), {
    coordsDeltas: controlRows.map((row) => row.coordsDelta), blockDeltas: controlRows.map((row) => row.blockDelta), rows: controlRows,
  }, false);

  const line120 = ctx.notes["alpha.md"].split("\n").indexOf(lib.bodyLineText(120));
  for (const mode of ["live", "reading"]) {
    await ctx.attempt("scroll-restore-" + mode, async () => {
      await page.open(main, "alpha.md", mode);
      await page.settle(450);
      await page.ev(`(() => { const view = app.workspace.getLeafById(${JSON.stringify(main)}).view; view.currentMode.applyScroll(${line120}); return true; })()`);
      await page.settle(500);
      // Obsidian ignores the scroll event its own applyScroll causes, so it
      // records a position only after a real scroll: nudge with the wheel.
      for (const deltaY of [40, -40]) {
        await ctx.client.call("Input.dispatchMouseEvent", { type: "mouseWheel", x: 860, y: 600, deltaX: 0, deltaY });
        await page.settle(350);
      }
      const saved = await page.call("topVisibleLine(" + JSON.stringify(main) + ")");
      const eState = await waitFor(ctx.client, `app.workspace.getLeafById(${JSON.stringify(main)}).view.getEphemeralState()`,
        (value) => value && typeof value.scroll === "number", "ephemeral scroll state", 5_000);
      if (mode === "reading") await page.shot("tall-reading-scrolled", ["reading", "light", "wide", "tall"]);
      await page.open(main, "beta.md", mode);
      await page.settle(300);
      await page.open(main, "alpha.md", mode, eState);
      await page.settle(800);
      const reopened = await page.call("topVisibleLine(" + JSON.stringify(main) + ")");
      await page.open(main, "beta.md", mode);
      await page.settle(300);
      await page.ev(`(async () => { await app.workspace.getLeafById(${JSON.stringify(main)}).history.back(); return true; })()`);
      await page.settle(900);
      const back = await page.call("topVisibleLine(" + JSON.stringify(main) + ")");
      const placement = placementRow("after back", await page.probe(main));
      const delta = (row) => (row.line == null || saved.line == null ? null : row.line - saved.line);
      const ok = saved.line != null && delta(reopened) !== null && Math.abs(delta(reopened)) <= 1
        && delta(back) !== null && Math.abs(delta(back)) <= 1;
      // Evidence: the card grows by 800 px while the reader sits at line 120.
      await page.spike("setHeight(1400)");
      await page.settle(500);
      const grown = await page.call("topVisibleLine(" + JSON.stringify(main) + ")");
      await page.spike("setHeight(600)");
      await page.settle(500);
      const shrunk = await page.call("topVisibleLine(" + JSON.stringify(main) + ")");
      ctx.check("growth-keeps-visible-line-" + mode, delta(grown) !== null && Math.abs(delta(grown) - delta(back)) <= 1
        && delta(shrunk) !== null && Math.abs(delta(shrunk) - delta(back)) <= 1, { before: back, grown, shrunk }, false);
      // Back to the top: Reading re-attaches the virtualized header with the card.
      await page.ev(`(() => { app.workspace.getLeafById(${JSON.stringify(main)}).view.currentMode.applyScroll(0); return true; })()`);
      await page.settle(600);
      const top = placementRow("back at the top", await page.probe(main));
      const stats = await page.spike("stats()");
      return { ok: ok && top.ok, saved, eState, reopened, back, deltas: { eState: delta(reopened), historyBack: delta(back) }, farPlacement: placement.placement, top, lost: stats.counts.lost };
    });
  }

  for (const mode of ["live", "reading"]) {
    await ctx.attempt("heading-jump-" + mode, async () => {
      const jump = async () => {
        await page.open(main, "beta.md", mode);
        await page.settle(300);
        await page.open(main, "alpha.md", mode, { subpath: "#Section 06" });
        await page.settle(800);
        return page.call("headingOffset(" + JSON.stringify(main) + ", 'Section 06')");
      };
      await page.spike("stop()");
      const native = await jump();
      await page.spike("start(600)");
      const withCard = await jump();
      const probe = await page.probe(main);
      const tolerance = Math.max(8, Math.round(native.height || 0));
      const ok = native.found && withCard.found && withCard.inViewport && Math.abs(withCard.offset - native.offset) <= tolerance;
      return { ok, native, withCard, tolerance, delta: withCard.found && native.found ? lib.round(withCard.offset - native.offset) : null, cardMounted: probe.card?.present === true };
    });
  }

  await ctx.attempt("vim-gg-G", async () => {
    const motion = async (shot) => {
      await page.open(main, "alpha.md", "live");
      await page.settle(450);
      await page.ev(`(() => { app.workspace.getLeafById(${JSON.stringify(main)}).view.editor.focus(); return true; })()`);
      await page.keys("Escape");
      await page.keys("G", 8);
      await page.settle(400);
      const total = await page.call("lineCount(" + JSON.stringify(main) + ")");
      const end = await page.call("cursor(" + JSON.stringify(main) + ")");
      const endVisible = await page.call("posVisible(" + JSON.stringify(main) + ", 'end')");
      await page.keys("g");
      await page.keys("g");
      await page.settle(400);
      const start = await page.call("cursor(" + JSON.stringify(main) + ")");
      const startVisible = await page.call("posVisible(" + JSON.stringify(main) + ", 'start')");
      if (shot) await page.shot("tall-live-after-gg", ["live", "light", "wide", "tall", "vim"]);
      return { total, end, endVisible, start, startVisible };
    };
    // Native baseline: Live Preview keeps the hidden frontmatter atomic, so
    // gg lands on the first line after it. The card must not change that.
    await page.spike("stop()");
    const native = await motion(false);
    await page.spike("start(600)");
    const card = await motion(true);
    const ok = card.end.line === card.total - 1 && card.endVisible.coordsVisible
      && card.start.line === native.start.line && (card.startVisible.coordsVisible || card.startVisible.contentTopVisible);
    return { ok, native: { end: native.end, start: native.start }, ...card, cardTopVisibleAfterGg: card.startVisible.cardTopVisible };
  });
  await page.spike("setHeight(120)");
}

async function denials(ctx) {
  const { page, main } = ctx;
  const deniedRows = (result, kind) => (result.rows || []).filter((row) => row.kind === kind);
  const allNull = (rows) => rows.length > 0 && rows.every((row) => row.returnedNull && !row.mounted && !row.error);
  await ctx.attempt("deny-embed", async () => {
    await page.open(main, "embedder.md", "reading");
    await waitFor(ctx.client, "Boolean(document.querySelector('.workspace-leaf.mod-active .markdown-embed .markdown-preview-view'))", Boolean, "Reading embed render", 15_000);
    await page.settle(400);
    const reading = await page.spike("tryDenied()");
    const doc = await page.doc();
    await page.shot("deny-embed-reading", ["reading", "light", "wide", "embed"]);
    await page.setMode(main, "live");
    await waitFor(ctx.client, "Boolean(document.querySelector('.workspace-leaf.mod-active .cm-editor .markdown-embed .markdown-preview-view'))", Boolean, "Live Preview embed render", 15_000);
    await page.settle(400);
    const live = await page.spike("tryDenied()");
    const liveDoc = await page.doc();
    const ok = allNull(deniedRows(reading, "embed")) && allNull(deniedRows(live, "embed"))
      && reading.slotNodesInBoundaries === 0 && live.slotNodesInBoundaries === 0 && doc.inBoundary === 0 && liveDoc.inBoundary === 0;
    return { ok, reading, live, doc, liveDoc };
  });
  await ctx.attempt("deny-hover-popover", async () => {
    await page.open(main, "embedder.md", "reading");
    await page.settle(400);
    const hovered = await page.ev(`(() => {
      const leaf = app.workspace.getLeafById(${JSON.stringify(main)});
      const link = Array.from(leaf.view.containerEl.querySelectorAll("a.internal-link")).find((node) => node.getAttribute("data-href") === "alpha" && !node.closest(".markdown-embed"));
      if (!link) return { ok: false };
      const rect = link.getBoundingClientRect();
      const event = new MouseEvent("mouseover", { bubbles: true, cancelable: true, clientX: rect.left + 4, clientY: rect.top + 4 });
      app.workspace.trigger("hover-link", { event, source: "preview", hoverParent: leaf.view, targetEl: link, linktext: "alpha", sourcePath: "embedder.md" });
      return { ok: true };
    })()`);
    if (!hovered.ok) throw new Error("hover link not found");
    await waitFor(ctx.client, "Boolean(document.querySelector('.hover-popover .markdown-preview-view, .hover-popover .cm-editor'))", Boolean, "hover popover render", 15_000);
    await page.settle(500);
    const result = await page.spike("tryDenied()");
    const doc = await page.doc();
    await page.shot("deny-hover-popover", ["reading", "light", "wide", "popover"]);
    await ctx.client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1300, y: 960 });
    await sleep(800);
    await page.ev("(() => { for (const node of document.querySelectorAll('.hover-popover')) node.remove(); return true; })()");
    const rows = deniedRows(result, "hover-popover");
    return { ok: allNull(rows) && result.slotNodesInBoundaries === 0 && doc.inBoundary === 0, result, doc };
  });
  await ctx.attempt("deny-canvas", async () => {
    await page.ev(`(async () => {
      const leaf = app.workspace.getLeafById(${JSON.stringify(main)});
      await leaf.openFile(app.vault.getAbstractFileByPath("board.canvas"), { active: true });
      return true;
    })()`);
    await page.settle(800);
    await page.ev(`(() => { const canvas = app.workspace.getLeafById(${JSON.stringify(main)}).view.canvas; if (canvas && canvas.zoomToFit) canvas.zoomToFit(); return true; })()`);
    await waitFor(ctx.client, "Boolean(document.querySelector('.canvas-node .markdown-preview-view, .canvas-node .cm-editor'))", Boolean, "canvas file node render", 20_000);
    await page.settle(600);
    const result = await page.spike("tryDenied()");
    await page.spike("refresh()");
    const doc = await page.doc();
    await page.shot("deny-canvas", ["canvas", "light", "wide"]);
    const rows = deniedRows(result, "canvas");
    return { ok: allNull(rows) && result.slotNodesInBoundaries === 0 && doc.inBoundary === 0, result, doc };
  });
}

async function teardown(ctx) {
  const { page, main } = ctx;
  await ctx.attempt("teardown-plugin-disable", async () => {
    await page.open(main, "alpha.md", "live");
    ctx.right = await page.split(main);
    await page.open(ctx.right, "beta.md", "reading");
    await page.settle(450);
    const mounted = await page.doc();
    await page.ev("(() => { window.__bobTitleSlotOldHelpers = app.plugins.plugins['bob-ledger-tools'].constructor.helpers; return true; })()");
    await page.ev("app.plugins.disablePlugin('bob-ledger-tools').then(() => true)");
    await page.settle(400);
    const disabled = await page.doc();
    disabled.oldModuleLiveCount = await page.ev("window.__bobTitleSlotOldHelpers.propertyCardTitleSlotLiveCount()");
    const native = await page.probe(main);
    await page.frontmatter("alpha.md", "fm.spike_teardown = 1;");
    await sleep(500);
    const afterEdit = await page.doc();
    await page.shot("plugin-disabled-native", ["live", "light", "wide", "disabled"]);
    await page.restore("alpha.md");
    await page.ev("app.plugins.enablePlugin('bob-ledger-tools').then(() => true)");
    await waitFor(ctx.client, "Boolean(app.plugins.plugins['bob-ledger-tools']?.constructor?.helpers?.propertyCardMountInTitleSlot)", Boolean, "plugin re-enable", 30_000);
    await page.settle(300);
    await page.spike("refresh()");
    await page.settle(300);
    const reenabled = await page.doc();
    const fresh = await page.ev("app.plugins.plugins['bob-ledger-tools'].constructor.helpers !== window.__bobTitleSlotOldHelpers");
    const failures = [];
    if (mounted.probeNodes !== 2) failures.push("expected two mounted probes, saw " + mounted.probeNodes);
    if (disabled.slotNodes !== 0 || disabled.probeNodes !== 0) failures.push("disable left " + disabled.slotNodes + " slot / " + disabled.probeNodes + " probe nodes");
    if (disabled.oldModuleLiveCount !== 0) failures.push("the unloaded module kept " + disabled.oldModuleLiveCount + " entries");
    if (afterEdit.slotNodes !== 0 || afterEdit.probeNodes !== 0) failures.push("a zombie observer re-inserted after a metadata edit");
    if (!native.title?.visible || !native.properties?.visible) failures.push("native inline title or Properties hidden after disable");
    if (reenabled.probeNodes !== 2 || !fresh) failures.push("re-enable mounted " + reenabled.probeNodes + " probes; fresh module " + fresh);
    return { ok: failures.length === 0, failures, mounted, disabled, afterEdit, reenabled, freshModule: fresh,
      native: { title: native.title?.visible, properties: native.properties?.visible } };
  });
  await ctx.attempt("teardown-leaf-close", async () => {
    const before = await page.doc();
    const closing = ctx.right;
    await page.detach(closing);
    ctx.right = null;
    await page.settle(400);
    const after = await page.doc();
    const failures = [];
    if (after.orphans !== 0) failures.push(after.orphans + " connected orphans");
    if (after.leafIds.includes(closing)) failures.push("a probe for the closed leaf is still connected");
    if (after.probeNodes !== 1) failures.push("expected one remaining probe, saw " + after.probeNodes);
    return { ok: failures.length === 0, failures, before, after };
  });
}

// ---- Runner ----

async function run(args) {
  const report = {
    pass: false, verdict: null, startedAt: new Date().toISOString(), checks: [], screenshots: [], consoleExceptions: [], consoleErrors: [],
    prerequisites: [], measurements: {}, bobInvocations: { count: 0 }, pluginSource: pluginProvenance(),
  };
  const outDir = path.resolve(args.out || path.join(os.tmpdir(), "bob-title-slot-spike-shots-" + crypto.randomBytes(4).toString("hex")));
  const reportPath = path.resolve(args.report || path.join(outDir, "title-slot-spike-report.json"));
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
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "bob-title-slot-spike-"));
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
    client.on("Log.entryAdded", (params) => {
      if (params.entry?.level === "error") report.consoleExceptions.push({ text: params.entry.text || "", url: params.entry.url || "", source: "log" });
    });
    await client.call("Runtime.enable");
    await client.call("Log.enable");
    report.pluginStartup = { trustAction: await shared.trustCommunityPlugins(client) };
    await waitFor(client, "Boolean(app.plugins.plugins['bob-ledger-tools']) && app.workspace.layoutReady", Boolean, "bob-ledger-tools startup", 45_000);
    report.app = await client.evaluate("({ version: (/obsidian\\/([\\d.]+)/i.exec(navigator.userAgent) || [])[1] || '', enabled: Array.from(app.plugins.enabledPlugins || []), manifest: app.plugins.manifests['bob-ledger-tools']?.version || null, helpers: Boolean(app.plugins.plugins['bob-ledger-tools']?.constructor?.helpers?.propertyCardMountInTitleSlot) })");
    check("plugin-loaded", report.app.enabled.includes(PLUGIN_ID) && report.app.helpers && report.app.manifest === report.pluginSource.version, report.app);
    await shared.collapseSidebars(client);
    await shared.setViewport(client, 1400, 1000);
    await shared.setTheme(client, "light");

    const ctx = { client, report, notes, outDir, check, attempt, right: null };
    ctx.page = makePage(ctx);
    await ctx.page.install();
    ctx.main = await ctx.page.mainLeaf();
    await ctx.page.open(ctx.main, "alpha.md", "live");
    report.adapterStart = await ctx.page.spike("start(120)");

    await survival(ctx);
    await settingsMatrix(ctx);
    await tallCard(ctx);
    await denials(ctx);
    await teardown(ctx);
    report.adapter = await ctx.page.spike("stats()");
    await ctx.page.spike("stop()");

    await sleep(500);
    report.fixtures.final = hashFixtures(vaultReal, names);
    const changed = names.filter((name) => report.fixtures.final[name] !== report.fixtures.expected[name]);
    check("bytes-unchanged", changed.length === 0, { changed, seeded: report.fixtures.seeded, final: report.fixtures.final });
    const tags = new Set(report.screenshots.flatMap((row) => row.tags || []));
    const needed = ["live", "reading", "light", "dark", "wide", "narrow", "tall", "hidden", "source"];
    check("screenshots-captured", report.screenshots.length >= 12 && needed.every((tag) => tags.has(tag)),
      { count: report.screenshots.length, missingTags: needed.filter((tag) => !tags.has(tag)) });
    check("no-console-exceptions", report.consoleExceptions.length === 0, report.consoleExceptions);
    const invocations = fs.existsSync(bobLog) ? fs.readFileSync(bobLog, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
    const perCommand = {};
    for (const row of invocations) { const key = (row.args || []).slice(0, 2).join(" "); perCommand[key] = (perCommand[key] || 0) + 1; }
    report.bobInvocations = { count: invocations.length, refused: true, perCommand };
  } catch (error) {
    report.error = error && error.stack ? error.stack : String(error);
    report.prerequisites.push({ name: "runner", status: "fail", detail: String(error && error.message || error) });
    if (client) {
      try { report.screenshots.push(await shared.capture(client, outDir, "title-slot-runner-failure", 1400, "light", "failure state")); }
      catch (_) {}
    }
  } finally {
    for (const { name } of lib.REQUIRED_CHECKS) {
      if (!report.checks.some((row) => row.name === name)) check(name, false, "Required check was not executed");
    }
    report.verdict = lib.computeVerdict(report);
    report.pass = report.verdict.verdict === "GO" && report.prerequisites.every((row) => row.status === "pass");
    report.summary = summarize(report);
    if (client) client.close();
    if (child && child.exitCode == null) {
      try { child.kill("SIGTERM"); } catch (_) {}
      await sleep(400);
      if (child.exitCode == null) { try { child.kill("SIGKILL"); } catch (_) {} }
    }
    report.finishedAt = new Date().toISOString();
    report.scratchPreserved = Boolean(scratch && !report.pass && fs.existsSync(scratch));
    if (report.pass && scratch) fs.rmSync(scratch, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  }
  process.stdout.write("TITLE SLOT: " + report.verdict.verdict + " (live " + report.verdict.surfaces.live.pass + "/" + report.verdict.surfaces.live.total
    + ", reading " + report.verdict.surfaces.reading.pass + "/" + report.verdict.surfaces.reading.total
    + ", both " + report.verdict.surfaces.both.pass + "/" + report.verdict.surfaces.both.total + ")\n");
  process.stdout.write("Report: " + reportPath + "\nScreenshots: " + outDir + "\n");
  for (const row of report.checks.filter((item) => item.status === "fail")) process.stderr.write("- " + row.name + ": " + row.detail.slice(0, 1500) + "\n");
  if (!report.pass) process.exitCode = 1;
}

function summarize(report) {
  const detail = (name) => {
    const row = report.checks.find((item) => item.name === name);
    try { return row ? JSON.parse(row.detail) : null; } catch (_) { return null; }
  };
  const click = detail("click-accuracy");
  const coords = detail("coords-at-pos");
  const control = detail("coords-at-pos-unmeasured-control");
  const maxAbs = (values) => (Array.isArray(values) && values.length ? Math.max(...values.map((value) => Math.abs(value ?? Infinity))) : null);
  const matrix = (name) => { const row = detail(name); return row ? row.passed + "/" + row.total : null; };
  return {
    obsidian: report.app?.version || null, plugin: report.pluginSource.version, commit: report.pluginSource.head,
    dirtyPaths: report.pluginSource.dirtyPaths.length, verdict: report.verdict.verdict, fallback: report.verdict.fallback,
    surfaces: Object.fromEntries(Object.entries(report.verdict.surfaces).map(([key, value]) => [key, value.pass + "/" + value.total])),
    failed: Object.values(report.verdict.surfaces).flatMap((value) => value.failed),
    clickMaxDelta: maxAbs(click?.deltas), coordsMaxDelta: maxAbs(coords?.coordsDeltas), controlCoordsMaxDelta: maxAbs(control?.coordsDeltas),
    scrollRestore: { live: detail("scroll-restore-live")?.deltas || null, reading: detail("scroll-restore-reading")?.deltas || null },
    headingJump: { live: detail("heading-jump-live")?.delta ?? null, reading: detail("heading-jump-reading")?.delta ?? null },
    reinserts: { live: detail("metadata-rerender-live")?.reinserts || null, reading: detail("metadata-rerender-reading")?.reinserts || null },
    matrix: { live: matrix("settings-matrix-live"), reading: matrix("settings-matrix-reading") },
    screenshots: report.screenshots.length, consoleExceptions: report.consoleExceptions.length, bobInvocations: report.bobInvocations?.count ?? 0,
  };
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
      new Function("return " + lib.ADAPTER_SOURCE); // syntax only; never evaluated here
      new Function("return " + lib.PROBE_SOURCE);
      process.stdout.write("offline self-test complete (title-slot fixtures, probes, placement rules, verdict; no Obsidian launched)\n");
    } catch (error) {
      process.stderr.write(String(error.stack || error) + "\n");
      process.exitCode = 1;
    }
    return;
  }
  await run(args);
}

if (require.main === module) void main(process.argv.slice(2));
module.exports = { MODE_STATE, installVault, pluginProvenance, summarize };
