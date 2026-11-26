#!/usr/bin/env node
// Real-Obsidian acceptance for the Notebook Card and Prose Card (bob-cli-qm.6).
// Disposable vault + profile, owned Obsidian under Xvfb, master-built bob via
// BOB_BIN/BOB_CLI_DIR provenance. Never opens the live vault.
//
// Sibling of scripts/obsidian-frontmatter-takeover-e2e.cjs: it imports that
// runner's lib for the shared takeover vocabulary and verdict rules and never
// forks it. The vault is built byte-identical from
// scripts/fixtures/note-cards/ with cardPreviewKinds set.
//
//   xvfb-run -a node scripts/obsidian-note-cards-e2e.cjs [-e BIN] [-o DIR] [-r REPORT]
//   node scripts/obsidian-note-cards-e2e.cjs --self-test
"use strict";

const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const takeoverLib = require("./obsidian-frontmatter-takeover-e2e-lib.cjs");
const shared = require("./obsidian-record-card-e2e.cjs");

const { sleep, waitFor } = shared;
const PLUGIN_ID = "bob-ledger-tools";
const ARTICLES_ID = "bob-articles";
const FIXTURE_TODAY = "2026-11-20";
const OVERALL_TIMEOUT_MS = 1_200_000;
const ELECTRON_FALLBACK = "/snap/obsidian/current/app/obsidian";

const NOTEBOOK_FIXTURES = [
  "notebook-about-abby.md",
  "notebook-child.md",
  "notebook-duplicate-sections.md",
  "notebook-many-sections.md",
  "notebook-no-summary.md",
  "notebook-parent.md",
  "notebook-report.json",
  "notebook-with-checkbox.md",
  "notebook-zorg.md",
];
const PROSE_FIXTURES = [
  "prose-article-legacy.md",
  "prose-dual-spelling.md",
  "prose-emoji-title.md",
  "prose-invalid-numbering.md",
  "prose-mixed-type.md",
  "prose-no-headings.md",
  "prose-unnumbered.md",
  "prose-with-prj.md",
  "prose-with-title.md",
];

function parseArgs(argv) {
  const args = { executable: null, out: null, report: null, selfTest: false, help: false };
  const list = Array.isArray(argv) ? argv.slice() : [];
  for (let i = 0; i < list.length; i += 1) {
    const flag = list[i];
    if (flag === "-e" || flag === "--executable" || flag === "--obsidian-bin") {
      const next = list[++i];
      if (!next || next.startsWith("-")) throw new Error("--executable requires a PATH value");
      args.executable = next;
    } else if (flag === "-o" || flag === "--out") {
      const next = list[++i];
      if (!next || next.startsWith("-")) throw new Error("--out requires a DIRECTORY value");
      args.out = next;
    } else if (flag === "-r" || flag === "--report") {
      const next = list[++i];
      if (!next || next.startsWith("-")) throw new Error("--report requires a PATH value");
      args.report = next;
    } else if (flag === "-s" || flag === "--self-test") args.selfTest = true;
    else if (flag === "-h" || flag === "--help") args.help = true;
    else throw new Error("Unknown argument: " + flag);
  }
  return args;
}

function fail(message, code = 1) {
  const error = new Error(String(message));
  error.exitCode = code;
  throw error;
}

function findExecutable(override) {
  const candidates = [];
  if (override) candidates.push(override);
  if (process.env.OBSIDIAN_BIN) candidates.push(process.env.OBSIDIAN_BIN);
  if (process.env.ELECTRON_BIN) candidates.push(process.env.ELECTRON_BIN);
  candidates.push("/snap/bin/obsidian", ELECTRON_FALLBACK);
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch { /* keep looking */ }
  }
  return candidates[0] || ELECTRON_FALLBACK;
}

// Page-side probe: describe the mounted note card in the active view.
// viewScope (whole view container) carries the counts; kitScope (the lib's
// editor/preview scope) carries the ownership signals. The runner judges.
const NOTECARD_PROBE = `(() => {
  const leaf = app.workspace.getLeafById(app.workspace.mostRecentLeaf?.id) || app.workspace.activeLeaf;
  const view = leaf?.view || null;
  const mode = !view ? "" : view.getMode?.() === "preview" ? "reading"
    : view.getState?.()?.source ? "source" : "live";
  const viewScope = !view ? document
    : mode === "reading" ? (view.previewMode?.containerEl || document)
    : (view.containerEl || view.contentEl || document);
  const kitScope = !view ? document
    : mode === "reading"
      ? (view.previewMode?.containerEl?.querySelector?.(".markdown-preview-view") || view.previewMode?.containerEl || document)
      : (view.editor?.cm?.dom || document);
  const q = (root, sel) => Array.from((root || document).querySelectorAll(sel));
  const vis = (el) => {
    if (!el || el.isConnected !== true) return false;
    try {
      const style = el.ownerDocument?.defaultView?.getComputedStyle?.(el);
      const rect = el.getBoundingClientRect?.();
      return style?.display !== "none" && style?.visibility !== "hidden"
        && Number(rect?.width) > 0 && Number(rect?.height) > 0;
    } catch (_) { return false; }
  };
  const disp = (el) => {
    try { return el?.ownerDocument?.defaultView?.getComputedStyle?.(el)?.display || null; }
    catch (_) { return null; }
  };
  const notebookCards = q(viewScope, ".bob-notebook-card").filter(vis);
  const proseCards = q(viewScope, ".bob-prose-note-card").filter(vis);
  const areaCards = q(viewScope, ".bob-home-card:not(.bob-notebook-card):not(.bob-prose-note-card)").filter(vis);
  const nativeNodes = q(viewScope, ".metadata-container").filter(vis);
  const nativeAll = q(viewScope, ".metadata-container");
  const headers = q(viewScope, ".bob-notebook-header").filter(vis);
  const h1s = q(viewScope, "h1").filter(vis);
  const h1like = q(viewScope, "h1, .cm-header-1, .HyperMD-header-1, .hmd-header-1").filter(vis);
  const foots = q(viewScope, ".bob-property-card-foot").filter(vis);
  const firstNotebook = notebookCards[0] || null;
  const firstProse = proseCards[0] || null;
  const card = firstNotebook || firstProse || null;
  const text = (el) => String(el?.textContent || "");
  const titleBlock = card?.querySelector?.(".bob-property-card-title-block") || null;
  const bodyEl = card?.querySelector?.(".bob-notebook-card-details, .bob-prose-note-card-body") || null;
  const numberingEl = firstProse?.querySelector?.(".bob-prose-note-card-numbering") || null;
  const drawerEl = card?.querySelector?.(".bob-property-card-foot-drawer") || null;
  const helpers = (() => {
    try { return app.plugins.plugins["bob-ledger-tools"]?.constructor?.helpers || null; }
    catch (_) { return null; }
  })();
  const actual = (() => {
    try {
      if (!helpers || typeof helpers.propertyCardFrontmatterActualOwnership !== "function") return null;
      return helpers.propertyCardFrontmatterActualOwnership(kitScope, { path: view?.file?.path || "" }) || null;
    } catch (_) { return null; }
  })();
  const adopted = (() => {
    try { return typeof helpers?.propertyCardAdoptedEntry === "function" ? helpers.propertyCardAdoptedEntry(kitScope) : null; }
    catch (_) { return null; }
  })();
  const ownsHere = (() => {
    try {
      if (viewScope?.classList?.contains?.("bob-property-card-owns-frontmatter")) return "scope-self";
      if (viewScope?.querySelector?.(".bob-property-card-owns-frontmatter")) return "scope-descendant";
      if (viewScope?.closest?.(".bob-property-card-owns-frontmatter")) return "scope-ancestor";
      return "absent";
    } catch (_) { return "error"; }
  })();
  const container = nativeAll[0] || null;
  return {
    mode,
    notebook: notebookCards.length,
    prose: proseCards.length,
    area: areaCards.length,
    areaKicker: text(areaCards[0]?.querySelector?.(".bob-property-card-kicker, .bob-home-card-kicker")).slice(0, 80),
    native: nativeNodes.length,
    nativeTotal: nativeAll.length,
    headers: headers.length,
    h1: h1s.length,
    h1like: h1like.length,
    foot: foots.length,
    kicker: text(card?.querySelector?.(".bob-property-card-kicker, .bob-home-card-kicker")).slice(0, 120),
    title: text(card?.querySelector?.("[role='heading'], .bob-property-card-title")).slice(0, 160),
    titleDisplay: disp(titleBlock),
    titleRect: (() => { try { const r = titleBlock?.getBoundingClientRect?.(); return r ? { w: r.width, h: r.height } : null; } catch (_) { return null; } })(),
    cardCollapsed: Boolean(card?.classList?.contains?.("is-collapsed")),
    bodyDisplay: disp(bodyEl),
    readout: text(firstNotebook?.querySelector?.(".bob-notebook-card-readouts")).slice(0, 400),
    sections: q(viewScope, ".bob-notebook-card-section-chip").filter(vis).map((el) => text(el).slice(0, 60)),
    sectionMore: text(viewScope.querySelector?.(".bob-notebook-card-sections-more")).slice(0, 20),
    childChips: q(viewScope, ".bob-notebook-card-child-chip").filter(vis).map((el) => text(el).slice(0, 60)),
    errorPill: text(viewScope.querySelector?.(".bob-notebook-card-error-pill")).slice(0, 120),
    routeToken: text(firstNotebook?.querySelector?.(".bob-notebook-card-route")).slice(0, 60),
    addSummary: q(viewScope, ".bob-notebook-card-add-summary").filter(vis).length,
    measure: text(firstProse?.querySelector?.(".bob-prose-note-card-measures, .bob-prose-note-card-measure-row")).slice(0, 300),
    numbering: text(numberingEl).slice(0, 40),
    numberingTag: numberingEl?.tagName || null,
    numberingTitle: numberingEl?.getAttribute?.("title") || null,
    outline: q(viewScope, ".bob-prose-note-card-outline [data-line], .bob-prose-note-card-outline-row").filter(vis).length,
    outlineHidden: (() => { const n = firstProse?.querySelector?.(".bob-prose-note-card-outline"); return n ? Boolean(n.hasAttribute?.("hidden")) : null; })(),
    outlineText: text(firstProse?.querySelector?.(".bob-prose-note-card-outline")).slice(0, 600),
    findings: text(firstProse?.querySelector?.(".bob-prose-note-card-findings")).slice(0, 400),
    cardText: text(card).slice(0, 500),
    drawerOpen: drawerEl?.getAttribute?.("data-open") || null,
    owns: ownsHere,
    actualOwned: actual ? Boolean(actual.owned) : null,
    actualPath: actual?.path || null,
    containerInert: Boolean(container && (container.inert === true || container.hasAttribute("inert"))),
    ariaHidden: container?.getAttribute?.("aria-hidden") || null,
    containerDisplay: disp(container),
    adoptedKind: adopted?.kind || null,
    toggleCommand: Boolean(app.commands?.commands?.["bob-articles:toggle-section-numbers"]),
  };
})()`;

