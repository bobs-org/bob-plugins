#!/usr/bin/env node
// Real Obsidian acceptance for the Projects catalog card. Uses an isolated
// scratch vault/profile and a real bob-cli binary; it never opens ~/bob.
//
//   BOB_BIN=/path/to/current/target/debug/bob BOB_CLI_DIR=/path/to/bob-cli \
//     xvfb-run -a node scripts/obsidian-projects-ui-e2e.cjs \
//       -e /snap/obsidian/current/app/obsidian -r /tmp/projects-ui.json \
//       -o /tmp/projects-ui-shots
"use strict";

const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const OVERALL_TIMEOUT_MS = 600_000;
const TODAY = "2026-11-13";
const ELECTRON_FALLBACK = "/snap/obsidian/current/app/obsidian";
const HELP_TEXT = [
  "Usage: node scripts/obsidian-projects-ui-e2e.cjs [OPTIONS]",
  "",
  "Run Projects catalog acceptance in a scratch vault with real Obsidian and bob.",
  "Never opens the live vault. Run under xvfb-run -a on Linux.",
  "",
  "Options:",
  "  -e, --executable PATH   Obsidian Electron binary",
  "  -o, --out DIRECTORY     Save inspected PNG screenshots here",
  "  -r, --report PATH       Write the structured JSON report here",
  "  -s, --self-test         Validate fixtures and probes without launching apps",
  "  -h, --help              Print this help",
].join("\n");

