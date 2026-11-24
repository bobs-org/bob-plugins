#!/usr/bin/env node
// Offline fixtures, page-side probes, check inventory, and verdict for the
// real-Obsidian frontmatter-takeover matrix. Nothing here launches Obsidian;
// the runner (obsidian-frontmatter-takeover-e2e.cjs) does. Production adapters
// own the container; these helpers only observe.
"use strict";

const assert = require("node:assert/strict");
const foot = require("./obsidian-card-foot-e2e-lib.cjs");
const spike = require("./obsidian-frontmatter-ownership-spike-lib.cjs");

const HELP_TEXT = [
  "Usage: node scripts/obsidian-frontmatter-takeover-e2e.cjs [OPTIONS]",
  "",
  "Prove production whole-container frontmatter ownership on album, record,",
  "day, week, quarter, and year cards in a disposable Obsidian vault. Bank,",
  "embeds, hover, canvas, print, mobile, Source, and ordinary notes keep",
  "native Properties. Needs BOB_BIN and BOB_CLI_DIR. Run the real matrix",
  "under xvfb-run -a on Linux. --self-test never launches Obsidian.",
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
  { name: "own-day-live", surface: "live" },
  { name: "own-day-reading", surface: "reading" },
  { name: "own-week-live", surface: "live" },
  { name: "own-week-reading", surface: "reading" },
  { name: "own-record-live", surface: "live" },
  { name: "own-record-reading", surface: "reading" },
  { name: "own-album-live", surface: "live" },
  { name: "own-album-reading", surface: "reading" },
  { name: "own-quarter-live", surface: "live" },
  { name: "own-year-live", surface: "live" },
  { name: "own-identity-day-live", surface: "live" },
  { name: "own-identity-day-reading", surface: "reading" },
  { name: "source-toggle-releases", surface: "live" },
  { name: "deny-embed", surface: "both" },
  { name: "deny-hover", surface: "both" },
  { name: "deny-canvas", surface: "both" },
  { name: "deny-print", surface: "both" },
  { name: "deny-mobile", surface: "both" },
  { name: "deny-malformed", surface: "both" },
  { name: "deny-unclosed", surface: "both" },
  { name: "stale-cache-releases", surface: "live" },
  { name: "same-pane-file-change", surface: "live" },
  { name: "injected-mount-failure", surface: "live" },
  { name: "replaced-container-reapplies", surface: "live" },
  { name: "disable-unload-restores", surface: "both" },
  { name: "pending-capability-native", surface: "both" },
  { name: "absent-old-bob-native", surface: "both" },
  { name: "failed-probe-native", surface: "both" },
  { name: "path-switch-native", surface: "both" },
  { name: "late-after-unload-native", surface: "both" },
  { name: "mod-semicolon-add-owned", surface: "live" },
  { name: "palette-add-owned", surface: "live" },
  { name: "custom-shortcut-add-owned", surface: "live" },
  { name: "bank-native", surface: "both" },
  { name: "ordinary-native", surface: "both" },
  { name: "sidebar-native", surface: "both" },
  { name: "field-focused-helper", surface: "live" },
  { name: "failed-opener-fallback", surface: "live" },
  { name: "vim-k-gg-up-live", surface: "live" },
  { name: "tab-live", surface: "live" },
  { name: "tab-reading", surface: "reading" },
  { name: "title-slot-anchor-live", surface: "live" },
  { name: "title-slot-anchor-reading", surface: "reading" },
  { name: "variables-live", surface: "live" },
  { name: "variables-reading", surface: "reading" },
  { name: "drawer-exposes-every-key", surface: "live" },
  { name: "bytes-unchanged", surface: "both" },
  { name: "no-paint-spawn", surface: "both" },
  { name: "screenshots-captured", surface: "both" },
  { name: "no-console-exceptions", surface: "both" },
]);

function surfaceOf(name) {
  return REQUIRED_CHECKS.find((row) => row.name === name)?.surface || "both";
}

