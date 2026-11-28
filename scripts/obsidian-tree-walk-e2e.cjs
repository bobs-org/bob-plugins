#!/usr/bin/env node
// Real-Obsidian acceptance for sibling rings, parent tours, and the card-floor rail.
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const harness = require("./obsidian-walker-footer-e2e.cjs");
const shared = require("./obsidian-record-card-e2e.cjs");
const recordWalk = require("./obsidian-record-walk-e2e.cjs");

const ROOT = path.resolve(__dirname, "..");
const NAV = "bob-navigation-hotkeys";
const LEDGER = "bob-ledger-tools";
const ACTIVE = "app.workspace.getActiveFile()?.path || null";
const SURFACE = "(() => { const view = app.workspace.activeLeaf?.view; return view?.getMode?.() === 'preview' ? view.previewMode?.containerEl : view?.contentEl?.querySelector('.markdown-source-view'); })()";

const TREE_CASES = Object.freeze([
  Object.freeze({ kind: "area", path: "areas/goo.md", prev: "areas/foo.md", next: "areas/zoo.md", prevGroup: "areas/pig.md", nextGroup: "areas/inner.md" }),
  Object.freeze({ kind: "project", path: "projects/baz.md", prev: "projects/bar.md", next: "projects/bop.md", prevGroup: "projects/foo.md", nextGroup: "projects/alpha.md" }),
  Object.freeze({ kind: "notebook", path: "notebooks/n1b.md", prev: "notebooks/n1a.md", next: "notebooks/n1c.md", prevGroup: "notebooks/n3a.md", nextGroup: "notebooks/n2a.md" }),
  Object.freeze({ kind: "prose", path: "prose/beta.md", prev: "prose/alpha.md", next: "prose/gamma.md", prevGroup: "prose/authored_prev.md", nextGroup: "prose/foo_story.md" }),
]);
const KEYS = Object.freeze([
  Object.freeze({ key: "[n", command: "open-prev-link", stop: "prev" }),
  Object.freeze({ key: "]n", command: "open-next-link", stop: "next" }),
  Object.freeze({ key: "[N", command: "open-prev-group-link", stop: "prevGroup" }),
  Object.freeze({ key: "]N", command: "open-next-group-link", stop: "nextGroup" }),
  Object.freeze({ key: "[[", command: "repeat-prev-bracket-walk", stop: "prev" }),
  Object.freeze({ key: "]]", command: "repeat-next-bracket-walk", stop: "next" }),
  Object.freeze({ key: "[{", command: "repeat-prev-uppercase-bracket-walk", stop: "prevGroup" }),
  Object.freeze({ key: "]}", command: "repeat-next-uppercase-bracket-walk", stop: "nextGroup" }),
]);

function parseArgs(argv) {
  const args = { executable: null, out: null, report: null, selfTest: false, help: false };
  const list = Array.isArray(argv) ? argv.slice() : [];
  for (let index = 0; index < list.length; index += 1) {
    const token = list[index];
    const value = () => {
      const next = list[++index];
      if (!next || next.startsWith("-")) throw new Error(token + " requires a value");
      return next;
    };
    if (token === "-e" || token === "--executable") args.executable = value();
    else if (token === "-o" || token === "--out") args.out = value();
    else if (token === "-r" || token === "--report") args.report = value();
    else if (token === "-s" || token === "--self-test") args.selfTest = true;
    else if (token === "-h" || token === "--help") args.help = true;
    else throw new Error("Unknown argument: " + token);
  }
  return args;
}

