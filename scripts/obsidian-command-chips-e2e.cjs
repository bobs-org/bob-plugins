#!/usr/bin/env node
// Real-Obsidian command-chips e2e: an owned Obsidian on a scratch profile,
// home, XDG tree, and vault, with Command Mode pointed at a stub `bob` that
// records every invocation. Trusted CDP mouse input drives the chips. Never
// opens the live vault and never runs the real bob.
//   xvfb-run -a node scripts/obsidian-command-chips-e2e.cjs [--out DIR] [-e PATH]
"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const fixture = require("./obsidian-command-chips-e2e-lib.cjs");

const repoRoot = path.resolve(__dirname, "..");
const OVERALL_TIMEOUT_MS = 480_000;
const P = fixture.PAYLOADS;
const N = fixture.NOTES;
const HELP = [
  "Usage: node scripts/obsidian-command-chips-e2e.cjs [OPTIONS]",
  "",
  "Drive inline command chips in an isolated scratch vault over CDP with a stub bob.",
  "Never opens the live vault or runs the real bob. Run under xvfb-run -a on Linux.",
  "",
  "Options:",
  "  -e, --executable PATH     Obsidian executable (default: $OBSIDIAN_BIN or /snap/bin/obsidian)",
  "  -q, --query-plugins DIR   Installed .obsidian/plugins to copy Tasks and Dataview from",
  "  -o, --out DIRECTORY       Screenshot and report directory outside this repo",
  "  -r, --report PATH         Write the structured JSON report",
  "  -k, --keep                Keep the scratch run root for inspection",
  "  -s, --self-test           Run offline fixture and isolation self-tests",
  "  -h, --help                Print this help and exit",
].join("\n");

function parseArgs(argv) {
  const args = { executable: null, queryPlugins: null, out: null, report: null, keep: false, selfTest: false, help: false };
  const list = Array.isArray(argv) ? argv.slice() : [];
  const value = (index, flag, kind) => {
    const item = list[index];
    if (!item || item.startsWith("-")) throw new Error(flag + " requires a " + kind + " value");
    return item;
  };
  for (let i = 0; i < list.length; i += 1) {
    const token = list[i];
    if (token === "-e" || token === "--executable") args.executable = value(++i, "--executable", "PATH");
    else if (token === "-q" || token === "--query-plugins") args.queryPlugins = value(++i, "--query-plugins", "DIR");
    else if (token === "-o" || token === "--out") args.out = value(++i, "--out", "DIRECTORY");
    else if (token === "-r" || token === "--report") args.report = value(++i, "--report", "PATH");
    else if (token === "-k" || token === "--keep") args.keep = true;
    else if (token === "-s" || token === "--self-test") args.selfTest = true;
    else if (token === "-h" || token === "--help") args.help = true;
    else throw new Error("Unknown argument: " + token);
  }
  return args;
}

// An explicit override never falls back to another Obsidian.
function findExecutable(override) {
  for (const candidate of (override ? [override] : [process.env.OBSIDIAN_BIN, "/snap/bin/obsidian"]).filter(Boolean)) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch (_error) {
      continue;
    }
  }
  return null;
}

function defaultQueryPlugins() {
  const dir = path.join(os.homedir(), "bob", ".obsidian", "plugins");
  return fs.existsSync(dir) ? dir : null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
    socket.addEventListener("message", (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch (_error) { return; }
      const item = this.pending.get(message.id);
      if (!item) return;
      this.pending.delete(message.id);
      clearTimeout(item.timer);
      if (message.error) item.reject(new Error(item.method + ": " + message.error.message));
      else item.resolve(message.result || {});
    });
    socket.addEventListener("close", () => {
      this.closed = true;
      for (const item of this.pending.values()) {
        clearTimeout(item.timer);
        item.reject(new Error(item.method + ": CDP socket closed"));
      }
      this.pending.clear();
    });
  }

  static async connect(endpoint) {
    let Socket = typeof globalThis.WebSocket === "function" ? globalThis.WebSocket : null;
    if (!Socket) {
      try { Socket = require("undici").WebSocket; } catch (_error) { Socket = null; }
    }
    if (!Socket) throw new Error("Node WebSocket support is required (Node 22+, or node --experimental-websocket)");
    const socket = new Socket(endpoint);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP connect timed out")), 15_000);
      socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("CDP connect failed")); }, { once: true });
    });
    return new CdpClient(socket);
  }

  call(method, params, timeoutMs) {
    if (this.closed) return Promise.reject(new Error(method + ": socket is closed"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(method + ": timed out"));
      }, timeoutMs || 20_000);
      this.pending.set(id, { method, resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }

  async evaluate(expression, timeoutMs) {
    const result = await this.call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true }, timeoutMs);
    if (result.exceptionDetails) {
      const details = result.exceptionDetails;
      throw new Error("evaluate failed: " + String((details.exception && details.exception.description) || details.text).slice(0, 500));
    }
    return result.result && result.result.value;
  }

  close() {
    try { this.socket.close(); } catch (_error) { /* Already closed. */ }
  }
}

async function waitFor(client, expression, predicate, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await client.evaluate(expression);
      if (predicate(last)) return last;
    } catch (error) {
      last = String((error && error.message) || error);
    }
    await sleep(120);
  }
  throw new Error("timed out waiting for " + label + ": " + JSON.stringify(last).slice(0, 400));
}

async function waitUntil(predicate, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(120);
  }
  throw new Error("timed out waiting for " + label);
}

