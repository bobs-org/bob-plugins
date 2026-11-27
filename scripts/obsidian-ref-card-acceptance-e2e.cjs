#!/usr/bin/env node
// Real-Obsidian acceptance for Ref Cards. This is a sibling runner: it reuses
// the family takeover fixtures/verdict helpers and the shared record-card CDP
// harness, while keeping the Ref-specific claims and screenshot matrix here.
// All app state lives in a disposable profile and Git vault.
"use strict";

const { spawn } = require("node:child_process");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const takeover = require("./obsidian-frontmatter-takeover-e2e-lib.cjs");
const homeCards = require("./obsidian-home-cards-e2e-lib.cjs");
const shared = require("./obsidian-record-card-e2e.cjs");

const REPO_ROOT = path.resolve(__dirname, "..");
const FIXTURE_ROOT = path.join(__dirname, "fixtures", "ref-cards");
const PLUGIN_ID = "bob-ledger-tools";
const ELECTRON_FALLBACK = "/snap/obsidian/current/app/obsidian";
const SAMPLE_CARDS = Object.freeze([
  ["finished-blog", "ref/ref-finished-blog.md"],
  ["next-paper", "ref/ref-arxiv-paper.md"],
  ["blocked-report", "ref/ref-blocked-chat.md"],
  ["legacy-book", "ref/ref-legacy-book.md"],
  ["compact", "ref/ref-finished-blog.md"],
]);
const NONCLAIMS = Object.freeze([
  "sase_ref.md", "ref/ref-mixed-type.md", "ref/ref-sample.assets/note.md",
  "ref_history/old-capture.md", "ref_history/attention-flyby.md",
]);
const FAMILY_SAMPLES = Object.freeze([
  ["family-album", takeover.PATHS.album],
  ["family-notebook", "notebook.md"],
  ["family-prose", "prose.md"],
  ["family-area", homeCards.PATHS.area],
]);
const MODE_STATE = Object.freeze({
  live: { mode: "source", source: false },
  source: { mode: "source", source: true },
  reading: { mode: "preview", source: false },
});

function parseArgs(argv) {
  const args = { executable: null, out: null, report: null, selfTest: false, help: false };
  const values = Array.isArray(argv) ? argv.slice() : [];
  const value = (flag, label, index) => {
    const next = values[index];
    if (!next || next.startsWith("-")) throw new Error(flag + " requires a " + label + " value");
    return next;
  };
  for (let i = 0; i < values.length; i += 1) {
    const flag = values[i];
    if (flag === "-e" || flag === "--executable") args.executable = value(flag, "path", ++i);
    else if (flag === "-o" || flag === "--out") args.out = value(flag, "directory", ++i);
    else if (flag === "-r" || flag === "--report") args.report = value(flag, "path", ++i);
    else if (flag === "-s" || flag === "--self-test") args.selfTest = true;
    else if (flag === "-h" || flag === "--help") args.help = true;
    else throw new Error("Unknown argument: " + flag);
  }
  return args;
}

function fixtureEntries() {
  const entries = [];
  const walk = (directory) => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, item.name);
      if (item.isDirectory()) walk(full);
      else if (item.isFile() && item.name.endsWith(".md")) {
        const relative = path.relative(FIXTURE_ROOT, full).split(path.sep).join("/");
        const target = relative === "sase_ref.md" || relative.startsWith("ref_history/")
          ? relative
          : relative === "ref-reread-v1.md" ? "ref/papers/attention-is-all-you-need__v1.md"
            : relative === "ref-reread-v2.md" ? "ref/papers/attention-is-all-you-need__v2.md"
              : relative === "ref-earlier-replaced.md" ? "ref_history/attention-flyby.md"
                : "ref/" + relative;
        entries.push([target, fs.readFileSync(full, "utf8")]);
      }
    }
  };
  walk(FIXTURE_ROOT);
  return Object.fromEntries(entries);
}

