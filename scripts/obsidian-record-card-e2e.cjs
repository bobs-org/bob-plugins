#!/usr/bin/env node
// Real-Obsidian Record Card sheet and native Properties acceptance.
// Uses a disposable Git vault/profile and the supplied current bob binary.
// Never opens the live vault. Full scope also exercises guarded Record Card workflows.
"use strict";

const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const lib = require("./obsidian-record-card-e2e-lib.cjs");
const workflows = require("./obsidian-record-card-workflows.cjs");
const workflowProof = require("./obsidian-record-card-workflow-lib.cjs");
const repoRoot = path.resolve(__dirname, "..");
const OVERALL_TIMEOUT_MS = 600_000;
const ELECTRON_FALLBACK = "/snap/obsidian/current/app/obsidian";
const HIDE_CLASS = "bob-record-sheet-hides-properties";
const SHEET_CLASS = ".bob-record-sheet";
const FIXTURE_TODAY = "2026-11-18";

function fail(message, code = 1) {
  const error = new Error(message);
  error.exitCode = code;
  throw error;
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function hashSourceTree(root) {
  const rows = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) rows.push([
        path.relative(root, file).split(path.sep).join("/"),
        crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
      ]);
    }
  };
  walk(root);
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  return crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

function findBobProvenance({ env = process.env, execute = spawnSync } = {}) {
  const bob = env.BOB_BIN;
  const cliDir = env.BOB_CLI_DIR;
  if (!bob) fail("Set BOB_BIN to the exact bob binary built from this bob-cli checkout.", 2);
  if (!cliDir) fail("Set BOB_CLI_DIR to the checkout that built BOB_BIN.", 2);
  const resolvedBob = fs.realpathSync(bob);
  const resolvedCli = fs.realpathSync(cliDir);
  const metadata = execute("cargo", [
    "metadata", "--format-version", "1", "--no-deps", "--manifest-path", path.join(resolvedCli, "Cargo.toml"),
  ], { env, encoding: "utf8", timeout: 20_000 });
  if (metadata.status !== 0) fail("Could not inspect bob-cli target directory: " + (metadata.stderr || metadata.stdout));
  let target = "";
  try { target = JSON.parse(metadata.stdout).target_directory || ""; } catch (_) {}
  if (!target) fail("cargo metadata returned no target directory for BOB_CLI_DIR.");
  const expected = fs.realpathSync(path.join(target, "debug", "bob"));
  if (resolvedBob !== expected) fail("BOB_BIN must be the explicit debug binary at " + expected + "; got " + resolvedBob + ".", 2);
  const sha = execute("git", ["-C", resolvedCli, "rev-parse", "HEAD"], { env, encoding: "utf8", timeout: 10_000 });
  if (sha.status !== 0) fail("Could not read bob-cli source SHA: " + sha.stderr);
  const dirty = execute("git", ["-C", resolvedCli, "status", "--porcelain"], { env, encoding: "utf8", timeout: 10_000 });
  if (dirty.status !== 0) fail("Could not inspect bob-cli source status.");
  const sourceSha = String(sha.stdout || "").trim();
  const binarySha256 = sha256File(resolvedBob);
  let sourcePatch = null;
  if (env.BOB_CLI_PROVENANCE) {
    // A transported patch is admissible only when the build coordinator supplies
    // a separately pinned manifest binding the base, full diff and exact binary.
    // No generic allow-dirty switch: every source delta must match those bytes.
    const manifestBytes = fs.readFileSync(env.BOB_CLI_PROVENANCE);
    const manifestSha256 = crypto.createHash("sha256").update(manifestBytes).digest("hex");
    if (manifestSha256 !== env.BOB_CLI_PROVENANCE_SHA256) fail("CLI provenance manifest hash mismatch.");
    const manifest = JSON.parse(manifestBytes);
    if (manifest.schema_version !== 1 || !/^[0-9a-f]{40}$/.test(manifest.sourceSha) ||
        !/^[0-9a-f]{64}$/.test(manifest.sourcePatchSha256) || !/^[0-9a-f]{64}$/.test(manifest.binarySha256)) {
      fail("Invalid CLI provenance manifest.");
    }
    if (manifest.sourceSha !== sourceSha) fail("CLI provenance source SHA mismatch.");
    if (manifest.binarySha256 !== binarySha256) fail("CLI provenance binary hash mismatch.");
    const untracked = execute("git", ["-C", resolvedCli, "ls-files", "--others", "--exclude-standard", "-z"],
      { env, timeout: 10_000 });
    if (untracked.status !== 0 || untracked.stdout.length) fail("CLI provenance requires no untracked source inputs.");
    const diff = execute("git", ["-C", resolvedCli, "diff", "--binary", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", "HEAD"],
      { env, timeout: 10_000, maxBuffer: 32 * 1024 * 1024 });
    if (diff.status !== 0) fail("Could not inspect CLI source patch.");
    const patchSha256 = crypto.createHash("sha256").update(diff.stdout).digest("hex");
    if (manifest.sourcePatchSha256 !== patchSha256) fail("CLI provenance source patch hash mismatch.");
    sourcePatch = { manifestSha256, sha256: patchSha256, bytes: diff.stdout.length };
  } else if (String(dirty.stdout || "").trim() || env.BOB_CLI_PROVENANCE_SHA256) {
    fail("BOB_CLI_DIR must be clean or have a pinned BOB_CLI_PROVENANCE manifest.");
  }
  const version = execute(resolvedBob, ["--version"], { env, encoding: "utf8", timeout: 15_000 });
  if (version.status !== 0) fail("BOB_BIN --version failed: " + (version.stderr || version.stdout));
  return {
    path: resolvedBob,
    sha256: binarySha256,
    version: String(version.stdout || "").trim(),
    checkout: resolvedCli,
    sourceSha,
    sourcePatch,
  };
}

function bobEnv(vaultDir, profileDir, shimDir) {
  return {
    ...process.env,
    HOME: profileDir,
    BOB_DIR: vaultDir,
    BOB_NOW: FIXTURE_TODAY + " 12:00:00",
    BOB_CONFIG_FILE: path.join(profileDir, "missing-test-config.yml"),
    BOB_RECORD_CARD_E2E_LOG: path.join(profileDir, "bob-invocations.jsonl"),
    BOB_RECORD_CARD_E2E_REAL: process.env.BOB_BIN || "",
    PATH: shimDir + path.delimiter + (process.env.PATH || ""),
    NO_COLOR: "1",
  };
}

function runBob(bob, args, vaultDir, profileDir) {
  const result = spawnSync(bob.path, args, {
    cwd: vaultDir,
    encoding: "utf8",
    timeout: 90_000,
    maxBuffer: 32 * 1024 * 1024,
    env: bobEnv(vaultDir, profileDir, path.join(profileDir, "shim")),
  });
  if (result.error) throw result.error;
  let payload = null;
  try { payload = JSON.parse(String(result.stdout || "")); } catch (_) {}
  return {
    args,
    exitCode: result.status,
    signal: result.signal || null,
    stderr: String(result.stderr || "").slice(0, 1200),
    report: payload,
  };
}

function writeBobShim(shimDir) {
  fs.mkdirSync(shimDir, { recursive: true });
  const file = path.join(shimDir, "bob");
  fs.writeFileSync(file, `#!/usr/bin/env node
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
const hasStdin = args.some((arg, i) => (arg === '-i' || arg === '--input') && args[i+1] === '-');
const input = hasStdin ? fs.readFileSync(0, 'utf8') : undefined;
const entry = { event: 'start', pid: process.pid, at: new Date().toISOString(), args, input };
try { fs.appendFileSync(process.env.BOB_RECORD_CARD_E2E_LOG, JSON.stringify(entry) + "\\n"); } catch (_) {}
const result = spawnSync(process.env.BOB_RECORD_CARD_E2E_REAL, args, {
  encoding: "utf8", env: process.env, input, timeout: 90000, maxBuffer: 32 * 1024 * 1024,
});
try { fs.appendFileSync(process.env.BOB_RECORD_CARD_E2E_LOG, JSON.stringify({event:'finish',pid:process.pid,args,exitCode:result.status,stdout:result.stdout,stderr:result.stderr}) + "\\n"); } catch (_) {}
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status == null ? 1 : result.status);
`);
  fs.chmodSync(file, 0o755);
  return file;
}

function writeNote(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function copyPlugin(vaultDir, scope) {
  const source = path.join(repoRoot, "plugins", "bob-ledger-tools");
  const target = path.join(vaultDir, ".obsidian", "plugins", "bob-ledger-tools");
  fs.mkdirSync(target, { recursive: true });
  for (const name of ["manifest.json", "main.js", "styles.css"]) fs.copyFileSync(path.join(source, name), path.join(target, name));
  const ids = ["bob-ledger-tools"];
  if (scope === "full") {
    for (const id of ["bob-navigation-hotkeys", "bob-command-mode"]) {
      const dest = path.join(vaultDir, ".obsidian", "plugins", id);
      fs.mkdirSync(dest, { recursive: true });
      for (const name of ["manifest.json", "main.js", "styles.css"]) {
        const file = path.join(repoRoot, "plugins", id, name);
        if (fs.existsSync(file)) fs.copyFileSync(file, path.join(dest, name));
      }
      ids.push(id);
    }
    fs.writeFileSync(path.join(vaultDir, ".obsidian", "hotkeys.json"), JSON.stringify({
      "bob-navigation-hotkeys:set-bullet-property": [{ modifiers: ["Ctrl", "Shift"], key: "P" }],
      "command-palette:open": [{ modifiers: ["Ctrl"], key: "P" }],
    }));
  }
  fs.writeFileSync(path.join(vaultDir, ".obsidian", "community-plugins.json"), JSON.stringify(ids, null, 2));
  fs.writeFileSync(path.join(vaultDir, ".obsidian", "app.json"), JSON.stringify({
    livePreview: true,
    showLineNumber: false,
    showInlineTitle: true,
    propertiesInDocument: "visible",
    vimMode: scope === "full",
  }, null, 2));
  fs.writeFileSync(path.join(vaultDir, ".obsidian", "appearance.json"), JSON.stringify({
    cssTheme: "",
    theme: "moonstone",
  }, null, 2));
  fs.writeFileSync(path.join(target, "data.json"), JSON.stringify({ albumChips: true }, null, 2));
}

function initScratchGit(vaultDir) {
  const run = (args, cwd = vaultDir) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 20_000 });
    if (result.status !== 0) throw new Error("git " + args.join(" ") + " failed: " + (result.stderr || result.stdout));
  };
  const origin = vaultDir + ".origin.git";
  run(["init", "-q", "--bare", origin], os.tmpdir());
  run(["--git-dir", origin, "symbolic-ref", "HEAD", "refs/heads/master"], os.tmpdir());
  run(["init", "-q"]);
  run(["symbolic-ref", "HEAD", "refs/heads/master"]);
  run(["config", "user.email", "record-card-e2e@example.com"]);
  run(["config", "user.name", "Record Card E2E"]);
  run(["remote", "add", "origin", origin]);
  run(["add", "."]);
  run(["commit", "-q", "-m", "record card acceptance fixtures"]);
  run(["push", "-q", "-u", "origin", "master"]);
}

