#!/usr/bin/env node
// Real-Obsidian ⌘↵ command-chip e2e (keymap phase): an owned Obsidian on the
// command-chips scratch fixture plus bob-navigation-hotkeys and a vault
// Meta+Enter binding. Trusted CDP key events drive the GTD-shaped rows (line
// chip, task fallback, Bank-shaped row with links), refusals, a no-run
// note, the running keycap, and Vim normal mode. Never opens the live vault
// and never runs the real bob.
//   xvfb-run -a node scripts/obsidian-command-chips-keymap-e2e.cjs [--out DIR] [-e PATH]
"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const fixture = require("./obsidian-command-chips-e2e-lib.cjs");

const repoRoot = path.resolve(__dirname, "..");
const OVERALL_TIMEOUT_MS = 300_000;
const NAV_ID = "bob-navigation-hotkeys";
const DISPATCH_ID = NAV_ID + ":open-reference-pdf-in-highlights";
const GTD = "GTD keymap e2e.md";
const BANK = "Bank keymap e2e.md";
const REF = "ref/Ref keymap e2e.md";
const K = Object.freeze({
  line: "bob e2e ok km-line",
  task: "bob e2e ok km-task",
  bank: "bob e2e ok km-bank",
  linked: "bob e2e ok km-linked",
  twoA: "bob e2e ok km-two-a",
  twoB: "bob e2e ok km-two-b",
  slow: "bob e2e slow km-slow",
  vim: "bob e2e ok km-vim",
  ref: "bob e2e ok km-ref",
  fence1: "bob e2e ok km-fence1",
  fence2: "bob e2e ok km-fence2",
});
// Zero-based rows of the GTD note, by case.
const ROW = Object.freeze({ line: 2, task: 3, bank: 5, linked: 6, two: 8, elsewhere: 9, slow: 10, vim: 11, plain: 12, fence: 15 });
const HELP = [
  "Usage: node scripts/obsidian-command-chips-keymap-e2e.cjs [OPTIONS]",
  "",
  "Drive ⌘↵ (Meta+Enter) on command chips in an isolated scratch vault over CDP with a stub bob.",
  "Never opens the live vault or runs the real bob. Run under xvfb-run -a on Linux.",
  "",
  "Options:",
  "  -e, --executable PATH   Obsidian executable (default: $OBSIDIAN_BIN or /snap/bin/obsidian)",
  "  -o, --out DIRECTORY     Screenshot and report directory outside this repo",
  "  -k, --keep              Keep the scratch run root for inspection",
  "  -s, --self-test         Run offline fixture and isolation self-tests",
  "  -h, --help              Print this help and exit",
].join("\n");

function parseArgs(argv) {
  const args = { executable: null, out: null, keep: false, selfTest: false, help: false };
  const list = Array.isArray(argv) ? argv.slice() : [];
  for (let i = 0; i < list.length; i += 1) {
    const token = list[i];
    const next = () => {
      const item = list[++i];
      if (!item || item.startsWith("-")) throw new Error(token + " requires a value");
      return item;
    };
    if (token === "-e" || token === "--executable") args.executable = next();
    else if (token === "-o" || token === "--out") args.out = next();
    else if (token === "-k" || token === "--keep") args.keep = true;
    else if (token === "-s" || token === "--self-test") args.selfTest = true;
    else if (token === "-h" || token === "--help") args.help = true;
    else throw new Error("Unknown argument: " + token);
  }
  return args;
}

function gtdText() {
  return [
    "# GTD keymap e2e",
    "",
    "- [ ] #task #gtd **Line** `run: " + K.line + "` ^kmline",
    "- [ ] #task #gtd **Fallback** ^kmtask",
    "    - `run[Fallback label]: " + K.task + "`",
    "- [ ] #task #gtd **Bank** [[Bank keymap e2e]] → `run[Import]: " + K.bank + "` ^kmbank",
    "- [ ] #task Linked [[Bank keymap e2e]] row ^kmlinked",
    "    - `run: " + K.linked + "`",
    "- [ ] #task Two `run: " + K.twoA + "` and `run: " + K.twoB + "`",
    "- [ ] #task Elsewhere `run: bob e2e elsewhere`",
    "- [ ] #task Slow `run: " + K.slow + "`",
    "- [ ] #task Vim `run: " + K.vim + "`",
    "Plain prose with no chip.",
    "",
    "```bob-run Fence pair",
    K.fence1,
    K.fence2,
    "```",
    "",
  ].join("\n");
}

