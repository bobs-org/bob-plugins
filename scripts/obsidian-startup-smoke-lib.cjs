#!/usr/bin/env node
// Pure acceptance logic for the Obsidian startup smoke check.
//
// This module never launches Obsidian, never touches the network, and never
// reads the vault. It owns the evidence thresholds and the pass/fail rules so
// `scripts/test-obsidian-startup-smoke.cjs` can test the evidence instead of
// mirroring the orchestration in `scripts/obsidian-startup-smoke.cjs`.
"use strict";

const path = require("node:path");

const LAYOUT_READY_TIMEOUT_MS = 30_000;
const PEAK_HEAP_BYTES = Math.floor(1.5 * 1024 * 1024 * 1024);
const SETTLE_AFTER_STARTUP_MS = 3_000;
const SETTLE_AFTER_EDITORS_MS = 2_000;
const RPC_TIMEOUT_MS = 10_000;
const CONNECT_TIMEOUT_MS = 15_000;

// The four editor cases the rollout gate requires: the canonical daily note
// and one ordinary task note, each in Live Preview and Source mode.
const EXPECTED_EDITOR_CASES = Object.freeze([
  Object.freeze({ file: "2026/20261027.md", mode: "live" }),
  Object.freeze({ file: "2026/20261027.md", mode: "source" }),
  Object.freeze({ file: "tasks/note-a.md", mode: "live" }),
  Object.freeze({ file: "tasks/note-a.md", mode: "source" }),
]);

const HELP_TEXT = [
  "Usage: node scripts/obsidian-startup-smoke.cjs [OPTIONS]",
  "",
  "Run the packaged real-Obsidian plugin rollout smoke check in an isolated",
  "scratch vault and profile. Never opens the live vault in Obsidian.",
  "",
  "Options:",
  "  -d, --deployed-vault PATH   Verify the deployed vault after the smoke run",
  "  -e, --executable PATH       Obsidian executable (default: snap obsidian)",
  "  -h, --help                  Print this help and exit",
  "  -r, --report PATH           Write the structured JSON report to PATH",
  "  -s, --self-test             Run offline self-tests (no Obsidian needed)",
  "",
  "Acceptance (fixed defaults, never relaxed to obtain a pass):",
  `  Layout-ready within ${LAYOUT_READY_TIMEOUT_MS / 1000} seconds of instrumented startup.`,
  `  Sampled peak JS heap below ${formatBytes(PEAK_HEAP_BYTES)} throughout the run.`,
  "  Ledger relation index ready, zero non-Markdown keys, fixture relation",
  "  indexed, zero ledger reads before layout-ready, zero non-Markdown reads.",
  "  All four editor cases (daily + ordinary note x live + source) mount a",
  "  connected CodeMirror editor with the expected document text.",
  "  No renderer crash artifacts/events, plugin-load failures, uncaught",
  "  exceptions/rejections, or editor mount errors.",
  "",
  "The --self-test run is an offline check only, never an Obsidian pass.",
  "The fixture verifies the managed Bob plugin build, not the user's full",
  "third-party plugin/settings combination.",
].join("\n");

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`;
}

function isMarkdownPath(value) {
  const text = typeof value === "string" ? value : value && value.path;
  return typeof text === "string" && /\.md$/iu.test(text);
}

function parseArgs(argv) {
  const args = {
    deployedVault: null,
    executable: null,
    help: false,
    report: null,
    selfTest: false,
  };
  const list = Array.isArray(argv) ? argv.slice() : [];
  for (let index = 0; index < list.length; index += 1) {
    const token = list[index];
    if (token === "-d" || token === "--deployed-vault") {
      const value = list[++index];
      if (!value || value.startsWith("-")) throw new Error("--deployed-vault requires a PATH value");
      args.deployedVault = value;
    } else if (token === "-e" || token === "--executable" || token === "--obsidian-bin") {
      const value = list[++index];
      if (!value || value.startsWith("-")) throw new Error("--executable requires a PATH value");
      args.executable = value;
    } else if (token === "-h" || token === "--help") {
      args.help = true;
    } else if (token === "-r" || token === "--report") {
      const value = list[++index];
      if (!value || value.startsWith("-")) throw new Error("--report requires a PATH value");
      args.report = value;
    } else if (token === "-s" || token === "--self-test") {
      args.selfTest = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

function verifyVaultPath(reportedVaultPath, fixtureRealPath) {
  if (typeof reportedVaultPath !== "string" || typeof fixtureRealPath !== "string") return false;
  if (!reportedVaultPath || !fixtureRealPath) return false;
  const normalizedReported = path.resolve(reportedVaultPath);
  const normalizedFixture = path.resolve(fixtureRealPath);
  return normalizedReported === normalizedFixture;
}

function withTimeout(promise, timeoutMs, label) {
  const safeTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : RPC_TIMEOUT_MS;
  const name = label || "operation";
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${name} timed out after ${safeTimeout} ms`)), safeTimeout);
  });
  return Promise.race([Promise.resolve(promise), timeout]).then(
    (value) => {
      if (timer) clearTimeout(timer);
      return value;
    },
    (error) => {
      if (timer) clearTimeout(timer);
      throw error;
    },
  );
}

