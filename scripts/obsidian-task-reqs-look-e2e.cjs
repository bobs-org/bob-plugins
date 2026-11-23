"use strict";
// Computed-style + trusted-event acceptance for criterion diamonds. The parent
// runner owns a disposable vault; all note writes below are to that fixture.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const CASES = ["light", "dark"].flatMap((theme) => ["source", "preview"].map((mode) => ({
  name: `criterion diamonds ${theme} ${mode}`, theme, mode,
})));
const SOURCE = [
  "# Criterion diamonds", "",
  "- [ ] #task Ship the exporter ^ship",
  "\t- [ ] Depth one",
  "\t\t- [ ] Depth two",
  "\t\t\t- [ ] Depth three",
  "\t\t\t\t- [ ] Depth four",
  "\t\t\t\t\t- a note under the criterion",
  "\t- [x] Hand met",
  "\t- [-] Dropped",
  "\t\t- [ ] Excluded",
  "\t- [>] [[task-reqs-fixture#^ship|Carried]]",
  "\t- [?] Flagged",
  "\t- NOTES",
  "\t\t- Context stays a note",
  "- [x] #task Finished exporter",
  "\t- [ ] Derived met",
  "- [-] #task Cancelled exporter",
  "\t- [ ] Moot",
  "", "End of state sheet.",
].join("\n");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evaluate = (client, fn, arg) => client.evaluate(`(${fn.toString()})(${JSON.stringify(arg ?? null)})`);

function pageRows() {
  const view = window.app.workspace.activeLeaf.view;
  const root = view.contentEl;
  const rows = [...root.querySelectorAll('[data-bob-req="true"]')].filter((el) => el.getBoundingClientRect().height);
  return rows.map((row) => {
    const input = row.querySelector("input.task-list-item-checkbox");
    const cs = getComputedStyle(row);
    const host = getComputedStyle(input);
    const glyph = getComputedStyle(input, "::before");
    const r = input.getBoundingClientRect();
    // Find the row's own first prose text node, excluding child lists and markers.
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    let textOffset = null;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement.closest('.HyperMD-task-line,li.task-list-item') !== row) continue;
      if (!/Depth |Hand met|Derived met/.test(node.textContent)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      textOffset = range.getBoundingClientRect().left - r.left;
      break;
    }
    // text-decoration propagates visually even when a child's computed value
    // is none; stop at the atomic inline box that isolates the child list.
    let struck = false;
    for (let ancestor = row; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if (style.textDecorationLine.includes("line-through")) struck = true;
      if (style.display === "inline-block") break;
    }
    return {
      depth: Number(row.dataset.bobReqDepth), state: row.dataset.bobReqState,
      label: input.getAttribute("aria-label"), title: input.getAttribute("title"),
      rowTitle: row.getAttribute("title"), readonly: input.getAttribute("aria-readonly"),
      width: r.width, fontSize: parseFloat(host.fontSize), margin: parseFloat(host.marginRight),
      mask: glyph.maskImage, opacity: glyph.opacity, ink: glyph.backgroundColor,
      background: cs.backgroundColor, image: cs.backgroundImage,
      decoration: cs.textDecorationLine, color: cs.color, struck,
      after: getComputedStyle(input, "::after").content,
      textOffset, point: { x: r.x + r.width / 2, y: r.y + r.height / 2 },
    };
  });
}

