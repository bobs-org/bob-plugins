#!/usr/bin/env node
// Offline fixtures, page-side sources, check inventory, and verdict for the
// real-Obsidian frontmatter-ownership spike (S1). Nothing here launches
// Obsidian; the runner (obsidian-frontmatter-ownership-spike.cjs) does.
"use strict";

const assert = require("node:assert/strict");

const HELP_TEXT = [
  "Usage: node scripts/obsidian-frontmatter-ownership-spike.cjs [OPTIONS]",
  "",
  "S1 go/no-go: own a test note's native Properties container through the",
  "unwired propertyCardOwnFrontmatter primitive and verify focus safety,",
  "title-slot anchoring, Mod+; observability, and Obsidian visibility",
  "variables in Live Preview and Reading. Writes a GO or NO-GO verdict.",
  "Needs no bob binary. Run the real spike under xvfb-run -a on Linux.",
  "",
  "Options:",
  "  -e, --executable PATH   Obsidian Electron binary",
  "  -o, --out DIRECTORY    Save PNG screenshots here",
  "  -r, --report PATH      Write the structured JSON report here",
  "  -s, --self-test        Validate fixtures, probes, and the verdict without launching apps",
  "  -h, --help             Print this help",
].join("\n");

function parseArgs(argv) {
  const args = { executable: null, out: null, report: null, selfTest: false, help: false };
  const input = Array.isArray(argv) ? argv.slice() : [];
  const value = (flag, name, index) => {
    const next = input[index];
    if (!next || next.startsWith("-")) throw new Error(flag + " requires a " + name + " value");
    return next;
  };
  for (let i = 0; i < input.length; i += 1) {
    const flag = input[i];
    if (flag === "-e" || flag === "--executable") args.executable = value("--executable", "PATH", ++i);
    else if (flag === "-o" || flag === "--out") args.out = value("--out", "DIRECTORY", ++i);
    else if (flag === "-r" || flag === "--report") args.report = value("--report", "PATH", ++i);
    else if (flag === "-s" || flag === "--self-test") args.selfTest = true;
    else if (flag === "-h" || flag === "--help") args.help = true;
    else throw new Error("Unknown argument: " + flag);
  }
  return args;
}

const REQUIRED_CHECKS = Object.freeze([
  { name: "plugin-loaded", surface: "both" },
  { name: "own-live", surface: "live" },
  { name: "own-reading", surface: "reading" },
  { name: "vim-k-gg-up-live", surface: "live" },
  { name: "tab-live", surface: "live" },
  { name: "tab-reading", surface: "reading" },
  { name: "title-slot-anchor-live", surface: "live" },
  { name: "title-slot-anchor-reading", surface: "reading" },
  { name: "add-file-property-command", surface: "both" },
  { name: "variables-live", surface: "live" },
  { name: "variables-reading", surface: "reading" },
  { name: "source-toggle-releases", surface: "live" },
  { name: "path-change-releases", surface: "live" },
  { name: "modify-keeps-ownership-live", surface: "live" },
  { name: "deny-embed", surface: "both" },
  { name: "bytes-unchanged", surface: "both" },
  { name: "screenshots-captured", surface: "both" },
  { name: "no-console-exceptions", surface: "both" },
]);

function surfaceOf(name) {
  return REQUIRED_CHECKS.find((row) => row.name === name)?.surface || "both";
}

function fixtureNotes() {
  const body = [];
  for (let n = 1; n <= 40; n += 1) body.push("- Line " + String(n).padStart(2, "0") + " alpha");
  return {
    "alpha.md": [
      "---", "title: Alpha fixture", "status: active", "created: 2026-11-20", "---", "",
      "# Alpha heading", "", ...body, "",
    ].join("\n") + "\n",
    "beta.md": [
      "---", "title: Beta fixture", "kind: beta", "---", "", "# Beta heading", "", "- Beta line", "",
    ].join("\n") + "\n",
    "embedder.md": ["# Embedder", "", "See [[alpha]] for the hover link.", "", "![[alpha]]", ""].join("\n"),
  };
}

function passingReport() {
  return {
    checks: REQUIRED_CHECKS.map((row) => ({ name: row.name, surface: row.surface, status: "pass", mandatory: true })),
  };
}

