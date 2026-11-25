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
  const activeMode = typeof view.getMode === "function" ? view.getMode() : "";
  const isLive = activeMode ? activeMode === "source" && live.length > 0 : live.length > 0;
  const findTextElement = (scope, selector, needle) => {
    const matches = [...scope.querySelectorAll(selector)].filter((candidate) => candidate.textContent.includes(needle));
    return matches.find((candidate) => ![...candidate.children].some((child) => child.textContent.includes(needle)))
      || matches[matches.length - 1]
      || null;
  };
  const textStyle = (needle) => {
    const selector = isLive ? ".cm-line" : "*";
    const el = findTextElement(root, selector, needle);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { fontWeight: cs.fontWeight, color: cs.color };
  };
  const rows = (isLive ? live : reading).map((row) => {
    const marker = row.querySelector(".cm-formatting-list");
    const glyph = marker
      ? getComputedStyle(marker, "::before")
      : getComputedStyle(row, "::before");
    const glyphAfter = marker ? getComputedStyle(marker, "::after") : getComputedStyle(row, "::after");
    const nativeMarker = marker ? getComputedStyle(marker, "::marker") : getComputedStyle(row, "::marker");
    const nativeBullet = marker && marker.querySelector(".list-bullet");
    const nativeBulletStyle = nativeBullet ? getComputedStyle(nativeBullet) : null;
    const nativeBulletAfter = nativeBullet ? getComputedStyle(nativeBullet, "::after") : null;
    const rowMarker = getComputedStyle(row, "::marker");
    const rowBefore = getComputedStyle(row, "::before");
    const markerRect = marker ? marker.getBoundingClientRect() : null;
    const title = row.getAttribute("title") || "";
    const strong = row.querySelector(".cm-strong, strong") || row.querySelector("p");
    const strongCs = strong ? getComputedStyle(strong) : null;
    const owner = !isLive && row.parentElement && row.parentElement.parentElement;
    const ownerText = owner && [...owner.children].find((child) =>
      !["UL", "OL", "INPUT"].includes(child.tagName) && child.textContent.trim(),
    );
    const ownerDecoration = ownerText ? getComputedStyle(ownerText).textDecorationLine : "";
    const ownerContainerDecoration = owner ? getComputedStyle(owner).textDecorationLine : "";
    const nestedList = row.querySelector(":scope > ul, :scope > ol");
    const child = isLive
      ? findTextElement(root, ".cm-line", "Review the endpoint")
      : findTextElement(row, "*", "Review the endpoint");
    const childVisible = child ? child.getBoundingClientRect().height > 0 : false;
    const fontSize = parseFloat(getComputedStyle(row).fontSize) || 16;
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
      expectedSlot: fontSize * 0.95,
      mask: glyph.webkitMaskImage || glyph.maskImage || glyph.mask,
      ink: glyph.backgroundColor,
      display: glyph.display,
      markerColor: marker ? getComputedStyle(marker).color : "",
      markerBefore: marker ? getComputedStyle(marker, "::before").content : "",
      markerAfter: glyphAfter.content,
      markerText: marker ? marker.textContent : "",
      markerHtml: marker ? marker.outerHTML : "",
      nativeBullet: {
        text: nativeBullet ? nativeBullet.textContent : "",
        color: nativeBulletStyle ? nativeBulletStyle.color : "",
        textFill: nativeBulletStyle ? nativeBulletStyle.webkitTextFillColor : "",
        before: nativeBullet ? getComputedStyle(nativeBullet, "::before").content : "",
        after: nativeBulletAfter ? nativeBulletAfter.content : "",
        afterColor: nativeBulletAfter ? nativeBulletAfter.color : "",
      },
      nativeMarker: {
        content: nativeMarker.content,
        color: nativeMarker.color,
        fontSize: nativeMarker.fontSize,
        display: nativeMarker.display,
      },
      rowMarker: {
        content: rowMarker.content,
        color: rowMarker.color,
        fontSize: rowMarker.fontSize,
        display: rowMarker.display,
      },
      rowBefore: {
        content: rowBefore.content,
        color: rowBefore.color,
        width: rowBefore.width,
        display: rowBefore.display,
      },
      markerRect: markerRect && {
        left: markerRect.left,
        right: markerRect.right,
        width: markerRect.width,
        height: markerRect.height,
      },
      markerClass: marker && marker.className,
      fontWeight: strongCs ? String(strongCs.fontWeight) : "",
      color: strongCs ? strongCs.color : "",
      decoration: strongCs ? strongCs.textDecorationLine : "",
      titleBackground: strongCs ? strongCs.backgroundColor : "",
      titlePosition: strongCs ? strongCs.position : "",
      titleZIndex: strongCs ? strongCs.zIndex : "",
      ownerContainerDecoration,
      titleNodeTag: strong && strong.tagName ? strong.tagName : "",
      titleNodeHtml: strong && strong.outerHTML ? strong.outerHTML : "",
      titleAncestors: (() => {
        const ancestors = [];
        for (let node = strong, depth = 0; node && depth < 5; node = node.parentElement, depth += 1) {
          ancestors.push({ tag: node.tagName || "", className: node.className || "", id: node.id || "" });
        }
        return ancestors;
      })(),
      rowHtml: row.outerHTML ? row.outerHTML.slice(0, 1400) : "",
      shieldMatches: Boolean(strong && strong.matches && strong.matches(
        '.markdown-preview-view li[data-bob-drawer="true"] > p:first-of-type > strong:first-child, '
          + '.markdown-preview-view li[data-bob-drawer="true"] > strong',
      )),
      ownerChecked: Boolean(owner && owner.classList.contains("is-checked")),
      ownerDecoration,
      ownerTextHtml: ownerText && ownerText.outerHTML ? ownerText.outerHTML.slice(0, 500) : "",
      nestedListDecoration: nestedList ? getComputedStyle(nestedList).textDecorationLine : "",
      childVisible,
      folded: row.classList.contains("is-collapsed")
        || Boolean(row.querySelector(".cm-fold-indicator.is-collapsed")),
      after: getComputedStyle(row, "::after").content,
    };
  });
  const reqs = [...root.querySelectorAll('[data-bob-req="true"]')]
    .filter((el) => el.getBoundingClientRect().height).length;
  return {
    rows,
    reqs,
    live: isLive,
    activeMode,
    nestedNote: textStyle("Review the endpoint"),
    ordinaryNote: textStyle("ordinary note beside the tray"),
  };
}

