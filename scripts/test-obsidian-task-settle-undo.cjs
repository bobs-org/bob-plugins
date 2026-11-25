#!/usr/bin/env node
// Real Obsidian undo check for taskSettle v1. Uses only a disposable vault/profile.
"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { CdpClient, freePort, seedProfileVault } = require("./obsidian-startup-smoke.cjs");

const repoRoot = path.resolve(__dirname, "..");
const OBSIDIAN = process.env.OBSIDIAN_BIN || "/snap/obsidian/current/app/obsidian";
const NOTE_PATH = "Areas/home.md";
const NOTE_CONTENT = [
  "---",
  "type: [[area]]",
  "---",
  "## Tasks",
  "",
  "- [ ] #task Future task [scheduled:: 2026-11-26] ^future",
  "",
].join("\n");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  // Chromium's singleton socket must fit in UNIX's short socket-path limit.
  // SASE sets TMPDIR to a long per-agent path, so keep both the scratch profile
  // and Chromium's own temp files under /tmp.
  const scratch = fs.mkdtempSync(path.join("/tmp", "bob-task-settle-undo-"));
  const vault = path.join(scratch, "vault");
  const profile = path.join(scratch, "profile");
  fs.mkdirSync(path.join(vault, ".obsidian", "plugins", "bob-ledger-tools"), { recursive: true });
  fs.mkdirSync(path.dirname(path.join(vault, NOTE_PATH)), { recursive: true });
  fs.writeFileSync(path.join(vault, NOTE_PATH), NOTE_CONTENT);

  const pluginSource = path.join(repoRoot, "plugins", "bob-ledger-tools");
  const pluginTarget = path.join(vault, ".obsidian", "plugins", "bob-ledger-tools");
  for (const name of ["manifest.json", "main.js", "styles.css"]) {
    const source = path.join(pluginSource, name);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(pluginTarget, name));
  }
  fs.writeFileSync(
    path.join(vault, ".obsidian", "community-plugins.json"),
    JSON.stringify(["bob-ledger-tools"], null, 2),
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
  ], {
    cwd: vaultRealPath,
    env: childEnv,
    stdio: "ignore",
  });
  let client = null;
  let passed = false;
  try {
    client = await waitForOwnedTarget(port, vaultRealPath, child);
    await client.evaluate(
      `(() => (async () => {
        const deadline = Date.now() + 15_000;
        while (!window.app?.plugins && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        const plugins = window.app?.plugins;
        if (!plugins) throw new Error("plugin manager unavailable");
        if (!plugins.isEnabled()) await plugins.setEnable(true);
        return true;
      })())()`,
      15_000,
    );

    let loaded = false;
    const loadDeadline = Date.now() + 20_000;
    while (Date.now() < loadDeadline) {
      loaded = await client.evaluate(
        `(() => Boolean(window.app?.plugins?.plugins?.["bob-ledger-tools"]?.api?.taskSettle?.applyToEditor))()`,
        5000,
      );
      if (loaded) break;
      await sleep(250);
    }
    if (!loaded) throw new Error("Ledger Tools taskSettle v1 did not load in the scratch vault");

    const result = await client.evaluate(
      `(() => (async () => {
        const app = window.app;
        const fileDeadline = Date.now() + 15_000;
        let file = app.vault.getAbstractFileByPath(${JSON.stringify(NOTE_PATH)});
        while (!file && Date.now() < fileDeadline) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          file = app.vault.getAbstractFileByPath(${JSON.stringify(NOTE_PATH)});
        }
        if (!file) throw new Error("fixture note missing");
        const leaf = app.workspace.getLeaf(false);
        await leaf.openFile(file, { state: { mode: "source" } });
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const editor = leaf.view?.editor;
        if (!editor?.cm || typeof editor.getValue !== "function") throw new Error("CM6 editor unavailable");
        const before = editor.getValue();
        const marker = before.indexOf("- [ ] #task Future task");
        if (marker < 0) throw new Error("fixture task line missing");
        const statusOffset = marker + 3;
        editor.cm.dispatch({
          changes: { from: statusOffset, to: statusOffset + 1, insert: "/" },
          userEvent: "input",
        });
        const gestureBuffer = editor.getValue();
        const line = gestureBuffer.slice(0, statusOffset).split(/\\r?\\n/).length - 1;
        const taskLine = gestureBuffer.split(/\\r?\\n/)[line];
        const plugin = app.plugins.plugins["bob-ledger-tools"];
        const settle = plugin.api.taskSettle.applyToEditor(editor, ${JSON.stringify(NOTE_PATH)}, {
          identity: { blockId: "future", line, text: taskLine },
          today: "2026-11-25",
          joinHistory: true,
        });
        const settledBuffer = editor.getValue();
        if (typeof editor.undo !== "function") throw new Error("Obsidian Editor.undo unavailable");
        if (typeof editor.redo !== "function") throw new Error("Obsidian Editor.redo unavailable");
        editor.undo();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const firstUndoBuffer = editor.getValue();
        let secondUndoBuffer = null;
        let firstRedoBuffer = null;
        let secondRedoBuffer = null;
        if (firstUndoBuffer !== before) {
          editor.undo();
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          secondUndoBuffer = editor.getValue();
          editor.redo();
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          firstRedoBuffer = editor.getValue();
          editor.redo();
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          secondRedoBuffer = editor.getValue();
        } else {
          editor.redo();
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          firstRedoBuffer = editor.getValue();
        }
        const undoRestoredOriginal = firstUndoBuffer === before || secondUndoBuffer === before;
        const redoRestoredSettled = firstRedoBuffer === settledBuffer || secondRedoBuffer === settledBuffer;
        const undoSequenceMatches = settle.historyJoined === true
          ? firstUndoBuffer === before && firstRedoBuffer === settledBuffer
          : settle.historyJoined === false
            ? firstUndoBuffer === gestureBuffer && secondUndoBuffer === before &&
              firstRedoBuffer === gestureBuffer && secondRedoBuffer === settledBuffer
            : undoRestoredOriginal && redoRestoredSettled;
        return {
          version: plugin.api.taskSettle.version,
          applied: settle.applied,
          changed: settle.changed,
          historyJoined: settle.historyJoined,
          gestureBufferChanged: gestureBuffer !== before,
          settledBufferChanged: settledBuffer !== gestureBuffer,
          firstUndoRestoredGesture: firstUndoBuffer === gestureBuffer,
          undoRestoredOriginal,
          redoRestoredSettled,
          undoSequenceMatches,
          reason: settle.reason,
        };
      })())()`,
      15_000,
    );
    if (
      !result || result.version !== 1 || !result.applied || !result.changed ||
      !result.gestureBufferChanged || !result.settledBufferChanged ||
      !result.undoRestoredOriginal || !result.redoRestoredSettled || !result.undoSequenceMatches
    ) {
      throw new Error(`taskSettle real undo assertion failed: ${JSON.stringify(result)}`);
    }
    passed = true;
    console.log(JSON.stringify({ pass: true, result }));
  } finally {
    if (client) client.close();
    if (child.exitCode == null && child.signalCode == null) child.kill("SIGTERM");
    await new Promise((resolve) => {
      if (child.exitCode != null || child.signalCode != null) return resolve();
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 5000);
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