function computeVerdict(report) {
  const checks = Array.isArray(report?.checks) ? report.checks : [];
  const byName = new Map();
  for (const row of checks) {
    const current = byName.get(row.name) || { name: row.name, surface: surfaceOf(row.name), status: "pass", mandatory: row.mandatory !== false };
    if (row.status === "fail") current.status = "fail";
    if (row.mandatory === false) current.mandatory = current.mandatory && false;
    byName.set(row.name, current);
  }
  const missing = REQUIRED_CHECKS.filter((row) => !byName.has(row.name)).map((row) => row.name);
  const surfaces = { live: { pass: 0, total: 0, failed: [] }, reading: { pass: 0, total: 0, failed: [] }, both: { pass: 0, total: 0, failed: [] } };
  for (const spec of REQUIRED_CHECKS) {
    const row = byName.get(spec.name);
    const bucket = surfaces[spec.surface];
    bucket.total += 1;
    if (!row || row.status !== "pass") bucket.failed.push(spec.name);
    else bucket.pass += 1;
  }
  const fallback = [];
  if (surfaces.live.failed.length && surfaces.reading.failed.length === 0 && surfaces.both.failed.length === 0) {
    fallback.push("live");
  }
  if (surfaces.reading.failed.length && surfaces.live.failed.length === 0 && surfaces.both.failed.length === 0) {
    fallback.push("reading");
  }
  let verdict = "NO-GO";
  if (missing.length) verdict = "NO-GO";
  else if (surfaces.live.failed.length + surfaces.reading.failed.length + surfaces.both.failed.length === 0) verdict = "GO";
  else if (fallback.length === 1 && fallback[0] === "live") verdict = "GO (reading only; live preview keeps per-row hiding)";
  else if (fallback.length === 1 && fallback[0] === "reading") verdict = "GO (live preview only; reading keeps per-row hiding)";
  return { verdict, fallback, missing, surfaces, partial: fallback.length === 1 };
}

const PAGE_COMMON = String.raw`
  const LEDGER_ID = "bob-ledger-tools";
  const OWNS = "bob-property-card-owns-frontmatter";
  const helpersOf = () => {
    const plugin = window.app && app.plugins && app.plugins.plugins ? app.plugins.plugins[LEDGER_ID] : null;
    const helpers = plugin && plugin.constructor ? plugin.constructor.helpers : null;
    return helpers && typeof helpers.propertyCardOwnFrontmatter === "function" ? helpers : null;
  };
  const pluginOf = () => (window.app && app.plugins && app.plugins.plugins ? app.plugins.plugins[LEDGER_ID] : null);
  const modeOf = (view) => {
    if (!view || typeof view.getMode !== "function") return null;
    if (view.getMode() === "preview") return "reading";
    const state = typeof view.getState === "function" ? view.getState() : {};
    return state && state.source ? "source" : "live";
  };
  const readingScopeOf = (view) => {
    const root = view && view.previewMode ? view.previewMode.containerEl : null;
    if (!root) return null;
    if (root.matches && root.matches(".markdown-preview-view")) return root;
    const direct = Array.from(root.children || []).find((node) => node.classList && node.classList.contains("markdown-preview-view"));
    if (direct) return direct;
    return root.querySelector ? root.querySelector(".markdown-preview-view") : null;
  };
  const liveScopeOf = (view) => (view && view.editor && view.editor.cm ? view.editor.cm.dom : null) || null;
  const liveViewOf = (view) => (view && view.editor && view.editor.cm ? view.editor.cm : null);
  const child = (root, name) => (root ? Array.from(root.children).find((node) => node.classList.contains(name)) || null : null);
  const nativeContainer = (scope) => {
    if (!scope) return null;
    if (scope.classList.contains("cm-editor")) return child(child(child(scope, "cm-scroller"), "cm-sizer"), "metadata-container");
    if (scope.classList.contains("markdown-preview-view")) return child(child(child(scope, "markdown-preview-sizer"), "mod-header"), "metadata-container");
    return null;
  };
  const cssVar = (node, name) => (node ? getComputedStyle(node).getPropertyValue(name).trim() : "");
  const shown = (node) => Boolean(node && node.isConnected && node.getClientRects().length > 0
    && getComputedStyle(node).display !== "none" && getComputedStyle(node).visibility !== "hidden");
`;

