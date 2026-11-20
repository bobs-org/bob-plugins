"use strict";
// Fixture for the real-Obsidian command-chips e2e: a scratch home, vault,
// profile, and XDG tree under one run root, a stub `bob` that serves a
// fixture catalog and records every invocation, and the notes the e2e
// drives. Nothing here touches the live vault or the real bob binary.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const OWN_PLUGINS = Object.freeze(["bob-command-mode", "bob-chips"]);
const QUERY_PLUGINS = Object.freeze(["obsidian-tasks-plugin", "dataview"]);
const NOWHERE_HOST = "e2e-nowhere-host";
const GATE_TIMEOUT_MS = 90_000;

function entry(id, words, fields = {}) {
  return {
    id,
    path: ["e2e", ...words],
    fixed: [],
    title: "E2E " + words.join(" "),
    about: "Command chips e2e fixture",
    section: "e2e",
    keywords: ["e2e", ...words],
    effect: "reads",
    network: false,
    presentation: "action",
    policy: "run",
    preview: [],
    confirm: null,
    budget_secs: 120,
    args: [{ name: "TAG", slot: "text", required: false, repeat: false }],
    exit_codes: [],
    adapter: null,
    hosts: [],
    invalidates: [],
    ...fields,
  };
}

// The only commands the stub answers. Payload tags name each case so the
// invocation log proves which chip ran, and how often.
const CATALOG = Object.freeze({
  schema_version: 1,
  ok: true,
  protocol: 1,
  bob_version: "0.0.0-e2e-stub",
  features: [],
  sections: [{ id: "e2e", title: "E2E" }],
  roots: ["e2e"],
  aliases: [],
  excluded: [],
  entries: [
    entry("e2e-ok", ["ok"]),
    entry("e2e-slow", ["slow"]),
    entry("e2e-attention", ["attention"], { exit_codes: [{ code: 3, outcome: "attention", meaning: "E2E needs a decision" }] }),
    entry("e2e-fail", ["fail"]),
    entry("e2e-rewrite", ["rewrite"], { effect: "writes" }),
    entry("e2e-confirm", ["confirm"], { effect: "writes", policy: "confirm", confirm: "Run the e2e confirm fixture?" }),
    entry("e2e-report", ["report"], { presentation: "report" }),
    entry("e2e-elsewhere", ["elsewhere"], { hosts: [NOWHERE_HOST] }),
  ],
});

const NOTES = Object.freeze({
  main: "Command chips e2e.md",
  rewrite: "Rewrite e2e.md",
  embed: "notes/Allowed embed.md",
  tasks: "notes/Allowed tasks.md",
  ref: "ref/Ref chips.md",
  dashboard: "Dashboard e2e.md",
  fence: "Fence e2e.md",
  author: "Author e2e.md",
});

// The make-or-edit phase: a plain `bob …` span to convert with Enter, and a
// command chip to Alt+Click and relabel. Neither may run while authoring.
const AUTHOR = Object.freeze({
  convert: "bob e2e ok author-convert",
  edit: "bob e2e ok author-edit",
});

// Exact payload per case tag, as authored in the notes below.
const PAYLOADS = Object.freeze({
  click: "bob e2e ok click",
  double: "bob e2e slow double",
  twin: "bob e2e slow twin",
  task: "bob e2e ok task",
  seqAttention: "bob e2e ok seq-a1 && bob e2e attention seq-a2 && bob e2e ok seq-a3",
  seqFail: "bob e2e ok seq-f1 && bob e2e fail seq-f2 && bob e2e ok seq-f3",
  shift: "bob e2e ok shift",
  confirm: "bob e2e confirm",
  report: "bob e2e report",
  elsewhere: "bob e2e elsewhere",
  stale: "bob e2e ok stale",
  rewrite: "bob e2e rewrite",
  embed: "bob e2e ok embed-allowed",
  queryAllowed: "bob e2e ok query-allowed",
  refDirect: "bob e2e ok ref-direct",
  refTask: "bob e2e ok ref-task",
  dvField: "bob e2e ok dv-field",
});

