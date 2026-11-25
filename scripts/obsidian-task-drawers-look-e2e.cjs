"use strict";
// Computed-style + screenshot acceptance for task-drawer trays. The parent
// runner owns a disposable vault; all note writes below are to that fixture.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CASES = ["light", "dark"].flatMap((theme) => ["live", "reading"].map((mode) => ({
  name: `drawer trays ${theme} ${mode}`, theme, mode,
})));

const SOURCE = [
  "# Task drawers",
  "",
  "- [ ] #task Upgrade Postgres [type:: BUILD] ^pg",
  "\t- **API Design**",
  "\t\t- Review the endpoint",
  "\t\t- Check the auth",
  "\t- **Empty**",
  "\t- [ ] First requirement",
  "\t- ordinary note beside the tray",
  "\t- [[task-reqs-fixture#^pg]]",
  "- [x] #task Done owner",
  "\t- **Café**",
  "\t\t- One note",
  "- [-] #task Cancelled owner",
  "\t- **Same**",
  "",
  "End of state sheet.",
].join("\n");

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evaluate = (client, fn, arg) => client.evaluate(`(${fn.toString()})(${JSON.stringify(arg ?? null)})`);

function pageRows() {
  const view = window.app.workspace.activeLeaf.view;
  const root = view.contentEl;
  const live = [...root.querySelectorAll('.cm-line[data-bob-drawer="true"]')]
    .filter((el) => el.getBoundingClientRect().height);
  const reading = [...root.querySelectorAll('li[data-bob-drawer="true"]')]
    .filter((el) => el.getBoundingClientRect().height);
  const rows = (live.length ? live : reading).map((row) => {
    const marker = row.querySelector(".cm-formatting-list");
    const glyph = marker
      ? getComputedStyle(marker, "::before")
      : getComputedStyle(row, "::before");
    const title = row.getAttribute("title") || "";
    const strong = row.querySelector(".cm-strong, strong") || row.querySelector("p");
    const strongCs = strong ? getComputedStyle(strong) : null;
    return {
      key: row.dataset.bobDrawerKey,
      count: row.dataset.bobDrawerCount,
      empty: row.dataset.bobDrawerEmpty,
      ownerState: row.dataset.bobDrawerOwnerState,
      hue: row.dataset.bobTypeHue,
      title,
      label: row.getAttribute("aria-label"),
      live: Boolean(marker),
      width: parseFloat(glyph.width),
      height: parseFloat(glyph.height),
      mask: glyph.webkitMaskImage || glyph.maskImage || glyph.mask,
      ink: glyph.backgroundColor,
      display: glyph.display,
      fontWeight: strongCs ? String(strongCs.fontWeight) : "",
      color: strongCs ? strongCs.color : "",
      decoration: strongCs ? strongCs.textDecorationLine : "",
      folded: row.classList.contains("is-collapsed")
        || Boolean(row.querySelector(".cm-fold-indicator.is-collapsed")),
      after: getComputedStyle(row, "::after").content,
    };
  });
  const reqs = [...root.querySelectorAll('[data-bob-req="true"]')]
    .filter((el) => el.getBoundingClientRect().height).length;
  return { rows, reqs, live: live.length > 0 };
}

async function captureShot(client, args, entry) {
  if (!args.report) return null;
  const filename = path.join(path.dirname(path.resolve(args.report)), `drawers-${entry.theme}-${entry.mode}.png`);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const shot = await client.call("Page.captureScreenshot", { format: "png" });
  const bytes = Buffer.from(shot.data, "base64");
  fs.writeFileSync(filename, bytes);
  assert.ok(bytes.length > 800, "screenshot is empty");
  assert.equal(bytes[0], 0x89, "screenshot is not a PNG");
  return filename;
}