function note(type, parent, title, body, extra = []) {
  const rows = ["---", 'type: "[[' + type + ']]"'];
  if (parent !== null && parent !== undefined) rows.push('parent: "[[' + parent + ']]"');
  if (title) rows.push('title: "' + title.replace(/"/g, '\\"') + '"');
  rows.push(...extra, "---", "", body || ("# " + (title || "Fixture")), "");
  return rows.join("\n");
}

function project(title, parent, closed = false) {
  return note("project", parent, title,
    "- [" + (closed ? "x" : " ") + "] #task #prj " + title + " ^prj\n\nProject fixture.\n");
}

function fixtureNotes() {
  const notes = {
    ".gitignore": ".obsidian/\n.trash/\n",
    "area.md": "# Area sentinel\n",
    "project.md": "# Project sentinel\n",
    "areas/pig.md": note("area", "area", "Pig", "# Pig\n"),
    "areas/zebra.md": note("area", "area", "Zebra", "# Zebra\n"),
    "areas/foo.md": note("area", "areas/pig", "Foo", "# Foo\n"),
    "areas/goo.md": note("area", "areas/pig", "Goo", "# Goo\n"),
    "areas/zoo.md": note("area", "areas/pig", "Zoo", "# Zoo\n"),
    "areas/inner.md": note("area", "areas/foo", "Inner", "# Inner\n"),
    "areas/other_child.md": note("area", "areas/zebra", "Other Child", "# Other Child\n"),
    "projects/foo.md": project("foo", "areas/pig"),
    "projects/goo.md": project("goo", "areas/pig"),
    "projects/zoo.md": project("zoo", "areas/pig"),
    "projects/bar.md": project("bar", "projects/foo"),
    "projects/baz.md": project("baz", "projects/foo"),
    "projects/bop.md": project("bop", "projects/foo"),
    "projects/closed_a.md": project("closed a", "projects/foo", true),
    "projects/closed_b.md": project("closed b", "projects/foo", true),
    "projects/alpha.md": project("alpha", "projects/goo"),
    "projects/beta.md": project("beta", "projects/goo"),
    "projects/closed_gooa.md": project("closed goo", "projects/goo", true),
    "projects/host64.md": project("host64", "areas/zebra"),
    "notebooks/n1a.md": note("notebook", "areas/pig", "N1 A", "# N1 A\n"),
    "notebooks/n1b.md": note("notebook", "areas/pig", "N1 B", "# N1 B\n"),
    "notebooks/n1c.md": note("notebook", "areas/pig", "N1 C", "# N1 C\n"),
    "notebooks/n2a.md": note("notebook", "notebooks/n1a", "N2 A", "# N2 A\n"),
    "notebooks/n2b.md": note("notebook", "notebooks/n1a", "N2 B", "# N2 B\n"),
    "notebooks/n3a.md": note("notebook", "notebooks/n2a", "N3 A", "# N3 A\n"),
    "notebooks/n3b.md": note("notebook", "notebooks/n2a", "N3 B", "# N3 B\n"),
    "prose/alpha.md": note("prose", "areas/pig", "Alpha Essay", "# Alpha Essay\n"),
    "prose/beta.md": note("prose", "areas/pig", "Beta Essay", "# Beta Essay\n"),
    "prose/gamma.md": note("prose", "areas/pig", "Gamma Essay", "# Gamma Essay\n"),
    "prose/foo_story.md": note("article", "areas/foo", "Foo Story", "# Foo Story\n"),
    "prose/authored.md": note("prose", "areas/zebra", "Authored Story",
      "# Authored Story\n\n[[prose/authored_prev|‹ Curated Previous]] · [[prose/authored_next|Curated Next ›]]\n"),
    "prose/authored_prev.md": note("prose", "areas/zebra", "Aardvark", "# Aardvark\n"),
    "prose/authored_next.md": note("prose", "areas/zebra", "Curated Next", "# Curated Next\n"),
    "prose/inline_code.md": note("prose", "areas/zebra", "Inline Code",
      "# Inline Code\n\n" + String.fromCharCode(96) + "[[prose/fake_next|‹ Fake]] · [[prose/fake_next|Fake ›]]" + String.fromCharCode(96) + "\n"),
    "prose/inline_code_next.md": note("prose", "areas/zebra", "Inline Code Next", "# Inline Code Next\n"),
    "prose/fake_next.md": note("prose", "areas/zebra", "Fake Next", "# Fake Next\n"),
    "prose/no_parent.md": note("prose", null, "No Parent", "# No Parent\n"),
    "prose/list_parent.md": [
      "---", 'type: "[[prose]]"', "parent:", '  - "[[areas/pig]]"', '  - "[[areas/zebra]]"', "---", "",
      "# List Parent", "",
    ].join("\n"),
    "prose/unresolved_parent.md": note("prose", "missing-parent", "Unresolved", "# Unresolved\n"),
    "prose/self_parent.md": note("prose", "prose/self_parent", "Self Parent", "# Self Parent\n"),
    "prose/cycle_a.md": note("prose", "prose/cycle_b", "Cycle A", "# Cycle A\n"),
    "prose/cycle_b.md": note("prose", "prose/cycle_a", "Cycle B", "# Cycle B\n"),
    "2026/20261126.md": ['---', 'type: "[[day]]"', "date: 2026-11-26", "id: 20261126", 'parent: "[[2026/2026-W48]]"', "---", "", "# 2026-11-26", ""].join("\n"),
    "2026/20261127.md": ['---', 'type: "[[day]]"', "date: 2026-11-27", "id: 20261127", 'parent: "[[2026/2026-W48]]"', "---", "", "# 2026-11-27", ""].join("\n"),
    "2026/2026-W48.md": ['---', 'type: "[[week]]"', "year: 2026", "week: 48", 'parent: "[[2026/2026-Q4]]"', "---", "", "# 2026-W48", ""].join("\n"),
    "2026/2026-Q4.md": ['---', 'type: "[[quarter]]"', "year: 2026", "quarter: 4", 'parent: "[[2026]]"', "---", "", "# 2026-Q4", ""].join("\n"),
    "2026.md": ['---', 'type: "[[year]]"', "year: 2026", "---", "", "# 2026", ""].join("\n"),
  };
  for (let index = 0; index < 64; index += 1) {
    const suffix = String(index).padStart(2, "0");
    const stem = "walk64_" + suffix;
    notes["projects/" + stem + ".md"] = project(stem, "projects/host64");
  }
  Object.assign(notes, recordWalk.fixtureNotes());
  return notes;
}

function selfTest() {
  const notes = fixtureNotes();
  assert.equal(TREE_CASES.length, 4);
  assert.equal(KEYS.length, 8);
  assert.equal(Object.keys(notes).filter((name) => /^projects\/walk64_\d+\.md$/.test(name)).length, 64);
  for (const spec of TREE_CASES) {
    assert.ok(notes[spec.path], "fixture " + spec.path);
    for (const key of KEYS) assert.ok(notes[spec[key.stop]], spec.kind + " " + key.key);
  }
  assert.match(notes["prose/authored.md"], /Curated Next/);
  assert.ok(notes["prose/inline_code.md"].includes(String.fromCharCode(96)));
  assert.match(notes["prose/list_parent.md"], /parent:\n  -/);
  assert.match(notes["projects/closed_a.md"], /^\-\s+\[x\]/m);
  assert.equal(recordWalk.reportFixture().albums.length, 3);
  assert.deepEqual(parseArgs(["-e", "/x/obsidian", "-o", "/tmp/shots", "-r", "/tmp/report.json", "-s"]), {
    executable: "/x/obsidian", out: "/tmp/shots", report: "/tmp/report.json", selfTest: true, help: false,
  });
  assert.throws(() => parseArgs(["--report"]), /requires/);
  assert.throws(() => parseArgs(["--unknown"]), /Unknown/);
  process.stdout.write("offline tree-walk self-test complete; no Obsidian launched\n");
}

function treeHash(rows) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(Object.entries(rows).sort(([left], [right]) => left.localeCompare(right))))
    .digest("hex");
}