// Remove only run-owned temporary paths. Every candidate must live under one
// of the owned roots; anything else is left alone and reported.
function planOwnedCleanup(candidates, ownedRoots) {
  const roots = (Array.isArray(ownedRoots) ? ownedRoots : [])
    .filter((root) => typeof root === "string" && root)
    .map((root) => path.resolve(root) + path.sep);
  const removable = [];
  const skipped = [];
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (typeof candidate !== "string" || !candidate) continue;
    const resolved = path.resolve(candidate);
    if (roots.some((root) => resolved === root.slice(0, -1) || resolved.startsWith(root))) {
      removable.push(resolved);
    } else {
      skipped.push(resolved);
    }
  }
  return { removable, skipped };
}

function checkDeployRows(reportJson, expectedPlugins) {
  const failures = [];
  if (!reportJson || typeof reportJson !== "object" || Array.isArray(reportJson)) {
    return { pass: false, failures: ["deploy report is missing or malformed (expected a JSON object)"] };
  }
  const rows = reportJson.plugins;
  if (!Array.isArray(rows)) {
    return { pass: false, failures: ["deploy report is malformed: missing plugins array"] };
  }
  const byId = new Map();
  for (const row of rows) {
    if (row && typeof row.id === "string") byId.set(row.id, row);
  }
  for (const expected of Array.isArray(expectedPlugins) ? expectedPlugins : []) {
    if (!expected || typeof expected.id !== "string") {
      failures.push("expected plugin entry is malformed");
      continue;
    }
    const row = byId.get(expected.id);
    if (!row) {
      failures.push(`deployed vault is missing plugin ${expected.id}`);
      continue;
    }
    if (typeof row.version !== "string" || !row.version) {
      failures.push(`deployed vault plugin ${expected.id} has a missing or malformed version`);
    } else if (typeof expected.version === "string" && expected.version && row.version !== expected.version) {
      failures.push(`deployed vault plugin ${expected.id} is ${row.version} (want ${expected.version})`);
    }
    if (row.sync !== "synced") {
      failures.push(`deployed vault plugin ${expected.id} sync is ${JSON.stringify(row.sync)} (want "synced")`);
    }
    if (row && typeof row === "object" && (row.id == null || row.version == null || row.sync == null)) {
      failures.push(`deployed vault plugin ${expected.id} row is malformed (missing id/version/sync)`);
    }
  }
  return { pass: failures.length === 0, failures };
}

function normalizeObservation(input) {
  const obs = input && typeof input === "object" ? input : {};
  return {
    executable: typeof obs.executable === "string" ? obs.executable : "",
    appVersion: obs.appVersion == null ? null : obs.appVersion,
    sourceSha: typeof obs.sourceSha === "string" ? obs.sourceSha : "",
    layoutReadyMs: Number.isFinite(obs.layoutReadyMs) ? obs.layoutReadyMs : null,
    layoutReadyTimeoutMs: Number.isFinite(obs.layoutReadyTimeoutMs) ? obs.layoutReadyTimeoutMs : LAYOUT_READY_TIMEOUT_MS,
    hookInstalled: obs.hookInstalled === true,
    hookEarly: obs.hookEarly === true,
    plugins: Array.isArray(obs.plugins) ? obs.plugins : null,
    expectedPlugins: Array.isArray(obs.expectedPlugins) ? obs.expectedPlugins : [],
    heapPeakBytes: Number.isFinite(obs.heapPeakBytes) ? obs.heapPeakBytes : null,
    heapLimitBytes: Number.isFinite(obs.heapLimitBytes) ? obs.heapLimitBytes : PEAK_HEAP_BYTES,
    heapSamples: Array.isArray(obs.heapSamples) ? obs.heapSamples : [],
    relation: obs.relation && typeof obs.relation === "object" ? obs.relation : {},
    editors: Array.isArray(obs.editors) ? obs.editors : null,
    runtime: obs.runtime && typeof obs.runtime === "object" ? obs.runtime : {},
    crashes: obs.crashes && typeof obs.crashes === "object" ? obs.crashes : {},
    deploy: obs.deploy && typeof obs.deploy === "object" ? obs.deploy : null,
    vaultPath: obs.vaultPath == null ? null : obs.vaultPath,
    fixturePath: obs.fixturePath == null ? null : obs.fixturePath,
    crashObservationMethod:
      typeof obs.crashObservationMethod === "string" ? obs.crashObservationMethod : "",
  };
}