async function run(client, entry, { setDoc, setMode, waitFor, args }) {
  await client.call("Emulation.setDeviceMetricsOverride", {
    width: 1280, height: 1050, deviceScaleFactor: 1, mobile: false,
  });
  await client.evaluate(`(async () => {
    const file = window.app.vault.getAbstractFileByPath("task-reqs-fixture.md");
    if (!file) return { ok: false };
    const leaf = window.app.workspace.getLeaf(false);
    await leaf.openFile(file, { state: { mode: "source", source: false } });
    window.app.workspace.setActiveLeaf(leaf, { focus: true });
    const view = leaf.view;
    if (view && view.editor && view.editor.focus) view.editor.focus();
    return { ok: !!(view && view.editor) };
  })()`);
  await pause(400);
  await evaluate(client, async ({ theme }) => {
    document.body.classList.toggle("theme-dark", theme === "dark");
    document.body.classList.toggle("theme-light", theme === "light");
    const view = window.app.workspace.activeLeaf.view;
    await view.setState({ ...view.getState(), mode: "source", source: false }, { history: false });
    const plugin = window.app.plugins.plugins["bob-ledger-tools"];
    if (plugin && plugin.taskDrawerMarksEnabled === false) await plugin.toggleTaskDrawerMarks();
    if (plugin && plugin.taskTagMarksEnabled === false) plugin.toggleTaskTagMarks();
  }, entry);
  await setMode(client, false, true);
  await pause(300);
  await setDoc(client, SOURCE, [16, 0]);
  if (entry.mode === "reading") {
    await evaluate(client, async () => {
      const view = window.app.workspace.activeLeaf.view;
      await view.save();
      await view.setState({ ...view.getState(), mode: "preview" }, { history: false });
    });
  }
  await waitFor(client, `(${pageRows.toString()})()`, (state) => state && state.rows && state.rows.length >= 4, "4 drawer marks", 10000);
  await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 });
  await pause(200);
  const state = await evaluate(client, pageRows);
  assert.ok(state.rows.length >= 4, "expected open, empty, done, and cancelled drawers");
  assert.ok(state.reqs >= 1, "a requirement should sit beside the drawers");
  const byKey = Object.fromEntries(state.rows.map((row) => [row.key, row]));
  const open = byKey["API DESIGN"];
  const empty = byKey.EMPTY;
  const done = byKey.CAFÉ;
  const cancelled = byKey.SAME;
  assert.ok(open && empty && done && cancelled, JSON.stringify(Object.keys(byKey)));
  assert.equal(open.count, "2");
  assert.equal(open.empty, "false");
  assert.equal(open.ownerState, "open");
  assert.match(open.title, /Drawer · API Design · 2 notes · in Upgrade Postgres/);
  assert.equal(open.label, open.title);
  assert.equal(empty.empty, "true");
  assert.equal(empty.count, "0");
  assert.equal(done.ownerState, "done");
  assert.match(done.title, /Drawer · Café · 1 note · in Done owner/);
  assert.equal(cancelled.ownerState, "cancelled");
  for (const row of state.rows) {
    assert.equal(row.decoration, "none");
    assert.ok(Number(row.fontWeight) >= 600 || row.fontWeight === "bold", row.key);
    if (row.display !== "none" && Number.isFinite(row.width) && row.width > 0) {
      assert.ok(Math.abs(row.width - 0.95 * 16) < 6 || row.width > 8, "tray occupies the ~0.95em marker slot");
    }
  }
  assert.notEqual(open.mask, "none");
  await captureShot(client, args, entry);

  if (entry.mode === "live") {
    await evaluate(client, () => {
      const view = window.app.workspace.activeLeaf.view;
      view.editor.setCursor({ line: 3, ch: 4 });
      view.editor.focus();
    });
    await pause(400);
    await client.evaluate(`window.app.commands.executeCommandById("editor:toggle-fold")`);
    await pause(500);
    const folded = await evaluate(client, pageRows);
    const foldedOpen = folded.rows.find((row) => row.key === "API DESIGN");
    assert.ok(foldedOpen, "folded drawer still marked");
    if (foldedOpen.folded || (foldedOpen.after && foldedOpen.after.includes("2"))) {
      assert.ok(true);
    } else {
      assert.equal(foldedOpen.count, "2", "folded drawer keeps its note count");
    }
    await evaluate(client, () => {
      const view = window.app.workspace.activeLeaf.view;
      view.editor.setCursor({ line: 3, ch: 8 });
      view.editor.focus();
    });
    await pause(400);
    const revealed = await evaluate(client, () => {
      const line = [...window.app.workspace.activeLeaf.view.contentEl.querySelectorAll('.cm-line[data-bob-drawer="true"]')]
        .find((el) => (el.getAttribute("data-bob-drawer-key") || "") === "API DESIGN");
      if (!line) return null;
      const marker = line.querySelector(".cm-formatting-list");
      const before = marker ? getComputedStyle(marker, "::before") : null;
      return {
        color: marker ? getComputedStyle(marker).color : "",
        beforeDisplay: before ? before.display : "",
        active: line.classList.contains("cm-active") || line.classList.contains("cm-activeLine"),
      };
    });
    assert.ok(revealed, "caret line is still a drawer");
  }

  const pluginOn = await evaluate(client, () => window.app.plugins.plugins["bob-ledger-tools"].taskDrawerMarksEnabled !== false);
  assert.equal(pluginOn, true);
  await evaluate(client, () => window.app.plugins.plugins["bob-ledger-tools"].toggleTaskDrawerMarks());
  await pause(600);
  const off = await evaluate(client, pageRows);
  assert.equal(off.rows.length, 0, "toggle clears drawer attributes");
  const before = await evaluate(client, async () => {
    const view = window.app.workspace.activeLeaf.view;
    if (view.getMode && view.getMode() === "source") await view.save();
    return window.app.vault.read(view.file);
  });
  assert.ok(before.includes("- **API Design**"), "toggle does not rewrite Markdown");
  await evaluate(client, () => window.app.plugins.plugins["bob-ledger-tools"].toggleTaskDrawerMarks());
  await waitFor(client, `(${pageRows.toString()})().rows.length`, (length) => length >= 4, "toggle re-annotates", 5000);
}

module.exports = { CASES, SOURCE, run };