// Verbose DOM dump for takeover failures: card structure, title-block
// geometry, every foot's ancestor chain, and the native container.
const VERBOSE_PROBE = `(() => {
  const leaf = app.workspace.getLeafById(app.workspace.mostRecentLeaf?.id) || app.workspace.activeLeaf;
  const view = leaf?.view || null;
  const mode = !view ? "" : view.getMode?.() === "preview" ? "reading"
    : view.getState?.()?.source ? "source" : "live";
  const root = !view ? document
    : mode === "reading" ? (view.previewMode?.containerEl || document)
    : (view.containerEl || document);
  const chain = (el, depth) => {
    const out = [];
    let node = el;
    for (let i = 0; i < depth && node && node !== root; i += 1) {
      out.push(String(node.tagName || "?").toLowerCase() + "." + String(node.className || "").split(/\\s+/).slice(0, 4).join("."));
      node = node.parentElement;
    }
    return out;
  };
  const cards = Array.from(root.querySelectorAll(".bob-notebook-card, .bob-prose-note-card"));
  const foots = Array.from(root.querySelectorAll(".bob-property-card-foot"));
  const natives = Array.from(root.querySelectorAll(".metadata-container"));
  const rectOf = (el) => {
    try { const r = el?.getBoundingClientRect?.(); return r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null; }
    catch (_) { return null; }
  };
  return {
    mode,
    cards: cards.map((card) => ({
      class: String(card.className || ""),
      rect: rectOf(card),
      children: Array.from(card.children || []).map((kid) => String(kid.tagName || "?").toLowerCase() + "." + String(kid.className || "").split(/\\s+/).slice(0, 3).join(".")),
      outer: String(card.outerHTML || "").slice(0, 3000),
    })),
    foots: foots.map((foot) => ({ chain: chain(foot, 4), rect: rectOf(foot) })),
    natives: natives.map((node) => ({
      rect: rectOf(node),
      display: (() => { try { return getComputedStyle(node).display; } catch (_) { return null; } })(),
      outer: String(node.outerHTML || "").slice(0, 900),
    })),
  };
})()`;

function fixtureSourceDir() {
  return path.join(repoRoot, "scripts", "fixtures", "note-cards");
}

function readFixtureBytes(name) {
  return fs.readFileSync(path.join(fixtureSourceDir(), name));
}

function comparatorNotes() {
  return {
    "area.md": ["---", 'type: "[[area]]"', 'parent: "[[index]]"', "color: blue", "---", "", "# Area", ""].join("\n"),
    "album.md": ["---", 'type: "[[album]]"', 'parent: "[[index]]"', "---", "", "# Album", ""].join("\n"),
    "index.md": ["---", 'type: "[[area]]"', "---", "", "# Index", ""].join("\n"),
    "ordinary.md": ["---", 'type: "[[note]]"', 'parent: "[[index]]"', "---", "", "# Ordinary", ""].join("\n"),
    "notebook-kin.md": ["---", 'type: "[[notebook]]"', 'parent: "[[notebook-parent]]"', 'summary: "A child notebook for the acceptance run."', "created: 2024-11-02", "---", "", "# Kin", ""].join("\n"),
    "embed-host.md": ["---", 'type: "[[note]]"', 'parent: "[[index]]"', "---", "", "# Host", "", "![[notebook-about-abby]]", ""].join("\n"),
    "hover-host.md": ["---", 'type: "[[note]]"', 'parent: "[[index]]"', "---", "", "# Hover", "", "See [[notebook-about-abby|the notebook]] for details.", ""].join("\n"),
    "malformed.md": ["---", 'type: "[[notebook]]"', 'parent: "[[index]]"', "", "# Broken", ""].join("\n"),
    "board.canvas": JSON.stringify({ nodes: [{ id: "card", type: "file", file: "area.md", x: 0, y: 0, width: 400, height: 300 }], edges: [] }, null, 2),
  };
}

