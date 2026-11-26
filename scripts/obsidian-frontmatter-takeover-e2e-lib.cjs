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
  "day, week, quarter, year, and bank cards in a disposable Obsidian vault.",
  "Denied contexts, canvas, print, mobile, Source, and ordinary notes keep",
  "native Properties. Needs BOB_BIN and BOB_CLI_DIR. Run the real matrix",
  "under xvfb-run -a on Linux. --self-test never launches Obsidian.",
  "",
  "Options:",
  "  -e, --executable PATH   Obsidian Electron binary",
  "  -o, --out DIRECTORY    Save PNG screenshots here",
  "  -r, --report PATH      Write the structured JSON report here",
  "      --profile PROFILE  Run full (default) or bank-only acceptance",
  "  -s, --self-test        Validate fixtures, probes, and the verdict without launching apps",
  "  -h, --help             Print this help",
].join("\n");

function parseArgs(argv) {
  const args = { executable: null, out: null, report: null, profile: "full", selfTest: false, help: false };
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
    else if (flag === "--profile") {
      args.profile = value("--profile", "PROFILE", ++i);
      if (args.profile !== "full" && args.profile !== "bank") {
        throw new Error("--profile must be full or bank");
      }
    }
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
  { name: "bank-cache-parity", surface: "both" },
  { name: "own-bank-live", surface: "live" },
  { name: "own-bank-reading", surface: "reading" },
  { name: "bank-area-live-arbitration", surface: "live" },
  { name: "bank-area-reading-arbitration", surface: "reading" },
  { name: "bank-contractless-native", surface: "both" },
  { name: "bank-pane-path-lifecycle", surface: "live" },
  { name: "bank-area-settings-gestures", surface: "live" },
  { name: "own-quarter-live", surface: "live" },
  { name: "own-year-live", surface: "live" },
  { name: "own-identity-day-live", surface: "live" },
  { name: "own-identity-day-reading", surface: "reading" },
  { name: "foreign-refresh-keeps-ownership", surface: "both" },
  { name: "source-toggle-releases", surface: "live" },
  { name: "deny-embed", surface: "both" },
  { name: "deny-hover", surface: "both" },
  { name: "deny-canvas", surface: "both" },
  { name: "deny-print", surface: "both" },
  { name: "deny-mobile", surface: "both" },
  { name: "deny-malformed", surface: "both" },
  { name: "deny-unclosed", surface: "both" },
  { name: "stale-cache-releases", surface: "live" },
  { name: "bank-cache-skew-releases", surface: "live" },
  { name: "live-autosave-keeps-ownership", surface: "live" },
  { name: "live-slow-reparse-keeps-card", surface: "live" },
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
  { name: "bank-add-file-property", surface: "live" },
  { name: "bank-sidebar-native", surface: "both" },
  { name: "ordinary-native", surface: "both" },
  { name: "field-focused-helper", surface: "live" },
  { name: "failed-opener-fallback", surface: "live" },
  { name: "vim-k-gg-up-live", surface: "live" },
  { name: "bank-vim-k-gg-live", surface: "live" },
  { name: "bank-focusin-guard", surface: "live" },
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

// Keep a Bank-only acceptance slice inside the same runner and fixture setup.
// Product checks are selected explicitly so unrelated day/album failures cannot
// prevent the Bank invariants and captures from running.
const BANK_PROFILE_PRODUCT_CHECKS = Object.freeze([
  "bank-cache-parity", "own-bank-live", "own-bank-reading",
  "bank-area-live-arbitration", "bank-area-reading-arbitration",
  "bank-pane-path-lifecycle", "bank-area-settings-gestures",
  "variables-live", "tab-live", "bank-vim-k-gg-live", "bank-focusin-guard",
  "variables-reading", "tab-reading", "source-toggle-releases",
  "bank-cache-skew-releases", "disable-unload-restores",
  "pending-capability-native", "absent-old-bob-native", "failed-probe-native",
  "bank-contractless-native", "path-switch-native", "late-after-unload-native",
  "bank-add-file-property", "bank-sidebar-native",
]);
const BANK_PROFILE_REQUIRED_NAMES = new Set([
  "plugin-loaded", ...BANK_PROFILE_PRODUCT_CHECKS,
  "bytes-unchanged", "no-paint-spawn", "screenshots-captured", "no-console-exceptions",
]);
const BANK_PROFILE_REQUIRED_CHECKS = Object.freeze(
  REQUIRED_CHECKS.filter((row) => BANK_PROFILE_REQUIRED_NAMES.has(row.name)),
);

function requiredChecksForProfile(profile = "full") {
  return profile === "bank" ? BANK_PROFILE_REQUIRED_CHECKS : REQUIRED_CHECKS;
}

function isBankProfileCheck(name) {
  return BANK_PROFILE_REQUIRED_NAMES.has(name);
}

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
  notes[PATHS.bank] = [
    "---",
    'parent: "[[cash]]"',
    'type: "[[area]]"',
    'summary: "Synthetic bank ownership fixture."',
    'task_type: "CASH"',
    "created: 2026-11-11T11:31:42-05:00",
    "bank:",
    "  accounts:",
    "    checking:",
    '      label: "Example Checking"',
    "      kind: checking",
    "      start: 2026-11-11",
    "  categories:",
    "    coffee: { label: Coffee, hotkey: c, group: Everyday }",
    '    housing: { label: Housing, hotkey: "1", group: Bills }',
    "  rules:",
    '    - match: "EXAMPLE TRANSFER"',
    '      payee: "Example transfer"',
    "      cat: housing",
    "---",
    "",
    "# 🏦 Bank",
    "",
    "A disposable fixture for native Properties ownership.",
    "",
    "```bob-bank",
    "view: queue",
    "```",
    "",
  ].join("\n");
  notes[PATHS.embedder] = [
    "# Embedder",
    "",
    "See [[2026/20261120]] and [[bank]] for the hover and embed targets.",
    "",
    "![[2026/20261120]]",
    "",
    "![[bank]]",
    "",
  ].join("\n");
  notes[PATHS.hover] = [
    "---",
    'type: "[[note]]"',
    "---",
    "",
    "# Hover host",
    "",
    "Peek [[bank|the bank]] without opening it.",
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

function passingReport(profile = "full") {
  return {
    profile,
    checks: requiredChecksForProfile(profile).map((row) => ({ name: row.name, surface: row.surface, status: "pass", mandatory: true })),
  };
}

function computeVerdict(report) {
  const checks = Array.isArray(report?.checks) ? report.checks : [];
  const required = requiredChecksForProfile(report?.profile || "full");
  const byName = new Map();
  for (const row of checks) {
    const current = byName.get(row.name) || {
      name: row.name, surface: surfaceOf(row.name), status: "pass", mandatory: row.mandatory !== false,
    };
    if (row.status === "fail") current.status = "fail";
    if (row.mandatory === false) current.mandatory = current.mandatory && false;
    byName.set(row.name, current);
  }
  const missing = required.filter((row) => !byName.has(row.name)).map((row) => row.name);
  const surfaces = { live: { pass: 0, total: 0, failed: [] }, reading: { pass: 0, total: 0, failed: [] }, both: { pass: 0, total: 0, failed: [] } };
  for (const spec of required) {
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

function screenshotFailures(probe, notePath, mode, native = false) {
  const failures = native ? nativeFailures(probe, "screenshot") : ownedFailures(probe, mode);
  if (probe?.path !== notePath) failures.push("screenshot has the wrong note");
  if (probe?.mode !== mode) failures.push("screenshot has the wrong mode");
  if (probe?.containerCount !== 1) failures.push("screenshot must have exactly one native container");
  if (probe?.visibleContainerCount !== (native ? 1 : 0)) failures.push("screenshot native visibility is wrong");
  return failures;
}

function sidebarFailures(probe) {
  const failures = [];
  if (!probe?.hasSidebar) failures.push("File Properties sidebar did not open");
  if (!probe?.hasNative) failures.push("File Properties sidebar has no native properties");
  if (!probe?.visible) failures.push("File Properties sidebar controls are not visible");
  if (probe?.owned) failures.push("sidebar acquired whole-container ownership");
  if (probe?.inert) failures.push("sidebar native properties are inert or aria-hidden");
  return failures;
}

function modalLifecycleFailures(modal, expectedClass, opener) {
  const failures = [];
  if (!modal?.present) failures.push("modal object is absent");
  if (modal?.closed) failures.push("modal is closed");
  if (!modal?.connected) failures.push("modal root is disconnected");
  if (!modal?.ownerDocumentPresent) failures.push("modal has no owning document");
  if (modal?.ownerDocumentIsCurrent !== true) failures.push("modal belongs to a different Obsidian document");
  if (modal?.visible !== true) failures.push("modal root is not visible");
  if (modal?.activeInside !== true) failures.push("focus is outside the modal");
  if (expectedClass && !(modal?.classes || []).includes(expectedClass)) {
    failures.push("modal class is missing: " + expectedClass);
  }
  if (opener) {
    if (opener.called !== true) failures.push("production opener was not called by the gesture");
    if (opener.pending === true) failures.push("production opener has not settled");
    if (opener.error) failures.push("production opener rejected: " + opener.error);
    if (opener.outcome?.ok !== true) failures.push("production opener refused: " + JSON.stringify(opener.outcome || null));
    if (opener.outcome?.modalPresent !== true) failures.push("production opener did not return the live modal");
  }
  return failures;
}

function bankSettingsFailures(modal) {
  const failures = [];
  if (modal?.noteKind !== "bank") failures.push("property report note_kind is " + JSON.stringify(modal?.noteKind));
  if (modal?.viewMode !== "live") failures.push("bare + ran in " + JSON.stringify(modal?.viewMode) + " mode");
  if (modal?.editorMode !== "browse") failures.push("property editor opened in " + JSON.stringify(modal?.editorMode) + " mode");
  if (modal?.hasSettingsGroup !== true) failures.push("property report has no Settings group");
  if (modal?.heading !== true) failures.push("property editor does not render AREA SETTINGS");
  if (modal?.selectedId !== "setting::summary") failures.push("first Settings row is " + JSON.stringify(modal?.selectedId));
  if (modal?.selectedRowGroup !== "settings" || modal?.selectedRowConnected !== true) {
    failures.push("selected row is not a connected row in the Settings group");
  }
  return failures;
}

function modalProbeSource(kind) {
  const property = kind === "bank" ? "bankSetupCardModal" : "propertyEditorModal";
  return `(() => {
    const plugin = app.plugins.plugins["bob-ledger-tools"];
    const modal = plugin?.${property} || null;
    const nodes = [modal?.containerEl, modal?.modalEl, modal?.contentEl].filter(Boolean);
    const root = modal?.containerEl || modal?.modalEl || modal?.contentEl || null;
    const ownerDocument = nodes.map((node) => node.ownerDocument).find(Boolean) || null;
    const selectedId = String(modal?.selectedId || "");
    const selectedRow = Array.from(root?.querySelectorAll?.("[data-property-row]") || [])
      .find((node) => node.getAttribute("data-property-row") === selectedId) || null;
    const selectedGroup = selectedRow?.closest?.("[data-property-group]") || null;
    const title = root?.querySelector?.("[data-property-group='settings'] .bob-property-editor-group-title") || null;
    const activeView = app.workspace?.activeLeaf?.view || null;
    const currentDocument = activeView?.containerEl?.ownerDocument
      || app.workspace?.containerEl?.ownerDocument || document;
    const activeElement = ownerDocument?.activeElement || null;
    let visible = false;
    try {
      const style = ownerDocument?.defaultView?.getComputedStyle?.(root);
      const rect = root?.getBoundingClientRect?.();
      visible = Boolean(root?.isConnected === true && style?.display !== "none"
        && style?.visibility !== "hidden" && Number(rect?.width) > 0 && Number(rect?.height) > 0);
    } catch (_) {}
    const activeInside = Boolean(activeElement && nodes.some((node) => node === activeElement || node.contains?.(activeElement)));
    const viewMode = !activeView ? ""
      : activeView.getMode?.() === "preview" ? "reading"
        : activeView.getState?.()?.source ? "source" : "live";
    return {
      kind: ${JSON.stringify(kind)}, present: Boolean(modal), closed: modal?.closed === true,
      connected: nodes.some((node) => node.isConnected === true),
      ownerDocumentPresent: Boolean(ownerDocument), ownerDocumentIsCurrent: ownerDocument === currentDocument,
      ownerDocumentURL: ownerDocument?.location?.href || "", currentDocumentURL: currentDocument?.location?.href || "",
      visible, activeInside, activeElementTag: activeElement?.tagName || "",
      classes: [...new Set(nodes.flatMap((node) => Array.from(node.classList || [])))],
      noteKind: modal?.report?.note_kind || modal?.noteKind || "",
      editorMode: modal?.mode || "", viewMode, selectedId,
      statusKind: modal?.status?.kind || "", reportReady: Boolean(modal?.report?.ok === true),
      reportNoteKind: modal?.report?.note_kind || "", reportCapabilities: modal?.report?.capabilities || [],
      contractKind: modal?.report?.contract?.kind || "", focusSettings: modal?.focusSettings === true,
      propertyEditorSettingFocusDone: modal?.propertyEditorSettingFocusDone === true,
      requestedSetting: modal?.requestedSetting || "",
      selectedRowGroup: selectedGroup?.getAttribute?.("data-property-group") || "",
      selectedRowConnected: Boolean(selectedRow?.isConnected),
      hasSettingsGroup: Boolean(root?.querySelector?.('[data-property-group="settings"]')),
      heading: Boolean(title && String(title.textContent || "").includes("AREA SETTINGS")),
      text: String(root?.textContent || "").slice(0, 240),
      rootClass: String(root?.className || ""),
      modalClass: String(modal?.modalEl?.className || ""),
      containerConnected: Boolean(modal?.containerEl?.isConnected),
      modalConnected: Boolean(modal?.modalEl?.isConnected),
      contentConnected: Boolean(modal?.contentEl?.isConnected),
    };
  })()`;
}

function openerWatchSource(kind, action = "read") {
  const method = kind === "bank" ? "openBankSetupCard" : "openPropertyEditor";
  const modalProperty = kind === "bank" ? "bankSetupCardModal" : "propertyEditorModal";
  const key = kind === "bank" ? "bank" : "property";
  if (action === "start") return `(() => {
    const plugin = app.plugins.plugins["bob-ledger-tools"];
    const watches = window.__bobTakeoverOpenerWatches || (window.__bobTakeoverOpenerWatches = {});
    const previous = watches[${JSON.stringify(key)}];
    if (previous && plugin?.${method} === previous.wrapped) plugin.${method} = previous.original;
    const state = { called: false, pending: false, outcome: null, error: null };
    const original = plugin?.${method};
    if (typeof original !== "function") return { installed: false, reason: "production opener is missing" };
    const summarize = (result) => {
      const modal = result?.modal || plugin?.${modalProperty} || null;
      const connected = [modal?.containerEl, modal?.modalEl, modal?.contentEl]
        .some((node) => node?.isConnected === true);
      return { ok: result?.ok === true, reason: result?.reason || "",
        modalPresent: Boolean(modal && modal.closed !== true), modalConnected: connected };
    };
    const wrapped = function(...args) {
      state.called = true;
      try {
        const result = original.apply(this, args);
        if (result && typeof result.then === "function") {
          state.pending = true;
          result.then((value) => { state.outcome = summarize(value); state.pending = false; }, (error) => {
            state.error = String(error?.message || error); state.pending = false;
          });
        } else state.outcome = summarize(result);
        return result;
      } catch (error) {
        state.error = String(error?.message || error);
        throw error;
      }
    };
    plugin.${method} = wrapped;
    watches[${JSON.stringify(key)}] = { plugin, original, wrapped, state };
    return { installed: true };
  })()`;
  if (action === "stop") return `(() => {
    const watches = window.__bobTakeoverOpenerWatches || {};
    const watch = watches[${JSON.stringify(key)}];
    if (!watch) return null;
    if (watch.plugin?.${method} === watch.wrapped) watch.plugin.${method} = watch.original;
    delete watches[${JSON.stringify(key)}];
    return watch.state;
  })()`;
  return `(() => window.__bobTakeoverOpenerWatches?.[${JSON.stringify(key)}]?.state || null)()`;
}

// One Escape may only dismiss a menu, Add stage, or filter. Follow the
// complete close ladder and verify dismissal before the next keyboard case.
async function dismissEditor({ isOpen, escape }) {
  for (let step = 0; step < 4; step += 1) {
    if (!await isOpen()) return;
    await escape();
  }
  if (await isOpen()) throw new Error("property editor stayed open after its close ladder");
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
  const nativeContainers = (scope) => {
    if (!scope) return [];
    const parent = scope.classList.contains("cm-editor")
      ? child(child(scope, "cm-scroller"), "cm-sizer")
      : scope.classList.contains("markdown-preview-view")
        ? child(child(scope, "markdown-preview-sizer"), "mod-header") : null;
    return Array.from(parent?.children || []).filter((node) => node.classList.contains("metadata-container"));
  };
  const nativeContainer = (scope) => nativeContainers(scope)[0] || null;
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
          status: state && state.status || null, contract: state && state.contract || null,
          attempts: state && state.attempts || 0, contractAttempts: state && state.contractAttempts || 0,
        };
      } catch (_) { return null; }
    })();
    const homeCard = file?.path === "bank.md" && scope?.querySelector
      ? scope.querySelector('.bob-home-card[data-home-source="bank.md"]') : null;
    const bankCard = file?.path === "bank.md" && scope?.querySelector
      ? scope.querySelector('.bob-bank-setup[data-bank-setup-source="bank.md"]') : null;
    const card = scope && scope.querySelector
      ? (homeCard || scope.querySelector(".bob-album-header, .bob-record-sheet, .bob-intention-card, .bob-bank-setup") || null)
      : null;
    const foot = card && card.querySelector ? card.querySelector(".bob-property-card-foot") : null;
    const adopted = (() => {
      try { return helpers?.propertyCardAdoptedEntry?.(scope) || null; } catch (_) { return null; }
    })();
    const bankGate = file?.path === "bank.md" && helpers && plugin ? (() => {
      const source = mode === "live"
        ? String(liveViewOf(view)?.state?.doc?.toString?.() || "")
        : String(plugin.bankSetupSourceCache?.get?.("bank.md") || "");
      const cached = app.metadataCache.getFileCache(file)?.frontmatter || null;
      const livePath = mode === "live"
        ? (typeof plugin.notebookHeaderLivePath === "function" ? plugin.notebookHeaderLivePath(liveViewOf(view)) : null)
        : null;
      let cacheEvidence = false;
      try { cacheEvidence = helpers.propertyCardFrontmatterCacheEvidence(source, cached); } catch (_) {}
      let modelCurrent = false;
      try { modelCurrent = Boolean(plugin.bankSetupCardFor("bank.md", source)?.model); } catch (_) {}
      const areaFoot = homeCard?.querySelector?.(".bob-property-card-foot") || null;
      const bankFoot = bankCard?.querySelector?.(".bob-property-card-foot") || null;
      return {
        active: plugin.bankSetupActive === true,
        desktop: helpers.propertyCardDesktopPlatform?.isDesktopApp,
        scopeDenied: helpers.propertyCardFrontmatterScopeDenied?.(scope) === true,
        livePath,
        titleOwnerKind: adopted?.kind || null,
        titleOwnerGeneration: adopted?.generation || null,
        areaOwnerGeneration: helpers.propertyCardHomeBankAreaCurrent?.(scope, file.path)?.generation || null,
        areaCardPresent: Boolean(homeCard?.isConnected),
        areaCardFootPresent: Boolean(areaFoot?.isConnected),
        bankCardPresent: Boolean(bankCard?.isConnected),
        bankCardInBody: Boolean(bankCard?.isConnected && !bankCard.classList?.contains("bob-property-card-title-slot")),
        bankCardParentClass: bankCard?.parentElement?.className || null,
        bankSetupBodyPresent: Boolean(bankCard?.querySelector?.(".bob-bank-setup-body")),
        bankEditPresent: Boolean(bankCard?.querySelector?.("button.bob-bank-setup-edit")),
        bankNestedPresent: Boolean(homeCard?.querySelector?.('[data-property-key="bank"] .bob-property-card-foot-nested')),
        bankWhereMark: homeCard?.querySelector?.('[data-property-key="bank"] .bob-property-card-foot-mark')?.textContent || null,
        registryKinds: typeof plugin.propertyCardKinds === "function" ? plugin.propertyCardKinds() : [],
        resolvedKind: typeof plugin.resolvePropertyCard === "function"
          ? plugin.resolvePropertyCard({ path: file.path, frontmatter: cached })?.kind || null : null,
        bankFootPresent: Boolean(bankFoot?.isConnected),
        bankFootSuppressedAfterAreaFoot: Boolean(areaFoot?.isConnected && !bankFoot?.isConnected),
        mountPath: bankCard?.getAttribute?.("data-bank-setup-source") || null,
        mountConnected: Boolean(bankCard?.isConnected),
        scopeContainsMount: Boolean(scope?.contains?.(bankCard)),
        footPresent: Boolean(areaFoot?.isConnected || foot?.isConnected),
        cacheEvidence,
        cachedKeys: cached && typeof cached === "object" ? Object.keys(cached).sort() : [],
        sourceLength: source.length,
        modelCurrent,
      };
    })() : null;
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
      containerCount: nativeContainers(scope).length,
      visibleContainerCount: nativeContainers(scope).filter(shown).length,
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
      drawerOpen: Boolean(drawer && drawer.getAttribute("data-open") === "true" && shown(drawer)),
      drawerKeys,
      editorOpen: Boolean(editor && editor.isConnected),
      editorMode: editor ? (editor.getAttribute("data-property-mode") || editor.getAttribute("data-mode") || "") : "",
      editorAdd: Boolean(editor && (
        editor.querySelector("[data-property-add], [data-property-add='name']")
        || /add/i.test(editor.getAttribute("data-property-stage") || "")
        || /add/i.test(editor.getAttribute("data-property-mode") || "")
      )),
      capability,
      bankGate,
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
      if (view && typeof view.setCursor === "function") {
        view.setCursor({ line, ch: ch || 0 });
      }
      // Obsidian's editor wrapper can leave the CodeMirror selection at its
      // previous position during a rapid test-mode switch. Fall back to the
      // live view selection when the wrapper did not place the requested
      // cursor; the subsequent key probes still exercise Obsidian's handler.
      if (cm.state.selection.main.head !== target) {
        cm.dispatch({ selection: { anchor: target }, scrollIntoView: true });
      }
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
  const SLOT = "bob-property-card-title-slot";
  let autosaveSampler = null;
  const sampleOwnedFrame = (leafId) => {
    const leaf = app.workspace.getLeafById(leafId);
    const view = leaf && leaf.view;
    const file = view && view.file;
    const editor = liveScopeOf(view);
    const sizer = child(child(editor, "cm-scroller"), "cm-sizer");
    const container = nativeContainer(editor);
    const slotCard = sizer ? Array.from(sizer.children || []).find((node) => node.classList && node.classList.contains(SLOT)) || null : null;
    const inline = sizer ? child(sizer, "inline-title") : null;
    const helpers = helpersOf();
    let liveCache = null;
    let settledCache = null;
    try { liveCache = file ? app.metadataCache.getFileCache(file) : null; } catch (_) { liveCache = null; }
    try {
      settledCache = file && helpers && typeof helpers.propertyCardSettledFileCache === "function"
        ? helpers.propertyCardSettledFileCache(app, file) : null;
    } catch (_) { settledCache = null; }
    return {
      t: typeof performance !== "undefined" && performance.now ? performance.now() : Date.now(),
      containerVisible: shown(container),
      owns: Boolean(editor && editor.classList.contains(OWNS)),
      slotCard: Boolean(slotCard && slotCard.isConnected),
      inlineVisible: shown(inline),
      liveCache: liveCache != null,
      settledCache: settledCache != null,
      cardText: slotCard ? String(slotCard.innerText || "") : "",
    };
  };
  const startAutosaveSampler = (leafId) => {
    stopAutosaveSampler();
    const leaf = app.workspace.getLeafById(leafId);
    const editor = liveScopeOf(leaf && leaf.view);
    if (!editor) return { ok: false, reason: "no-editor" };
    const samples = [];
    const failures = [];
    let baselineCardText = null;
    const snapshot = () => {
      const row = sampleOwnedFrame(leafId);
      samples.push(row);
      if (baselineCardText == null && row.slotCard) baselineCardText = row.cardText;
      if (row.containerVisible) failures.push({ kind: "native-visible", t: row.t });
      if (!row.owns) failures.push({ kind: "owner-class-missing", t: row.t });
      if (!row.slotCard) failures.push({ kind: "slot-card-absent", t: row.t });
      if (row.inlineVisible) failures.push({ kind: "inline-title-visible", t: row.t });
      if (baselineCardText != null && row.cardText !== baselineCardText) {
        failures.push({ kind: "card-text-changed", t: row.t });
      }
    };
    let raf = 0;
    const tick = () => { snapshot(); raf = requestAnimationFrame(tick); };
    const observer = new MutationObserver(snapshot);
    observer.observe(editor, { attributes: true, attributeFilter: ["class"], childList: true, subtree: true });
    snapshot();
    raf = requestAnimationFrame(tick);
    autosaveSampler = { samples, failures, raf, observer, leafId };
    return { ok: true };
  };
  const stopAutosaveSampler = () => {
    if (!autosaveSampler) return { samples: [], failures: [], count: 0 };
    try { cancelAnimationFrame(autosaveSampler.raf); } catch (_) {}
    try { autosaveSampler.observer.disconnect(); } catch (_) {}
    const result = {
      samples: autosaveSampler.samples,
      failures: autosaveSampler.failures,
      count: autosaveSampler.samples.length,
    };
    autosaveSampler = null;
    return result;
  };
  let slowReparse = null;
  const installSlowReparse = (notePath, delayMs) => {
    restoreSlowReparse();
    const metadataCache = app.metadataCache;
    const vault = app.vault;
    const originalGet = metadataCache.getFileCache.bind(metadataCache);
    const originalDescriptor = Object.getOwnPropertyDescriptor(metadataCache, "getFileCache");
    const originalTrigger = typeof metadataCache.trigger === "function" ? metadataCache.trigger.bind(metadataCache) : null;
    let holding = false;
    let holdFile = null;
    Object.defineProperty(metadataCache, "getFileCache", {
      configurable: true,
      writable: true,
      value(file) {
        if (holding && file && file.path === notePath) return null;
        return originalGet(file);
      },
    });
    if (originalTrigger) {
      metadataCache.trigger = function trigger(name, ...args) {
        if (name === "changed" && holding && args[0] && args[0].path === notePath) return;
        return originalTrigger(name, ...args);
      };
    }
    const modifyRef = vault.on("modify", (file) => {
      if (!file || file.path !== notePath || holding) return;
      holding = true;
      holdFile = file;
      setTimeout(() => {
        holding = false;
        try {
          if (originalTrigger) originalTrigger("changed", holdFile, "", originalGet(holdFile));
        } catch (_) {}
      }, delayMs || 150);
    });
    slowReparse = {
      restore() {
        try { vault.offref(modifyRef); } catch (_) {}
        try {
          if (originalDescriptor) Object.defineProperty(metadataCache, "getFileCache", originalDescriptor);
          else delete metadataCache.getFileCache;
        } catch (_) {}
        if (originalTrigger) {
          try { metadataCache.trigger = originalTrigger; } catch (_) {}
        }
      },
    };
    return { ok: true, path: notePath, delayMs: delayMs || 150 };
  };
  const restoreSlowReparse = () => {
    if (!slowReparse) return false;
    try { slowReparse.restore(); } catch (_) {}
    slowReparse = null;
    return true;
  };
  let changedWait = null;
  const stopChangedWait = () => {
    if (!changedWait) return false;
    try { app.metadataCache.offref(changedWait.ref); } catch (_) {}
    changedWait = null;
    return true;
  };
  const startChangedWait = (notePath) => {
    stopChangedWait();
    const target = String(notePath || "");
    const state = { seen: false, path: target, ref: null };
    state.ref = app.metadataCache.on("changed", (file) => {
      if (!file || file.path !== target) return;
      state.seen = true;
      try { app.metadataCache.offref(state.ref); } catch (_) {}
    });
    changedWait = state;
    return { ok: true, path: target };
  };
  const changedWaitSeen = () => Boolean(changedWait && changedWait.seen);
  const waitChanged = (notePath, timeoutMs) => new Promise((resolve, reject) => {
    const deadline = Date.now() + (timeoutMs || 15000);
    const ref = app.metadataCache.on("changed", (file) => {
      if (!file || file.path !== notePath) return;
      try { app.metadataCache.offref(ref); } catch (_) {}
      resolve(true);
    });
    const tick = () => {
      if (Date.now() >= deadline) {
        try { app.metadataCache.offref(ref); } catch (_) {}
        reject(new Error("changed timeout for " + notePath));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
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
    startAutosaveSampler,
    stopAutosaveSampler,
    installSlowReparse,
    restoreSlowReparse,
    startChangedWait,
    stopChangedWait,
    changedWaitSeen,
    waitChanged,
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

function screenshotNeeds(profile = "full") {
  const cards = profile === "bank" ? ["bank"] : ["day", "week", "record", "album", "bank"];
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
  if (profile !== "bank") {
    for (const theme of themes) {
      for (const width of widths) needed.push("ordinary-add-" + theme + "-" + width);
    }
  }
  return needed;
}

function selfTest() {
  const notes = fixtureNotes();
  for (const name of Object.values(PATHS)) assert.ok(notes[name], "fixture missing " + name);
  assert.match(notes[PATHS.album], /type: "\[\[album\]\]"/);
  assert.match(notes[PATHS.record], /type: "\[\[record\]\]"/);
  assert.match(notes[PATHS.day], /type: "\[\[day\]\]"/);
  assert.match(notes[PATHS.bank], /created: 2026-11-11T11:31:42-05:00/);
  assert.match(notes[PATHS.bank], /start: 2026-11-11/);
  assert.match(notes[PATHS.bank], /hotkey: "1"/);
  assert.match(notes[PATHS.bank], /coffee: \{ label: Coffee, hotkey: c, group: Everyday \}/);
  assert.match(notes[PATHS.bank], /parent: "\[\[cash\]\]"/);
  assert.match(notes[PATHS.bank], /type: "\[\[area\]\]"/);
  assert.ok(!notes[PATHS.identity].includes("created:"), "identity-only day must stay quiet");
  assert.ok(notes[PATHS.embedder].includes("![[2026/20261120]]"));
  assert.ok(notes[PATHS.hover].includes("[[bank|the bank]]"));
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
  const parsed = parseArgs(["-e", "/opt/obsidian", "-o", "/tmp/shots", "-r", "/tmp/report.json", "--profile", "bank", "--self-test"]);
  assert.ok(parsed.selfTest && parsed.executable === "/opt/obsidian" && parsed.profile === "bank");
  assert.throws(() => parseArgs(["--profile", "album"]), /must be full or bank/);
  assert.ok(requiredChecksForProfile("bank").some((row) => row.name === "bank-area-settings-gestures"));
  assert.ok(!requiredChecksForProfile("bank").some((row) => row.name === "own-day-live"));
  assert.equal(computeVerdict(passingReport("bank")).verdict, "GO");
  const missingBank = passingReport("bank");
  missingBank.checks = missingBank.checks.filter((row) => row.name !== "bank-cache-parity");
  assert.deepEqual(computeVerdict(missingBank).missing, ["bank-cache-parity"]);
  assert.throws(() => parseArgs(["--out"]), /requires/);
  assert.throws(() => parseArgs(["--bogus"]), /Unknown/);
  assert.doesNotThrow(() => new Function("return " + PROBE_SOURCE));
  assert.doesNotThrow(() => new Function("return " + modalProbeSource("bank")));
  assert.doesNotThrow(() => new Function("return " + openerWatchSource("bank", "start")));
  assert.match(PROBE_SOURCE, /^\(\(\) => \{/);
  assert.match(PROBE_SOURCE, /propertyCardFrontmatterActualOwnership/);
  assert.doesNotMatch(PROBE_SOURCE, /propertyCardOwnFrontmatter\(/);
  assert.match(PROBE_SOURCE, /add file property/i);
  assert.match(PROBE_SOURCE, /startAutosaveSampler/);
  assert.match(PROBE_SOURCE, /installSlowReparse/);
  assert.match(PROBE_SOURCE, /startChangedWait/);
  assert.match(PROBE_SOURCE, /waitChanged/);
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
  assert.equal(screenshotNeeds("bank").length, 2 * 2 * 2);
  assert.ok(screenshotNeeds("bank").every((name) => name.startsWith("bank-")));
  assert.deepEqual(modalLifecycleFailures({ present: true, closed: false, connected: true,
    ownerDocumentPresent: true, ownerDocumentIsCurrent: true, classes: ["bob-bank-setup-card-modal"] },
  "bob-bank-setup-card-modal", { called: true, pending: false, outcome: { ok: true, modalPresent: true } }), []);
  assert.ok(modalLifecycleFailures({ present: true, closed: false, connected: false,
    ownerDocumentPresent: true, ownerDocumentIsCurrent: true, classes: [] },
  "bob-bank-setup-card-modal", { called: false }).length > 0);
  const settingsModal = { noteKind: "bank", viewMode: "live", editorMode: "browse", hasSettingsGroup: true,
    heading: true, selectedId: "setting::summary", selectedRowGroup: "settings", selectedRowConnected: true };
  assert.deepEqual(bankSettingsFailures(settingsModal), []);
  assert.ok(bankSettingsFailures({ ...settingsModal, noteKind: "area" }).length > 0);
  assert.ok(bankSettingsFailures({ ...settingsModal, selectedId: "setting::task_type" }).length > 0);
  assert.ok(bankSettingsFailures({ ...settingsModal, hasSettingsGroup: false }).length > 0);
  assert.ok(bankSettingsFailures({ ...settingsModal, viewMode: "reading" }).length > 0);
  assert.equal(typeof spike.PROBE_SOURCE, "string");
  assert.equal(foot.FIXTURE_TODAY, "2026-11-20");
  return true;
}

module.exports = {
  HELP_TEXT, REQUIRED_CHECKS, BANK_PROFILE_PRODUCT_CHECKS, BANK_PROFILE_REQUIRED_CHECKS,
  PATHS, PROBE_SOURCE, PAGE_COMMON, dismissEditor,
  parseArgs, surfaceOf, requiredChecksForProfile, isBankProfileCheck, fixtureNotes, canvasFixture, passingReport, computeVerdict,
  ownedFailures, nativeFailures, addEditorFailures, screenshotFailures, sidebarFailures, variablesOk, screenshotNeeds, selfTest,
  modalLifecycleFailures, bankSettingsFailures,
  modalProbeSource, openerWatchSource,
};