// `bob-run` cards, by the title each card shows. Bodies are authored one
// step per line; `gated` holds step 2 until its gate opens.
const FENCES = Object.freeze({
  gated: Object.freeze({ title: "Gated fence", info: "bob-run Gated fence", steps: Object.freeze(["bob e2e ok fseq-1", "bob e2e slow fseq-2", "bob e2e ok fseq-3"]) }),
  fail: Object.freeze({ title: "Run · 3 steps", info: "bob-run", steps: Object.freeze(["bob e2e ok ffail-1", "bob e2e fail ffail-2", "bob e2e ok ffail-3"]) }),
  ref: Object.freeze({ title: "Ref fence", info: "bob-run Ref fence", steps: Object.freeze(["bob e2e ok ref-fence"]) }),
});

function fenceLines(fence) {
  return ["```" + fence.info, ...fence.steps, "```"];
}

function noteText() {
  const p = PAYLOADS;
  return {
    [NOTES.main]: [
      "# Command chips e2e",
      "",
      "CLICK `run: " + p.click + "`",
      "",
      "DOUBLE `run: " + p.double + "`",
      "",
      "TWIN_A `run: " + p.twin + "`",
      "",
      "TWIN_B `run: " + p.twin + "`",
      "",
      "- [ ] TASK_LINE `run: " + p.task + "` stays unchecked",
      "",
      "SEQ_ATTN `run[Attention sequence]: " + p.seqAttention + "`",
      "",
      "SEQ_FAIL `run: " + p.seqFail + "`",
      "",
      "SHIFT `run: " + p.shift + "`",
      "",
      "CONFIRM `run: " + p.confirm + "`",
      "",
      "REPORT `run: " + p.report + "`",
      "",
      "ELSEWHERE `run: " + p.elsewhere + "`",
      "",
      "STALE `run: " + p.stale + "`",
      "",
      "COPY_SPAN `copy: ssh e2e-host` beside a card:",
      "",
      "```bob-copy Card",
      "card body",
      "```",
      "",
      "Plain `bob e2e ok plain` stays code.",
      "",
    ].join("\n"),
    [NOTES.rewrite]: ["# Rewrite e2e", "", "REWRITE `run: " + p.rewrite + "`", ""].join("\n"),
    [NOTES.embed]: ["---", "parent: \"[[Dashboard e2e]]\"", "---", "EMBED_OK `run: " + p.embed + "`", ""].join("\n"),
    [NOTES.tasks]: [
      "---",
      "parent: \"[[Dashboard e2e]]\"",
      "---",
      "cmd:: `run: " + p.dvField + "`",
      "",
      "- [ ] Allowed task `run: " + p.queryAllowed + "` #e2e",
      "",
    ].join("\n"),
    [NOTES.ref]: [
      "REF_CHIP `run: " + p.refDirect + "`",
      "",
      "- [ ] Ref task `run: " + p.refTask + "` #e2e",
      "",
      ...fenceLines(FENCES.ref),
      "",
    ].join("\n"),
    [NOTES.fence]: [
      "# Fence e2e",
      "",
      "GATED_FENCE",
      "",
      ...fenceLines(FENCES.gated),
      "",
      "FAIL_FENCE",
      "",
      ...fenceLines(FENCES.fail),
      "",
    ].join("\n"),
    [NOTES.author]: [
      "# Author e2e",
      "",
      "AUTHOR_SPAN Run `" + AUTHOR.convert + "` daily",
      "",
      "AUTHOR_EDIT `run: " + AUTHOR.edit + "`",
      "",
    ].join("\n"),
    [NOTES.dashboard]: [
      "# Dashboard e2e",
      "",
      "Hover [[ref/Ref chips]] and [[notes/Allowed embed]].",
      "",
      "![[ref/Ref chips]]",
      "",
      "![[notes/Allowed embed]]",
      "",
      "```tasks",
      "tag includes #e2e",
      "```",
      "",
      "```dataview",
      "TASK FROM #e2e",
      "```",
      "",
      "```dataview",
      "TABLE WITHOUT ID cmd FROM \"notes\" WHERE cmd",
      "```",
      "",
    ].join("\n"),
  };
}