function evaluateSmoke(input) {
  const obs = normalizeObservation(input);
  const failures = [];

  // Vault scoping: the renderer under test must be the owned fixture.
  if (obs.fixturePath != null || obs.vaultPath != null) {
    if (!verifyVaultPath(obs.vaultPath, obs.fixturePath)) {
      failures.push("renderer vault path does not match the generated fixture (wrong vault or reused profile)");
    }
  }

  // 1. Layout-ready within the fixed timeout with all expected plugins loaded.
  if (!obs.hookInstalled) {
    failures.push("instrumentation hook was not installed; zero counters do not establish a pass");
  } else if (!obs.hookEarly) {
    failures.push("instrumentation hook was installed too late to observe plugin startup");
  }
  if (!Number.isFinite(obs.layoutReadyMs)) {
    failures.push("layout-ready was never observed (missing or non-finite timing)");
  } else if (obs.layoutReadyMs > obs.layoutReadyTimeoutMs) {
    failures.push(
      `layout-ready took ${Math.round(obs.layoutReadyMs)} ms (budget ${obs.layoutReadyTimeoutMs} ms)`,
    );
  }
  if (!Array.isArray(obs.plugins)) {
    failures.push("plugin load state is missing (unrun check)");
  } else {
    for (const expected of obs.expectedPlugins) {
      const found = obs.plugins.find((item) => item && item.id === expected.id);
      if (!found || found.loaded !== true) {
        failures.push(`expected plugin ${expected.id} was not loaded`);
        continue;
      }
      if (expected.version && found.version !== expected.version) {
        failures.push(`plugin ${expected.id} is ${found.version || "unknown"} (want ${expected.version})`);
      }
    }
    const loadErrors = Array.isArray(obs.runtime.pluginLoadErrors) ? obs.runtime.pluginLoadErrors : [];
    for (const error of loadErrors) {
      failures.push(`plugin-load failure: ${String(error).slice(0, 200)}`);
    }
  }

  // 2. Ledger relation index.
  const relation = obs.relation || {};
  if (relation.ready !== true) {
    failures.push("ledger relation index was not ready");
  }
  const nonMdKeys = Number.isFinite(relation.nonMdKeys) ? relation.nonMdKeys : null;
  if (nonMdKeys == null) {
    failures.push("relation index non-Markdown key count is missing (unrun check)");
  } else if (nonMdKeys !== 0) {
    failures.push(`relation index holds ${nonMdKeys} non-Markdown keys (want 0)`);
  }
  if (relation.fixtureRelationIndexed !== true) {
    failures.push("fixture task relation was not indexed (empty-index pass is inadequate)");
  }
  const readsBefore = Number.isFinite(relation.readsBeforeLayoutReady) ? relation.readsBeforeLayoutReady : null;
  if (readsBefore == null) {
    failures.push("ledger reads-before-layout-ready counter is missing (unrun check)");
  } else if (readsBefore !== 0) {
    failures.push(`ledger made ${readsBefore} reads before layout-ready (want 0)`);
  }
  const nonMdReads = Number.isFinite(relation.nonMdReads) ? relation.nonMdReads : null;
  if (nonMdReads == null) {
    failures.push("ledger non-Markdown read counter is missing (unrun check)");
  } else if (nonMdReads !== 0) {
    failures.push(`ledger made ${nonMdReads} non-Markdown reads (want 0)`);
  }

  // 3. Sampled peak heap throughout the run, not just a final sample.
  if (!Array.isArray(obs.heapSamples) || obs.heapSamples.length === 0) {
    failures.push("no JS heap samples were collected (unrun check)");
  }
  if (!Number.isFinite(obs.heapPeakBytes)) {
    failures.push("sampled peak JS heap is missing or non-finite (unrun check)");
  } else if (obs.heapPeakBytes >= obs.heapLimitBytes) {
    failures.push(
      `sampled peak JS heap is ${formatBytes(obs.heapPeakBytes)} (budget below ${formatBytes(obs.heapLimitBytes)})`,
    );
  }

  // 4. All four editor cases through the real workspace/Markdown view.
  if (!Array.isArray(obs.editors)) {
    failures.push("editor mount checks are missing (unrun check)");
  } else {
    for (const expected of EXPECTED_EDITOR_CASES) {
      const found = obs.editors.find((item) => item && item.file === expected.file && item.mode === expected.mode);
      if (!found) {
        failures.push(`editor case missing: ${expected.file} in ${expected.mode} mode`);
        continue;
      }
      if (found.opened !== true) {
        failures.push(`editor case failed: ${expected.file} in ${expected.mode} mode did not open`);
        continue;
      }
      if (found.correctPath !== true) {
        failures.push(`editor case failed: ${expected.file} in ${expected.mode} mode opened the wrong path`);
      }
      if (found.correctMode !== true) {
        failures.push(`editor case failed: ${expected.file} in ${expected.mode} mode is in the wrong mode`);
      }
      if (found.editorConnected !== true) {
        failures.push(`editor case failed: ${expected.file} in ${expected.mode} mode has no connected CodeMirror editor`);
      }
      if (found.textMatches !== true) {
        failures.push(`editor case failed: ${expected.file} in ${expected.mode} mode text does not match`);
      }
      if (found.mountError) {
        failures.push(`editor case failed: ${expected.file} in ${expected.mode} mode: ${String(found.mountError).slice(0, 200)}`);
      }
    }
    // A successful openFile return alone is not success: an old editor still
    // present or a Reading-view leaf must fail.
    for (const item of obs.editors) {
      if (item && item.opened === true && item.readingView === true) {
        failures.push(`editor case failed: ${item.file} in ${item.mode} mode is a Reading-view leaf`);
      }
      if (item && item.opened === true && item.staleEditor === true) {
        failures.push(`editor case failed: ${item.file} in ${item.mode} mode kept a stale editor`);
      }
      if (item && typeof item.swallowedMountError === "string" && item.swallowedMountError) {
        failures.push(`editor mount error was swallowed: ${item.file} in ${item.mode} mode: ${item.swallowedMountError.slice(0, 200)}`);
      }
    }
  }

  // 5. No crashes, exceptions, rejections, or mount errors.
  if (!obs.crashObservationMethod) {
    failures.push("crash observation method was not recorded (unrun check)");
  }
  const artifacts = Array.isArray(obs.crashes.artifacts) ? obs.crashes.artifacts : null;
  if (artifacts == null) {
    failures.push("renderer crash artifact check is missing (unrun check)");
  } else if (artifacts.length > 0) {
    failures.push(`renderer crash artifacts: ${artifacts.slice(0, 3).join(", ")}`);
  }
  const crashEvents = Array.isArray(obs.crashes.events) ? obs.crashes.events : [];
  for (const event of crashEvents) {
    failures.push(`renderer crash event: ${String(event).slice(0, 200)}`);
  }
  const exits = Array.isArray(obs.crashes.processExits) ? obs.crashes.processExits : [];
  for (const exit of exits) {
    failures.push(`owned Obsidian process exited unexpectedly: ${String(exit).slice(0, 200)}`);
  }
  const exceptions = Array.isArray(obs.runtime.exceptions) ? obs.runtime.exceptions : null;
  if (exceptions == null) {
    failures.push("uncaught exception collection is missing (unrun check)");
  } else {
    for (const error of exceptions) {
      failures.push(`uncaught renderer exception: ${String(error).slice(0, 200)}`);
    }
  }
  const rejections = Array.isArray(obs.runtime.rejections) ? obs.runtime.rejections : null;
  if (rejections == null) {
    failures.push("unhandled rejection collection is missing (unrun check)");
  } else {
    for (const error of rejections) {
      failures.push(`unhandled renderer rejection: ${String(error).slice(0, 200)}`);
    }
  }
  const consoleErrors = Array.isArray(obs.runtime.consoleErrors) ? obs.runtime.consoleErrors : [];
  for (const error of consoleErrors) {
    failures.push(`renderer console error: ${String(error).slice(0, 200)}`);
  }

  // Deployment match, when the gate ran one.
  if (obs.deploy) {
    const result = checkDeployRows(obs.deploy.report, obs.deploy.expected || obs.expectedPlugins);
    for (const failure of result.failures) failures.push(failure);
  }

  return { pass: failures.length === 0, failures };
}

module.exports = {
  CONNECT_TIMEOUT_MS,
  EXPECTED_EDITOR_CASES,
  HELP_TEXT,
  LAYOUT_READY_TIMEOUT_MS,
  PEAK_HEAP_BYTES,
  RPC_TIMEOUT_MS,
  SETTLE_AFTER_EDITORS_MS,
  SETTLE_AFTER_STARTUP_MS,
  checkDeployRows,
  evaluateSmoke,
  formatBytes,
  isMarkdownPath,
  normalizeObservation,
  parseArgs,
  planOwnedCleanup,
  verifyVaultPath,
  withTimeout,
};
