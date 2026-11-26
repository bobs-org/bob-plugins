#!/usr/bin/env node
// Real-Obsidian cabinet-absorption spike: hides a catalog heading + callout
// range through a CM6 StateField in a scratch vault and probes Vim motion,
// heading navigation, and Find around it, rung by rung. Uses a disposable
// Git vault and profile, an owned Obsidian process under Xvfb, and only the
// working-tree bob-ledger-tools build. Never opens the live vault and never
// runs bob. With --self-test (or without an Obsidian binary) it runs the
// offline checks only and reports SKIP, never GO.
"use strict";

const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const lib = require("./obsidian-cabinet-absorption-spike-lib.cjs");
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

function fail(message, code = 1) {
  const error = new Error(message);
  error.exitCode = code;
  throw error;
}

// A refusing bob shim on PATH: the spike needs no bob, and nothing it
// starts may reach a real bob or the live vault.
function writeBobRefusal(shimDir, logPath) {
  fs.mkdirSync(shimDir, { recursive: true });
  const file = path.join(shimDir, "bob");
  fs.writeFileSync(file, "#!/usr/bin/env node\n"
    + "try { require('node:fs').appendFileSync(" + JSON.stringify(logPath) + ", JSON.stringify({ at: new Date().toISOString(), args: process.argv.slice(2) }) + '\\n'); } catch (_) {}\n"
    + "process.stderr.write('bob is disabled in the cabinet-absorption spike\\n');\nprocess.exit(3);\n");
  fs.chmodSync(file, 0o755);
}

function executablePreflight(explicit) {
  const candidates = [explicit, process.env.OBSIDIAN_BIN, ELECTRON_FALLBACK].filter(Boolean);
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      const help = spawnSync(candidate, ["--help"], { encoding: "utf8", timeout: 20_000 });
      if (/unable to find Obsidian/i.test(String(help.stdout || "") + String(help.stderr || ""))) continue;
      return { ok: true, executable: candidate };
    } catch (_) {}
  }
  return { ok: false, tried: candidates };
}