// The stub `bob`. Constants are baked in at fixture time, so it never reads
// paths from its environment. It writes only its log and, for `e2e
// rewrite`, the one scratch note it owns.
function stubSource(paths) {
  const consts = {
    LOG: paths.logFile,
    GATES: paths.gatesDir,
    VAULT: paths.vaultRealPath,
    REWRITE: path.join(paths.vaultRealPath, NOTES.rewrite),
    CATALOG,
    GATE_TIMEOUT_MS,
  };
  return [
    "#!" + process.execPath,
    "\"use strict\";",
    "// Generated by obsidian-command-chips-e2e-lib.cjs. Stub bob for one scratch run.",
    "const fs = require(\"node:fs\");",
    "const path = require(\"node:path\");",
    "const C = " + JSON.stringify(consts) + ";",
    "const argv = process.argv.slice(2);",
    "const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));",
    "function log(kind) {",
    "  fs.appendFileSync(C.LOG, JSON.stringify({ kind, argv, cwd: process.cwd(), bobDir: process.env.BOB_DIR || null, pid: process.pid, at: Date.now() }) + \"\\n\");",
    "}",
    "async function gate(tag) {",
    "  const file = path.join(C.GATES, tag);",
    "  const deadline = Date.now() + C.GATE_TIMEOUT_MS;",
    "  while (!fs.existsSync(file)) {",
    "    if (Date.now() > deadline) return false;",
    "    await sleep(50);",
    "  }",
    "  return true;",
    "}",
    "function rewriteScratchNote(tag) {",
    "  const target = fs.realpathSync(C.REWRITE);",
    "  if (path.dirname(target) !== C.VAULT) throw new Error(\"refusing to write outside the scratch vault: \" + target);",
    "  const lines = fs.readFileSync(target, \"utf8\").split(\"\\n\");",
    "  lines.splice(1, 0, \"\", \"Rewritten by the stub during \" + tag + \".\");",
    "  fs.writeFileSync(target, lines.join(\"\\n\"));",
    "}",
    "async function main() {",
    "  if (argv[0] === \"__catalog\") { log(\"catalog\"); process.stdout.write(JSON.stringify(C.CATALOG)); return 0; }",
    "  if (argv[0] === \"__complete\") { log(\"complete\"); return 0; }",
    "  if (argv[0] !== \"e2e\") { log(\"refused\"); process.stderr.write(\"error: the e2e stub only answers e2e commands\\n\"); return 64; }",
    "  log(\"run\");",
    "  const verb = argv[1];",
    "  const tag = argv[2] || verb;",
    "  if (verb === \"ok\" || verb === \"confirm\") { process.stdout.write(\"ok \" + tag + \"\\n\"); return 0; }",
    "  if (verb === \"report\") { process.stdout.write(\"E2E report\\nline one\\nline two\\n\"); return 0; }",
    "  if (verb === \"attention\") { process.stdout.write(\"needs a decision: \" + tag + \"\\n\"); return 3; }",
    "  if (verb === \"fail\") { process.stderr.write(\"error: e2e failure at \" + tag + \"\\n\"); return 1; }",
    "  if (verb === \"slow\") { const ok = await gate(tag); process.stdout.write(ok ? \"released \" + tag + \"\\n\" : \"gate timed out\\n\"); return ok ? 0 : 1; }",
    "  if (verb === \"rewrite\") { rewriteScratchNote(tag); const ok = await gate(tag); return ok ? 0 : 1; }",
    "  process.stderr.write(\"error: unexpected e2e verb \" + verb + \"\\n\");",
    "  return 64;",
    "}",
    "main().then((code) => process.exit(code), (error) => { process.stderr.write(\"error: \" + error.message + \"\\n\"); process.exit(70); });",
    "",
  ].join("\n");
}

function copyPlugin(sourceDir, targetDir, optional) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const name of ["manifest.json", "main.js", "styles.css"]) {
    const source = path.join(sourceDir, name);
    if (!fs.existsSync(source)) {
      if (optional || name === "styles.css") continue;
      throw new Error("missing plugin file " + source);
    }
    fs.copyFileSync(source, path.join(targetDir, name));
  }
}

function realHomeVault() {
  const home = process.env.HOME || "";
  return home ? path.join(home, "bob") : null;
}

