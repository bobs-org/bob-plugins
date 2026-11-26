// Offline half of the cabinet-absorption spike (bob-cli-qq absorption):
// fixtures, the hide-ladder definition, verdict rules, argument parsing,
// and the page-side sources the real-Obsidian runner evaluates. It never
// launches Obsidian; the runner (obsidian-cabinet-absorption-spike.cjs)
// does that where an Obsidian binary and Xvfb exist.
"use strict";

const assert = require("node:assert/strict");

const HELP_TEXT = [
  "Usage: node scripts/obsidian-cabinet-absorption-spike.cjs [options]",
  "",
  "Hide a catalog heading + callout range through a CM6 StateField in a",
  "scratch vault and probe Vim motion, navigation, and Find around it.",
  "",
  "Options:",
  "  -e, --executable PATH   Obsidian binary (default: auto-detect)",
  "  -o, --out DIR           Scratch output directory",
  "  -r, --report PATH       JSON report path",
  "  -s, --self-test         Offline self-test only; no Obsidian launched",
  "  -h, --help              Show this help",
].join("\n");

// The ladder, cheapest first. The runner tries each rung in order and keeps
// the first rung where no check strands an invisible cursor.
const LADDER_RUNGS = Object.freeze([
  { id: "a", name: "replace", description: "Decoration.replace({ block: true }) over the hidden lines" },
  { id: "b", name: "replace+atomic", description: "(a) plus EditorView.atomicRanges over the same span" },
  { id: "c", name: "fold-widget", description: "(b) with a one-line fold-style widget stub above the card" },
]);

const REQUIRED_CHECKS = Object.freeze([
  { name: "hide-live", surface: "live", mandatory: true },
  { name: "hide-reading", surface: "reading", mandatory: true },
  { name: "vim-j-k", surface: "live", mandatory: true },
  { name: "vim-gg-G", surface: "live", mandatory: true },
  { name: "arrows-pgup-pgdn", surface: "live", mandatory: true },
  { name: "mouse-around-range", surface: "live", mandatory: true },
  { name: "heading-jump-live", surface: "live", mandatory: true },
  { name: "heading-jump-reading", surface: "reading", mandatory: true },
  { name: "outline-pane-nav", surface: "both", mandatory: true },
  { name: "find-reveals", surface: "live", mandatory: true },
  { name: "no-invisible-cursor", surface: "live", mandatory: true },
  { name: "fail-source-mode", surface: "live", mandatory: true },
  { name: "fail-embed-hover-canvas", surface: "both", mandatory: false },
  { name: "teardown-plugin-disable", surface: "both", mandatory: true },
  { name: "bytes-unchanged", surface: "both", mandatory: true },
]);

function surfaceOf(name) {
  const row = REQUIRED_CHECKS.find((check) => check.name === name);
  return row ? row.surface : "both";
}

function parseArgs(argv) {
  const args = { executable: null, out: null, report: null, selfTest: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "-e" || token === "--executable") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) throw new Error("--executable requires a PATH value");
      args.executable = value;
      index += 1;
    } else if (token === "-o" || token === "--out") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) throw new Error("--out requires a DIRECTORY value");
      args.out = value;
      index += 1;
    } else if (token === "-r" || token === "--report") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) throw new Error("--report requires a PATH value");
      args.report = value;
      index += 1;
    } else if (token === "-s" || token === "--self-test") {
      args.selfTest = true;
    } else if (token === "-h" || token === "--help") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

// Minimal host note: one hideable section (heading + callout + trailing
// blank) and one kept-heading section (authored prose beside the callout).
function fixtureNotes() {
  const host = [
    "---",
    "type: area",
    "---",
    "",
    "# Cash",
    "",
    "## Projects",
    "",
    "> [!projects]",
    "> - [[Food]]",
    "> - [[Transit]]",
    "",
    "## Tasks",
    "",
    "- [ ] Buy milk",
    "",
    "## Notebooks",
    "",
    "My own intro.",
    "",
    "> [!notebooks]",
    "> - [[Ideas]]",
    "",
  ].join("\n");
  const album = [
    "# Eat",
    "",
    "## Records",
    "",
    "> [!records] 2 restaurants · by Status",
    "> - [[A]]",
    "> - [[B]]",
    "",
  ].join("\n");
  return { "host.md": host, "album.md": album };
}