async function connectToScratch(port, vaultRealPath, childState) {
  const deadline = Date.now() + 45_000;
  let lastError = "";
  while (Date.now() < deadline) {
    if (childState.exit) throw new Error("owned Obsidian exited before opening the scratch vault: " + childState.exit);
    let targets = [];
    try {
      targets = await fetch("http://127.0.0.1:" + port + "/json/list").then((response) => response.json());
    } catch (error) {
      lastError = String((error && error.message) || error);
    }
    for (const target of Array.isArray(targets) ? targets : []) {
      if (target.type !== "page" || !target.webSocketDebuggerUrl) continue;
      let client = null;
      try {
        client = await CdpClient.connect(target.webSocketDebuggerUrl);
        const base = await client.evaluate("(() => { const a = window.app && window.app.vault && window.app.vault.adapter; return a && typeof a.basePath === 'string' ? a.basePath : null; })()", 5000);
        if (base && path.resolve(base) === path.resolve(vaultRealPath)) return client;
      } catch (error) {
        lastError = String((error && error.message) || error);
      }
      if (client) client.close();
    }
    await sleep(350);
  }
  throw new Error("no CDP page reports the scratch vault" + (lastError ? ": " + lastError.slice(0, 200) : ""));
}

async function dismissTrust(client) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const clicked = await client.evaluate("(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /Trust author and enable plugins/i.test(x.textContent || '')); if (!b) return false; b.click(); return true; })()").catch(() => false);
    if (clicked) {
      await sleep(800);
      return true;
    }
    if (await client.evaluate("Boolean(window.app.plugins.plugins['bob-chips'])").catch(() => false)) return false;
    await sleep(200);
  }
  return false;
}

async function openNote(client, notePath, mode) {
  return client.evaluate(`(async () => {
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(notePath)});
    if (!file) return { ok: false, error: "missing note" };
    const leaf = app.workspace.getLeaf(false);
    await leaf.openFile(file);
    const view = leaf.view;
    const state = (view.getState && view.getState()) || {};
    const want = ${JSON.stringify(mode)};
    await view.setState(Object.assign({}, state, want === "preview" ? { mode: "preview" } : { mode: "source", source: false }), { history: false });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { ok: true, mode: view.getMode && view.getMode() };
  })()`, 20_000);
}

// Page helpers: find chips by their full command text (the tooltip's
// command rows, which name every step), report faces, and keep a WeakSet of
// hosts already seen so a rebuild is observable.
const PAGE_HELPERS = `(() => {
  const FACES = ["ready","armed","loading","queued","running","completed","attention","failed","unavailable","copy"];
  const seen = new WeakSet();
  const rows = (el) => Array.from(el.querySelectorAll(".bob-run-chip-tip-row.is-command")).map((row) => row.textContent).join(" && ");
  const visible = (el) => el.isConnected && el.getClientRects().length > 0;
  const scopeRoot = (scope) => {
    if (scope === "popover") return document.querySelector(".popover.hover-popover") || document.createElement("div");
    const leaf = app.workspace.activeLeaf;
    const host = leaf && leaf.view && leaf.view.containerEl;
    if (!host) return document;
    const mode = leaf.view.getMode && leaf.view.getMode();
    return host.querySelector(mode === "preview" ? ".markdown-reading-view" : ".markdown-source-view") || host;
  };
  window.__e2e = {
    chips(payload, scope, within) {
      let list = Array.from(scopeRoot(scope).querySelectorAll(".bob-run-chip")).filter((el) => visible(el) && rows(el) === payload);
      if (within) list = list.filter((el) => el.closest(within));
      return list;
    },
    face(el) { return el ? (FACES.find((name) => el.classList.contains("is-" + name)) || null) : null; },
    describe(payload, scope, within) {
      return this.chips(payload, scope, within).map((el) => ({
        face: this.face(el),
        tag: el.tagName,
        seen: seen.has(el),
        state: (el.querySelector(".bob-run-chip-tip-row.is-state") || {}).textContent || null,
        query: Boolean(el.closest(".plugin-tasks-list-item, .dataview")),
        embed: Boolean(el.closest(".internal-embed, .markdown-embed")),
      }));
    },
    mark(payload, scope) { for (const el of this.chips(payload, scope)) seen.add(el); return true; },
    point(payload, scope, index, within) {
      const el = this.chips(payload, scope, within)[index || 0];
      if (!el) return null;
      el.scrollIntoView({ block: "center", inline: "nearest" });
      const r = el.getClientRects()[0];
      return { x: r.left + Math.min(r.width / 2, 24), y: r.top + r.height / 2, face: this.face(el) };
    },
    notices() { return Array.from(document.querySelectorAll(".notice")).map((el) => el.textContent); },
    modals() { return Array.from(document.querySelectorAll(".modal-container")).map((el) => ({ pager: Boolean(el.querySelector(".bob-cmd-pager-view")), sheet: Boolean(el.querySelector(".bob-cmd-sheet")), text: (el.textContent || "").slice(0, 160) })); },
  };
  return true;
})()`;

async function mouseClick(client, point, options = {}) {
  const modifiers = options.shift ? 8 : 0;
  await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, modifiers });
  const count = options.count || 1;
  for (let n = 1; n <= count; n += 1) {
    await client.call("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: n, modifiers });
    await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: n, modifiers });
    if (n < count) await sleep(60);
  }
}

async function clickChip(client, payload, options = {}) {
  if (!options.keepModals) await closeModals(client);
  const point = await client.evaluate(`window.__e2e.point(${JSON.stringify(payload)}, ${JSON.stringify(options.scope || null)}, ${options.index || 0}, ${JSON.stringify(options.within || null)})`);
  if (!point) throw new Error("no visible chip for " + payload + (options.within ? " within " + options.within : ""));
  await sleep(150);
  const fresh = await client.evaluate(`window.__e2e.point(${JSON.stringify(payload)}, ${JSON.stringify(options.scope || null)}, ${options.index || 0}, ${JSON.stringify(options.within || null)})`);
  await mouseClick(client, fresh || point, options);
  return fresh || point;
}