// Refuse any vault that is not a fresh directory under this run's root.
function assertScratchVault(vaultRealPath, runRoot) {
  const root = fs.realpathSync(runRoot);
  const rel = path.relative(root, vaultRealPath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("vault is outside the scratch run root: " + vaultRealPath);
  const live = realHomeVault();
  if (live && fs.existsSync(live)) {
    const liveReal = fs.realpathSync(live);
    const relLive = path.relative(liveReal, vaultRealPath);
    if (relLive === "" || (!relLive.startsWith("..") && !path.isAbsolute(relLive))) throw new Error("refusing to use the live vault: " + vaultRealPath);
  }
}

// Build the whole scratch tree. `queryPluginsDir` (optional) is an
// installed `.obsidian/plugins` directory to copy Tasks and Dataview from;
// only their manifest, main.js, and styles.css are copied (no data.json).
function makeFixture(runRoot, options = {}) {
  const root = fs.realpathSync(runRoot);
  const homeDir = path.join(root, "home");
  const vaultDir = path.join(homeDir, "vault");
  const profileDir = path.join(root, "profile");
  const xdg = {
    XDG_CONFIG_HOME: path.join(root, "xdg", "config"),
    XDG_STATE_HOME: path.join(root, "xdg", "state"),
    XDG_CACHE_HOME: path.join(root, "xdg", "cache"),
    XDG_DATA_HOME: path.join(root, "xdg", "data"),
  };
  const binDir = path.join(root, "bin");
  const gatesDir = path.join(root, "gates");
  const logFile = path.join(root, "stub-bob.jsonl");
  for (const dir of [vaultDir, profileDir, binDir, gatesDir, ...Object.values(xdg)]) fs.mkdirSync(dir, { recursive: true });
  const vaultRealPath = fs.realpathSync(vaultDir);
  assertScratchVault(vaultRealPath, root);
  fs.writeFileSync(logFile, "");
  for (const [rel, text] of Object.entries(noteText())) {
    const file = path.join(vaultRealPath, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  const stubPath = path.join(root, "bob-stub");
  fs.writeFileSync(stubPath, stubSource({ logFile, gatesDir, vaultRealPath }), { mode: 0o755 });
  fs.chmodSync(stubPath, 0o755);
  // Anything that looks `bob` up on PATH finds the stub first.
  fs.symlinkSync(stubPath, path.join(binDir, "bob"));
  const obsidianDir = path.join(vaultRealPath, ".obsidian");
  const pluginsDir = path.join(obsidianDir, "plugins");
  for (const id of OWN_PLUGINS) copyPlugin(path.join(repoRoot, "plugins", id), path.join(pluginsDir, id), false);
  const queryPlugins = [];
  if (options.queryPluginsDir) {
    for (const id of QUERY_PLUGINS) {
      const source = path.join(options.queryPluginsDir, id);
      if (!fs.existsSync(path.join(source, "main.js"))) continue;
      copyPlugin(source, path.join(pluginsDir, id), true);
      const manifest = JSON.parse(fs.readFileSync(path.join(source, "manifest.json"), "utf8"));
      queryPlugins.push({ id, version: manifest.version });
    }
  }
  fs.writeFileSync(path.join(pluginsDir, "bob-command-mode", "data.json"), JSON.stringify({
    settings: { bobPath: stubPath, osNotifications: false },
  }, null, 2));
  fs.writeFileSync(path.join(obsidianDir, "community-plugins.json"), JSON.stringify([...OWN_PLUGINS, ...queryPlugins.map((item) => item.id)], null, 2));
  fs.writeFileSync(path.join(obsidianDir, "core-plugins.json"), JSON.stringify(["file-explorer", "page-preview", "command-palette"], null, 2));
  fs.writeFileSync(path.join(obsidianDir, "app.json"), JSON.stringify({ livePreview: true, promptDelete: false }, null, 2));
  fs.writeFileSync(path.join(obsidianDir, "appearance.json"), JSON.stringify({ cssTheme: "", theme: "moonstone" }, null, 2));
  const id = crypto.randomBytes(8).toString("hex");
  fs.writeFileSync(path.join(profileDir, "obsidian.json"), JSON.stringify({ vaults: { [id]: { path: vaultRealPath, ts: Date.now(), open: true } } }, null, 2));
  return { root, homeDir, vaultRealPath, profileDir, xdg, binDir, gatesDir, logFile, stubPath, queryPlugins };
}

// The environment the owned Obsidian (and so every child it spawns) gets.
function obsidianEnv(scratch, base = process.env) {
  const env = { ...base, HOME: scratch.homeDir, ...scratch.xdg, BOB_DIR: scratch.vaultRealPath, TMPDIR: "/tmp" };
  env.PATH = [scratch.binDir, ...String(base.PATH || "/usr/bin:/bin").split(":").filter(Boolean)].join(":");
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.BOB_CONFIG;
  return env;
}

function readLog(scratch) {
  if (!fs.existsSync(scratch.logFile)) return [];
  return fs.readFileSync(scratch.logFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

// Invocations other than Command Mode's catalog/completion handshake.
function runInvocations(scratch) {
  return readLog(scratch).filter((item) => item.kind !== "catalog" && item.kind !== "complete");
}

function countRuns(scratch, payload) {
  const words = payload.replace(/^bob\s+/, "").split(/\s+/);
  return runInvocations(scratch).filter((item) => JSON.stringify(item.argv) === JSON.stringify(words)).length;
}

function openGate(scratch, tag) {
  fs.writeFileSync(path.join(scratch.gatesDir, tag), "open\n");
}

function treeSnapshot(dir) {
  const out = {};
  const walk = (current) => {
    for (const name of fs.readdirSync(current)) {
      const file = path.join(current, name);
      const stat = fs.lstatSync(file);
      if (stat.isDirectory()) walk(file);
      else out[path.relative(dir, file)] = stat.isSymbolicLink()
        ? "link:" + fs.readlinkSync(file)
        : crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    }
  };
  walk(dir);
  return out;
}

function within(root, file) {
  const rel = path.relative(root, file);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

// Offline proof that every path the e2e can touch is inside the run root
// and that `bob` cannot fall back to a real binary.
function isolationReport(scratch, commandModeHelpers) {
  const failures = [];
  const env = obsidianEnv(scratch);
  for (const key of ["HOME", "XDG_CONFIG_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "BOB_DIR"]) {
    if (!within(scratch.root, env[key])) failures.push(key + " escapes the run root: " + env[key]);
  }
  const which = spawnSync("sh", ["-c", "command -v bob"], { env, encoding: "utf8" });
  const found = String(which.stdout || "").trim();
  if (!found || fs.realpathSync(found) !== fs.realpathSync(scratch.stubPath)) failures.push("PATH bob is not the stub: " + found);
  const data = JSON.parse(fs.readFileSync(path.join(scratch.vaultRealPath, ".obsidian", "plugins", "bob-command-mode", "data.json"), "utf8"));
  if (data.settings.bobPath !== scratch.stubPath) failures.push("Command Mode bobPath is not the stub");
  if (commandModeHelpers) {
    const resolved = commandModeHelpers.cmResolveBobPath(data.settings.bobPath, { home: env.HOME });
    if (resolved.path !== scratch.stubPath || resolved.source !== "config") failures.push("Command Mode resolves bob to " + JSON.stringify(resolved));
    for (const candidate of commandModeHelpers.cmBobCandidatePaths(env.HOME)) {
      if (within(env.HOME, candidate) && fs.existsSync(candidate)) failures.push("a bob candidate exists in the scratch home: " + candidate);
    }
    const runsDir = commandModeHelpers.cmRunsDir(env, {});
    if (!within(scratch.root, runsDir)) failures.push("Command Mode run records escape the run root: " + runsDir);
  }
  for (const name of fs.readdirSync(path.join(scratch.vaultRealPath, ".obsidian", "plugins"))) {
    if (![...OWN_PLUGINS, ...QUERY_PLUGINS].includes(name)) failures.push("unexpected plugin in the scratch vault: " + name);
  }
  return { env: { HOME: env.HOME, XDG_STATE_HOME: env.XDG_STATE_HOME, PATH0: env.PATH.split(":")[0] }, stub: scratch.stubPath, failures };
}

module.exports = {
  CATALOG,
  NOTES,
  PAYLOADS,
  FENCES,
  AUTHOR,
  NOWHERE_HOST,
  OWN_PLUGINS,
  QUERY_PLUGINS,
  noteText,
  stubSource,
  makeFixture,
  obsidianEnv,
  assertScratchVault,
  readLog,
  runInvocations,
  countRuns,
  openGate,
  treeSnapshot,
  within,
  isolationReport,
};
