#!/usr/bin/env node
// Real Obsidian acceptance for task-status-cycler tier-2 cycle settle.
// Runs only in a disposable vault and profile.
"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { CdpClient, freePort, seedProfileVault } = require("./obsidian-startup-smoke.cjs");

const repoRoot = path.resolve(__dirname, "..");
const OBSIDIAN = process.env.OBSIDIAN_BIN || "/snap/obsidian/current/app/obsidian";
const NOTE_PATH = "Areas/home.md";
const OTHER_PATH = "Areas/other.md";
const NOTE_CONTENT = [
  "---",
  "type: [[area]]",
  "---",
  "## Tasks",
  "",
  "- [ ] #task Single cycle ^single",
  "- [ ] #task Double cycle ^double",
  "- [ ] #task Cursor leave ^leave",
  "- [ ] #task Next command ^command",
  "- [ ] #task Switch note ^stale",
  "",
].join("\n");
const OTHER_CONTENT = "---\ntype: [[area]]\n---\n## Tasks\n\n- [ ] #task Other note stays put ^other\n";
const PLUGINS = ["bob-ledger-tools", "task-status-cycler"];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const frame = (client) => client.evaluate(
  "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  5000,
);

async function waitForOwnedTarget(port, vaultPath, child) {
  const deadline = Date.now() + 30_000;
  let lastError = "no matching DevTools page";
  while (Date.now() < deadline) {
    if (child.exitCode != null || child.signalCode != null) {
      throw new Error(`Obsidian exited before its scratch vault opened (code=${child.exitCode}, signal=${child.signalCode})`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = response.ok ? await response.json() : [];
      for (const target of targets) {
        if (!target || target.type !== "page" || !target.webSocketDebuggerUrl) continue;
        const client = await CdpClient.connect(target.webSocketDebuggerUrl, 5000);
        try {
          await client.call("Runtime.enable", {}, 5000);
          const actual = await client.evaluate(
            "(() => window.app?.vault?.adapter?.basePath || null)()",
            5000,
          );
          if (path.resolve(String(actual || "")) === path.resolve(vaultPath)) return client;
        } catch (error) {
          lastError = String(error && error.message || error);
        }
        client.close();
      }
    } catch (error) {
      lastError = String(error && error.message || error);
    }
    await sleep(300);
  }
  throw new Error(`No DevTools target reported the scratch vault within 30 seconds (${lastError})`);
}

async function main() {
  if (!fs.existsSync(OBSIDIAN)) throw new Error(`Obsidian Electron app is missing: ${OBSIDIAN}`);
  const scratch = fs.mkdtempSync(path.join("/tmp", "bob-cycle-settle-"));
  const vault = path.join(scratch, "vault");
  const profile = path.join(scratch, "profile");
  fs.mkdirSync(path.dirname(path.join(vault, NOTE_PATH)), { recursive: true });
  fs.mkdirSync(path.dirname(path.join(vault, OTHER_PATH)), { recursive: true });
  fs.writeFileSync(path.join(vault, NOTE_PATH), NOTE_CONTENT);
  fs.writeFileSync(path.join(vault, OTHER_PATH), OTHER_CONTENT);
  for (const id of PLUGINS) {
    const source = path.join(repoRoot, "plugins", id);
    const target = path.join(vault, ".obsidian", "plugins", id);
    fs.mkdirSync(target, { recursive: true });
    for (const name of ["manifest.json", "main.js", "styles.css"]) {
      const from = path.join(source, name);
      if (fs.existsSync(from)) fs.copyFileSync(from, path.join(target, name));
    }
  }
  fs.writeFileSync(
    path.join(vault, ".obsidian", "community-plugins.json"),
    JSON.stringify(PLUGINS, null, 2),
  );
  fs.writeFileSync(path.join(vault, ".obsidian", "app.json"), JSON.stringify({ livePreview: true }));

  const vaultRealPath = fs.realpathSync(vault);
  seedProfileVault(profile, vaultRealPath);
  const port = await freePort();
  const childEnv = { ...process.env, BOB_DIR: vaultRealPath, TMPDIR: "/tmp" };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  const child = spawn(OBSIDIAN, [
    "--no-sandbox",
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    "--remote-allow-origins=http://127.0.0.1/*",
    vaultRealPath,
  ], { cwd: vaultRealPath, env: childEnv, stdio: "ignore" });
  let client = null;
  let passed = false;
  try {
    client = await waitForOwnedTarget(port, vaultRealPath, child);
    await client.evaluate(`(() => (async () => {
      const deadline = Date.now() + 15_000;
      while (!window.app?.plugins && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
      const plugins = window.app?.plugins;
      if (!plugins) throw new Error("plugin manager unavailable");
      if (!plugins.isEnabled()) await plugins.setEnable(true);
      return true;
    })())()`, 15_000);

    let loaded = false;
    const loadDeadline = Date.now() + 20_000;
    while (Date.now() < loadDeadline) {
      loaded = await client.evaluate(`(() => {
        const app = window.app;
        return Boolean(
          app?.plugins?.plugins?.["bob-ledger-tools"]?.api?.taskSettle?.schedulePending &&
          app?.plugins?.plugins?.["task-status-cycler"] &&
          app?.commands?.commands?.["task-status-cycler:cycle-task-status-forward"]
        );
      })()`, 5000);
      if (loaded) break;
      await sleep(250);
    }
    if (!loaded) throw new Error("Ledger Tools and Task Status Cycler did not load in the scratch vault");

    const result = await client.evaluate(`(() => (async () => {
      const app = window.app;
      const notePath = ${JSON.stringify(NOTE_PATH)};
      const otherPath = ${JSON.stringify(OTHER_PATH)};
      const file = app.vault.getAbstractFileByPath(notePath);
      if (!file) throw new Error("cycle fixture note missing");
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(file, { state: { mode: "source" } });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const editor = leaf.view?.editor;
      if (!editor?.cm || typeof editor.getValue !== "function") throw new Error("CM6 editor unavailable");
      const cycleCommand = "task-status-cycler:cycle-task-status-forward";
      const plugin = app.plugins.plugins["task-status-cycler"];
      window.__cycleSettleJumps = [];
      app.plugins.plugins["bob-navigation-hotkeys"] = {
        api: { recordJump(from, to) { window.__cycleSettleJumps.push({ from, to }); return true; } },
      };
      const lineFor = (id) => editor.getValue().split(/\\r?\\n/).findIndex((line) => line.includes("^" + id));
      const nextGroupLine = () => editor.getValue().split(/\\r?\\n/).findIndex((line) => line === "### Next & In Progress");
      const symbolFor = (id) => {
        const line = editor.getValue().split(/\\r?\\n/).find((item) => item.includes("^" + id)) || "";
        const match = line.match(/^- \\[(.)\\]/);
        return match ? match[1] : null;
      };
      const dispatchCycle = async (id) => {
        const line = lineFor(id);
        if (line < 0) throw new Error("missing task " + id);
        editor.setCursor({ line, ch: 0 });
        await app.commands.executeCommandById(cycleCommand);
      };
      const original = editor.getValue();
      await dispatchCycle("single");
      const singleGesture = editor.getValue();
      if (singleGesture === original || editor.getValue().includes("### Next & In Progress")) {
        throw new Error("single cycle did not stay in place before idle settle");
      }
      const singleStatus = symbolFor("single");
      await new Promise((resolve) => setTimeout(resolve, 650));
      const singleSettled = editor.getValue();
      if (!singleSettled.includes("### Next & In Progress") || lineFor("single") <= nextGroupLine()) {
        throw new Error("single cycle did not regroup after idle");
      }
      if (window.__cycleSettleJumps.length !== 1) {
        throw new Error("single settle did not record exactly one stay-cursor jump");
      }
      const singleJump = window.__cycleSettleJumps[0];
      if (singleJump.from.path !== notePath || singleJump.from.line <= singleJump.to.line) {
        throw new Error("stay-cursor jump did not point back to the moved task");
      }

      editor.undo();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const firstUndo = editor.getValue();
      editor.undo();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const secondUndo = editor.getValue();
      const undoSteps = firstUndo === singleGesture ? 2 : firstUndo === original ? 1 : 0;
      if (!undoSteps || (undoSteps === 2 && secondUndo !== original)) {
        throw new Error("delayed cycle settle undo sequence was not cycle then settle");
      }
      editor.redo();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const firstRedo = editor.getValue();
      let secondRedo = null;
      if (undoSteps === 2) {
        editor.redo();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        secondRedo = editor.getValue();
      }
      const redoSettled = firstRedo === singleSettled || secondRedo === singleSettled;
      if (!redoSettled) throw new Error("redo did not restore the settled cycle");

      await dispatchCycle("double");
      const firstDoubleStatus = symbolFor("double");
      await dispatchCycle("double");
      const doubleGesture = editor.getValue();
      const doubleStatus = symbolFor("double");
      const groupLine = nextGroupLine();
      if (firstDoubleStatus === null || doubleStatus === firstDoubleStatus || lineFor("double") > groupLine) {
        throw new Error("rapid repeated cycles moved or failed to update their original target");
      }
      await new Promise((resolve) => setTimeout(resolve, 650));
      const doubleSettled = editor.getValue();
      if (lineFor("double") <= nextGroupLine()) {
        throw new Error("rapid repeated cycle did not settle after its final tap");
      }

      await dispatchCycle("leave");
      const leaveLine = lineFor("leave");
      editor.setCursor({ line: 0, ch: 0 });
      await new Promise((resolve) => setTimeout(resolve, 100));
      const leaveFlushed = editor.getValue();
      if (lineFor("leave") <= nextGroupLine()) {
        throw new Error("cursor-leave did not flush the pending cycle");
      }

      await dispatchCycle("command");
      const beforeCommandFlush = editor.getValue();
      await app.commands.executeCommandById("task-status-cycler:toggle-task-drawer");
      const commandFlushed = editor.getValue();
      if (beforeCommandFlush === commandFlushed || lineFor("command") <= nextGroupLine()) {
        throw new Error("the next cycler command did not flush pending cycle settle");
      }

      await dispatchCycle("stale");
      const otherFile = app.vault.getAbstractFileByPath(otherPath);
      if (!otherFile) throw new Error("other note fixture missing");
      await leaf.openFile(otherFile, { state: { mode: "source" } });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await new Promise((resolve) => setTimeout(resolve, 650));
      const newNote = leaf.view.editor.getValue();
      if (newNote !== ${JSON.stringify(OTHER_CONTENT)}) {
        throw new Error("a late cycle settle changed the newly opened note");
      }

      return {
        singleStatus,
        singleUndoSteps: undoSteps,
        singleJump,
        doubleStatus,
        cursorLeaveFlushed: true,
        nextCommandFlushed: true,
        newNoteUntouched: true,
        oldTaskLineBeforeCursorFlush: leaveLine,
      };
    })())()`, 20_000);

    passed = true;
    console.log(JSON.stringify({ pass: true, result }));
  } finally {
    if (client) client.close();
    if (child.exitCode == null && child.signalCode == null) child.kill("SIGTERM");
    await new Promise((resolve) => {
      if (child.exitCode != null || child.signalCode != null) return resolve();
      const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
    if (passed) fs.rmSync(scratch, { recursive: true, force: true });
    else console.error(`Scratch vault retained for inspection: ${scratch}`);
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