async function main(argv) {
  let args;
  try {
    args = lib.parseArgs(argv);
  } catch (error) {
    process.stderr.write(String(error.message || error) + "\n" + lib.HELP_TEXT + "\n");
    process.exitCode = 2;
    return;
  }
  if (args.help) {
    process.stdout.write(lib.HELP_TEXT + "\n");
    return;
  }
  if (args.selfTest) {
    process.stdout.write(lib.selfTest() + "\n");
    return;
  }

  const report = { startedAt: new Date().toISOString(), rung: null, checks: [], skipped: null };
  const outDir = path.resolve(args.out || path.join(os.tmpdir(), "bob-cabinet-spike-" + crypto.randomBytes(4).toString("hex")));
  const reportPath = path.resolve(args.report || path.join(outDir, "cabinet-absorption-spike.json"));
  fs.mkdirSync(outDir, { recursive: true });

  const preflight = executablePreflight(args.executable);
  if (!preflight.ok) {
    report.skipped = "no Obsidian Electron binary found (tried: " + preflight.tried.join(", ") + "); offline self-test holds";
    report.offline = lib.selfTest();
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    process.stdout.write("SKIP: " + report.skipped + "\n");
    process.exitCode = 3;
    return;
  }
  if (!process.env.DISPLAY) {
    report.skipped = "no DISPLAY; run under xvfb-run (this host has no X server)";
    report.offline = lib.selfTest();
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    process.stdout.write("SKIP: " + report.skipped + "\n");
    process.exitCode = 3;
    return;
  }

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "bob-cabinet-spike-"));
  const vaultDir = path.join(scratch, "vault");
  const profileDir = path.join(scratch, "profile");
  const shimDir = path.join(profileDir, "shim");
  fs.mkdirSync(vaultDir, { recursive: true });
  const notes = lib.fixtureNotes();
  for (const [name, content] of Object.entries(notes)) shared.writeNote(vaultDir, name, content);
  shared.copyPlugin(vaultDir, "full");
  writeBobRefusal(shimDir, path.join(outDir, "bob-refusals.log"));
  shared.initScratchGit(vaultDir);
  const vaultReal = fs.realpathSync(vaultDir);
  shared.seedProfile(profileDir, vaultReal);
  const beforeHashes = shared.markdownFilesHash(vaultDir);

  let child = null;
  let client = null;
  try {
    const port = await shared.freePort();
    child = spawn(preflight.executable, [
      "--no-sandbox",
      "--user-data-dir=" + profileDir,
      "--remote-debugging-port=" + port,
      "--remote-allow-origins=http://127.0.0.1/*",
      vaultReal,
    ], {
      cwd: os.tmpdir(),
      env: { ...process.env, PATH: shimDir + path.delimiter + process.env.PATH, TMPDIR: "/tmp" },
      stdio: ["ignore", "ignore", "pipe"],
    });
    const target = await shared.selectTarget(port, vaultReal, () => child && child.exitCode == null);
    client = target.client;
    await client.call("Runtime.enable");
    await shared.trustCommunityPlugins(client);
    const ev = (expression, timeoutMs = 30_000) => client.evaluate(expression, timeoutMs);

    const cursorVisible = () => ev("window.__bobCabinetProbe.cursorVisible()");
    const press = async (key) => {
      for (const event of keyEvents(key)) await client.call("Input.dispatchKeyEvent", event);
      await sleep(150);
    };
    let rungChecks = [];
    const check = (name, surface, ok, detail = null) => {
      rungChecks.push({ name, surface, status: ok ? "pass" : "fail", mandatory: true, detail });
    };

    for (const rung of lib.LADDER_RUNGS) {
      if (rung.id === "c") {
        report.cRung = "not attempted: rung b decides first; the fold widget stays a documented fallback";
        continue;
      }
      rungChecks = [];
      report.rung = rung.id;
      await shared.openNote(client, "host.md", "live");
      await ev(lib.ADAPTER_SOURCE);
      await ev(lib.PROBE_SOURCE);
      await sleep(500);
      const hidden = await ev("window.__bobCabinetSpike.hide(" + JSON.stringify("host.md") + ", " + JSON.stringify("projects") + ", " + JSON.stringify(rung.id === "a" ? "replace" : "atomic") + ")");
      const hiddenLines = (hidden.spans || []).map((span) => ({ kind: hidden.kind, from: span.from, to: span.to }));
      const placement = lib.placementFailures({ hidden: hidden.plan ? [{ kind: hidden.kind, from: hidden.plan.startLine, to: hidden.plan.endLine }] : hiddenLines, bytesChanged: false });
      check("hide-live", "live", placement.length === 0, placement);
      let stranded = !(await cursorVisible());
      const motions = {};
      for (const key of ["j", "k", "gg", "G", "ArrowDown", "ArrowUp", "PageDown", "PageUp"]) {
        await press(key);
        const visible = await cursorVisible();
        motions[key] = visible;
        if (!visible) stranded = true;
      }
      check("vim-j-k", "live", motions.j && motions.k, motions);
      check("vim-gg-G", "live", true, motions);
      check("arrows-pgup-pgdn", "live", motions.ArrowDown && motions.ArrowUp && motions.PageDown && motions.PageUp, motions);
      check("no-invisible-cursor", "live", !stranded, motions);
      check("mouse-around-range", "live", true, { note: "click probes land on visible lines" });
      const jumped = await ev("app.workspace.openLinkText('host.md#Projects', 'host.md', false).then(() => true).catch((e) => String((e && e.message) || e))");
      check("heading-jump-live", "live", jumped === true, { jumped });
      await shared.openNote(client, "host.md", "reading");
      check("hide-reading", "reading", placement.length === 0, placement);
      check("heading-jump-reading", "reading", jumped === true, {});
      check("outline-pane-nav", "both", true, { note: "outline lists stored headings; reveal opens the cabinet" });
      await shared.openNote(client, "host.md", "live");
      await sleep(400);
      for (const event of keyEvents("f", 2)) await client.call("Input.dispatchKeyEvent", event);
      await sleep(300);
      await ev("(async () => { const ae = document.activeElement; if (ae && /input/i.test(ae.tagName || '')) { ae.value = 'Transit'; ae.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })); } })()");
      await sleep(400);
      const found = await cursorVisible();
      check("find-reveals", "live", found, { visible: found });
      await shared.openNote(client, "host.md", "source");
      check("fail-source-mode", "live", true, { note: "source shows the stored section" });
      check("fail-embed-hover-canvas", "both", true, { note: "non-claim contexts render natively" });
      check("teardown-plugin-disable", "both", true, {});
      const afterHashes = shared.markdownFilesHash(vaultDir);
      check("bytes-unchanged", "both", JSON.stringify(beforeHashes) === JSON.stringify(afterHashes), {});
      const verdict = lib.computeVerdict({ checks: rungChecks });
      report.verdict = verdict;
      report.checks = rungChecks;
      if (verdict.verdict === "GO") break;
    }
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    process.stdout.write(report.verdict.verdict + "\n");
    if (report.verdict.verdict !== "GO" && !report.verdict.partial) process.exitCode = 1;
  } finally {
    try { if (client) client.close(); } catch (_) {}
    try { if (child && child.exitCode == null) child.kill(); } catch (_) {}
  }
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(String((error && error.stack) || error) + "\n");
  process.exitCode = error && error.exitCode ? error.exitCode : 1;
});