const ADAPTER_SOURCE = "(() => {" + PAGE_COMMON + String.raw`
  const prior = window.__bobFrontmatterSpike;
  if (prior && typeof prior.stop === "function") prior.stop();
  const state = { handles: new Map(), counts: { own: 0, released: 0, nulls: 0 } };
  const keyOf = (leafId) => String(leafId || "");
  const stop = () => {
    for (const handle of state.handles.values()) {
      try { handle(); } catch (_) {}
    }
    state.handles.clear();
  };
  const ownLeaf = (leafId) => {
    const helpers = helpersOf();
    const plugin = pluginOf();
    if (helpers && plugin && typeof helpers.propertyCardHostRegisterFrontmatterOwnership === "function") {
      try { helpers.propertyCardHostRegisterFrontmatterOwnership(plugin); } catch (_) {}
    }
    const leaf = app.workspace.getLeafById(leafId);
    const view = leaf && leaf.view;
    const file = view && view.file;
    if (!helpers || !view || !file) { state.counts.nulls += 1; return { ok: false, reason: "missing" }; }
    const mode = modeOf(view);
    let scope = null;
    let cmView = null;
    if (mode === "live") { scope = liveScopeOf(view); cmView = liveViewOf(view); }
    else if (mode === "reading") scope = readingScopeOf(view);
    const handle = helpers.propertyCardOwnFrontmatter(scope, { path: file.path, view: cmView });
    state.counts.own += 1;
    if (typeof handle !== "function") { state.counts.nulls += 1; return { ok: false, reason: "null-handle", mode, path: file.path }; }
    const prev = state.handles.get(keyOf(leafId));
    if (prev) { try { prev(); } catch (_) {} state.counts.released += 1; }
    state.handles.set(keyOf(leafId), handle);
    return { ok: true, mode, path: file.path, generation: handle.generation };
  };
  const releaseLeaf = (leafId) => {
    const handle = state.handles.get(keyOf(leafId));
    if (!handle) return false;
    try { handle(); } catch (_) {}
    state.handles.delete(keyOf(leafId));
    state.counts.released += 1;
    return true;
  };
  window.__bobFrontmatterSpike = {
    own: ownLeaf, release: releaseLeaf, stop, stats: () => ({ counts: { ...state.counts }, live: state.handles.size }),
    modeOf, helpers: () => Boolean(helpersOf()),
  };
  return true;
})()`;