function expectedHideSpans() {
  // 1-based physical lines in fixtureNotes()["host.md"].
  return [
    { kind: "projects", from: 7, to: 12 },
    { kind: "notebooks", from: 22, to: 23, headingKept: true },
  ];
}

function placementFailures(probe) {
  const failures = [];
  const hidden = probe.hidden || [];
  for (const span of expectedHideSpans()) {
    const found = hidden.find((entry) => entry.kind === span.kind);
    if (!found) {
      failures.push(`missing hidden span for ${span.kind}`);
      continue;
    }
    if (found.from !== span.from || found.to !== span.to) {
      failures.push(`${span.kind}: hid ${found.from}-${found.to}, want ${span.from}-${span.to}`);
    }
  }
  if (probe.bytesChanged) failures.push("note bytes changed while hidden");
  return failures;
}

function placementSummary(probe) {
  return { hidden: probe.hidden || [], failures: placementFailures(probe) };
}

function round(value) {
  return typeof value === "number" ? Math.round(value * 10) / 10 : value;
}

function computeVerdict(report) {
  if (!report || !Array.isArray(report.checks)) return { verdict: "NO-GO", missing: REQUIRED_CHECKS.map((row) => row.name) };
  const required = REQUIRED_CHECKS.map((row) => row.name);
  const present = new Set(report.checks.map((row) => row.name));
  const missing = required.filter((name) => !present.has(name));
  const failed = new Map();
  for (const row of report.checks) {
    if (!required.includes(row.name)) continue;
    if (!failed.has(row.name)) failed.set(row.name, []);
    failed.get(row.name).push(row);
  }
  const failing = [...failed.entries()].filter(([, rows]) => rows.some((row) => row.status !== "pass")).map(([name]) => name);
  if (missing.length > 0) return { verdict: "NO-GO", missing };
  const bothFailing = failing.filter((name) => surfaceOf(name) === "both");
  if (bothFailing.length > 0) return { verdict: "NO-GO", failed: bothFailing };
  const liveFailing = failing.filter((name) => surfaceOf(name) === "live");
  const readingFailing = failing.filter((name) => surfaceOf(name) === "reading");
  if (liveFailing.length === 0 && readingFailing.length === 0) return { verdict: "GO", failed: [] };
  if (liveFailing.length > 0 && readingFailing.length === 0) {
    return { verdict: "GO (reading only; live preview falls back to body)", partial: true, fallback: ["live"] };
  }
  if (readingFailing.length > 0 && liveFailing.length === 0) {
    return { verdict: "GO (live preview only; reading falls back to body)", partial: true, fallback: ["reading"] };
  }
  return { verdict: "NO-GO", failed: failing };
}

function passingReport() {
  return {
    rung: "b",
    checks: REQUIRED_CHECKS.map((row) => ({ name: row.name, surface: row.surface, status: "pass", mandatory: row.mandatory })),
  };
}

function syntheticProbe(mode, overrides = {}) {
  const hidden = expectedHideSpans().map((span) => ({ kind: span.kind, from: span.from, to: span.to }));
  return Object.assign({ mode, hidden, bytesChanged: false }, overrides);
}

const PAGE_COMMON = String.raw`
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(fn, timeoutMs, label) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error("timeout waiting for " + label);
    await sleep(100);
  }
}
`;

const ADAPTER_SOURCE = "(() => {" + PAGE_COMMON + String.raw`
async function hide(app, notePath, kind, rung) {
  const plugins = app.plugins;
  const plugin = plugins?.getPlugin?.("bob-ledger-tools") || plugins?.plugins?.["bob-ledger-tools"];
  if (!plugin) throw new Error("cabinet spike: plugin not loaded");
  const helpers = plugin.constructor?.helpers;
  if (!helpers?.propertyCardCatalogRegionForHide) throw new Error("cabinet spike: absorption helpers missing");
  const file = app.vault.getAbstractFileByPath(notePath);
  if (!file) throw new Error("cabinet spike: no such note: " + notePath);
  const text = await app.vault.read(file);
  const plan = helpers.propertyCardCatalogRegionForHide(text, kind);
  if (!plan || plan.damage) throw new Error("cabinet spike: no hideable plan for " + kind);
  const leaves = [];
  app.workspace.iterateAllLeaves((leaf) => leaves.push(leaf));
  const leaf = leaves.find((item) => item.view?.file?.path === notePath && item.view?.editor?.cm) || leaves.find((item) => item.view?.editor?.cm);
  const cm = leaf?.view?.editor?.cm;
  if (!cm) throw new Error("cabinet spike: no Live Preview editor");
  if (typeof helpers.propertyCardCabinetAbsorbInEditor !== "function") throw new Error("cabinet spike: absorb primitive missing");
  const handle = helpers.propertyCardCabinetAbsorbInEditor(cm, { path: notePath, kind, fingerprint: plan.fingerprint, rung });
  if (!handle) throw new Error("cabinet spike: editor refused the claim");
  window.__bobCabinetSpikeHandle = handle;
  const spans = (helpers.propertyCardCabinetAbsorbRangesForPlan(text, plan) || []).map((range) => ({ from: range.from, to: range.to }));
  const line = (n) => { try { const l = cm.state.doc.line(n); return { from: l.from, to: l.to }; } catch (_) { return null; } };
  return { kind, rung, plan: { startLine: plan.startLine, endLine: plan.endLine, headingLine: plan.headingLine }, spans, line };
}
window.__bobCabinetSpike = { hide };
return window.__bobCabinetSpike;
})()`;