function markdownFilesHash(root) {
  const rows = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === ".obsidian") continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && entry.name.endsWith(".md")) {
        rows.push([path.relative(root, file).split(path.sep).join("/"), sha256File(file)]);
      }
    }
  };
  walk(root);
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  return crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

function seedProfile(profileDir, vaultDir) {
  fs.mkdirSync(profileDir, { recursive: true });
  const key = crypto.randomBytes(8).toString("hex");
  fs.writeFileSync(path.join(profileDir, "obsidian.json"), JSON.stringify({
    vaults: { [key]: { path: vaultDir, ts: Date.now(), open: true } },
  }, null, 2));
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
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + " timed out after " + ms + " ms")), ms); }),
    ]);
  } finally { clearTimeout(timer); }
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.closed = false;
    socket.addEventListener("message", (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch (_) { return; }
      if (message.method) {
        for (const handler of this.listeners.get(message.method) || []) handler(message.params || {});
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else pending.resolve(message.result || {});
    });
    socket.addEventListener("close", () => {
      this.closed = true;
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error("CDP socket closed"));
        this.pending.delete(id);
      }
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
  on(method, handler) {
    const list = this.listeners.get(method) || [];
    list.push(handler);
    this.listeners.set(method, list);
  }
  call(method, params = {}, timeoutMs = 15_000) {
    if (this.closed) return Promise.reject(new Error(method + ": CDP socket closed"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(method + " timed out")); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  async evaluate(expression, timeoutMs = 15_000) {
    const result = await this.call("Runtime.evaluate", {
      expression, awaitPromise: true, returnByValue: true, userGesture: true,
    }, timeoutMs);
    if (result.exceptionDetails) {
      const details = result.exceptionDetails;
      const reason = details.exception?.description || details.text || "CDP evaluate failed";
      throw new Error(reason + " (" + JSON.stringify({
        lineNumber: details.lineNumber ?? null,
        columnNumber: details.columnNumber ?? null,
        url: details.url || "",
        expression,
      }) + ")");
    }
    return result.result?.value;
  }
  close() { try { this.socket.close(); } catch (_) {} }
}

async function selectTarget(port, vaultPath, alive) {
  const deadline = Date.now() + 30_000;
  let last = "";
  while (Date.now() < deadline) {
    if (alive && !alive()) throw new Error("Obsidian exited before opening the scratch vault");
    try {
      const response = await fetch("http://127.0.0.1:" + port + "/json/list");
      const targets = response.ok ? await response.json() : [];
      for (const page of targets.filter((item) => item.type === "page" && item.webSocketDebuggerUrl)) {
        let candidate;
        let matched = false;
        try {
          candidate = await CdpClient.connect(page.webSocketDebuggerUrl);
          const base = await candidate.evaluate("window.app?.vault?.adapter?.basePath || null");
          matched = Boolean(base && path.resolve(base) === path.resolve(vaultPath));
          if (matched) return { page, client: candidate };
        } catch (error) { last = error.message; }
        finally { if (candidate && !matched) candidate.close(); }
      }
    } catch (error) { last = error.message; }
    await sleep(300);
  }
  throw new Error("No CDP page belongs to the scratch vault" + (last ? ": " + last : ""));
}

function probeSource(notePath) {
  const quotedPath = JSON.stringify(notePath);
  return `(() => {
    const path = ${quotedPath};
    const plugin = window.app?.plugins?.plugins?.["bob-ledger-tools"];
    const leaf = (window.app?.workspace?.getLeavesOfType?.("markdown") || []).find((item) => item.view?.file?.path === path);
    const view = leaf?.view;
    const container = view?.containerEl || view?.contentEl || null;
    const sourceRoot = view?.sourceMode?.containerEl || container;
    const previewRoot = view?.previewMode?.containerEl || container;
    const source = sourceRoot?.matches?.(".markdown-source-view") ? sourceRoot
      : sourceRoot?.querySelector?.(".markdown-source-view") || sourceRoot?.closest?.(".markdown-source-view") || null;
    const preview = previewRoot?.matches?.(".markdown-preview-view") ? previewRoot
      : previewRoot?.querySelector?.(".markdown-preview-view") || previewRoot?.closest?.(".markdown-preview-view") || null;
    const surface = (view?.getMode?.() === "preview" ? preview : source) || preview || source;
    const embedBoundary = surface?.closest?.(".markdown-embed, .internal-embed") || null;
    const belongs = (node) => {
      if (!surface?.contains?.(node)) return false;
      const boundary = node.closest?.(".markdown-embed, .internal-embed") || null;
      return boundary === embedBoundary;
    };
    const describePath = (node) => {
      const result = [];
      let current = node;
      for (let i = 0; current && i < 18; i += 1, current = current.parentElement) {
        const classes = typeof current.className === "string" ? current.className.split(/\\s+/).filter(Boolean) : [];
        result.push({ tag: String(current.tagName || "").toLowerCase(), classes });
        if (current === surface) break;
      }
      return result;
    };
    const describeNative = (selector, target = null) => {
      const node = target || Array.from(surface?.querySelectorAll?.(selector) || []).find(belongs) || null;
      if (!node) return { present: false };
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return {
        present: true,
        display: style.display,
        visibility: style.visibility,
        rectVisible: rect.width > 0 && rect.height > 0,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        path: describePath(node),
        className: String(node.className || ""),
        inlineStyle: node.getAttribute?.("style") || "",
        ancestors: (() => {
          const rows = [];
          for (let current = node; current && rows.length < 8; current = current.parentElement) {
            const currentStyle = getComputedStyle(current);
            rows.push({
              tag: String(current.tagName || "").toLowerCase(),
              className: String(current.className || ""),
              display: currentStyle.display,
              visibility: currentStyle.visibility,
              inlineStyle: current.getAttribute?.("style") || "",
              hidden: current.hidden === true,
            });
            if (current === surface) break;
          }
          return rows;
        })(),
      };
    };
    const sheet = Array.from(surface?.querySelectorAll?.(".bob-record-sheet") || [])
      .find((node) => node.getAttribute("data-record-source") === path && belongs(node)) || null;
    const editor = view?.editor?.cm?.dom || container?.querySelector?.(".cm-editor") || null;
    const readingScope = surface?.closest?.(".markdown-preview-view") || null;
    const scopeNodes = [surface, editor, readingScope]
      .filter((node, index, nodes) => node && nodes.indexOf(node) === index && node.classList?.contains("${HIDE_CLASS}"));
    const title = sheet?.querySelector?.(".bob-record-sheet-title, .bob-property-card-title") || null;
    const shown = (el) => {
      if (!el) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const leafContent = surface?.closest?.(".workspace-leaf-content") || surface;
    const authoredEmbedRoots = Array.from(surface?.querySelectorAll?.(".markdown-embed, .internal-embed") || []);
    const embeddedProperties = authoredEmbedRoots.flatMap((embed) =>
      Array.from(embed.querySelectorAll(".metadata-container")).map((node) => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return {
          present: true,
          display: style.display,
          visibility: style.visibility,
          rectVisible: rect.width > 0 && rect.height > 0,
          path: describePath(node),
          boundary: String(embed.className || ""),
          hideClassWithinEmbed: (() => {
            for (let current = node; current; current = current.parentElement) {
              if (current.classList?.contains("${HIDE_CLASS}")) return true;
              if (current === embed) break;
            }
            return false;
          })(),
          hideClassOutsideEmbed: Boolean(embed.parentElement?.closest?.(".${HIDE_CLASS}")),
          collapsed: node.classList?.contains("is-collapsed") === true,
        };
      }));
    const file = window.app?.vault?.getAbstractFileByPath?.(path);
    const frontmatter = window.app?.metadataCache?.getFileCache?.(file)?.frontmatter || {};
    const model = plugin?.recordSheetModelFor?.(path) || null;
    const coverage = model?.coverage || {};
    const authoredKeys = Object.keys(frontmatter).filter((key) => key !== "position");
    const missingCoverage = authoredKeys.filter((key) => !Object.prototype.hasOwnProperty.call(coverage, key));
    const duplicateCoverage = authoredKeys.filter((key) => !coverage[key]);
    const h1s = Array.from(surface?.querySelectorAll?.("h1, .cm-header-1") || []).filter(belongs);
    const titleStyle = title ? getComputedStyle(title) : null;
    const titleRect = title?.getBoundingClientRect?.();
    const tools = sheet?.querySelector?.(".bob-record-sheet-tools");
    const toolsRect = tools?.getBoundingClientRect?.();
    const sheetRect = sheet?.getBoundingClientRect?.();
    return {
      status: surface ? "pass" : "fail",
      path,
      mode: view?.getMode?.() || null,
      viewportWidth: window.innerWidth,
      activePath: window.app?.workspace?.getActiveFile?.()?.path || null,
      surfaceClasses: String(surface?.className || ""),
      surfacePath: surface ? describePath(surface) : [],
      editorClasses: String(editor?.className || ""),
      editorPath: editor ? describePath(editor) : [],
      readingScopeClasses: String(readingScope?.className || ""),
      readingScopePath: readingScope ? describePath(readingScope) : [],
      hideClassPresent: scopeNodes.length > 0,
      hideClassPaths: scopeNodes.map(describePath),
      properties: describeNative(".metadata-container"),
      addProperty: describeNative(".metadata-add-button"),
      propertyRows: Array.from(surface?.querySelectorAll?.(".metadata-property") || [])
        .filter(belongs).map((node) => ({ key: node.getAttribute("data-property-key"), ...describeNative("", node) })),
      schemaKeys: (model?.gate?.album?.fields || []).map((field) => field.key),
      titlePropertyInSheet: Boolean(String(frontmatter.title ?? "").trim()),
      inlineTitle: describeNative(".inline-title"),
      sheet: sheet ? {
        count: Array.from(surface.querySelectorAll(".bob-record-sheet")).filter((node) => node.getAttribute("data-record-source") === path && belongs(node)).length,
        kind: sheet.getAttribute("data-card-kind") || "",
        ariaLabel: sheet.getAttribute("aria-label") || "",
        inTitleSlot: Boolean(sheet.parentElement?.classList.contains("cm-sizer") || sheet.parentElement?.classList.contains("mod-header")),
        orderInTitleSlot: sheet.nextElementSibling?.classList.contains("metadata-container") ? "metadata-container"
          : String(sheet.nextElementSibling?.className || ""),
        levelOne: Array.from(leafContent?.querySelectorAll?.('[aria-level="1"]') || []).filter(shown).length,
        kicker: {
          species: sheet.querySelector(".bob-property-card-kicker-species")?.textContent?.replace(/\\s+/g, " ").trim() || "",
          album: sheet.querySelector(".bob-property-card-kicker-link")?.textContent?.replace(/\\s+/g, " ").trim() || "",
          href: sheet.querySelector(".bob-property-card-kicker-link")?.getAttribute("data-href") || "",
          noun: sheet.querySelector(".bob-property-card-kicker-part")?.textContent?.replace(/\\s+/g, " ").trim() || "",
        },
        tile: sheet.querySelector(".bob-property-card-tile")?.getAttribute("data-tile-form") || "",
        title: title?.textContent?.replace(/\\s+/g, " ").trim() || "",
        titleRole: title?.getAttribute("role") || null,
        titleLevel: title?.getAttribute("aria-level") || null,
        titleStyle: titleStyle ? {
          color: titleStyle.color, fontFamily: titleStyle.fontFamily, fontSize: titleStyle.fontSize,
          fontWeight: titleStyle.fontWeight, lineHeight: titleStyle.lineHeight,
        } : null,
        titleRect: titleRect ? { x: titleRect.x, y: titleRect.y, width: titleRect.width, height: titleRect.height } : null,
        toolsRect: toolsRect ? { x: toolsRect.x, y: toolsRect.y, width: toolsRect.width, height: toolsRect.height } : null,
        rect: sheetRect ? { x: sheetRect.x, y: sheetRect.y, width: sheetRect.width, height: sheetRect.height, clientWidth: sheet.clientWidth, scrollWidth: sheet.scrollWidth } : null,
        collapsed: Boolean(sheet.querySelector(".bob-record-sheet-summary")),
        footExpanded: sheet.querySelector(".bob-property-card-foot-disclosure")?.getAttribute("aria-expanded") || null,
        footCount: sheet.querySelector(".bob-property-card-foot-disclosure")?.textContent?.replace(/\s+/g, " ").trim() || "",
        warning: sheet.querySelector(".bob-record-sheet-warning")?.textContent?.replace(/\\s+/g, " ").trim() || "",
        rowKeys: Array.from(sheet.querySelectorAll("[data-record-key]")).map((node) => node.getAttribute("data-record-key")),
        bands: sheet.querySelectorAll('[data-bob-record-sheet-band="true"]').length,
        missingCount: sheet.querySelectorAll(".bob-record-sheet-missing").length,
        warningCount: sheet.querySelectorAll(".bob-record-sheet-warning").length,
        orderBeforeFirstHeading: (() => {
          const heading = Array.from(surface.querySelectorAll("h1, h2, .cm-header-1, .cm-header-2")).find(belongs);
          if (!heading) return true;
          return Boolean(sheet.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING);
        })(),
      } : null,
      h1Count: h1s.length,
      h1Text: h1s.map((node) => (node.textContent || "").replace(/\\s+/g, " ").trim()),
      embeddedProperties,
      authoredKeys,
      coverage,
      missingCoverage,
      duplicateCoverage,
      gate: plugin?.recordSheetGateFor?.(path) || null,
      capability: (() => {
        try {
          const report = plugin?.recordSheetState?.()?.report;
          return Array.isArray(report?.capabilities) ? report.capabilities : null;
        } catch (_) { return null; }
      })(),
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      sheetMotion: sheet ? {
        animationDuration: getComputedStyle(sheet).animationDuration,
        transitionDuration: getComputedStyle(sheet).transitionDuration,
      } : null,
      embedCount: authoredEmbedRoots.length,
    };
  })()`;
}

async function diagnoseNativeDom(client, notePath) {
  return client.evaluate(`(() => {
    const path = ${JSON.stringify(notePath)};
    const leaf = app.workspace.getLeavesOfType("markdown").find((item) => item.view?.file?.path === path);
    const view = leaf?.view;
    const container = view?.containerEl || view?.contentEl || null;
    const modeRoot = view?.getMode?.() === "preview" ? view?.previewMode?.containerEl || container : view?.sourceMode?.containerEl || container;
    const selector = view?.getMode?.() === "preview" ? ".markdown-preview-view" : ".markdown-source-view";
    const surface = (modeRoot?.matches?.(selector) ? modeRoot : modeRoot?.querySelector?.(selector) || modeRoot?.closest?.(selector)) || null;
    const nodes = Object.fromEntries([".metadata-container", ".inline-title"].map((selector) => {
      const node = surface?.querySelector?.(selector) || null;
      if (!node) return [selector, null];
      const style = getComputedStyle(node);
      const rules = [];
      const visit = (list, sheetName) => {
        for (const rule of Array.from(list || [])) {
          if (rule.selectorText && rule.style) {
            try {
              if (node.matches(rule.selectorText)) {
                const display = rule.style.getPropertyValue("display");
                const visibility = rule.style.getPropertyValue("visibility");
                if (display || visibility) rules.push({ sheet: sheetName, selector: rule.selectorText, display, visibility, cssText: rule.style.cssText });
              }
            } catch (_) {}
          }
          try { if (rule.cssRules) visit(rule.cssRules, sheetName); } catch (_) {}
        }
      };
      for (const sheet of Array.from(document.styleSheets || [])) {
        try { visit(sheet.cssRules, sheet.href || sheet.ownerNode?.id || "inline"); } catch (_) {}
      }
      return [selector, {
        display: style.display,
        visibility: style.visibility,
        attributes: Array.from(node.attributes || []).map((attr) => [attr.name, attr.value]),
        html: String(node.outerHTML || "").slice(0, 900),
        rules: rules.slice(-20),
      }];
    }));
    return {
      path,
      mode: view?.getMode?.() || null,
      bodyClasses: String(document.body?.className || ""),
      appSettings: { showInlineTitle: app.vault?.config?.showInlineTitle ?? null, propertiesInDocument: app.vault?.config?.propertiesInDocument ?? null },
      nodes,
    };
  })()`);
}

async function expandNativeProperties(client, notePath) {
  const result = await client.evaluate(`(() => {
    const path = ${JSON.stringify(notePath)};
    const leaf = app.workspace.getLeavesOfType("markdown").find((item) => item.view?.file?.path === path);
    const view = leaf?.view;
    const root = view?.previewMode?.containerEl || view?.containerEl || view?.contentEl;
    const properties = root?.matches?.(".metadata-container") ? root : root?.querySelector?.(".metadata-container") || null;
    if (!properties) return { present: false };
    const collapsed = properties.classList.contains("is-collapsed");
    const control = properties.querySelector(".metadata-properties-heading, .collapse-indicator")
      || properties.parentElement?.querySelector?.(".metadata-properties-heading, .collapse-indicator") || null;
    if (collapsed && control) control.click();
    return { present: true, collapsed, control: control ? String(control.className || control.tagName || "") : null };
  })()`);
  if (result.collapsed && !result.control) throw new Error("Native Properties are collapsed without a heading control: " + notePath);
  if (result.collapsed) {
    await waitFor(client, `(() => {
      const leaf = app.workspace.getLeavesOfType("markdown").find((item) => item.view?.file?.path === ${JSON.stringify(notePath)});
      const root = leaf?.view?.previewMode?.containerEl || leaf?.view?.containerEl || leaf?.view?.contentEl;
      const properties = root?.matches?.(".metadata-container") ? root : root?.querySelector?.(".metadata-container");
      return Boolean(properties && !properties.classList.contains("is-collapsed"));
    })()`, Boolean, "native Properties expansion for " + notePath);
  }
  return result;
}

async function waitFor(client, expression, predicate, label, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await client.evaluate(expression);
      if (predicate(last)) return last;
    } catch (error) { last = { error: error.message }; }
    await sleep(120);
  }
  throw new Error("Timed out waiting for " + label + ": " + JSON.stringify(last).slice(0, 1800));
}