function parseArgs(argv) {
  const args = { executable: null, out: null, report: null, selfTest: false, help: false };
  const list = Array.isArray(argv) ? argv.slice() : [];
  for (let i = 0; i < list.length; i += 1) {
    const token = list[i];
    if (token === "-e" || token === "--executable") {
      const value = list[++i];
      if (!value || value.startsWith("-")) throw new Error("--executable requires a PATH value");
      args.executable = value;
    } else if (token === "-o" || token === "--out") {
      const value = list[++i];
      if (!value || value.startsWith("-")) throw new Error("--out requires a DIRECTORY value");
      args.out = value;
    } else if (token === "-r" || token === "--report") {
      const value = list[++i];
      if (!value || value.startsWith("-")) throw new Error("--report requires a PATH value");
      args.report = value;
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

function fail(message, code = 1) {
  const error = new Error(message);
  error.exitCode = code;
  throw error;
}

function projectNote(parent, options = {}) {
  const lines = ["---", 'type: "[[project]]"', `parent: "[[${parent}]]"`, `status: ${options.status || "wip"}`, "---", "", `# ${options.title || options.stem || "Project"}`, ""];
  if (options.state === "warning") return lines.concat("- [ ] #task #prj Missing lifecycle task #hide ^other\n").join("\n");
  let task = "- [ ] #task #prj ";
  if (options.state === "blocked") task = "- [?] #task #prj ";
  if (options.state === "inherited") task = "- [?] #task #prj #prj_is_blocked ";
  if (options.state === "done") task = "- [x] #task #prj ";
  if (options.state === "canceled") task = "- [-] #task #prj ";
  const criterion = options.criterion || `Complete ${options.stem || "project"}.`;
  const suffix = options.state === "done"
    ? options.closedOn === null ? "" : ` [completion:: ${options.closedOn || "2026-11-12"}]`
    : options.state === "canceled"
      ? options.closedOn === null ? "" : ` [cancelled:: ${options.closedOn || "2026-11-11"}]`
      : options.state === "scheduled"
        ? ` [scheduled:: ${options.scheduled || "2026-12-08"}]`
        : options.dependsOn
          ? ` [dependsOn:: ${options.dependsOn}]`
          : "";
  const hide = options.visible ? "" : " #hide";
  const id = options.id ? ` [id:: ${options.id}]` : "";
  lines.push(`${task}${criterion}${suffix}${id}${hide} ^prj`);
  if (options.extraTasks) {
    for (let i = 0; i < options.extraTasks; i += 1) lines.push(`- [ ] #task Additional task ${i + 1} ^task-${i + 1}`);
  }
  return lines.join("\n") + "\n";
}

function areaNote() {
  return ["---", 'type: "[[area]]"', 'parent: "[[index]]"', "color: blue", "---", "", "# Projects acceptance area", "", "## Projects", "", "Area host for the projects card acceptance fixture.", ""].join("\n");
}

function hostNote() {
  return ["---", 'type: "[[project]]"', 'parent: "[[area]]"', "status: wip", "color: orange", "---", "", "# Project host", "", "- [ ] #task #prj Host outcome #hide ^prj", "", "## Projects", "", "Project host for nested children.", ""].join("\n");
}

function fixtureNotes() {
  const notes = {
    "area.md": areaNote(),
    "project-host.md": hostNote(),
    "ready-dependency.md": projectNote("area", { stem: "ready-dependency", title: "Dependency target", id: "ready-dependency", visible: true }),
    "scheduled.md": projectNote("area", { stem: "scheduled", state: "scheduled", scheduled: "2026-12-08" }),
    "blocked-dependency.md": projectNote("area", { stem: "blocked-dependency", state: "blocked", dependsOn: "ready-dependency" }),
    "blocked-parent.md": projectNote("project-host", { stem: "blocked-parent", state: "inherited" }),
    "warning.md": ["---", 'type: "[[project]]"', 'parent: "[[area]]"', "status: wip", "---", "", "# Warning", "", "- [ ] #task No lifecycle marker ^task", ""].join("\n"),
    "done-dated.md": projectNote("area", { stem: "done-dated", state: "done", status: "done", closedOn: "2026-11-12" }),
    "done-undated.md": projectNote("area", { stem: "done-undated", state: "done", status: "done", closedOn: null }),
    "canceled.md": projectNote("area", { stem: "canceled", state: "canceled", status: "canceled", closedOn: "2026-11-10" }),
    "all-closed.md": hostNote().replace('parent: "[[area]]"', 'parent: "[[area]]"').replace("Project host", "All closed host").replace("Host outcome", "All closed outcome"),
    "empty-host.md": hostNote().replace("Project host", "Empty host").replace("Host outcome", "Empty outcome"),
    "one/duplicate.md": projectNote("area", { stem: "duplicate", title: "Duplicate stem A" }),
    "two/duplicate.md": projectNote("area", { stem: "duplicate", title: "Duplicate stem B" }),
  };
  for (let i = 1; i <= 54; i += 1) {
    const stem = `project-${String(i).padStart(2, "0")}`;
    const criterion = i % 4 === 0
      ? `Ship a very long acceptance criterion for ${stem} that should clamp on one line and remain readable when focused at narrow widths.`
      : `Finish ${stem}.`;
    const state = i <= 6 ? "done" : i <= 8 ? "canceled" : i === 9 ? "scheduled" : i === 10 ? "blocked" : "open";
    const parent = i === 1 ? "area" : "area";
    const note = projectNote(parent, {
      stem,
      title: `Project ${i}`,
      criterion,
      state,
      status: state === "done" ? "done" : state === "canceled" ? "canceled" : "wip",
      closedOn: i === 6 ? null : i <= 6 ? `2026-11-${String(13 - i).padStart(2, "0")}` : undefined,
      scheduled: "2026-12-08",
      dependsOn: "ready-dependency",
      extraTasks: i === 2 ? 3 : 0,
      visible: i === 1,
    });
    notes[`${stem}.md`] = note;
  }
  notes["nested-child.md"] = projectNote("project-host", { stem: "nested-child", title: "Nested child", criterion: "A nested project." });
  notes["all-closed-a.md"] = projectNote("all-closed", { stem: "all-closed-a", state: "done", status: "done", closedOn: "2026-11-12" });
  notes["all-closed-b.md"] = projectNote("all-closed", { stem: "all-closed-b", state: "canceled", status: "canceled", closedOn: "2026-11-11" });
  notes["all-closed-c.md"] = projectNote("all-closed", { stem: "all-closed-c", state: "done", status: "done", closedOn: "2026-11-10" });
  return notes;
}

function selfTest() {
  const notes = fixtureNotes();
  const projects = Object.entries(notes).filter(([name, text]) => name.endsWith(".md") && /type: "\[\[project\]\]"/.test(text));
  const states = new Set(["open", "scheduled", "blocked", "inherited", "warning", "done", "canceled"]);
  for (const state of states) {
    if (!Object.values(notes).some((text) => text.includes(state === "warning" ? "# Warning" : state === "inherited" ? "#prj_is_blocked" : state === "open" ? "#prj" : state === "scheduled" ? "[scheduled::" : state === "blocked" ? "[dependsOn::" : state === "done" ? "[completion::" : "[cancelled::"))) {
      throw new Error(`fixture missing ${state} state`);
    }
  }
  if (projects.length < 60) throw new Error(`fixture has only ${projects.length} project notes`);
  if (!notes["project-host.md"].includes("## Projects") || !notes["nested-child.md"].includes('parent: "[[project-host]]"')) throw new Error("nested project-host fixture is incomplete");
  if (!notes["all-closed-a.md"] || !notes["all-closed-c.md"] || !notes["empty-host.md"]) throw new Error("closed/empty host fixture is incomplete");
  if (!notes["one/duplicate.md"] || !notes["two/duplicate.md"]) throw new Error("duplicate-stem fixtures are missing");
  const parsed = parseArgs(["-s", "-o", "/tmp/shots", "-r", "/tmp/report.json"]);
  if (!parsed.selfTest || parsed.out !== "/tmp/shots" || parsed.report !== "/tmp/report.json") throw new Error("argument parser self-test failed");
  if (process.platform === "linux" && electronTempDir() !== "/tmp") throw new Error("Linux Electron temp path must stay short enough for Chromium singleton sockets");
  const probe = projectsProbeSource();
  if (!probe.includes("if (!el) return null")) throw new Error("probe must tolerate optional card controls");
  const source = fs.readFileSync(__filename, "utf8");
  if (!source.includes("all-closed host Closed peek") || !source.includes("nested-child-default-folded") || !source.includes("nested-project-toggle-activation")) throw new Error("acceptance must test each fold on its rendered host");
  for (const selector of [".bob-projects-header", ".bob-projects-closed-toggle", ".bob-projects-children-toggle", ".bob-projects-action"]) {
    if (!probe.includes(selector)) throw new Error(`probe misses ${selector}`);
  }
  process.stdout.write("offline self-test complete (fixtures and CDP probes; no Obsidian or bob launched)\n");
}

function writeNote(root, name, content) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function copyPlugin(vaultDir) {
  const source = path.join(repoRoot, "plugins", "bob-ledger-tools");
  const target = path.join(vaultDir, ".obsidian", "plugins", "bob-ledger-tools");
  fs.mkdirSync(target, { recursive: true });
  for (const name of ["manifest.json", "main.js", "styles.css"]) fs.copyFileSync(path.join(source, name), path.join(target, name));
  fs.writeFileSync(path.join(vaultDir, ".obsidian", "community-plugins.json"), JSON.stringify(["bob-ledger-tools"], null, 2));
  fs.writeFileSync(path.join(vaultDir, ".obsidian", "app.json"), JSON.stringify({ livePreview: true, showLineNumber: false, showInlineTitle: false }, null, 2));
  fs.writeFileSync(path.join(vaultDir, ".obsidian", "appearance.json"), JSON.stringify({ cssTheme: "", theme: "moonstone" }, null, 2));
}

function initScratchGit(vaultDir) {
  const run = (args) => {
    const result = spawnSync("git", args, { cwd: vaultDir, encoding: "utf8", timeout: 20_000 });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  };
  const origin = `${vaultDir}.origin.git`;
  const initOrigin = spawnSync("git", ["init", "-q", "--bare", origin], { encoding: "utf8", timeout: 20_000 });
  if (initOrigin.status !== 0) throw new Error(`git init --bare failed: ${initOrigin.stderr || initOrigin.stdout}`);
  const setOriginHead = spawnSync("git", ["--git-dir", origin, "symbolic-ref", "HEAD", "refs/heads/master"], { encoding: "utf8", timeout: 20_000 });
  if (setOriginHead.status !== 0) throw new Error(`git set scratch origin HEAD failed: ${setOriginHead.stderr || setOriginHead.stdout}`);
  run(["init", "-q"]);
  run(["symbolic-ref", "HEAD", "refs/heads/master"]);
  run(["config", "user.email", "projects-e2e@example.com"]);
  run(["config", "user.name", "Projects E2E"]);
  run(["remote", "add", "origin", origin]);
  run(["add", "."]);
  run(["commit", "-q", "-m", "projects card acceptance fixture"]);
  run(["push", "-q", "-u", "origin", "master"]);
}

function bobEnvironment(vaultDir, profileDir, shimDir, failFile) {
  return {
    ...process.env,
    HOME: profileDir,
    BOB_DIR: vaultDir,
    BOB_CONFIG_FILE: path.join(profileDir, "missing-isolated-bob-config.yml"),
    BOB_NOW: `${TODAY} 12:00:00`,
    PROJECTS_E2E_FAIL_LIST_FILE: failFile,
    PROJECTS_E2E_BOB_LOG: path.join(profileDir, "bob-invocations.jsonl"),
    PROJECTS_E2E_REAL_BOB: process.env.BOB_BIN || "",
    PATH: `${shimDir}${path.delimiter}${process.env.PATH || ""}`,
    NO_COLOR: "1",
  };
}

function electronTempDir() {
  // Snap Electron creates a Chromium singleton Unix socket in TMPDIR. SASE's
  // workspace TMPDIR can exceed sun_path's limit, so keep that socket path short.
  return process.platform === "linux" ? "/tmp" : os.tmpdir();
}

function writeBobShim(shimDir) {
  fs.mkdirSync(shimDir, { recursive: true });
  const shim = path.join(shimDir, "bob");
  fs.writeFileSync(shim, `#!/usr/bin/env node
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
const log = process.env.PROJECTS_E2E_BOB_LOG;
const entry = { at: new Date().toISOString(), args };
try { if (log) fs.appendFileSync(log, JSON.stringify(entry) + "\\n"); } catch (_) {}
try {
  if (args[0] === "projects" && args[1] === "list" && process.env.PROJECTS_E2E_FAIL_LIST_FILE && fs.existsSync(process.env.PROJECTS_E2E_FAIL_LIST_FILE)) {
    process.stderr.write("projects e2e injected report failure\\n");
    process.exit(23);
  }
  const child = spawnSync(process.env.PROJECTS_E2E_REAL_BOB, args, { encoding: "utf8", env: process.env, maxBuffer: 32 * 1024 * 1024 });
  if (child.stdout) process.stdout.write(child.stdout);
  if (child.stderr) process.stderr.write(child.stderr);
  process.exit(child.status == null ? 1 : child.status);
} catch (error) { process.stderr.write(String(error && error.message || error)); process.exit(127); }
`);
  fs.chmodSync(shim, 0o755);
  return shim;
}

function findBobProvenance() {
  const bob = process.env.BOB_BIN;
  const cliDir = process.env.BOB_CLI_DIR;
  if (!bob) fail("Set BOB_BIN to a bob binary built from the current bob-cli checkout.", 2);
  if (!cliDir) fail("Set BOB_CLI_DIR to the checkout that built BOB_BIN.", 2);
  const resolvedBob = fs.realpathSync(bob);
  const resolvedCli = fs.realpathSync(cliDir);
  const metadata = spawnSync("cargo", ["metadata", "--format-version", "1", "--no-deps", "--manifest-path", path.join(resolvedCli, "Cargo.toml")], { encoding: "utf8", timeout: 20_000 });
  if (metadata.status !== 0) fail(`Could not inspect bob-cli Cargo target: ${metadata.stderr || metadata.stdout}`, 2);
  let targetDirectory = "";
  try { targetDirectory = JSON.parse(metadata.stdout).target_directory || ""; } catch (_) {}
  if (!targetDirectory) fail("cargo metadata returned no target directory for BOB_CLI_DIR.", 2);
  const expected = path.join(targetDirectory, "debug", "bob");
  if (resolvedBob !== fs.realpathSync(expected)) fail(`BOB_BIN must be ${expected} from BOB_CLI_DIR; got ${resolvedBob}.`, 2);
  const version = spawnSync(resolvedBob, ["--version"], { encoding: "utf8", timeout: 15_000 });
  if (version.status !== 0) fail(`BOB_BIN --version failed: ${version.stderr || version.stdout}`, 2);
  const sha = spawnSync("git", ["-C", resolvedCli, "rev-parse", "HEAD"], { encoding: "utf8", timeout: 10_000 });
  if (sha.status !== 0) fail(`Could not read bob-cli checkout SHA: ${sha.stderr}`, 2);
  return { path: resolvedBob, version: String(version.stdout).trim(), checkout: resolvedCli, sha: String(sha.stdout).trim() };
}

function runBob(bob, args, vaultDir, profileDir) {
  const result = spawnSync(bob.path, args, {
    cwd: vaultDir,
    encoding: "utf8",
    timeout: 90_000,
    maxBuffer: 32 * 1024 * 1024,
    env: bobEnvironment(vaultDir, profileDir, path.join(profileDir, "shim"), path.join(profileDir, "fail-list")),
  });
  if (result.error) throw result.error;
  let json = null;
  try { json = JSON.parse(result.stdout || ""); } catch (_) {}
  return {
    args,
    exitCode: result.status,
    signal: result.signal || null,
    stderr: String(result.stderr || "").slice(0, 800),
    report: json ? {
      schema_version: json.schema_version,
      command: json.command,
      ok: json.ok,
      changed: json.changed,
      counts: json.counts || null,
      catalogStates: Array.isArray(json.catalogs) ? json.catalogs.map((row) => ({ path: row.path, state: row.state, rows: row.rows || null })) : [],
      states: Array.isArray(json.projects) ? json.projects.reduce((acc, row) => { acc[row.state || "null"] = (acc[row.state || "null"] || 0) + 1; return acc; }, {}) : {},
    } : null,
  };
}

function markdownFilesHash(root) {
  const rows = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === ".obsidian") continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && entry.name.endsWith(".md")) rows.push([path.relative(root, file).split(path.sep).join("/"), crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")]);
    }
  };
  visit(root);
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  return crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

function seedProfile(profileDir, vaultRealPath) {
  const key = crypto.randomBytes(8).toString("hex");
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, "obsidian.json"), JSON.stringify({ vaults: { [key]: { path: vaultRealPath, ts: Date.now(), open: true } } }, null, 2));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function withTimeout(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms); })]);
  } finally { clearTimeout(timer); }
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
    socket.addEventListener("message", (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch (_) { return; }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message || JSON.stringify(message.error)}`));
      else pending.resolve(message.result || {});
    });
    socket.addEventListener("close", () => {
      this.closed = true;
      for (const [id, pending] of this.pending) { clearTimeout(pending.timer); pending.reject(new Error(`${pending.method}: CDP socket closed`)); this.pending.delete(id); }
    });
  }
  static async connect(endpoint) {
    let WebSocket = globalThis.WebSocket;
    if (typeof WebSocket !== "function") WebSocket = require("undici").WebSocket;
    const socket = new WebSocket(endpoint);
    await withTimeout(new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", (event) => reject(new Error(event?.message || "CDP socket error")), { once: true });
    }), 15_000, "CDP connect");
    return new CdpClient(socket);
  }
  call(method, params = {}, timeoutMs = 15_000) {
    if (this.closed) return Promise.reject(new Error(`${method}: CDP socket closed`));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  async evaluate(expression, timeoutMs = 15_000) {
    const result = await this.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true }, timeoutMs);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Runtime.evaluate failed");
    return result.result?.value;
  }
  close() { try { this.socket.close(); } catch (_) {} }
}

function projectsProbeSource() {
  return `(() => { try {
    const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden"; };
    const describe = (el) => { if (!el) return null; return { text: (el.textContent || "").replace(/\\s+/g, " ").trim(), cls: String(el.className || ""), expanded: el.getAttribute("aria-expanded"), focus: el.getAttribute("data-focus-key"), visible: visible(el), rect: (() => { const r = el.getBoundingClientRect(); return { x:r.x,y:r.y,w:r.width,h:r.height }; })() }; };
    return { cards: Array.from(document.querySelectorAll('.callout[data-callout="projects"]')).filter(visible).map((card) => ({
      text: (card.textContent || "").replace(/\\s+/g, " ").trim(), hue: card.getAttribute("data-root-hue"), stale: card.getAttribute("data-stale"), rect: (() => { const r = card.getBoundingClientRect(); return { x:r.x,y:r.y,w:r.width,h:r.height }; })(),
      titleDisplay: getComputedStyle(card.querySelector(".callout-title") || card).display,
      header: describe(card.querySelector(".bob-projects-header")),
      tally: (() => {
        const full = card.querySelector(".bob-projects-tally-full");
        const short = card.querySelector(".bob-projects-tally-short");
        return {
          fullDisplay: full ? getComputedStyle(full).display : null,
          shortDisplay: short ? getComputedStyle(short).display : null,
          fullLabel: full?.getAttribute("aria-label") || full?.textContent || null,
          shortLabel: short?.getAttribute("aria-label") || short?.textContent || null,
        };
      })(),
      closed: describe(card.querySelector(".bob-projects-closed-toggle")),
      closedRows: Array.from(card.querySelectorAll(".bob-projects-closed-list .bob-projects-mini")).map(describe),
      childButtons: Array.from(card.querySelectorAll(".bob-projects-children-toggle")).map((el) => ({ ...describe(el), path: el.closest("li")?.querySelector("[data-projects-path]")?.getAttribute("data-projects-path") || el.closest("li")?.getAttribute("data-projects-path") })),
      childRows: Array.from(card.querySelectorAll(".bob-projects-child-list .bob-projects-mini")).map(describe),
      markers: Array.from(card.querySelectorAll(".bob-projects-marker")).map((el) => ({ state: el.getAttribute("data-state"), text: el.textContent, label: el.getAttribute("aria-label") })),
      criteria: Array.from(card.querySelectorAll(".bob-projects-criterion")).map(describe),
      actions: Array.from(card.querySelectorAll(".bob-projects-action")).map((el) => ({ ...describe(el), disabled: el.disabled })),
      copy: describe(card.querySelector(".bob-projects-copy")),
      leaf: card.closest(".workspace-leaf")?.getAttribute("data-type") || null,
    })),
    standalone: Array.from(document.querySelectorAll(".bob-projects-anchor, h2")).filter((el) => visible(el) && el.querySelector(".bob-projects-header") && !el.closest('.callout[data-callout="projects"]')).map((el) => ({ ...describe(el), header: describe(el.querySelector(".bob-projects-header")), closed: describe(el.querySelector(".bob-projects-closed-toggle")), closedRows: Array.from(el.querySelectorAll(".bob-projects-closed-list .bob-projects-mini")).map(describe), actions: Array.from(el.querySelectorAll(".bob-projects-action")).map((button) => ({ ...describe(button), disabled: button.disabled })) })),
    plugin: window.app?.plugins?.plugins?.["bob-ledger-tools"] ? (() => { const p = window.app.plugins.plugins["bob-ledger-tools"]; const s = p.projectsReportState(); return { loaded:true, projects:s.report?.projects?.length || 0, catalogs:s.report?.catalogs?.map((c)=>({path:c.path,state:c.state,rows:c.rows})), states:s.report?.projects?.reduce((a,r)=>{a[r.state||"null"]=(a[r.state||"null"]||0)+1;return a;},{}), error:s.error?.code || null, stale:s.stale, refreshing:s.refreshing, generation:s.generation, reportGeneration:s.reportGeneration, syncBusy:s.syncBusy }; })() : {loaded:false},
    activeFile: window.app?.workspace?.getActiveFile?.()?.path || null,
    active: document.activeElement ? describe(document.activeElement) : null,
  };
  } catch (e) { return { error: String(e && e.message || e) }; } })()`;
}

async function selectTarget(port, vaultPath, childAlive) {
  const deadline = Date.now() + 30_000;
  let last = "";
  while (Date.now() < deadline) {
    if (childAlive && !childAlive()) throw new Error("Obsidian exited before opening the scratch vault");
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = response.ok ? await response.json() : [];
      for (const page of targets.filter((item) => item.type === "page" && item.webSocketDebuggerUrl)) {
        let client;
        try {
          client = await CdpClient.connect(page.webSocketDebuggerUrl);
          const observed = await client.evaluate(`(() => window.app?.vault?.adapter?.basePath || null)()`);
          if (observed && path.resolve(observed) === path.resolve(vaultPath)) return page;
        } catch (error) { last = error.message; }
        finally { client?.close(); }
      }
    } catch (error) { last = error.message; }
    await sleep(300);
  }
  throw new Error(`No CDP target belongs to the fixture vault${last ? `: ${last}` : ""}`);
}

async function waitFor(client, expression, predicate, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try { last = await client.evaluate(expression); if (predicate(last)) return last; }
    catch (error) { last = { error: error.message }; }
    await sleep(120);
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(last).slice(0, 1600)}`);
}

