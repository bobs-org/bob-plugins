#!/usr/bin/env node
// Real Obsidian undo check for taskSettle v1. Uses only a disposable vault/profile.
"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { CdpClient, freePort, seedProfileVault } = require("./obsidian-startup-smoke.cjs");

const repoRoot = path.resolve(__dirname, "..");
const OBSIDIAN = process.env.OBSIDIAN_BIN || "/snap/obsidian/current/app/obsidian";
const NOTE_PATH = "Areas/home.md";
const PROMOTION_PATH = "Areas/promotion.md";
const SCAFFOLD_PATH = "Areas/scaffold.md";
const CLOSE_PATH = "Areas/close.md";
const today = (() => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
})();
const tomorrow = (() => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
})();
const NOTE_CONTENT = [
  "---",
  "type: [[area]]",
  "---",
  "## Tasks",
  "",
  `- [ ] #task Future task [scheduled:: ${tomorrow}] ^future`,
  "",
].join("\n");
const PROMOTION_CONTENT = [
  "---",
  "type: [[area]]",
  "---",
  "## Tasks",
  "",
  "- Ship this in place",
  "- [ ] #task Keep this task ^keep",
  "",
].join("\n");
const SCAFFOLD_CONTENT = [
  "---",
  "type: [[area]]",
  "---",
  "## Tasks",
  "",
  "- [ ] #task Anchor task ^anchor",
  "",
].join("\n");
const CLOSE_CONTENT = [
  "---",
  "type: [[area]]",
  "---",
  "## Tasks",
  "",
  `- [ ] #task Weekly review [repeat:: every week] [scheduled:: ${today}]`,
  "",
].join("\n");
const TASKS_DATA = {
  globalFilter: "#task",
  taskFormat: "dataview",
  statusSettings: {
    coreStatuses: [
      { symbol: " ", name: "Ready", type: "TODO" },
      { symbol: "x", name: "Done", type: "DONE" },
    ],
    customStatuses: [
      { symbol: "*", name: "Next", type: "ON_HOLD" },
      { symbol: "?", name: "Blocked", type: "TODO" },
      { symbol: "/", name: "In Progress", type: "IN_PROGRESS" },
      { symbol: "-", name: "Canceled", type: "CANCELLED" },
    ],
  },
};

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
  for (const [notePath, contents] of [
    [PROMOTION_PATH, PROMOTION_CONTENT],
    [SCAFFOLD_PATH, SCAFFOLD_CONTENT],
    [CLOSE_PATH, CLOSE_CONTENT],
  ]) {
    fs.mkdirSync(path.dirname(path.join(vault, notePath)), { recursive: true });
    fs.writeFileSync(path.join(vault, notePath), contents);
  }

  const enabled = ["bob-ledger-tools", "task-status-cycler"];
  for (const id of enabled) {
    const pluginSource = path.join(repoRoot, "plugins", id);
    const pluginTarget = path.join(vault, ".obsidian", "plugins", id);
    fs.mkdirSync(pluginTarget, { recursive: true });
    for (const name of ["manifest.json", "main.js", "styles.css"]) {
      const source = path.join(pluginSource, name);
      if (fs.existsSync(source)) fs.copyFileSync(source, path.join(pluginTarget, name));
    }
  }
  const tasksSource = path.join(os.homedir(), "bob", ".obsidian", "plugins", "obsidian-tasks-plugin");
  if (!fs.existsSync(path.join(tasksSource, "main.js")) || !fs.existsSync(path.join(tasksSource, "manifest.json"))) {
    throw new Error(`Tasks plugin source is missing: ${tasksSource}`);
  }
  const tasksTarget = path.join(vault, ".obsidian", "plugins", "obsidian-tasks-plugin");
  fs.mkdirSync(tasksTarget, { recursive: true });
  for (const name of ["manifest.json", "main.js", "styles.css"]) {
    const source = path.join(tasksSource, name);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(tasksTarget, name));
  }
  fs.writeFileSync(path.join(tasksTarget, "data.json"), JSON.stringify(TASKS_DATA, null, 2));
  enabled.push("obsidian-tasks-plugin");
  fs.writeFileSync(
    path.join(vault, ".obsidian", "community-plugins.json"),
    JSON.stringify(enabled, null, 2),
  );
  fs.writeFileSync(path.join(vault, ".obsidian", "app.json"), JSON.stringify({
    livePreview: true,
    vimMode: true,
    autoPairBrackets: true,
  }));

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
        `(() => Boolean(
          window.app?.plugins?.plugins?.["bob-ledger-tools"]?.api?.taskSettle?.applyToEditor &&
          window.app?.plugins?.plugins?.["task-status-cycler"]?.api?.completeTaskAtCursor &&
          window.app?.commands?.commands?.["obsidian-tasks-plugin:set-status-symbol-to-x"]
        ))()`,
        5000,
      );
      if (loaded) break;
      await sleep(250);
    }
    if (!loaded) throw new Error("Ledger Tools, Task Status Cycler, and Tasks did not load in the scratch vault");

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
          today: ${JSON.stringify(today)},
          joinHistory: true,
        });
        const settledBuffer = editor.getValue();
        if (typeof editor.undo !== "function") throw new Error("Obsidian Editor.undo unavailable");
        if (typeof editor.redo !== "function") throw new Error("Obsidian Editor.redo unavailable");
        editor.undo();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const firstUndoBuffer = editor.getValue();
        editor.redo();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const firstRedoBuffer = editor.getValue();
        const undoRestoredOriginal = firstUndoBuffer === before;
        const redoRestoredSettled = firstRedoBuffer === settledBuffer;
        const undoSequenceMatches = settle.historyJoined === true &&
          undoRestoredOriginal && redoRestoredSettled;
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

    const refusal = await client.evaluate(
      `(() => {
        const app = window.app;
        const plugin = app.plugins.plugins["bob-ledger-tools"];
        const leaf = app.workspace.getLeaf(false);
        const editor = leaf.view?.editor;
        if (!editor || typeof editor.getValue !== "function") throw new Error("CM6 editor unavailable");
        const before = editor.getValue();
        const staged = plugin.api.taskSettle.applyToEditor(editor, ${JSON.stringify(NOTE_PATH)}, {
          contents: "Old snapshot\\n",
        });
        const afterStaged = editor.getValue();
        const pending = plugin.api.taskSettle.schedulePending({
          editor,
          path: ${JSON.stringify(NOTE_PATH)},
          identity: { blockId: "deleted", line: 0 },
        });
        const flushed = plugin.api.taskSettle.flushPending();
        return {
          stagedApplied: staged && staged.applied,
          stagedReason: staged && staged.reason,
          stagedUnchanged: afterStaged === before,
          pendingScheduled: pending && pending.scheduled,
          flushApplied: Array.isArray(flushed) && flushed.some((entry) => entry && entry.result && entry.result.applied),
          afterFlushUnchanged: editor.getValue() === before,
        };
      })()`,
      10_000,
    );
    if (
      !refusal ||
      refusal.stagedApplied !== false ||
      refusal.stagedReason !== "preimage" ||
      refusal.stagedUnchanged !== true ||
      refusal.flushApplied !== false ||
      refusal.afterFlushUnchanged !== true
    ) {
      throw new Error(`taskSettle deleted-task/preimage refusal failed: ${JSON.stringify(refusal)}`);
    }

    const promotion = await client.evaluate(
      `(() => (async () => {
        const app = window.app;
        const file = app.vault.getAbstractFileByPath(${JSON.stringify(PROMOTION_PATH)});
        if (!file) throw new Error("promotion fixture note missing");
        const leaf = app.workspace.getLeaf(false);
        await leaf.openFile(file, { state: { mode: "source" } });
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const editor = leaf.view?.editor;
        const plugin = app.plugins.plugins["task-status-cycler"];
        const before = editor.getValue();
        const line = before.split(/\\r?\\n/).findIndex((item) => item === "- Ship this in place");
        if (line < 0) throw new Error("plain Tasks bullet missing");
        editor.setCursor({ line, ch: 2 });
        app.commands.executeCommandById("task-status-cycler:toggle-obsidian-task");
        if (!plugin.demotionSectionPicker) throw new Error("promotion did not open the Tasks destination picker");
        if (!plugin.demotionSectionPicker.acceptIndex(0)) throw new Error("in-place Tasks promotion was refused");
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const settled = editor.getValue();
        if (!settled.includes("- [ ] #task Ship this in place")) throw new Error("promotion did not convert in place");
        editor.undo();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const firstUndo = editor.getValue();
        editor.redo();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const firstRedo = editor.getValue();
        return {
          undoSteps: firstUndo === before ? 1 : 0,
          redoSteps: firstRedo === settled ? 1 : 0,
          firstUndoRestoredOriginal: firstUndo === before,
          firstRedoRestoredSettled: firstRedo === settled,
          settledContainsPromotion: settled.includes("- [ ] #task Ship this in place"),
        };
      })())()`,
      15_000,
    );
    if (!promotion || promotion.undoSteps !== 1 || promotion.redoSteps !== 1 ||
        !promotion.firstUndoRestoredOriginal || !promotion.firstRedoRestoredSettled ||
        !promotion.settledContainsPromotion) {
      throw new Error(`in-place promotion undo assertion failed: ${JSON.stringify(promotion)}`);
    }

    await client.evaluate(
      `(() => (async () => {
        const app = window.app;
        const file = app.vault.getAbstractFileByPath(${JSON.stringify(SCAFFOLD_PATH)});
        if (!file) throw new Error("scaffold fixture note missing");
        const leaf = app.workspace.getLeaf(false);
        await leaf.openFile(file, { state: { mode: "source" } });
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const editor = leaf.view?.editor;
        const before = editor.getValue();
        const anchor = before.split(/\\r?\\n/).findIndex((item) => item.includes("^anchor"));
        editor.setCursor({ line: anchor, ch: 0 });
        app.commands.executeCommandById("task-status-cycler:open-child-bullet-line-below");
        const plugin = app.plugins.plugins["task-status-cycler"];
        if (!plugin.openLineScaffold || plugin.openLineScaffold.scaffold.kind !== "task") {
          throw new Error("o did not create a task scaffold");
        }
      })())()`,
      15_000,
    );
    await client.call("Input.insertText", { text: "Scaffolded task" }, 5000);
    const preSettle = await client.evaluate(
      `(() => window.app.workspace.getLeaf(false).view.editor.getValue())()`,
      5000,
    );
    const escapeKey = {
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    };
    await client.call("Input.dispatchKeyEvent", { type: "keyDown", ...escapeKey }, 5000);
    await client.call("Input.dispatchKeyEvent", { type: "keyUp", ...escapeKey }, 5000);
    const scaffold = await client.evaluate(
      `(() => (async () => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const editor = window.app.workspace.getLeaf(false).view.editor;
        const settled = editor.getValue();
        const plugin = window.app.plugins.plugins["task-status-cycler"];
        if (plugin.openLineScaffold) throw new Error("Escape did not flush the o scaffold");
        editor.undo();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const firstUndo = editor.getValue();
        editor.redo();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const firstRedo = editor.getValue();
        return {
          settleIsSeparateUndo: firstUndo === ${JSON.stringify(preSettle)},
          firstRedoRestoredSettled: firstRedo === settled,
          settled,
        };
      })())()`,
      15_000,
    );
    if (!scaffold || scaffold.settleIsSeparateUndo || !scaffold.firstRedoRestoredSettled ||
        !scaffold.settled.includes("#task Scaffolded task")) {
      throw new Error(`nonempty o scaffold history assertion failed: ${JSON.stringify(scaffold)}`);
    }

    const close = await client.evaluate(
      `(() => (async () => {
        const app = window.app;
        const file = app.vault.getAbstractFileByPath(${JSON.stringify(CLOSE_PATH)});
        if (!file) throw new Error("Tasks close fixture note missing");
        const leaf = app.workspace.getLeaf(false);
        await leaf.openFile(file, { state: { mode: "source" } });
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const editor = leaf.view?.editor;
        const plugin = app.plugins.plugins["task-status-cycler"];
        const before = editor.getValue();
        const line = before.split(/\\r?\\n/).findIndex((item) => item.includes("Weekly review"));
        if (line < 0) throw new Error("recurring close task missing");
        editor.setCursor({ line, ch: 4 });
        const result = await plugin.api.completeTaskAtCursor(editor);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const settled = editor.getValue();
        const lines = settled.split(/\\r?\\n/);
        const closedLine = lines.find((item) => /^- \\[x\\] #task Weekly review/.test(item)) || "";
        const spawnLineText = lines.find((item) => /^- \\[(?: |\\?)\\] #task Weekly review/.test(item) && /\\[scheduled::/.test(item)) || "";
        const spawnLine = lines.indexOf(spawnLineText);
        const blockedHeader = lines.indexOf("### Blocked");
        const scheduled = (spawnLineText.match(/\\[scheduled:: (\\d{4}-\\d{2}-\\d{2})\\]/) || [])[1] || "";
        const located = plugin.locateSettledClosedTask(editor, {
          closedText: closedLine,
          hintLine: lines.indexOf(closedLine),
        });
        editor.undo();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const firstUndo = editor.getValue();
        editor.redo();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const firstRedo = editor.getValue();
        return {
          result,
          undoSteps: firstUndo === before ? 1 : 0,
          redoSteps: firstRedo === settled ? 1 : 0,
          firstUndoRestoredOriginal: firstUndo === before,
          firstRedoRestoredSettled: firstRedo === settled,
          closedLine,
          spawnLineText,
          spawnIsBlocked: /^- \\[\\?\\] #task Weekly review/.test(spawnLineText) &&
            scheduled > ${JSON.stringify(today)} && spawnLine > blockedHeader && blockedHeader >= 0,
          locatedClosedLine: located === lines.indexOf(closedLine),
        };
      })())()`,
      20_000,
    );
    if (!close || !close.result || close.result.ok !== true || close.undoSteps !== 1 || close.redoSteps !== 1 ||
        !close.firstUndoRestoredOriginal || !close.firstRedoRestoredSettled || !close.closedLine ||
        !close.spawnIsBlocked || !close.locatedClosedLine) {
      throw new Error(`Tasks-backed recurring close undo assertion failed: ${JSON.stringify(close)}`);
    }

    passed = true;
    console.log(JSON.stringify({ pass: true, result, refusal, promotion, scaffold, close }));
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