async function trustCommunityPlugins(client) {
  return waitFor(client, `(() => {
    if (window.app?.plugins?.plugins?.["bob-ledger-tools"]) return "already-loaded";
    const trust = Array.from(document.querySelectorAll("button")).find((button) =>
      /Trust author and enable plugins/i.test(button.textContent || ""));
    if (!trust) return null;
    trust.click();
    return "trusted";
  })()`, Boolean, "community plugin trust or startup", 30_000);
}

async function openNote(client, notePath, mode = "live") {
  const state = mode === "reading" ? { mode: "preview", source: false }
    : mode === "source" ? { mode: "source", source: true }
      : { mode: "source", source: false };
  return client.evaluate(`(async () => {
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(notePath)});
    if (!file) return { ok: false, error: "missing " + ${JSON.stringify(notePath)} };
    const leaf = app.workspace.getLeaf(false);
    await leaf.openFile(file, { state: ${JSON.stringify(state)} });
    if (leaf.view?.setState) await leaf.view.setState(Object.assign({}, leaf.view.getState?.() || {}, ${JSON.stringify(state)}), { history: false });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise((resolve) => setTimeout(resolve, 450));
    return { ok: true, path: leaf.view?.file?.path || null, mode: leaf.view?.getMode?.() || null };
  })()`, 30_000);
}

async function capture(client, outDir, name, width, theme, mode) {
  const shot = await client.call("Page.captureScreenshot", { format: "png", fromSurface: true });
  const bytes = Buffer.from(shot.data, "base64");
  const file = path.join(outDir, name + ".png");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  return {
    name,
    path: file,
    bytes: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    requestedWidth: width,
    theme,
    mode,
    visualVerdict: "pending inspection",
  };
}