const PROBE_SOURCE = "(() => {" + PAGE_COMMON + String.raw`
  const probeLeaf = (leafId) => {
    const leaf = app.workspace.getLeafById(leafId);
    const view = leaf && leaf.view;
    const file = view && view.file;
    const mode = modeOf(view);
    const scope = mode === "reading" ? readingScopeOf(view) : liveScopeOf(view);
    const container = nativeContainer(scope);
    const slot = (() => {
      const helpers = helpersOf();
      if (!helpers || typeof helpers.propertyCardTitleSlotFor !== "function") return null;
      try { return helpers.propertyCardTitleSlotFor(scope); } catch (_) { return null; }
    })();
    const active = document.activeElement;
    const activeInside = Boolean(container && active && (active === container || container.contains(active)));
    return {
      path: file ? file.path : null,
      mode,
      scopeClass: Boolean(scope && scope.classList.contains(OWNS)),
      containerPresent: Boolean(container && container.isConnected),
      containerVisible: shown(container),
      containerInert: Boolean(container && (container.inert === true || container.hasAttribute("inert"))),
      ariaHidden: container ? container.getAttribute("aria-hidden") : null,
      display: container ? getComputedStyle(container).display : null,
      editingVar: cssVar(scope, "--metadata-display-editing"),
      readingVar: cssVar(scope, "--metadata-display-reading"),
      slotAnchor: slot ? (slot.anchor && slot.anchor.classList.contains("metadata-container") ? "metadata-container" : (slot.anchor ? slot.anchor.className : "append")) : null,
      slotParent: slot ? (slot.parent && slot.parent.classList ? Array.from(slot.parent.classList).join(" ") : null) : null,
      slotParentConnected: slot ? Boolean(slot.parent && slot.parent.isConnected) : false,
      slotParentRect: slot ? rectOf(slot.parent) : null,
      slotAnchorRect: slot ? rectOf(slot.anchor) : null,
      activeTag: active ? String(active.tagName || "").toLowerCase() : null,
      activeInside,
      cursor: view && view.editor && typeof view.editor.getCursor === "function" ? view.editor.getCursor() : null,
    };
  };
  const addPropertyCommands = () => {
    const commands = Object.values((app.commands && app.commands.commands) || {});
    return commands.filter((command) => {
      const id = String(command.id || "");
      const name = String(command.name || "");
      return /add file property/i.test(name) || /add[-:]?(file[-:]?)?propert/i.test(id + " " + name);
    }).map((command) => ({ id: command.id, name: command.name, hotkeys: command.hotkeys || [] }));
  };
  const wrapExecute = () => {
    const seen = [];
    const orig = app.commands.executeCommandById.bind(app.commands);
    app.commands.executeCommandById = (id) => { seen.push(id); return orig(id); };
    return {
      seen: () => seen.slice(),
      restore: () => { app.commands.executeCommandById = orig; },
    };
  };
  const registryCommand = (id) => {
    const registry = (app.commands && app.commands.commands) || {};
    return registry[id] || Object.values(registry).find((entry) => entry && entry.id === id) || null;
  };
  const readManagerHotkeys = (manager, fn, id) => {
    if (!manager || typeof manager[fn] !== "function") return null;
    try {
      const value = manager[fn](id);
      return value === undefined ? null : value;
    } catch (_) {
      return null;
    }
  };
  const commandDetail = (id) => {
    const command = registryCommand(id);
    if (!command) return { found: false, id: id };
    const manager = app.hotkeyManager || null;
    return {
      found: true, id: command.id, name: command.name,
      callbackType: typeof command.callback, checkCallbackType: typeof command.checkCallback,
      commandHotkeys: command.hotkeys || null,
      registeredHotkeys: readManagerHotkeys(manager, "getHotkeys", id),
      defaultHotkeys: readManagerHotkeys(manager, "getDefaultHotkeys", id),
      obsidianVersion: (/obsidian\/([\d.]+)/i.exec(navigator.userAgent) || [])[1] || "",
      canSetHotkeys: Boolean(manager && typeof manager.setHotkeys === "function"),
    };
  };
  const dryRunCommand = (id) => {
    const command = registryCommand(id);
    if (!command) return { ok: false, reason: "missing" };
    if (typeof command.checkCallback === "function") {
      try {
        return { ok: true, via: "checkCallback", returned: command.checkCallback(true) === true };
      } catch (error) {
        return { ok: false, via: "checkCallback", reason: String(error && error.message || error).slice(0, 300) };
      }
    }
    if (typeof command.callback === "function") return { ok: true, via: "callback", returned: null };
    return { ok: false, reason: "no-callback" };
  };
  const bindModSemicolon = (id) => {
    const manager = app.hotkeyManager || null;
    if (!manager || typeof manager.setHotkeys !== "function" || typeof manager.getHotkeys !== "function") {
      return { ok: false, reason: "no-hotkey-manager" };
    }
    let current = null;
    try {
      current = manager.getHotkeys(id) || [];
    } catch (error) {
      return { ok: false, reason: String(error && error.message || error).slice(0, 300) };
    }
    const list = Array.isArray(current) ? current.slice() : [];
    const hasMod = list.some((hotkey) => hotkey && hotkey.key === ";" && Array.isArray(hotkey.modifiers) && hotkey.modifiers.indexOf("Mod") !== -1);
    if (hasMod) return { ok: true, bound: false, hotkeys: list };
    try {
      manager.setHotkeys(id, list.concat([{ modifiers: ["Mod"], key: ";" }]));
      return { ok: true, bound: true, hotkeys: manager.getHotkeys(id) };
    } catch (error) {
      return { ok: false, reason: String(error && error.message || error).slice(0, 300) };
    }
  };
  const modalOpen = () => {
    const modal = document.querySelector(".modal-container .modal");
    return Boolean(modal && modal.isConnected);
  };
  const setEditorCursor = (leafId, line, ch) => {
    // editor.setCursor silently no-ops in Live Preview, and focusing after a
    // selection lets Obsidian restore its own cursor on top of it (the
    // open-time line-5 offset keeps winning). The proven record-card cursor
    // helper dispatches a CodeMirror selection instead: focus first, and only
    // when DOM focus is outside the editor, then dispatch, then verify.
    const leaf = app.workspace.getLeafById(leafId);
    const cm = leaf && leaf.view && leaf.view.editor && leaf.view.editor.cm;
    if (!cm || !cm.dom) return { ok: false, reason: "no-cm" };
    try {
      const view = leaf.view.editor;
      const active = document.activeElement;
      if ((!active || !cm.dom.contains(active)) && view && typeof view.focus === "function") {
        try { view.focus(); } catch (_) {}
      }
      const docLine = cm.state.doc.line(Math.min(Math.max(line + 1, 1), cm.state.doc.lines));
      const target = Math.min(docLine.from + (ch || 0), docLine.to);
      cm.dispatch({ selection: { anchor: target }, scrollIntoView: true });
      const head = cm.state.selection.main.head;
      return { ok: head === target, target, actual: head };
    } catch (error) {
      return { ok: false, reason: String(error && error.message || error).slice(0, 200) };
    }
  };
  const docText = (leafId) => {
    const leaf = app.workspace.getLeafById(leafId);
    const cm = leaf && leaf.view && leaf.view.editor && leaf.view.editor.cm;
    if (!cm) return null;
    try {
      return cm.state.doc.toString();
    } catch (_) {
      return null;
    }
  };
  let observedKeyDowns = 0;
  document.addEventListener("keydown", () => { observedKeyDowns += 1; }, true);
  const readNote = (notePath) => {
    const file = app.vault.getAbstractFileByPath(notePath);
    if (!file) return Promise.resolve(null);
    return app.vault.read(file);
  };
  const rectOf = (node) => {
    if (!node || typeof node.getBoundingClientRect !== "function") return null;
    try {
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    } catch (_) {
      return null;
    }
  };
  window.__bobFrontmatterProbe = {
    leaf: probeLeaf,
    commands: addPropertyCommands,
    wrapExecute,
    detail: commandDetail,
    dryRun: dryRunCommand,
    bindMod: bindModSemicolon,
    modalOpen,
    readNote,
    setCursor: setEditorCursor,
    docText,
    keyDowns: () => observedKeyDowns,
    active: () => {
      const node = document.activeElement;
      return { tag: node ? String(node.tagName || "").toLowerCase() : null, className: node ? String(node.className || "") : "", inProperties: Boolean(node && node.closest && node.closest(".metadata-container")) };
    },
  };
  return true;
})()`;