async function describe(client, payload, scope, within) {
  return client.evaluate(`window.__e2e.describe(${JSON.stringify(payload)}, ${JSON.stringify(scope || null)}, ${JSON.stringify(within || null)})`);
}

async function waitFace(client, payload, faces, label, options = {}) {
  return waitFor(client, `window.__e2e.describe(${JSON.stringify(payload)}, ${JSON.stringify(options.scope || null)}, ${JSON.stringify(options.within || null)})`,
    (list) => Array.isArray(list) && list.length > 0 && faces.includes(list[options.index || 0].face), label, options.timeoutMs || 20_000);
}

async function closeModals(client) {
  for (let n = 0; n < 4; n += 1) {
    const open = await client.evaluate("document.querySelectorAll('.modal-container').length");
    if (!open) return true;
    await client.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await client.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await sleep(300);
  }
  return false;
}

async function clipboard(client) {
  return client.evaluate("navigator.clipboard.readText().catch((e) => 'unreadable:' + e.message)");
}

async function screenshot(client, outDir, name) {
  const shot = await client.call("Page.captureScreenshot", { format: "png" });
  const file = path.join(outDir, name);
  fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
  return file;
}

// Rendering, scrolling, hovering, hover previews, print media, and an
// export-style off-screen render must never invoke bob.
async function inertPhase(ctx) {
  const { client, scratch, record } = ctx;
  const before = fixture.runInvocations(scratch).length;
  const everyPayload = Object.values(P);
  for (const note of Object.values(N)) {
    for (const mode of ["live", "preview"]) {
      await openNote(client, note, mode);
      await sleep(700);
      await client.evaluate(`(async () => {
        const view = app.workspace.activeLeaf.view;
        const scroller = view.containerEl.querySelector(view.getMode() === "preview" ? ".markdown-preview-view" : ".cm-scroller");
        if (scroller) for (let y = 0; y <= scroller.scrollHeight; y += 200) { scroller.scrollTop = y; await new Promise((r) => setTimeout(r, 30)); }
        if (scroller) scroller.scrollTop = 0;
        return true;
      })()`);
      for (const payload of everyPayload) {
        const point = await client.evaluate(`window.__e2e.point(${JSON.stringify(payload)}, null, 0)`);
        if (point) await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
      }
    }
  }
  await openNote(client, N.dashboard, "preview");
  await sleep(1500);
  const hover = await client.evaluate(`(async () => {
    const view = app.workspace.activeLeaf.view;
    const link = view.containerEl.querySelector('.markdown-preview-view a.internal-link[data-href="ref/Ref chips"]');
    if (!link) return { ok: false, reason: "no hover link" };
    const r = link.getBoundingClientRect();
    app.workspace.trigger("hover-link", { event: new MouseEvent("mouseover", { clientX: r.left + 2, clientY: r.top + 2, ctrlKey: true }), source: "preview", hoverParent: view, targetEl: link, linktext: "ref/Ref chips", sourcePath: view.file.path });
    for (let n = 0; n < 40; n += 1) {
      await new Promise((r2) => setTimeout(r2, 100));
      if (document.querySelector(".popover.hover-popover .bob-run-chip")) return { ok: true };
    }
    return { ok: false, reason: "no popover chip" };
  })()`);
  ctx.hoverPopover = hover;
  await client.call("Emulation.setEmulatedMedia", { media: "print" });
  await sleep(400);
  // Obsidian's print stylesheet hides the workspace, so read computed
  // styles without a visibility filter.
  const printFaces = await client.evaluate("Array.from(document.querySelectorAll('.markdown-reading-view .bob-run-chip')).map((el) => getComputedStyle(el.querySelector('.bob-run-chip-glyph')).display + '|' + getComputedStyle(el).borderTopStyle)");
  await client.call("Emulation.setEmulatedMedia", { media: "" });
  // Page scripts cannot require("obsidian"); find MarkdownRenderer and
  // Component through a live reading view's constructor chain, else render
  // each note in a background leaf the way export does.
  const exported = await client.evaluate(`(async () => {
    const chain = (ctor) => { const out = []; while (ctor && ctor !== Function.prototype) { out.push(ctor); ctor = Object.getPrototypeOf(ctor); } return out; };
    let Renderer = null;
    let Component = null;
    for (const leaf of app.workspace.getLeavesOfType("markdown")) {
      const renderer = leaf.view && leaf.view.previewMode && leaf.view.previewMode.renderer;
      Renderer = Renderer || chain(renderer && renderer.constructor).find((ctor) => typeof ctor.render === "function") || null;
      const base = chain(leaf.view && leaf.view.constructor);
      Component = Component || base[base.length - 1] || null;
    }
    let chips = 0;
    if (Renderer && Component) {
      for (const file of app.vault.getMarkdownFiles()) {
        const el = document.createElement("div");
        const component = new Component();
        component.load();
        await Renderer.render(app, await app.vault.read(file), el, file.path, component);
        await new Promise((r) => setTimeout(r, 200));
        chips += el.querySelectorAll(".bob-run-chip").length;
        component.unload();
      }
      return { ok: chips > 0, via: "MarkdownRenderer.render", chips };
    }
    const leaf = app.workspace.getLeaf("tab");
    for (const file of app.vault.getMarkdownFiles()) {
      await leaf.openFile(file, { active: false, state: { mode: "preview" } });
      await new Promise((r) => setTimeout(r, 400));
      chips += leaf.view.containerEl.querySelectorAll(".bob-run-chip").length;
    }
    leaf.detach();
    return { ok: chips > 0, via: "background preview leaf", chips };
  })()`, 60_000);
  await sleep(1200);
  const after = fixture.runInvocations(scratch).length;
  record("render, scroll, hover, hover preview, print media, and off-screen render invoke nothing", after === before && hover.ok && printFaces.length > 0 && printFaces.every((v) => v === "none|none") && exported.ok,
    JSON.stringify({ invocations: after - before, hover, printFaces: printFaces.length, printPlain: printFaces.every((v) => v === "none|none"), exported }));
  await client.evaluate("document.querySelectorAll('.popover.hover-popover').forEach((el) => el.remove()) || true");
}

