#!/usr/bin/env node
// Real-Obsidian `[N` / `]N` group-jump acceptance in an owned scratch vault
// and profile. Period notes and the grouped album come from the real bob
// (periods ensure, albums sync); a logging shim lets the plugins reach only
// the period, album, and record writers. Never opens the live vault.
"use strict";

const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const harness = require("./obsidian-walker-footer-e2e.cjs");
const proof = require("./obsidian-record-card-workflow-lib.cjs");

const ROOT = path.resolve(__dirname, "..");
const NAV = "bob-navigation-hotkeys";
const LEDGER = "bob-ledger-tools";
const TEMPLATER = "templater-obsidian";
const BOB_NOW = "2026-11-21 12:00:00";
const ACTIVE_PATH = "(app.workspace.activeLeaf?.view?.file?.path || null)";
// Allowed real-bob subcommands; every other call is logged and refused.
const ALLOWED = ["periods ensure", "periods show", "albums list", "albums sync", "records show", "records update"];
// `bob periods ensure -d` dates that scaffold the canonical period notes.
const PERIOD_DATES = ["2025-12-29", "2026-03-30", "2026-06-29", "2026-07-20", "2026-09-28", "2026-11-16", "2027-01-11"];
const RECORDS = [
  ["yankee", "Yankee", "intro"], ["zulu", "Zulu", "intro"],
  ["alpha", "Alpha", "body"], ["mike", "Mike", "body"], ["oscar", "Oscar", "body"],
  ["bravo", "Bravo", "close"], ["charlie", "Charlie", "close"], ["delta", "Delta", "close"],
];