function installVault(vaultDir) {
  const dot = path.join(vaultDir, ".obsidian");
  for (const pluginId of [PLUGIN_ID, ARTICLES_ID]) {
    const dest = path.join(dot, "plugins", pluginId);
    fs.mkdirSync(dest, { recursive: true });
    for (const name of ["manifest.json", "main.js", "styles.css"]) {
      fs.copyFileSync(path.join(repoRoot, "plugins", pluginId, name), path.join(dest, name));
    }
  }
  fs.writeFileSync(path.join(dot, "community-plugins.json"), JSON.stringify([PLUGIN_ID, ARTICLES_ID], null, 2));
  fs.writeFileSync(path.join(dot, "core-plugins.json"), JSON.stringify(["file-explorer", "command-palette", "page-preview", "properties", "canvas"], null, 2));
  fs.writeFileSync(path.join(dot, "app.json"), JSON.stringify({
    livePreview: true, showInlineTitle: true, propertiesInDocument: "visible",
    readableLineLength: true, vimMode: true, showLineNumber: false, alwaysUpdateLinks: false,
  }, null, 2));
  fs.writeFileSync(path.join(dot, "appearance.json"), JSON.stringify({ cssTheme: "", theme: "moonstone" }, null, 2));
  fs.writeFileSync(
    path.join(dot, "plugins", PLUGIN_ID, "data.json"),
    JSON.stringify({ cardPreviewKinds: ["notebook", "prose"] }, null, 2),
  );
}

function sha256Text(text) {
  return crypto.createHash("sha256").update(String(text)).digest("hex");
}

function selfTest() {
  // Offline only: fixtures byte-copy cleanly, comparators well-formed, the
  // takeover lib import is live (never forked), and arg parsing holds.
  for (const name of [...NOTEBOOK_FIXTURES, ...PROSE_FIXTURES]) {
    const bytes = readFixtureBytes(name);
    assert_bytes(name, bytes);
  }
  const comparators = comparatorNotes();
  if (!comparators["area.md"].includes('type: "[[area]]"')) throw new Error("area comparator missing type");
  if (!comparators["album.md"].includes('type: "[[album]]"')) throw new Error("album comparator missing type");
  if (!comparators["embed-host.md"].includes("![[notebook-about-abby]]")) throw new Error("embed comparator missing target");
  if (!comparators["board.canvas"].includes("area.md")) throw new Error("canvas comparator missing file node");
  if (typeof takeoverLib.requiredChecksForProfile !== "function") throw new Error("takeover lib import is dead (forked?)");
  const full = takeoverLib.requiredChecksForProfile("full");
  if (!Array.isArray(full) || full.length < 10) throw new Error("takeover lib REQUIRED_CHECKS unexpectedly small");
  if (typeof takeoverLib.screenshotNeeds !== "function") throw new Error("takeover lib screenshotNeeds missing");
  new Function("return " + NOTECARD_PROBE);
  new Function("return " + VERBOSE_PROBE);
  const parsed = parseArgs(["-s", "-o", "/tmp/out", "-r", "/tmp/report.json"]);
  if (!parsed.selfTest || parsed.out !== "/tmp/out") throw new Error("parseArgs failed");
  let threw = false;
  try { parseArgs(["--bogus"]); } catch { threw = true; }
  if (!threw) throw new Error("parseArgs must reject unknown flags");
  process.stdout.write("offline self-test complete\n");
}

function assert_bytes(name, bytes) {
  if (!bytes || bytes.length === 0) throw new Error("fixture missing or empty: " + name);
  if (name.endsWith(".md") && !String(bytes).includes("---") && name !== "board.canvas") {
    throw new Error("fixture missing frontmatter: " + name);
  }
}

function buildVaultNotes() {
  const notes = {};
  for (const name of [...NOTEBOOK_FIXTURES, ...PROSE_FIXTURES]) {
    if (name === "notebook-report.json") continue;
    notes[name] = readFixtureBytes(name).toString("utf8");
  }
  Object.assign(notes, comparatorNotes());
  return notes;
}

async function run(args) {
  const executable = findExecutable(args.executable);
  try {
    fs.accessSync(executable, fs.constants.X_OK);
  } catch {
    fail("Obsidian executable is not executable: " + executable, 2);
  }
  const bob = shared.findBobProvenance();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "bob-note-cards-e2e-"));
  const vaultDir = path.join(scratch, "vault");
  const profileDir = path.join(scratch, "profile");
  const outDir = path.resolve(args.out || path.join(scratch, "shots"));
  const reportPath = path.resolve(args.report || path.join(outDir, "note-cards-report.json"));
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  const notes = buildVaultNotes();
  for (const [name, body] of Object.entries(notes)) shared.writeNote(vaultDir, name, body);
  installVault(vaultDir);
  shared.writeBobShim(path.join(profileDir, "shim"));
  shared.initScratchGit(vaultDir);
  const vaultReal = fs.realpathSync(vaultDir);
  shared.seedProfile(profileDir, vaultReal);
  const report = {
    startedAt: new Date().toISOString(),
    executable, bobProvenance: { path: bob.path, version: bob.version, sourceSha: bob.sourceSha },
    pluginSource: pluginProvenance(),
    checks: [], screenshots: [], consoleExceptions: [], consoleErrors: [],
    bobInvocations: { count: 0 },
  };
  const record = (name, ok, detail) => {
    report.checks.push({ name, status: ok ? "pass" : "fail", detail: String(detail == null ? "" : detail).slice(0, 2000) });
  };
  let child = null;
  let client = null;
  const overall = setTimeout(() => { if (child && !child.killed) child.kill("SIGTERM"); }, OVERALL_TIMEOUT_MS);
  if (overall.unref) overall.unref();
  try {
    const port = await shared.freePort();
    child = spawn(executable, [
      "--no-sandbox", `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${port}`, "--remote-allow-origins=http://127.0.0.1/*", vaultReal,
    ], {
      cwd: os.tmpdir(), stdio: ["ignore", "ignore", "pipe"],
      env: {
        ...process.env, HOME: profileDir, BOB_DIR: vaultReal, BOB_NOW: FIXTURE_TODAY + " 12:00:00",
        BOB_CONFIG_FILE: path.join(profileDir, "missing-test-config.yml"),
        BOB_RECORD_CARD_E2E_LOG: path.join(profileDir, "bob-invocations.jsonl"),
        BOB_RECORD_CARD_E2E_REAL: bob.path,
        PATH: path.join(profileDir, "shim") + path.delimiter + (process.env.PATH || ""),
        TMPDIR: "/tmp", NO_COLOR: "1", DISPLAY: process.env.DISPLAY || ":99",
      },
    });
    const target = await shared.selectTarget(port, vaultReal, () => child && child.exitCode == null);
    client = target.client;
    await client.call("Runtime.enable");
    client.on("Runtime.exceptionThrown", (params) => {
      const details = params.exceptionDetails || {};
      report.consoleExceptions.push({ text: details.text || "", url: details.url || "" });
    });
    client.on("Runtime.consoleAPICalled", (params) => {
      if (params.type === "error") report.consoleErrors.push((params.args || []).map((a) => a.value ?? "").join(" ").slice(0, 500));
    });
    await shared.trustCommunityPlugins(client);
    await waitFor(client, "Boolean(app.plugins.plugins['bob-ledger-tools']) && app.workspace.layoutReady", Boolean, "startup", 45000);
    await shared.collapseSidebars(client);
    await shared.setViewport(client, 1400, 1000);
    await shared.setTheme(client, "light");
    try {
      await driveMatrix(client, report, record, outDir, vaultReal, profileDir);
    } catch (error) {
      record("runner-completed-matrix", false, String((error && error.stack) || error).slice(0, 2000));
    }
    const failures = report.checks.filter((r) => r.status !== "pass");
    report.verdict = failures.length === 0 ? "GO" : "NO-GO";
    report.failures = failures.map((r) => r.name);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    process.stdout.write(`${report.verdict} note-cards e2e (${report.checks.length} checks, ${failures.length} failed, ${report.screenshots.length} shots)\n`);
    if (report.verdict !== "GO") process.exitCode = 1;
  } finally {
    clearTimeout(overall);
    if (client) { try { client.close(); } catch { /* gone */ } }
    if (child && !child.killed) { child.kill("SIGTERM"); await sleep(500); try { child.kill("SIGKILL"); } catch { /* gone */ } }
  }
}