async function activationPhase(ctx) {
  const { client, scratch, record, outDir } = ctx;
  const runs = (payload) => fixture.countRuns(scratch, payload);
  const mainBefore = fs.readFileSync(path.join(scratch.vaultRealPath, N.main), "utf8");

  // 1. One click, exact argv once, in the scratch vault.
  await openNote(client, N.main, "live");
  await waitFace(client, P.click, ["ready"], "click chip ready");
  await clickChip(client, P.click);
  await waitUntil(() => runs(P.click) === 1, "click run");
  await sleep(1200);
  const clickLog = fixture.runInvocations(scratch).filter((item) => item.argv.join(" ") === "e2e ok click");
  record("click invokes exact argv once in the scratch vault", runs(P.click) === 1 && clickLog.every((item) => item.cwd === scratch.vaultRealPath && item.bobDir === scratch.vaultRealPath),
    JSON.stringify(clickLog.map((item) => ({ argv: item.argv, cwd: item.cwd === scratch.vaultRealPath, bobDir: item.bobDir === scratch.vaultRealPath }))));

  // 2. A double-click and a second mounted twin never duplicate a run.
  await clickChip(client, P.double, { count: 2 });
  await waitFace(client, P.double, ["queued", "running"], "double-click run live");
  await sleep(1000);
  const doubleRuns = runs(P.double);
  // The second press may open the live run's output; close it first.
  const doubleModals = await client.evaluate("window.__e2e.modals()");
  await closeModals(client);
  await clickChip(client, P.twin, { index: 0 });
  await waitFace(client, P.twin, ["queued", "running"], "twin run live");
  await sleep(500);
  await clickChip(client, P.twin, { index: 1 });
  await sleep(1200);
  const twinRuns = runs(P.twin);
  const twinFaces = await describe(client, P.twin);
  const twinModals = await client.evaluate("window.__e2e.modals()");
  await closeModals(client);
  fixture.openGate(scratch, "double");
  fixture.openGate(scratch, "twin");
  await waitFace(client, P.double, ["completed", "ready"], "double settles", { timeoutMs: 30_000 });
  await waitFace(client, P.twin, ["completed", "ready"], "twin settles", { timeoutMs: 30_000 });
  record("double-click runs once", doubleRuns === 1 && runs(P.double) === 1, JSON.stringify({ runs: runs(P.double), outputOpened: doubleModals.some((item) => item.pager) }));
  record("second mounted twin opens output instead of running again", twinRuns === 1 && runs(P.twin) === 1 && twinFaces.length === 2 && twinFaces.every((item) => ["queued", "running"].includes(item.face)),
    JSON.stringify({ runs: runs(P.twin), faces: twinFaces.map((item) => item.face), outputOpened: twinModals.some((item) => item.pager) }));

  // 3. A chip on a task line never toggles the checkbox.
  await clickChip(client, P.task);
  await waitUntil(() => runs(P.task) === 1, "task-line run");
  await sleep(800);
  const mainAfter = fs.readFileSync(path.join(scratch.vaultRealPath, N.main), "utf8");
  record("task-line chip runs once and leaves the note bytes unchanged", runs(P.task) === 1 && mainAfter === mainBefore && mainAfter.includes("- [ ] TASK_LINE"), "runs=" + runs(P.task));

  // 4. Sequences: attention continues to one summary; failure at step 2 stops step 3.
  await clickChip(client, P.seqAttention);
  await waitFace(client, P.seqAttention, ["attention"], "attention sequence settles", { timeoutMs: 30_000 });
  const seqA = ["bob e2e ok seq-a1", "bob e2e attention seq-a2", "bob e2e ok seq-a3"].map(runs);
  const seqAState = (await describe(client, P.seqAttention))[0];
  record("three-step sequence continues past attention to one attention summary", seqA.every((n) => n === 1) && /attention/i.test(seqAState.state || ""), JSON.stringify({ runs: seqA, state: seqAState.state }));
  await clickChip(client, P.seqFail);
  await waitFace(client, P.seqFail, ["failed"], "failing sequence settles", { timeoutMs: 30_000 });
  await sleep(2400);
  const seqF = ["bob e2e ok seq-f1", "bob e2e fail seq-f2", "bob e2e ok seq-f3"].map(runs);
  const seqFState = (await describe(client, P.seqFail))[0];
  record("failure at step 2 stops step 3 and failed ink persists", seqF[0] === 1 && seqF[1] === 1 && seqF[2] === 0 && seqFState.face === "failed" && /^Failed/.test(seqFState.state || ""), JSON.stringify({ runs: seqF, face: seqFState.face, state: seqFState.state }));
  ctx.shots.push(await screenshot(client, outDir, "live-preview-after-runs.png"));

  // 5. Shift opens the guarded path; confirm waits for acceptance; reports open output.
  await clickChip(client, P.shift, { shift: true });
  await sleep(1200);
  const shiftModals = await client.evaluate("window.__e2e.modals()");
  const shiftFace = (await describe(client, P.shift))[0];
  await closeModals(client);
  record("Shift+Click opens Command Mode without running", runs(P.shift) === 0 && shiftModals.length > 0 && !["queued", "running"].includes(shiftFace.face), JSON.stringify({ runs: runs(P.shift), modals: shiftModals, face: shiftFace.face }));
  await clickChip(client, P.confirm);
  await sleep(1200);
  const confirmModals = await client.evaluate("window.__e2e.modals()");
  const confirmFace = (await describe(client, P.confirm))[0];
  await closeModals(client);
  await sleep(600);
  record("confirm command opens its review and does not run before acceptance", runs(P.confirm) === 0 && confirmModals.length > 0 && !["queued", "running"].includes(confirmFace.face), JSON.stringify({ runs: runs(P.confirm), modals: confirmModals, face: confirmFace.face }));
  await clickChip(client, P.report);
  await waitUntil(() => runs(P.report) === 1, "report run", 20_000);
  await sleep(1500);
  const reportModals = await client.evaluate("window.__e2e.modals()");
  await closeModals(client);
  const reportFace = (await describe(client, P.report))[0];
  record("report runs once and opens its output; the chip is not left running", runs(P.report) === 1 && reportModals.some((item) => item.pager) && !["queued", "running"].includes(reportFace.face), JSON.stringify({ runs: runs(P.report), modals: reportModals.map((item) => item.pager), face: reportFace.face }));

  // 6. Unavailable refuses with its reason; nothing runs.
  await clickChip(client, P.elsewhere);
  await sleep(800);
  const refusal = await client.evaluate("window.__e2e.notices()");
  record("unavailable command refuses with a reason and never runs", runs(P.elsewhere) === 0 && refusal.some((text) => /not available on this host/.test(text)), JSON.stringify({ runs: runs(P.elsewhere), notices: refusal }));

  // 7. Copy chips and fence cards still copy beside run chips.
  await client.evaluate(`(() => { const chip = Array.from(document.querySelectorAll('.markdown-source-view .bob-copy-chip')).find((el) => (el.textContent || '').includes('ssh e2e-host')); chip.scrollIntoView({ block: 'center' }); return true; })()`);
  const copyPoint = await client.evaluate(`(() => { const chip = Array.from(document.querySelectorAll('.markdown-source-view .bob-copy-chip')).find((el) => (el.textContent || '').includes('ssh e2e-host')); const r = chip.getClientRects()[0]; return { x: r.left + 12, y: r.top + r.height / 2 }; })()`);
  await mouseClick(client, copyPoint);
  await sleep(500);
  const spanCopy = await clipboard(client);
  const cardPointIn = async (root) => {
    await client.evaluate(`(() => { const b = document.querySelector(${JSON.stringify(root)} + ' .bob-copy-fence-copy'); b.scrollIntoView({ block: 'center' }); return true; })()`);
    await sleep(400);
    return client.evaluate(`(() => { const b = document.querySelector(${JSON.stringify(root)} + ' .bob-copy-fence-copy'); const r = b.getBoundingClientRect(); const x = r.left + r.width / 2; const y = r.top + r.height / 2; const hit = document.elementFromPoint(x, y); return { x, y, hit: hit ? hit.className : null, onButton: Boolean(hit && b.contains(hit)) }; })()`);
  };
  // Live Preview: a trusted press on the card (diagnostic only; see report).
  const liveCard = await cardPointIn(".markdown-source-view");
  await client.evaluate("navigator.clipboard.writeText('-') && true");
  await mouseClick(client, liveCard);
  await sleep(500);
  const liveCardCopy = await clipboard(client);
  await openNote(client, N.main, "preview");
  await sleep(800);
  const readingCard = await cardPointIn(".markdown-reading-view");
  await mouseClick(client, readingCard);
  await sleep(500);
  const cardCopy = await clipboard(client);
  record("copy span and bob-copy card still copy beside run chips", spanCopy === "ssh e2e-host" && cardCopy === "card body",
    JSON.stringify({ spanCopy, readingCardCopy: cardCopy, readingHit: readingCard.hit, livePreviewCardCopy: liveCardCopy, livePreviewHit: liveCard.hit, livePreviewOnButton: liveCard.onButton }));

  // 8. Stale source: the note changes under a rendered Reading button.
  await openNote(client, N.main, "preview");
  await waitFace(client, P.stale, ["ready"], "stale chip ready (reading)");
  const stale = await client.evaluate(`(async () => {
    const button = window.__e2e.chips(${JSON.stringify(P.stale)})[0];
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(N.main)});
    const text = await app.vault.read(file);
    await app.vault.modify(file, text.replace(${JSON.stringify(P.stale)}, "bob e2e ok stale-changed"));
    const connected = button.isConnected;
    button.click();
    await new Promise((r) => setTimeout(r, 1500));
    return { connected };
  })()`);
  const staleRuns = runs(P.stale) + runs("bob e2e ok stale-changed");
  await client.evaluate(`(async () => { const file = app.vault.getAbstractFileByPath(${JSON.stringify(N.main)}); await app.vault.modify(file, ${JSON.stringify(mainBefore)}); return true; })()`);
  record("stale-source activation performs no run", staleRuns === 0, JSON.stringify({ runs: staleRuns, buttonStillMounted: stale.connected }));

  // 9. A stub rewrite of the note mid-run: feedback and click-to-output survive.
  await openNote(client, N.rewrite, "live");
  await waitFace(client, P.rewrite, ["ready"], "rewrite chip ready");
  await client.evaluate(`window.__e2e.mark(${JSON.stringify(P.rewrite)})`);
  await clickChip(client, P.rewrite);
  await waitUntil(() => fs.readFileSync(path.join(scratch.vaultRealPath, N.rewrite), "utf8").includes("Rewritten by the stub"), "stub rewrite", 20_000);
  await waitFor(client, "app.workspace.activeLeaf.view.editor.getValue()", (value) => String(value).includes("Rewritten by the stub"), "editor reload after rewrite");
  await sleep(600);
  const afterRewrite = await describe(client, P.rewrite);
  // A fresh editor in a new tab mounts new widgets; the old tab goes away.
  await client.evaluate(`(async () => {
    const old = app.workspace.activeLeaf;
    const leaf = app.workspace.getLeaf("tab");
    await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(N.rewrite)}), { state: { mode: "source", source: false } });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    old.detach();
    await new Promise((r) => setTimeout(r, 600));
    return true;
  })()`);
  const afterRebuild = await describe(client, P.rewrite);
  await clickChip(client, P.rewrite);
  await sleep(1200);
  const rewriteModals = await client.evaluate("window.__e2e.modals()");
  await closeModals(client);
  const rewriteRuns = runs(P.rewrite);
  fixture.openGate(scratch, "rewrite");
  await waitFace(client, P.rewrite, ["completed", "ready"], "rewrite settles", { timeoutMs: 30_000 });
  record("stub rewrite and a fresh mount keep live feedback; a click opens output", rewriteRuns === 1
    && afterRewrite.length === 1 && ["queued", "running"].includes(afterRewrite[0].face)
    && afterRebuild.length === 1 && !afterRebuild[0].seen && ["queued", "running"].includes(afterRebuild[0].face),
  JSON.stringify({ runs: rewriteRuns, afterRewrite: afterRewrite.map((item) => ({ face: item.face, sameNode: item.seen })), afterRebuild: afterRebuild.map((item) => ({ face: item.face, sameNode: item.seen })), outputOpened: rewriteModals.some((item) => item.pager) }));

  // 10. Protected sources copy, even from an allowed dashboard.
  await openNote(client, N.ref, "live");
  await waitFace(client, P.refDirect, ["copy"], "ref chip copy-only");
  await clickChip(client, P.refDirect);
  await sleep(500);
  const refCopy = await clipboard(client);
  record("a ref/ chip copies its exact payload", refCopy === P.refDirect && runs(P.refDirect) === 0, JSON.stringify({ clipboard: refCopy }));
  await openNote(client, N.dashboard, "preview");
  await sleep(2500);
  const dash = {};
  for (const [name, payload] of Object.entries({ refDirect: P.refDirect, embed: P.embed, refTask: P.refTask, queryAllowed: P.queryAllowed, dvField: P.dvField })) {
    dash[name] = await describe(client, payload);
  }
  ctx.shots.push(await screenshot(client, outDir, "dashboard-reading.png"));
  await clickChip(client, P.refDirect, { within: ".internal-embed" });
  await sleep(500);
  const embedCopy = await clipboard(client);
  record("a ref/ embed in an allowed dashboard copies", embedCopy === P.refDirect && runs(P.refDirect) === 0 && dash.refDirect.every((item) => item.face === "copy"), JSON.stringify({ clipboard: embedCopy, faces: dash.refDirect }));
  await clickChip(client, P.embed);
  await waitUntil(() => runs(P.embed) === 1, "allowed embed run");
  record("an allowed embed's chip runs once", runs(P.embed) === 1 && dash.embed.every((item) => item.face === "ready"), JSON.stringify(dash.embed));
  if (scratch.queryPlugins.length === QUERY_COUNT) {
    record("query rows from ref/ copy; rows from allowed notes run; unknown origins copy",
      dash.refTask.length >= 2 && dash.refTask.every((item) => item.face === "copy" && item.query)
      && dash.queryAllowed.length >= 2 && dash.queryAllowed.every((item) => item.face === "ready" && item.query)
      && dash.dvField.length >= 1 && dash.dvField.every((item) => item.face === "copy" && /source note unknown/.test(item.state || "")),
      JSON.stringify({ refTask: dash.refTask, queryAllowed: dash.queryAllowed, dvField: dash.dvField }));
    await clickChip(client, P.refTask, { within: ".plugin-tasks-list-item" });
    await sleep(500);
    const taskCopy = await clipboard(client);
    await clickChip(client, P.queryAllowed, { within: ".plugin-tasks-list-item" });
    await waitUntil(() => runs(P.queryAllowed) === 1, "Tasks allowed row run");
    await clickChip(client, P.dvField);
    await sleep(500);
    const dvCopy = await clipboard(client);
    record("Tasks ref row copies, Tasks allowed row runs once, Dataview table cell copies", taskCopy === P.refTask && runs(P.refTask) === 0 && runs(P.queryAllowed) === 1 && dvCopy === P.dvField && runs(P.dvField) === 0,
      JSON.stringify({ taskCopy, dvCopy, allowedRuns: runs(P.queryAllowed) }));
  } else {
    record("query adapters (Tasks/Dataview) available", false, "installed Tasks and Dataview were not found; pass --query-plugins DIR");
  }
  const hover = await client.evaluate(`(async () => {
    const view = app.workspace.activeLeaf.view;
    const link = view.containerEl.querySelector('.markdown-preview-view a.internal-link[data-href="ref/Ref chips"]');
    const r = link.getBoundingClientRect();
    app.workspace.trigger("hover-link", { event: new MouseEvent("mouseover", { clientX: r.left + 2, clientY: r.top + 2, ctrlKey: true }), source: "preview", hoverParent: view, targetEl: link, linktext: "ref/Ref chips", sourcePath: view.file.path });
    for (let n = 0; n < 40; n += 1) {
      await new Promise((r2) => setTimeout(r2, 100));
      if (document.querySelector(".popover.hover-popover .bob-run-chip")) return true;
    }
    return false;
  })()`);
  let hoverCopy = null;
  if (hover) {
    await clickChip(client, P.refDirect, { scope: "popover" });
    await sleep(500);
    hoverCopy = await clipboard(client);
  }
  record("a ref/ hover preview copies", hover && hoverCopy === P.refDirect && runs(P.refDirect) === 0, JSON.stringify({ hover, clipboard: hoverCopy }));

  // 11. Nothing else ran: the full invocation log matches the cases above.
  const expected = {
    "e2e ok click": 1, "e2e slow double": 1, "e2e slow twin": 1, "e2e ok task": 1,
    "e2e ok seq-a1": 1, "e2e attention seq-a2": 1, "e2e ok seq-a3": 1,
    "e2e ok seq-f1": 1, "e2e fail seq-f2": 1, "e2e report": 1, "e2e rewrite": 1,
    "e2e ok embed-allowed": 1,
  };
  if (scratch.queryPlugins.length === QUERY_COUNT) expected["e2e ok query-allowed"] = 1;
  const actual = {};
  for (const item of fixture.runInvocations(scratch)) actual[item.argv.join(" ")] = (actual[item.argv.join(" ")] || 0) + 1;
  record("the stub saw exactly the expected invocations", JSON.stringify(Object.entries(actual).sort()) === JSON.stringify(Object.entries(expected).sort()), JSON.stringify(actual));
}