function fixtureBinaryEntries() {
  const header = Buffer.from("%PDF-1.4\n%Ref Card acceptance fixture\n", "ascii");
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] /Resources << >> /Contents 4 0 R >>\nendobj\n",
    "4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n",
  ].map((value) => Buffer.from(value, "ascii"));
  const offsets = [];
  let offset = header.length;
  for (const object of objects) {
    offsets.push(offset);
    offset += object.length;
  }
  const xrefOffset = offset;
  const xref = ["xref\n0 5\n", "0000000000 65535 f \n"]
    .concat(offsets.map((value) => String(value).padStart(10, "0") + " 00000 n \n"))
    .join("");
  const trailer = `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  const pdf = Buffer.concat([header, ...objects, Buffer.from(xref + trailer, "ascii")]);
  return {
    "lib/agentic-coding-ci.pdf": pdf,
    "lib/attention-is-all-you-need.pdf": pdf,
    "lib/agentic-coding-ci.mp3": Buffer.from("ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000", "binary"),
  };
}

function familyFixtureEntries() {
  const home = homeCards.fixtureNotes();
  return {
    [homeCards.PATHS.area]: home[homeCards.PATHS.area],
    "notebook.md": fs.readFileSync(path.join(__dirname, "fixtures", "note-cards", "notebook-parent.md"), "utf8"),
    "prose.md": fs.readFileSync(path.join(__dirname, "fixtures", "note-cards", "prose-with-title.md"), "utf8"),
  };
}

function supportingTaskNotes() {
  return {
    "memory.md": [
      "---", 'type: "[[area]]"', 'parent: "[[sase]]"', "---", "", "# Memory", "", "## Tasks", "",
      "- [*] #task #ref [[ref/ref-next-chat|Shrinking SASE agent instruction files]] [priority:: high] ^ref-shrinking-sase",
      "- [*] #task #ref [[ref/ref-arxiv-paper|Attention Is All You Need]] ^ref-attention", "",
      "- [?] #task #ref [[ref/ref-blocked-chat|SASE memory router blocked on ledger scan]] [dependsOn:: sase__ref-ledger-scan] ^ref-memory-router", "",
    ].join("\n"),
    "sase.md": [
      "---", 'type: "[[area]]"', "---", "", "# SASE", "", "## Tasks", "",
      "- [ ] #task Complete the synthetic ledger scan [id:: sase__ref-ledger-scan] ^ref-ledger-scan", "",
    ].join("\n"),
    "daily/2026-11-27.md": [
      "---", 'type: "[[day]]"', "date: 2026-11-27", "---", "", "# 2026-11-27", "", "## Tasks", "",
      "- [?] #task #ref [[ref/ref-blocked-paper|Scheduled reading blocked on review]] [scheduled:: 2026-12-03]", "",
    ].join("\n"),
    "sase_pypi_releases.md": ["---", 'type: "[[project]]"', "---", "", "# SASE PyPI releases", ""].join("\n"),
    "done/sase_pypi_releases_done.md": [
      "---", 'parent: "[[sase_pypi_releases]]"', "---", "", "# SASE PyPI releases · done", "",
      "- [x] #task #ref [[ref/ref-finished-blog|Agentic coding is straining CI]] #hide ^ref-agentic-coding-ci [completion:: 2026-10-23]", "",
    ].join("\n"),
  };
}

function eligibleFixturePaths(notes = fixtureEntries()) {
  return Object.keys(notes).filter((name) => name.startsWith("ref/") &&
    /^type:\s*["']?\[\[ref\]\]["']?\s*$/m.test(notes[name].split(/^---\s*$/m)[1] || ""))
    .filter((name) => !name.endsWith(".assets/note.md") && name !== "ref/ref-bad-yaml.md");
}

function screenshotMatrix() {
  const rows = [];
  for (const [label, notePath] of SAMPLE_CARDS) {
    for (const mode of ["live", "reading"]) {
      for (const theme of ["light", "dark"]) {
        for (const [widthName, width] of [["narrow", 420], ["wide", 1400]]) {
          rows.push({ name: `${label}-${mode}-${theme}-${widthName}`, label, notePath, mode, theme, width });
        }
      }
    }
  }
  rows.push(
    { name: "species-forced-colors", label: "forced-colors", notePath: SAMPLE_CARDS[0][1], mode: "live", theme: "light", width: 1400 },
    { name: "species-grayscale", label: "grayscale", notePath: SAMPLE_CARDS[0][1], mode: "live", theme: "light", width: 1400 },
    { name: "native-source-recovery", label: "recovery", notePath: SAMPLE_CARDS[0][1], mode: "source", theme: "light", width: 1400 },
  );
  for (const [label, notePath] of FAMILY_SAMPLES) {
    for (const theme of ["light", "dark"]) {
      rows.push({ name: `${label}-${theme}-wide`, label, notePath, mode: "live", theme, width: 1400 });
    }
  }
  return rows;
}

function matchingHeadingExpected(note) {
  const frontmatter = note.split(/^---\s*$/m)[1] || "";
  const title = /^title:\s*["']?(.*?)["']?\s*$/m.exec(frontmatter)?.[1]?.trim() || "";
  const heading = /^#\s+(.+?)\s*$/m.exec(note.split(/^---\s*$/m).slice(2).join("---"))?.[1]?.trim() || "";
  return Boolean(heading && (!title || title === heading));
}

function selfTest() {
  const notes = fixtureEntries();
  for (const required of NONCLAIMS) assert.ok(Object.hasOwn(notes, required), "non-claim fixture missing: " + required);
  const eligible = eligibleFixturePaths(notes);
  assert.ok(eligible.length >= 12, "expected the complete ref fixture family");
  assert.ok(!eligible.includes("ref/ref-mixed-type.md"), "mixed type must not claim a card");
  assert.ok(!eligible.includes("ref/ref-sample.assets/note.md"), "assets folder must not claim a card");
  assert.equal(matchingHeadingExpected(notes["ref/ref-finished-blog.md"]), true);
  assert.equal(matchingHeadingExpected(notes["ref/ref-title-mismatch.md"]), false);
  assert.equal(matchingHeadingExpected(notes["ref/ref-no-title.md"]), false);
  assert.equal(Object.keys(fixtureBinaryEntries()).length, 3);
  assert.ok(fixtureBinaryEntries()["lib/attention-is-all-you-need.pdf"].includes(Buffer.from("startxref")));
  assert.deepEqual(Object.keys(familyFixtureEntries()).sort(), ["dev.md", "notebook.md", "prose.md"]);
  assert.equal(screenshotMatrix().filter((row) => row.name.endsWith("-narrow")).length, 20);
  assert.equal(screenshotMatrix().filter((row) => !["forced-colors", "grayscale", "recovery"].includes(row.label)
    && !row.label.startsWith("family-")).length, 40);
  assert.equal(screenshotMatrix().length, 51);
  assert.equal(typeof takeover.nativeFailures, "function");
  assert.equal(typeof shared.CdpClient, "function");
  assert.throws(() => parseArgs(["--bogus"]), /Unknown argument/);
  assert.throws(() => parseArgs(["--out"]), /requires/);
  assert.doesNotThrow(() => parseArgs(["--self-test", "--out", "/tmp/ref-card-evidence"]));
  return true;
}

function writePlugin(vaultDir) {
  const obsidian = path.join(vaultDir, ".obsidian");
  const pluginDir = path.join(obsidian, "plugins", PLUGIN_ID);
  fs.mkdirSync(pluginDir, { recursive: true });
  for (const file of ["manifest.json", "main.js", "styles.css"]) {
    fs.copyFileSync(path.join(REPO_ROOT, "plugins", PLUGIN_ID, file), path.join(pluginDir, file));
  }
  fs.writeFileSync(path.join(obsidian, "community-plugins.json"), JSON.stringify([PLUGIN_ID], null, 2));
  fs.writeFileSync(path.join(obsidian, "core-plugins.json"), JSON.stringify([
    "file-explorer", "command-palette", "page-preview", "properties", "canvas",
  ], null, 2));
  fs.writeFileSync(path.join(obsidian, "app.json"), JSON.stringify({
    livePreview: true, showInlineTitle: true, propertiesInDocument: "visible", readableLineLength: true,
    vimMode: true, alwaysUpdateLinks: false,
  }, null, 2));
  fs.writeFileSync(path.join(obsidian, "appearance.json"), JSON.stringify({ cssTheme: "", theme: "moonstone" }, null, 2));
  fs.writeFileSync(path.join(pluginDir, "data.json"), JSON.stringify({ albumChips: true, refCardPreview: true }, null, 2));
}

function writeBobShim(shimDir, logPath, realBob) {
  fs.mkdirSync(shimDir, { recursive: true });
  const shim = path.join(shimDir, "bob");
  fs.writeFileSync(shim, `#!/usr/bin/env node
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
const real = ${JSON.stringify(realBob)};
const log = ${JSON.stringify(logPath)};
const append = (row) => { try { fs.appendFileSync(log, JSON.stringify(row) + "\\n"); } catch (_) {} };
append({ at: new Date().toISOString(), args });
const result = spawnSync(real, args, { encoding: "utf8", env: process.env, timeout: 90000, maxBuffer: 32 * 1024 * 1024 });
append({ at: new Date().toISOString(), args, exitCode: result.status });
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status == null ? 1 : result.status);
`);
  fs.chmodSync(shim, 0o755);
  return shim;
}

function probeExpression(leafId, notePath) {
  return `(() => {
    const leaf = app.workspace.getLeafById(${JSON.stringify(leafId)});
    const view = leaf?.view;
    const path = ${JSON.stringify(notePath)};
    const mode = view?.getMode?.() === "preview" ? "reading"
      : view?.getState?.()?.source === true ? "source" : "live";
    const scope = mode === "reading" ? view?.previewMode?.containerEl : view?.editor?.cm?.dom;
    if (!scope) return { path, mode, scopePresent: false };
    const inBody = (node) => !node.closest?.(".markdown-embed, .internal-embed");
    const cards = Array.from(scope.querySelectorAll(".bob-ref-card[data-ref-source]")).filter((node) =>
      node.getAttribute("data-ref-source") === path && inBody(node));
    const card = cards[0] || null;
    const native = Array.from(scope.querySelectorAll(".metadata-container")).find(inBody) || null;
    const visible = (node) => {
      if (!node) return false;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const heading = card?.querySelector(".bob-property-card-title, h1, h2") || null;
    const embeds = Array.from(scope.querySelectorAll(".markdown-embed, .internal-embed")).filter((node) => !card?.contains(node));
    const headingNodes = Array.from(scope.querySelectorAll("h1, .cm-header-1"));
    const expectedTitle = heading?.textContent?.trim() || "";
    const matchingH1 = headingNodes.find((node) => node.textContent?.trim() === expectedTitle) || null;
    return {
      path, mode, scopePresent: true, cardCount: cards.length,
      cardPresent: Boolean(card), cardInEmbed: Boolean(card?.closest(".markdown-embed, .internal-embed")),
      title: expectedTitle, titlePresent: Boolean(heading),
      footPresent: Boolean(card?.querySelector(".bob-property-card-foot, .bob-ref-card-lint-slot")),
      laneText: card?.querySelector(".bob-ref-card-lane")?.textContent?.trim() || "",
      versionText: card?.querySelector("[data-ref-version]")?.textContent?.trim() || "",
      identifiersText: card?.querySelector("[data-ref-identifiers]")?.textContent?.trim() || "",
      annotationsText: card?.querySelector(".bob-ref-card-annotations")?.textContent?.trim() || "",
      titleHidden: matchingH1 ? !visible(matchingH1) : null,
      h1Count: headingNodes.length,
      h1Rows: headingNodes.map((node) => ({ text: node.textContent?.trim() || "", visible: visible(node) })),
      nativePresent: Boolean(native), nativeVisible: visible(native),
      nativeInert: native?.inert === true, nativeAriaHidden: native?.getAttribute("aria-hidden") || null,
      embedCount: embeds.length, visibleEmbedCount: embeds.filter(visible).length,
      cardClasses: card ? String(card.className || "") : "",
      access: card ? Array.from(card.querySelectorAll("[data-ref-pdf], [data-ref-audio]"))
        .map((node) => ({ pdf: node.hasAttribute("data-ref-pdf"), audio: node.hasAttribute("data-ref-audio"), target: node.getAttribute("data-ref-pdf") || node.getAttribute("data-ref-audio") || "", label: node.getAttribute("aria-label") || node.textContent?.trim() || "" })) : [],
      lintText: card?.querySelector(".bob-ref-card-lint-slot")?.textContent?.trim() || "",
      drawerKeys: card ? Array.from(card.querySelectorAll(".bob-property-card-foot-drawer [data-property-key]"))
        .map((node) => node.getAttribute("data-property-key")) : [],
    };
  })()`;
}

function installWriteAuditExpression(paths) {
  return `(() => {
    const audit = { rows: [], restores: [] };
    const watched = new Set(${JSON.stringify(paths)});
    const pathOf = (value) => String(value?.path ?? value ?? "").replace(/\\\\/g, "/");
    const wrap = (owner, name, index = 0) => {
      if (!owner || typeof owner[name] !== "function") return;
      const original = owner[name];
      const wrapped = function(...args) {
        const path = pathOf(args[index]);
        if (watched.has(path)) audit.rows.push({ api: name, path, at: new Date().toISOString() });
        return original.apply(this, args);
      };
      owner[name] = wrapped;
      audit.restores.push(() => { if (owner[name] === wrapped) owner[name] = original; });
    };
    wrap(app.vault, "modify"); wrap(app.vault, "process");
    wrap(app.fileManager, "processFrontMatter"); wrap(app.vault.adapter, "write");
    wrap(app.vault.adapter, "writeBinary");
    window.__bobRefAcceptanceWriteAudit = audit;
    return audit.restores.length;
  })()`;
}

function sha256(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }

async function run(args) {
  const outDir = path.resolve(args.out || path.join(os.tmpdir(), "bob-ref-card-acceptance-" + crypto.randomBytes(4).toString("hex")));
  const reportPath = path.resolve(args.report || path.join(outDir, "ref-card-acceptance-report.json"));
  const report = {
    startedAt: new Date().toISOString(), profile: "ref-card", verdict: "NO-GO",
    checks: [], prerequisites: [], screenshots: [], consoleExceptions: [], consoleErrors: [],
    requiredScope: ["takeover", "single-owner", "native-restoration", "capability", "data", "editor", "keys-and-focus", "passive", "screenshots"],
    visualReview: "pending",
    outDir, reportPath,
  };
  let scratch = "";
  let child = null;
  let client = null;
  const check = (name, ok, detail = null) => {
    report.checks.push({ name, status: ok ? "pass" : "fail", detail });
    if (!ok) process.stderr.write("[ref-card-acceptance] FAIL " + name + "\n");
  };
  try {
    fs.mkdirSync(outDir, { recursive: true });
    const bob = shared.findBobProvenance();
    report.bob = { path: bob.path, sha256: bob.sha256, version: bob.version, sourceSha: bob.sourceSha, checkout: bob.checkout };
    report.prerequisites.push({ name: "current-checkout-bob", status: "pass", detail: report.bob });
    const executable = args.executable || process.env.OBSIDIAN_BIN || ELECTRON_FALLBACK;
    fs.accessSync(executable, fs.constants.X_OK);
    report.executable = executable;
    const notes = { ...takeover.fixtureNotes(), ...familyFixtureEntries(), ...supportingTaskNotes(), ...fixtureEntries() };
    notes["ref/ref-bad-yaml.md"] = [
      "---", 'type: "[[ref]]"', 'title: "Malformed reference metadata"', "broken: [", "---", "",
      "# Malformed reference metadata", "", "This note must leave native Properties available.", "",
    ].join("\n");
    const binaries = fixtureBinaryEntries();
    const eligible = eligibleFixturePaths(notes);
    const sourceFiles = ["manifest.json", "main.js", "styles.css"];
    const pluginDir = path.join(REPO_ROOT, "plugins", PLUGIN_ID);
    report.plugin = {
      version: JSON.parse(fs.readFileSync(path.join(pluginDir, "manifest.json"), "utf8")).version,
      sourceSha: process.env.BOB_PLUGINS_SOURCE_SHA || String(require("node:child_process").spawnSync("git", ["-C", REPO_ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout || "").trim(),
      files: Object.fromEntries(sourceFiles.map((name) => [name, sha256(fs.readFileSync(path.join(pluginDir, name)))])),
    };
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "bob-ref-card-acceptance-"));
    const vaultDir = path.join(scratch, "vault");
    const profileDir = path.join(scratch, "profile");
    const shimDir = path.join(profileDir, "shim");
    const bobLog = path.join(profileDir, "bob-invocations.jsonl");
    fs.mkdirSync(vaultDir, { recursive: true });
    fs.mkdirSync(profileDir, { recursive: true });
    for (const [name, content] of Object.entries(notes)) shared.writeNote(vaultDir, name, content);
    for (const [name, bytes] of Object.entries(binaries)) {
      const file = path.join(vaultDir, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, bytes);
    }
    writePlugin(vaultDir);
    const shim = writeBobShim(shimDir, bobLog, bob.path);
    shared.initScratchGit(vaultDir);
    const vaultReal = fs.realpathSync(vaultDir);
    shared.seedProfile(profileDir, vaultReal);
    const protectedFiles = [...Object.keys(notes), ...Object.keys(binaries)].sort();
    const expectedHashes = Object.fromEntries(protectedFiles.map((name) => [name, sha256(fs.readFileSync(path.join(vaultReal, name)))]));
    report.scratch = { root: scratch, vault: vaultReal, profile: profileDir };
    report.fixtures = { eligible, nonclaims: NONCLAIMS.slice(), hashesBefore: expectedHashes };

    const port = await shared.freePort();
    const processInfo = { pid: null, executable, debugPort: port, stderr: "" };
    report.obsidianProcess = processInfo;
    child = spawn(executable, [
      "--no-sandbox", "--user-data-dir=" + profileDir, "--remote-debugging-port=" + port,
      "--remote-allow-origins=http://127.0.0.1/*", vaultReal,
    ], {
      cwd: os.tmpdir(), stdio: ["ignore", "ignore", "pipe"],
      env: {
        ...process.env, HOME: profileDir, BOB_DIR: vaultReal, BOB_NOW: "2026-11-20 12:00:00",
        BOB_CONFIG_FILE: path.join(profileDir, "missing-test-config.yml"),
        PATH: shimDir + path.delimiter + (process.env.PATH || ""), TMPDIR: "/tmp", NO_COLOR: "1",
      },
    });
    processInfo.pid = child.pid || null;
    child.stderr.on("data", (chunk) => {
      processInfo.stderr = (processInfo.stderr + String(chunk)).slice(-12_000);
    });
    child.on("error", (error) => { processInfo.error = String(error.message || error); });
    child.on("exit", (code, signal) => { processInfo.exit = { code, signal }; });
    try {
      client = (await shared.selectTarget(port, vaultReal, () => child && child.exitCode == null && !processInfo.error)).client;
    } catch (error) {
      const detail = JSON.stringify({ pid: processInfo.pid, debugPort: port, error: processInfo.error || null, exit: processInfo.exit || null, stderr: processInfo.stderr });
      throw new Error(`${error.message || error}; Obsidian launch details: ${detail}`);
    }
    client.on("Runtime.exceptionThrown", (params) => {
      const details = params.exceptionDetails || {};
      report.consoleExceptions.push({ text: details.text || "", description: details.exception?.description || "", url: details.url || "" });
    });
    client.on("Runtime.consoleAPICalled", (params) => {
      if (params.type === "error") report.consoleErrors.push((params.args || []).map((arg) => arg.value ?? arg.description ?? "").join(" ").slice(0, 1200));
    });
    await client.call("Runtime.enable");
    report.pluginStartup = await shared.trustCommunityPlugins(client);
    await shared.waitFor(client, `Boolean(app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]) && app.workspace.layoutReady`, Boolean, "Ref Card plugin startup", 45_000);
    await shared.collapseSidebars(client);
    const appVersion = await client.evaluate("(/obsidian\\/([\\d.]+)/i.exec(navigator.userAgent) || [])[1] || ''");
    report.obsidian = appVersion;
    const pluginEnabled = await client.evaluate(`app.plugins.enabledPlugins?.has?.(${JSON.stringify(PLUGIN_ID)}) === true`);
    check("plugin-loaded", pluginEnabled, { appVersion, plugin: report.plugin });
    await shared.setViewport(client, 1400, 1000);
    await shared.setTheme(client, "light");

    const first = eligible[0];
    await shared.openNote(client, first, "live");
    const leafId = await client.evaluate("app.workspace.activeLeaf?.id || ''");
    if (!leafId) throw new Error("Obsidian did not expose the active Markdown leaf id");
    const probe = (notePath) => client.evaluate(probeExpression(leafId, notePath));
    const waitForCard = async (notePath, mode, timeoutMs = 20_000) => {
      const until = Date.now() + timeoutMs;
      let last = null;
      while (Date.now() < until) {
        last = await probe(notePath);
        if (last.cardCount === 1 && last.titlePresent && last.footPresent) return last;
        await shared.sleep(150);
      }
      throw new Error(`${notePath} ${mode} Ref Card timed out: ${JSON.stringify(last)}`);
    };
    const viewMode = async (notePath, mode) => {
      await shared.openNote(client, notePath, mode);
      return waitForCard(notePath, mode);
    };

    const capability = await client.evaluate(`(() => {
      const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      const key = plugin?.propertyCapabilityCurrentBobKey?.();
      return key ? plugin.propertyCapabilityState?.(key) || null : null;
    })()`);
    report.capability = capability;
    check("props-v1-and-reference-contract", capability?.status === "confirmed" && capability?.refContract === "confirmed", capability);

    const takeoverRows = [];
    for (const notePath of eligible) {
      for (const mode of ["live", "reading"]) {
        try {
          const row = await viewMode(notePath, mode);
          const note = notes[notePath] || "";
          const hasEmbed = /!\[\[/.test(note);
          const shouldAdopt = matchingHeadingExpected(note);
          const failures = [];
          if (row.cardCount !== 1 || !row.titlePresent || !row.footPresent) failures.push("card/title/foot ownership");
          if (row.nativeVisible) failures.push("native Properties visible");
          if (row.cardInEmbed) failures.push("card mounted inside an embed");
          if (hasEmbed && row.visibleEmbedCount < 1) failures.push("reading-task embed is not visible");
          if (shouldAdopt && row.titleHidden !== true) failures.push("matching first H1 is not hidden");
          if (!shouldAdopt && notePath.endsWith("ref-title-mismatch.md") &&
              !row.h1Rows.some((heading) => heading.text && heading.text !== row.title && heading.visible)) {
            failures.push("different H1 was hidden or missing");
          }
          takeoverRows.push({ path: notePath, mode, probe: row, failures });
        } catch (error) {
          takeoverRows.push({ path: notePath, mode, failures: [String(error.message || error)] });
        }
      }
    }
    report.takeover = takeoverRows;
    check("takeover-live-and-reading", takeoverRows.length === eligible.length * 2 && takeoverRows.every((row) => row.failures.length === 0), takeoverRows);

    const nonclaimRows = [];
    for (const notePath of [...NONCLAIMS, "ref/ref-bad-yaml.md"]) {
      try {
        await shared.openNote(client, notePath, "live");
        await shared.sleep(450);
        const row = await probe(notePath);
        const nativeShouldRemain = notePath !== "ref/ref-bad-yaml.md";
        const ok = row.cardCount === 0 && row.cardInEmbed === false && (!nativeShouldRemain || row.nativeVisible);
        nonclaimRows.push({ path: notePath, ok, probe: row });
      } catch (error) { nonclaimRows.push({ path: notePath, ok: false, error: String(error.message || error) }); }
    }
    report.nonclaims = nonclaimRows;
    check("single-owner-nonclaims", nonclaimRows.every((row) => row.ok), nonclaimRows);

    await shared.openNote(client, first, "source");
    await shared.sleep(300);
    const sourceRecovery = await probe(first);
    check("source-mode-restores-native-properties", sourceRecovery.mode === "source" && sourceRecovery.cardCount === 0,
      sourceRecovery);

    // The card's empty/late report behavior is observed after first paint and
    // the real report settles. No zero-valued placeholder is permitted.
    const blog = "ref/ref-finished-blog.md";
    const blogProbe = await viewMode(blog, "live");
    const noGhosts = !/\b0\s+(?:annotations?|comments?|highlights?)\b/i.test(
      JSON.stringify(blogProbe) + JSON.stringify(takeoverRows.map((row) => row.probe || {})),
    );
    check("readout-content-gating", noGhosts, { blog: blogProbe, zeroPattern: "0 annotations/comments/highlights" });
    const reportFixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, "ref-list.json"), "utf8"));
    const expectedLane = (row) => row.status === "read" ? /Read/i
      : row.status === "legacy" ? /Legacy/i
        : row.blocked === true ? /Snoozed/i
          : row.status === "next" ? /Next/i
            : row.status === "wip" ? /Reading/i : /Ready/i;
    const laneRows = [];
    for (const row of reportFixture.refs || []) {
      const actual = await viewMode(row.path, "live");
      laneRows.push({ path: row.path, status: row.status, expected: String(expectedLane(row)),
        actual: actual.laneText, matches: expectedLane(row).test(actual.laneText || "") });
    }
    report.data = { laneRows };
    check("fixture-reading-lanes", laneRows.length === (reportFixture.refs || []).length && laneRows.every((row) => row.matches), laneRows);
    const missingPdf = await viewMode("ref/ref-missing-pdf.md", "live");
    check("missing-pdf-diagnostic", /pdf/i.test(missingPdf.lintText) || missingPdf.access.every((item) => !item.pdf), missingPdf);

    const noTitle = await viewMode("ref/ref-no-title.md", "live");
    check("identity-only-shell-without-report-row", noTitle.cardPresent && noTitle.titlePresent
      && noTitle.laneText === "" && noTitle.annotationsText === "", noTitle);
    const paper = await viewMode("ref/ref-arxiv-paper.md", "live");
    const blogReadout = await viewMode(blog, "live");
    const expectedPdf = (item, filename) => item.pdf && item.target.includes(filename);
    const accessAndReadoutOk = /5 annotations/i.test(blogReadout.annotationsText)
      && /2 with notes/i.test(blogReadout.annotationsText)
      && blogReadout.access.some((item) => expectedPdf(item, "agentic-coding-ci.pdf"))
      && blogReadout.access.some((item) => item.audio)
      && /arxiv:1706\.03762/i.test(paper.identifiersText)
      && /v2/i.test(paper.versionText)
      && /12 annotations/i.test(paper.annotationsText)
      && /4 with notes/i.test(paper.annotationsText)
      && paper.access.some((item) => expectedPdf(item, "attention-is-all-you-need.pdf"));
    check("annotation-identity-lineage-and-access-readouts", accessAndReadoutOk, { blog: blogReadout, paper });

    // Exercise the actual Vim `==` route in the Obsidian editor. A first `=`
    // must leave Vim's operator pending; the second opens the Reference
    // settings editor through the card-kind registry without touching YAML.
    await shared.openNote(client, blog, "live");
    const focused = await client.evaluate(`(() => {
      const leaf = app.workspace.activeLeaf;
      const content = leaf?.view?.editor?.cm?.contentDOM || null;
      content?.focus?.();
      return Boolean(content && document.activeElement && content.contains(document.activeElement));
    })()`);
    const key = async (value, code, vk) => {
      const event = { key: value, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: 0 };
      await client.call("Input.dispatchKeyEvent", { type: "keyDown", ...event });
      await client.call("Input.dispatchKeyEvent", { type: "keyUp", ...event });
    };
    await key("Escape", "Escape", 27);
    await key("=", "Equal", 187);
    const firstEquals = await client.evaluate(`(() => {
      const cm = app.workspace.activeLeaf?.view?.editor?.cm?.cm6;
      return { operator: cm?.state?.vim?.inputState?.operator || null,
        editorFocused: Boolean(cm?.contentDOM && cm.contentDOM.contains(document.activeElement)),
        editorOpen: Boolean(document.querySelector(".bob-property-editor-header")) };
    })()`);
    await key("=", "Equal", 187);
    await shared.waitFor(client, `(() => {
      const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      return Boolean(plugin?.propertyEditorModal && document.querySelector(".bob-property-editor-header"));
    })()`, Boolean, "Reference Property Editor via ==", 12_000);
    const editorOpen = await client.evaluate(`(() => {
      const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      const modal = plugin?.propertyEditorModal;
      const root = document.querySelector(".bob-property-editor-header")?.parentElement || null;
      return {
        filePath: modal?.filePath || "", noteKind: modal?.noteKind || "",
        focusSettings: modal?.focusSettings === true,
        heading: root?.querySelector(".bob-property-editor-heading")?.textContent?.trim() || "",
        title: root?.querySelector(".bob-property-editor-title")?.textContent?.trim() || "",
        modalOwnsFocus: Boolean(document.activeElement?.closest?.(".modal-container")),
      };
    })()`);
    const keysOk = focused === true && firstEquals.editorFocused === true
      && firstEquals.operator === "indentAuto" && firstEquals.editorOpen === false
      && editorOpen.filePath === blog && editorOpen.noteKind === "reference"
      && editorOpen.focusSettings === true && /reference/i.test(editorOpen.heading)
      && editorOpen.modalOwnsFocus;
    report.editor = { focused, firstEquals, opened: editorOpen };
    check("keys-and-focus-open-reference-editor", keysOk, report.editor);
    check("reference-editor-settings-contract", editorOpen.filePath === blog && editorOpen.noteKind === "reference"
      && editorOpen.focusSettings === true && /reference/i.test(editorOpen.heading), editorOpen);
    await client.evaluate(`app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]?.propertyEditorModal?.close?.()`);
    await shared.sleep(250);

    // Exercise fold/drawer/resize in the actual app while the spy records
    // writes to every protected fixture. A report refresh is allowed; paint
    // and presentation gestures are not.
    await client.evaluate(installWriteAuditExpression(protectedFiles));
    await shared.sleep(2200);
    const invocationsBefore = fs.existsSync(bobLog)
      ? fs.readFileSync(bobLog, "utf8").split(/\r?\n/).filter(Boolean).length : 0;
    await client.evaluate(`(() => {
      const card = document.querySelector('.bob-ref-card[data-ref-source="${blog}"]');
      card?.querySelector(".bob-ref-card-fold")?.click();
      card?.querySelector(".bob-ref-card-fold")?.click();
      card?.querySelector(".bob-property-card-foot-disclosure")?.click();
      card?.querySelector(".bob-property-card-foot-disclosure")?.click();
      return Boolean(card);
    })()`);
    await shared.setViewport(client, 420, 900);
    await shared.setViewport(client, 1400, 1000);
    await shared.sleep(2200);
    const writeRows = await client.evaluate("window.__bobRefAcceptanceWriteAudit?.rows || []");
    const invocationsAfter = fs.existsSync(bobLog)
      ? fs.readFileSync(bobLog, "utf8").split(/\r?\n/).filter(Boolean).length : 0;
    report.passivity = { writeRows, invocationsBefore, invocationsAfter };
    check("passive-fold-drawer-resize", writeRows.length === 0 && invocationsAfter === invocationsBefore, report.passivity);

    // Capture the complete approved sample matrix with card probes before and
    // after every shot. Digests and byte sizes are recorded for visual review.
    for (const shot of screenshotMatrix()) {
      try {
        await shared.setTheme(client, shot.theme);
        await shared.setViewport(client, shot.width, shot.width < 600 ? 900 : 1000);
        if (shot.label === "forced-colors") {
          await client.call("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }] });
        } else if (shot.label === "grayscale") {
          await client.evaluate("document.documentElement.style.filter = 'grayscale(1)'");
        } else {
          await client.call("Emulation.setEmulatedMedia", { features: [] });
          await client.evaluate("document.documentElement.style.filter = ''");
        }
        if (shot.label.startsWith("family-")) {
          await shared.openNote(client, shot.notePath, shot.mode);
        } else if (shot.label === "compact") {
          await shared.openNote(client, shot.notePath, shot.mode);
          await client.evaluate(`document.querySelector('.bob-ref-card[data-ref-source="${shot.notePath}"] .bob-ref-card-fold')?.click()`);
        } else {
          await shared.openNote(client, shot.notePath, shot.mode);
        }
        await shared.sleep(400);
        const family = shot.label.startsWith("family-");
        const before = family ? await client.evaluate(`(() => {
          const cards = Array.from(document.querySelectorAll(".bob-property-card"));
          const ours = cards.filter((node) => !node.matches(".bob-ref-card"));
          return { path: ${JSON.stringify(shot.notePath)}, cardCount: ours.length,
            refCardCount: document.querySelectorAll(".bob-ref-card").length,
            title: ours[0]?.querySelector(".bob-property-card-title")?.textContent?.trim() || "" };
        })()`) : await probe(shot.notePath);
        const captured = await shared.capture(client, outDir, shot.name, shot.width, shot.theme, shot.mode);
        const after = family ? before : await probe(shot.notePath);
        const recovery = shot.label === "recovery";
        const ok = family ? before.cardCount === 1 && before.refCardCount === 0 && Boolean(before.title)
          : recovery ? before.mode === "source" && before.cardCount === 0
            : before.cardCount === 1 && before.footPresent && !before.nativeVisible;
        report.screenshots.push({ ...captured, tags: [shot.label, shot.mode, shot.theme, shot.width],
          captureFailures: ok ? [] : ["card ownership probe failed before screenshot"],
          probes: { before, after }, visualVerdict: "pending inspection" });
      } catch (error) {
        report.screenshots.push({ name: shot.name, captureFailures: [String(error.message || error)], visualVerdict: "pending inspection" });
      }
    }
    const screenshotNeeded = screenshotMatrix().map((row) => row.name);
    const screenshotNames = new Set(report.screenshots.map((row) => row.name));
    const missingShots = screenshotNeeded.filter((name) => !screenshotNames.has(name));
    check("screenshot-matrix-captured", missingShots.length === 0 && report.screenshots.every((row) => !(row.captureFailures || []).length), {
      count: report.screenshots.length, required: screenshotNeeded.length, missing: missingShots,
    });

    const hashesAfter = Object.fromEntries(protectedFiles.map((name) => [name, sha256(fs.readFileSync(path.join(vaultReal, name)))]));
    const changed = protectedFiles.filter((name) => hashesAfter[name] !== expectedHashes[name]);
    report.fixtures.hashesAfter = hashesAfter;
    report.fixtures.changed = changed;
    check("protected-fixture-and-pdf-bytes-unchanged", changed.length === 0, changed);
    check("no-console-exceptions", report.consoleExceptions.length === 0, report.consoleExceptions);
    check("cli-invocations-recorded", fs.existsSync(bobLog), { path: bobLog, count: invocationsAfter });

    report.visualReview = report.screenshots.every((row) => row.visualVerdict === "approved") ? "approved" : "pending";
    report.verdict = report.checks.every((row) => row.status === "pass") && report.visualReview === "approved" ? "GO" : "NO-GO";
    report.summary = {
      verdict: report.verdict, obsidian: appVersion, plugin: report.plugin, bob: report.bob,
      eligibleFixtures: eligible.length, screenshotCount: report.screenshots.length,
      screenshotReview: report.visualReview, failedChecks: report.checks.filter((row) => row.status !== "pass").map((row) => row.name),
    };
  } catch (error) {
    report.error = String(error.stack || error);
    report.prerequisites.push({ name: "runner", status: "fail", detail: String(error.message || error) });
    report.summary = { verdict: "NO-GO", error: String(error.message || error), plugin: report.plugin || null, bob: report.bob || null };
  } finally {
    if (client) client.close();
    if (child && child.exitCode == null) {
      try { child.kill("SIGTERM"); } catch (_) {}
      await shared.sleep(500);
      try { if (child.exitCode == null) child.kill("SIGKILL"); } catch (_) {}
    }
    if (scratch) {
      try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (_) {}
    }
    try { fs.mkdirSync(path.dirname(reportPath), { recursive: true }); fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n"); } catch (_) {}
  }
  process.stdout.write(JSON.stringify(report.summary, null, 2) + "\n");
  process.stdout.write("report: " + reportPath + "\n");
  process.stdout.write("screenshots: " + outDir + "\n");
  if (report.verdict !== "GO") process.exitCode = 1;
  return report;
}

const HELP = [
  "Usage: node scripts/obsidian-ref-card-acceptance-e2e.cjs [OPTIONS]",
  "",
  "Run the Ref Card takeover, non-claim, passivity, and screenshot matrix in a disposable Obsidian profile/vault.",
  "Requires BOB_BIN and BOB_CLI_DIR for the current bob-cli checkout; use xvfb-run on Linux.",
  "",
  "  -e, --executable PATH   Obsidian Electron executable",
  "  -o, --out DIRECTORY    Save PNG evidence here",
  "  -r, --report PATH      Write the structured JSON report here",
  "  -s, --self-test        Validate fixtures and matrix without launching apps",
  "  -h, --help             Print this help",
].join("\n");

async function main(argv) {
  let args;
  try { args = parseArgs(argv); }
  catch (error) { process.stderr.write(String(error.message || error) + "\n" + HELP + "\n"); process.exitCode = 2; return; }
  if (args.help) { process.stdout.write(HELP + "\n"); return; }
  if (args.selfTest) {
    try { selfTest(); process.stdout.write("offline Ref Card acceptance self-test complete (fixtures, scope, screenshot matrix; no Obsidian launched)\n"); }
    catch (error) { process.stderr.write(String(error.stack || error) + "\n"); process.exitCode = 1; }
    return;
  }
  await run(args);
}

if (require.main === module) void main(process.argv.slice(2));
module.exports = {
  HELP, NONCLAIMS, SAMPLE_CARDS, eligibleFixturePaths, fixtureBinaryEntries, fixtureEntries,
  matchingHeadingExpected, parseArgs, probeExpression, screenshotMatrix, selfTest, run,
};