async function setViewport(client, width, height = 1000) {
  await client.call("Emulation.setDeviceMetricsOverride", {
    width, height, deviceScaleFactor: 1, mobile: false,
  });
  await client.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await sleep(180);
}

async function collapseSidebars(client) {
  return client.evaluate(`(() => {
    const workspace = app.workspace;
    const state = {
      leftCollapsed: Boolean(workspace.leftSplit?.collapsed),
      rightCollapsed: Boolean(workspace.rightSplit?.collapsed),
    };
    if (typeof workspace.leftSplit?.collapse !== "function" || typeof workspace.rightSplit?.collapse !== "function") {
      return { ok: false, reason: "workspace sidebar collapse API unavailable", state };
    }
    workspace.leftSplit.collapse();
    workspace.rightSplit.collapse();
    window.__bobRecordCardE2ESidebars = state;
    return { ok: true, state };
  })()`);
}

async function restoreSidebars(client) {
  return client.evaluate(`(() => {
    const workspace = app.workspace;
    const state = window.__bobRecordCardE2ESidebars || { leftCollapsed: false, rightCollapsed: false };
    if (!state.leftCollapsed) workspace.leftSplit?.expand?.();
    if (!state.rightCollapsed) workspace.rightSplit?.expand?.();
    delete window.__bobRecordCardE2ESidebars;
    return { leftCollapsed: Boolean(workspace.leftSplit?.collapsed), rightCollapsed: Boolean(workspace.rightSplit?.collapsed) };
  })()`);
}

async function expandEmbeddedProperties(client) {
  const start = await client.evaluate(`(() => {
    const embed = Array.from(document.querySelectorAll(".markdown-embed, .internal-embed"))
      .find((node) => node.querySelector(".metadata-container"));
    const properties = embed?.querySelector(".metadata-container") || null;
    if (!properties) return { present: false };
    const collapsed = properties.classList.contains("is-collapsed");
    const control = properties.querySelector(".metadata-properties-heading, .collapse-indicator");
    if (collapsed && control) control.click();
    return {
      present: true,
      collapsed,
      control: control ? { tag: control.tagName, className: String(control.className || ""), text: String(control.textContent || "").trim() } : null,
    };
  })()`);
  if (!start.present) throw new Error("Embedded native Properties container was not found");
  if (start.collapsed && !start.control) throw new Error("Embedded native Properties are collapsed without a heading control");
  if (start.collapsed) {
    await waitFor(client, `(() => {
      const embed = Array.from(document.querySelectorAll(".markdown-embed, .internal-embed"))
        .find((node) => node.querySelector(".metadata-container"));
      const properties = embed?.querySelector(".metadata-container");
      return Boolean(properties && !properties.classList.contains("is-collapsed"));
    })()`, Boolean, "embedded native Properties expansion");
  }
  return start;
}

async function setTheme(client, theme) {
  const className = theme === "dark" ? "theme-dark" : "theme-light";
  const literal = JSON.stringify(className);
  const changed = await client.evaluate("document.body.classList.remove(\"theme-light\", \"theme-dark\"); " +
    "document.body.classList.add(" + literal + "); document.body.classList.contains(" + literal + ")");
  if (changed !== true) throw new Error("Could not apply Obsidian theme " + theme);
  await sleep(100);
}
async function clickBy(client, selector) {
  const point = await client.evaluate(`(() => {
    window.__bobRecordCardE2EClicks = [];
    if (!window.__bobRecordCardE2EClickListener) {
      document.addEventListener("click", (event) => {
        const target = event.target;
        window.__bobRecordCardE2EClicks.push({
          trusted: event.isTrusted,
          target: target ? { tag: target.tagName, className: String(target.className || ""), text: String(target.textContent || "").trim().slice(0, 80) } : null,
          button: event.button,
        });
      }, true);
      window.__bobRecordCardE2EClickListener = true;
    }
    const activePath = app.workspace.getActiveFile?.()?.path || null;
    const leaf = app.workspace.getLeavesOfType("markdown").find((item) =>
      item.view?.file?.path === activePath);
    const editor = leaf?.view?.editor?.cm?.dom || null;
    const all = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
    const matches = editor ? all.filter((node) => editor.contains(node)) : [];
    const el = matches.find((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && !node.disabled;
    });
    if (!el) return {
      ok: false,
      selector: ${JSON.stringify(selector)},
      activePath,
      mode: leaf?.view?.getMode?.() || null,
      editorPath: editor ? [editor.className, editor.parentElement?.className || ""] : [],
      documentMatches: all.length,
      editorMatches: matches.length,
    };
    el.scrollIntoView({ block: "center", inline: "nearest" });
    const rect = el.getBoundingClientRect();
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      ok: true,
      x,
      y,
      activePath,
      mode: leaf?.view?.getMode?.() || null,
      editorPath: [editor.className, editor.parentElement?.className || ""],
      targetPath: [el.className || el.tagName, el.parentElement?.className || ""],
      targetPointerEvents: getComputedStyle(el).pointerEvents,
      initialExpanded: el.getAttribute?.("aria-expanded") || null,
      hitTest: hit ? { tag: hit.tagName, className: String(hit.className || ""), text: String(hit.textContent || "").trim().slice(0, 80) } : null,
    };
  })()`);
  if (!point.ok) throw new Error("Visible control not found in active editor: " + JSON.stringify(point));
  await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await client.call("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 });
  await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1 });
  await sleep(250);
  let after = await client.evaluate(`(() => {
    const activePath = app.workspace.getActiveFile?.()?.path || null;
    const leaf = app.workspace.getLeavesOfType("markdown").find((item) => item.view?.file?.path === activePath);
    const editor = leaf?.view?.editor?.cm?.dom || null;
    const el = Array.from(editor?.querySelectorAll?.(${JSON.stringify(selector)} ) || [])[0] || null;
    return {
      activePath,
      mode: leaf?.view?.getMode?.() || null,
      matchCount: editor?.querySelectorAll?.(${JSON.stringify(selector)}).length || 0,
      expanded: el?.getAttribute?.("aria-expanded") || null,
      connected: Boolean(el?.isConnected),
      clicks: window.__bobRecordCardE2EClicks || [],
    };
  })()`);
  if (point.initialExpanded !== null && after.expanded === point.initialExpanded) {
    const fallback = await client.evaluate(`(() => {
      const activePath = app.workspace.getActiveFile?.()?.path || null;
      const leaf = app.workspace.getLeavesOfType("markdown").find((item) => item.view?.file?.path === activePath);
      const editor = leaf?.view?.editor?.cm?.dom || null;
      const el = Array.from(editor?.querySelectorAll?.(${JSON.stringify(selector)} ) || [])[0] || null;
      if (!el) return false;
      el.click();
      return true;
    })()`);
    if (fallback) {
      await sleep(250);
      after = await client.evaluate(`(() => {
        const activePath = app.workspace.getActiveFile?.()?.path || null;
        const leaf = app.workspace.getLeavesOfType("markdown").find((item) => item.view?.file?.path === activePath);
        const editor = leaf?.view?.editor?.cm?.dom || null;
        const el = Array.from(editor?.querySelectorAll?.(${JSON.stringify(selector)} ) || [])[0] || null;
        return {
          activePath,
          mode: leaf?.view?.getMode?.() || null,
          matchCount: editor?.querySelectorAll?.(${JSON.stringify(selector)}).length || 0,
          expanded: el?.getAttribute?.("aria-expanded") || null,
          connected: Boolean(el?.isConnected),
          fallback: "DOM click after pointer miss",
          clicks: window.__bobRecordCardE2EClicks || [],
        };
      })()`);
    }
  }
  return { target: point, after };
}

async function hoverBy(client, selector) {
  const result = await client.evaluate(`(() => {
    const el = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    if (!el) return { ok: false, selector: ${JSON.stringify(selector)}, activePath: app.workspace.getActiveFile?.()?.path || null };
    el.scrollIntoView({ block: "center", inline: "nearest" });
    const rect = el.getBoundingClientRect();
    const linktext = String(el.getAttribute("data-href") || el.getAttribute("href") || "");
    const sourcePath = app.workspace.getActiveFile?.()?.path || "";
    const event = new MouseEvent("mouseover", {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + Math.min(8, Math.max(1, rect.width / 2)),
      clientY: rect.top + Math.min(8, Math.max(1, rect.height / 2)),
    });
    app.workspace.trigger("hover-link", {
      event,
      source: "preview",
      hoverParent: el,
      targetEl: el,
      linktext,
      sourcePath,
    });
    return {
      ok: true,
      tag: el.tagName,
      className: String(el.className || ""),
      text: String(el.textContent || "").trim(),
      linktext,
      sourcePath,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  })()`);
  if (!result.ok) throw new Error("Hover link not found: " + JSON.stringify(result));
  await sleep(350);
  return result;
}

function writeAssertion(report, name, status, detail, mandatory = true) {
  report.assertions.push({
    name,
    status,
    mandatory: Boolean(mandatory),
    detail: typeof detail === "string" ? detail : JSON.stringify(detail),
  });
}

function expectVisibility(report, name, probe, expected) {
  const vis = expected && typeof expected === "object"
    ? expected
    : { titleOwned: expected === true, rowsHidden: expected === true };
  try {
    lib.assertNativeVisibility(probe, vis);
    writeAssertion(report, name, "pass", {
      ...vis, properties: probe.properties, propertyRows: probe.propertyRows,
      schemaKeys: probe.schemaKeys, inlineTitle: probe.inlineTitle,
    });
  } catch (error) {
    writeAssertion(report, name, "fail", error.message);
  }
}

function fixtureEnv(vaultDir, profileDir, shimDir) {
  return bobEnv(vaultDir, profileDir, shimDir);
}

function appendCapturedCheck(report, name, ok, detail, mandatory = true) {
  writeAssertion(report, name, ok ? "pass" : "fail", detail, mandatory);
}