const QUERY_COUNT = fixture.QUERY_PLUGINS.length;

async function runE2e(args) {
  const executable = findExecutable(args.executable);
  if (!executable) {
    console.log(JSON.stringify({ status: "skipped", reason: "Obsidian executable is unavailable: " + (args.executable || process.env.OBSIDIAN_BIN || "/snap/bin/obsidian") }, null, 2));
    return;
  }
  if (!process.env.DISPLAY && !process.env.XVFB_RUN_TMPDIR) {
    console.log(JSON.stringify({ status: "skipped", reason: "no X display; rerun under xvfb-run -a" }, null, 2));
    return;
  }
  const outDir = path.resolve(args.out || path.join("/tmp", "bob-command-chips-e2e-" + Date.now()));
  if (fixture.within(repoRoot, outDir)) throw new Error("--out must be outside the bob-plugins repository");
  fs.mkdirSync(outDir, { recursive: true });
  const runRoot = fs.mkdtempSync(path.join("/tmp", "bcr-"));
  const scratch = fixture.makeFixture(runRoot, { queryPluginsDir: args.queryPlugins || defaultQueryPlugins() });
  const isolation = fixture.isolationReport(scratch, require("./command-mode-harness.cjs").helpers);
  const report = { executable, vault: scratch.vaultRealPath, queryPlugins: scratch.queryPlugins, isolation, cases: [], shots: [], pass: false, out: outDir };
  const record = (name, ok, detail) => {
    report.cases.push({ name, ok: Boolean(ok), detail: detail || "" });
    console.log((ok ? "PASS " : "FAIL ") + name + (detail ? " (" + String(detail).slice(0, 400) + ")" : ""));
  };
  record("scratch fixture is isolated", isolation.failures.length === 0, JSON.stringify(isolation));
  const port = await freePort();
  const child = spawn(executable, ["--no-sandbox", "--user-data-dir=" + scratch.profileDir, "--remote-debugging-port=" + port, "--remote-allow-origins=http://127.0.0.1/*", scratch.vaultRealPath], {
    cwd: scratch.vaultRealPath,
    detached: true,
    env: fixture.obsidianEnv(scratch),
    stdio: "ignore",
  });
  const childState = { exit: "" };
  child.once("exit", (code, signal) => { childState.exit = "code=" + code + " signal=" + (signal || "none"); });
  let client = null;
  try {
    if (isolation.failures.length) throw new Error("isolation self-check failed; refusing to launch");
    client = await connectToScratch(port, scratch.vaultRealPath, childState);
    await client.call("Page.enable");
    await client.call("Runtime.enable");
    await waitFor(client, "Boolean(window.app && app.workspace && app.workspace.layoutReady)", (v) => v === true, "layout ready", 40_000);
    await dismissTrust(client);
    const loaded = await waitFor(client, `(() => {
      const plugins = app.plugins.plugins;
      const cm = plugins["bob-command-mode"];
      const catalog = cm && cm.commandModeCatalog;
      return {
        chips: Boolean(plugins["bob-chips"]),
        chipsVersion: app.plugins.manifests["bob-chips"] && app.plugins.manifests["bob-chips"].version,
        commandModeVersion: app.plugins.manifests["bob-command-mode"] && app.plugins.manifests["bob-command-mode"].version,
        entries: catalog && Array.isArray(catalog.entries) ? catalog.entries.length : 0,
        bob: cm && cm.commandModeResolveBob ? cm.commandModeResolveBob() : null,
        home: window.process && process.env.HOME,
        tasks: Boolean(plugins["obsidian-tasks-plugin"]),
        dataview: Boolean(plugins["dataview"]),
      };
    })()`, (v) => v && v.chips && v.entries === fixture.CATALOG.entries.length && (scratch.queryPlugins.length < QUERY_COUNT || (v.tasks && v.dataview)), "plugins and stub catalog", 40_000);
    report.app = loaded;
    record("plugins load and Command Mode reads the stub catalog", loaded.bob && loaded.bob.path === scratch.stubPath && loaded.home === scratch.homeDir, JSON.stringify(loaded));
    await client.evaluate(PAGE_HELPERS);
    const ctx = { client, scratch, record, outDir, shots: report.shots };
    await inertPhase(ctx);
    await activationPhase(ctx);
  } catch (error) {
    record("e2e completed without an exception", false, String((error && error.stack) || error));
  } finally {
    if (client) client.close();
    try { process.kill(-child.pid, "SIGTERM"); } catch (_error) { /* Already gone. */ }
    await sleep(500);
    report.log = fixture.readLog(scratch).map((item) => ({ kind: item.kind, argv: item.argv }));
    report.pass = report.cases.length > 0 && report.cases.every((item) => item.ok);
    const json = JSON.stringify(report, null, 2);
    fs.writeFileSync(path.join(outDir, "report.json"), json);
    if (args.report) fs.writeFileSync(path.resolve(args.report), json);
    if (!args.keep) fs.rmSync(runRoot, { recursive: true, force: true });
    console.log(report.pass ? "E2E PASS" : "E2E FAIL");
    if (!report.pass) process.exitCode = 1;
  }
}