async function trustCommunityPlugins(client) {
  return waitFor(client, `(()=>{
    if(window.app?.plugins?.plugins?.["bob-ledger-tools"]) return "already-loaded";
    const buttons=Array.from(document.querySelectorAll("button"));
    const trust=buttons.find((button)=>/Trust author and enable plugins/i.test(button.textContent||""));
    if(!trust) return null;
    trust.click();
    return "trusted";
  })()`, Boolean, "community plugin trust prompt or plugin startup", 20_000);
}

async function openNote(client, name, mode = "live") {
  const state = mode === "reading" ? { mode: "preview", source: false } : { mode: "source", source: false };
  return client.evaluate(`(async()=>{
    const file=app.vault.getAbstractFileByPath(${JSON.stringify(name)}); if(!file) return {ok:false,error:"missing "+${JSON.stringify(name)}};
    const leaf=app.workspace.getLeaf(false); await leaf.openFile(file,{state:${JSON.stringify(state)}});
    if(leaf.view?.setState) await leaf.view.setState(Object.assign({},leaf.view.getState?.()||{},${JSON.stringify(state)}),{history:false});
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); await new Promise(r=>setTimeout(r,350));
    return {ok:true,path:leaf.view?.file?.path,state:leaf.view?.getState?.()||null};
  })()`, 30_000);
}