async function run(args) {
  const report = {
    pass: false,
    scope: args.scope,
    startedAt: new Date().toISOString(),
    pluginSource: {
      head: process.env.BOB_PLUGIN_SOURCE_SHA || null,
      sourceTreeSha256: hashSourceTree(repoRoot),
      version: (() => {
        try { return JSON.parse(fs.readFileSync(path.join(repoRoot, "plugins/bob-ledger-tools/manifest.json"), "utf8")).version; }
        catch (_) { return null; }
      })(),
    },
    assertions: [],
    screenshots: [],
    consoleExceptions: [],
    bobRuns: [],
    prerequisites: [],
    probes: {},
    noteSafety: {},
  };
  const outDir = path.resolve(args.out || path.join(os.tmpdir(), "bob-record-card-e2e-shots-" + crypto.randomBytes(4).toString("hex")));
  const reportPath = path.resolve(args.report || path.join(outDir, "record-card-report.json"));
  report.reportPath = reportPath;
  report.screenshotDirectory = outDir;
  let scratch = "";
  let vaultDir = "";
  let child = null;
  let client = null;
  let successful = false;

  try {
    fs.mkdirSync(outDir, { recursive: true });
    let bob;
    try {
      bob = findBobProvenance();
      report.bob = bob;
      report.prerequisites.push({ name: "explicit-current-bob-binary", status: "pass", detail: bob });
    } catch (error) {
      report.prerequisites.push({ name: "explicit-current-bob-binary", status: "fail", detail: error.message });
      throw error;
    }

    const executable = args.executable || process.env.OBSIDIAN_BIN || ELECTRON_FALLBACK;
    report.executable = executable;
    try {
      fs.accessSync(executable, fs.constants.X_OK);
      const help = spawnSync(executable, ["--help"], { encoding: "utf8", timeout: 20_000 });
      if (/unable to find Obsidian/i.test(String(help.stdout || "") + String(help.stderr || ""))) {
        throw new Error("This is the Obsidian CLI shim, not the Electron application.");
      }
      report.prerequisites.push({ name: "Obsidian-Electron-and-Xvfb-host", status: "pass", detail: { executable, platform: process.platform, display: process.env.DISPLAY || "" } });
    } catch (error) {
      report.prerequisites.push({ name: "Obsidian-Electron-and-Xvfb-host", status: "fail", detail: error.message });
      throw error;
    }

    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "bob-record-card-e2e-"));
    vaultDir = path.join(scratch, "vault");
    const profileDir = path.join(scratch, "profile");
    const shimDir = path.join(profileDir, "shim");
    fs.mkdirSync(vaultDir, { recursive: true });
    const notes = lib.fixtureNotes();
    for (const [name, content] of Object.entries(notes)) writeNote(vaultDir, name, content);
    copyPlugin(vaultDir, args.scope);
    writeBobShim(shimDir);
    initScratchGit(vaultDir);
    const vaultReal = fs.realpathSync(vaultDir);
    seedProfile(profileDir, vaultReal);
    report.scratch = {
      root: scratch,
      vault: vaultReal,
      profile: profileDir,
      fixtureMarkdownCount: Object.keys(notes).length,
      fixturePaths: Object.keys(notes).sort(),
      gitOrigin: vaultDir + ".origin.git",
    };

    const sync = runBob(bob, ["albums", "sync", "-f", "json"], vaultDir, profileDir);
    report.bobRuns.push(sync);
    if (!lib.isExpectedFixtureAlbumSync(sync)) {
      throw new Error("Current bob albums sync did not match the expected fixture findings: " + JSON.stringify(sync));
    }
    const listed = runBob(bob, ["albums", "list", "-f", "json"], vaultDir, profileDir);
    report.bobRuns.push(listed);
    if (!lib.isExpectedFixtureAlbumList(listed)) {
      throw new Error("Current bob albums list did not match the expected fixture findings: " + JSON.stringify(listed));
    }
    const capability = listed.report?.capabilities;
    if (!Array.isArray(capability) || !capability.includes("record_values_v1")) {
      throw new Error("The supplied bob binary lacks record_values_v1; refusing to fall back: " + JSON.stringify(capability));
    }
    report.prerequisites.push({ name: "real-bob-album-report-and-record_values_v1", status: "pass", detail: { sourceSha: bob.sourceSha, binarySha256: bob.sha256, version: bob.version, capabilities: capability } });
    report.noteSafety.beforeUi = markdownFilesHash(vaultDir);
    const port = await freePort();
    report.debugPort = port;
    const profile = profileDir;
    child = spawn(executable, [
      "--no-sandbox",
      "--user-data-dir=" + profile,
      "--remote-debugging-port=" + port,
      "--remote-allow-origins=http://127.0.0.1/*",
      vaultReal,
    ], {
      cwd: os.tmpdir(),
      env: { ...fixtureEnv(vaultDir, profileDir, shimDir), TMPDIR: "/tmp" },
      stdio: ["ignore", "ignore", "pipe"],
    });
    const childErrors = [];
    child.stderr.on("data", (chunk) => childErrors.push(String(chunk).slice(0, 1000)));
    report.obsidianProcess = { pid: child.pid, executable };
    const target = await selectTarget(port, vaultReal, () => child && child.exitCode == null);
    client = target.client;
    client.on("Runtime.exceptionThrown", (params) => {
      const details = params.exceptionDetails || {};
      report.consoleExceptions.push({
        text: details.text || "",
        description: details.exception?.description || "",
        url: details.url || "",
        lineNumber: details.lineNumber || null,
      });
    });
    await client.call("Runtime.enable");
    await client.call("Log.enable");
    client.on("Log.entryAdded", (params) => {
      if (params.entry?.level === "error") report.consoleExceptions.push({
        text: params.entry.text || "",
        url: params.entry.url || "",
        lineNumber: params.entry.lineNumber || null,
        source: "console",
      });
    });
    const trust = await trustCommunityPlugins(client);
    report.pluginStartup = { trustAction: trust, startupStderr: childErrors.slice(-12) };

    const probe = async (notePath) => client.evaluate(probeSource(notePath));
    const open = async (notePath, mode = "live") => {
      const opened = await openNote(client, notePath, mode);
      if (!opened.ok) throw new Error("Could not open " + notePath + ": " + JSON.stringify(opened));
      if (mode !== "source") await expandNativeProperties(client, notePath);
      return opened;
    };
    const waitSheet = async (notePath) => waitFor(client, probeSource(notePath), (value) =>
      value && value.sheet && value.sheet.count === 1 && !value.gate?.stale,
    "record sheet for " + notePath);
    const waitNoSheet = async (notePath) => waitFor(client, probeSource(notePath), (value) =>
      value && value.status === "pass" && (!value.sheet || value.sheet.count === 0),
    "no record sheet for " + notePath);
    const checkPositive = (name, state, options = {}) => {
      appendCapturedCheck(report, name + "-sheet-mounts-once", Boolean(state.sheet && state.sheet.count === 1), state);
      appendCapturedCheck(report, name + "-sheet-title-role-and-text",
        state.sheet?.titleRole === "heading" && state.sheet?.titleLevel === "1" && state.sheet?.title === options.title,
        { title: state.sheet?.title, role: state.sheet?.titleRole, level: state.sheet?.titleLevel, expected: options.title });
      expectVisibility(report, name + "-title-owned-and-schema-rows-hidden", state, { titleOwned: true, rowsHidden: true });
      appendCapturedCheck(report, name + "-coverage-each-frontmatter-key-once",
        state.missingCoverage?.length === 0 && state.duplicateCoverage?.length === 0,
        { authoredKeys: state.authoredKeys, coverage: state.coverage, missing: state.missingCoverage, duplicates: state.duplicateCoverage });
      appendCapturedCheck(report, name + "-card-in-title-slot",
        state.sheet?.inTitleSlot === true && state.sheet?.orderInTitleSlot === "metadata-container", state.sheet);
      appendCapturedCheck(report, name + "-accessible-name", state.sheet?.ariaLabel === `Record: ${options.title}`, state.sheet);
      appendCapturedCheck(report, name + "-one-level-one-heading", state.sheet?.levelOne === 1, state.sheet);
      appendCapturedCheck(report, name + "-kind-tile-kicker",
        state.sheet?.kind === "record" && state.sheet?.tile === "sheet"
          && state.sheet?.kicker?.species === "Record" && Boolean(state.sheet?.kicker?.album),
        state.sheet);
      if (options.h1Count !== undefined) appendCapturedCheck(report, name + "-authored-h1-transition", state.h1Count === options.h1Count, { count: state.h1Count, text: state.h1Text });
      return state;
    };

    const loadedPlugin = await waitFor(client, "Boolean(window.app?.plugins?.plugins?.['bob-ledger-tools'])", Boolean, "ledger-tools plugin startup", 30_000);
    appendCapturedCheck(report, "ledger-tools-plugin-loaded", Boolean(loadedPlugin), {
      enabled: await client.evaluate("Array.from(window.app?.plugins?.enabledPlugins || [])"),
      manifest: await client.evaluate("window.app?.plugins?.manifests?.['bob-ledger-tools'] || null"),
      pluginKeys: await client.evaluate("Object.keys(window.app?.plugins?.plugins || {})"),
    });
    const appProbe = await client.evaluate("(() => ({ version: app.version || '', plugin: Boolean(app.plugins.plugins['bob-ledger-tools']), inlineTitleSetting: app.vault.config?.showInlineTitle ?? null, propertiesSetting: app.vault.config?.propertiesInDocument ?? null }))()");
    report.obsidian = appProbe;

    await open("ordinary.md", "reading");
    report.probes.ordinaryNativeBaseline = await diagnoseNativeDom(client, "ordinary.md");

    await open("zettels/bead_lifecycle.md", "live");
    let state = await waitSheet("zettels/bead_lifecycle.md");
    report.probes.liveLight = state;
    checkPositive("zettel-live-preview", state, { title: "Bead Lifecycle", h1Count: 0 });
    const configuredApp = JSON.parse(fs.readFileSync(path.join(vaultDir, ".obsidian", "app.json"), "utf8"));
    appendCapturedCheck(report, "native-inline-title-and-properties-initially-enabled",
      configuredApp.showInlineTitle === true && configuredApp.propertiesInDocument === "visible",
      { configuredApp, DOMInlineTitlePresent: state.inlineTitle.present, DOMPropertiesPresent: state.properties.present });
    appendCapturedCheck(report, "sheet-theme-title-style-present",
      Boolean(state.sheet?.titleStyle?.fontFamily && state.sheet?.titleStyle?.fontSize && state.sheet?.titleStyle?.fontWeight),
      state.sheet?.titleStyle);
    const join = await client.evaluate(`(() => (async () => {
      const plugin = window.app.plugins.plugins["bob-ledger-tools"];
      const view = window.app.workspace.activeLeaf.view;
      const surface = view.containerEl.querySelector(".markdown-source-view");
      const settle = () => new Promise((resolve) => setTimeout(resolve, 450));
      const card = () => surface.querySelector(".bob-record-sheet");
      const snapshot = (node) => ({
        body: node?.getAttribute("data-record-body") || null,
        slot: node?.parentElement?.className || "",
        title: node?.querySelector(".bob-property-card-title")?.textContent || "",
        edit: Boolean(node?.querySelector(".bob-record-sheet-edit")),
      });
      const real = plugin.albumReportState;
      plugin.albumReportState = function pendingReport() { return { ...real.call(this), report: null, unavailable: true }; };
      try {
        plugin.scheduleRecordSheetRefresh();
        await settle();
      } finally {
        delete plugin.albumReportState;
      }
      const pendingNode = card();
      const pending = snapshot(pendingNode);
      plugin.scheduleRecordSheetRefresh();
      await settle();
      const joinedNode = card();
      return { pending, joined: { ...snapshot(joinedNode), sameNode: joinedNode === pendingNode } };
    })())()`);
    report.probes.bodyJoinLive = join;
    appendCapturedCheck(report, "live-title-block-before-report",
      join.pending.body === "pending" && join.pending.title === "Bead Lifecycle" && join.pending.edit === false
        && /cm-sizer/.test(join.pending.slot), join.pending);
    appendCapturedCheck(report, "live-body-joins-same-node",
      join.joined.sameNode === true && join.joined.body === "report" && join.joined.edit === true, join.joined);
    report.screenshots.push(await capture(client, outDir, "record-sheet-live-light-wide", 1400, "light", "Live Preview"));

    const beforePassive = markdownFilesHash(vaultDir);
    (report.probes.clicks ||= []).push(await clickBy(client, '[data-foot-focus="foot"]'));
    state = await waitFor(client, probeSource("zettels/bead_lifecycle.md"), (value) => value.sheet?.footExpanded === "true", "shared foot drawer open");
    report.probes.footOpen = state;
    appendCapturedCheck(report, "drawer-opens-without-markdown-writes", markdownFilesHash(vaultDir) === beforePassive, state.sheet);
    report.screenshots.push(await capture(client, outDir, "record-sheet-foot-open", 1400, "light", "Live Preview"));
    (report.probes.clicks ||= []).push(await clickBy(client, '[data-foot-focus="foot"]'));
    (report.probes.clicks ||= []).push(await clickBy(client, '[data-record-sheet-focus="collapse"]'));
    state = await waitFor(client, probeSource("zettels/bead_lifecycle.md"), (value) => value.sheet?.collapsed === true, "sheet collapse");
    report.probes.collapsed = state;
    expectVisibility(report, "collapsed-sheet-keeps-title-owned-and-schema-rows-hidden", state, { titleOwned: true, rowsHidden: true });
    appendCapturedCheck(report, "collapse-button-works", state.sheet?.collapsed === true, state.sheet);
    appendCapturedCheck(report, "collapse-does-not-write-markdown", markdownFilesHash(vaultDir) === beforePassive, state.sheet);
    report.screenshots.push(await capture(client, outDir, "record-sheet-collapsed", 1400, "light", "Live Preview"));
    (report.probes.clicks ||= []).push(await clickBy(client, '[data-record-sheet-focus="collapse"]'));

    await setTheme(client, "dark");
    await setViewport(client, 1400, 1000);
    state = await waitSheet("zettels/bead_lifecycle.md");
    report.probes.liveDark = state;
    report.screenshots.push(await capture(client, outDir, "record-sheet-live-dark-wide", 1400, "dark", "Live Preview"));
    await setTheme(client, "light");
    const sidebarState = await collapseSidebars(client);
    if (!sidebarState.ok) throw new Error("Cannot isolate the narrow sheet viewport: " + JSON.stringify(sidebarState));
    await setViewport(client, 375, 900);
    state = await probe("zettels/bead_lifecycle.md");
    report.probes.liveNarrow = state;
    const layout = state.sheet;
    const inside = (rect, outer) => Boolean(rect && outer && rect.x >= outer.x - 1 && rect.x + rect.width <= outer.x + outer.width + 2);
    appendCapturedCheck(report, "narrow-sheet-and-toolbar-fit-375px",
      Boolean(layout && layout.rect && layout.rect.scrollWidth <= layout.rect.clientWidth + 2 && inside(layout.titleRect, layout.rect) && inside(layout.toolsRect, layout.rect)),
      { sheet: layout?.rect, title: layout?.titleRect, tools: layout?.toolsRect });
    report.screenshots.push(await capture(client, outDir, "record-sheet-live-light-375", 375, "light", "Live Preview"));
    await setViewport(client, 1400, 1000);
    await restoreSidebars(client);

    await client.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    state = await probe("zettels/bead_lifecycle.md");
    report.probes.reducedMotion = state;
    appendCapturedCheck(report, "reduced-motion-media-query-honored",
      state.reducedMotion === true && state.sheetMotion?.animationDuration?.split(",").every((value) => Number.parseFloat(value) === 0)
        && state.sheetMotion?.transitionDuration?.split(",").every((value) => Number.parseFloat(value) === 0),
      { reducedMotion: state.reducedMotion, motion: state.sheetMotion }, false);
    await client.call("Emulation.setEmulatedMedia", { features: [] });

    await open("zettels/bead_lifecycle.md", "live");
    const bodyCursor = await client.evaluate(lib.frontmatterBodyCursorExpression("zettels/bead_lifecycle.md"));
    appendCapturedCheck(report, "live-preview-cursor-reaches-first-body-line", bodyCursor.ok, bodyCursor);
    await open("zettels/frontmatter-only.md", "live");
    state = await waitSheet("zettels/frontmatter-only.md");
    report.probes.frontmatterOnlyLive = state;
    checkPositive("frontmatter-only-live-preview", state, { title: "Frontmatter Only", h1Count: 0 });
    const frontmatterBodyCursor = await client.evaluate(lib.frontmatterBodyCursorExpression("zettels/frontmatter-only.md"));
    appendCapturedCheck(report, "frontmatter-only-live-preview-reaches-body-boundary", frontmatterBodyCursor.ok, frontmatterBodyCursor);
    // Native Properties replaces YAML in Live Preview. Check the actual closing
    // delimiter in Source, independently of the managed walk footer after it.
    await open("zettels/frontmatter-only.md", "source");
    const frontmatterCursor = await client.evaluate(lib.frontmatterBodyCursorExpression("zettels/frontmatter-only.md", true));
    appendCapturedCheck(report, "frontmatter-only-source-editor-reaches-closing-delimiter", frontmatterCursor.ok && frontmatterCursor.delimiter === "---", frontmatterCursor);
    await open("zettels/frontmatter-only.md", "reading");
    state = await waitSheet("zettels/frontmatter-only.md");
    report.probes.frontmatterOnly = state;
    checkPositive("frontmatter-only-reading", state, { title: "Frontmatter Only", h1Count: 0 });
    report.screenshots.push(await capture(client, outDir, "record-sheet-frontmatter-only-reading", 1400, "light", "Reading"));
    await open("zettels/legacy-heading.md", "reading");
    state = await waitSheet("zettels/legacy-heading.md");
    report.probes.legacyHeading = state;
    checkPositive("legacy-h1-reading", state, { title: "Legacy Heading", h1Count: 1 });
    await open("zettels/legacy-heading.md", "live");
    state = await waitSheet("zettels/legacy-heading.md");
    checkPositive("legacy-h1-live-preview", state, { title: "Legacy Heading" });
    const reveal = await client.evaluate(`(() => {
      const leaf = app.workspace.getLeavesOfType("markdown").find((item) => item.view?.file?.path === "zettels/legacy-heading.md");
      const editor = leaf?.view?.editor;
      if (!editor) return { ok: false, reason: "Live Preview editor unavailable" };
      const line = editor.getValue().split("\\n").indexOf("# Legacy Heading");
      if (line < 0) return { ok: false, reason: "legacy H1 missing", line };
      editor.setCursor({ line, ch: 0 });
      return { ok: true, line, target: line, actual: editor.getCursor().line, delimiter: "---", bodyLine: "# Legacy Heading" };
    })()`);
    const afterReveal = await waitFor(client, `(() => {
      const leaf = app.workspace.getLeavesOfType("markdown").find((item) => item.view?.file?.path === "zettels/legacy-heading.md");
      const surface = leaf?.view?.containerEl?.querySelector(".markdown-source-view");
      const sheet = surface?.querySelector(".bob-record-sheet");
      const raw = [...(surface?.querySelectorAll(".cm-content .cm-line") || [])].some((line) =>
        /^(# )?Legacy Heading$/.test(String(line.textContent || "").trim()) && line.getBoundingClientRect().height > 0);
      return {
        inTitleSlot: Boolean(sheet?.parentElement?.classList.contains("cm-sizer")),
        source: sheet?.getAttribute("data-record-source") || "",
        raw,
        ariaLabel: sheet?.getAttribute("aria-label") || "",
      };
    })()`, (value) => value && value.raw && value.inTitleSlot, "legacy H1 reveal keeps slot card");
    report.probes.legacyHeadingReveal = { reveal, afterReveal };
    appendCapturedCheck(report, "live-preview-reveal-keeps-slot-card",
      reveal.ok && afterReveal.inTitleSlot && afterReveal.source === "zettels/legacy-heading.md"
        && afterReveal.raw && afterReveal.ariaLabel === "Record: Legacy Heading",
      { reveal, afterReveal });
    report.screenshots.push(await capture(client, outDir, "record-sheet-live-reveal", 1400, "light", "Live Preview"));

    await open("movies/equilibrium.md", "live");
    state = await waitSheet("movies/equilibrium.md");
    report.probes.movie = state;
    checkPositive("sparse-movie-live-preview", state, { title: "Equilibrium", h1Count: 0 });
    report.probes.embeddedPropertiesOpened = await expandEmbeddedProperties(client);
    state = await probe("movies/equilibrium.md");
    report.probes.movieAfterEmbeddedPropertiesOpen = state;
    appendCapturedCheck(report, "movie-optional-fields-render-as-ghosts",
      state.authoredKeys.includes("year") && state.coverage.year === "row" && state.coverage.service === "ghost"
        && state.coverage.watched_on === "ghost" && state.coverage.url === "ghost",
      { keys: state.authoredKeys, coverage: state.coverage });
    appendCapturedCheck(report, "embed-properties-remain-visible",
      state.embeddedProperties.length > 0 && state.embeddedProperties.every((item) => item.present && item.display !== "none" && item.visibility !== "hidden" && item.rectVisible && !item.hideClassWithinEmbed),
      state.embeddedProperties);
    await open("eat/restaurant.md", "reading");
    state = await waitSheet("eat/restaurant.md");
    report.probes.restaurant = state;
    checkPositive("restaurant-wikilink-reading", state, { title: "Cranford Ramen", h1Count: 0 });
    appendCapturedCheck(report, "legacy-keys-render-in-drawer",
      state.coverage.lid === "drawer" && state.coverage.source_title === "drawer" && state.coverage.source_url === "drawer",
      state.coverage);
    await open("movies/equilibrium.md", "reading");
    await waitSheet("movies/equilibrium.md");
    const embedCard = await waitFor(client, `(() => {
      const embed = document.querySelector(".markdown-embed .bob-record-sheet, .internal-embed .bob-record-sheet");
      if (!embed) return null;
      const heading = embed.querySelector(".bob-property-card-title");
      const host = embed.closest(".markdown-embed, .internal-embed");
      const preview = host?.querySelector(".markdown-preview-view");
      return {
        kind: embed.getAttribute("data-card-kind") || "",
        titleLevel: heading?.getAttribute("aria-level"),
        titleRole: heading?.getAttribute("role"),
        ownsTitle: Boolean(preview?.classList.contains("bob-property-card-owns-title") || host?.classList.contains("bob-property-card-owns-title")),
        inTitleSlot: Boolean(embed.parentElement?.classList.contains("mod-header") || embed.parentElement?.classList.contains("cm-sizer")),
      };
    })()`, (value) => Boolean(value && value.kind === "record" && value.titleLevel == null && value.ownsTitle !== true && value.inTitleSlot !== true), "demoted embed record card");
    report.probes.embedCard = embedCard;
    appendCapturedCheck(report, "embed-card-is-demoted-and-does-not-own-title",
      Boolean(embedCard && embedCard.kind === "record" && embedCard.titleLevel == null && embedCard.ownsTitle !== true && embedCard.inTitleSlot !== true),
      embedCard);
    // The walk rail links to this record too; hover the authored body link.
    report.probes.hoverTarget = await hoverBy(client, '.markdown-preview-view li a[data-href="movies/embedded-record"]:not(.bob-record-walk-arm)');
    const hover = await waitFor(client, `(() => Array.from(document.querySelectorAll(".hover-popover")).map((root) => ({
      classes: String(root.className || ""),
      properties: Array.from(root.querySelectorAll(".metadata-container")).map((node) => {
        const style = getComputedStyle(node); const rect = node.getBoundingClientRect();
        return { present: true, display: style.display, visibility: style.visibility, rectVisible: rect.width > 0 && rect.height > 0, path: (() => { const rows=[]; let current=node; for(let i=0;current&&i<18;i++,current=current.parentElement){rows.push({tag:String(current.tagName||"").toLowerCase(),classes:typeof current.className==="string"?current.className.split(/\\s+/).filter(Boolean):[]}); if(current===root)break;} return rows;})() };
      })
    })).filter((item) => item.properties.length)[0] || null)()`, (value) => value && value.properties.length > 0, "hover popover native Properties", 15_000);
    report.probes.hoverPopover = hover;
    appendCapturedCheck(report, "hover-popover-properties-remain-visible",
      hover.properties.every((item) => item.present && item.display !== "none" && item.visibility !== "hidden" && item.rectVisible),
      hover);

    await open("subscriptions/streamer.md", "reading");
    state = await waitSheet("subscriptions/streamer.md");
    report.probes.subscription = state;
    checkPositive("subscription-reading", state, { title: "StreamCo", h1Count: 0 });
    appendCapturedCheck(report, "subscription-strip-docked-exactly-once", state.sheet?.bands === 1, { bands: state.sheet?.bands });
    appendCapturedCheck(report, "subscription-match-list-renders", Boolean(state.sheet?.rowKeys?.includes("match")), { rowKeys: state.sheet?.rowKeys });

    await open("missing/record.md", "reading");
    state = await waitSheet("missing/record.md");
    report.probes.missingRequired = state;
    checkPositive("missing-required-reading", state, { title: "Missing Required", h1Count: 0 });
    appendCapturedCheck(report, "required-field-missing-pill-renders",
      state.coverage.claim === "row" && state.sheet.missingCount > 0,
      { coverage: state.coverage, missingCount: state.sheet.missingCount });

    await open("broken/record.md", "reading");
    state = await waitSheet("broken/record.md");
    report.probes.brokenSchema = state;
    appendCapturedCheck(report, "broken-schema-warning-retains-title",
      state.sheet?.title === "Broken Schema Record" && Boolean(state.sheet.warning) && state.gate?.state === "broken",
      { title: state.sheet?.title, warning: state.sheet?.warning, gate: state.gate });
    expectVisibility(report, "broken-schema-title-owned-rows-visible", state, { titleOwned: true, rowsHidden: false });

    for (const [name, notePath] of [
      ["bank-month-lookalike", "bank/2026-11.md"],
      ["legacy-noun-type", "eat/legacy-type.md"],
      ["outside-folder", "misfiled.md"],
      ["ordinary-note", "ordinary.md"],
    ]) {
      await open(notePath, "reading");
      state = await waitNoSheet(notePath);
      if (name === "ordinary-note") {
        report.probes.ordinaryNativeExpansion = await expandNativeProperties(client, notePath);
        state = await probe(notePath);
      }
      report.probes[name] = state;
      appendCapturedCheck(report, name + "-has-no-record-sheet", !state.sheet, state);
      if (name === "ordinary-note") report.probes.ordinaryNativeAfterTransitions = await diagnoseNativeDom(client, notePath);
      expectVisibility(report, name + "-native-ui-fails-open", state, { titleOwned: false, rowsHidden: false });
    }

    await open("zettels/bead_lifecycle.md", "source");
    state = await waitNoSheet("zettels/bead_lifecycle.md");
    report.probes.sourceMode = state;
    report.probes.sourceModeNativeAfterTransitions = await diagnoseNativeDom(client, "zettels/bead_lifecycle.md");
    const sourceYamlVisible = await client.evaluate(`(() => {
      const leaf = app.workspace.getLeavesOfType("markdown").find((item) => item.view?.file?.path === "zettels/bead_lifecycle.md");
      const cm = leaf?.view?.editor?.cm;
      const text = cm?.state?.doc?.toString?.() || "";
      return Boolean(text.startsWith("---\\n") && text.includes('type: "[[record]]"') && text.includes('parent: "[[zettels]]"'));
    })()`);
    appendCapturedCheck(report, "source-mode-fails-open-without-sheet", !state.sheet && !state.hideClassPresent, state);
    appendCapturedCheck(report, "source-mode-native-ui-visible", sourceYamlVisible && state.inlineTitle?.present && state.inlineTitle.display !== "none", {
      sourceYamlVisible,
      propertiesInDocumentMode: "Source mode keeps native YAML in the editor; Obsidian hides its Properties widget here.",
      properties: state.properties,
      inlineTitle: state.inlineTitle,
    });

    await open("zettels/bead_lifecycle.md", "live");
    state = await waitSheet("zettels/bead_lifecycle.md");
    appendCapturedCheck(report, "live-preview-hide-recovers-after-source-mode", state.hideClassPresent, state);
    expectVisibility(report, "mode-return-restores-schema-only-hiding", state, true);
    const lifecycleBefore = await client.evaluate(`(async () => {
      const file = app.vault.getAbstractFileByPath("zettels/bead_lifecycle.md");
      const text = await app.vault.read(file);
      await app.vault.modify(file, text.replace('type: "[[record]]"', 'type: "[[note]]"'));
      await new Promise((resolve) => setTimeout(resolve, 600));
      return { original: text };
    })()`);
    state = await waitFor(client, probeSource("zettels/bead_lifecycle.md"), (value) => value.gate?.mount === false || value.sheet?.count === 0, "type-change hide cleanup");
    report.probes.typeChanged = state;
    appendCapturedCheck(report, "type-change-clears-hide", !state.hideClassPresent && !state.sheet, state);
    expectVisibility(report, "type-change-restores-every-native-row", state, false);
    await client.evaluate(`(async () => {
      const file = app.vault.getAbstractFileByPath("zettels/bead_lifecycle.md");
      const current = await app.vault.read(file);
      await app.vault.modify(file, current.replace('type: "[[note]]"', 'type: "[[record]]"'));
      await new Promise((resolve) => setTimeout(resolve, 600));
      return true;
    })()`);
    state = await waitFor(client, probeSource("zettels/bead_lifecycle.md"), (value) => value.sheet?.count === 1 && value.hideClassPresent, "healthy return after type change");
    appendCapturedCheck(report, "healthy-return-restores-sheet-and-hide", state.sheet?.count === 1 && state.hideClassPresent, state);
    expectVisibility(report, "type-recovery-hides-only-schema-rows", state, true);

    const parentChange = await client.evaluate(`(async () => {
      const file = app.vault.getAbstractFileByPath("zettels/bead_lifecycle.md");
      const text = await app.vault.read(file);
      await app.vault.modify(file, text.replace('parent: "[[zettels]]"', 'parent: "[[proj]]"'));
      await new Promise((resolve) => setTimeout(resolve, 600));
      return text;
    })()`);
    state = await waitFor(client, probeSource("zettels/bead_lifecycle.md"), (value) => value.gate?.mount === false || value.sheet?.count === 0, "parent-change cleanup");
    appendCapturedCheck(report, "parent-change-clears-hide", !state.hideClassPresent && !state.sheet, state);
    expectVisibility(report, "parent-change-restores-every-native-row", state, false);
    await client.evaluate(`(async () => {
      const file = app.vault.getAbstractFileByPath("zettels/bead_lifecycle.md");
      const current = await app.vault.read(file);
      await app.vault.modify(file, current.replace('parent: "[[proj]]"', 'parent: "[[zettels]]"'));
      await new Promise((resolve) => setTimeout(resolve, 600));
      return true;
    })()`);
    state = await waitFor(client, probeSource("zettels/bead_lifecycle.md"), (value) => value.sheet?.count === 1 && value.hideClassPresent, "parent healthy return");
    appendCapturedCheck(report, "parent-healthy-return-restores-hide", state.sheet?.count === 1 && state.hideClassPresent, state);
    expectVisibility(report, "parent-recovery-hides-only-schema-rows", state, true);
    report.noteSafety.fixtureLifecycleEdits = { typeAndParentChangedInScratchOnly: true, originalPrefixBytes: lifecycleBefore.original.slice(0, 60), parentFixtureChanged: Boolean(parentChange) };

    await open("zettels/bead_lifecycle.md", "reading");
    const switches = await open("ordinary.md", "reading");
    state = await waitFor(client, probeSource("ordinary.md"), (value) => value.status === "pass", "ordinary view after file switch");
    appendCapturedCheck(report, "file-switch-clears-owned-hide", !state.hideClassPresent && !state.sheet, { opened: switches, current: state });
    expectVisibility(report, "ordinary-note-keeps-all-properties-after-file-switch", state, false);
    await open("zettels/bead_lifecycle.md", "live");
    state = await waitSheet("zettels/bead_lifecycle.md");
    expectVisibility(report, "record-return-hides-only-schema-rows", state, true);
    const tabRoundTrip = await client.evaluate(`(async () => {
      const record = app.workspace.getLeavesOfType("markdown").find((item) => item.view?.file?.path === "zettels/bead_lifecycle.md");
      const other = app.workspace.getLeaf("tab");
      await other.openFile(app.vault.getAbstractFileByPath("ordinary.md"));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (!record?.tabHeaderEl?.isConnected) throw new Error("Record tab header is not connected");
      record.tabHeaderEl.click();
      return { otherLeafId: other.id };
    })()`);
    state = await waitFor(client, probeSource("zettels/bead_lifecycle.md"),
      (value) => value.activePath === "zettels/bead_lifecycle.md" && value.sheet?.count === 1, "record tab return");
    report.probes.tabReturn = state;
    expectVisibility(report, "tab-return-hides-only-schema-rows", state, true);
    report.screenshots.push(await capture(client, outDir, "record-sheet-tab-return", 1400, "light", "Live Preview"));
    await client.evaluate(`(() => {
      app.workspace.getLeavesOfType("markdown").find((item) => item.id === ${JSON.stringify(tabRoundTrip.otherLeafId)})?.detach();
    })()`);
    await open("ordinary.md", "reading");
    const destroy = await client.evaluate(`(() => {
      const leaf = app.workspace.getLeavesOfType("markdown").find((item) => item.view?.file?.path === "ordinary.md");
      if (!leaf) return { ok: false, reason: "scratch markdown leaf missing" };
      if (typeof leaf.detach !== "function") return { ok: false, reason: "WorkspaceLeaf.detach unavailable" };
      leaf.detach();
      return { ok: true };
    })()`);
    await sleep(450);
    const leaked = await client.evaluate(`(() => Array.from(document.querySelectorAll(".${HIDE_CLASS}, .bob-property-card-owned-property, .bob-property-card-owns-title")).map((node) => String(node.className || "")))()`);
    appendCapturedCheck(report, "view-destruction-removes-owned-hide", destroy.ok && leaked.length === 0, { destroy, leaked });

    await open("zettels/bead_lifecycle.md", "reading");
    state = await waitSheet("zettels/bead_lifecycle.md");
    await client.evaluate(`(async () => {
      await app.plugins.disablePlugin("bob-ledger-tools");
    })()`);
    let disabled = false;
    try {
      disabled = await waitFor(client, `(() => !app.plugins.plugins["bob-ledger-tools"]?.recordSheetActive)()`, Boolean, "plugin disable cleanup", 15_000);
    } catch (error) {
      report.probes.pluginDisableWaitError = String(error?.message || error);
    }
    await expandNativeProperties(client, "zettels/bead_lifecycle.md");
    const disabledState = await client.evaluate(`(() => {
      const leaf = app.workspace.getLeavesOfType("markdown").find((item) => item.view?.file?.path === "zettels/bead_lifecycle.md");
      const view = leaf?.view;
      const surface = view?.previewMode?.containerEl || view?.containerEl || view?.contentEl;
      const hides = [surface, ...Array.from(surface?.querySelectorAll?.(".${HIDE_CLASS}") || [])]
        .filter((node) => node?.classList?.contains("${HIDE_CLASS}")).length;
      const properties = Array.from(surface?.querySelectorAll?.(".metadata-container, .metadata-property") || []).map((node) => ({
        display: getComputedStyle(node).display, visibility: getComputedStyle(node).visibility,
      }));
      return {
        disabled: !app.plugins.plugins["bob-ledger-tools"]?.recordSheetActive,
        enabled: Array.from(app.plugins.enabledPlugins || []).includes("bob-ledger-tools"),
        ownedHides: hides,
        properties,
      };
    })()`);
    report.probes.pluginDisabled = disabledState;
    appendCapturedCheck(report, "plugin-disable-clears-hide-and-restores-properties",
      disabledState.disabled && disabledState.ownedHides === 0 && disabledState.properties.every((node) => node.display !== "none" && node.visibility !== "hidden"),
      { ...disabledState, waitError: report.probes.pluginDisableWaitError || "" });
    let enabled = false;
    if (disabled) {
      await client.evaluate(`(async () => {
        await app.plugins.enablePlugin("bob-ledger-tools");
      })()`);
      enabled = await waitFor(client, `(() => app.plugins.plugins["bob-ledger-tools"]?.recordSheetActive === true)()`, Boolean, "plugin enable", 15_000);
      state = await waitFor(client, probeSource("zettels/bead_lifecycle.md"), (value) => value.sheet?.count === 1 && value.hideClassPresent, "plugin re-enable recovery");
      appendCapturedCheck(report, "plugin-reenable-restores-healthy-sheet", enabled && state.sheet?.count === 1 && state.hideClassPresent, { enabled, state });
      expectVisibility(report, "properties-hidden-after-plugin-reenable", state, true);
    } else {
      appendCapturedCheck(report, "plugin-reenable-restores-healthy-sheet", false,
        { reason: "Plugin did not disable; re-enable cannot be exercised." });
    }

    const afterUi = markdownFilesHash(vaultDir);
    report.noteSafety.afterUi = afterUi;
    report.noteSafety.passiveMarkdownBytesUnchanged = report.noteSafety.beforeUi === afterUi;
    appendCapturedCheck(report, "render-fold-collapse-and-navigation-are-markdown-neutral",
      report.noteSafety.passiveMarkdownBytesUnchanged, report.noteSafety);
    if (args.scope === "full") {
      await waitFor(client, "Boolean(app.plugins.plugins['bob-navigation-hotkeys'] && app.plugins.plugins['bob-command-mode'])", Boolean, "entry-point plugins");
      await workflows.runWorkflows({ client, report, vaultDir, profileDir, open, waitSheet,
        waitFor, sleep, capture, outDir, check: appendCapturedCheck,
        readRecord: (note) => {
          const [album, filename] = note.split('/');
          const result = runBob(bob, ['records', 'show', album, filename.replace(/\.md$/, ''), '-f', 'json'], vaultDir, profileDir);
          report.bobRuns.push(result);
          return workflowProof.readRecordResult(result, note);
        },
      });
    }
    workflowProof.requireInventory(report, args.scope);
    appendCapturedCheck(report, "no-console-exceptions", report.consoleExceptions.length === 0, report.consoleExceptions);
    report.pass = report.assertions.filter((row) => row.mandatory).every((row) => row.status === "pass")
      && report.prerequisites.every((row) => row.status === "pass");
    successful = report.pass;
  } catch (error) {
    report.error = error && error.stack ? error.stack : String(error);
    if (client) {
      try {
        report.screenshots.push(await capture(client, outDir, "record-sheet-runner-failure", 1400, "light", "failure state"));
      } catch (screenshotError) {
        report.screenshotError = String(screenshotError && screenshotError.message || screenshotError);
      }
    }
    if (!report.assertions.some((row) => row.name === "runner-error")) {
      writeAssertion(report, "runner-error", "fail", String(error && error.message || error));
    }
    report.pass = false;
  } finally {
    workflowProof.requireInventory(report, args.scope);
    if (report.assertions.some(row => row.mandatory && row.status !== 'pass')) {
      report.pass = false;
      successful = false;
    }
    if (client) client.close();
    if (child && child.exitCode == null) {
      try { child.kill("SIGTERM"); } catch (_) {}
      await sleep(250);
      if (child.exitCode == null) {
        try { child.kill("SIGKILL"); } catch (_) {}
      }
    }
    report.finishedAt = new Date().toISOString();
    report.scratchPreserved = Boolean(scratch && !successful && fs.existsSync(scratch));
    if (successful && scratch) fs.rmSync(scratch, { recursive: true, force: true });
    report.assertionCounts = report.assertions.reduce((counts, item) => {
      counts[item.status] = (counts[item.status] || 0) + 1;
      return counts;
    }, {});
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  }
  process.stdout.write((report.pass ? "PASS" : "FAIL") + " Record Card sheet e2e (" + JSON.stringify(report.assertionCounts) + ")\n");
  process.stdout.write("Report: " + reportPath + "\nScreenshots: " + outDir + "\n");
  if (!report.pass) {
    for (const row of report.assertions.filter((item) => item.status === "fail")) {
      process.stderr.write("- " + row.name + ": " + row.detail + "\n");
    }
    process.exitCode = 1;
  }
}

async function main(argv) {
  let args;
  try { args = lib.parseArgs(argv); }
  catch (error) {
    process.stderr.write(String(error.message || error) + "\n" + lib.HELP_TEXT + "\n");
    process.exitCode = 2;
    return;
  }
  if (args.help) {
    process.stdout.write(lib.HELP_TEXT + "\n");
    return;
  }
  if (args.selfTest) {
    try { lib.selfTest(); }
    catch (error) { process.stderr.write(String(error.stack || error) + "\n"); process.exitCode = 1; }
    return;
  }
  await run(args);
}

if (require.main === module) void main(process.argv.slice(2));
module.exports = {
  findBobProvenance, probeSource, markdownFilesHash, writeBobShim, parseArgs: lib.parseArgs,
  // Shared isolated-vault and CDP helpers reused by other real-Obsidian runners.
  CdpClient, capture, collapseSidebars, freePort, hashSourceTree, initScratchGit, openNote,
  seedProfile, selectTarget, setTheme, setViewport, sha256File, sleep, trustCommunityPlugins,
  waitFor, withTimeout, writeNote,
};