// Offline: the fixture, the stub, and every isolation boundary, with no
// Obsidian. Runs the stub exactly as Obsidian's children would.
function runSelfTest() {
  const { spawnSync } = require("node:child_process");
  const cm = require("./command-mode-harness.cjs").helpers;
  const chips = require("./copy-chips-test-helpers.cjs").helpers;
  assert.equal(cm.cmValidateCatalog(JSON.parse(JSON.stringify(fixture.CATALOG))).ok, true, "fixture catalog validates");
  const resolve = (text) => cm.cmResolveCommandText(fixture.CATALOG, text, { host: "e2e-self-test", catalogStatus: "ready" });
  for (const [name, payload] of Object.entries(P)) {
    const verdict = resolve(payload);
    const want = name === "elsewhere" ? "unavailable" : "ready";
    assert.equal(verdict.state, want, name + " resolves " + want + ": " + verdict.reason);
  }
  assert.equal(resolve(P.seqAttention).steps.length, 3);
  assert.deepEqual(resolve(P.click).steps[0].argv, ["e2e", "ok", "click"]);
  assert.equal(resolve(P.confirm).steps[0].policy, "confirm");
  assert.equal(resolve(P.report).steps[0].presentation, "report");
  assert.equal(resolve("bob plan").state, "invalid", "nothing outside the stub catalog resolves");
  const notes = fixture.noteText();
  const authored = [];
  for (const text of Object.values(notes)) {
    for (const line of text.split("\n")) for (const chip of chips.chipScanLine(line)) if (chip.kind === "run") authored.push(chip.text);
  }
  for (const payload of Object.values(P)) assert.ok(authored.includes(payload), "a note authors " + payload);
  assert.equal(authored.filter((text) => text === P.twin).length, 2, "the twin chip is mounted twice");

  const runRoot = fs.mkdtempSync(path.join("/tmp", "bcr-self-"));
  try {
    const scratch = fixture.makeFixture(runRoot, {});
    const isolation = fixture.isolationReport(scratch, cm);
    assert.deepEqual(isolation.failures, [], "isolation");
    for (const file of Object.keys(fixture.treeSnapshot(scratch.root))) assert.ok(fixture.within(scratch.root, path.join(scratch.root, file)));
    assert.throws(() => fixture.assertScratchVault(path.dirname(runRoot), runRoot), /outside the scratch run root/);
    const env = fixture.obsidianEnv(scratch);
    const stub = (argv) => spawnSync("bob", argv, { env, cwd: scratch.vaultRealPath, encoding: "utf8", timeout: 20_000 });
    const before = fixture.treeSnapshot(scratch.root);
    const catalog = stub(["__catalog", "--protocol", "1"]);
    assert.equal(catalog.status, 0, catalog.stderr);
    assert.equal(cm.cmValidateCatalog(JSON.parse(catalog.stdout)).ok, true);
    assert.equal(stub(["e2e", "ok", "self"]).status, 0);
    assert.equal(stub(["e2e", "attention", "self"]).status, 3);
    assert.equal(stub(["e2e", "fail", "self"]).status, 1);
    assert.match(stub(["e2e", "fail", "self"]).stderr, /^error: /);
    assert.equal(stub(["plan"]).status, 64, "the stub refuses anything but e2e commands");
    fixture.openGate(scratch, "rewrite");
    const rewriteFile = path.join(scratch.vaultRealPath, N.rewrite);
    const rewriteBefore = fs.readFileSync(rewriteFile, "utf8");
    assert.equal(stub(["e2e", "rewrite"]).status, 0);
    const changed = Object.entries(fixture.treeSnapshot(scratch.root)).filter(([file, hash]) => before[file] !== hash).map(([file]) => file).sort();
    assert.deepEqual(changed, ["gates/rewrite", "home/vault/" + N.rewrite, "stub-bob.jsonl"].sort(), "the stub writes only its log and its own scratch note");
    assert.notEqual(fs.readFileSync(rewriteFile, "utf8"), rewriteBefore);
    const log = fixture.readLog(scratch);
    assert.deepEqual(log.map((item) => item.kind), ["catalog", "run", "run", "run", "run", "refused", "run"]);
    assert.ok(log.every((item) => item.cwd === scratch.vaultRealPath && item.bobDir === scratch.vaultRealPath));
    assert.equal(fixture.countRuns(scratch, "bob e2e ok self"), 1);
    assert.equal(fixture.runInvocations(scratch).length, 6);
  } finally {
    fs.rmSync(runRoot, { recursive: true, force: true });
  }
  const args = parseArgs(["-o", "/tmp/shots", "-e", "/snap/bin/obsidian", "-q", "/tmp/plugins", "-k", "-s"]);
  assert.deepEqual(args, { executable: "/snap/bin/obsidian", queryPlugins: "/tmp/plugins", out: "/tmp/shots", report: null, keep: true, selfTest: true, help: false });
  assert.throws(() => parseArgs(["--out"]));
  assert.throws(() => parseArgs(["--wat"]));
  console.log("offline self-test complete (not an Obsidian pass)");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }
  if (args.selfTest) {
    runSelfTest();
    return;
  }
  const timer = setTimeout(() => {
    console.error("overall timeout after " + OVERALL_TIMEOUT_MS + " ms");
    process.exit(2);
  }, OVERALL_TIMEOUT_MS);
  timer.unref();
  await runE2e(args);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(String((error && error.stack) || error));
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, findExecutable, runSelfTest };