const PROBE_SOURCE = "(() => {" + PAGE_COMMON + String.raw`
function cursorVisible() {
  const active = document.activeElement;
  if (!active || active === document.body) return false;
  try {
    const rect = active.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  } catch (_) {
    return false;
  }
}
window.__bobCabinetProbe = { cursorVisible };
return window.__bobCabinetProbe;
})()`;

function selfTest() {
  const notes = fixtureNotes();
  assert.ok(notes["host.md"].includes("> [!projects]"));
  assert.ok(notes["album.md"].includes("> [!records] 2 restaurants"));
  const lines = notes["host.md"].split("\n");
  for (const span of expectedHideSpans()) {
    assert.ok(span.from >= 1 && span.to <= lines.length, "span in range");
    if (!span.headingKept) assert.match(lines[span.from - 1], /^## /, "hideable span starts at the H2");
  }
  assert.deepEqual(placementFailures(syntheticProbe("live")), []);
  assert.deepEqual(placementFailures(syntheticProbe("reading")), []);
  const changed = syntheticProbe("live", { bytesChanged: true });
  assert.ok(placementFailures(changed).includes("note bytes changed while hidden"));
  assert.equal(computeVerdict(passingReport()).verdict, "GO");
  const liveOnly = passingReport();
  for (const row of liveOnly.checks) if (row.surface === "reading") row.status = "fail";
  assert.equal(computeVerdict(liveOnly).verdict, "GO (live preview only; reading falls back to body)");
  const readingOnly = passingReport();
  for (const row of readingOnly.checks) if (row.surface === "live") row.status = "fail";
  assert.equal(computeVerdict(readingOnly).verdict, "GO (reading only; live preview falls back to body)");
  const neither = passingReport();
  for (const row of neither.checks) if (row.surface !== "both") row.status = "fail";
  assert.equal(computeVerdict(neither).verdict, "NO-GO");
  const bothFail = passingReport();
  for (const row of bothFail.checks) if (row.name === "teardown-plugin-disable") row.status = "fail";
  assert.equal(computeVerdict(bothFail).verdict, "NO-GO", "a failed both-surface check blocks every GO");
  const missing = passingReport();
  missing.checks = missing.checks.filter((row) => row.name !== "vim-gg-G");
  const missingVerdict = computeVerdict(missing);
  assert.notEqual(missingVerdict.verdict, "GO");
  assert.deepEqual(missingVerdict.missing, ["vim-gg-G"]);
  assert.equal(computeVerdict({}).verdict, "NO-GO");
  for (const [name, source] of [["adapter", ADAPTER_SOURCE], ["probe", PROBE_SOURCE]]) {
    assert.doesNotThrow(() => new Function("return " + source), name);
    assert.match(source, /^\(\(\) => \{/, name + " is one IIFE");
  }
  assert.equal(LADDER_RUNGS.length, 3);
  assert.equal(LADDER_RUNGS[1].id, "b");
  return "offline self-test complete: fixtures, verdict, and page sources hold; no Obsidian launched";
}

module.exports = {
  HELP_TEXT,
  LADDER_RUNGS,
  REQUIRED_CHECKS,
  parseArgs,
  fixtureNotes,
  expectedHideSpans,
  placementFailures,
  placementSummary,
  computeVerdict,
  passingReport,
  syntheticProbe,
  ADAPTER_SOURCE,
  PROBE_SOURCE,
  selfTest,
};