const PATHS = Object.freeze({
  day: "2026/20261120.md",
  identity: "2026/20261121.md",
  week: "2026/2026-W47.md",
  quarter: "2026/2026-Q4.md",
  year: "2026.md",
  album: "eat.md",
  record: "eat/corner-bistro.md",
  bank: "bank.md",
  ordinary: "ordinary.md",
  invalid: "invalid.md",
  unclosed: "unclosed.md",
  embedder: "embedder.md",
  hover: "hover.md",
  malformedDay: "2026/20261122.md",
});

function fixtureNotes() {
  const notes = foot.fixtureNotes();
  notes[PATHS.embedder] = [
    "# Embedder",
    "",
    "See [[2026/20261120]] for the hover and embed target.",
    "",
    "![[2026/20261120]]",
    "",
  ].join("\n");
  notes[PATHS.hover] = [
    "---",
    'type: "[[note]]"',
    "---",
    "",
    "# Hover host",
    "",
    "Peek [[2026/20261120|today]] without opening it.",
    "",
  ].join("\n");
  notes[PATHS.malformedDay] = [
    "---",
    'parent: "[[2026/2026-W47]]"',
    'type: "[[day]]"',
    "date: 2026-11-22",
    "id: 20261122",
    "intentions: 7",
    "---",
    "",
    "# 2026-11-22 Sun",
    "",
    "Malformed-day sentinel.",
    "",
  ].join("\n");
  return notes;
}