async function capture(client, file, width) {
  const shot = await client.call("Page.captureScreenshot", { format: "png", fromSurface: true });
  const bytes = Buffer.from(shot.data, "base64");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  return { path: file, width, bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
}

async function setViewport(client, width, height = 940) {
  await client.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width <= 400 });
  if (width <= 400) {
    await client.evaluate(`(()=>{const split=app.workspace?.leftSplit;if(split&&!split.collapsed)split.collapse();return true;})()`);
  }
  await client.evaluate(`new Promise((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  await sleep(180);
}

async function clickBy(client, selector, index = 0) {
  const target = await client.evaluate(`(()=>{const rows=Array.from(document.querySelectorAll(${JSON.stringify(selector)})).filter((el)=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0});const el=rows[${index}];if(!el)return {ok:false,count:rows.length};if(el.disabled)return {ok:false,count:rows.length,disabled:true};el.scrollIntoView({block:"center",inline:"nearest"});const r=el.getBoundingClientRect();return {ok:true,count:rows.length,x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  if (!target.ok) return target;
  await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: target.x, y: target.y });
  await client.call("Input.dispatchMouseEvent", { type: "mousePressed", x: target.x, y: target.y, button: "left", clickCount: 1 });
  await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: target.x, y: target.y, button: "left", clickCount: 1 });
  return target;
}

async function activateBy(client, selector, index = 0) {
  return client.evaluate(`(()=>{const visible=(el)=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0};const rows=Array.from(document.querySelectorAll(${JSON.stringify(selector)})).filter(visible);const el=rows[${index}];if(!el)return {ok:false,count:rows.length};el.scrollIntoView({block:"center",inline:"nearest"});el.focus();window.__projectsE2EEvents={click:0};el.addEventListener("click",()=>window.__projectsE2EEvents.click++);el.click();const updated=Array.from(document.querySelectorAll(${JSON.stringify(selector)})).filter(visible)[${index}]||el;const p=app.plugins.plugins["bob-ledger-tools"];const view=Array.from(p.projectsCatalogEditors||[]).find((candidate)=>candidate.dom?.contains(updated));const widget=Array.from(p.projectsCatalogReading||[]).find((candidate)=>candidate.el?.contains(updated));return {ok:true,count:rows.length,focus:document.activeElement===updated,expanded:updated.getAttribute("aria-expanded"),events:window.__projectsE2EEvents,viewCount:p.projectsCatalogEditors?.size||0,folds:[...(p.projectsCatalogFoldByView?.get(view)||new Map()).entries()],widgetCount:p.projectsCatalogReading?.size||0,widgetFolds:widget?[...widget.folds.entries()]:null,widgetInfo:widget?{path:widget.path,tag:widget.el?.tagName,cls:String(widget.el?.className||""),closestCm:Boolean(widget.el?.closest?.(".cm-editor")),containsCm:Boolean(widget.el?.querySelector?.(".cm-editor")),containsCallout:Boolean(widget.el?.querySelector?.('.callout[data-callout="projects"]'))}:null,inEditor:Boolean(updated.closest(".cm-editor")),inReading:Boolean(updated.closest(".markdown-preview-view"))};})()`);
}

function parseBobLog(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch (_) { return []; } });
}