function parseArgs(argv) {
  const args = { executable: null, out: null, report: null, selfTest: false, help: false };
  const list = Array.isArray(argv) ? argv.slice() : [];
  for (let i = 0; i < list.length; i += 1) {
    const token = list[i];
    const value = () => {
      const next = list[++i];
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

function daily(date, nav) {
  const [y, m, d] = [date.slice(0, 4), date.slice(4, 6), date.slice(6, 8)];
  return `---\ntemplate: "[[daily]]"\ntype: "[[day]]"\ndate: ${y}-${m}-${d}\nid: ${date}\ntags:\n  - daily\n---\n\n# ${y}-${m}-${d}\n\n${nav ? nav + "\n\n" : ""}A day.\n`;
}

function record(stem, title, section) {
  return `---\nparent: "[[blog]]"\ntype: "[[record]]"\ntitle: ${title}\nsection: ${section}\n---\n\n## Notes\n\nAbout ${stem}.\n`;
}

// The daily template keeps the live template's frontmatter and nav line.
const DAILY_TEMPLATE = [
  "---",
  "parent: '[[<% moment(tp.file.title, \"YYYYMMDD\").format(\"GGGG/GGGG-[W]WW\") %>]]'",
  "template: \"[[daily]]\"",
  "type: \"[[day]]\"",
  "date: <% moment(tp.file.title, \"YYYYMMDD\").format(\"YYYY-MM-DD\") %>",
  "id: <% tp.file.title %>",
  "---",
  "",
  "# <% moment(tp.file.title, \"YYYYMMDD\").format(\"YYYY-MM-DD ddd\") %>",
  "",
  "[[<% tp.date.now(\"YYYY/YYYYMMDD\", -1, tp.file.title, \"YYYYMMDD\") %>|prev]] · [[<% moment(tp.file.title, \"YYYYMMDD\").format(\"GGGG/GGGG-[W]WW\") %>|<% moment(tp.file.title, \"YYYYMMDD\").format(\"[W]WW\") %>]] · [[<% tp.date.now(\"YYYY/YYYYMMDD\", 1, tp.file.title, \"YYYYMMDD\") %>|next]]",
  "",
].join("\n");

function fixtureNotes() {
  const notes = {
    ".gitignore": ".obsidian/\n.trash/\n",
    "_templates/daily.md": DAILY_TEMPLATE,
    "body.md": '---\ntype: "[[area]]"\nroot_parent: true\n---\n\n# Body\n',
    "blog.md": [
      "---", 'parent: "[[body]]"', 'type: "[[album]]"', "title: Blog", "emoji: 📇", "record:", "  noun: zettel",
      "  label: Zettel", "  fields:", "    section:", "      values:", "        intro: 🪝 Intro", "        body: 🧱 Body",
      "        close: 🏁 Close", "      required: true", "walk_by: section", "---", "", "# Blog", "",
    ].join("\n"),
    // Saturday 2026-11-21 (W47) keeps the template's written step line.
    "2026/20261121.md": daily("20261121", "[[2026/20261120|prev]] · [[2026/2026-W47|W47]] · [[2026/20261122|next]]"),
    "2026/20261109.md": daily("20261109", ""),
    "2026/20261111.md": daily("20261111", ""),
    "2026/20261116.md": daily("20261116", ""),
    // A legacy daily: no nav line, so [n / ]n use the derived step stops.
    "2026/20261110.md": daily("20261110", ""),
    "story/part_1.md": "# Part 1\n",
    "story/part_2.md": "# Part 2\n\n[[story/part_1|« Part 1]] · [[story/part_3|Part 3 »]]\n",
    "story/part_3.md": "# Part 3\n\n[[story/part_2|<< Part 2]] · [[story/part_4|Part 4 >>]]\n\n[[story/prelude|‹ Prelude]] · [[story/coda|Coda ›]]\n\nRead more [[story/appendix|Read more »]]\n",
    "story/part_4.md": "# Part 4\n\n[« Part 3](story/part_3.md) · [Part 5 »](story/part_5.md)\n",
    "story/part_5.md": "# Part 5\n",
    "story/prelude.md": "# Prelude\n",
    "story/coda.md": "# Coda\n",
    "story/appendix.md": "# Appendix\n",
    "story/clip.md": "# Clip\n\nRead more [[story/appendix|Read more »]]\n",
    "story/only_group.md": "# Only group\n\n[[story/part_2|<< Part 2]]\n",
  };
  for (const [stem, title, section] of RECORDS) notes[`blog/${stem}.md`] = record(stem, title, section);
  return notes;
}

function shimSource() {
  return `#!/usr/bin/env node
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
const allowed = ${JSON.stringify(ALLOWED)};
const verb = args.slice(0, 2).join(" ");
const hasStdin = args.some((arg, i) => (arg === "-i" || arg === "--input") && args[i + 1] === "-");
const input = hasStdin ? fs.readFileSync(0, "utf8") : undefined;
const log = (entry) => { try { fs.appendFileSync(process.env.BOB_GROUP_E2E_LOG, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\\n"); } catch (_) {} };
if (!allowed.includes(verb)) { log({ event: "blocked", args }); process.stderr.write("blocked by the group-jump e2e shim\\n"); process.exit(1); }
log({ event: "start", args, input });
const result = spawnSync(process.env.BOB_GROUP_E2E_REAL, args, { encoding: "utf8", env: process.env, input, timeout: 90000, maxBuffer: 32 * 1024 * 1024 });
log({ event: "finish", args, exitCode: result.status, stdout: String(result.stdout || "").slice(0, 4000), stderr: String(result.stderr || "").slice(0, 2000) });
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status == null ? 1 : result.status);
`;
}

function findBob() {
  const candidates = [process.env.BOB_BIN, path.join(os.homedir(), ".cargo", "bin", "bob"), path.join(os.homedir(), ".local", "bin", "bob")];
  for (const candidate of candidates) {
    try { if (candidate) { fs.accessSync(candidate, fs.constants.X_OK); return fs.realpathSync(candidate); } } catch (_) {}
  }
  const which = spawnSync("which", ["bob"], { encoding: "utf8" });
  return which.status === 0 ? which.stdout.trim() : "";
}

function findTemplater() {
  for (const dir of [process.env.BOB_E2E_TEMPLATER_DIR, path.join(os.homedir(), "bob", ".obsidian", "plugins", TEMPLATER)]) {
    if (dir && fs.existsSync(path.join(dir, "main.js")) && fs.existsSync(path.join(dir, "manifest.json"))) return dir;
  }
  return null;
}

function bobEnv(vault, profile, shim) {
  const env = {
    ...process.env, HOME: profile, BOB_DIR: vault, BOB_NOW, NO_COLOR: "1",
    BOB_CONFIG_FILE: path.join(profile, "missing-config.yml"),
    BOB_GROUP_E2E_LOG: path.join(profile, "bob-invocations.jsonl"),
    BOB_GROUP_E2E_REAL: process.env.BOB_GROUP_E2E_REAL || "",
    // Electron's singleton socket path must stay short; long agent TMPDIRs break launch.
    PATH: shim + path.delimiter + (process.env.PATH || ""), TMPDIR: "/tmp",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function runBob(bob, vault, profile, args) {
  const result = spawnSync(bob, args, { cwd: vault, encoding: "utf8", timeout: 90_000, env: bobEnv(vault, profile, path.join(profile, "shim")) });
  let json = null;
  try { json = JSON.parse(result.stdout); } catch (_) {}
  if (result.status !== 0 || !json || json.ok === false) throw new Error(`bob ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  return json;
}

function git(vault, args) {
  const result = spawnSync("git", args, { cwd: vault, encoding: "utf8", timeout: 20_000 });
  if (result.status !== 0) throw new Error("git " + args.join(" ") + ": " + (result.stderr || result.stdout));
  return result.stdout;
}

function seedVault(vault, profile, bob, templater) {
  for (const [name, text] of Object.entries(fixtureNotes())) {
    fs.mkdirSync(path.dirname(path.join(vault, name)), { recursive: true });
    fs.writeFileSync(path.join(vault, name), text);
  }
  const ids = [NAV, LEDGER, TEMPLATER];
  for (const id of [NAV, LEDGER]) harness.copyPluginFiles(path.join(ROOT, "plugins", id), path.join(vault, ".obsidian", "plugins", id));
  harness.copyPluginFiles(templater, path.join(vault, ".obsidian", "plugins", TEMPLATER));
  fs.writeFileSync(path.join(vault, ".obsidian", "plugins", TEMPLATER, "data.json"), JSON.stringify({
    templates_folder: "_templates", trigger_on_file_creation: false, trigger_on_file_creation_mode: "none",
    folder_templates: [], file_templates: [], enabled_templates_hotkeys: [], startup_templates: [], user_scripts_folder: "",
  }, null, 2));
  fs.writeFileSync(path.join(vault, ".obsidian", "community-plugins.json"), JSON.stringify(ids));
  fs.writeFileSync(path.join(vault, ".obsidian", "core-plugins.json"), JSON.stringify(["page-preview", "editor-status", "command-palette"]));
  fs.writeFileSync(path.join(vault, ".obsidian", "app.json"), JSON.stringify({
    livePreview: true, vimMode: true, showInlineTitle: true, showLineNumber: false, alwaysUpdateLinks: false, propertiesInDocument: "visible",
  }, null, 2));
  git(os.tmpdir(), ["init", "-q", "--bare", vault + ".origin.git"]);
  git(os.tmpdir(), ["--git-dir", vault + ".origin.git", "symbolic-ref", "HEAD", "refs/heads/master"]);
  for (const args of [["init", "-q"], ["symbolic-ref", "HEAD", "refs/heads/master"], ["config", "user.email", "group-jump-e2e@example.com"],
    ["config", "user.name", "Group Jump E2E"], ["remote", "add", "origin", vault + ".origin.git"], ["add", "-A"],
    ["commit", "-q", "-m", "group jump fixtures"], ["push", "-q", "-u", "origin", "master"]]) git(vault, args);
  const periods = PERIOD_DATES.map((date) => runBob(bob, vault, profile, ["periods", "ensure", "-q", "-f", "json", "-d", date]).created);
  git(vault, ["add", "-A"]);
  git(vault, ["commit", "-q", "-m", "period notes"]);
  git(vault, ["push", "-q"]);
  const sync = runBob(bob, vault, profile, ["albums", "sync", "-f", "json"]);
  if (sync.counts.walk_lines !== RECORDS.length) throw new Error("albums sync wrote " + sync.counts.walk_lines + " walk lines");
  return { periods: periods.flat(), syncCommit: sync.commit && sync.commit.sha };
}

function snapshot(vault) {
  const rows = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if ([".git", ".obsidian"].includes(entry.name)) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) rows[path.relative(vault, file)] = fs.readFileSync(file, "utf8");
    }
  };
  walk(vault);
  return rows;
}

function treeHash(rows) {
  return crypto.createHash("sha256").update(JSON.stringify(Object.entries(rows).sort(([a], [b]) => a.localeCompare(b)))).digest("hex");
}

function walkLine(text) {
  return String(text || "").split("\n").find((line) => line.includes("|↑ Blog]]")) || null;
}

// Paths whose bytes differ between two snapshots, created and deleted included.
function changedPaths(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((name) => before[name] !== after[name]).sort();
}

function isEnsure(call) {
  return call.event === "start" && call.args[0] === "periods" && call.args[1] === "ensure";
}

function invocations(profile) {
  const file = path.join(profile, "bob-invocations.jsonl");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
}

const SURFACE = `(() => {
  const view = app.workspace.activeLeaf?.view;
  return view?.getMode?.() === "preview" ? view.previewMode?.containerEl : view?.contentEl?.querySelector(".markdown-source-view");
})()`;

function armProbe(direction) {
  return `(() => {
    const root = ${SURFACE};
    const arm = root && Array.from(root.querySelectorAll('.bob-property-card-group-arm[data-group="${direction}"]'))
      .find((node) => !node.closest(".markdown-embed, .internal-embed, .hover-popover") && node.getClientRects().length);
    return arm ? { path: ${ACTIVE_PATH}, href: arm.getAttribute("href"), state: arm.getAttribute("data-state"), title: arm.getAttribute("title") || "",
      text: (arm.innerText || "").replace(/\\s+/g, " ").trim(), wrap: Boolean(arm.querySelector(".bob-property-card-group-wrap")) } : { path: ${ACTIVE_PATH}, missing: true };
  })()`;
}

function footerProbe(direction) {
  const key = direction === "prev" ? "linkGroupPrev" : "linkGroupNext";
  return `(() => {
    const view = app.plugins.plugins[${JSON.stringify(LEDGER)}].freshnessFooterLastView;
    const arm = view && view[${JSON.stringify(key)}];
    return { path: ${ACTIVE_PATH}, panel: view && view.panel, arm: arm ? { path: arm.path, state: arm.state, text: arm.text, wraps: arm.wraps } : null };
  })()`;
}

async function runE2e(args) {
  const executable = args.executable || process.env.OBSIDIAN_BIN || "/snap/obsidian/current/app/obsidian";
  const probe = harness.probeExecutable(executable);
  if (!probe.ok) return { status: "skipped", reason: probe.reason };
  if (process.platform === "linux" && !process.env.DISPLAY) return { status: "skipped", reason: "Use an independent xvfb-run -a display" };
  const bob = findBob();
  if (!bob) return { status: "skipped", reason: "No bob binary: set BOB_BIN" };
  const templater = findTemplater();
  if (!templater) return { status: "skipped", reason: "No Templater plugin: set BOB_E2E_TEMPLATER_DIR" };
  const capsDir = fs.mkdtempSync(path.join(os.tmpdir(), "bob-caps-"));
  let caps = [];
  try { caps = JSON.parse(spawnSync(bob, ["albums", "list", "-f", "json"], { encoding: "utf8", env: { ...process.env, BOB_DIR: capsDir } }).stdout || "{}").capabilities || []; } catch (_) {}
  fs.rmSync(capsDir, { recursive: true, force: true });
  if (!caps.includes("record_walk_groups_v1")) return { status: "skipped", reason: "bob lacks record_walk_groups_v1: " + bob };
  process.env.BOB_GROUP_E2E_REAL = bob;

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "bob-group-jump-"));
  const vault = path.join(scratch, "vault");
  const profile = path.join(scratch, "profile");
  const shim = path.join(profile, "shim");
  fs.mkdirSync(vault, { recursive: true });
  fs.mkdirSync(shim, { recursive: true });
  fs.writeFileSync(path.join(shim, "bob"), shimSource(), { mode: 0o755 });
  const bobInfo = {
    path: bob, version: spawnSync(bob, ["--version"], { encoding: "utf8" }).stdout.trim(), capabilities: caps,
    sha256: crypto.createHash("sha256").update(fs.readFileSync(bob)).digest("hex"),
  };
  const cases = [];
  const evidence = { bob: bobInfo, templater: JSON.parse(fs.readFileSync(path.join(templater, "manifest.json"), "utf8")).version };
  let client;
  let child;
  const check = (name, value, detail) => {
    if (detail !== undefined) evidence[name] = detail;
    assert.ok(value, name + (detail === undefined ? "" : ": " + JSON.stringify(detail)));
    cases.push(name);
  };
  try {
    evidence.fixture = seedVault(vault, profile, bob, templater);
    harness.seedProfileVault(profile, fs.realpathSync(vault));
    const port = await harness.freePort();
    child = spawn(executable, ["--no-sandbox", `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
      "--remote-allow-origins=http://127.0.0.1/*", fs.realpathSync(vault)], {
      cwd: os.tmpdir(), env: bobEnv(vault, profile, shim), detached: process.platform !== "win32", stdio: ["ignore", "ignore", "pipe"],
    });
    evidence.obsidianStderr = [];
    child.stderr.on("data", (chunk) => { if (evidence.obsidianStderr.length < 20) evidence.obsidianStderr.push(String(chunk).slice(0, 600)); });
    client = await harness.connectToOwnedPage(port, fs.realpathSync(vault));
    await harness.dismissTrustModal(client);
    await client.call("Page.bringToFront");
    await client.call("Emulation.setFocusEmulationEnabled", { enabled: true });
    try { await client.call("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false }); } catch (_) {}
    evidence.apis = await harness.waitFor(client, `(() => {
      const p = app.plugins.plugins;
      return { walkMode: p[${JSON.stringify(NAV)}]?.api?.walkMode?.version, navGroups: p[${JSON.stringify(LEDGER)}]?.api?.navGroups?.version,
        periodNotes: p[${JSON.stringify(LEDGER)}]?.api?.periodNotes?.version, templater: Boolean(p[${JSON.stringify(TEMPLATER)}]?.templater) };
    })()`, (v) => v && v.walkMode >= 7 && v.navGroups >= 1 && v.periodNotes >= 2 && v.templater, "plugin apis");
    await client.evaluate(`(() => {
      window.__groupNotices = [];
      const seen = new WeakSet();
      const scan = () => { for (const node of document.querySelectorAll(".notice")) if (!seen.has(node)) { seen.add(node); window.__groupNotices.push(node.textContent); } };
      new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
      window.__groupCommands = [];
      const execute = app.commands.executeCommandById;
      app.commands.executeCommandById = function(id, ...rest) { window.__groupCommands.push(id); return execute.call(this, id, ...rest); };
      window.__groupErrors = [];
      window.addEventListener("error", (event) => window.__groupErrors.push(String(event.message)));
      window.addEventListener("unhandledrejection", (event) => window.__groupErrors.push(String(event.reason)));
      app.plugins.plugins[${JSON.stringify(NAV)}].api.walkMode.select("n");
    })()`);

    const frames = () => client.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    const open = async (note) => {
      await client.evaluate(`(async () => {
        const leaf = app.workspace.getMostRecentLeaf();
        await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(note)}));
        await leaf.setViewState({ type: "markdown", state: { file: ${JSON.stringify(note)}, mode: "source", source: false } });
        app.workspace.setActiveLeaf(leaf, { focus: true });
        leaf.view.editor.focus();
        leaf.view.editor.setCursor({ line: leaf.view.editor.lastLine(), ch: 0 });
      })()`);
      await harness.waitFor(client, ACTIVE_PATH, (value) => value === note, "open " + note);
      await frames();
    };
    const run = (id) => client.evaluate(`app.commands.executeCommandById(${JSON.stringify(id.includes(":") ? id : NAV + ":" + id)})`);
    const lands = async (from, id, to, name) => {
      await open(from);
      await run(id);
      const landed = await harness.waitFor(client, ACTIVE_PATH, (value) => value === to, name);
      check(name, landed === to);
    };
    const notices = () => client.evaluate("window.__groupNotices.length");
    const stays = async (from, id, pattern, name, options = {}) => {
      await open(from);
      const mark = await notices();
      const calls = invocations(profile).length;
      const before = treeHash(snapshot(vault));
      await run(id);
      const text = await harness.waitFor(client, `window.__groupNotices.slice(${mark}).join(" | ")`, (value) => pattern.test(value || ""), name + " notice");
      await harness.sleep(600);
      const after = { path: await client.evaluate(ACTIVE_PATH), hash: treeHash(snapshot(vault)), calls: invocations(profile).slice(calls) };
      // Ghost and no-route presses must not write or reach the period writer.
      const untouched = !options.hash || (after.hash === before && !after.calls.some(isEnsure));
      check(name, after.path === from && untouched, { text, before, after });
    };
    const ctrlO = async (expected, name) => {
      await client.evaluate(`(() => { const editor = app.workspace.activeLeaf.view.editor; editor.focus(); })()`);
      for (const event of proof.keyEvents("Escape")) await client.call("Input.dispatchKeyEvent", event);
      for (const event of proof.keyEvents("o", 2)) await client.call("Input.dispatchKeyEvent", event);
      const back = await harness.waitFor(client, ACTIVE_PATH, (value) => value === expected, name);
      check(name, back === expected);
    };
    const shot = async (name) => {
      if (!args.out) return;
      fs.mkdirSync(args.out, { recursive: true });
      const png = await client.call("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(path.join(args.out, name + ".png"), Buffer.from(png.data, "base64"));
    };
    // Note-surface controls resolve in the active pane; the footer and modal live in the document.
    const click = async (selector) => {
      const point = await client.evaluate(`(() => {
        const root = ${SURFACE};
        const scoped = /^\\.bob-(freshness|record-card-modal)/.test(${JSON.stringify(selector)}) ? document : root;
        const el = Array.from(scoped.querySelectorAll(${JSON.stringify(selector)})).find((node) => node.getClientRects().length);
        if (!el) return null;
        el.scrollIntoView({ block: "center" });
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })()`);
      assert.ok(point, "no visible " + selector);
      await client.call("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
      await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
    };

    // Weeks: [N / ]N land on the first week of the neighbouring quarter.
    await lands("2026/2026-W30.md", "open-prev-group-link", "2026/2026-W14.md", "W30 [N opens W14");
    await lands("2026/2026-W30.md", "open-next-group-link", "2026/2026-W40.md", "W30 ]N opens W40");
    // Rail, footer, and keys name the same stop; clicks run the group command and <C-o> returns.
    await open("2026/2026-W30.md");
    const rail = await harness.waitFor(client, armProbe("next"), (v) => v && v.href === "2026/2026-W40", "W30 card next group arm");
    const footer = await harness.waitFor(client, footerProbe("next"), (v) => v?.arm?.path === "2026/2026-W40.md", "W30 footer next group arm");
    check("W30 rail and footer name W40 like ]N", rail.state === "exists" && footer.arm.state === "exists", { rail, footer });
    await shot("w30-card-and-footer");
    let commandMark = (await client.evaluate("window.__groupCommands.length"));
    await click('.bob-property-card-group-arm[data-group="next"]');
    await harness.waitFor(client, ACTIVE_PATH, (value) => value === "2026/2026-W40.md", "rail click lands W40");
    check("W30 rail click runs open-next-group-link", (await client.evaluate(`window.__groupCommands.slice(${commandMark})`)).includes(NAV + ":open-next-group-link"));
    await ctrlO("2026/2026-W30.md", "<C-o> returns from the rail jump");
    await harness.waitFor(client, footerProbe("next"), (v) => v?.path === "2026/2026-W30.md" && v?.arm?.path === "2026/2026-W40.md", "footer repaint on W30");
    commandMark = await client.evaluate("window.__groupCommands.length");
    await click(".bob-freshness-link-group-next");
    await harness.waitFor(client, ACTIVE_PATH, (value) => value === "2026/2026-W40.md", "footer click lands W40");
    check("W30 footer click runs open-next-group-link", (await client.evaluate(`window.__groupCommands.slice(${commandMark})`)).includes(NAV + ":open-next-group-link"));
    await ctrlO("2026/2026-W30.md", "<C-o> returns from the footer jump");

    // Repeat keys follow existing stops but never create; an explicit ]N creates through bob.
    await lands("2026/2026-W47.md", "open-prev-group-link", "2026/2026-W27.md", "W47 [N opens W27");
    await run("repeat-next-uppercase-bracket-walk");
    check("]} after [N repeats to W40", (await harness.waitFor(client, ACTIVE_PATH, (v) => v === "2026/2026-W40.md", "]} W27 to W40")) === "2026/2026-W40.md");
    const creatable = await harness.waitFor(client, armProbe("next"), (v) => v && v.href === "2027/2027-W01", "W40 creatable arm");
    check("W40 next group arm is creatable 2027-W01", creatable.state === "creatable", creatable);
    await shot("w40-creatable-arm");
    const ensureMark = invocations(profile).length;
    const mark = await notices();
    await run("repeat-next-uppercase-bracket-walk");
    const refusal = await harness.waitFor(client, `window.__groupNotices.slice(${mark}).join(" | ")`, (v) => /isn't created yet — press \]N to create it/.test(v || ""), "]} refusal notice");
    await harness.sleep(600);
    check("]} never creates 2027-W01", !fs.existsSync(path.join(vault, "2027/2027-W01.md")) && (await client.evaluate(ACTIVE_PATH)) === "2026/2026-W40.md"
      && !invocations(profile).slice(ensureMark).some(isEnsure), { refusal });
    await run("open-next-group-link");
    await harness.waitFor(client, ACTIVE_PATH, (v) => v === "2027/2027-W01.md", "]N creates 2027-W01", 60_000);
    const created = invocations(profile).slice(ensureMark).filter(isEnsure);
    check("]N creates 2027-W01 through bob periods ensure", /id: 2027-W01/.test(fs.readFileSync(path.join(vault, "2027/2027-W01.md"), "utf8"))
      && created.some((c) => c.args.includes("2027-01-04")), created.map((c) => c.args));
    // Let create-triggered work settle before the byte-exact ghost checks.
    await harness.sleep(1500);

    // Pre-adoption ghosts write nothing; quarters jump a year; years have no group jump.
    const ghost = await (async () => { await open("2026/2026-W01.md"); return harness.waitFor(client, armProbe("prev"), (v) => v && !v.missing && v.state, "W01 ghost arm"); })();
    check("W01 previous group arm is a ghost", ghost.state === "ghost", ghost);
    await shot("w01-ghost-arm");
    await stays("2026/2026-W01.md", "open-prev-group-link", /before Bob|never creates|not in (the )?vault/i, "W01 [N ghost 2025-W40 writes nothing", { hash: true });
    await stays("2026/2026-Q4.md", "open-prev-group-link", /before Bob|never creates|not in (the )?vault/i, "Q4 [N ghost 2025-Q1 writes nothing", { hash: true });
    await lands("2026/2026-Q4.md", "open-next-group-link", "2027/2027-Q1.md", "Q4 ]N opens 2027-Q1");
    await stays("2026.md", "open-next-group-link", /Years have no group jump/, "year ]N shows the no-group notice", { hash: true });

    // Dailies: Saturday jumps by week; a missing Monday is created from the daily template.
    await lands("2026/20261121.md", "open-prev-group-link", "2026/20261109.md", "Saturday [N opens Monday of the previous week");
    await open("2026/20261121.md");
    const monday = await harness.waitFor(client, armProbe("next"), (v) => v && v.href === "2026/20261123", "Saturday next group arm");
    check("Saturday next group arm is creatable", monday.state === "creatable", monday);
    await shot("saturday-creatable-monday");
    await run("open-next-group-link");
    await harness.waitFor(client, ACTIVE_PATH, (v) => v === "2026/20261123.md", "]N creates next Monday", 60_000);
    const mondayText = fs.readFileSync(path.join(vault, "2026/20261123.md"), "utf8");
    check("]N creates Monday through the Templater daily template", /template: "\[\[daily\]\]"/.test(mondayText) && /date: 2026-11-23/.test(mondayText)
      && /\[\[2026\/20261122\|prev\]\]/.test(mondayText), mondayText.slice(0, 400));
    // A legacy daily without a nav line steps and leaps through derived stops.
    await lands("2026/20261110.md", "open-prev-link", "2026/20261109.md", "legacy daily derived [n");
    await lands("2026/20261110.md", "open-next-link", "2026/20261111.md", "legacy daily derived ]n");
    await lands("2026/20261110.md", "open-next-group-link", "2026/20261116.md", "legacy daily ]N opens next Monday");

    // Authored « / » and << / >> on link-only nav lines; doubles never step; prose never counts.
    await lands("story/part_3.md", "open-next-group-link", "story/part_4.md", ">> on a nav line leaps; prose » is ignored");
    await lands("story/part_3.md", "open-prev-group-link", "story/part_2.md", "<< on a nav line leaps back");
    await lands("story/part_3.md", "open-prev-link", "story/prelude.md", "<< does not hijack [n");
    await lands("story/part_2.md", "open-next-group-link", "story/part_3.md", "» canonical label leaps");
    await lands("story/part_4.md", "open-next-group-link", "story/part_5.md", "Markdown » link leaps");
    await stays("story/clip.md", "open-next-group-link", /No » link on a nav line here/, "prose Read more » is not a group link");
    await open("story/only_group.md");
    await run("open-prev-link");
    await harness.sleep(800);
    check("a lone << link never steps", (await client.evaluate(ACTIVE_PATH)) === "story/only_group.md");
    await lands("story/only_group.md", "open-prev-group-link", "story/part_2.md", "a lone << link leaps");

    // Grouped album: ]n crosses sections, ]N lands on heads, and the ring wraps.
    await open("blog/delta.md");
    const wrap = await harness.waitFor(client, armProbe("next"), (v) => v && v.href === "blog/yankee", "grouped record rail", 60_000);
    check("grouped record next group arm wraps to the intro head", wrap.wrap === true && wrap.state === "exists", wrap);
    await shot("grouped-record-wrap");
    await lands("blog/mike.md", "open-next-link", "blog/oscar.md", "]n walks within a section");
    await lands("blog/oscar.md", "open-next-link", "blog/bravo.md", "]n crosses into the next section");
    await lands("blog/alpha.md", "open-next-group-link", "blog/bravo.md", "]N lands on the next section head");
    await lands("blog/alpha.md", "open-prev-group-link", "blog/yankee.md", "[N lands on the previous section head");
    await lands("blog/delta.md", "open-next-group-link", "blog/yankee.md", "]N wraps from the last section");

    // A Record Card section edit rewrites at most five walk lines in one guarded write.
    await open("blog/mike.md");
    await harness.waitFor(client, `Boolean(${SURFACE}?.querySelector("[data-record-sheet-focus='edit']"))`, Boolean, "record sheet edit control", 60_000);
    const before = snapshot(vault);
    const callMark = invocations(profile).length;
    await click("[data-record-sheet-focus='edit']");
    const CARD = `(() => { const m = app.plugins.plugins[${JSON.stringify(LEDGER)}].recordCardModal; return m && !m.closed ? { ready: Boolean(m.session), busy: m.pendingApply, field: m.selectedKey, stage: m.stage?.kind || null, status: m.statusKind, focusField: document.activeElement?.getAttribute("data-target-key"), activePath: ${ACTIVE_PATH} } : null; })()`;
    const card = (predicate, label) => harness.waitFor(client, CARD, predicate, label, 30_000);
    await card((v) => v?.ready && !v.busy, "Record Card ready");
    await proof.selectCardField({ click, card: (predicate, label) => card(predicate || ((v) => v?.ready && !v.busy), label || "Record Card"), field: "section" });
    for (const event of proof.keyEvents("3")) await client.call("Input.dispatchKeyEvent", event);
    await card((v) => v?.status === "saved" && !v.busy, "section saved");
    await harness.waitFor(client, `app.metadataCache.getCache("blog/mike.md")?.frontmatter?.section`, (v) => v === "close", "Mike moved to close");
    await harness.sleep(1500);
    const after = snapshot(vault);
    const changed = changedPaths(before, after);
    const walkChanged = RECORDS.map(([stem]) => `blog/${stem}.md`).filter((name) => walkLine(before[name]) !== walkLine(after[name]));
    const calls = invocations(profile).slice(callMark);
    const writers = calls.filter((c) => c.event === "start" && c.args[0] === "records" && c.args[1] === "update");
    const onlyWalkLines = walkChanged.filter((name) => name !== "blog/mike.md")
      .every((name) => before[name].replace(walkLine(before[name]), "") === after[name].replace(walkLine(after[name]), ""));
    check("Record Card section edit rewrites at most five walk lines", walkChanged.length <= 5 && walkChanged.length >= 3 && onlyWalkLines
      && changed.every((name) => walkChanged.includes(name) || name === "blog.md") && writers.length === 1
      && JSON.stringify(JSON.parse(writers[0].input).ops) === JSON.stringify([{ op: "field.set", field: "section", value: "close" }])
      && !calls.some((c) => c.event === "start" && c.args[0] === "albums" && c.args[1] === "sync"),
    { walkChanged, changed, writerArgs: writers.map((c) => c.args) });
    for (let i = 0; i < 4 && await client.evaluate(CARD); i += 1) {
      for (const event of proof.keyEvents("Escape")) await client.call("Input.dispatchKeyEvent", event);
      await harness.sleep(100);
    }
    await lands("blog/delta.md", "open-next-link", "blog/mike.md", "]n follows the rewritten walk");

    const errors = await client.evaluate("window.__groupErrors");
    check("no renderer errors", errors.length === 0, errors);
    evidence.blocked = invocations(profile).filter((c) => c.event === "blocked").map((c) => c.args.slice(0, 3).join(" "));
    return { status: "passed", cases, evidence, executable };
  } catch (error) {
    if (client) {
      try {
        evidence.state = await client.evaluate(`({ path: ${ACTIVE_PATH}, notices: window.__groupNotices, commands: window.__groupCommands, errors: window.__groupErrors })`);
        if (args.out) {
          fs.mkdirSync(args.out, { recursive: true });
          const png = await client.call("Page.captureScreenshot", { format: "png" });
          fs.writeFileSync(path.join(args.out, "failure.png"), Buffer.from(png.data, "base64"));
        }
      } catch (_) {}
    }
    try { evidence.invocations = invocations(profile).map((c) => ({ event: c.event, args: c.args, exitCode: c.exitCode })); } catch (_) {}
    return { status: "failed", cases, evidence, error: String(error.stack || error) };
  } finally {
    client?.close();
    if (child) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      try { process.platform === "win32" ? child.kill("SIGTERM") : process.kill(-child.pid, "SIGTERM"); } catch (_) {}
      if (child.exitCode === null && child.signalCode === null) await Promise.race([exited, harness.sleep(2000)]);
    }
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(vault + ".origin.git", { recursive: true, force: true });
  }
}

function selfTest() {
  const notes = fixtureNotes();
  assert.match(notes["story/part_3.md"], /\[\[story\/part_2\|<< Part 2\]\] · \[\[story\/part_4\|Part 4 >>\]\]/);
  assert.match(notes["story/clip.md"], /^Read more \[\[story\/appendix\|Read more »\]\]$/m);
  assert.doesNotMatch(notes["2026/20261110.md"].split("---")[2], /\[\[/, "the legacy daily carries no nav line");
  assert.match(notes["blog.md"], /^walk_by: section$/m);
  assert.equal(RECORDS.length, 8);
  assert.deepEqual(changedPaths({ a: "1", b: "2" }, { a: "1", b: "3", c: "4" }), ["b", "c"]);
  assert.equal(walkLine("x\n[[blog/a|‹ A]] · [[blog|↑ Blog]] · [[blog/b|B ›]]\n"), "[[blog/a|‹ A]] · [[blog|↑ Blog]] · [[blog/b|B ›]]");
  const shim = shimSource();
  assert.match(shim, /blocked by the group-jump e2e shim/);
  for (const verb of ALLOWED) assert.ok(shim.includes(JSON.stringify(verb)), verb);
  assert.deepEqual(parseArgs(["-e", "/x", "-o", "/o", "-r", "/r"]), { executable: "/x", out: "/o", report: "/r", selfTest: false, help: false });
  console.log("offline group-jump self-test complete; no Obsidian launched");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return console.log("Usage: node scripts/obsidian-group-jump-e2e.cjs [-e PATH] [-r REPORT] [-o SCREENSHOTS] [--self-test]");
  if (args.selfTest) return selfTest();
  const result = await runE2e(args);
  if (args.report) fs.writeFileSync(args.report, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "failed") process.exitCode = 1;
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { fixtureNotes, shimSource, changedPaths, walkLine };
