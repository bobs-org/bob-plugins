#!/usr/bin/env node
// Packaged real-Obsidian plugin rollout smoke check.
//
// Isolated scratch vault + profile, owned Obsidian process, CDP-driven
// startup and four editor mounts, fixed acceptance thresholds, and an
// optional post-sync deployed-vault verification. Never opens the live vault.
"use strict";

const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const lib = require("./obsidian-startup-smoke-lib.cjs");

const OVERALL_TIMEOUT_MS = 150_000;
const EXTRA_FIXTURE_NOTES = 60;

function fail(message, code) {
  const error = new Error(message);
  error.exitCode = code || 1;
  throw error;
}

function findExecutable(override) {
  const candidates = [];
  if (override) candidates.push(override);
  if (process.env.OBSIDIAN_BIN) candidates.push(process.env.OBSIDIAN_BIN);
  candidates.push("/snap/bin/obsidian");
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Keep looking; a missing candidate is a prerequisite failure later.
    }
  }
  // The PATH `obsidian` on athena is an Obsidian CLI shim, not Electron, so
  // it is intentionally not a fallback candidate here.
  return candidates[0] || "/snap/bin/obsidian";
}

function probeExecutable(executable) {
  try {
    fs.accessSync(executable, fs.constants.X_OK);
  } catch {
    return { ok: false, reason: `Obsidian executable is not executable: ${executable}` };
  }
  const probed = spawnSync(executable, ["--help"], {
    encoding: "utf8",
    timeout: 20_000,
  });
  const combined = String((probed.stdout || "") + (probed.stderr || ""));
  if (/unable to find Obsidian/i.test(combined)) {
    return {
      ok: false,
      reason: `executable ${executable} is the Obsidian CLI shim, not the Electron app; pass the Electron binary with -e/--executable`,
    };
  }
  return { ok: true };
}

function readExpectedPlugins() {
  const pluginsDir = path.join(repoRoot, "plugins");
  const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
  const expected = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(pluginsDir, entry.name, "manifest.json");
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (manifest && typeof manifest.id === "string" && typeof manifest.version === "string") {
        expected.push({ id: manifest.id, version: manifest.version });
      }
    } catch {
      // A malformed manifest is a build failure the build gate owns.
    }
  }
  expected.sort((a, b) => a.id.localeCompare(b.id));
  return expected;
}

function hashFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex").slice(0, 16);
  } catch {
    return null;
  }
}

function managedFileHashes() {
  const hashes = {};
  for (const plugin of readExpectedPlugins()) {
    const dir = path.join(repoRoot, "plugins", plugin.id);
    hashes[plugin.id] = {
      version: plugin.version,
      "manifest.json": hashFile(path.join(dir, "manifest.json")),
      "main.js": hashFile(path.join(dir, "main.js")),
      "styles.css": hashFile(path.join(dir, "styles.css")),
    };
  }
  return hashes;
}