function delimiterState() {
  const root = window.app.workspace.activeLeaf.view.contentEl;
  const line = [...root.querySelectorAll('.cm-line[data-bob-drawer-key="API DESIGN"]')][0];
  if (!line) return null;
  const markers = [...line.querySelectorAll(".cm-formatting-strong")].map((el) => {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const visible = cs.display !== "none" && cs.visibility !== "hidden"
      && Number(cs.opacity) > 0 && cs.color !== "rgba(0, 0, 0, 0)";
    return {
      text: el.textContent,
      color: cs.color,
      opacity: cs.opacity,
      display: cs.display,
      visibility: cs.visibility,
      width: rect.width,
      visible,
    };
  });
  return {
    active: line.classList.contains("cm-active") || line.classList.contains("cm-activeLine"),
    markers,
  };
}

async function toggleReadingFold(client) {
  const target = await evaluate(client, () => {
    const row = [...window.app.workspace.activeLeaf.view.contentEl.querySelectorAll('li[data-bob-drawer-key="API DESIGN"]')][0];
    const control = row && row.querySelector(".collapse-indicator, .collapse-icon");
    if (!control) return null;
    const rect = control.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height };
  });
  assert.ok(target && target.width > 0 && target.height > 0, "reading view exposes Obsidian's native fold control");
  await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: target.x, y: target.y });
  await client.call("Input.dispatchMouseEvent", { type: "mousePressed", x: target.x, y: target.y, button: "left", clickCount: 1 });
  await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: target.x, y: target.y, button: "left", clickCount: 1 });
  await pause(450);
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
  const evidence = {
    theme: entry.theme,
    mode: entry.mode,
    activeMode: state.activeMode,
    live: state.live,
    reqs: state.reqs,
    rows: state.rows.map((row) => ({
      key: row.key,
      count: row.count,
      empty: row.empty,
      ownerState: row.ownerState,
      title: row.title,
      width: row.width,
      height: row.height,
      expectedSlot: row.expectedSlot,
      mask: row.mask,
      markerText: row.markerText,
      markerHtml: row.markerHtml,
      markerColor: row.markerColor,
      markerBefore: row.markerBefore,
      markerAfter: row.markerAfter,
      nativeMarker: row.nativeMarker,
      nativeBullet: row.nativeBullet,
      rowMarker: row.rowMarker,
      rowBefore: row.rowBefore,
      markerRect: row.markerRect,
      fontWeight: row.fontWeight,
      decoration: row.decoration,
      ownerDecoration: row.ownerDecoration,
      ownerTextHtml: row.ownerTextHtml,
      ownerContainerDecoration: row.ownerContainerDecoration,
      nestedListDecoration: row.nestedListDecoration,
      titleBackground: row.titleBackground,
      titlePosition: row.titlePosition,
      titleZIndex: row.titleZIndex,
      titleNodeTag: row.titleNodeTag,
      titleNodeHtml: row.titleNodeHtml,
      titleAncestors: row.titleAncestors,
      rowHtml: row.rowHtml,
      shieldMatches: row.shieldMatches,
      folded: row.folded,
      after: row.after,
    })),
    nestedNote: state.nestedNote,
    ordinaryNote: state.ordinaryNote,
  };
  // Keep real Obsidian output even when a later style assertion fails. This
  // lets the acceptance report pair all four screenshots with native-marker
  // geometry from the same run.
  try {
  await captureShot(client, args, entry);
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
    assert.ok(Math.abs(row.width - row.expectedSlot) < 3, row.key + " tray width " + row.width + " is not 0.95em (" + row.expectedSlot + ")");
    assert.ok(row.height >= row.expectedSlot * 0.68 && row.height <= row.expectedSlot * 0.95, row.key + " tray height " + row.height);
  }
  assert.notEqual(open.mask, "none");
  assert.ok(
    state.nestedNote && state.ordinaryNote,
    "nested and ordinary notes are present: " + JSON.stringify({
      activeMode: state.activeMode,
      live: state.live,
      nestedNote: state.nestedNote,
      ordinaryNote: state.ordinaryNote,
    }),
  );
  assert.deepEqual(state.nestedNote, state.ordinaryNote, "drawer descendants keep ordinary note typography");
  if (entry.mode === "reading") {
    assert.equal(done.ownerChecked, true, "the strike-leak case has a native checked owner");
    assert.equal(done.ownerContainerDecoration, "none", "the owner decoration stops before its drawer header");
    assert.match(done.ownerDecoration, /line-through/, "the completed owner title retains its native strike");
    assert.match(done.nestedListDecoration, /line-through/, "drawer notes retain the completed owner's strike");
    assert.equal(done.decoration, "none", "the drawer title is not struck through");
  }
  if (entry.mode === "live") {
    const resting = await evaluate(client, delimiterState);
    const sourceLine = await evaluate(client, () => {
      const view = window.app.workspace.activeLeaf.view;
      return view.editor && typeof view.editor.getValue === "function"
        ? view.editor.getValue().split(/\r?\n/)[3] || ""
        : "";
    });
    assert.match(sourceLine, /- \*\*API Design\*\*/, "the saved drawer title keeps native bold delimiters");
    await evaluate(client, () => {
      const view = window.app.workspace.activeLeaf.view;
      view.editor.setCursor({ line: 3, ch: 8 });
      view.editor.focus();
    });
    await pause(400);
    const revealed = await evaluate(client, delimiterState);
    assert.equal(revealed.active, true, "the drawer header owns the caret");
    assert.ok(revealed.markers.length >= 2 && revealed.markers.every((marker) => marker.visible), JSON.stringify({ sourceLine, resting, revealed }));
    await evaluate(client, () => {
      const view = window.app.workspace.activeLeaf.view;
      view.editor.setCursor({ line: 16, ch: 0 });
      view.editor.focus();
    });
    await pause(400);
    const restored = await evaluate(client, delimiterState);
    assert.ok(restored.markers.every((marker) => !marker.visible), JSON.stringify(restored));
    assert.deepEqual(
      restored.markers.map(({ text, color, opacity, display, visibility }) => ({ text, color, opacity, display, visibility })),
      resting.markers.map(({ text, color, opacity, display, visibility }) => ({ text, color, opacity, display, visibility })),
      "native delimiters restore their resting appearance when the caret leaves",
    );
    evidence.delimiters = { resting: resting.markers, revealed: revealed.markers, restored: restored.markers };
    await evaluate(client, () => {
      const view = window.app.workspace.activeLeaf.view;
      view.editor.setCursor({ line: 3, ch: 8 });
      view.editor.focus();
    });
    await pause(150);
    await client.evaluate(`window.app.commands.executeCommandById("editor:toggle-fold")`);
  } else {
    await toggleReadingFold(client);
  }

  await pause(450);
  const folded = await evaluate(client, pageRows);
  const foldedOpen = folded.rows.find((row) => row.key === "API DESIGN");
  assert.ok(foldedOpen, "folded drawer still marked");
  assert.equal(foldedOpen.folded, true, "native folding hides the drawer's child rows");
  assert.equal(foldedOpen.childVisible, false, "nested note is actually folded away");
  assert.match(foldedOpen.after, /2/, "the source-backed folded count is visible: " + foldedOpen.after);
  evidence.folded = { folded: foldedOpen.folded, childVisible: foldedOpen.childVisible, count: foldedOpen.count, after: foldedOpen.after };

  if (entry.mode === "live") {
    await client.evaluate(`window.app.commands.executeCommandById("editor:toggle-fold")`);
  } else {
    await toggleReadingFold(client);
  }
  await pause(450);
  const unfolded = await evaluate(client, pageRows);
  const unfoldedOpen = unfolded.rows.find((row) => row.key === "API DESIGN");
  assert.ok(unfoldedOpen && !unfoldedOpen.folded, "native unfold restores the drawer");
  assert.equal(unfoldedOpen.childVisible, true);
  evidence.unfolded = { folded: unfoldedOpen.folded, childVisible: unfoldedOpen.childVisible };

  const tab = String.fromCharCode(9);
  const authLine = tab + tab + "- Check the auth";
  const editedSource = SOURCE.replace(authLine, authLine + "\n" + tab + tab + "- Added after first render");
  if (entry.mode === "reading") {
    await evaluate(client, async () => {
      const view = window.app.workspace.activeLeaf.view;
      await view.setState({ ...view.getState(), mode: "source", source: false }, { history: false });
    });
    await pause(300);
  }
  await setDoc(client, editedSource, [16, 0]);
  if (entry.mode === "reading") {
    await evaluate(client, async () => {
      const view = window.app.workspace.activeLeaf.view;
      await view.save();
      await view.setState({ ...view.getState(), mode: "preview" }, { history: false });
    });
  }
  await waitFor(client, "(" + pageRows.toString() + ")()", (next) => {
    const row = next && next.rows && next.rows.find((candidate) => candidate.key === "API DESIGN");
    return row && row.count === "3";
  }, "drawer count refresh after an edit", 10000);
  if (entry.mode === "live") {
    await evaluate(client, () => {
      const view = window.app.workspace.activeLeaf.view;
      view.editor.setCursor({ line: 3, ch: 8 });
      view.editor.focus();
    });
    await client.evaluate(`window.app.commands.executeCommandById("editor:toggle-fold")`);
  } else {
    await toggleReadingFold(client);
  }
  await pause(450);
  const refolded = await evaluate(client, pageRows);
  const refoldedOpen = refolded.rows.find((row) => row.key === "API DESIGN");
  assert.ok(refoldedOpen && refoldedOpen.folded, "native fold reapplies after the edit");
  assert.equal(refoldedOpen.count, "3");
  assert.match(refoldedOpen.after, /3/, "the refreshed folded count is visible");
  evidence.refolded = { folded: refoldedOpen.folded, count: refoldedOpen.count, after: refoldedOpen.after };
  if (entry.mode === "live") {
    await client.evaluate(`window.app.commands.executeCommandById("editor:toggle-fold")`);
  } else {
    await toggleReadingFold(client);
  }
  await pause(300);

  const pluginOn = await evaluate(client, () => window.app.plugins.plugins["bob-ledger-tools"].taskDrawerMarksEnabled !== false);
  assert.equal(pluginOn, true);
  const beforeOff = await evaluate(client, async () => {
    const view = window.app.workspace.activeLeaf.view;
    if (view.getMode && view.getMode() === "source") await view.save();
    return window.app.vault.read(view.file);
  });
  assert.equal(beforeOff, editedSource, "the editor saved the direct drawer note");
  await evaluate(client, () => window.app.plugins.plugins["bob-ledger-tools"].toggleTaskDrawerMarks());
  await pause(600);
  const off = await evaluate(client, pageRows);
  assert.equal(off.rows.length, 0, "toggle clears drawer attributes");
  const ownedAttrs = await evaluate(client, () => window.app.workspace.activeLeaf.view.contentEl.querySelectorAll('[data-bob-drawer="true"]').length);
  assert.equal(ownedAttrs, 0, "settings off removes every owned drawer attribute");
  const before = await evaluate(client, async () => {
    const view = window.app.workspace.activeLeaf.view;
    return window.app.vault.read(view.file);
  });
  assert.equal(before, beforeOff, "settings off does not change Markdown");
  await evaluate(client, () => window.app.plugins.plugins["bob-ledger-tools"].toggleTaskDrawerMarks());
  await waitFor(client, `(${pageRows.toString()})().rows.length`, (length) => length >= 4, "toggle re-annotates", 5000);
  return JSON.stringify(evidence);
  } catch (error) {
    error.message = (error.message || String(error)) + "\nTask drawer diagnostics: " + JSON.stringify(evidence);
    throw error;
  }
}

module.exports = { CASES, SOURCE, run };