function canvasFixture() {
  return JSON.stringify({
    nodes: [{ id: "card", type: "file", file: PATHS.day, x: 0, y: 0, width: 400, height: 300 }],
    edges: [],
  }, null, 2);
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
    const current = byName.get(row.name) || {
      name: row.name, surface: surfaceOf(row.name), status: "pass", mandatory: row.mandatory !== false,
    };
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

function ownedFailures(probe, mode) {
  const failures = [];
  if (!probe) return ["missing probe"];
  if (mode && probe.mode !== mode) failures.push("mode " + probe.mode);
  if (!probe.scopeClass) failures.push("missing owns-frontmatter class");
  if (!probe.actualOwned) failures.push("actual-ownership query is false");
  if (!probe.containerPresent) failures.push("metadata-container missing from DOM");
  if (probe.containerVisible) failures.push("native Properties still visible");
  // Reading mode removes the native container from layout and the
  // accessibility tree with display:none. Live Preview keeps the node as the
  // title-slot anchor, so it also needs inert and aria-hidden while owned.
  if (mode !== "reading") {
    if (!probe.containerInert) failures.push("container is not inert");
    if (probe.ariaHidden !== "true") failures.push("aria-hidden is " + probe.ariaHidden);
  }
  if (probe.display !== "none") failures.push("computed display is " + probe.display);
  if (!probe.cardPresent) failures.push("supported card is not mounted");
  if (!probe.footPresent) failures.push("card foot is not mounted");
  return failures;
}

function nativeFailures(probe, label) {
  const failures = [];
  if (!probe) return [label + ": missing probe"];
  if (probe.scopeClass) failures.push(label + ": owns-frontmatter class leaked");
  if (probe.actualOwned) failures.push(label + ": actual-ownership query is true");
  if (!probe.containerPresent) failures.push(label + ": metadata-container left the DOM");
  if (probe.containerInert) failures.push(label + ": container stayed inert");
  if (probe.ariaHidden === "true") failures.push(label + ": aria-hidden stayed true");
  return failures;
}

function addEditorFailures(probe) {
  if (!probe?.editorOpen) return ["property editor did not open"];
  return probe.editorAdd ? [] : ["property editor did not enter Add mode"];
}

function sidebarFailures(probe) {
  const failures = [];
  if (!probe?.hasSidebar) failures.push("File Properties sidebar did not open");
  if (!probe?.hasNative) failures.push("File Properties sidebar has no native properties");
  if (probe?.owned) failures.push("sidebar acquired whole-container ownership");
  if (probe?.inert) failures.push("sidebar native properties are inert or aria-hidden");
  return failures;
}

function variablesOk(probe, mode) {
  const failures = [];
  if (mode === "live" && probe.editingVar !== "none") failures.push("--metadata-display-editing is " + JSON.stringify(probe.editingVar));
  if (mode === "reading" && probe.readingVar !== "none") failures.push("--metadata-display-reading is " + JSON.stringify(probe.readingVar));
  return failures;
}

const PAGE_COMMON = String.raw`
  const LEDGER_ID = "bob-ledger-tools";
  const OWNS = "bob-property-card-owns-frontmatter";
  const helpersOf = () => {
    const plugin = window.app && app.plugins && app.plugins.plugins ? app.plugins.plugins[LEDGER_ID] : null;
    return plugin && plugin.constructor ? plugin.constructor.helpers : null;
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
  const rectOf = (node) => {
    if (!node || typeof node.getBoundingClientRect !== "function") return null;
    try {
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    } catch (_) { return null; }
  };
`;

const PROBE_SOURCE = "(() => {" + PAGE_COMMON + String.raw`
  const probeLeaf = (leafId) => {
    const leaf = app.workspace.getLeafById(leafId);
    const view = leaf && leaf.view;
    const file = view && view.file;
    const mode = modeOf(view);
    const scope = mode === "reading" ? readingScopeOf(view) : liveScopeOf(view);
    const container = nativeContainer(scope);
    const helpers = helpersOf();
    const plugin = pluginOf();
    const slot = (() => {
      if (!helpers || typeof helpers.propertyCardTitleSlotFor !== "function") return null;
      try { return helpers.propertyCardTitleSlotFor(scope); } catch (_) { return null; }
    })();
    const actual = (() => {
      if (!helpers || typeof helpers.propertyCardFrontmatterActualOwnership !== "function") return { owned: false };
      try { return helpers.propertyCardFrontmatterActualOwnership(scope, { path: file ? file.path : "", view: liveViewOf(view) }) || { owned: false }; }
      catch (_) { return { owned: false }; }
    })();
    const capability = (() => {
      if (!plugin) return null;
      try {
        const key = typeof plugin.propertyCapabilityCurrentBobKey === "function" ? plugin.propertyCapabilityCurrentBobKey() : "";
        const state = typeof plugin.propertyCapabilityState === "function" ? plugin.propertyCapabilityState(key) : null;
        return {
          key, ready: typeof plugin.propertyCapabilityRoutingReady === "function" ? plugin.propertyCapabilityRoutingReady() : false,
          confirmed: typeof plugin.propertyCapabilityConfirmed === "function" ? plugin.propertyCapabilityConfirmed(key) : false,
          status: state && state.status || null, attempts: state && state.attempts || 0,
        };
      } catch (_) { return null; }
    })();
    const card = scope && scope.querySelector
      ? (scope.querySelector(".bob-album-header, .bob-record-sheet, .bob-intention-card") || null)
      : null;
    const foot = card && card.querySelector ? card.querySelector(".bob-property-card-foot") : null;
    const drawer = foot && foot.querySelector ? foot.querySelector(".bob-property-card-foot-drawer") : null;
    const drawerKeys = drawer ? Array.from(drawer.querySelectorAll("[data-property-key]")).map((node) => node.getAttribute("data-property-key")).filter(Boolean) : [];
    const editor = document.querySelector(".bob-property-editor");
    const active = document.activeElement;
    const activeInside = Boolean(container && active && (active === container || container.contains(active)));
    return {
      path: file ? file.path : null,
      mode,
      scopeClass: Boolean(scope && scope.classList.contains(OWNS)),
      actualOwned: Boolean(actual && actual.owned),
      actualPath: actual && actual.path || null,
      containerPresent: Boolean(container && container.isConnected),
      containerVisible: shown(container),
      containerInert: Boolean(container && (container.inert === true || container.hasAttribute("inert"))),
      ariaHidden: container ? container.getAttribute("aria-hidden") : null,
      display: container ? getComputedStyle(container).display : null,
      editingVar: cssVar(scope, "--metadata-display-editing"),
      readingVar: cssVar(scope, "--metadata-display-reading"),
      slotAnchor: slot ? (slot.anchor && slot.anchor.classList.contains("metadata-container") ? "metadata-container" : (slot.anchor ? slot.anchor.className : "append")) : null,
      slotParentConnected: slot ? Boolean(slot.parent && slot.parent.isConnected) : false,
      slotParentRect: slot ? rectOf(slot.parent) : null,
      slotAnchorRect: slot ? rectOf(slot.anchor) : null,
      cardPresent: Boolean(card && card.isConnected),
      cardClass: card ? String(card.className || "") : "",
      footPresent: Boolean(foot && foot.isConnected),
      drawerOpen: Boolean(drawer && drawer.getAttribute && drawer.getAttribute("aria-hidden") !== "true" && shown(drawer)),
      drawerKeys,
      editorOpen: Boolean(editor && editor.isConnected),
      editorMode: editor ? (editor.getAttribute("data-property-mode") || editor.getAttribute("data-mode") || "") : "",
      editorAdd: Boolean(editor && (
        editor.querySelector("[data-property-add], [data-property-add='name']")
        || /add/i.test(editor.getAttribute("data-property-stage") || "")
        || /add/i.test(editor.getAttribute("data-property-mode") || "")
      )),
      capability,
      activeTag: active ? String(active.tagName || "").toLowerCase() : null,
      activeInside,
      activeClass: active ? String(active.className || "") : "",
      ownsCount: document.querySelectorAll("." + OWNS).length,
      ownedRowCount: document.querySelectorAll(".bob-property-card-owned-property").length,
    };
  };
  const addPropertyCommands = () => {
    const commands = Object.values((app.commands && app.commands.commands) || {});
    return commands.filter((command) => {
      const name = String(command.name || "");
      return /add file property/i.test(name);
    }).map((command) => ({ id: command.id, name: command.name, hotkeys: command.hotkeys || [] }));
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
    } catch (_) { return null; }
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
    };
  };
  const bindHotkey = (id, modifiers, key) => {
    const manager = app.hotkeyManager || null;
    if (!manager || typeof manager.setHotkeys !== "function") return { ok: false, reason: "no-hotkey-manager" };
    try {
      const current = manager.getHotkeys(id) || [];
      const list = Array.isArray(current) ? current.slice() : [];
      const has = list.some((hotkey) => hotkey && hotkey.key === key
        && Array.isArray(hotkey.modifiers)
        && modifiers.every((mod) => hotkey.modifiers.indexOf(mod) !== -1));
      if (has) return { ok: true, bound: false, hotkeys: list };
      manager.setHotkeys(id, list.concat([{ modifiers, key }]));
      return { ok: true, bound: true, hotkeys: manager.getHotkeys(id) };
    } catch (error) {
      return { ok: false, reason: String(error && error.message || error).slice(0, 300) };
    }
  };
  const setEditorCursor = (leafId, line, ch) => {
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
    try { return cm.state.doc.toString(); } catch (_) { return null; }
  };
  let observedKeyDowns = 0;
  document.addEventListener("keydown", () => { observedKeyDowns += 1; }, true);
  const readNote = (notePath) => {
    const file = app.vault.getAbstractFileByPath(notePath);
    if (!file) return Promise.resolve(null);
    return app.vault.read(file);
  };
  window.__bobFrontmatterTakeover = {
    leaf: probeLeaf,
    commands: addPropertyCommands,
    detail: commandDetail,
    bindHotkey,
    readNote,
    setCursor: setEditorCursor,
    docText,
    keyDowns: () => observedKeyDowns,
    plugin: () => Boolean(pluginOf()),
    helpers: () => Boolean(helpersOf() && typeof helpersOf().propertyCardFrontmatterOwnMounted === "function"),
    ownPrimitivePresent: () => Boolean(helpersOf() && typeof helpersOf().propertyCardOwnFrontmatter === "function"),
    platform: () => helpersOf() && helpersOf().propertyCardDesktopPlatform || null,
    active: () => {
      const node = document.activeElement;
      return {
        tag: node ? String(node.tagName || "").toLowerCase() : null,
        className: node ? String(node.className || "") : "",
        inProperties: Boolean(node && node.closest && node.closest(".metadata-container")),
        inEditor: Boolean(node && node.closest && node.closest(".bob-property-editor")),
      };
    },
  };
  return true;
})()`;

function screenshotNeeds() {
  const cards = ["day", "week", "record", "album", "bank"];
  const modes = ["live", "reading"];
  const themes = ["light", "dark"];
  const widths = ["narrow", "wide"];
  const needed = [];
  for (const card of cards) {
    for (const mode of modes) {
      for (const theme of themes) {
        for (const width of widths) needed.push(card + "-" + mode + "-" + theme + "-" + width);
      }
    }
  }
  for (const theme of themes) {
    for (const width of widths) needed.push("ordinary-add-" + theme + "-" + width);
  }
  return needed;
}

function selfTest() {
  const notes = fixtureNotes();
  for (const name of Object.values(PATHS)) assert.ok(notes[name], "fixture missing " + name);
  assert.match(notes[PATHS.album], /type: "\[\[album\]\]"/);
  assert.match(notes[PATHS.record], /type: "\[\[record\]\]"/);
  assert.match(notes[PATHS.day], /type: "\[\[day\]\]"/);
  assert.match(notes[PATHS.bank], /bank:/);
  assert.ok(!notes[PATHS.identity].includes("created:"), "identity-only day must stay quiet");
  assert.ok(notes[PATHS.embedder].includes("![[2026/20261120]]"));
  assert.ok(notes[PATHS.hover].includes("[[2026/20261120|today]]"));
  assert.match(notes[PATHS.malformedDay], /\nintentions: 7\n/);
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
  missing.checks = missing.checks.filter((row) => row.name !== "own-day-live");
  assert.deepEqual(computeVerdict(missing).missing, ["own-day-live"]);
  assert.equal(new Set(REQUIRED_CHECKS.map((row) => row.name)).size, REQUIRED_CHECKS.length);
  const parsed = parseArgs(["-e", "/opt/obsidian", "-o", "/tmp/shots", "-r", "/tmp/report.json", "--self-test"]);
  assert.ok(parsed.selfTest && parsed.executable === "/opt/obsidian");
  assert.throws(() => parseArgs(["--out"]), /requires/);
  assert.throws(() => parseArgs(["--bogus"]), /Unknown/);
  assert.doesNotThrow(() => new Function("return " + PROBE_SOURCE));
  assert.match(PROBE_SOURCE, /^\(\(\) => \{/);
  assert.match(PROBE_SOURCE, /propertyCardFrontmatterActualOwnership/);
  assert.doesNotMatch(PROBE_SOURCE, /propertyCardOwnFrontmatter\(/);
  assert.match(PROBE_SOURCE, /add file property/i);
  const owned = {
    mode: "live", scopeClass: true, actualOwned: true, containerPresent: true, containerVisible: false,
    containerInert: true, ariaHidden: "true", display: "none", cardPresent: true, footPresent: true,
  };
  assert.deepEqual(ownedFailures(owned, "live"), []);
  assert.deepEqual(ownedFailures({ ...owned, mode: "reading", containerInert: false, ariaHidden: null }, "reading"), []);
  assert.ok(nativeFailures({ ...owned, scopeClass: false, actualOwned: false, containerInert: false, ariaHidden: null }).length === 0);
  assert.ok(ownedFailures({ ...owned, containerVisible: true }, "live").includes("native Properties still visible"));
  assert.ok(ownedFailures({ ...owned, mode: "reading", containerVisible: true }, "reading").includes("native Properties still visible"));
  const needed = screenshotNeeds();
  assert.ok(needed.includes("day-live-light-wide"));
  assert.ok(needed.includes("ordinary-add-dark-narrow"));
  assert.equal(needed.length, 5 * 2 * 2 * 2 + 2 * 2);
  assert.equal(typeof spike.PROBE_SOURCE, "string");
  assert.equal(foot.FIXTURE_TODAY, "2026-11-20");
  return true;
}

module.exports = {
  HELP_TEXT, REQUIRED_CHECKS, PATHS, PROBE_SOURCE, PAGE_COMMON,
  parseArgs, surfaceOf, fixtureNotes, canvasFixture, passingReport, computeVerdict,
  ownedFailures, nativeFailures, addEditorFailures, sidebarFailures, variablesOk, screenshotNeeds, selfTest,
};