// The command-chips fixture plus nav, the vault binding, and these notes.
// Isolation is proven on the base fixture first, then nav is the only
// addition to the plugin list.
function makeKeymapFixture(runRoot) {
  const scratch = fixture.makeFixture(runRoot, {});
  const isolation = fixture.isolationReport(scratch, require("./command-mode-harness.cjs").helpers);
  const vault = scratch.vaultRealPath;
  const obsidianDir = path.join(vault, ".obsidian");
  const target = path.join(obsidianDir, "plugins", NAV_ID);
  fs.mkdirSync(target, { recursive: true });
  for (const name of ["manifest.json", "main.js", "styles.css"]) {
    const source = path.join(repoRoot, "plugins", NAV_ID, name);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(target, name));
  }
  fs.writeFileSync(path.join(obsidianDir, "community-plugins.json"), JSON.stringify([...fixture.OWN_PLUGINS, NAV_ID], null, 2));
  fs.writeFileSync(path.join(obsidianDir, "hotkeys.json"), JSON.stringify({ [DISPATCH_ID]: [{ modifiers: ["Meta"], key: "Enter" }] }, null, 2));
  const notes = { [GTD]: gtdText(), [BANK]: "# Bank keymap e2e\n", [REF]: "- [ ] #task Ref `run: " + K.ref + "`\n" };
  for (const [rel, text] of Object.entries(notes)) {
    fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
    fs.writeFileSync(path.join(vault, rel), text);
  }
  const plugins = fs.readdirSync(path.join(obsidianDir, "plugins")).sort();
  const expected = [...fixture.OWN_PLUGINS, NAV_ID].sort();
  if (JSON.stringify(plugins) !== JSON.stringify(expected)) isolation.failures.push("unexpected plugins: " + plugins.join(","));
  return { scratch, isolation };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
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

async function connectToScratch(port, vaultRealPath, childState) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (childState.exit) throw new Error("owned Obsidian exited early: " + childState.exit);
    let targets = [];
    try {
      targets = await fetch("http://127.0.0.1:" + port + "/json/list").then((response) => response.json());
    } catch (_error) {
      targets = [];
    }
    for (const target of Array.isArray(targets) ? targets : []) {
      if (target.type !== "page" || !target.webSocketDebuggerUrl) continue;
      let client = null;
      try {
        client = await CdpClient.connect(target.webSocketDebuggerUrl);
        const base = await client.evaluate("(() => { const a = window.app && app.vault && app.vault.adapter; return a && a.basePath || null; })()", 5000);
        if (base && path.resolve(base) === path.resolve(vaultRealPath)) return client;
      } catch (_error) {
        // Try the next target.
      }
      if (client) client.close();
    }
    await sleep(350);
  }
  throw new Error("no CDP page reports the scratch vault");
}

async function dismissTrust(client) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const clicked = await client.evaluate("(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /Trust author and enable plugins/i.test(x.textContent || '')); if (!b) return false; b.click(); return true; })()").catch(() => false);
    if (clicked) {
      await sleep(800);
      return;
    }
    if (await client.evaluate("Boolean(app.plugins.plugins['bob-chips'])").catch(() => false)) return;
    await sleep(200);
  }
}

async function openNote(client, notePath) {
  return client.evaluate(`(async () => {
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(notePath)});
    const leaf = app.workspace.getLeaf(false);
    await leaf.openFile(file);
    await leaf.view.setState(Object.assign({}, leaf.view.getState(), { mode: "source", source: false }), { history: false });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return leaf.view.file && leaf.view.file.path;
  })()`, 20_000);
}

async function cursorTo(client, line, ch) {
  await client.evaluate(`(() => {
    const view = app.workspace.activeLeaf.view;
    view.editor.focus();
    view.editor.setCursor({ line: ${line}, ch: ${ch} });
    return true;
  })()`);
  await sleep(250);
}

// Xvfb has no window manager, so the document never has OS focus and CM
// reports an unfocused editor, where the keycap (rightly) never shows. CDP
// focus emulation fixes that, but Obsidian's hotkey layer then ignores
// trusted key events. So cues are read with emulation on, and keys are
// pressed with it off.
async function focusEmulation(client, enabled) {
  await client.call("Emulation.setFocusEmulationEnabled", { enabled }).catch(() => null);
}