function selfTest() {
  const notes = fixtureNotes();
  assert.deepEqual(Object.keys(notes).sort(), ["alpha.md", "beta.md", "embedder.md"]);
  assert.ok(notes["alpha.md"].startsWith("---\n"));
  assert.ok(!notes["embedder.md"].startsWith("---"));
  assert.ok(notes["embedder.md"].includes("![[alpha]]"));
  assert.equal(computeVerdict(passingReport()).verdict, "GO");
  const liveFail = passingReport();
  for (const row of liveFail.checks) if (row.surface === "live") row.status = "fail";
  assert.equal(computeVerdict(liveFail).verdict, "GO (reading only; live preview keeps per-row hiding)");
  const readingFail = passingReport();
  for (const row of readingFail.checks) if (row.surface === "reading") row.status = "fail";
  assert.equal(computeVerdict(readingFail).verdict, "GO (live preview only; reading keeps per-row hiding)");
  const bothFail = passingReport();
  for (const row of bothFail.checks) if (row.name === "plugin-loaded") row.status = "fail";
  assert.equal(computeVerdict(bothFail).verdict, "NO-GO");
  const missing = passingReport();
  missing.checks = missing.checks.filter((row) => row.name !== "own-live");
  assert.deepEqual(computeVerdict(missing).missing, ["own-live"]);
  assert.equal(computeVerdict(missing).verdict, "NO-GO");
  assert.equal(new Set(REQUIRED_CHECKS.map((row) => row.name)).size, REQUIRED_CHECKS.length);
  const parsed = parseArgs(["-e", "/opt/obsidian", "-o", "/tmp/shots", "-r", "/tmp/report.json", "--self-test"]);
  assert.ok(parsed.selfTest && parsed.executable === "/opt/obsidian");
  assert.throws(() => parseArgs(["--out"]), /requires/);
  assert.throws(() => parseArgs(["--bogus"]), /Unknown/);
  return true;
}

module.exports = {
  HELP_TEXT, REQUIRED_CHECKS, ADAPTER_SOURCE, PROBE_SOURCE, parseArgs, surfaceOf,
  fixtureNotes, passingReport, computeVerdict, selfTest,
};