function vaultSnapshot(vault) {
  const rows = {};
  const walk = (directory) => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      if (item.name === ".obsidian" || item.name === ".git" || item.name === ".trash") continue;
      const filename = path.join(directory, item.name);
      if (item.isDirectory()) walk(filename);
      else if (item.isFile()) rows[path.relative(vault, filename)] = fs.readFileSync(filename, "utf8");
    }
  };
  walk(vault);
  return rows;
}

function surfaceProbe() {
  return [
    "(() => {",
    "const root = " + SURFACE + ";",
    "const ledger = app.plugins.plugins[" + JSON.stringify(LEDGER) + "];",
    'const rail = root?.querySelector(".bob-link-walk-rail") || null;',
    'const one = (selector) => { const item = rail?.querySelector(selector) || null; return item ? { target: item.getAttribute("data-href") || item.getAttribute("href"), source: item.getAttribute("data-source"), text: (item.innerText || item.textContent || "").replace(/\\s+/g, " ").trim() } : null; };',
    "const view = ledger?.freshnessFooterLastView || null;",
    "const arm = (item) => item ? { path: item.path, target: item.target, text: item.text, source: item.source } : null;",
    'const card = root?.querySelector(".bob-property-card, .bob-record-sheet") || null;',
    "const children = card ? Array.from(card.children) : [];",
    'const floor = children.find((item) => item.getAttribute?.("data-card-floor") === "link-walk") || null;',
    "return { active: " + ACTIVE + ",",
    "rail: rail ? { prev: one('.bob-property-card-rail-item[data-rail=\"prev\"]'), parent: one('.bob-property-card-rail-item[data-rail=\"parent\"]'), next: one('.bob-property-card-rail-item[data-rail=\"next\"]'), prevGroup: one('.bob-property-card-group-arm[data-group=\"prev\"]'), nextGroup: one('.bob-property-card-group-arm[data-group=\"next\"]') } : null,",
    "footer: view ? { panel: view.panel, dueText: view.dueText, contextText: view.contextText, prev: arm(view.linkPrev), next: arm(view.linkNext), prevGroup: arm(view.linkGroupPrev), nextGroup: arm(view.linkGroupNext) } : null,",
    'floor: floor ? { last: children[children.length - 1] === floor, className: String(floor.className || ""), childCount: children.length } : null,',
    'cardText: card ? (card.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 240) : "" };',
    "})()",
  ].join("\n");
}

function activeTreeAnswer(notePath) {
  return [
    "(async () => {",
    "const file = app.vault.getAbstractFileByPath(" + JSON.stringify(notePath) + ");",
    "const content = file ? await app.vault.cachedRead(file) : '';",
    "return app.plugins.plugins[" + JSON.stringify(LEDGER) + "].api.navGroups.resolve({ path: " + JSON.stringify(notePath) + ", content });",
    "})()",
  ].join("\n");
}

function buildReport(filename, result) {
  if (!filename) return;
  fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  fs.writeFileSync(filename, JSON.stringify(result, null, 2) + "\n");
}