async function pressKey(client, base) {
  await focusEmulation(client, false);
  await client.call("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
  await client.call("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  await focusEmulation(client, true);
}

async function metaEnter(client) {
  await pressKey(client, { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: 4 });
  await sleep(900);
}

async function clearNotices(client) {
  await client.evaluate("(() => { for (const el of document.querySelectorAll('.notice')) el.remove(); return true; })()");
}

async function closeModals(client) {
  for (let n = 0; n < 4; n += 1) {
    const open = await client.evaluate("document.querySelectorAll('.modal-container').length");
    if (!open) return;
    await client.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await client.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await sleep(300);
  }
}

async function screenshot(client, outDir, name) {
  const shot = await client.call("Page.captureScreenshot", { format: "png" });
  const file = path.join(outDir, name);
  fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
  return file;
}

async function keymapPhase(ctx) {
  const { client, scratch, record, outDir } = ctx;
  const runs = (payload) => fixture.countRuns(scratch, payload);
  const gtdBefore = fs.readFileSync(path.join(scratch.vaultRealPath, GTD), "utf8");

  const flags = await client.evaluate(`(() => ({
    dispatch: app.plugins.plugins[${JSON.stringify(NAV_ID)}].commandChipDispatch,
    binding: app.hotkeyManager.getHotkeys(${JSON.stringify(DISPATCH_ID)}),
    palette: Boolean(app.commands.commands["bob-chips:run-at-cursor"]),
    paletteHotkeys: (app.commands.commands["bob-chips:run-at-cursor"] || {}).hotkeys || null,
    members: ["targetAt", "runAtCursor"].map((name) => typeof app.plugins.plugins["bob-chips"].api.commandChips[name]),
  }))()`);
  record("nav sets the capability flag; bob-chips adds targetAt, runAtCursor, and a hotkey-less palette command",
    flags.dispatch === 1 && flags.palette && !flags.paletteHotkeys && flags.members.every((type) => type === "function"), JSON.stringify(flags));

  // 1. The line's own chip: armed, keycap, one run.
  await openNote(client, GTD);
  await cursorTo(client, ROW.line, 2);
  const lineCue = await waitFor(client, "(" + cueExpression() + ")()", (v) => v && v.hints.length === 1, "line keycap");
  ctx.shots.push(await screenshot(client, outDir, "keymap-line-armed.png"));
  await metaEnter(client);
  await waitFor(client, "true", () => runs(K.line) === 1, "line run");
  record("⌘↵ on a chip line arms it, shows the Run keycap, and runs it once",
    runs(K.line) === 1 && /Run$/.test(lineCue.hints[0].text) && lineCue.armed.includes(K.line), JSON.stringify(lineCue));

  // 2. The task fallback names its target.
  await cursorTo(client, ROW.task, 2);
  const taskCue = await waitFor(client, "(" + cueExpression() + ")()", (v) => v && v.hints.length === 1, "task keycap");
  ctx.shots.push(await screenshot(client, outDir, "keymap-task-fallback.png"));
  await metaEnter(client);
  await waitFor(client, "true", () => runs(K.task) === 1, "task run");
  record("⌘↵ on a task line runs its only chip and the keycap names it",
    runs(K.task) === 1 && /Run · Fallback label$/.test(taskCue.hints[0].text), JSON.stringify(taskCue.hints));

  // 3. The Bank-shaped row: its chip off the link; the link on the link.
  await cursorTo(client, ROW.bank, 2);
  await waitFor(client, "(" + cueExpression() + ")()", (v) => v && v.hints.length === 1, "bank keycap");
  await metaEnter(client);
  await waitFor(client, "true", () => runs(K.bank) === 1, "bank run");
  const bankLine = gtdText().split("\n")[ROW.bank];
  await cursorTo(client, ROW.bank, bankLine.indexOf("[[Bank") + 4);
  const onLink = await client.evaluate("(" + cueExpression() + ")()");
  await metaEnter(client);
  await sleep(600);
  const afterLink = await client.evaluate("(" + cueExpression() + ")()");
  record("Bank-shaped row: ⌘↵ runs its chip, but on its link opens the link and runs nothing",
    runs(K.bank) === 1 && onLink.hints.length === 0 && afterLink.file === BANK, JSON.stringify({ onLink: onLink.hints, file: afterLink.file }));
  await openNote(client, GTD);

  // 4. A task line with a link keeps its own target over the child chip:
  //    the unchanged chain runs (here the cursor is off the link, so the
  //    new-tab opener has nothing to open), and nothing runs or refuses.
  await clearNotices(client);
  await cursorTo(client, ROW.linked, 2);
  const linkedCue = await client.evaluate("(" + cueExpression() + ")()");
  await metaEnter(client);
  const linkedAfter = await client.evaluate("(" + cueExpression() + ")()");
  record("a task line with a link never runs its child's chip; the old chain keeps the key",
    runs(K.linked) === 0 && linkedCue.hints.length === 0 && linkedAfter.notices.length === 0 && linkedAfter.file === GTD,
    JSON.stringify({ hints: linkedCue.hints, notices: linkedAfter.notices, file: linkedAfter.file }));

  // 5. Refusals: ambiguous and unavailable never advertise and never fall through.
  await clearNotices(client);
  await cursorTo(client, ROW.two, 2);
  const twoCue = await client.evaluate("(" + cueExpression() + ")()");
  await metaEnter(client);
  const twoAfter = await client.evaluate("(" + cueExpression() + ")()");
  await clearNotices(client);
  await cursorTo(client, ROW.elsewhere, 2);
  const elseCue = await client.evaluate("(" + cueExpression() + ")()");
  await metaEnter(client);
  const elseAfter = await client.evaluate("(" + cueExpression() + ")()");
  record("ambiguous and unavailable targets show no keycap, refuse with a reason, and run nothing",
    runs(K.twoA) + runs(K.twoB) === 0 && twoCue.hints.length === 0 && elseCue.hints.length === 0 &&
      twoAfter.notices.some((text) => /2 command chips on this line · move onto one/.test(text)) &&
      elseAfter.notices.some((text) => /not available on this host/.test(text)) && twoAfter.file === GTD && elseAfter.file === GTD,
    JSON.stringify({ two: twoAfter.notices, elsewhere: elseAfter.notices }));

  // 6. A running target reads Output; a second ⌘↵ opens it instead of running.
  await clearNotices(client);
  await cursorTo(client, ROW.slow, 2);
  await waitFor(client, "(" + cueExpression() + ")()", (v) => v && v.hints.length === 1, "slow keycap");
  await metaEnter(client);
  await waitFor(client, "true", () => runs(K.slow) === 1, "slow run started");
  await cursorTo(client, ROW.slow, 3);
  const busy = await waitFor(client, "(" + cueExpression() + ")()", (v) => v && v.hints.length === 1 && /Output$/.test(v.hints[0].text), "Output keycap");
  ctx.shots.push(await screenshot(client, outDir, "keymap-running-output.png"));
  await metaEnter(client);
  await sleep(800);
  const outputModals = await client.evaluate("document.querySelectorAll('.modal-container .bob-cmd-pager-view').length");
  await closeModals(client);
  fixture.openGate(scratch, "km-slow");
  await cursorTo(client, ROW.slow, 2);
  await waitFor(client, "(" + cueExpression() + ")()", (v) => v && v.hints.length === 1 && /Run$/.test(v.hints[0].text), "Run keycap returns", 30_000);
  record("a running target's keycap reads Output and a second ⌘↵ opens it without a second run",
    runs(K.slow) === 1 && /Output$/.test(busy.hints[0].text) && outputModals > 0, JSON.stringify({ hint: busy.hints[0], outputModals }));

  // 7. Vim normal mode: ⌘↵ still runs the chip.
  await client.evaluate("app.vault.setConfig('vimMode', true)");
  await openNote(client, GTD);
  await cursorTo(client, ROW.vim, 2);
  await pressKey(client, { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27, modifiers: 0 });
  await sleep(300);
  const vimMode = await client.evaluate("(() => { const cm = app.workspace.activeLeaf.view.editor.cm; const vim = cm && cm.cm && cm.cm.state && cm.cm.state.vim; return vim ? (vim.insertMode ? 'insert' : 'normal') : 'unknown'; })()");
  await metaEnter(client);
  await waitFor(client, "true", () => runs(K.vim) === 1, "vim run", 10_000).catch(() => null);
  record("⌘↵ runs the chip in Vim normal mode", runs(K.vim) === 1 && vimMode !== "insert", "runs=" + runs(K.vim) + " mode=" + vimMode);
  await client.evaluate("app.vault.setConfig('vimMode', false)");

  // 8. Inside a `bob-run` fence: the keycap shows on the cursor line and
  //    ⌘↵ runs the whole sequence once.
  await clearNotices(client);
  await cursorTo(client, ROW.fence, 2);
  const fenceCue = await waitFor(client, "(" + cueExpression() + ")()", (v) => v && v.hints.length === 1, "fence keycap");
  await metaEnter(client);
  await waitFor(client, "true", () => runs(K.fence2) === 1, "fence sequence", 20_000).catch(() => null);
  record("⌘↵ inside a bob-run fence runs its whole sequence once",
    runs(K.fence1) === 1 && runs(K.fence2) === 1 && /Run$/.test(fenceCue.hints[0].text), JSON.stringify({ hint: fenceCue.hints[0], runs: [runs(K.fence1), runs(K.fence2)] }));

  // 9. A no-run note keeps today's behavior: no keycap, no run.
  await openNote(client, REF);
  await cursorTo(client, 0, 2);
  const refCue = await client.evaluate("(" + cueExpression() + ")()");
  await metaEnter(client);
  record("a ref/ note shows no keycap and ⌘↵ never runs its chip", runs(K.ref) === 0 && refCue.hints.length === 0, JSON.stringify(refCue.hints));

  // 10. Nothing wrote the note, and nothing else ran.
  const gtdAfter = fs.readFileSync(path.join(scratch.vaultRealPath, GTD), "utf8");
  const actual = {};
  for (const item of fixture.runInvocations(scratch)) actual[item.argv.join(" ")] = (actual[item.argv.join(" ")] || 0) + 1;
  const expected = { "e2e ok km-line": 1, "e2e ok km-task": 1, "e2e ok km-bank": 1, "e2e slow km-slow": 1, "e2e ok km-vim": 1, "e2e ok km-fence1": 1, "e2e ok km-fence2": 1 };
  record("⌘↵ never edits the note and the stub saw exactly the expected runs",
    gtdAfter === gtdBefore && JSON.stringify(Object.entries(actual).sort()) === JSON.stringify(Object.entries(expected).sort()), JSON.stringify(actual));
}

// The cue on the cursor line (keycaps, armed chips, notices, active file),
// as a function-expression string every wait and read shares.
function cueExpression() {
  return `(() => {
    const root = app.workspace.activeLeaf.view.containerEl;
    const hints = Array.from(root.querySelectorAll(".bob-run-chip-hint")).map((el) => ({ text: el.textContent, aria: el.getAttribute("aria-label") }));
    const armed = Array.from(root.querySelectorAll(".bob-run-chip.is-armed")).map((el) => (el.querySelector(".bob-run-chip-tip-row.is-command") || {}).textContent || "");
    const notices = Array.from(document.querySelectorAll(".notice")).map((el) => el.textContent);
    return { hints, armed, notices, file: app.workspace.getActiveFile() && app.workspace.getActiveFile().path };
  })`;
}

async function runE2e(args) {
  const candidates = (args.executable ? [args.executable] : [process.env.OBSIDIAN_BIN, "/snap/bin/obsidian"]).filter(Boolean);
  const executable = candidates.find((candidate) => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch (_error) {
      return false;
    }
  });
  if (!executable) {
    console.log(JSON.stringify({ status: "skipped", reason: "Obsidian executable is unavailable" }));
    return;
  }
  if (!process.env.DISPLAY && !process.env.XVFB_RUN_TMPDIR) {
    console.log(JSON.stringify({ status: "skipped", reason: "no X display; rerun under xvfb-run -a" }));
    return;
  }
  const outDir = path.resolve(args.out || path.join("/tmp", "bob-command-chips-keymap-e2e-" + Date.now()));
  if (fixture.within(repoRoot, outDir)) throw new Error("--out must be outside the bob-plugins repository");
  fs.mkdirSync(outDir, { recursive: true });
  const runRoot = fs.mkdtempSync(path.join("/tmp", "bck-"));
  const { scratch, isolation } = makeKeymapFixture(runRoot);
  const report = { executable, vault: scratch.vaultRealPath, isolation, cases: [], shots: [], pass: false, out: outDir };
  const record = (name, ok, detail) => {
    report.cases.push({ name, ok: Boolean(ok), detail: detail || "" });
    console.log((ok ? "PASS " : "FAIL ") + name + (detail ? " (" + String(detail).slice(0, 400) + ")" : ""));
  };
  record("scratch fixture is isolated", isolation.failures.length === 0, JSON.stringify(isolation.failures));
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
    await focusEmulation(client, true);
    await waitFor(client, "Boolean(window.app && app.workspace && app.workspace.layoutReady)", (v) => v === true, "layout ready", 40_000);
    await dismissTrust(client);
    const loaded = await waitFor(client, `(() => {
      const plugins = app.plugins.plugins;
      const cm = plugins["bob-command-mode"];
      const catalog = cm && cm.commandModeCatalog;
      return {
        chips: Boolean(plugins["bob-chips"]),
        nav: Boolean(plugins[${JSON.stringify(NAV_ID)}]),
        versions: ["bob-chips", "bob-command-mode", ${JSON.stringify(NAV_ID)}].map((id) => id + "@" + (app.plugins.manifests[id] || {}).version),
        entries: catalog && Array.isArray(catalog.entries) ? catalog.entries.length : 0,
      };
    })()`, (v) => v && v.chips && v.nav && v.entries === fixture.CATALOG.entries.length, "plugins and stub catalog", 40_000);
    report.app = loaded;
    record("bob-chips, Command Mode, and nav load against the stub catalog", true, JSON.stringify(loaded));
    await keymapPhase({ client, scratch, record, outDir, shots: report.shots, report });
  } catch (error) {
    record("e2e completed without an exception", false, String((error && error.stack) || error));
  } finally {
    if (client) client.close();
    try { process.kill(-child.pid, "SIGTERM"); } catch (_error) { /* Already gone. */ }
    await sleep(500);
    report.pass = report.cases.length > 0 && report.cases.every((item) => item.ok);
    fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
    if (!args.keep) fs.rmSync(runRoot, { recursive: true, force: true });
    console.log(report.pass ? "E2E PASS" : "E2E FAIL");
    if (!report.pass) process.exitCode = 1;
  }
}