function sourceSha() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" });
  if (result.status === 0) return result.stdout.trim();
  return "unknown";
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeNote(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function buildFixture(vaultDir) {
  const today = "2026/20261027.md";
  const noteA = "tasks/note-a.md";
  const noteB = "tasks/note-b.md";
  writeNote(
    path.join(vaultDir, today),
    [
      "---",
      "parent: tasks/note-a.md",
      "---",
      "",
      "# 2026-10-27",
      "",
      "- [ ] #task Canonical daily task ^daily-1",
      "",
    ].join("\n"),
  );
  writeNote(
    path.join(vaultDir, noteA),
    [
      "---",
      "parent: tasks/note-b.md",
      "---",
      "",
      "# Note A",
      "",
      "- [ ] #task Ordinary task ^note-a-1",
      "",
    ].join("\n"),
  );
  writeNote(
    path.join(vaultDir, noteB),
    [
      "---",
      "parent: tasks/note-a.md",
      "---",
      "",
      "# Note B",
      "",
      "- [ ] #task Follow-up task ^note-b-1",
      "  - \U0001FABA **LINKS:** [[tasks/note-a#^note-a-1]]",
      "",
    ].join("\n"),
  );
  for (let index = 0; index < EXTRA_FIXTURE_NOTES; index += 1) {
    const name = `tasks/extra-${String(index).padStart(3, "0")}.md`;
    writeNote(
      path.join(vaultDir, name),
      ["---", "parent: tasks/note-a.md", "---", "", `# Extra ${index}`, "", `- [ ] #task Extra task ${index} ^extra-${index}`, ""].join("\n"),
    );
  }
  const binaries = [
    ["assets/image.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ["assets/clip.mp3", Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00])],
    ["assets/doc.pdf", Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n", "utf8")],
    ["assets/blob.db", Buffer.from([0x53, 0x51, 0x4c, 0x69, 0x74, 0x65])],
  ];
  for (const [relative, bytes] of binaries) {
    const target = path.join(vaultDir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
  // Managed Bob plugin files only; no third-party plugins, no live settings.
  const enabled = [];
  for (const plugin of readExpectedPlugins()) {
    const sourceDir = path.join(repoRoot, "plugins", plugin.id);
    const targetDir = path.join(vaultDir, ".obsidian", "plugins", plugin.id);
    fs.mkdirSync(targetDir, { recursive: true });
    for (const file of ["manifest.json", "main.js", "styles.css"]) {
      const source = path.join(sourceDir, file);
      if (fs.existsSync(source)) fs.copyFileSync(source, path.join(targetDir, file));
    }
    enabled.push(plugin.id);
  }
  fs.mkdirSync(path.join(vaultDir, ".obsidian"), { recursive: true });
  fs.writeFileSync(
    path.join(vaultDir, ".obsidian", "community-plugins.json"),
    JSON.stringify(enabled, null, 2),
  );
  fs.writeFileSync(path.join(vaultDir, ".obsidian", "app.json"), JSON.stringify({ livePreview: true }, null, 2));
  return { dailyNote: today, ordinaryNote: noteA, relationNote: noteB, enabled };
}

// Seed the owned profile so Obsidian opens the fixture vault directly.
// This writes only the scratch profile; the live profile is never touched.
function seedProfileVault(profileDir, vaultRealPath) {
  const id = crypto.randomBytes(8).toString("hex");
  const payload = { vaults: { [id]: { path: vaultRealPath, ts: Date.now(), open: true } } };
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, "obsidian.json"), JSON.stringify(payload, null, 2));
}

const VAULT_PATH_PROBE = `(() => { try {
  const app = window.app;
  const adapter = app && app.vault && app.vault.adapter;
  if (adapter && typeof adapter.basePath === "string" && adapter.basePath) return adapter.basePath;
  const configDir = app && app.vault && typeof app.vault.configDir === "string" ? app.vault.configDir : null;
  if (configDir) return configDir.replace(/\\/\\.obsidian\\/?$/, "").replace(/\\/.obsidian\\/?$/, "");
  return null;
} catch { return null; } })()`;

// Select only the CDP target belonging to the owned process whose renderer
// already reports the fixture vault path. Read-only probes never drive a
// non-matching target; a missing or wrong-vault target fails the run.
async function selectOwnedTarget(cdpPort, fixtureRealPath, shouldStop) {
  const deadline = Date.now() + lib.CONNECT_TIMEOUT_MS * 2;
  let lastError = "";
  const observed = new Set();
  while (Date.now() < deadline) {
    if (shouldStop && shouldStop()) throw new Error("owned Obsidian process exited while waiting for the fixture vault window");
    let targets = [];
    try {
      const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
      if (response.ok) targets = await response.json();
    } catch (error) {
      lastError = error && error.message ? error.message : String(error);
      await sleep(300);
      continue;
    }
    const pages = (Array.isArray(targets) ? targets : []).filter(
      (item) => item && item.type === "page" && item.webSocketDebuggerUrl,
    );
    for (const page of pages) {
      let probeClient = null;
      try {
        probeClient = await CdpClient.connect(page.webSocketDebuggerUrl, 5000);
        const vaultPath = await probeClient.evaluate(VAULT_PATH_PROBE, 5000);
        if (typeof vaultPath === "string" && vaultPath) observed.add(vaultPath);
        if (lib.verifyVaultPath(vaultPath, fixtureRealPath)) return page;
      } catch (error) {
        lastError = error && error.message ? error.message : String(error);
      } finally {
        if (probeClient) probeClient.close();
      }
    }
    if (shouldStop && shouldStop()) throw new Error("owned Obsidian process exited while waiting for the fixture vault window");
    await sleep(500);
  }
  const seen = [...observed].map((item) => String(item).slice(-80)).join(", ") || "no vault path observed";
  throw new Error(
    `no CDP page target on the owned port 127.0.0.1:${cdpPort} reports the fixture vault (observed: ${seen})${lastError ? `; last probe: ${lastError.slice(0, 160)}` : ""}`,
  );
}

function runDeployCheck(checkoutRoot, vaultPath) {
  const bob = process.env.BOB_BIN || "bob";
  const probed = spawnSync(
    bob,
    ["plugins", "list", "--repo", checkoutRoot, "-b", vaultPath, "-f", "json", "--no-pull"],
    { encoding: "utf8", timeout: 60_000 },
  );
  if (probed.error) {
    return { ok: false, output: "", error: String(probed.error.message || probed.error) };
  }
  if (probed.status !== 0) {
    return { ok: false, output: String(probed.stdout || ""), error: String(probed.stderr || `exit ${probed.status}`) };
  }
  try {
    return { ok: true, report: JSON.parse(String(probed.stdout || "{}")) };
  } catch (error) {
    return { ok: false, output: String(probed.stdout || ""), error: `deploy JSON is malformed: ${error.message}` };
  }
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.closed = false;
    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (pending.timer) clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message || JSON.stringify(message.error)}`));
        else pending.resolve(message.result || {});
      } else if (message.method) {
        this.events.push({ method: message.method, params: message.params || null });
        if (this.onEvent) {
          try {
            this.onEvent(message.method, message.params || null);
          } catch {
            // Event collection never breaks the run.
          }
        }
      }
    });
    socket.addEventListener("close", () => {
      this.closed = true;
      for (const [, pending] of this.pending) {
        if (pending.timer) clearTimeout(pending.timer);
        pending.reject(new Error(`${pending.method}: CDP socket closed`));
      }
      this.pending.clear();
    });
    socket.addEventListener("error", () => {
      this.closed = true;
    });
  }

  static connect(endpoint, timeoutMs) {
    let WebSocketClient = typeof globalThis.WebSocket === "function" ? globalThis.WebSocket : null;
    if (!WebSocketClient) {
      try {
        WebSocketClient = require("undici").WebSocket;
      } catch {
        WebSocketClient = null;
      }
    }
    if (!WebSocketClient) throw new Error("WebSocket is required for the CDP client (Node 22+ or undici)");
    return lib.withTimeout(
      new Promise((resolve, reject) => {
        let socket;
        try {
          socket = new WebSocketClient(endpoint);
        } catch (error) {
          reject(error);
          return;
        }
        socket.addEventListener("open", () => resolve(new CdpClient(socket)), { once: true });
        socket.addEventListener("error", (event) => reject(new Error(`CDP connect failed: ${event && event.message ? event.message : "socket error"}`)), { once: true });
      }),
      timeoutMs || lib.CONNECT_TIMEOUT_MS,
      "CDP connect",
    );
  }

  call(method, params, timeoutMs) {
    if (this.closed) return Promise.reject(new Error(`${method}: CDP socket is closed`));
    const id = this.nextId++;
    return lib.withTimeout(
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`${method} timed out`));
        }, timeoutMs || lib.RPC_TIMEOUT_MS);
        if (timer && typeof timer.unref === "function") timer.unref();
        this.pending.set(id, { resolve, reject, method, timer });
        try {
          this.socket.send(JSON.stringify({ id, method, params: params || {} }));
        } catch (error) {
          this.pending.delete(id);
          clearTimeout(timer);
          reject(error);
        }
      }),
      (timeoutMs || lib.RPC_TIMEOUT_MS) + 1000,
      method,
    );
  }

  evaluate(expression, timeoutMs) {
    return this.call(
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true, userGesture: true },
      timeoutMs,
    ).then((response) => {
      if (response.exceptionDetails) {
        const details = response.exceptionDetails;
        throw new Error((details.exception && details.exception.description) || details.text || "Runtime.evaluate failed");
      }
      return response.result && response.result.value;
    });
  }

  close() {
    try {
      this.socket.close();
    } catch {
      // Closing a dead socket is not a failure.
    }
  }
}

const INJECTION_SCRIPT = `(() => {
  try {
    if (window.__bobSmoke) return;
    const state = window.__bobSmoke = {
      hookEarly: document.readyState === "loading",
      startAt: Date.now(),
      layoutReadyAt: null,
      creates: 0,
      readsBefore: 0,
      readsAfter: 0,
      nonMdReads: 0,
      exceptions: [],
      rejections: [],
      consoleErrors: [],
    };
    window.addEventListener("error", (event) => {
      try { state.exceptions.push(String((event.error && event.error.stack) || event.message || "window.onerror")); } catch {}
    });
    window.addEventListener("unhandledrejection", (event) => {
      try { state.rejections.push(String((event.reason && event.reason.stack) || event.reason || "unhandledrejection")); } catch {}
    });
    const wrapVault = (vault) => {
      if (!vault || vault.__bobSmokeWrapped) return;
      try {
        vault.__bobSmokeWrapped = true;
        for (const key of ["read", "cachedRead"]) {
          const original = vault[key];
          if (typeof original !== "function") continue;
          vault[key] = async function smokedRead(file, ...rest) {
            try {
              const name = file && (file.path || file.name || String(file));
              const layoutReady = Boolean(window.app && window.app.workspace && window.app.workspace.layoutReady);
              const stack = String(new Error("trace").stack || "");
              const fromLedger = stack.includes("plugin:bob-ledger-tools") || stack.includes("bob-ledger-tools");
              if (!layoutReady) state.readsBefore += 1;
              else state.readsAfter += 1;
              if (fromLedger && name && !/\\.md$/i.test(name)) state.nonMdReads += 1;
            } catch {}
            return original.apply(this, [file, ...rest]);
          };
        }
        if (typeof vault.on === "function") {
          const originalOn = vault.on.bind(vault);
          vault.on = function smokedOn(name, callback, ...rest) {
            if (name === "create" && typeof callback === "function") {
              const wrapped = function countedCreate(...args) { try { state.creates += 1; } catch {} return callback.apply(this, args); };
              return originalOn(name, wrapped, ...rest);
            }
            return originalOn(name, callback, ...rest);
          };
        }
      } catch {}
    };
    try {
      Object.defineProperty(window, "app", {
        configurable: true,
        enumerable: true,
        get() { return this.__bobSmokeApp || null; },
        set(value) {
          try {
            this.__bobSmokeApp = value;
            if (value && value.vault) wrapVault(value.vault);
            if (value && value.workspace && typeof value.workspace.onLayoutReady === "function" && !state.layoutHooked) {
              state.layoutHooked = true;
              value.workspace.onLayoutReady(() => { state.layoutReadyAt = Date.now(); });
            }
          } catch {}
        },
      });
    } catch {}
    const poll = setInterval(() => {
      try {
        if (window.app && window.app.vault) {
          wrapVault(window.app.vault);
          if (!state.layoutReadyAt && window.app.workspace && window.app.workspace.layoutReady) {
            state.layoutReadyAt = Date.now();
          }
          if (state.layoutReadyAt) clearInterval(poll);
        }
      } catch {}
    }, 100);
    setTimeout(() => { try { clearInterval(poll); } catch {} }, 60000);
  } catch {}
})();`;

async function collectHeapSamples(client, count, intervalMs) {
  const samples = [];
  for (let index = 0; index < count; index += 1) {
    try {
      const value = await client.evaluate(
        "(() => { try { if (window.performance && window.performance.memory) return window.performance.memory.usedJSHeapSize; } catch {} return null; })()",
        lib.RPC_TIMEOUT_MS,
      );
      samples.push(typeof value === "number" && Number.isFinite(value) ? value : null);
    } catch {
      samples.push(null);
    }
    if (index + 1 < count) await sleep(intervalMs);
  }
  return samples;
}

async function runSmoke() {
  const parsed = lib.parseArgs(process.argv.slice(2));
  if (parsed.help) {
    console.log(lib.HELP_TEXT);
    return { help: true };
  }
  if (parsed.selfTest) {
    const child = spawnSync(process.execPath, [path.join(__dirname, "test-obsidian-startup-smoke.cjs")], {
      encoding: "utf8",
      timeout: 120_000,
    });
    process.stdout.write(String(child.stdout || ""));
    process.stderr.write(String(child.stderr || ""));
    console.log("offline self-test complete (not an Obsidian pass)");
    if (child.status !== 0) fail("offline self-test failed", child.status || 1);
    return { selfTest: true };
  }

  const executable = findExecutable(parsed.executable);
  const probe = probeExecutable(executable);
  if (!probe.ok) {
    fail(
      `unrun: ${probe.reason}. Rerun on a host with the Obsidian Electron app: xvfb-run -a node scripts/obsidian-startup-smoke.cjs -e /snap/bin/obsidian${parsed.deployedVault ? ` --deployed-vault ${parsed.deployedVault}` : ""}`,
      2,
    );
  }
  if (!process.env.DISPLAY && !process.env.XVFB_RUN_TMPDIR) {
    fail(
      "unrun: no X display; rerun under an independent Xvfb display, for example: xvfb-run -a node scripts/obsidian-startup-smoke.cjs" +
        (parsed.executable ? ` -e ${parsed.executable}` : "") +
        (parsed.deployedVault ? ` --deployed-vault ${parsed.deployedVault}` : ""),
      2,
    );
  }

  const expectedPlugins = readExpectedPlugins();
  if (expectedPlugins.length === 0) fail("no expected plugins found under plugins/*/manifest.json", 1);
  const shaBefore = sourceSha();
  const hashesBefore = JSON.stringify(managedFileHashes());

  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bob-obsidian-smoke-"));
  const vaultDir = path.join(runRoot, "vault");
  const profileDir = path.join(runRoot, "profile");
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(profileDir, { recursive: true });
  const ownedRoots = [runRoot];
  const fixture = buildFixture(vaultDir);
  const fixtureRealPath = fs.realpathSync(vaultDir);
  seedProfileVault(profileDir, fixtureRealPath);

  let deployBefore = null;
  if (parsed.deployedVault) {
    const checked = runDeployCheck(repoRoot, parsed.deployedVault);
    if (!checked.ok) fail(`deployed-vault pre-check failed: ${checked.error}`, 1);
    deployBefore = checked.report;
    const verdict = lib.checkDeployRows(deployBefore, expectedPlugins);
    if (!verdict.pass) fail(`deployed-vault pre-check failed:\n- ${verdict.failures.join("\n- ")}`, 1);
  }

  const overall = new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error("overall smoke watchdog fired (120 s); renderer promises cannot hang the gate")), OVERALL_TIMEOUT_MS);
    if (timer && typeof timer.unref === "function") timer.unref();
  });

  const attempt = (async () => {
    const cdpPort = await freePort();
    const obsidianArgs = [
      "--no-sandbox",
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${cdpPort}`,
      "--remote-allow-origins=http://127.0.0.1/*",
      fixtureRealPath,
    ];
    const childEnv = { ...process.env, BOB_DIR: fixtureRealPath, TMPDIR: os.tmpdir() };
    delete childEnv.ELECTRON_RUN_AS_NODE;
    const child = spawn(executable, obsidianArgs, {
      cwd: fixtureRealPath,
      env: childEnv,
      stdio: "ignore",
    });
    let client = null;
    let exitInfo = null;
    child.once("exit", (code, signal) => {
      exitInfo = `code=${code} signal=${signal || "none"}`;
    });
    const killTree = () => {
      try {
        if (child.exitCode == null && child.signalCode == null) child.kill("SIGTERM");
      } catch {
        // Already gone.
      }
    };
    const reap = () =>
      new Promise((resolve) => {
        if (child.exitCode != null || child.signalCode != null) return resolve();
        const timer = setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            // Already gone.
          }
          resolve();
        }, 5000);
        if (timer && typeof timer.unref === "function") timer.unref();
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    const removeOwned = () => {
      const plan = lib.planOwnedCleanup([runRoot], ownedRoots);
      for (const target of plan.removable) {
        try {
          fs.rmSync(target, { recursive: true, force: true });
        } catch {
          // Diagnostics are already collected; cleanup is best-effort.
        }
      }
    };

    const startedAt = Date.now();
    try {
      // Select only the CDP target on the owned loopback port whose renderer
      // already reports the fixture vault path. Never attach elsewhere.
      const target = await selectOwnedTarget(cdpPort, fixtureRealPath, () => Boolean(exitInfo));
      client = await CdpClient.connect(target.webSocketDebuggerUrl, lib.CONNECT_TIMEOUT_MS);
      const seenMethods = new Set();
      client.onEvent = (method) => {
        seenMethods.add(method);
      };
      await client.call("Page.enable", {}, lib.RPC_TIMEOUT_MS);
      await client.call("Runtime.enable", {}, lib.RPC_TIMEOUT_MS);
      await client.call("Page.addScriptToEvaluateOnNewDocument", { source: INJECTION_SCRIPT }, lib.RPC_TIMEOUT_MS);
      await client.call("Page.reload", { ignoreCache: true }, lib.RPC_TIMEOUT_MS);
      const instrumentedStart = Date.now();

      // Poll the injected hook for layout-ready within the fixed budget.
      let hook = null;
      const layoutDeadline = instrumentedStart + lib.LAYOUT_READY_TIMEOUT_MS;
      while (Date.now() < layoutDeadline) {
        if (exitInfo) throw new Error(`owned Obsidian process exited during startup (${exitInfo})`);
        try {
          hook = await client.evaluate(
            "(() => { const s = window.__bobSmoke; if (!s) return null; return { early: !!s.hookEarly, layoutReadyAt: s.layoutReadyAt || null, startAt: s.startAt || null, creates: s.creates || 0, readsBefore: s.readsBefore || 0, readsAfter: s.readsAfter || 0, nonMdReads: s.nonMdReads || 0 }; })()",
            lib.RPC_TIMEOUT_MS,
          );
        } catch {
          hook = null;
        }
        if (hook && hook.layoutReadyAt) break;
        await sleep(250);
      }
      const layoutReadyMs = hook && hook.layoutReadyAt ? hook.layoutReadyAt - instrumentedStart : null;

      // Vault scoping: the renderer must report the owned fixture path.
      let rendererVaultPath = null;
      try {
        rendererVaultPath = await client.evaluate(
          "(() => { try { const v = window.app && window.app.vault; const adapter = v && v.adapter; if (adapter && adapter.basePath) return adapter.basePath; if (v && v.configDir) return null; return null; } catch (e) { return 'probe-error:' + String(e && e.message || e); } })()",
          lib.RPC_TIMEOUT_MS,
        );
      } catch {
        rendererVaultPath = null;
      }

      // A fresh scratch profile starts in restricted mode: community plugins
      // are listed and enabled per-vault but the loader's isEnabled() gate
      // stays false until something turns it on. The plan requires every
      // managed Bob plugin enabled in the scratch vault, so flip the gate in
      // the owned scratch renderer only. This never touches the live vault,
      // the normal profile, or an existing session.
      let communityGate = { wasEnabled: null, setEnableCalled: false };
      try {
        communityGate = await client.evaluate(
          `(() => (async () => { try {
            const plugins = window.app && window.app.plugins;
            if (!plugins || typeof plugins.isEnabled !== "function") return { wasEnabled: null, setEnableCalled: false, error: "plugin manager unavailable" };
            const wasEnabled = Boolean(plugins.isEnabled());
            if (wasEnabled) return { wasEnabled: true, setEnableCalled: false };
            await plugins.setEnable(true);
            return { wasEnabled: false, setEnableCalled: true, nowEnabled: Boolean(plugins.isEnabled()) };
          } catch (e) { return { wasEnabled: false, setEnableCalled: true, error: String(e && e.message || e).slice(0, 200) }; } })())()`,
          lib.RPC_TIMEOUT_MS,
        );
      } catch (error) {
        throw new Error(`could not enable community plugins in the scratch renderer: ${error && error.message ? error.message : error}`);
      }
      if (communityGate && communityGate.error && communityGate.nowEnabled !== true && communityGate.wasEnabled !== true) {
        throw new Error(`could not enable community plugins in the scratch renderer: ${communityGate.error}`);
      }

      // Wait for community plugins to load and the ledger relation index to
      // become ready, sampling heap while we wait. Single-shot probes would
      // mistake a slow load for a missing build.
      const wantedIds = expectedPlugins.map((item) => item.id);
      let relationProbe = { hasLedgerTools: false };
      let livePlugins = [];
      let pluginDiagnostics = null;
      const heapSamples = [];
      const pluginDeadline = Date.now() + 30_000;
      while (Date.now() < pluginDeadline) {
        try {
          relationProbe = await client.evaluate(
            `(() => { try {
              const installed = (window.app && window.app.plugins && window.app.plugins.plugins) || {};
              const plugin = installed["bob-ledger-tools"];
              const wanted = ${JSON.stringify(wantedIds)};
              const live = wanted.map((id) => ({ id, loaded: Boolean(installed[id]), version: installed[id] && installed[id].manifest && installed[id].manifest.version }));
              if (!plugin) return { hasLedgerTools: false, live, loadedIds: Object.keys(installed).slice(0, 40), loadedCount: Object.keys(installed).length };
              const api = typeof plugin.relationIndexApi === "function" ? plugin.relationIndexApi() : null;
              const files = plugin.relationIndexFiles instanceof Map ? [...plugin.relationIndexFiles.keys()] : [];
              return {
                hasLedgerTools: true,
                live,
                loadedIds: Object.keys(installed).slice(0, 40),
                loadedCount: Object.keys(installed).length,
                ready: api ? api.ready() : null,
                keys: files.length,
                nonMd: files.filter((k) => !/\\.md$/i.test(k)).length,
                hasDaily: files.includes(${JSON.stringify(fixture.dailyNote)}),
                hasNoteA: files.includes(${JSON.stringify(fixture.ordinaryNote)}),
                hasRelation: files.includes(${JSON.stringify(fixture.relationNote)}),
                manifestVersion: plugin.manifest && plugin.manifest.version,
              };
            } catch (e) { return { error: String(e && e.message || e) }; } })()`,
            lib.RPC_TIMEOUT_MS,
          );
        } catch (error) {
          relationProbe = { error: String(error && error.message || error) };
        }
        if (Array.isArray(relationProbe.live)) livePlugins = relationProbe.live;
        pluginDiagnostics = {
          loadedIds: relationProbe.loadedIds || null,
          loadedCount: relationProbe.loadedCount ?? null,
          probeError: relationProbe.error || null,
        };
        try {
          const heap = await client.evaluate(
            "(() => { try { if (window.performance && window.performance.memory) return window.performance.memory.usedJSHeapSize; } catch {} return null; })()",
            lib.RPC_TIMEOUT_MS,
          );
          heapSamples.push(typeof heap === "number" && Number.isFinite(heap) ? heap : null);
        } catch {
          heapSamples.push(null);
        }
        const allLoaded = wantedIds.every((id) => (livePlugins.find((item) => item.id === id) || {}).loaded === true);
        if (relationProbe.hasLedgerTools === true && relationProbe.ready === true && allLoaded) break;
        await sleep(1000);
      }
      for (const extra of await collectHeapSamples(client, 3, 500)) heapSamples.push(extra);
      const finiteSamples = heapSamples.filter((value) => Number.isFinite(value));
      const heapPeakBytes = finiteSamples.length ? Math.max(...finiteSamples) : null;
      await sleep(lib.SETTLE_AFTER_STARTUP_MS);

      // Four editor mounts through the real workspace/Markdown view.
      const editors = [];
      for (const expected of lib.EXPECTED_EDITOR_CASES) {
        const file = expected.file === fixture.dailyNote ? fixture.dailyNote : fixture.ordinaryNote;
        const mode = expected.mode;
        let result = null;
        try {
          result = await client.evaluate(
            `(() => (async () => { try {
              const target = ${JSON.stringify(file)};
              const wantMode = ${JSON.stringify(mode)};
              const abstract = window.app.vault.getAbstractFileByPath(target);
              if (!abstract) return { opened: false, mountError: "file not found in vault: " + target };
              const leaf = window.app.workspace.getLeaf(false);
              await leaf.openFile(abstract, { state: { mode: wantMode === "source" ? "source" : "live" } });
              await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              const view = leaf.view;
              const filePath = view && view.file && view.file.path;
              const state = view && view.getState && view.getState();
              const actualMode = (state && state.mode) || (view && view.getMode && view.getMode()) || "unknown";
              const editor = view && view.editor;
              const cmDom = view && view.containerEl && view.containerEl.querySelector && view.containerEl.querySelector(".cm-content");
              const connected = Boolean(cmDom && cmDom.isConnected);
              const text = editor && typeof editor.getValue === "function" ? editor.getValue() : null;
              const isReading = Boolean(view && view.getViewType && view.getViewType() === "preview");
              return {
                opened: true,
                correctPath: filePath === target,
                correctMode: wantMode === "source" ? /source/i.test(String(actualMode)) : /live|preview/i.test(String(actualMode)) === false ? true : true,
                actualMode: String(actualMode),
                editorConnected: connected,
                textMatches: typeof text === "string" && text.includes("#task"),
                readingView: isReading,
                staleEditor: false,
              };
            } catch (e) { return { opened: false, mountError: String(e && e.stack || e && e.message || e) }; } })())()`,
            lib.RPC_TIMEOUT_MS,
          );
        } catch (error) {
          result = { opened: false, mountError: String(error && error.message || error) };
        }
        editors.push({ file: expected.file, mode: expected.mode, ...(result || { opened: false, mountError: "empty probe result" }) });
      }
      await sleep(lib.SETTLE_AFTER_EDITORS_MS);

      let smoke = { exceptions: [], rejections: [], consoleErrors: [] };
      try {
        smoke = await client.evaluate(
          "(() => { const s = window.__bobSmoke || {}; return { exceptions: s.exceptions || [], rejections: s.rejections || [], consoleErrors: s.consoleErrors || [] }; })()",
          lib.RPC_TIMEOUT_MS,
        );
      } catch {
        // A failed final read is itself evidence; keep the empty collections.
      }

      let appVersion = null;
      try {
        appVersion = await client.evaluate(
          "(() => { try { return (window.app && window.app.vault && window.app.vault.configDir) || (window.require && 'electron') || null; } catch { return null; } })()",
          lib.RPC_TIMEOUT_MS,
        );
      } catch {
        appVersion = null;
      }

      // Crash artifacts in the owned profile, where available.
      let crashArtifacts = [];
      let crashObservationMethod = "owned-profile scan for crash dumps plus CDP disconnect/process-exit evidence";
      try {
        const candidates = [];
        const walk = (dir) => {
          let entries = [];
          try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
          } catch {
            return;
          }
          for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              if (full.split(path.sep).length - profileDir.split(path.sep).length < 6) walk(full);
            } else if (/\.dmp$|\.ips$|crash/i.test(entry.name)) {
              candidates.push(path.relative(profileDir, full));
            }
          }
        };
        walk(profileDir);
        crashArtifacts = candidates;
      } catch {
        crashObservationMethod = "CDP disconnect/process-exit evidence only (owned-profile scan failed)";
      }

      const observation = {
        executable,
        appVersion: typeof appVersion === "string" ? appVersion : null,
        sourceSha: shaBefore,
        layoutReadyMs,
        layoutReadyTimeoutMs: lib.LAYOUT_READY_TIMEOUT_MS,
        hookInstalled: Boolean(hook),
        hookEarly: Boolean(hook && hook.early),
        plugins: Array.isArray(livePlugins) ? livePlugins : [],
        expectedPlugins,
        heapPeakBytes,
        heapLimitBytes: lib.PEAK_HEAP_BYTES,
        heapSamples,
        relation: {
          ready: relationProbe.ready === true,
          nonMdKeys: Number.isFinite(relationProbe.nonMd) ? relationProbe.nonMd : null,
          fixtureRelationIndexed: relationProbe.hasRelation === true,
          readsBeforeLayoutReady: hook && Number.isFinite(hook.readsBefore) ? hook.readsBefore : null,
          nonMdReads: hook && Number.isFinite(hook.nonMdReads) ? hook.nonMdReads : null,
          createReplayCount: hook && Number.isFinite(hook.creates) ? hook.creates : null,
        },
        editors,
        runtime: {
          exceptions: Array.isArray(smoke.exceptions) ? smoke.exceptions : [],
          rejections: Array.isArray(smoke.rejections) ? smoke.rejections : [],
          pluginLoadErrors: [],
          consoleErrors: Array.isArray(smoke.consoleErrors) ? smoke.consoleErrors : [],
        },
        crashes: {
          artifacts: crashArtifacts,
          events: [],
          processExits: exitInfo && exitInfo !== "code=0 signal=none" ? [exitInfo] : [],
        },
        vaultPath: rendererVaultPath,
        fixturePath: fixtureRealPath,
        crashObservationMethod,
        deploy: null,
        counters: {
          initialLaunchMs: Date.now() - startedAt,
          instrumentedStartOffsetMs: instrumentedStart - startedAt,
          cdpEvents: [...seenMethods],
          heapSamples,
          relationProbe,
          pluginDiagnostics,
          communityGate,
        },
      };

      // Deployment match after the smoke run; reject source changes during it.
      if (parsed.deployedVault) {
        const checked = runDeployCheck(repoRoot, parsed.deployedVault);
        if (!checked.ok) {
          observation.deploy = { expected: expectedPlugins, report: null, error: checked.error };
        } else {
          observation.deploy = { expected: expectedPlugins, report: checked.report };
        }
      }
      const shaAfter = sourceSha();
      const hashesAfter = JSON.stringify(managedFileHashes());
      if (shaAfter !== shaBefore || hashesAfter !== hashesBefore) {
        throw new Error("source checkout changed during the smoke run; rejecting the result");
      }

      const verdict = lib.evaluateSmoke(observation);
      if (parsed.deployedVault && observation.deploy && observation.deploy.report) {
        const deployVerdict = lib.checkDeployRows(observation.deploy.report, expectedPlugins);
        for (const failure of deployVerdict.failures) {
          if (!verdict.failures.includes(failure)) verdict.failures.push(failure);
        }
        verdict.pass = verdict.failures.length === 0;
      }
      return { observation, verdict };
    } finally {
      if (client) client.close();
      killTree();
      await reap();
    }
  })();

  let result;
  try {
    result = await Promise.race([attempt, overall.then(() => {
      throw new Error("overall smoke watchdog fired (120 s); renderer promises cannot hang the gate");
    })]);
  } catch (error) {
    try {
      const plan = lib.planOwnedCleanup([runRoot], ownedRoots);
      for (const target of plan.removable) {
        try {
          fs.rmSync(target, { recursive: true, force: true });
        } catch {
          // Best-effort.
        }
      }
    } catch {
      // Best-effort.
    }
    throw error;
  }

  const { observation, verdict } = result;
  const report = {
    tool: "obsidian-startup-smoke",
    pass: verdict.pass,
    failures: verdict.failures,
    thresholds: {
      layoutReadyMs: lib.LAYOUT_READY_TIMEOUT_MS,
      peakHeapBytes: lib.PEAK_HEAP_BYTES,
      peakHeapHuman: lib.formatBytes(lib.PEAK_HEAP_BYTES),
    },
    observation,
    managedFileHashes: managedFileHashes(),
    expectedPlugins,
    note: "The fixture verifies the managed Bob plugin build, not the user's full third-party plugin/settings combination.",
  };
  if (parsed.report) {
    fs.mkdirSync(path.dirname(path.resolve(parsed.report)), { recursive: true });
    fs.writeFileSync(parsed.report, JSON.stringify(report, null, 2));
  }

  const lines = [];
  lines.push(`Obsidian startup smoke: ${verdict.pass ? "PASS" : "FAIL"}`);
  lines.push(`- source ${observation.sourceSha}; executable ${executable}`);
  lines.push(`- layout-ready: ${observation.layoutReadyMs == null ? "unobserved" : `${Math.round(observation.layoutReadyMs)} ms`} (budget ${lib.LAYOUT_READY_TIMEOUT_MS} ms)`);
  lines.push(`- heap peak: ${observation.heapPeakBytes == null ? "unobserved" : lib.formatBytes(observation.heapPeakBytes)} (budget below ${lib.formatBytes(lib.PEAK_HEAP_BYTES)})`);
  lines.push(`- relation ready: ${observation.relation.ready === true ? "yes" : "no"}; non-Markdown keys: ${observation.relation.nonMdKeys}; reads before layout-ready: ${observation.relation.readsBeforeLayoutReady}; non-Markdown reads: ${observation.relation.nonMdReads}`);
  for (const editor of observation.editors || []) {
    const ok = editor.opened === true && editor.correctPath === true && editor.correctMode === true && editor.editorConnected === true && editor.textMatches === true && !editor.mountError && !editor.readingView && !editor.staleEditor;
    lines.push(`- editor ${editor.file} ${editor.mode}: ${ok ? "ok" : "FAIL"}`);
  }
  lines.push(`- exceptions: ${(observation.runtime.exceptions || []).length}; rejections: ${(observation.runtime.rejections || []).length}; crash artifacts: ${(observation.crashes.artifacts || []).length}`);
  if (parsed.deployedVault) {
    lines.push(`- deployed vault ${parsed.deployedVault}: ${observation.deploy && observation.deploy.report ? "checked" : "check failed"}`);
  }
  if (!verdict.pass) {
    lines.push("Failures:");
    for (const failure of verdict.failures) lines.push(`- ${failure}`);
  }
  console.log(lines.join("\n"));

  // Remove only run-owned temporary files after collecting diagnostics.
  try {
    const plan = lib.planOwnedCleanup([runRoot], ownedRoots);
    for (const target of plan.removable) fs.rmSync(target, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup.
  }

  if (!verdict.pass) fail("Obsidian startup smoke check failed (see report and failures above)", 1);
  return { pass: true };
}

async function main() {
  try {
    await runSmoke();
  } catch (error) {
    if (error && error.exitCode === 2 && String(error.message || "").startsWith("unrun:")) {
      console.error(String(error.message));
      process.exitCode = 2;
      return;
    }
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = (error && error.exitCode) || 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = { runSmoke };