async function run(client, entry, { setDoc, setMode, waitFor, args }) {
  await client.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1050, deviceScaleFactor: 1, mobile: false });
  await evaluate(client, async ({ theme }) => {
    document.body.classList.toggle("theme-dark", theme === "dark");
    document.body.classList.toggle("theme-light", theme === "light");
    const view = window.app.workspace.activeLeaf.view;
    await view.setState({ ...view.getState(), mode: "source", source: false }, { history: false });
    const plugin = window.app.plugins.plugins["bob-ledger-tools"];
    if (!plugin.taskTagMarksEnabled) plugin.toggleTaskTagMarks();
    // An adversarial status snippet proves all hand marks are neutralized.
    let style = document.getElementById("criterion-hostile-statuses");
    if (!style) {
      style = document.createElement("style"); style.id = "criterion-hostile-statuses";
      style.textContent = `.HyperMD-task-line[data-task="?"],li.task-list-item[data-task="?"] {background: linear-gradient(red,green) !important; border-inline-start: 3px solid red !important;}
        .HyperMD-task-line[data-task="x"],li.task-list-item[data-task="x"] {text-decoration: line-through;}
        input.task-list-item-checkbox:checked::after {content: "check";}`;
      document.head.appendChild(style);
    }
  }, entry);
  await setMode(client, false, true);
  await setDoc(client, SOURCE, [20, 10]);
  if (entry.mode === "preview") {
    await evaluate(client, async () => {
      const view = window.app.workspace.activeLeaf.view;
      await view.save();
      await view.setState({ ...view.getState(), mode: "preview" }, { history: false });
    });
  }
  await waitFor(client, `(${pageRows.toString()})()`, (rows) => rows?.length === 11, "11 requirement marks", 10000);
  await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 });
  await pause(200);
  const rows = await evaluate(client, pageRows);
  assert.equal(rows.length, 11);
  for (const row of rows) {
    assert.ok(Math.abs(row.width - row.fontSize) < 0.02, "constant 1em slot (subpixel rounding)");
    assert.ok(Math.abs(row.margin / row.fontSize - 0.24) < 0.01);
    assert.equal(row.title, null); assert.equal(row.rowTitle, null);
    assert.equal(row.readonly, "true"); assert.ok(!row.label.includes("::"));
    assert.equal(row.after, "none");
    assert.equal(row.background, "rgba(0, 0, 0, 0)"); assert.equal(row.image, "none");
  }
  const nested = rows.slice(0, 4);
  assert.deepEqual(nested.map((row) => row.depth), [1, 2, 3, 4]);
  assert.ok(nested.every((row) => row.textOffset !== null));
  assert.ok(nested.every((row) => Math.abs(row.textOffset - nested[0].textOffset) < 0.1), "each depth's text starts at its own bullet offset");
  // Pre-change depth-1 width was exactly 1em + .24em. Reapply that geometry
  // temporarily to measure its baseline without relying on a screenshot ruler.
  const baseline = await evaluate(client, () => {
    const input = [...window.app.workspace.activeLeaf.view.contentEl.querySelectorAll('[data-bob-req-depth="1"] input')].find((el) => el.getBoundingClientRect().width);
    const original = input.getAttribute("style");
    input.style.setProperty("width", "calc(2 * 0.5em)", "important");
    input.style.setProperty("min-width", "calc(2 * 0.5em)", "important");
    const width = input.getBoundingClientRect().width;
    if (original === null) input.removeAttribute("style"); else input.setAttribute("style", original);
    return width;
  });
  assert.equal(baseline, nested[0].width, "depth-1 baseline geometry unchanged");
  const hand = rows.find((row) => row.label.includes("Ship the exporter") && row.state === "met");
  const derived = rows.find((row) => row.label.includes("Finished exporter"));
  assert.equal(hand.mask, derived.mask); assert.equal(hand.color, derived.color);
  assert.equal(hand.decoration, "none"); assert.equal(derived.decoration, "none");
  assert.equal(hand.struck, false); assert.equal(derived.struck, false, "owner strike does not propagate");
  assert.equal(rows.find((row) => row.state === "excluded").struck, false);
  assert.equal(hand.opacity, "0.62");
  assert.equal(rows.find((row) => row.state === "excluded").opacity, "0.42");
  assert.equal(rows.find((row) => row.state === "moot").opacity, "0.42");
  assert.equal(rows.find((row) => row.state === "dropped").decoration, "line-through");
  assert.notEqual(rows.find((row) => row.label.includes("Flagged [?]")).ink, nested[0].ink);
  assert.equal(new Set(rows.map((row) => row.mask)).size, 4);

  // Capture real light/dark note rendering before hover/notice UI covers it.
  if (args.report) {
    const filename = path.join(path.dirname(path.resolve(args.report)), `requirements-${entry.theme}-${entry.mode}.png`);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    const shot = await client.call("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(filename, Buffer.from(shot.data, "base64"));
  }
  await client.call("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }, { name: "prefers-reduced-motion", value: "reduce" }] });
  const contrast = await evaluate(client, () => {
    const input = [...window.app.workspace.activeLeaf.view.contentEl.querySelectorAll('[data-bob-req-state="pending"] input')].find((el) => el.getBoundingClientRect().width);
    const style = getComputedStyle(input, "::before");
    return { adjust: style.forcedColorAdjust, ink: style.backgroundColor, opacity: style.opacity, transition: style.transitionDuration };
  });
  assert.equal(contrast.adjust, "none");
  assert.equal(contrast.opacity, "1");
  assert.equal(contrast.transition, "0s");
  assert.notEqual(contrast.ink, "rgba(0, 0, 0, 0)");
  await client.call("Emulation.setEmulatedMedia", { features: [] });
  const before = await evaluate(client, async () => {
    const view = window.app.workspace.activeLeaf.view;
    if (view.getMode() === "source") await view.save();
    return window.app.vault.read(view.file);
  });
  // Saving/first render can settle the editor layout. Hover the current box,
  // never a pre-save coordinate (which can be stale on the first source case).
  const point = (await evaluate(client, pageRows))[0].point;
  await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 });
  await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  await waitFor(client, 'Array.from(document.querySelectorAll(".tooltip")).map(el=>el.textContent)',
    (tips) => tips.some((text) => text.includes("Requirement of “Ship the exporter”")), "real positioned tooltip", 4000);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await client.call("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 });
  }
  await pause(300);
  const after = await evaluate(client, async () => {
    const view = window.app.workspace.activeLeaf.view;
    return { bytes: await window.app.vault.read(view.file), doc: view.editor?.getValue(), notices: [...document.querySelectorAll(".notice")].map((el) => el.textContent) };
  });
  assert.equal(after.bytes, before);
  if (entry.mode === "source") assert.equal(after.doc, SOURCE);
  assert.equal(after.notices.filter((text) => text.includes("Requirements are met when “Ship the exporter” closes")).length, 1);
  await evaluate(client, () => window.app.plugins.plugins["bob-ledger-tools"].toggleTaskTagMarks());
  await pause(200);
  assert.deepEqual(await evaluate(client, pageRows), [], "toggle clears both surfaces");
  assert.equal(await evaluate(client, () => window.app.workspace.activeLeaf.view.contentEl.querySelectorAll('input[aria-readonly="true"]').length), 0);
  await evaluate(client, () => window.app.plugins.plugins["bob-ledger-tools"].toggleTaskTagMarks());
  await waitFor(client, `(${pageRows.toString()})().length`, (length) => length === 11, "toggle re-annotates", 5000);
  if (entry.mode === "source") {
    await evaluate(client, () => window.app.workspace.activeLeaf.view.editor.setCursor({ line: 3, ch: 4 }));
    await waitFor(client, `(${pageRows.toString()})().length`, (length) => length === 10, "cursor reveals raw marker", 5000);
  }
}

module.exports = { CASES, SOURCE, pageRows, run };