// Offline: the fixture authors every case where the rows say, nav is the
// only added plugin, and the vault binds Meta+Enter to the dispatcher.
function runSelfTest() {
  const chips = require("./copy-chips-test-helpers.cjs").helpers;
  const lines = gtdText().split("\n");
  const runAt = (row) => chips.chipScanLine(lines[row]).filter((chip) => chip.kind === "run").map((chip) => chip.text);
  assert.deepEqual(runAt(ROW.line), [K.line]);
  assert.deepEqual(chips.chipScanLine(lines[ROW.task + 1]).map((chip) => chip.text), [K.task]);
  assert.deepEqual(runAt(ROW.bank), [K.bank]);
  assert.ok(chips.chipLinkSpans(lines[ROW.bank]).length > 0);
  assert.deepEqual(runAt(ROW.two), [K.twoA, K.twoB]);
  assert.deepEqual(runAt(ROW.slow), [K.slow]);
  assert.deepEqual(runAt(ROW.vim), [K.vim]);
  assert.deepEqual(runAt(ROW.plain), []);
  assert.equal(lines[ROW.fence - 1], "```bob-run Fence pair");
  assert.equal(lines[ROW.fence], K.fence1);
  const runRoot = fs.mkdtempSync(path.join("/tmp", "bck-self-"));
  try {
    const { scratch, isolation } = makeKeymapFixture(runRoot);
    assert.deepEqual(isolation.failures, [], "isolation");
    const hotkeys = JSON.parse(fs.readFileSync(path.join(scratch.vaultRealPath, ".obsidian", "hotkeys.json"), "utf8"));
    assert.deepEqual(hotkeys, { [DISPATCH_ID]: [{ modifiers: ["Meta"], key: "Enter" }] });
    const enabled = JSON.parse(fs.readFileSync(path.join(scratch.vaultRealPath, ".obsidian", "community-plugins.json"), "utf8"));
    assert.deepEqual(enabled, [...fixture.OWN_PLUGINS, NAV_ID]);
    assert.ok(fs.existsSync(path.join(scratch.vaultRealPath, REF)));
  } finally {
    fs.rmSync(runRoot, { recursive: true, force: true });
  }
  assert.deepEqual(parseArgs(["-o", "/tmp/x", "-k", "-s"]), { executable: null, out: "/tmp/x", keep: true, selfTest: true, help: false });
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

module.exports = { parseArgs, runSelfTest, gtdText, makeKeymapFixture };
