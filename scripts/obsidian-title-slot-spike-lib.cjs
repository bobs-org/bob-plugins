#!/usr/bin/env node
// Offline fixtures, page-side sources, check inventory, placement rules, and
// verdict for the real-Obsidian title-slot spike. Nothing here launches
// Obsidian; the runner (obsidian-title-slot-spike.cjs) does.
"use strict";

const assert = require("node:assert/strict");

const HELP_TEXT = [
  "Usage: node scripts/obsidian-title-slot-spike.cjs [OPTIONS]",
  "",
  "Measure the property-card title-slot primitive in an isolated real Obsidian vault:",
  "survival across switches, modes, splits, re-renders, and resizes; the Properties,",
  "inline title, line length, and theme matrix; a tall and growing card; denials;",
  "and teardown. Writes a GO, partial GO, or NO-GO verdict. Needs no bob binary.",
  "Run the real spike under xvfb-run -a on Linux.",
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

// Every required check with its surface. A missing row fails its surface.
const REQUIRED_CHECKS = Object.freeze([
  { name: "plugin-loaded", surface: "both" },
  { name: "switch-file-live", surface: "live" },
  { name: "switch-file-reading", surface: "reading" },
  { name: "mode-live-reading-source", surface: "both" },
  { name: "split-panes", surface: "both" },
  { name: "same-file-two-panes", surface: "both" },
  { name: "metadata-rerender-live", surface: "live" },
  { name: "metadata-rerender-reading", surface: "reading" },
  { name: "window-resize", surface: "both" },
  { name: "settings-matrix-live", surface: "live" },
  { name: "settings-matrix-reading", surface: "reading" },
  { name: "click-accuracy", surface: "live" },
  { name: "coords-at-pos", surface: "live" },
  { name: "scroll-restore-live", surface: "live" },
  { name: "scroll-restore-reading", surface: "reading" },
  { name: "heading-jump-live", surface: "live" },
  { name: "heading-jump-reading", surface: "reading" },
  { name: "vim-gg-G", surface: "live" },
  { name: "deny-embed", surface: "both" },
  { name: "deny-hover-popover", surface: "both" },
  { name: "deny-canvas", surface: "both" },
  { name: "teardown-plugin-disable", surface: "both" },
  { name: "teardown-leaf-close", surface: "both" },
  { name: "bytes-unchanged", surface: "both" },
  { name: "screenshots-captured", surface: "both" },
  { name: "no-console-exceptions", surface: "both" },
]);

function surfaceOf(name) {
  return REQUIRED_CHECKS.find((row) => row.name === name)?.surface || "both";
}

// ---- Fixtures ----

const BODY_LINES = 160;
const SECTION_EVERY = 20;

function pad(n, width = 3) { return String(n).padStart(width, "0"); }

function bodyLineText(n) { return "- Line " + pad(n) + " alpha"; }

function alphaNote() {
  const lines = [
    "---", "title: Alpha fixture", "status: active", "rating: 4", "tags:", "  - spike", "  - title-slot",
    "created: 2026-11-20", "---", "", "# Alpha heading", "",
  ];
  for (let n = 1; n <= BODY_LINES; n += 1) {
    if ((n - 1) % SECTION_EVERY === 0) {
      if (n > 1) lines.push("");
      lines.push("## Section " + pad((n - 1) / SECTION_EVERY + 1, 2), "");
    }
    lines.push(bodyLineText(n));
  }
  return lines.join("\n") + "\n";
}

function fixtureNotes() {
  const beta = ["---", "kind: beta", "owner: spike", "count: 2", "---", "", "# Beta heading", ""];
  for (let n = 1; n <= 40; n += 1) beta.push("- Beta line " + pad(n, 2));
  const nofm = ["# No frontmatter", "", "This note has no frontmatter.", ""];
  for (let n = 1; n <= 20; n += 1) nofm.push("- Plain line " + pad(n, 2));
  // Obsidian re-serializes canvases on open; author it in that exact shape.
  const canvas = "{\n\t\"nodes\":[\n\t\t" + JSON.stringify({ id: "a1b2c3d4e5f60718", type: "file", file: "alpha.md", x: -300, y: -260, width: 600, height: 520 })
    + "\n\t],\n\t\"edges\":[]\n}";
  return {
    "alpha.md": alphaNote(),
    "beta.md": beta.join("\n") + "\n",
    "nofm.md": nofm.join("\n") + "\n",
    "embedder.md": ["# Embedder", "", "See [[alpha]] for the hover link.", "", "![[alpha]]", ""].join("\n"),
    "board.canvas": canvas,
  };
}

// Twenty-four combinations per surface.
function settingsMatrix() {
  const rows = [];
  for (const propertiesInDocument of ["visible", "hidden", "source"]) {
    for (const showInlineTitle of [true, false]) {
      for (const readableLineLength of [true, false]) {
        for (const theme of ["light", "dark"]) {
          rows.push({ propertiesInDocument, showInlineTitle, readableLineLength, theme });
        }
      }
    }
  }
  return rows;
}

function comboKey(combo) {
  return [combo.propertiesInDocument, combo.showInlineTitle ? "title" : "notitle",
    combo.readableLineLength ? "readable" : "wide", combo.theme].join("-");
}

// Matrix combinations that get a screenshot, per surface.
const MATRIX_SHOTS = Object.freeze({
  live: ["visible-title-readable-light", "hidden-title-readable-dark", "source-title-wide-light", "visible-notitle-readable-dark"],
  reading: ["visible-title-readable-dark", "hidden-notitle-readable-light", "source-title-readable-light", "visible-title-wide-dark"],
});

// ---- Page-side sources (evaluated in Obsidian through CDP) ----

// Shared page helpers, concatenated into both installers.
const PAGE_COMMON = String.raw`
  const LEDGER_ID = "bob-ledger-tools";
  const BOUNDARY = ".markdown-embed, .internal-embed, .hover-popover, .canvas-node";
  const slotHelpers = () => {
    const plugin = window.app && app.plugins && app.plugins.plugins ? app.plugins.plugins[LEDGER_ID] : null;
    const helpers = plugin && plugin.constructor ? plugin.constructor.helpers : null;
    return helpers && typeof helpers.propertyCardMountInTitleSlot === "function" ? helpers : null;
  };
  const modeOf = (view) => {
    if (!view || typeof view.getMode !== "function") return null;
    if (view.getMode() === "preview") return "reading";
    const state = typeof view.getState === "function" ? view.getState() : {};
    return state && state.source ? "source" : "live";
  };
  let readingScopeShape = null;
  const readingScopeOf = (view) => {
    const root = view && view.previewMode ? view.previewMode.containerEl : null;
    if (!root) return null;
    if (root.matches && root.matches(".markdown-preview-view")) { readingScopeShape = "containerEl"; return root; }
    const direct = Array.from(root.children || []).find((node) => node.classList && node.classList.contains("markdown-preview-view"));
    if (direct) { readingScopeShape = "child-of-containerEl"; return direct; }
    const nested = root.querySelector ? root.querySelector(".markdown-preview-view") : null;
    if (nested) readingScopeShape = "descendant-of-containerEl";
    return nested || null;
  };
  const liveScopeOf = (view) => (view && view.editor && view.editor.cm ? view.editor.cm.dom : null) || null;
  const shown = (node) => Boolean(node && node.isConnected && node.getClientRects().length > 0
    && getComputedStyle(node).visibility !== "hidden");
  const child = (root, name) => (root ? Array.from(root.children).find((node) => node.classList.contains(name)) || null : null);
`;

// window.__bobTitleSlotSpike: a probe adapter modeled on a real one. It reads
// the primitive from the plugin constructor on every call, so a disabled and
// re-enabled plugin is picked up fresh, and does nothing while it is absent.
const ADAPTER_SOURCE = "(() => {" + PAGE_COMMON + String.raw`
  const prior = window.__bobTitleSlotSpike;
  if (prior && typeof prior.stop === "function") prior.stop();
  const state = {
    running: false, paused: false, measured: true, height: 120, mounts: new Map(), refs: [], timers: [],
    counts: { refreshes: 0, mountCalls: 0, mounted: 0, released: 0, nulls: {}, lost: {} }, lostLog: [],
  };
  const bump = (bucket, key) => { bucket[key] = (bucket[key] || 0) + 1; };
  const classify = (scope) => {
    if (!scope) return "no-scope";
    if (scope.closest(".canvas-node")) return "canvas";
    if (scope.closest(".hover-popover")) return "hover-popover";
    if (scope.closest(".markdown-embed, .internal-embed")) return "embed";
    const source = scope.closest(".markdown-source-view");
    if (scope.classList.contains("cm-editor") && source && !source.classList.contains("is-live-preview")) return "source-mode";
    return "slot-missing";
  };
  const makeCard = (path, leafId) => {
    const card = document.createElement("div");
    card.className = "bob-property-card bob-title-slot-probe";
    card.setAttribute("data-path", path);
    card.setAttribute("data-leaf-id", leafId);
    card.style.height = state.height + "px";
    const label = document.createElement("div");
    label.className = "bob-title-slot-probe-label";
    label.textContent = "Title-slot probe card · " + path;
    card.appendChild(label);
    return card;
  };
  const release = (scope) => {
    const entry = state.mounts.get(scope);
    if (!entry) return;
    state.mounts.delete(scope);
    try { entry.release(); } catch (_) {}
    state.counts.released += 1;
  };
  const mount = (helpers, leaf, view, scope, mode, path, reuse) => {
    state.counts.mountCalls += 1;
    const node = reuse ? reuse.node : makeCard(path, leaf.id);
    const entry = { node, path, mode, leafId: leaf.id, helpers, release: null, opts: null };
    const opts = reuse ? reuse.opts : {
      path, kind: "probe",
      currentPath: () => (view.file ? view.file.path : ""),
      onLost: (reason) => {
        bump(state.counts.lost, reason);
        state.lostLog.push({ reason, path, mode, leafId: leaf.id, at: Date.now() });
        const current = state.mounts.get(scope);
        if (current && current.node === node) state.mounts.delete(scope);
        if (state.running && !state.paused) schedule();
      },
    };
    if (!reuse && state.measured) opts.view = mode === "live" ? view.editor.cm : view.previewMode.renderer;
    const handle = helpers.propertyCardMountInTitleSlot(scope, node, opts);
    if (!handle) { bump(state.counts.nulls, classify(scope)); return null; }
    entry.release = handle;
    entry.opts = opts;
    state.mounts.set(scope, entry);
    state.counts.mounted += 1;
    return entry;
  };
  const refresh = (options = {}) => {
    const helpers = slotHelpers();
    state.counts.refreshes += 1;
    if (!helpers) return { helpers: false, mounts: state.mounts.size };
    const seen = new Set();
    for (const leaf of app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      const path = view && view.file ? view.file.path : "";
      const mode = modeOf(view);
      const live = liveScopeOf(view);
      const reading = readingScopeOf(view);
      const want = mode === "reading" ? reading : live;
      for (const scope of [live, reading]) {
        if (!scope) continue;
        seen.add(scope);
        const show = Boolean(path) && scope === want && shown(scope);
        const current = state.mounts.get(scope);
        if (current && (!show || current.path !== path || current.helpers !== helpers)) release(scope);
        if (!show) continue;
        const still = state.mounts.get(scope);
        if (still && helpers.propertyCardTitleSlotMountedNode(scope) === still.node) {
          if (options.force) mount(helpers, leaf, view, scope, mode, path, still);
          continue;
        }
        if (still) state.mounts.delete(scope);
        mount(helpers, leaf, view, scope, mode, path, null);
      }
    }
    for (const scope of Array.from(state.mounts.keys())) if (!seen.has(scope)) release(scope);
    return { helpers: true, mounts: state.mounts.size };
  };
  const schedule = () => {
    if (!state.running || state.paused) return;
    refresh();
    for (const ms of [80, 300]) {
      state.timers.push(setTimeout(() => { if (state.running && !state.paused) refresh(); }, ms));
    }
  };
  const on = (target, name) => state.refs.push([target, target.on(name, schedule)]);
  const api = {
    modeOf, readingScopeOf, liveScopeOf,
    start(height) {
      if (state.running) return api.stats();
      if (Number.isFinite(height)) state.height = height;
      state.running = true;
      state.paused = false;
      on(app.workspace, "layout-change");
      on(app.workspace, "file-open");
      on(app.workspace, "active-leaf-change");
      on(app.metadataCache, "changed");
      refresh();
      return api.stats();
    },
    stop() {
      for (const [target, ref] of state.refs) { try { target.offref(ref); } catch (_) {} }
      state.refs = [];
      for (const timer of state.timers) clearTimeout(timer);
      state.timers = [];
      for (const scope of Array.from(state.mounts.keys())) release(scope);
      state.running = false;
      return api.stats();
    },
    pause() { state.paused = true; return true; },
    resume() { state.paused = false; refresh(); return true; },
    refresh(options) { return refresh(options || {}); },
    // What a host does after a render or mode switch: refresh unless paused.
    nudge() { schedule(); return !state.paused && state.running; },
    // Re-mount one leaf's current node with its own options and nothing else,
    // so the primitive's own pruning is observable.
    remount(leafId) {
      const helpers = slotHelpers();
      for (const [scope, entry] of state.mounts) {
        if (entry.leafId !== leafId || !helpers) continue;
        const leaf = app.workspace.getLeafById(leafId);
        return Boolean(mount(helpers, leaf, leaf.view, scope, entry.mode, entry.path, entry));
      }
      return false;
    },
    setHeight(px) {
      state.height = px;
      for (const entry of state.mounts.values()) entry.node.style.height = px + "px";
      return state.mounts.size;
    },
    setMeasured(value) { state.measured = Boolean(value); return state.measured; },
    tryDenied() {
      const helpers = slotHelpers();
      if (!helpers) return { helpers: false, attempts: 0, rows: [] };
      const scopes = Array.from(document.querySelectorAll(".cm-editor, .markdown-preview-view")).filter((node) => node.closest(BOUNDARY));
      const rows = scopes.map((scope) => {
        const node = document.createElement("div");
        node.className = "bob-title-slot-denied-probe";
        let handle = null;
        let error = null;
        try { handle = helpers.propertyCardMountInTitleSlot(scope, node, { path: "denied.md", kind: "probe" }); }
        catch (caught) { error = String(caught && caught.message || caught); }
        const mounted = Boolean(handle) || node.isConnected;
        if (handle) { try { handle(); } catch (_) {} }
        if (node.isConnected) node.remove();
        return {
          kind: classify(scope), scope: scope.classList.contains("cm-editor") ? "cm-editor" : "markdown-preview-view",
          returnedNull: !handle, mounted, error,
        };
      });
      return { helpers: true, attempts: rows.length, rows, slotNodesInBoundaries: document.querySelectorAll(
        ".markdown-embed .bob-title-slot-probe, .internal-embed .bob-title-slot-probe, .hover-popover .bob-title-slot-probe, .canvas-node .bob-title-slot-probe, .markdown-embed .bob-property-card-title-slot, .hover-popover .bob-property-card-title-slot, .canvas-node .bob-property-card-title-slot").length };
    },
    stats() {
      const helpers = slotHelpers();
      const mounts = Array.from(state.mounts.entries()).map(([scope, entry]) => ({
        leafId: entry.leafId, path: entry.path, mode: entry.mode,
        slot: helpers ? helpers.propertyCardTitleSlotStats(scope) : null,
      }));
      return {
        running: state.running, paused: state.paused, height: state.height, measured: state.measured,
        counts: JSON.parse(JSON.stringify(state.counts)), lostLog: state.lostLog.slice(-40), mounts,
        readingScopeShape, helpers: Boolean(helpers),
      };
    },
  };
  window.__bobTitleSlotSpike = api;
  return true;
})()`;

// window.__bobTitleSlotProbe: DOM measurements for one leaf, the document,
// and the editor geometry the tall-card checks need.
const PROBE_SOURCE = "(() => {" + PAGE_COMMON + String.raw`
  const rectOf = (node) => {
    if (!node) return { present: false, visible: false };
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return {
      present: true, visible: style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0,
      top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height,
      clientWidth: node.clientWidth, scrollWidth: node.scrollWidth,
      className: String(node.className || "").slice(0, 160),
    };
  };
  const follows = (a, b) => Boolean(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING));
  const leafOf = (leafId) => app.workspace.getLeafById(leafId);
  const parts = (view) => {
    const mode = modeOf(view);
    const live = liveScopeOf(view);
    const reading = readingScopeOf(view);
    if (mode === "reading") {
      const sizer = child(reading, "markdown-preview-sizer");
      const header = child(sizer, "mod-header");
      let content = header ? header.nextElementSibling : null;
      for (let node = content; node; node = node.nextElementSibling) {
        if (node.getBoundingClientRect().height > 0) { content = node; break; }
      }
      return { mode, scope: reading, other: live, parent: header, sizer, scroller: reading,
        title: child(header, "inline-title"), properties: child(header, "metadata-container"), content };
    }
    const scroller = child(live, "cm-scroller");
    const sizer = child(scroller, "cm-sizer");
    return { mode, scope: live, other: reading, parent: sizer, sizer, scroller,
      title: child(sizer, "inline-title"), properties: child(sizer, "metadata-container"), content: child(sizer, "cm-contentContainer") };
  };
  const leaf = (leafId) => {
    const view = leafOf(leafId) ? leafOf(leafId).view : null;
    if (!view || !view.file) return { status: "missing-view", leafId };
    const p = parts(view);
    const probes = Array.from(view.containerEl.querySelectorAll(".bob-title-slot-probe")).filter((node) => !node.closest(BOUNDARY));
    const card = probes.find((node) => p.scope && p.scope.contains(node)) || null;
    const helpers = slotHelpers();
    return {
      status: "ok", leafId, path: view.file.path, mode: p.mode, readingScopeShape,
      title: rectOf(p.title), properties: rectOf(p.properties), content: rectOf(p.content), card: rectOf(card),
      cardPath: card ? card.getAttribute("data-path") : null,
      parentKind: card && card.parentElement ? (card.parentElement.classList.contains("cm-sizer") ? "cm-sizer"
        : card.parentElement.classList.contains("mod-header") ? "mod-header" : String(card.parentElement.className).slice(0, 80)) : null,
      order: { titleBeforeCard: follows(p.title, card), cardBeforeProperties: follows(card, p.properties), cardBeforeContent: follows(card, p.content) },
      column: rectOf(p.parent), scroller: rectOf(p.scroller), viewport: { width: innerWidth, height: innerHeight },
      probesInLeaf: probes.length, visibleProbesInLeaf: probes.filter(shown).length,
      probePaths: probes.map((node) => node.getAttribute("data-path")),
      hiddenScopeProbes: p.other ? p.other.querySelectorAll(".bob-title-slot-probe").length : 0,
      parentChildren: p.parent ? Array.from(p.parent.children).map((node) => String(node.className).split(" ")[0]) : [],
      slot: helpers && p.scope ? helpers.propertyCardTitleSlotStats(p.scope) : null,
      frontmatterLines: p.mode === "reading" ? 0 : p.scope.querySelectorAll(".cm-line.HyperMD-frontmatter, .cm-hmd-frontmatter").length,
      settings: {
        propertiesInDocument: app.vault.getConfig("propertiesInDocument"), showInlineTitle: app.vault.getConfig("showInlineTitle"),
        readableLineLength: app.vault.getConfig("readableLineLength"), theme: document.body.classList.contains("theme-dark") ? "dark" : "light",
      },
    };
  };
  const doc = () => {
    const probes = Array.from(document.querySelectorAll(".bob-title-slot-probe"));
    const slotParent = (node) => node.parentElement && (node.parentElement.classList.contains("cm-sizer") || node.parentElement.classList.contains("mod-header"));
    const helpers = slotHelpers();
    return {
      slotNodes: document.querySelectorAll(".bob-property-card-title-slot").length, probeNodes: probes.length,
      orphans: probes.filter((node) => node.isConnected && !slotParent(node)).length,
      inBoundary: probes.filter((node) => node.closest(BOUNDARY)).length,
      leafIds: probes.map((node) => node.getAttribute("data-leaf-id")),
      liveCount: helpers ? helpers.propertyCardTitleSlotLiveCount() : null, helpers: Boolean(helpers),
      markdownLeaves: app.workspace.getLeavesOfType("markdown").length,
    };
  };
  const cmOf = (leafId) => leafOf(leafId).view.editor.cm;
  const lineOf = (leafId, text) => {
    const docText = cmOf(leafId).state.doc;
    for (let i = 1; i <= docText.lines; i += 1) if (docText.line(i).text === text) return i - 1;
    return -1;
  };
  const scrollLine = (leafId, line, y) => {
    const cm = cmOf(leafId);
    cm.dispatch({ effects: cm.constructor.scrollIntoView(cm.state.doc.line(line + 1).from, { y: y || "center" }) });
    return true;
  };
  const lineGeometry = (leafId, line) => {
    const cm = cmOf(leafId);
    const pos = cm.state.doc.line(line + 1).from;
    const at = cm.domAtPos(pos);
    const base = at && at.node ? (at.node.nodeType === 3 ? at.node.parentElement : at.node) : null;
    const lineEl = base && base.closest ? base.closest(".cm-line") : null;
    const rect = lineEl ? lineEl.getBoundingClientRect() : null;
    const coords = cm.coordsAtPos(pos);
    const scroller = cm.scrollDOM.getBoundingClientRect();
    return {
      line, text: lineEl ? lineEl.textContent : null, expected: cm.state.doc.line(line + 1).text,
      lineTop: rect ? rect.top : null, lineBottom: rect ? rect.bottom : null, lineLeft: rect ? rect.left : null,
      coordsTop: coords ? coords.top : null, blockTop: cm.lineBlockAt(pos).top + cm.documentTop,
      scrollerTop: scroller.top, scrollerBottom: scroller.bottom,
    };
  };
  const cursor = (leafId) => leafOf(leafId).view.editor.getCursor();
  const lineCount = (leafId) => cmOf(leafId).state.doc.lines;
  const posVisible = (leafId, which) => {
    const cm = cmOf(leafId);
    const pos = which === "end" ? cm.state.doc.length : 0;
    const coords = cm.coordsAtPos(pos);
    const scroller = cm.scrollDOM.getBoundingClientRect();
    const content = cm.contentDOM.getBoundingClientRect();
    const card = cm.dom.querySelector(".bob-title-slot-probe");
    const cardRect = card ? card.getBoundingClientRect() : null;
    return {
      coordsTop: coords ? coords.top : null, coordsBottom: coords ? coords.bottom : null,
      coordsVisible: Boolean(coords && coords.top >= scroller.top - 2 && coords.bottom <= scroller.bottom + 2),
      contentTopVisible: content.top >= scroller.top - 2 && content.top < scroller.bottom,
      scrollTop: cm.scrollDOM.scrollTop, cardTopVisible: Boolean(cardRect && cardRect.top >= scroller.top - 2 && cardRect.top < scroller.bottom),
    };
  };
  // First fully visible numbered body line in the leaf's active scroller.
  const topVisibleLine = (leafId) => {
    const view = leafOf(leafId).view;
    const p = parts(view);
    const top = p.scroller.getBoundingClientRect().top;
    const nodes = p.mode === "reading" ? p.scope.querySelectorAll("li") : p.scope.querySelectorAll(".cm-content .cm-line");
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      if (rect.height <= 0 || rect.top < top - 2) continue;
      const match = /Line (\d+) alpha/.exec(node.textContent || "");
      if (match) return { line: Number(match[1]), offset: rect.top - top, scrollTop: p.scroller.scrollTop };
    }
    return { line: null, scrollTop: p.scroller.scrollTop };
  };
  const headingOffset = (leafId, text) => {
    const view = leafOf(leafId).view;
    const p = parts(view);
    const box = p.scroller.getBoundingClientRect();
    const nodes = p.mode === "reading" ? p.scope.querySelectorAll("h2") : p.scope.querySelectorAll(".cm-content .cm-line");
    const node = Array.from(nodes).find((item) => (item.textContent || "").replace(/^#+\s*/, "").trim() === text);
    if (!node) return { found: false, scrollTop: p.scroller.scrollTop };
    const rect = node.getBoundingClientRect();
    return {
      found: true, offset: rect.top - box.top, height: rect.height, scrollTop: p.scroller.scrollTop,
      inViewport: rect.top >= box.top - 2 && rect.bottom <= box.bottom + 2,
    };
  };
  window.__bobTitleSlotProbe = { leaf, doc, lineOf, scrollLine, lineGeometry, cursor, lineCount, posVisible, topVisibleLine, headingOffset };
  return true;
})()`;

// ---- Placement rules (applied to one leaf probe) ----

const PX = 2;

function placementFailures(probe) {
  const failures = [];
  if (!probe || probe.status !== "ok") return ["leaf probe unavailable: " + JSON.stringify(probe).slice(0, 200)];
  const live = probe.mode === "live";
  if (probe.mode !== "live" && probe.mode !== "reading") return ["unexpected mode " + probe.mode];
  const card = probe.card || {};
  if (!card.present) return ["no probe card in the leaf's active scope"];
  if (probe.parentKind !== (live ? "cm-sizer" : "mod-header")) failures.push("card parent is " + probe.parentKind);
  if (probe.title?.present && !probe.order?.titleBeforeCard) failures.push("card precedes the inline title");
  if (probe.properties?.present && !probe.order?.cardBeforeProperties) failures.push("card follows Properties");
  if (probe.content?.present && !probe.order?.cardBeforeContent) failures.push("card follows the content");
  if (probe.title?.visible && card.top < probe.title.bottom - PX) failures.push("card top " + card.top + " above title bottom " + probe.title.bottom);
  if (probe.properties?.visible && card.bottom > probe.properties.top + PX) failures.push("card bottom " + card.bottom + " below Properties top " + probe.properties.top);
  if (probe.content?.visible && card.bottom > probe.content.top + PX) failures.push("card bottom " + card.bottom + " below content top " + probe.content.top);
  if (card.scrollWidth > card.clientWidth + 1) failures.push("card overflows horizontally");
  if (probe.column?.present && (card.left < probe.column.left - PX || card.right > probe.column.right + PX)) failures.push("card leaves its column");
  if (probe.viewport && card.right > probe.viewport.width + PX) failures.push("card leaves the viewport");
  const reference = probe.title?.visible ? probe.title : probe.properties?.visible ? probe.properties : null;
  if (reference && card.width < 0.9 * reference.width) failures.push("card width " + card.width + " < 90% of " + reference.width);
  if (probe.probesInLeaf !== 1) failures.push("leaf has " + probe.probesInLeaf + " probes");
  if (probe.cardPath !== probe.path) failures.push("card path " + probe.cardPath + " != " + probe.path);
  if (probe.hiddenScopeProbes !== 0) failures.push("a probe sits in the hidden mode's scope");
  return failures;
}

function placementSummary(probe) {
  const pick = (rect) => (rect && rect.present ? { visible: rect.visible, top: round(rect.top), bottom: round(rect.bottom), width: round(rect.width) } : { present: false });
  return {
    path: probe?.path, mode: probe?.mode, parent: probe?.parentKind, title: pick(probe?.title), card: pick(probe?.card),
    properties: pick(probe?.properties), content: pick(probe?.content), children: probe?.parentChildren, reinserts: probe?.slot?.reinserts ?? null,
  };
}

function round(value) { return typeof value === "number" ? Math.round(value * 10) / 10 : value; }

// ---- Verdict ----

function computeVerdict(report) {
  const rows = Array.isArray(report?.checks) ? report.checks : [];
  const status = new Map();
  for (const row of rows) {
    if (row.mandatory === false) continue;
    const ok = row.status === "pass";
    status.set(row.name, status.has(row.name) ? status.get(row.name) && ok : ok);
  }
  const surfaces = {};
  for (const name of ["live", "reading", "both"]) surfaces[name] = { pass: 0, total: 0, failed: [] };
  const missing = [];
  for (const { name, surface } of REQUIRED_CHECKS) {
    const bucket = surfaces[surface];
    bucket.total += 1;
    if (!status.has(name)) { missing.push(name); bucket.failed.push(name); continue; }
    if (status.get(name)) bucket.pass += 1;
    else bucket.failed.push(name);
  }
  const clean = (name) => surfaces[name].failed.length === 0;
  let verdict = "NO-GO";
  let fallback = ["live", "reading"];
  if (clean("both") && clean("live") && clean("reading")) { verdict = "GO"; fallback = []; }
  else if (clean("both") && clean("reading")) { verdict = "GO (reading only; live preview falls back to body)"; fallback = ["live"]; }
  else if (clean("both") && clean("live")) { verdict = "GO (live preview only; reading falls back to body)"; fallback = ["reading"]; }
  return { verdict, go: verdict !== "NO-GO", partial: fallback.length === 1, fallback, surfaces, missing };
}

function passingReport() {
  return { checks: REQUIRED_CHECKS.map(({ name, surface }) => ({ name, surface, status: "pass", mandatory: true })) };
}

// ---- Self-test ----

function syntheticProbe(mode, overrides = {}) {
  const live = mode === "live";
  const base = {
    status: "ok", leafId: "a", path: "alpha.md", mode, readingScopeShape: "child-of-containerEl",
    title: { present: true, visible: true, top: 60, bottom: 110, left: 100, right: 800, width: 700 },
    card: { present: true, visible: true, top: 120, bottom: 240, left: 100, right: 800, width: 700, clientWidth: 700, scrollWidth: 700 },
    properties: { present: true, visible: true, top: 250, bottom: 400, left: 100, right: 800, width: 700 },
    content: { present: true, visible: true, top: 410, bottom: 3000, left: 100, right: 800, width: 700 },
    cardPath: "alpha.md", parentKind: live ? "cm-sizer" : "mod-header",
    order: { titleBeforeCard: true, cardBeforeProperties: true, cardBeforeContent: true },
    column: { present: true, visible: true, top: 0, bottom: 3000, left: 100, right: 800, width: 700 },
    viewport: { width: 1400, height: 1000 }, probesInLeaf: 1, visibleProbesInLeaf: 1, hiddenScopeProbes: 0,
  };
  return { ...base, ...overrides };
}

function selfTest() {
  const notes = fixtureNotes();
  assert.deepEqual(Object.keys(notes).sort(), ["alpha.md", "beta.md", "board.canvas", "embedder.md", "nofm.md"]);
  const alpha = notes["alpha.md"];
  assert.equal(alpha.split("\n").filter((line) => /^- Line \d{3} alpha$/.test(line)).length, BODY_LINES);
  for (let n = 1; n <= 8; n += 1) assert.ok(alpha.includes("\n## Section " + pad(n, 2) + "\n"), "section " + n);
  assert.ok(!alpha.includes("## Section 09"));
  assert.equal(alpha.split("\n---\n")[0].split("\n").filter((line) => /^[a-z]+:/.test(line)).length, 5, "five frontmatter keys");
  assert.ok(notes["embedder.md"].includes("![[alpha]]") && notes["embedder.md"].includes("[[alpha]] for the hover"));
  assert.ok(!notes["nofm.md"].startsWith("---"));
  assert.equal(JSON.parse(notes["board.canvas"]).nodes[0].file, "alpha.md");
  const matrix = settingsMatrix();
  assert.equal(matrix.length, 24);
  assert.equal(new Set(matrix.map(comboKey)).size, 24);
  for (const surface of ["live", "reading"]) for (const key of MATRIX_SHOTS[surface]) assert.ok(matrix.some((combo) => comboKey(combo) === key), key);
  // Placement rules.
  assert.deepEqual(placementFailures(syntheticProbe("live")), []);
  assert.deepEqual(placementFailures(syntheticProbe("reading", { properties: { present: false, visible: false }, order: { titleBeforeCard: true, cardBeforeProperties: false, cardBeforeContent: true } })), []);
  assert.match(placementFailures(syntheticProbe("live", { parentKind: "cm-content" })).join(), /parent/);
  assert.match(placementFailures(syntheticProbe("live", { order: { titleBeforeCard: false, cardBeforeProperties: true, cardBeforeContent: true } })).join(), /inline title/);
  assert.match(placementFailures(syntheticProbe("live", { card: { ...syntheticProbe("live").card, bottom: 300 } })).join(), /below Properties/);
  assert.match(placementFailures(syntheticProbe("reading", { card: { ...syntheticProbe("live").card, width: 400 } })).join(), /90%/);
  assert.match(placementFailures(syntheticProbe("live", { card: { ...syntheticProbe("live").card, scrollWidth: 900 } })).join(), /overflows/);
  assert.match(placementFailures(syntheticProbe("live", { probesInLeaf: 2 })).join(), /2 probes/);
  assert.match(placementFailures(syntheticProbe("live", { cardPath: "beta.md" })).join(), /card path/);
  assert.match(placementFailures(syntheticProbe("live", { hiddenScopeProbes: 1 })).join(), /hidden mode/);
  assert.match(placementFailures(syntheticProbe("live", { card: { present: false } })).join(), /no probe card/);
  assert.match(placementFailures(syntheticProbe("source")).join(), /unexpected mode/);
  // Verdict.
  assert.equal(computeVerdict(passingReport()).verdict, "GO");
  const readingOnly = passingReport();
  for (const row of readingOnly.checks) if (row.surface === "live") row.status = "fail";
  assert.equal(computeVerdict(readingOnly).verdict, "GO (reading only; live preview falls back to body)");
  assert.equal(new Set(REQUIRED_CHECKS.map((row) => row.name)).size, REQUIRED_CHECKS.length, "required checks are unique");
  assert.ok(["live", "reading", "both"].every((surface) => REQUIRED_CHECKS.some((row) => row.surface === surface)));
  const parsed = parseArgs(["-e", "/opt/obsidian", "-o", "/tmp/shots", "-r", "/tmp/report.json", "--self-test"]);
  assert.ok(parsed.selfTest && parsed.executable === "/opt/obsidian" && parsed.out === "/tmp/shots" && parsed.report === "/tmp/report.json");
  assert.throws(() => parseArgs(["--out"]), /requires/);
  assert.throws(() => parseArgs(["--bogus"]), /Unknown/);
  return true;
}

module.exports = {
  HELP_TEXT, REQUIRED_CHECKS, MATRIX_SHOTS, ADAPTER_SOURCE, PROBE_SOURCE, BODY_LINES,
  bodyLineText, comboKey, computeVerdict, fixtureNotes, parseArgs, passingReport, placementFailures,
  placementSummary, round, selfTest, settingsMatrix, surfaceOf, syntheticProbe,
};