async function run(args) {
  const bob = findBobProvenance();
  const executable = args.executable || process.env.OBSIDIAN_BIN || ELECTRON_FALLBACK;
  try { fs.accessSync(executable, fs.constants.X_OK); } catch (_) { fail(`Obsidian Electron executable is not executable: ${executable}`, 2); }
  const help = spawnSync(executable, ["--help"], { encoding: "utf8", timeout: 20_000 });
  if (/unable to find Obsidian/i.test(String(help.stdout || "") + String(help.stderr || ""))) fail("Pass the Obsidian Electron binary, not the obsidian CLI shim.", 2);

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "bob-projects-ui-e2e-"));
  const vaultDir = path.join(scratch, "vault");
  const profileDir = path.join(scratch, "profile");
  const shimDir = path.join(profileDir, "shim");
  const failFile = path.join(profileDir, "fail-list");
  const outDir = args.out || path.join(os.tmpdir(), "bob-projects-ui-e2e-shots");
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  const notes = fixtureNotes();
  for (const [name, content] of Object.entries(notes)) writeNote(vaultDir, name, content);
  copyPlugin(vaultDir);
  initScratchGit(vaultDir);
  writeBobShim(shimDir);
  const vaultReal = fs.realpathSync(vaultDir);
  seedProfile(profileDir, vaultReal);
  const env = bobEnvironment(vaultDir, profileDir, shimDir, failFile);
  const report = {
    pass: false,
    startedAt: new Date().toISOString(),
    executable,
    bob,
    fixture: { noteCount: Object.keys(notes).length, projectNotes: Object.keys(notes).filter((name) => /type: "\[\[project\]\]"/.test(notes[name])).length },
    bobRuns: [],
    checks: [],
    screenshots: [],
    probes: {},
    noteSafety: {},
    scratchVault: vaultReal,
  };
  const record = (name, ok, detail = "") => report.checks.push({ name, ok: Boolean(ok), detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
  let child = null;
  let client = null;
  let stopTimer;
  try {
    const seedSync = runBob(bob, ["projects", "sync", "-f", "json"], vaultDir, profileDir);
    report.bobRuns.push(seedSync);
    record("fixture-seeded-by-current-bob", seedSync.report?.command === "sync" && seedSync.report.schema_version === 1, seedSync);
    if (seedSync.report?.command !== "sync" || seedSync.report.schema_version !== 1) throw new Error(`bob projects sync could not seed fixture: ${JSON.stringify(seedSync)}`);
    const seedList = runBob(bob, ["projects", "list", "-f", "json"], vaultDir, profileDir);
    report.bobRuns.push(seedList);
    record("current-bob-list-json", seedList.report?.command === "list" && seedList.report.schema_version === 1, seedList);
    if (seedList.report?.command !== "list") throw new Error(`bob projects list produced no schema-1 JSON: ${JSON.stringify(seedList)}`);
    const states = seedList.report.states || {};
    record("six-project-states", ["open", "scheduled", "blocked", "warning", "done", "canceled"].every((state) => (states[state] || 0) > 0), states);
    record("catalog-hosts", (seedList.report.catalogStates || []).some((row) => row.path === "area.md") && (seedList.report.catalogStates || []).some((row) => row.path === "project-host.md"), seedList.report.catalogStates);
    const areaCatalog = (seedList.report.catalogStates || []).find((row) => row.path === "area.md");
    record("area-host-has-60-direct-children", (areaCatalog?.rows?.open || 0) + (areaCatalog?.rows?.blocked || 0) + (areaCatalog?.rows?.warning || 0) + (areaCatalog?.rows?.closed || 0) >= 60, areaCatalog);
    report.noteSafety.afterSeedSync = markdownFilesHash(vaultDir);

    const port = await freePort();
    child = spawn(executable, ["--no-sandbox", `--user-data-dir=${profileDir}`, `--remote-debugging-port=${port}`, "--remote-allow-origins=http://127.0.0.1/*", vaultReal], {
      stdio: "ignore",
      env: { ...env, TMPDIR: electronTempDir() },
    });
    let exitInfo = null;
    child.once("exit", (code, signal) => { exitInfo = { code, signal }; });
    stopTimer = setTimeout(() => { if (child && !child.killed) child.kill("SIGTERM"); }, OVERALL_TIMEOUT_MS);
    const page = await selectTarget(port, vaultReal, () => !exitInfo && child.exitCode == null);
    client = await CdpClient.connect(page.webSocketDebuggerUrl);
    await client.call("Page.enable");
    await client.call("Runtime.enable");
    report.pluginStartup = { trustAction: await trustCommunityPlugins(client) };
    await waitFor(client, `(()=>Boolean(window.app?.plugins?.plugins?.["bob-ledger-tools"]))()`, Boolean, "Bob Ledger Tools loaded", 40_000);
    const opened = await openNote(client, "area.md", "live");
    record("opened-area-live-preview", opened.ok && opened.path === "area.md", opened);
    await client.evaluate(`(async()=>{await app.plugins.plugins["bob-ledger-tools"].apiProjectsReport({force:true,wait:true});return true;})()`, 90_000);
    let probe = await waitFor(client, projectsProbeSource(), (value) => value && value.plugin?.loaded && !value.plugin.stale && !value.plugin.refreshing && value.plugin.projects > 50 && (value.cards?.length || 0) > 0 && value.cards.every((card) => card.stale !== "true"), "fresh projects card and report", 45_000);
    report.probes.areaLive = probe;
    const areaCard = probe.cards[0];
    record("live-preview-projects-card", Boolean(areaCard && /Projects/.test(areaCard.header?.text || "") && /open/.test(areaCard.text)), areaCard);
    record("row-state-markers", ["open", "other"].includes(areaCard.markers?.[0]?.state) && (probe.plugin.states?.scheduled || 0) > 0 && (probe.plugin.states?.blocked || 0) > 0, probe.plugin.states);
    record("catalog-health-and-hue", Boolean(areaCard.hue) && areaCard.stale !== "true", { hue: areaCard.hue, stale: areaCard.stale });
    record("nested-child-default-folded", areaCard.childButtons.some((button) => button.path === "all-closed.md" && button.expanded === "false") && areaCard.childRows.length === 0, areaCard.childButtons);
    record("60-plus-rows-rendered", areaCard.markers.length >= 60, `visible project markers=${areaCard.markers.length}`);

    await setViewport(client, 1280, 940);
    const desktopLight = await capture(client, path.join(outDir, "projects-area-live-desktop-light.png"), 1280);
    report.screenshots.push({ ...desktopLight, theme: "light", view: "Live Preview" });
    await client.evaluate(`(()=>{document.body.classList.remove("theme-light");document.body.classList.add("theme-dark");return true;})()`);
    await sleep(250);
    const desktopDark = await capture(client, path.join(outDir, "projects-area-live-desktop-dark.png"), 1280);
    report.screenshots.push({ ...desktopDark, theme: "dark", view: "Live Preview" });
    await client.evaluate(`(()=>{document.body.classList.remove("theme-dark");document.body.classList.add("theme-light");return true;})()`);

    // The area host lists closed projects in its catalog rows. The dedicated
    // all-closed host renders the separate Closed peek and owns its fold map.
    await openNote(client, "all-closed.md", "reading");
    let closedProbe = await waitFor(client, projectsProbeSource(), (value) => value.standalone?.some((card) => /0 open/.test(card.header?.text || "") && card.closed?.expanded === "false" && card.closedRows.length === 2), "all-closed host Closed peek");
    record("closed-peek-default", closedProbe.standalone.some((card) => /0 open/.test(card.header?.text || "") && card.closed?.expanded === "false" && card.closedRows.length === 2), closedProbe.standalone);

    await openNote(client, "area.md", "live");
    probe = await waitFor(client, projectsProbeSource(), (value) => value.activeFile === "area.md" && value.plugin?.loaded && value.cards?.length > 0, "return to area projects card");

    // The nested host has one read-only child. Expansion exposes it without
    // changing source bytes, and another pane must keep its own fold state.
    const hostButton = await activateBy(client, '.callout[data-callout="projects"] .bob-projects-chips[data-projects-path="project-host.md"] .bob-projects-children-toggle');
    record("nested-project-toggle-activation", hostButton.ok && hostButton.expanded === "true" && hostButton.events.click === 1, hostButton);
    probe = await waitFor(client, projectsProbeSource(), (value) => value.cards?.some((card) => card.childRows?.some((row) => /nested-child/.test(row.text || ""))), "nested project child");
    record("nested-project-child-readable", probe.cards.some((card) => card.childRows.some((row) => /nested-child/.test(row.text))), probe.cards.map((card) => card.childRows));
    const passiveBefore = markdownFilesHash(vaultDir);
    const focusBefore = await client.evaluate(`(()=>{const button=document.querySelector('.callout[data-callout="projects"] .bob-projects-chips[data-projects-path="project-host.md"] .bob-projects-children-toggle');if(!button)return {ok:false};button.focus();const p=app.plugins.plugins["bob-ledger-tools"];const view=Array.from(p.projectsCatalogEditors||[]).find((candidate)=>candidate.dom?.contains(button));const widget=Array.from(p.projectsCatalogReading||[]).find((candidate)=>candidate.el?.contains(button));return {ok:document.activeElement===button,focus:document.activeElement?.getAttribute("data-focus-key"),child:button.getAttribute("aria-expanded"),viewCount:p.projectsCatalogEditors?.size||0,folds:[...(p.projectsCatalogFoldByView?.get(view)||new Map()).entries()],widgetCount:p.projectsCatalogReading?.size||0,widgetFolds:widget?[...widget.folds.entries()]:null,inEditor:Boolean(button.closest(".cm-editor")),inReading:Boolean(button.closest(".markdown-preview-view"))};})()`);
    await client.evaluate(`(async()=>{await app.plugins.plugins["bob-ledger-tools"].apiProjectsReport({force:true,wait:true});return true;})()`, 90_000);
    probe = await waitFor(client, projectsProbeSource(), (value) => !value.plugin?.refreshing && !value.plugin?.stale && value.cards?.some((card) => card.childButtons?.some((button) => button.path === "project-host.md" && button.expanded === "true")), "projects refresh repaint", 10_000);
    const focusAfter = probe.active;
    const sameHostCard = probe.cards.find((card) => card.childButtons.some((button) => button.path === "project-host.md"));
    const foldMapsAfter = await client.evaluate(`(()=>{const p=app.plugins.plugins["bob-ledger-tools"];return Array.from(p.projectsCatalogEditors||[]).map((view,index)=>({index,active:view.dom?.contains(document.activeElement)||false,folds:[...(p.projectsCatalogFoldByView?.get(view)||new Map()).entries()]}));})()`);
    record("fold-and-focus-persist-through-refresh", focusBefore.ok && focusAfter?.focus === "children" && sameHostCard?.childButtons.some((button) => button.path === "project-host.md" && button.expanded === "true"), { before: focusBefore, after: focusAfter, childButtons: sameHostCard?.childButtons, foldMapsAfter });
    const split = await client.evaluate(`(async()=>{try{const other=app.workspace.getLeaf("split");const file=app.vault.getAbstractFileByPath("area.md");await other.openFile(file,{state:{mode:"source",source:false}});await new Promise(r=>setTimeout(r,800));return {ok:true,leaves:app.workspace.getLeavesOfType("markdown").length};}catch(e){return {ok:false,error:String(e&&e.message||e)}}})()`);
    record("second-project-pane-open", split.ok && split.leaves >= 2, split);
    if (split.ok) {
      probe = await waitFor(client, projectsProbeSource(), (value) => value.cards?.length >= 2, "independent project panes", 25_000);
      await client.evaluate(`(()=>{const cards=Array.from(document.querySelectorAll('.callout[data-callout="projects"]')).filter((el)=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0});for(const card of cards){const button=card.querySelector('.bob-projects-chips[data-projects-path="project-host.md"] .bob-projects-children-toggle');if(button?.getAttribute("aria-expanded")==="true")button.click();}return true;})()`);
      const folded = await waitFor(client, `(()=>Array.from(document.querySelectorAll('.callout[data-callout="projects"]')).filter((el)=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0}).map((card)=>card.querySelector('.bob-projects-chips[data-projects-path="project-host.md"] .bob-projects-children-toggle')?.getAttribute("aria-expanded")))()`, (value) => value.length >= 2 && value.every((state) => state === "false"), "two panes folded independently");
      record("two-pane-fold-defaults", folded.length >= 2 && folded.every((state) => state === "false"), folded);
      await client.evaluate(`(()=>{const cards=Array.from(document.querySelectorAll('.callout[data-callout="projects"]')).filter((el)=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0});cards[1]?.querySelector('.bob-projects-chips[data-projects-path="project-host.md"] .bob-projects-children-toggle')?.click();return true;})()`);
      const isolated = await waitFor(client, `(()=>Array.from(document.querySelectorAll('.callout[data-callout="projects"]')).filter((el)=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0}).map((card)=>card.querySelector('.bob-projects-chips[data-projects-path="project-host.md"] .bob-projects-children-toggle')?.getAttribute("aria-expanded")))()`, (value) => value.length >= 2 && value[0] === "false" && value[1] === "true", "pane-local child fold");
      record("two-pane-fold-isolation", isolated.length >= 2 && isolated[0] === "false" && isolated[1] === "true", isolated);
    }
    await client.evaluate(`(()=>{const active=app.workspace.activeLeaf;for(const leaf of app.workspace.getLeavesOfType("markdown")){if(leaf!==active)leaf.detach();}return true;})()`);

    // Exercise the actual card action and replace its clipboard boundary with
    // a deterministic capture of the host-derived starter.
    const copyAction = await client.evaluate(`(()=>{window.__projectsCopied="";const p=app.plugins.plugins["bob-ledger-tools"];const button=document.querySelector('.callout[data-callout="projects"] .bob-projects-copy[data-focus-key="copy"]');if(!p||!button)return {ok:false,button:Boolean(button)};p.apiProjectsCopyStarter=async(sourcePath)=>{window.__projectsCopied="@"+String(sourcePath||"").replace(/\\.md$/i,"")+"^";return {ok:true,value:window.__projectsCopied};};button.click();return {ok:true,button:true};})()`);
    record("copy-project-starter-action", copyAction.ok, copyAction);
    const copied = await waitFor(client, `(()=>window.__projectsCopied||"")()`, (value) => Boolean(value), "project capture starter action");
    record("copy-project-starter", copied === "@area^", copied);

    await client.evaluate(`(()=>document.querySelector('.callout[data-callout="projects"] a.internal-link')?.click())()`);
    await sleep(450);
    await openNote(client, "area.md", "live");
    await client.evaluate(`(async()=>{const p=app.plugins.plugins["bob-ledger-tools"];await p.apiProjectsReport({force:true,wait:true});return true;})()`, 90_000);
    await sleep(350);
    const passiveAfter = markdownFilesHash(vaultDir);
    report.noteSafety.passivePaintFoldNavigationRefresh = { before: passiveBefore, after: passiveAfter, unchanged: passiveBefore === passiveAfter };
    record("passive-ui-does-not-write-notes", passiveBefore === passiveAfter, report.noteSafety.passivePaintFoldNavigationRefresh);
    report.probes.refresh = await client.evaluate(projectsProbeSource());

    // Narrow layout is captured and checked against the rendered criterion.
    await setViewport(client, 375, 900);
    probe = await waitFor(client, projectsProbeSource(), (value) => value.cards?.length > 0, "narrow projects card");
    const narrowShot = await capture(client, path.join(outDir, "projects-area-live-mobile-light.png"), 375);
    report.screenshots.push({ ...narrowShot, theme: "light", view: "Live Preview" });
    await client.evaluate(`(()=>{document.body.classList.remove("theme-light");document.body.classList.add("theme-dark");return true;})()`);
    await sleep(250);
    const narrowDark = await capture(client, path.join(outDir, "projects-area-live-mobile-dark.png"), 375);
    report.screenshots.push({ ...narrowDark, theme: "dark", view: "Live Preview" });
    await client.evaluate(`(()=>{document.body.classList.remove("theme-dark");document.body.classList.add("theme-light");return true;})()`);
    const narrowRows = await client.evaluate(`(()=>Array.from(document.querySelectorAll('.callout[data-callout="projects"] li')).map((li)=>({criterion:li.querySelector(".bob-projects-criterion")?.getBoundingClientRect().toJSON?.()||null,chips:li.querySelector(".bob-projects-chips")?.getBoundingClientRect().toJSON?.()||null})).filter((row)=>row.criterion&&row.chips))()`);
    const wraps = probe.cards.some((card) => card.rect.w > 0 && card.rect.w <= 440) && narrowRows.some((row) => row.criterion.width > 0 && row.chips.width > 0 && row.chips.y >= row.criterion.bottom - 2);
    record("375px-chips-wrap", wraps, narrowRows.slice(0, 3));
    const mobileCard = probe.cards[0];
    record("375px-tally-abbreviates-accessibly", mobileCard.tally.fullDisplay === "none" && mobileCard.tally.shortDisplay !== "none" && mobileCard.tally.fullLabel === mobileCard.tally.shortLabel, mobileCard.tally);

    await setViewport(client, 1280, 940);
    const reading = await openNote(client, "area.md", "reading");
    record("opened-area-reading", reading.ok, reading);
    probe = await waitFor(client, projectsProbeSource(), (value) => value.cards?.length > 0 && value.cards.some((card) => card.titleDisplay === "none"), "Reading projects card");
    record("reading-view-card", probe.cards.length > 0, probe.cards[0]);
    const readingShot = await capture(client, path.join(outDir, "projects-area-reading-desktop-light.png"), 1280);
    report.screenshots.push({ ...readingShot, theme: "light", view: "Reading" });

    await client.evaluate(`(()=>{const active=app.workspace.activeLeaf;for(const leaf of app.workspace.getLeavesOfType("markdown")){if(leaf!==active)leaf.detach();}return true;})()`);
    await openNote(client, "all-closed.md", "reading");
    probe = await waitFor(client, projectsProbeSource(), (value) => value.standalone?.some((card) => /0 open/.test(card.header?.text || "")), "all-closed host");
    record("all-closed-host-card", probe.standalone.some((card) => /0 open/.test(card.header?.text || "") && card.closed?.expanded === "false" && card.closedRows.length === 2), probe.standalone);
    await openNote(client, "empty-host.md", "reading");
    await sleep(500);
    probe = await client.evaluate(projectsProbeSource());
    record("empty-host-has-no-empty-card", !probe.cards?.some((card) => card.header) && !probe.standalone?.some((row) => /Projects/.test(row.text)), probe);

    // A damaged list transport keeps the last-good card visible and offers
    // Retry; removing the isolated failure lets the button recover it.
    await openNote(client, "area.md", "live");
    const beforeFailure = await client.evaluate(`(()=>app.plugins.plugins["bob-ledger-tools"].projectsReport.projects.length)()`);
    fs.writeFileSync(failFile, "fail list\n");
    await client.evaluate(`(async()=>{const p=app.plugins.plugins["bob-ledger-tools"];p.apiProjectsInvalidate("e2e-transport-failure");await p.apiProjectsReport({force:true,wait:true});return true;})()`, 90_000);
    probe = await waitFor(client, projectsProbeSource(), (value) => value.plugin?.error && !value.plugin.refreshing && value.cards?.[0]?.actions?.some((action) => action.focus === "retry" && !action.disabled), "report failure Retry");
    record("failure-keeps-last-good-and-retry", probe.plugin.projects === beforeFailure && probe.cards.length > 0, { error: probe.plugin.error, projects: probe.plugin.projects, actions: probe.cards[0]?.actions });
    fs.rmSync(failFile, { force: true });
    await clickBy(client, '.callout[data-callout="projects"] .bob-projects-action[data-focus-key="retry"]');
    probe = await waitFor(client, projectsProbeSource(), (value) => !value.plugin?.error && value.plugin?.projects > 50, "Retry recovers projects report", 45_000);
    record("retry-recovers-current-report", !probe.plugin.error && probe.plugin.projects > 50, probe.plugin);

    // Missing catalog makes sync actionable. The plugin invokes the real Bob
    // sync through the isolated logging shim; the report is then revalidated.
    const removedCallout = await client.evaluate(`(async()=>{const file=app.vault.getAbstractFileByPath("area.md");const text=await app.vault.read(file);const next=text.replace(/\\n## Projects\\n[\\s\\S]*?(?=\\n## |$)/,"\\n## Projects\\n");await app.vault.modify(file,next);return {removed:text!==next,bytes:next.length};})()`);
    record("removed-catalog-for-missing-sync-case", removedCallout.removed, removedCallout);
    await client.evaluate(`(async()=>{const p=app.plugins.plugins["bob-ledger-tools"];p.apiProjectsInvalidate("e2e-remove-catalog");await p.apiProjectsReport({force:true,wait:true});return true;})()`, 90_000);
    probe = await waitFor(client, projectsProbeSource(), (value) => value.standalone?.some((row) => /sync/i.test(row.text)) || value.cards?.some((card) => card.actions?.some((action) => action.focus === "sync")), "missing catalog sync action");
    record("missing-catalog-action", true, probe.standalone || probe.cards?.[0]?.actions);
    const logFile = path.join(profileDir, "bob-invocations.jsonl");
    const syncsBeforeMissing = parseBobLog(logFile).filter((entry) => entry.args?.[0] === "projects" && entry.args?.[1] === "sync").length;
    await client.evaluate(`(()=>{const button=Array.from(document.querySelectorAll(".bob-projects-action")).find((el)=>el.getAttribute("data-focus-key")==="sync");button?.click();return Boolean(button);})()`);
    await waitFor(client, projectsProbeSource(), (value) => value.plugin?.catalogs?.some((row) => row.path === "area.md" && row.state === "current") && value.cards?.some((card) => /projects/.test(card.text)), "missing catalog sync restoration", 60_000);
    const syncsAfterMissing = parseBobLog(logFile).filter((entry) => entry.args?.[0] === "projects" && entry.args?.[1] === "sync").length;
    record("missing-catalog-sync-revalidated", syncsAfterMissing === syncsBeforeMissing + 1, { syncsBeforeMissing, syncsAfterMissing });

    const staleEdit = await client.evaluate(`(async()=>{const file=app.vault.getAbstractFileByPath("area.md");const text=await app.vault.read(file);const next=text.split("\\n").filter((line)=>!line.includes("project-02")).join("\\n");await app.vault.modify(file,next);return {changed:text!==next};})()`);
    record("edited-catalog-for-stale-sync-case", staleEdit.changed, staleEdit);
    await client.evaluate(`(async()=>{const p=app.plugins.plugins["bob-ledger-tools"];p.apiProjectsInvalidate("e2e-stale-catalog");await p.apiProjectsReport({force:true,wait:true});return true;})()`, 90_000);
    probe = await waitFor(client, projectsProbeSource(), (value) => value.plugin?.catalogs?.some((row) => row.path === "area.md" && row.state === "stale") && value.cards?.some((card) => card.actions?.some((action) => action.focus === "sync")), "stale catalog sync action");
    record("stale-catalog-action", true, probe.plugin.catalogs);
    const syncsBeforeStale = parseBobLog(logFile).filter((entry) => entry.args?.[0] === "projects" && entry.args?.[1] === "sync").length;
    await client.evaluate(`(()=>{const button=Array.from(document.querySelectorAll(".bob-projects-action")).find((el)=>el.getAttribute("data-focus-key")==="sync");button?.click();return Boolean(button);})()`);
    await waitFor(client, projectsProbeSource(), (value) => value.plugin?.catalogs?.some((row) => row.path === "area.md" && row.state === "current"), "stale catalog sync restoration", 60_000);
    const syncsAfterStale = parseBobLog(logFile).filter((entry) => entry.args?.[0] === "projects" && entry.args?.[1] === "sync").length;
    record("stale-catalog-sync-revalidated", syncsAfterStale === syncsBeforeStale + 1, { syncsBeforeStale, syncsAfterStale });

    // Creation, reparenting and lifecycle changes each cause one debounced
    // automatic sync. Wait past the debounce to prove they settle once.
    const waitForOneSync = async (before, label) => {
      const deadline = Date.now() + 30_000;
      let current = before;
      while (Date.now() < deadline) {
        current = parseBobLog(logFile).filter((entry) => entry.args?.[0] === "projects" && entry.args?.[1] === "sync").length;
        if (current > before) break;
        await sleep(150);
      }
      await sleep(7_000);
      const settled = parseBobLog(logFile).filter((entry) => entry.args?.[0] === "projects" && entry.args?.[1] === "sync").length;
      record(`${label}-one-settled-auto-sync`, settled === before + 1, { before, observed: current, settled });
      return settled;
    };
    let syncCount = parseBobLog(logFile).filter((entry) => entry.args?.[0] === "projects" && entry.args?.[1] === "sync").length;
    await client.evaluate(`(async()=>{await app.vault.create("auto-created.md",${JSON.stringify(projectNote("area", { stem: "auto-created", title: "Auto created", visible: true }))});return true;})()`);
    syncCount = await waitForOneSync(syncCount, "create");
    probe = await client.evaluate(projectsProbeSource());
    record("created-project-appears", probe.plugin?.projects > 60 && probe.plugin.states?.open > 0, probe.plugin);

    const sourceBeforeReparent = fs.readFileSync(path.join(vaultDir, "project-01.md"), "utf8");
    const reparented = sourceBeforeReparent.replace('parent: "[[area]]"', 'parent: "[[project-host]]"');
    syncCount = parseBobLog(logFile).filter((entry) => entry.args?.[0] === "projects" && entry.args?.[1] === "sync").length;
    await client.evaluate(`(async()=>{const file=app.vault.getAbstractFileByPath("project-01.md");await app.vault.modify(file,${JSON.stringify(reparented)});return true;})()`);
    syncCount = await waitForOneSync(syncCount, "reparent");
    probe = await waitFor(client, projectsProbeSource(), (value) => value.plugin?.catalogs?.some((row) => row.path === "project-host.md"), "reparented project catalog", 35_000);
    record("reparenting-refreshes-membership", true, probe.plugin.catalogs);

    await client.evaluate(`(()=>{window.__projectsE2ELifecycleEvents=[];window.__projectsE2ELifecycleRefs=[];for(const event of ["create","modify","delete","rename"])window.__projectsE2ELifecycleRefs.push(app.vault.on(event,(file,old)=>window.__projectsE2ELifecycleEvents.push({event,path:file?.path||null,old:typeof old==="string"?old:null,at:Date.now()})));window.__projectsE2ELifecycleRefs.push(app.metadataCache.on("changed",(file)=>window.__projectsE2ELifecycleEvents.push({event:"metadata",path:file?.path||null,at:Date.now()})));return true;})()`);
    const lifecycleBefore = fs.readFileSync(path.join(vaultDir, "auto-created.md"), "utf8");
    const lifecycleAfter = lifecycleBefore.replace("status: wip", "status: done").replace("- [ ] #task #prj", "- [x] #task #prj").replace(" ^prj", " [completion:: 2026-11-13] ^prj");
    syncCount = parseBobLog(logFile).filter((entry) => entry.args?.[0] === "projects" && entry.args?.[1] === "sync").length;
    await client.evaluate(`(async()=>{const file=app.vault.getAbstractFileByPath("auto-created.md");await app.vault.modify(file,${JSON.stringify(lifecycleAfter)});return true;})()`);
    syncCount = await waitForOneSync(syncCount, "lifecycle");
    const lifecycleEvents = await client.evaluate(`(()=>window.__projectsE2ELifecycleEvents||[])()`);
    record("lifecycle-source-events", true, lifecycleEvents);
    probe = await waitFor(client, projectsProbeSource(), (value) => value.plugin?.states?.done > 0, "lifecycle catalog change", 40_000);
    record("lifecycle-change-refreshes-state", probe.plugin.states.done > 0, probe.plugin.states);
    report.bobInvocations = parseBobLog(logFile);
    report.noteSafety.expectedBobWritesAreLogged = report.bobInvocations.filter((entry) => entry.args?.[0] === "projects" && entry.args?.[1] === "sync").length >= 5;
    record("expected-bob-sync-invocations-recorded", report.noteSafety.expectedBobWritesAreLogged, report.bobInvocations.map((row) => row.args));
    report.pass = report.checks.every((check) => check.ok);
    report.failures = report.checks.filter((check) => !check.ok).map((check) => check.name);
  } catch (error) {
    report.error = error && error.stack ? error.stack : String(error);
    report.pass = false;
    report.failures = report.checks.filter((check) => !check.ok).map((check) => check.name);
    if (!report.failures.includes("runner-error")) report.checks.push({ name: "runner-error", ok: false, detail: String(error && error.message || error) });
  } finally {
    clearTimeout(stopTimer);
    client?.close();
    if (child && !child.killed) {
      child.kill("SIGTERM");
      await sleep(600);
      if (child.exitCode == null) child.kill("SIGKILL");
    }
    report.bobInvocations = report.bobInvocations || parseBobLog(path.join(profileDir, "bob-invocations.jsonl"));
    report.finishedAt = new Date().toISOString();
    report.scratchVaultRemoved = true;
    fs.rmSync(scratch, { recursive: true, force: true });
    if (args.report) {
      fs.mkdirSync(path.dirname(path.resolve(args.report)), { recursive: true });
      fs.writeFileSync(args.report, JSON.stringify(report, null, 2) + "\n");
    }
  }
  process.stdout.write(`${report.pass ? "PASS" : "FAIL"} Projects UI e2e (${report.checks.length} checks, ${(report.failures || []).length} failed)\n`);
  if (!report.pass) {
    for (const check of report.checks.filter((row) => !row.ok)) process.stderr.write(`- ${check.name}: ${check.detail}\n`);
    process.exitCode = 1;
  }
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) { process.stdout.write(`${HELP_TEXT}\n`); return; }
  if (args.selfTest) { selfTest(); return; }
  await run(args);
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  process.exit(Number.isInteger(error.exitCode) ? error.exitCode : 1);
});