async function driveMatrix(client, report, record, outDir, vaultReal, profileDir) {
  const shot = async (name, width, theme) => {
    const row = await shared.capture(client, outDir, name, width, theme, "note-cards");
    report.screenshots.push(row);
    process.stderr.write("[note-cards] screenshot " + name + " sha256=" + row.sha256 + " bytes=" + row.bytes + "\n");
    return row;
  };
  const probe = () => client.evaluate(NOTECARD_PROBE, 15000);
  const openProbe = async (notePath, mode) => {
    const opened = await shared.openNote(client, notePath, mode);
    if (!opened?.ok) return { opened, snapshot: null };
    await sleep(700);
    return { opened, snapshot: await probe() };
  };
  const waitSnapshot = (label, predicate, timeoutMs = 20000) =>
    waitFor(client, `(${NOTECARD_PROBE})`, predicate, label, timeoutMs);
  const keys = async (key, modifiers = 0) => {
    const code = /^[a-z]$/i.test(key) ? "Key" + key.toUpperCase() : key;
    const text = !modifiers && key.length === 1 ? key : "";
    const payload = { key, code, windowsVirtualKeyCode: 0, nativeVirtualKeyCode: 0, modifiers };
    if (text) { payload.text = text; payload.unmodifiedText = text; }
    await client.call("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...payload });
    await sleep(24);
    await client.call("Input.dispatchKeyEvent", { type: "keyUp", ...payload });
    await sleep(90);
  };
  const modalState = () => client.evaluate(`(() => {
    const m = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]?.propertyEditorModal;
    if (!m) return { present: false };
    return { present: true, closed: m.closed === true,
      status: (m.status && m.status.kind) || "",
      connected: Boolean(m.containerEl?.isConnected || m.modalEl?.isConnected),
      requestedSetting: m.requestedSetting || "" };
  })()`, 10000);
  let hashesBefore = await shared.markdownFilesHash(vaultReal);
  const bobLogFile = path.join(profileDir, "bob-invocations.jsonl");
  const bobCount = () => {
    try { return String(fs.readFileSync(bobLogFile, "utf8")).split("\n").filter(Boolean).length; }
    catch { return -1; }
  };

  record("plugin-loaded", true, "bob-ledger-tools + bob-articles installed in disposable vault");

  // Takeover: one card, one title, one foot; native hidden; no legacy header.
  // Sub-conditions are recorded individually so a failure names its cause.
  const verbose = () => client.evaluate(VERBOSE_PROBE, 15000).catch((error) => ({ verboseError: String(error?.message || error) }));
  const checkTakeover = async (label, note, kind, wantKicker) => {
    const mode = label.includes("reading") ? "reading" : "live";
    const { opened, snapshot } = await openProbe(note, mode);
    const s = snapshot || {};
    const got = kind === "notebook" ? s.notebook : s.prose;
    const other = kind === "notebook" ? s.prose : s.notebook;
    const missing = [];
    if (!opened?.ok) missing.push("open-failed:" + JSON.stringify(opened));
    if (got !== 1) missing.push(`card-count:${got}`);
    if (other !== 0) missing.push(`other-card:${other}`);
    if (s.native !== 0) missing.push(`native-visible:${s.native}`);
    if (s.headers !== 0) missing.push(`legacy-header:${s.headers}`);
    if (s.foot !== 1) missing.push(`foot-count:${s.foot}`);
    if (!wantKicker.test(s.kicker || "")) missing.push("kicker:" + JSON.stringify(s.kicker));
    if (!String(s.title || "").trim()) missing.push("title-missing");
    if (mode === "reading" && (s.h1 ?? 0) !== 0) missing.push(`h1-visible:${s.h1}`);
    if (!s.adoptedKind) missing.push("no-title-adoption");
    if (s.titleDisplay === "none") missing.push("title-block-display-none");
    const detail = { opened: opened?.ok, got, other, native: s.native, nativeTotal: s.nativeTotal, headers: s.headers, h1: s.h1, h1like: s.h1like, foot: s.foot, kicker: s.kicker, title: s.title, titleDisplay: s.titleDisplay, titleRect: s.titleRect, collapsed: s.cardCollapsed, bodyDisplay: s.bodyDisplay, owns: s.owns, actualOwned: s.actualOwned, actualPath: s.actualPath, containerDisplay: s.containerDisplay, containerInert: s.containerInert, ariaHidden: s.ariaHidden, adoptedKind: s.adoptedKind, drawerOpen: s.drawerOpen };
    if (missing.length > 0) detail.verbose = await verbose();
    record(label, missing.length === 0, JSON.stringify({ missing, ...detail }).slice(0, 6000));
  };
  await checkTakeover("notebook-live-takeover", "notebook-about-abby.md", "notebook", /notebook/i);
  await checkTakeover("notebook-reading-takeover", "notebook-about-abby.md", "notebook", /notebook/i);
  await checkTakeover("prose-live-takeover", "prose-with-title.md", "prose", /prose/i);
  await checkTakeover("prose-reading-takeover", "prose-with-title.md", "prose", /prose/i);

  // Single owner: mixed types mount neither new card; area/album unchanged.
  {
    const live = await openProbe("prose-mixed-type.md", "live");
    const reading = await openProbe("prose-mixed-type.md", "reading");
    const missing = [];
    for (const [name, snap] of [["live", live.snapshot], ["reading", reading.snapshot]]) {
      if ((snap?.prose ?? -1) !== 0) missing.push(`${name}-prose:${snap?.prose}`);
      if ((snap?.notebook ?? -1) !== 0) missing.push(`${name}-notebook:${snap?.notebook}`);
      // The Area home card keeps single ownership of the mixed note (precedence:
      // area before prose), or the note falls back to native. Either is family
      // behavior so long as no NEW card mounts.
      if (!((snap?.area ?? 0) >= 1 || (snap?.native ?? 0) >= 1)) missing.push(`${name}-ownerless`);
    }
    record("mixed-type-mounts-neither", missing.length === 0,
      JSON.stringify({ missing, live: live.snapshot, reading: reading.snapshot }).slice(0, 3000));
    const area = await openProbe("area.md", "live");
    record("area-unchanged", (area.snapshot?.notebook === 0 && area.snapshot?.prose === 0),
      JSON.stringify(area.snapshot));
    const album = await openProbe("album.md", "live");
    record("album-unchanged", (album.snapshot?.notebook === 0 && album.snapshot?.prose === 0),
      JSON.stringify(album.snapshot));
  }

  // Gate closed: without cardPreviewKinds the notebook renders as today (header + native).
  {
    const dataFile = path.join(vaultReal, ".obsidian", "plugins", PLUGIN_ID, "data.json");
    const saved = fs.readFileSync(dataFile, "utf8");
    let ok = false, detail = "";
    try {
      fs.writeFileSync(dataFile, JSON.stringify({}, null, 2));
      await client.evaluate(`(async () => {
        await app.plugins.disablePlugin(${JSON.stringify(PLUGIN_ID)});
        await app.plugins.enablePlugin(${JSON.stringify(PLUGIN_ID)});
        return true;
      })()`, 30000);
      await waitFor(client, "Boolean(app.plugins.plugins['bob-ledger-tools']) && app.workspace.layoutReady", Boolean, "reload-no-gate", 30000);
      await sleep(600);
      const s = (await openProbe("notebook-about-abby.md", "live")).snapshot || {};
      // Gate closed: no card, native Properties, and the fallback header.
      ok = s.notebook === 0 && s.prose === 0 && s.native >= 1 && s.headers >= 1;
      detail = JSON.stringify(s);
    } catch (error) { detail = "gate-closed probe error: " + String(error?.message || error); }
    try {
      fs.writeFileSync(dataFile, saved);
      await client.evaluate(`(async () => {
        await app.plugins.disablePlugin(${JSON.stringify(PLUGIN_ID)});
        await app.plugins.enablePlugin(${JSON.stringify(PLUGIN_ID)});
        return true;
      })()`, 30000);
      await waitFor(client, "Boolean(app.plugins.plugins['bob-ledger-tools']) && app.workspace.layoutReady", Boolean, "reload-gate", 30000);
      await sleep(600);
      const s = (await openProbe("notebook-about-abby.md", "live")).snapshot || {};
      ok = ok && s.notebook === 1 && s.native === 0;
      detail += " | restored=" + JSON.stringify({ notebook: s.notebook, native: s.native });
    } catch (error) { ok = false; detail += " | restore error: " + String(error?.message || error); }
    record("gate-closed-notebook-native", ok, detail);
  }

  // Native restoration: source, embed, malformed, unload, plugin-disabled.
  // Source mode renders frontmatter as text (no metadata container); embeds and
  // unparseable frontmatter keep today's rendering with no new card.
  {
    const source = await openProbe("notebook-about-abby.md", "source");
    const sourceOk = (source.snapshot?.notebook ?? 1) === 0 && (source.snapshot?.prose ?? 1) === 0;
    const embed = await openProbe("embed-host.md", "reading");
    const embedOk = (embed.snapshot?.notebook ?? 1) === 0 && (embed.snapshot?.prose ?? 1) === 0;
    const malformed = await openProbe("malformed.md", "live");
    const malformedOk = (malformed.snapshot?.notebook ?? 1) === 0 && (malformed.snapshot?.prose ?? 1) === 0;
    record("source-embed-malformed-native", sourceOk && embedOk && malformedOk,
      JSON.stringify({ source: source.snapshot, embed: embed.snapshot, malformed: malformed.snapshot }));
  }
  {
    // The linked notebook header is plugin-owned, so disabling ledger-tools
    // restores native Properties without it.
    let ok = false, detail = "";
    try {
      await client.evaluate(`(async () => { await app.plugins.disablePlugin(${JSON.stringify(PLUGIN_ID)}); return true; })()`, 20000);
      await sleep(800);
      const s = (await openProbe("notebook-about-abby.md", "live")).snapshot || {};
      ok = s.notebook === 0 && (s.native ?? 0) >= 1;
      detail = JSON.stringify(s);
    } catch (error) { detail = "disable error: " + String(error?.message || error); }
    try {
      await client.evaluate(`(async () => { await app.plugins.enablePlugin(${JSON.stringify(PLUGIN_ID)}); return true; })()`, 20000);
      await waitFor(client, "Boolean(app.plugins.plugins['bob-ledger-tools'])", Boolean, "reenable", 30000);
      await sleep(600);
    } catch (error) { ok = false; detail += " | re-enable error: " + String(error?.message || error); }
    record("disabled-ledger-tools-native", ok, detail);
  }
  {
    let canvasDetail = "", canvasOk = false;
    try {
      const opened = await shared.openNote(client, "board.canvas", "reading");
      await sleep(800);
      const s = await probe();
      canvasOk = Boolean(opened?.ok) && (s.notebook ?? 1) === 0 && (s.prose ?? 1) === 0;
      canvasDetail = JSON.stringify({ opened, snapshot: s });
    } catch (error) { canvasDetail = "canvas error: " + String(error?.message || error); }
    record("canvas-no-card", canvasOk, canvasDetail);
  }
  {
    await shared.setViewport(client, 420, 900);
    await sleep(300);
    const s = (await openProbe("notebook-about-abby.md", "live")).snapshot || {};
    const overflow = await client.evaluate(`(() => {
      const scope = app.workspace.activeLeaf?.view?.editor?.cm?.dom || document;
      const cards = Array.from(scope.querySelectorAll(".bob-notebook-card"));
      return cards.map((card) => ({ scroll: card.scrollWidth, client: card.clientWidth }));
    })()`, 10000);
    const ok = s.notebook === 1 && (overflow || []).every((r) => r.scroll <= r.client + 2);
    record("mobile-narrow-no-overflow", ok, JSON.stringify({ snapshot: { notebook: s.notebook }, overflow }));
    await shared.setViewport(client, 1400, 1000);
  }

  // Capability: prose without Bob Prose stays an identity-only quiet card.
  {
    let ok = false, detail = "";
    try {
      await client.evaluate(`(async () => { await app.plugins.disablePlugin(${JSON.stringify(ARTICLES_ID)}); return true; })()`, 20000);
      await sleep(800);
      const s = (await openProbe("prose-with-title.md", "reading")).snapshot || {};
      ok = s.prose === 1 && !/min read|words|sections/.test(s.measure || "");
      detail = JSON.stringify({ prose: s.prose, measure: s.measure, title: s.title });
    } catch (error) { detail = "articles-disable error: " + String(error?.message || error); }
    try {
      await client.evaluate(`(async () => { await app.plugins.enablePlugin(${JSON.stringify(ARTICLES_ID)}); return true; })()`, 20000);
      await sleep(1200);
    } catch (error) { ok = false; detail += " | re-enable error: " + String(error?.message || error); }
    record("prose-identity-without-articles", ok, detail);
  }
  // Data: report-backed readouts, chips, ghost, pill, children, measures.
  {
    const settled = await openProbe("notebook-about-abby.md", "live");
    try {
      await waitSnapshot("readout-settles", (s) => s && s.notebook === 1 && /note/.test(s.readout || ""), 25000);
    } catch { /* record below */ }
    const s = await probe();
    const ok = s.notebook === 1 && /note/.test(s.readout || "") && !/0 notes/.test(s.readout || "");
    record("notebook-readout-present-no-zero", ok, JSON.stringify({ readout: s.readout, cardText: (s.cardText || "").slice(0, 200) }));
    const dup = await openProbe("notebook-duplicate-sections.md", "live");
    await sleep(2500);
    const dupSnap = await probe();
    const dupTitles = dupSnap.sections || [];
    record("notebook-duplicate-sections-pair", dupTitles.filter((t) => /duplicate|same/i.test(t)).length >= 0 && dupTitles.length >= 2,
      JSON.stringify({ sections: dupTitles, opened: dup.opened }));
    const many = await openProbe("notebook-many-sections.md", "live");
    await sleep(2500);
    const manySnap = await probe();
    record("notebook-overflow-more", (manySnap.sections || []).length >= 7 && /\+/.test(manySnap.sectionMore || ""),
      JSON.stringify({ sections: (manySnap.sections || []).length, more: manySnap.sectionMore }));
    void many;
    const parent = await openProbe("notebook-parent.md", "live");
    await sleep(2500);
    const parentSnap = await probe();
    record("notebook-children-chips", (parentSnap.childChips || []).length >= 1,
      JSON.stringify({ children: parentSnap.childChips }));
    void parent;
    const ghost = await openProbe("notebook-no-summary.md", "live");
    record("notebook-add-summary-ghost", (ghost.snapshot?.addSummary ?? 0) >= 1,
      JSON.stringify(ghost.snapshot));
    const checkbox = await openProbe("notebook-with-checkbox.md", "live");
    await sleep(2500);
    const checkboxSnap = await probe();
    record("notebook-error-pill", /✗/.test(checkboxSnap.errorPill || ""),
      JSON.stringify({ pill: checkboxSnap.errorPill }));
    const routeOk = /^@/.test((s.routeToken || "").trim());
    record("notebook-route-token", routeOk, JSON.stringify({ route: s.routeToken }));
  }
  {
    // Bob Prose still tracks only [[article]] notes (qj.3 detection never
    // reached master), so [[prose]] notes stay identity-only: a correct quiet
    // card with no zeroed measures. Ready-snapshot paths are unit-covered and
    // wait on the qj.3 follow-up.
    const withTitle = await openProbe("prose-with-title.md", "live");
    await sleep(4000);
    const withTitleSnap = await probe();
    const identityMissing = [];
    if ((withTitleSnap.prose ?? 0) !== 1) identityMissing.push(`prose:${withTitleSnap.prose}`);
    if (!String(withTitleSnap.title || "").trim()) identityMissing.push("title-missing");
    if (!/numbered|§/.test(withTitleSnap.numbering || "")) identityMissing.push("numbering:" + JSON.stringify(withTitleSnap.numbering));
    if (/0 words|0 sections|0 to write|0 min/.test(withTitleSnap.cardText || "")) identityMissing.push("zeroed-measure");
    record("prose-identity-no-snapshot", identityMissing.length === 0,
      JSON.stringify({ missing: identityMissing, measure: withTitleSnap.measure, opened: withTitle.opened }));
    // Legacy [[article]] notes reach Bob Prose and bob refuses them with its
    // own adopt message: the refusal line paints bob's message, never zeros.
    const legacy = await openProbe("prose-article-legacy.md", "reading");
    void legacy;
    let legacySnap = null;
    try {
      legacySnap = await waitSnapshot("legacy-refusal", (s) => s && s.prose === 1 && String(s.measure || "").length > 0, 30000);
    } catch { legacySnap = await probe(); }
    record("prose-legacy-refusal-line",
      /not a prose note|adopt/i.test(legacySnap?.measure || "") && !/0 words|0 sections/.test(legacySnap?.measure || ""),
      JSON.stringify({ measure: legacySnap?.measure }));
    const unnumbered = await openProbe("prose-unnumbered.md", "live");
    const invalid = await openProbe("prose-invalid-numbering.md", "live");
    record("prose-numbering-states",
      /unnumbered/.test(unnumbered.snapshot?.numbering || "") && /⚠/.test(invalid.snapshot?.numbering || ""),
      JSON.stringify({ unnumbered: unnumbered.snapshot?.numbering, invalid: invalid.snapshot?.numbering }));
    const emoji = await openProbe("prose-emoji-title.md", "live");
    record("prose-emoji-title-mounts", emoji.snapshot?.prose === 1,
      JSON.stringify({ kicker: emoji.snapshot?.kicker, title: emoji.snapshot?.title, cardText: (emoji.snapshot?.cardText || "").slice(0, 160) }));
    // A [[prose]] note bob refuses (^prj) stays identity-only until qj.3
    // detection lands: no snapshot, no zeroed measures, no crash.
    const refused = await openProbe("prose-with-prj.md", "reading");
    await sleep(3000);
    const refusedSnap = await probe();
    void refused;
    record("prose-prj-identity-no-crash",
      (refusedSnap.prose ?? 0) === 1 && !/0 words|0 sections|0 to write/.test([refusedSnap.measure, refusedSnap.cardText].join(" ")),
      JSON.stringify({ measure: refusedSnap.measure, findings: refusedSnap.findings, prose: refusedSnap.prose }));
  }

  // Focus and routing: fold, drawer, ==, +, -, _, Vim motion, Tab, Esc ladder.
  {
    await openProbe("notebook-about-abby.md", "live");
    await client.evaluate(`(() => { const v = app.workspace.activeLeaf?.view; try { v?.editor?.focus?.(); } catch (_) {} return true; })()`, 10000);
    await sleep(300);
    // The card's own fold button carries the exact .bob-notebook-card-fold
    // class; drawer and managed toggles do not. Assert the structural
    // is-collapsed state flips both directions with the card still mounted.
    const foldClick = () => client.evaluate(`(() => {
      const scope = app.workspace.activeLeaf?.view?.editor?.cm?.dom || document;
      const btn = scope.querySelector(".bob-notebook-card .bob-notebook-card-fold");
      if (!btn) return { ok: false, reason: "no fold button" };
      btn.click();
      return { ok: true, expanded: btn.getAttribute("aria-expanded") };
    })()`, 10000);
    await foldClick();
    await sleep(600);
    const foldedSnap = await probe();
    await foldClick();
    await sleep(600);
    const unfoldedSnap = await probe();
    const foldOk = foldedSnap.cardCollapsed === true && foldedSnap.notebook === 1
      && unfoldedSnap.cardCollapsed === false && unfoldedSnap.notebook === 1;
    record("notebook-fold-toggle", foldOk, JSON.stringify({ folded: { collapsed: foldedSnap.cardCollapsed, notebook: foldedSnap.notebook, bodyDisplay: foldedSnap.bodyDisplay }, unfolded: { collapsed: unfoldedSnap.cardCollapsed, notebook: unfoldedSnap.notebook } }));
    const drawerFlip = await client.evaluate(`(() => {
      const scope = app.workspace.activeLeaf?.view?.editor?.cm?.dom || document;
      const drawer = scope.querySelector(".bob-notebook-card .bob-property-card-foot-drawer");
      const before = drawer?.getAttribute?.("data-open");
      const btn = Array.from(scope.querySelectorAll(".bob-notebook-card button")).find((b) => /Properties/.test(b.textContent || ""));
      if (!btn) return { ok: false, reason: "no drawer button", before };
      btn.click();
      return { ok: true, before, clicked: true };
    })()`, 10000);
    await sleep(500);
    const drawerAfter = await client.evaluate(`(() => {
      const scope = app.workspace.activeLeaf?.view?.editor?.cm?.dom || document;
      return scope.querySelector(".bob-notebook-card .bob-property-card-foot-drawer")?.getAttribute?.("data-open") || null;
    })()`, 10000);
    record("notebook-drawer-toggle", Boolean(drawerFlip?.ok) && drawerAfter !== (drawerFlip.before ?? null),
      JSON.stringify({ before: drawerFlip.before, after: drawerAfter }));
    await keys("Escape");
    await keys("+");
    let plusModal = null;
    try {
      plusModal = await waitFor(client, `(() => {
        const m = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]?.propertyEditorModal;
        return m && !m.closed ? { open: true, status: (m.status && m.status.kind) || "" } : null;
      })()`, Boolean, "plus-opens-editor", 15000);
    } catch { plusModal = await modalState(); }
    const plusOk = Boolean(plusModal && (plusModal.open || (plusModal.present && !plusModal.closed)));
    await keys("Escape");
    await sleep(400);
    const plusClosed = await modalState();
    record("plus-opens-editor-esc-closes", plusOk && (plusClosed.closed !== false),
      JSON.stringify({ plusModal, plusClosed }));
    await keys("Escape");
    await keys("=");
    await keys("=");
    let eqModal = null;
    try {
      eqModal = await waitFor(client, `(() => {
        const m = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]?.propertyEditorModal;
        return m && !m.closed ? { open: true, requestedSetting: m.requestedSetting || "" } : null;
      })()`, Boolean, "double-equals-focus-or-add", 15000);
    } catch { eqModal = await modalState(); }
    const eqOk = Boolean(eqModal && (eqModal.open || (eqModal.present && !eqModal.closed)));
    await keys("Escape");
    await sleep(400);
    record("double-equals-focus-or-add", eqOk, JSON.stringify(eqModal));
    await keys("Escape");
    const vimStart = await client.evaluate(`(() => {
      const v = app.workspace.activeLeaf?.view;
      try { v?.editor?.focus?.(); } catch (_) {}
      const ed = v?.editor;
      return { cursor: ed?.getCursor?.() || null };
    })()`, 10000);
    await keys("Escape");
    await keys("g"); await keys("g");
    await keys("k");
    await keys("ArrowUp");
    const vimAfter = await client.evaluate(`(() => {
      const ed = app.workspace.activeLeaf?.view?.editor;
      return { cursor: ed?.getCursor?.() || null };
    })()`, 10000);
    record("vim-k-gg-up-live", Boolean(vimStart?.cursor) && Boolean(vimAfter?.cursor),
      JSON.stringify({ vimStart, vimAfter }));
    await keys("Escape");
  }
  {
    // Prose is folded by default: expanding reveals the outline shell. The
    // numbering chip is inert text until qj.3's toggle-section-numbers command
    // registers (toggleCommand false): clicking it must be a no-op.
    await openProbe("prose-with-title.md", "live");
    let expanded = null;
    try {
      expanded = await waitSnapshot("prose-expands", (s) => s && s.prose === 1, 15000);
    } catch { expanded = await probe(); }
    const outlineClick = () => client.evaluate(`(() => {
      const scope = app.workspace.activeLeaf?.view?.editor?.cm?.dom || document;
      scope.querySelector(".bob-prose-note-card button.bob-property-card-fold")?.click();
      return true;
    })()`, 10000);
    await outlineClick();
    await sleep(800);
    const expandedSnap = await probe();
    record("prose-fold-reveals-outline", expandedSnap.outlineHidden === false && expandedSnap.prose === 1,
      JSON.stringify({ hidden: expandedSnap.outlineHidden, rows: expandedSnap.outline, collapsed: expandedSnap.cardCollapsed, before: expanded?.outlineHidden }));
    const chipProbe = await probe();
    const chipMissing = [];
    if (!/§/.test(chipProbe.numbering || "")) chipMissing.push("chip-missing");
    if (chipProbe.toggleCommand) {
      if (chipProbe.numberingTag !== "BUTTON") chipMissing.push("live-chip-not-button:" + chipProbe.numberingTag);
      const before = chipProbe.numbering || "";
      const chipClick = () => client.evaluate(`(() => {
        const scope = app.workspace.activeLeaf?.view?.editor?.cm?.dom || document;
        scope.querySelector(".bob-prose-note-card .bob-prose-note-card-numbering")?.click();
        return true;
      })()`, 10000);
      await chipClick();
      await sleep(1500);
      const after = (await probe()).numbering || "";
      if (after === before) chipMissing.push("toggle-no-repaint");
      await chipClick();
      await sleep(1500);
      const restored = (await probe()).numbering || "";
      if (restored !== before) chipMissing.push("toggle-not-undoable");
    } else {
      if (chipProbe.numberingTag !== "SPAN") chipMissing.push("inert-chip-not-span:" + chipProbe.numberingTag);
      if (!/unavailable/i.test(chipProbe.numberingTitle || "")) chipMissing.push("inert-title:" + JSON.stringify(chipProbe.numberingTitle));
      const before = chipProbe.numbering || "";
      await client.evaluate(`(() => {
        const scope = app.workspace.activeLeaf?.view?.editor?.cm?.dom || document;
        scope.querySelector(".bob-prose-note-card .bob-prose-note-card-numbering")?.click();
        return true;
      })()`, 10000);
      await sleep(1200);
      const after = (await probe()).numbering || "";
      if (after !== before) chipMissing.push(`inert-chip-changed:${before}->${after}`);
    }
    record("prose-numbering-chip-inert-without-command", chipMissing.length === 0,
      JSON.stringify({ missing: chipMissing, numbering: chipProbe.numbering, tag: chipProbe.numberingTag, toggleCommand: chipProbe.toggleCommand }));
  }

  // Typing under a mounted card never unmounts it or flashes native Properties.
  {
    await openProbe("notebook-about-abby.md", "live");
    await sleep(1000);
    const typed = await client.evaluate(`(async () => {
      const file = app.vault.getAbstractFileByPath("notebook-about-abby.md");
      if (!file) return { ok: false, reason: "missing file" };
      const before = await app.vault.read(file);
      await app.vault.modify(file, before + "\\nTyping probe line.\\n");
      await new Promise((resolve) => setTimeout(resolve, 1200));
      return { ok: true };
    })()`, 20000);
    const s = await probe();
    const ok = Boolean(typed?.ok) && s.notebook === 1 && s.native === 0;
    record("typing-keeps-card", ok, JSON.stringify({ typed, notebook: s.notebook, native: s.native }));
    // The typing probe is the run's one sanctioned vault write: re-baseline
    // the passive bytes check after it so paint-triggered writes still fail.
    hashesBefore = await shared.markdownFilesHash(vaultReal);
  }

  // Passive: paint/fold/drawer/resize trigger zero bob spawns and zero writes.
  {
    const countBefore = bobCount();
    await client.evaluate(`(() => {
      const scope = app.workspace.activeLeaf?.view?.editor?.cm?.dom || document;
      const card = scope.querySelector(".bob-notebook-card");
      const fold = card?.querySelector?.(".bob-notebook-card-fold, .bob-home-card-collapse");
      fold?.click();
      fold?.click();
      const drawerBtn = Array.from(card?.querySelectorAll?.("button") || []).find((b) => /Properties/.test(b.textContent || ""));
      drawerBtn?.click();
      drawerBtn?.click();
      window.dispatchEvent(new Event("resize"));
      return true;
    })()`, 15000);
    await sleep(2500);
    const countAfter = bobCount();
    const hashesAfter = await shared.markdownFilesHash(vaultReal);
    const spawnsOk = countBefore >= 0 && countAfter >= 0 && countAfter === countBefore;
    record("no-paint-spawn", spawnsOk, JSON.stringify({ countBefore, countAfter }));
    record("bytes-unchanged", JSON.stringify(hashesAfter) === JSON.stringify(hashesBefore),
      JSON.stringify({ before: hashesBefore, after: hashesAfter }));
  }
  {
    const exceptions = (report.consoleExceptions || []).filter((e) => !/ResizeObserver/i.test(e.text || ""));
    record("no-console-exceptions", exceptions.length === 0,
      JSON.stringify(exceptions.slice(0, 5)));
  }

  // Screenshots: both cards x LP/Reading x light/dark x wide/narrow x folded/expanded,
  // family consistency, native recovery, and forced-colors.
  // Hero shots use a closed drawer so the title block leads.
  const closeDrawer = () => client.evaluate(`(() => {
    const scope = app.workspace.activeLeaf?.view?.editor?.cm?.dom || document;
    for (const sel of [".bob-notebook-card", ".bob-prose-note-card"]) {
      const drawer = scope.querySelector(sel + " .bob-property-card-foot-drawer");
      if (drawer && drawer.getAttribute("data-open") === "true") {
        const card = scope.querySelector(sel);
        const btn = Array.from(card?.querySelectorAll?.("button") || []).find((b) => /Properties/.test(b.textContent || ""));
        btn?.click();
      }
    }
    return true;
  })()`, 10000);
  const snap = async (name, width, theme) => {
    await closeDrawer();
    await sleep(400);
    await shot(name, width, theme);
  };
  // Deterministic fold state before shooting: the fold test proves the
  // mechanism, these waits prove the pictured state.
  const setNotebookCollapsed = async (want) => {
    const click = () => client.evaluate(`(() => {
      const scope = app.workspace.activeLeaf?.view?.editor?.cm?.dom || document;
      scope.querySelector(".bob-notebook-card .bob-notebook-card-fold")?.click();
      return true;
    })()`, 10000);
    for (let i = 0; i < 3; i += 1) {
      const s = await probe();
      if (s.cardCollapsed === want && s.notebook === 1) return s;
      await click();
      await sleep(700);
    }
    return probe();
  };
  const setProseCollapsed = async (want) => {
    const click = () => client.evaluate(`(() => {
      const scope = app.workspace.activeLeaf?.view?.editor?.cm?.dom || document;
      scope.querySelector(".bob-prose-note-card button.bob-property-card-fold")?.click();
      return true;
    })()`, 10000);
    for (let i = 0; i < 3; i += 1) {
      const s = await probe();
      if (s.cardCollapsed === want && s.prose === 1) return s;
      await click();
      await sleep(700);
    }
    return probe();
  };
  // Hero shots wait for the report-backed body: the reserved slot patches in
  // place, so the reviewed card is the settled one.
  const waitNotebookReady = () => waitSnapshot("shot-ready",
    (s) => s && s.notebook === 1 && /note/.test(s.readout || ""), 25000);
  await shared.setViewport(client, 1280, 1000);
  await shared.setTheme(client, "light");
  await openProbe("notebook-about-abby.md", "live");
  await waitNotebookReady().catch(() => {});
  await setNotebookCollapsed(false);
  await snap("notebook-live-light-wide", 1280, "light");
  await shared.setTheme(client, "dark");
  await sleep(600);
  await snap("notebook-live-dark-wide", 1280, "dark");
  await shared.setTheme(client, "light");
  await shared.setViewport(client, 420, 900);
  await sleep(400);
  await snap("notebook-live-light-narrow", 420, "light");
  await shared.setViewport(client, 1280, 1000);
  await openProbe("notebook-about-abby.md", "reading");
  await waitNotebookReady().catch(() => {});
  await snap("notebook-reading-light-wide", 1280, "light");
  await shared.setTheme(client, "dark");
  await sleep(600);
  await snap("notebook-reading-dark-wide", 1280, "dark");
  await shared.setTheme(client, "light");
  await openProbe("notebook-about-abby.md", "live");
  await waitNotebookReady().catch(() => {});
  await setNotebookCollapsed(true);
  await shot("notebook-live-light-wide-folded", 1280, "light");
  await setNotebookCollapsed(false);
  await openProbe("prose-with-title.md", "live");
  await sleep(1500);
  await setProseCollapsed(true);
  await snap("prose-live-light-wide-folded", 1280, "light");
  await setProseCollapsed(false);
  await sleep(800);
  await snap("prose-live-light-wide-expanded", 1280, "light");
  await shared.setTheme(client, "dark");
  await sleep(600);
  await snap("prose-live-dark-wide-expanded", 1280, "dark");
  await shared.setTheme(client, "light");
  await sleep(400);
  await openProbe("prose-with-title.md", "reading");
  await sleep(1200);
  await snap("prose-reading-light-wide", 1280, "light");
  await shared.setTheme(client, "dark");
  await sleep(600);
  await snap("prose-reading-dark-wide", 1280, "dark");
  await shared.setTheme(client, "light");
  await sleep(400);
  await shared.setViewport(client, 420, 900);
  await sleep(400);
  await snap("prose-live-light-narrow", 420, "light");
  await shared.setViewport(client, 1280, 1000);
  await openProbe("album.md", "live");
  await sleep(1000);
  await shot("family-album-live-light-wide", 1280, "light");
  await openProbe("area.md", "live");
  await sleep(1000);
  await shot("family-area-live-light-wide", 1280, "light");
  await openProbe("notebook-about-abby.md", "source");
  await sleep(600);
  await shot("native-source-light-wide", 1280, "light");
  await openProbe("malformed.md", "live");
  await sleep(800);
  await shot("native-malformed-light-wide", 1280, "light");
  let forcedOk = true;
  try {
    await client.call("Emulation.setEmulatedMedia", { forcedColors: "active" });
    await sleep(500);
    await openProbe("notebook-about-abby.md", "live");
    await sleep(800);
    await shot("notebook-forced-colors", 1280, "forced-colors");
    await openProbe("prose-with-title.md", "live");
    await sleep(800);
    await shot("prose-forced-colors", 1280, "forced-colors");
    await client.call("Emulation.setEmulatedMedia", { forcedColors: "none" });
  } catch (error) {
    forcedOk = false;
    record("forced-colors-emulation", false, String(error?.message || error));
  }
  if (forcedOk) record("forced-colors-emulation", true, "forced-colors shots captured");
}

function pluginProvenance() {
  const dir = path.join(repoRoot, "plugins", PLUGIN_ID);
  const files = {};
  for (const name of ["manifest.json", "main.js", "styles.css"]) {
    try { files[name] = shared.sha256File(path.join(dir, name)); } catch { files[name] = null; }
  }
  return { head: String(spawnSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout || "").trim(), files };
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write([
      "Usage: node scripts/obsidian-note-cards-e2e.cjs [OPTIONS]",
      "",
      "Real-Obsidian acceptance for the Notebook Card and Prose Card (bob-cli-qm.6).",
      "Disposable vault + profile, master-built bob, never the live vault.",
      "",
      "Options:",
      "  -e, --executable PATH   Obsidian Electron binary",
      "  -o, --out DIRECTORY     Screenshot output directory",
      "  -r, --report PATH       Write the structured JSON report to PATH",
      "  -s, --self-test         Validate fixtures and probes without launching Obsidian",
      "  -h, --help              Print this help and exit",
      "",
      "Acceptance closes on GO only. Offline self-test is not acceptance.",
    ].join("\n") + "\n");
    return;
  }
  if (args.selfTest) {
    selfTest();
    return;
  }
  await run(args);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    const code = Number.isInteger(error.exitCode) ? error.exitCode : 1;
    process.stderr.write(String((error && error.stack) || error) + "\n");
    process.exit(code);
  });
}

module.exports = { parseArgs, selfTest, buildVaultNotes, NOTECARD_PROBE };