async function runE2e(args) {
  const executable = args.executable || process.env.OBSIDIAN_BIN || "/snap/bin/obsidian";
  const probe = harness.probeExecutable(executable);
  if (!probe.ok) return { status: "skipped", reason: probe.reason, executable };
  if (process.platform === "linux" && !process.env.DISPLAY) {
    return { status: "skipped", reason: "Run under xvfb-run -a with an independent display", executable };
  }

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "bob-tree-walk-"));
  const vault = path.join(scratch, "vault");
  const profile = path.join(scratch, "profile");
  const shim = path.join(scratch, "bin");
  const spawnLog = path.join(scratch, "bob-spawns.jsonl");
  const outDir = path.resolve(args.out || path.join(scratch, "screenshots"));
  fs.mkdirSync(vault, { recursive: true });
  fs.mkdirSync(shim, { recursive: true });
  for (const id of [NAV, LEDGER]) {
    harness.copyPluginFiles(path.join(ROOT, "plugins", id), path.join(vault, ".obsidian", "plugins", id));
  }
  fs.writeFileSync(path.join(vault, ".obsidian", "community-plugins.json"), JSON.stringify([NAV, LEDGER]));
  fs.writeFileSync(path.join(vault, ".obsidian", "core-plugins.json"), JSON.stringify(["file-explorer", "page-preview", "editor-status", "command-palette"]));
  fs.writeFileSync(path.join(vault, ".obsidian", "app.json"), JSON.stringify({
    livePreview: true, showInlineTitle: true, propertiesInDocument: "visible", alwaysUpdateLinks: false, vimMode: true,
  }, null, 2));
  for (const [name, body] of Object.entries(fixtureNotes())) {
    const filename = path.join(vault, name);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, body);
  }
  fs.writeFileSync(path.join(shim, "bob"), [
    "#!/usr/bin/env node",
    'const fs = require("node:fs");',
    'try { fs.appendFileSync(process.env.BOB_TREE_WALK_SPAWNS, JSON.stringify(process.argv.slice(2)) + "\\n"); } catch (_) {}',
    'process.stdout.write(JSON.stringify({ ok: true, schema_version: 1, counts: {}, areas: [], projects: [], notebooks: [], albums: [] }) + "\\n");',
    "",
  ].join("\n"), { mode: 0o755 });
  shared.seedProfile(profile, vault);
  const port = await harness.freePort();
  const env = {
    ...process.env, BOB_DIR: vault, BOB_CONFIG_FILE: path.join(scratch, "missing-config.yml"),
    BOB_TREE_WALK_SPAWNS: spawnLog, PATH: shim + path.delimiter + (process.env.PATH || ""), TMPDIR: "/tmp",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, [
    "--no-sandbox", "--user-data-dir=" + profile, "--remote-debugging-port=" + port,
    "--remote-allow-origins=http://127.0.0.1/*", vault,
  ], { cwd: os.tmpdir(), env, detached: process.platform !== "win32", stdio: ["ignore", "ignore", "pipe"] });
  const result = {
    status: "running", verdict: "pending visual review", executable, checks: [], screenshots: [], perf: {},
    fixture: { treeTypes: TREE_CASES.map((item) => item.kind), keys: KEYS.map((item) => item.key), projectChildren: 64 },
  };
  const cdpErrors = [];
  let client = null;
  const check = (name, passed, evidence) => {
    const row = { name, status: passed ? "pass" : "fail" };
    if (evidence !== undefined) row.evidence = evidence;
    result.checks.push(row);
    assert.ok(passed, name + (evidence === undefined ? "" : ": " + JSON.stringify(evidence)));
  };
  const open = async (notePath, mode = "live") => {
    const opened = await shared.openNote(client, notePath, mode);
    assert.ok(opened && opened.ok, "open " + notePath + ": " + JSON.stringify(opened));
    await harness.waitFor(client, ACTIVE, (value) => value === notePath, "active note " + notePath);
  };
  const runCommand = (command) => client.evaluate("app.commands.executeCommandById(" + JSON.stringify(NAV + ":" + command) + ")");

  try {
    client = await harness.connectToOwnedPage(port, vault);
    await shared.trustCommunityPlugins(client);
    await client.call("Page.bringToFront");
    await client.call("Emulation.setFocusEmulationEnabled", { enabled: true });
    await client.call("Runtime.enable");
    client.socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.method !== "Runtime.consoleAPICalled" || message.params?.type !== "error") return;
        cdpErrors.push({
          text: (message.params.args || []).map((item) => item.value || item.description || "").join(" "),
          url: message.params.stackTrace?.callFrames?.[0]?.url || "",
        });
      } catch (_) {}
    });
    const apis = await harness.waitFor(client, "(() => { const p = app.plugins.plugins; return { walkMode: p[" +
      JSON.stringify(NAV) + "]?.api?.walkMode?.version || 0, navGroups: p[" +
      JSON.stringify(LEDGER) + "]?.api?.navGroups?.version || 0, ledger: Boolean(p[" +
      JSON.stringify(LEDGER) + "]) }; })()",
    (value) => value && value.walkMode >= 7 && value.navGroups >= 1 && value.ledger, "walk APIs");
    result.apis = apis;
    await client.evaluate([
      "(() => {",
      "const ledger = app.plugins.plugins[" + JSON.stringify(LEDGER) + "];",
      "const report = ledger.constructor.helpers.albumIndexReport(" + JSON.stringify(recordWalk.reportFixture()) + ");",
      "ledger.albumReportState = () => ({ report, stale: false, reportGeneration: 1 });",
      "ledger.albumScheduleSync = () => { window.__treeWalkBobRequests = (window.__treeWalkBobRequests || 0) + 1; };",
      "app.plugins.plugins[" + JSON.stringify(NAV) + "].api.walkMode.select('n');",
      "window.__treeWalkErrors = [];",
      "window.addEventListener('error', (event) => window.__treeWalkErrors.push(String(event.message)));",
      "window.addEventListener('unhandledrejection', (event) => window.__treeWalkErrors.push(String(event.reason)));",
      "})()",
    ].join("\n"));

    result.perf.indexBuild = await client.evaluate([
      "(() => { const ledger = app.plugins.plugins[" + JSON.stringify(LEDGER) + "];",
      "const started = performance.now(); const built = ledger.navGroupsTreeEnsureBuilt();",
      "return { ms: performance.now() - started, built: built !== false }; })()",
    ].join("\n"));
    check("tree index builds", result.perf.indexBuild.built, result.perf.indexBuild);

    for (const spec of TREE_CASES) {
      await open(spec.path, "live");
      const probe = await harness.waitFor(client, surfaceProbe(),
        (value) => value?.rail && value?.floor && value.footer?.panel === "links",
        spec.kind + " rail, footer, and floor");
      for (const name of ["prev", "next", "prevGroup", "nextGroup"]) {
        const expected = spec[name];
        const actualRail = probe.rail[name]?.target;
        const actualFooter = probe.footer[name]?.path;
        check(spec.kind + " rail " + name + " matches the walk",
          actualRail === expected.replace(/\.md$/i, ""), { expected, actual: actualRail });
        check(spec.kind + " footer " + name + " matches the walk",
          actualFooter === expected, { expected, actual: actualFooter });
      }
      check(spec.kind + " rail is the card floor", probe.floor.last, probe.floor);
      result[spec.kind + "Start"] = probe;
    }

    for (const spec of TREE_CASES) {
      for (const key of KEYS) {
        const expected = spec[key.stop];
        await open(spec.path, "live");
        await runCommand(key.command);
        const landed = await harness.waitFor(client, ACTIVE, (value) => value === expected,
          spec.kind + " " + key.key + " landing");
        check(spec.kind + " " + key.key + " lands on " + expected,
          landed === expected, { from: spec.path, to: landed });
      }
    }

    await open("prose/inline_code.md", "live");
    await runCommand("open-next-link");
    const inlineLanding = await harness.waitFor(client, ACTIVE,
      (value) => value === "prose/inline_code_next.md" || value === "prose/fake_next.md", "inline-code step");
    check("inline-code link does not hijack a tree step", inlineLanding === "prose/inline_code_next.md", inlineLanding);
    await open("prose/authored.md", "live");
    const authoredProbe = await harness.waitFor(client, surfaceProbe(),
      (value) => value?.rail?.next && value?.footer?.next, "authored step");
    check("authored nav line wins on rail and footer",
      authoredProbe.rail.next.target === "prose/authored_next" &&
      authoredProbe.rail.next.source === "authored" &&
      authoredProbe.footer.next.path === "prose/authored_next.md", authoredProbe);
    await runCommand("open-next-link");
    check("authored nav key opens its destination",
      await harness.waitFor(client, ACTIVE, (value) => value === "prose/authored_next.md", "authored next key") === "prose/authored_next.md");

    for (const [notePath, reason] of [
      ["prose/no_parent.md", "no-parent"],
      ["prose/list_parent.md", "list-parent"],
      ["prose/unresolved_parent.md", "unresolved-parent"],
      ["prose/self_parent.md", "self-parent"],
      ["prose/cycle_a.md", "cycle"],
    ]) {
      const answer = await client.evaluate(activeTreeAnswer(notePath));
      check(notePath + " has an explicit " + reason,
        answer?.route === "tree" && answer?.none?.reason === reason,
        { route: answer?.route, none: answer?.none });
    }

    await open("projects/baz.md", "live");
    const beforeLive = await harness.waitFor(client, surfaceProbe(), (value) => value?.rail?.next && value?.floor, "live project rail");
    const identities = await client.evaluate([
      "(() => { const root = " + SURFACE + ";",
      "window.__treeWalkCard = root?.querySelector('.bob-property-card') || null;",
      "window.__treeWalkRail = root?.querySelector('.bob-link-walk-rail') || null;",
      "return { card: Boolean(window.__treeWalkCard), rail: Boolean(window.__treeWalkRail) }; })()",
    ].join("\n"));
    check("live-update project card is mounted", identities.card && identities.rail, identities);
    await client.evaluate([
      "(async () => { const file = app.vault.getAbstractFileByPath('projects/baz.md');",
      "const text = await app.vault.cachedRead(file);",
      "await app.vault.modify(file, text.replace('parent: \"[[projects/foo]]\"', 'parent: \"[[projects/goo]]\"')); })()",
    ].join("\n"));
    const reparented = await harness.waitFor(client, activeTreeAnswer("projects/baz.md"),
      (answer) => answer?.group?.parentPath === "projects/goo.md", "reparent");
    const reparentRail = await harness.waitFor(client, surfaceProbe(),
      (value) => value?.rail?.prev?.target === "projects/alpha" && value?.rail?.next?.target === "projects/beta",
      "reparented rail");
    const sameAfterReparent = await client.evaluate("window.__treeWalkCard === " + SURFACE + "?.querySelector('.bob-property-card')");
    check("reparent updates the rail without rebuilding the card",
      sameAfterReparent && reparented.group.parentPath === "projects/goo.md",
      { group: reparented.group, before: beforeLive.rail, after: reparentRail.rail });

    await client.evaluate([
      "(async () => { const file = app.vault.getAbstractFileByPath('projects/beta.md');",
      "await app.fileManager.renameFile(file, 'projects/beta_renamed.md'); })()",
    ].join("\n"));
    const renameRail = await harness.waitFor(client, surfaceProbe(),
      (value) => value?.rail?.next?.target === "projects/beta_renamed", "rename");
    const sameAfterRename = await client.evaluate("window.__treeWalkCard === " + SURFACE + "?.querySelector('.bob-property-card')");
    check("rename updates the rail without rebuilding the card",
      sameAfterRename && renameRail.rail.next.target === "projects/beta_renamed", renameRail.rail);

    await client.evaluate([
      "(async () => { const file = app.vault.getAbstractFileByPath('projects/baz.md');",
      "const text = await app.vault.cachedRead(file);",
      "await app.vault.modify(file, text.replace('- [ ] #task', '- [x] #task')); })()",
    ].join("\n"));
    const lane = await harness.waitFor(client, activeTreeAnswer("projects/baz.md"),
      (answer) => answer?.lane === "closed", "project close lane");
    const closedRail = await harness.waitFor(client, surfaceProbe(),
      (value) => value?.rail?.next?.target === "projects/closed_gooa", "closed lane rail");
    const sameAfterLane = await client.evaluate("window.__treeWalkCard === " + SURFACE + "?.querySelector('.bob-property-card')");
    check("^prj toggle updates the lane rail without rebuilding the card",
      sameAfterLane && lane.lane === "closed" && closedRail.rail.next.target === "projects/closed_gooa",
      { lane: lane.lane, rail: closedRail.rail, sameCard: sameAfterLane });

    await open("areas/goo.md", "live");
    await harness.waitFor(client, surfaceProbe(), (value) => value?.rail && value?.floor, "passivity rail ready");
    fs.writeFileSync(spawnLog, "");
    const writeSpy = await client.evaluate([
      "(() => { const vault = app.vault; window.__treeWalkWrites = [];",
      "for (const name of ['modify','create','delete','rename','append','process','modifyBinary','createBinary','deleteBinary']) {",
      "const original = vault[name]; if (typeof original !== 'function') continue;",
      "try { vault[name] = function(...args) { window.__treeWalkWrites.push(name); return original.apply(this, args); }; } catch (_) {}",
      "} return true; })()",
    ].join("\n"));
    const passivityBefore = treeHash(vaultSnapshot(vault));
    await client.evaluate("app.plugins.plugins[" + JSON.stringify(LEDGER) + "].treeWalkRailRefresh('areas/goo.md')");
    await harness.sleep(500);
    const passive = await client.evaluate([
      "({ writes: window.__treeWalkWrites || [],",
      "rail: " + SURFACE + "?.querySelector('.bob-link-walk-rail')?.getAttribute('data-card-floor'),",
      "errors: window.__treeWalkErrors || [] })",
    ].join("\n"));
    const spawns = fs.existsSync(spawnLog) ? fs.readFileSync(spawnLog, "utf8").split(/\r?\n/).filter(Boolean) : [];
    const passivityAfter = treeHash(vaultSnapshot(vault));
    check("rail refresh performs no vault writes or bob spawns",
      writeSpy && passive.writes.length === 0 && spawns.length === 0 &&
      passivityBefore === passivityAfter && passive.rail === "link-walk",
      { passive, spawns, passivityBefore, passivityAfter });
    result.passivity = { writes: passive.writes, bobSpawns: spawns.length, vaultHash: passivityAfter };

    for (const spec of TREE_CASES) {
      await open(spec.path, "live");
      let floor = await harness.waitFor(client, surfaceProbe(), (value) => value?.floor, spec.kind + " live floor");
      check(spec.kind + " live rail is last", floor.floor.last, floor.floor);
      if (spec.kind === "area") {
        const toggled = await client.evaluate([
          "(() => { const toggle = " + SURFACE + "?.querySelector('.bob-property-card-cabinets .bob-cabinet-toggle');",
          "if (!toggle) return false; toggle.click(); return true; })()",
        ].join("\n"));
        check("area cabinet toggle exists", toggled);
        floor = await harness.waitFor(client, surfaceProbe(), (value) => value?.floor?.last, "floor after cabinet toggle");
        check("area rail remains last after cabinet toggle", floor.floor.last, floor.floor);
      }
      await open(spec.path, "live");
      floor = await harness.waitFor(client, surfaceProbe(), (value) => value?.floor, spec.kind + " repaint");
      check(spec.kind + " rail remains last after repaint", floor.floor.last, floor.floor);
      await open(spec.path, "reading");
      floor = await harness.waitFor(client, surfaceProbe(), (value) => value?.floor, spec.kind + " Reading");
      check(spec.kind + " Reading rail is last", floor.floor.last, floor.floor);
    }

    for (const notePath of ["2026/20261126.md", "eat/a.md"]) {
      for (const mode of ["live", "reading"]) {
        await open(notePath, mode);
        const floor = await harness.waitFor(client, surfaceProbe(), (value) => value?.floor, notePath + " " + mode);
        check(notePath + " " + mode + " rail is last", floor.floor.last, floor.floor);
        await open(notePath, mode);
        const repainted = await harness.waitFor(client, surfaceProbe(), (value) => value?.floor, notePath + " repaint");
        check(notePath + " " + mode + " floor survives repaint", repainted.floor.last, repainted.floor);
      }
    }

    await shared.collapseSidebars(client);
    await shared.setViewport(client, 420, 900);
    for (const spec of TREE_CASES) {
      for (const mode of ["live", "reading"]) {
        await open(spec.path, mode);
        for (const theme of ["light", "dark"]) {
          await client.call("Emulation.setEmulatedMedia", { media: "screen", features: [] });
          await shared.setTheme(client, theme);
          const ready = await harness.waitFor(client, surfaceProbe(), (value) => value?.rail && value?.floor?.last,
            spec.kind + " " + mode + " " + theme + " screenshot");
          const focused = await client.evaluate([
            "(() => { const root = " + SURFACE + ";",
            "const item = root?.querySelector('.bob-link-walk-rail .bob-property-card-rail-item[data-rail=\"next\"]') ||",
            "root?.querySelector('.bob-link-walk-rail .bob-property-card-group-arm[data-group=\"next\"]');",
            "item?.focus({ preventScroll: true }); return Boolean(item && document.activeElement === item); })()",
          ].join("\n"));
          check(spec.kind + " " + mode + " " + theme + " focusable capture", focused, ready.floor);
          const name = spec.kind + "-" + mode + "-" + theme + "-420";
          const shot = await shared.capture(client, outDir, name, 420, theme, mode);
          shot.feature = "standard";
          shot.visualVerdict = "pending inspection";
          result.screenshots.push(shot);
        }
        await client.call("Emulation.setEmulatedMedia", {
          media: "screen", features: [{ name: "forced-colors", value: "active" }],
        });
        await shared.setTheme(client, "light");
        const forced = await harness.waitFor(client, "({ forced: matchMedia('(forced-colors: active)').matches, probe: " +
          surfaceProbe() + " })", (value) => value?.forced && value?.probe?.rail && value?.probe?.floor?.last,
        spec.kind + " " + mode + " forced-colors screenshot");
        const forcedFocus = await client.evaluate([
          "(() => { const root = " + SURFACE + ";",
          "const item = root?.querySelector('.bob-link-walk-rail .bob-property-card-rail-item[data-rail=\"next\"]') ||",
          "root?.querySelector('.bob-link-walk-rail .bob-property-card-group-arm[data-group=\"next\"]');",
          "item?.focus({ preventScroll: true }); return Boolean(item && document.activeElement === item); })()",
        ].join("\n"));
        check(spec.kind + " " + mode + " forced-colors focus", forcedFocus,
          { forced: forced.forced, floor: forced.probe.floor });
        const forcedShot = await shared.capture(client, outDir, spec.kind + "-" + mode + "-forced-colors-420", 420, "light", mode);
        forcedShot.feature = "forced-colors";
        forcedShot.visualVerdict = "pending inspection";
        result.screenshots.push(forcedShot);
        await client.call("Emulation.setEmulatedMedia", { media: "screen", features: [] });
      }
    }
    result.screenshotMatrix = {
      types: TREE_CASES.map((item) => item.kind), views: ["Live Preview", "Reading"],
      variants: ["light 420px", "dark 420px", "forced colors 420px"],
      expected: 24, actual: result.screenshots.length,
    };
    check("all review screenshots captured", result.screenshots.length === 24, result.screenshotMatrix);

    await client.evaluate([
      "(() => { window.__treeWalkLongTasks = [];",
      "const observer = new PerformanceObserver((list) => {",
      "for (const entry of list.getEntries()) window.__treeWalkLongTasks.push({ startTime: entry.startTime, duration: entry.duration });",
      "}); observer.observe({ type: 'longtask' }); window.__treeWalkObserver = observer; })()",
    ].join("\n"));
    const timedOpen = async (notePath, railExpected) => {
      await client.evaluate([
        "(async () => { window.__treeWalkPaintStart = performance.now();",
        "const file = app.vault.getAbstractFileByPath(" + JSON.stringify(notePath) + ");",
        "const leaf = app.workspace.getLeaf(false);",
        "await leaf.openFile(file, { state: { mode: 'preview', source: false } });",
        "if (leaf.view?.setState) await leaf.view.setState(Object.assign({}, leaf.view.getState?.() || {},",
        "{ mode: 'preview', source: false }), { history: false }); })()",
      ].join("\n"));
      await harness.waitFor(client, surfaceProbe(),
        (value) => value?.cardText && (railExpected ? value?.rail && value?.floor : !value?.rail),
        "timed Reading paint " + notePath);
      return client.evaluate("performance.now() - window.__treeWalkPaintStart");
    };
    const perfPaths = Array.from({ length: 5 }, (_, index) =>
      "projects/walk64_" + String(index).padStart(2, "0") + ".md");
    const withRail = [];
    const withRailStart = await client.evaluate("performance.now()");
    for (const notePath of perfPaths) withRail.push(await timedOpen(notePath, true));
    const withRailEnd = await client.evaluate("performance.now()");
    const stub = await client.evaluate([
      "(() => { const ledger = app.plugins.plugins[" + JSON.stringify(LEDGER) + "];",
      "const nav = app.plugins.plugins[" + JSON.stringify(NAV) + "].api.walkMode;",
      "window.__treeWalkOriginalAnswer = ledger.treeWalkRailAnswer;",
      "window.__treeWalkOriginalLinks = nav.links;",
      "ledger.treeWalkRailAnswer = () => null; nav.links = () => ({ ok: false, reason: 'unavailable' });",
      "return { hook: 'treeWalkRailAnswer provider-unavailable test hook', installed: true }; })()",
    ].join("\n"));
    const withoutRail = [];
    const withoutRailStart = await client.evaluate("performance.now()");
    for (const notePath of perfPaths) withoutRail.push(await timedOpen(notePath, false));
    const withoutRailEnd = await client.evaluate("performance.now()");
    await client.evaluate([
      "(() => { const ledger = app.plugins.plugins[" + JSON.stringify(LEDGER) + "];",
      "const nav = app.plugins.plugins[" + JSON.stringify(NAV) + "].api.walkMode;",
      "ledger.treeWalkRailAnswer = window.__treeWalkOriginalAnswer; nav.links = window.__treeWalkOriginalLinks;",
      "const observer = window.__treeWalkObserver;",
      "for (const entry of observer?.takeRecords() || []) window.__treeWalkLongTasks.push({ startTime: entry.startTime, duration: entry.duration });",
      "observer?.disconnect(); })()",
    ].join("\n"));
    const longTaskRecords = await client.evaluate("window.__treeWalkLongTasks || []");
    const longTasksIn = (start, end) => longTaskRecords
      .filter((entry) => entry.startTime < end && entry.startTime + entry.duration > start)
      .map((entry) => Number(entry.duration.toFixed(2)));
    const withRailLongTasks = longTasksIn(withRailStart, withRailEnd);
    const withoutRailLongTasks = longTasksIn(withoutRailStart, withoutRailEnd);
    const median = (values) => {
      const sorted = values.slice().sort((left, right) => left - right);
      return sorted.length % 2 ? sorted[(sorted.length - 1) / 2]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    };
    result.perf.readingPaintMs = {
      hostChildren: 64, samples: 5,
      withRail: withRail.map((value) => Number(value.toFixed(2))),
      providerStubbed: withoutRail.map((value) => Number(value.toFixed(2))),
      medianWithRail: Number(median(withRail).toFixed(2)),
      medianProviderStubbed: Number(median(withoutRail).toFixed(2)),
      ratio: Number((median(withRail) / median(withoutRail)).toFixed(4)),
      longTasksMs: withRailLongTasks,
      providerStubbedLongTasksMs: withoutRailLongTasks,
      providerUnavailableHook: stub,
    };
    check("64-child Reading paint is within 1.15x",
      result.perf.readingPaintMs.ratio <= 1.15, result.perf.readingPaintMs);
    check("64-child Reading paint has no long task over 50ms",
      result.perf.readingPaintMs.longTasksMs.every((duration) => duration <= 50),
      result.perf.readingPaintMs.longTasksMs);

    await open("prose/authored.md", "live");
    await harness.waitFor(client, surfaceProbe(), (value) => value?.rail?.next, "stale-link source");
    await client.evaluate([
      "(() => { window.__treeWalkStaleLink = " + SURFACE +
      "?.querySelector('.bob-link-walk-rail .bob-property-card-rail-item[data-rail=\"next\"]') || null;",
      "window.__treeWalkNotices = [];",
      "const observer = new MutationObserver(() => {",
      "for (const node of document.querySelectorAll('.notice')) { const text = (node.textContent || '').trim();",
      "if (text && !window.__treeWalkNotices.includes(text)) window.__treeWalkNotices.push(text); }",
      "}); observer.observe(document.body, { childList: true, subtree: true }); window.__treeWalkNoticeObserver = observer; })()",
    ].join("\n"));
    await client.evaluate([
      "(async () => { const target = app.vault.getAbstractFileByPath('prose/authored_next.md');",
      "await app.vault.delete(target); window.__treeWalkStaleLink?.click(); })()",
    ].join("\n"));
    const notices = await harness.waitFor(client, "window.__treeWalkNotices || []",
      (items) => items.some((item) => /The stop changed/i.test(item)), "stop changed notice");
    check("deleted stop between paint and click shows The stop changed",
      notices.some((item) => /The stop changed/i.test(item)), notices);
    await client.evaluate("window.__treeWalkNoticeObserver?.disconnect()");

    const pageErrors = await client.evaluate("window.__treeWalkErrors || []");
    check("no console errors", cdpErrors.length === 0 && pageErrors.length === 0,
      { cdp: cdpErrors, page: pageErrors });
    result.consoleErrors = cdpErrors.concat(pageErrors.map((text) => ({ text })));
    result.bobSpawns = fs.existsSync(spawnLog)
      ? fs.readFileSync(spawnLog, "utf8").split(/\r?\n/).filter(Boolean)
      : [];
    result.status = "passed";
    result.finishedAt = new Date().toISOString();
    result.verdict = "pending visual review";
  } catch (error) {
    result.status = "failed";
    result.error = String(error && error.stack || error);
    result.consoleErrors = cdpErrors;
  } finally {
    if (client) client.close();
    const exited = new Promise((resolve) => child.once("exit", resolve));
    try {
      if (process.platform === "win32") child.kill("SIGTERM");
      else process.kill(-child.pid, "SIGTERM");
    } catch (_) {}
    if (child.exitCode === null && child.signalCode === null) await Promise.race([exited, harness.sleep(2_000)]);
    result.screenshots = result.screenshots.map((shot) => ({ ...shot, path: path.resolve(shot.path) }));
    buildReport(args.report, result);
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  return result;
}

async function main(argv) {
  let args;
  try { args = parseArgs(argv); }
  catch (error) {
    process.stderr.write(String(error.message || error) + "\n");
    process.exitCode = 2;
    return;
  }
  if (args.help) {
    process.stdout.write("Usage: xvfb-run -a node scripts/obsidian-tree-walk-e2e.cjs [-e PATH] [-o SCREENSHOTS] [-r REPORT] [--self-test]\n");
    return;
  }
  if (args.selfTest) {
    try { selfTest(); }
    catch (error) { process.stderr.write(String(error.stack || error) + "\n"); process.exitCode = 1; }
    return;
  }
  const result = await runE2e(args);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (result.status === "failed") process.exitCode = 1;
}

if (require.main === module) void main(process.argv.slice(2));
module.exports = { fixtureNotes, TREE_CASES, KEYS, parseArgs, selfTest };
