#!/usr/bin/env node
// Real Obsidian rail acceptance in an owned scratch vault/profile. The fixture
// injects a cached album report; bob subprocesses are disabled, so no sync writes
// can hide a broken count or a ghost-creation bug.
"use strict";
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const harness = require("./obsidian-walker-footer-e2e.cjs");
const { parseArgs } = require("./obsidian-record-card-e2e-lib.cjs");
const ROOT = path.resolve(__dirname, "..");
const IDS = ["bob-ledger-tools", "bob-navigation-hotkeys"];
const LEDGER = 'window.app.plugins.plugins["bob-ledger-tools"]';
const ACTIVE = "window.app.workspace.activeLeaf.view";
// Obsidian keeps the other mode mounted but hidden in the same leaf. Scope
// every probe and click to the active mode, never the first matching widget.
const SURFACE = `(${ACTIVE}.containerEl.querySelector(${ACTIVE}.getMode() === "preview" ? ".markdown-preview-view" : ".markdown-source-view"))`;
const RAIL = `${SURFACE}.querySelector(".bob-record-walk-rail")`;

function record(album, title, line = "") {
  return `---\ntype: "[[record]]"\nparent: "[[${album}]]"\ntitle: ${title}\n---\n${line ? `\n${line}\n\n## Notes\n\nA note.\n` : ""}`;
}
function fixtureNotes() {
  return {
    "body.md": '---\ntype: "[[area]]"\nroot_parent: true\n---\n# Body\n',
    "eat.md": '---\ntype: "[[album]]"\nparent: "[[body]]"\ntitle: Eat\nemoji: 🍽️\n---\n# Eat\n',
    "eat/a.md": record("eat", "Alpha", "[[eat/b|‹ Bravo]] · [[eat|↑ Eat]] · [[eat/b|Bravo ›]]"),
    "eat/b.md": record("eat", "Bravo", "[[eat/a|‹ Alpha]] · [[eat|↑ Eat]] · [[eat/a|Alpha ›]]"),
    "solo.md": '---\ntype: "[[album]]"\nparent: "[[body]]"\ntitle: Solo\n---\n# Solo\n',
    "solo/one.md": record("solo", "One", "[[solo|↑ Solo]]"),
    "bare.md": '---\ntype: "[[album]]"\nparent: "[[body]]"\ntitle: Bare\n---\n# Bare\n',
    "bare/one.md": record("bare", "Bare"),
  };
}
function reportFixture() {
  return {
    schema_version: 1, ok: true, capabilities: ["record_values_v1", "record_walk_v1"], catalogs: [],
    counts: { albums: 3, records: 4, roots: 1 },
    albums: ["eat", "solo", "bare"].map((stem) => ({
      path: `${stem}.md`, stem, title: stem === "eat" ? "Eat" : stem === "solo" ? "Solo" : "Bare",
      emoji: stem === "eat" ? "🍽️" : "", noun: "record", parent: "body", parent_kind: "area", owner: "body", root: "body",
      breadcrumb: ["Body"], schema_fingerprint: "fixture", fields: [], issues: [], records: stem === "eat" ? 2 : 1,
      index: { state: "current" }, walk: { state: "current" },
    })),
  };
}
function seedVault(vault) {
  for (const id of IDS) harness.copyPluginFiles(path.join(ROOT, "plugins", id), path.join(vault, ".obsidian", "plugins", id));
  fs.writeFileSync(path.join(vault, ".obsidian", "community-plugins.json"), JSON.stringify(IDS));
  fs.writeFileSync(path.join(vault, ".obsidian", "core-plugins.json"), JSON.stringify(["page-preview", "editor-status"]));
  fs.writeFileSync(path.join(vault, ".obsidian", "app.json"), JSON.stringify({ livePreview: true, showInlineTitle: true }));
  for (const [name, text] of Object.entries(fixtureNotes())) {
    const file = path.join(vault, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
}
async function openNote(client, note, mode = "source") {
  await client.evaluate(`(async () => {
    const leaf = app.workspace.getMostRecentLeaf();
    await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(note)}));
    await leaf.setViewState({ type: "markdown", state: { file: ${JSON.stringify(note)}, mode: ${JSON.stringify(mode)}, source: false } });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    if (${JSON.stringify(mode)} === "source") { leaf.view.editor.focus(); leaf.view.editor.setCursor({ line: leaf.view.editor.lastLine(), ch: 0 }); }
    ${LEDGER}.scheduleRecordSheetRefresh();
  })()`);
}
async function runE2e(args) {
  const executable = args.executable || process.env.OBSIDIAN_BIN || "/snap/obsidian/current/app/obsidian";
  const probe = harness.probeExecutable(executable);
  if (!probe.ok) return { status: "skipped", reason: probe.reason };
  if (process.platform === "linux" && !process.env.DISPLAY) return { status: "skipped", reason: "Use an independent xvfb-run -a display" };
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "bob-record-walk-"));
  const vault = path.join(scratch, "vault");
  const profile = path.join(scratch, "profile");
  const shim = path.join(scratch, "bin");
  fs.mkdirSync(vault, { recursive: true });
  fs.mkdirSync(shim);
  fs.writeFileSync(path.join(shim, "bob"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  seedVault(vault);
  harness.seedProfileVault(profile, vault);
  const port = await harness.freePort();
  const env = { ...process.env, BOB_DIR: vault, BOB_CONFIG_FILE: path.join(scratch, "missing-config"), PATH: `${shim}${path.delimiter}${process.env.PATH}`, TMPDIR: os.tmpdir() };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, ["--no-sandbox", `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "--remote-allow-origins=http://127.0.0.1/*", vault], { cwd: vault, env, detached: process.platform !== "win32", stdio: "ignore" });
  const cases = [];
  const evidence = {};
  let client;
  const check = (name, value) => { assert.ok(value, name); cases.push(name); };
  try {
    client = await harness.connectToOwnedPage(port, vault);
    await harness.dismissTrustModal(client);
    await client.call("Page.bringToFront");
    await client.call("Emulation.setFocusEmulationEnabled", { enabled: true });
    await client.evaluate(`(() => {
      const ledger = ${LEDGER};
      const report = ledger.constructor.helpers.albumIndexReport(${JSON.stringify(reportFixture())});
      ledger.albumReportState = () => ({ report, stale: false, reportGeneration: 1 });
      ledger.albumScheduleSync = () => { window.walkSyncRequests = (window.walkSyncRequests || 0) + 1; };
      window.walkOpenResults = [];
      const walkOpen = ledger.recordWalkOpen;
      ledger.recordWalkOpen = async function(...args) {
        const result = await walkOpen.apply(this, args);
        window.walkOpenResults.push({ target: args[0], result });
        return result;
      };
      window.walkCommandCalls = [];
      const execute = app.commands.executeCommandById;
      app.commands.executeCommandById = function(id) { window.walkCommandCalls.push(id); return execute.call(this, id); };
      window.walkErrors = [];
      window.addEventListener("error", event => window.walkErrors.push(String(event.message)));
      window.addEventListener("unhandledrejection", event => window.walkErrors.push(String(event.reason)));
    })()`);
    await openNote(client, "eat/a.md");
    const live = await harness.waitFor(client, `(() => {
      const sheet = ${SURFACE}.querySelector(".bob-record-sheet");
      const rail = sheet && sheet.querySelector(".bob-record-walk-rail") || ${RAIL};
      return rail && sheet && { arms: [...rail.querySelectorAll(".bob-record-walk-arm")].map(a => a.getAttribute("data-href")), count: rail.querySelector(".bob-record-walk-count-wide").textContent,
        wrap: rail.querySelector(".is-prev").title,
        inside: sheet.contains(rail),
        slot: sheet.parentElement && (sheet.parentElement.classList.contains("cm-sizer") || sheet.parentElement.classList.contains("mod-header")),
        bottomGap: sheet.getBoundingClientRect().bottom - rail.getBoundingClientRect().bottom,
        minHeight: rail.querySelector(".is-prev").getBoundingClientRect().height };
    })()`, value => value?.count === "1 of 2", "Live Preview rail");
    evidence.live = live;
    check("two-record arms both target the other record", live.arms.length === 2 && live.arms.every(target => target === "eat/b"));
    check("first record announces wrap", /Wraps around to Bravo \(2 of 2\)/.test(live.wrap));
    check("rail docks flush at the card bottom in the title slot", live.inside && live.slot && Math.abs(live.bottomGap) < 3 && live.minHeight >= 32);
    await client.evaluate(`app.commands.executeCommandById("bob-navigation-hotkeys:open-prev-link")`);
    await harness.waitFor(client, `${ACTIVE}.file.path`, value => value === "eat/b.md", "[n wraps to last record");
    check("[n wraps", true);
    await openNote(client, "eat/a.md");
    await harness.waitFor(client, `Boolean(${RAIL})`, Boolean, "rail before click");
    await client.evaluate(`${RAIL}.querySelector(".is-next").click()`);
    await harness.waitFor(client, `${ACTIVE}.file.path`, value => value === "eat/b.md", "rail next command");
    check("rail click navigates through n command", await client.evaluate('window.walkCommandCalls.includes("bob-navigation-hotkeys:open-next-link")'));
    await openNote(client, "eat/a.md");
    await harness.waitFor(client, `${RAIL}?.querySelector(".bob-record-walk-count-wide").textContent`, value => value === "1 of 2", "rail before cursor reveal");
    await client.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    const beforeReveal = await client.evaluate(`(() => {
      const sheet = ${SURFACE}.querySelector(".bob-record-sheet");
      const rail = sheet && sheet.querySelector(".bob-record-walk-rail");
      const sourceLine = [...${SURFACE}.querySelectorAll(".cm-line")].some(line => {
        const links = [...line.querySelectorAll(".cm-hmd-internal-link")].map(link => link.textContent.trim());
        return links.length === 3 && links[0].includes("Bravo") && links[1].includes("Eat") && links[2].includes("Bravo");
      });
      return { sheet: Boolean(sheet), rail: Boolean(rail), sourceLine };
    })()`);
    const boundary = await client.evaluate(`(() => {
      const editor = ${ACTIVE}.editor;
      const lines = editor.getValue().split("\\n");
      const walkLine = lines.findIndex(line => line.includes("[[eat/b|"));
      const blankLine = walkLine + 1;
      const bodyLine = lines.findIndex((line, index) => index > walkLine && line.startsWith("## Notes"));
      if (walkLine < 0 || lines[blankLine] !== "" || bodyLine < 0) return { ok: false, walkLine, blankLine, bodyLine };
      editor.focus();
      editor.setCursor({ line: blankLine, ch: 0 });
      return { ok: true, walkLine, blankLine, bodyLine };
    })()`);
    if (!boundary.ok) throw new Error("record walk blank/body fixture boundary: " + JSON.stringify(boundary));
    const blankRevealed = await harness.waitFor(client, `(() => {
      const sheet = ${SURFACE}.querySelector(".bob-record-sheet");
      const rail = sheet && sheet.querySelector(".bob-record-walk-rail");
      const sourceLine = [...${SURFACE}.querySelectorAll(".cm-line")].some(line => {
        const links = [...line.querySelectorAll(".cm-hmd-internal-link")].map(link => link.textContent.trim());
        return links.length === 3 && links[0].includes("Bravo") && links[1].includes("Eat") && links[2].includes("Bravo");
      });
      return sheet && rail && sourceLine && { sheet: true, rail: true, sourceLine: true, slot: sheet.parentElement?.classList.contains("cm-sizer") };
    })()`, value => value?.sourceLine === true, "blank after the record walk reveals source");
    check("consumed record blank reveals while the slot card and rail remain mounted",
      boundary.ok && beforeReveal.sheet && beforeReveal.rail && !beforeReveal.sourceLine && blankRevealed.sheet && blankRevealed.rail && blankRevealed.slot);
    await client.evaluate(`(() => { ${ACTIVE}.editor.setCursor({ line: ${boundary.bodyLine}, ch: 0 }); })()`);
    const bodyOutside = await harness.waitFor(client, `(() => {
      const sheet = ${SURFACE}.querySelector(".bob-record-sheet");
      const rail = sheet && sheet.querySelector(".bob-record-walk-rail");
      const sourceLine = [...${SURFACE}.querySelectorAll(".cm-line")].some(line => {
        const links = [...line.querySelectorAll(".cm-hmd-internal-link")].map(link => link.textContent.trim());
        return links.length === 3 && links[0].includes("Bravo") && links[1].includes("Eat") && links[2].includes("Bravo");
      });
      return sheet && rail && !sourceLine && { sheet: true, rail: true, sourceLine: false };
    })()`, value => value?.sourceLine === false, "next record body line stays outside the owned range");
    check("next record body line stays outside the owned range", boundary.ok && bodyOutside.sheet && bodyOutside.rail);
    await client.evaluate(`(() => { ${ACTIVE}.editor.focus(); ${ACTIVE}.editor.setCursor({ line: 6, ch: 3 }); })()`);
    await client.call("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
    await client.call("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
    const revealed = await harness.waitFor(client, `(() => {
      const sheet = ${SURFACE}.querySelector(".bob-record-sheet");
      const rail = sheet && sheet.querySelector(".bob-record-walk-rail");
      const raw = [...${SURFACE}.querySelectorAll(".cm-line")].some(line => line.textContent.includes("[[eat/b|"));
      return sheet && rail && raw && { sheet: true, rail: true, raw: true, slot: sheet.parentElement && sheet.parentElement.classList.contains("cm-sizer") };
    })()`, value => value?.raw === true, "raw walk line reveal keeps card and rail");
    check("cursor reveals raw walk Markdown while the same card and rail stay mounted",
      beforeReveal.sheet && beforeReveal.rail && revealed.sheet && revealed.rail && revealed.slot);
    await client.evaluate(`${SURFACE}.querySelector(".bob-record-sheet-collapse").click()`);
    await harness.waitFor(client, `Boolean(${RAIL}) && ${SURFACE}.querySelector(".bob-record-sheet-collapse").getAttribute("aria-expanded") === "false"`, Boolean, "collapsed sheet retains rail");
    check("collapsed sheet retains rail", true);
    await harness.waitFor(client, `${LEDGER}.freshnessFooterLastView?.dueText`, value => value === "Links 1/2", "footer count");
    check("footer agrees with rail", true);
    if (args.out) {
      fs.mkdirSync(args.out, { recursive: true });
      const png = await client.call("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(path.join(args.out, "live-preview.png"), Buffer.from(png.data, "base64"));
    }
    await openNote(client, "eat/a.md", "preview");
    await harness.waitFor(client, `${SURFACE}.querySelectorAll(".bob-record-sheet .bob-record-walk-rail").length`, value => value === 1, "Reading rail");
    check("Reading first-body walk paragraph is kit-hidden", await client.evaluate(`${SURFACE}.querySelectorAll("p.bob-property-card-title-source").length >= 1 && getComputedStyle(${SURFACE}.querySelector("p.bob-property-card-title-source")).display === "none"`));
    check("Reading rail docks inside the slot card", await client.evaluate(`(() => {
      const sheet = ${SURFACE}.querySelector(".bob-record-sheet");
      return Boolean(sheet && sheet.parentElement && sheet.parentElement.classList.contains("mod-header") && sheet.querySelector(".bob-record-walk-rail"));
    })()`));
    await client.evaluate(`${SURFACE}.querySelector(".markdown-preview-sizer").style.maxWidth = "300px"`);
    evidence.narrow = await harness.waitFor(client, `(() => {
      const rail = ${RAIL};
      return rail && { width: rail.getBoundingClientRect().width, container: getComputedStyle(rail).containerType,
        album: getComputedStyle(rail.querySelector(".bob-record-walk-album")).display,
        count: getComputedStyle(rail.querySelector(".bob-record-walk-count-narrow")).display };
    })()`, value => value?.album === "none" && value.count !== "none", "narrow container layout");
    check("narrow rail collapses to glyphs and compact count", true);
    if (args.out) {
      const png = await client.call("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(path.join(args.out, "reading-narrow.png"), Buffer.from(png.data, "base64"));
    }
    await openNote(client, "solo/one.md");
    await harness.waitFor(client, `${RAIL}?.querySelector(".bob-record-walk-count-wide").textContent`, value => value === "1 of 1", "singleton");
    check("singleton has no arms or track", await client.evaluate(`${RAIL}.querySelectorAll(".bob-record-walk-arm, .bob-record-walk-track").length === 0`));
    await openNote(client, "bare/one.md");
    await harness.waitFor(client, `Boolean(${SURFACE}.querySelector(".bob-record-sheet"))`, Boolean, "bare sheet");
    check("frontmatter-only record has no rail", await client.evaluate(`!${RAIL}`));
    await openNote(client, "eat/a.md");
    await client.evaluate(`app.vault.delete(app.vault.getAbstractFileByPath("eat/b.md"))`);
    await harness.waitFor(client, `${RAIL}?.getAttribute("data-walk-state")`, value => value === "syncing", "delete paints syncing");
    await client.evaluate(`${RAIL}.querySelector(".is-next").click()`);
    await harness.waitFor(client, `window.walkOpenResults.at(-1)`, value => value?.target === "eat/b" && value.result === false, "ghost guard refusal");
    check("missing destination refuses creation", await client.evaluate(`!app.vault.getAbstractFileByPath("eat/b.md") && ${ACTIVE}.file.path === "eat/a.md"`));
    check("syncing hides the number", await client.evaluate(`${RAIL}.querySelector(".bob-record-walk-count-wide").textContent === "⟳"`));
    check("no renderer errors", (await client.evaluate("window.walkErrors")).length === 0);
    for (const [name, text] of Object.entries(fixtureNotes())) {
      if (name !== "eat/b.md") assert.equal(fs.readFileSync(path.join(vault, name), "utf8"), text, "paint must not write " + name);
    }
    return { status: "passed", cases, live, narrow: evidence.narrow, executable };
  } catch (error) {
    if (client && args.out) {
      try {
        fs.mkdirSync(args.out, { recursive: true });
        const png = await client.call("Page.captureScreenshot", { format: "png" });
        fs.writeFileSync(path.join(args.out, "failure.png"), Buffer.from(png.data, "base64"));
      } catch (_) {}
      try {
        evidence.guard = await client.evaluate(`({ exists: Boolean(app.vault.getAbstractFileByPath("eat/b.md")), path: ${ACTIVE}.file.path, errors: window.walkErrors, notices: [...document.querySelectorAll("[class*=notice]")].map(node => node.className + ": " + node.textContent) })`);
        evidence.cursor = await client.evaluate(`({ pos: ${ACTIVE}.editor.getCursor(), selection: ${ACTIVE}.editor.cm?.state.selection.toJSON(), focus: document.hasFocus(), cmFocus: ${ACTIVE}.editor.cm?.hasFocus, active: document.activeElement?.className })`);
        evidence.dom = await client.evaluate(`${SURFACE}.querySelector(".cm-content")?.innerHTML`);
      } catch (_) {}
    }
    return { status: "failed", cases, evidence, error: String(error.stack || error) };
  } finally {
    client?.close();
    const exited = new Promise(resolve => child.once("exit", resolve));
    try { process.platform === "win32" ? child.kill("SIGTERM") : process.kill(-child.pid, "SIGTERM"); } catch (_) {}
    if (child.exitCode === null && child.signalCode === null) await Promise.race([exited, harness.sleep(2000)]);
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
function selfTest() {
  const notes = fixtureNotes();
  assert.match(notes["eat/a.md"], /\[\[eat\/b\|‹ Bravo\]\].*\[\[eat\/b\|Bravo ›\]\]/);
  assert.match(notes["solo/one.md"], /\[\[solo\|↑ Solo\]\]/);
  assert.doesNotMatch(notes["bare/one.md"].split("---")[2], /\[\[/);
  assert.equal(reportFixture().albums.length, 3);
  console.log("offline record-walk self-test complete; no Obsidian launched");
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return console.log("Usage: node scripts/obsidian-record-walk-e2e.cjs [-e PATH] [-r REPORT] [-o SCREENSHOTS] [--self-test]");
  if (args.selfTest) return selfTest();
  const result = await runE2e(args);
  if (args.report) fs.writeFileSync(args.report, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "failed") process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { fixtureNotes, reportFixture };
