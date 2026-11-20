"use strict";
// The solid run well in a real Obsidian: one labeled ready chip as a Live
// Preview span and as a Reading button computes one look at rest and under
// a trusted CDP hover, shows its tooltip about 0.4 s after the hover, and
// a trusted click turns the well green. A chip in a ref/ note wears the
// copy well, copy glyph, and cursor:copy. Called from
// scripts/obsidian-command-chips-e2e.cjs against its scratch vault.

const fs = require("node:fs");
const path = require("node:path");
const fixture = require("./obsidian-command-chips-e2e-lib.cjs");

const LABEL = "Look";
const PAYLOAD = fixture.PAYLOADS.look;
const COPY_PAYLOAD = fixture.PAYLOADS.refDirect;
const HOST_PROPS = ["backgroundColor", "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor", "borderTopWidth", "borderLeftWidth", "boxShadow", "color", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "fontFamily", "fontSize", "fontWeight", "fontStyle", "outlineStyle", "outlineWidth", "cursor", "whiteSpace"];
const WELL_PROPS = ["backgroundColor", "color", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "marginLeft", "marginRight"];
const FACE_PROPS = ["fontWeight", "color"];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Runs in the page (serialized with toString()): the target chip in the
// active view, its computed look, its tooltip, and the theme's inks.
function pageLook(args) {
  const view = window.app.workspace.activeLeaf && window.app.workspace.activeLeaf.view;
  const container = (view && (view.contentEl || view.containerEl)) || document;
  const root = args.mode === "preview"
    ? container.querySelector(".markdown-reading-view") || container
    : container.querySelector(".markdown-source-view") || container;
  const chip = Array.from(root.querySelectorAll(".bob-run-chip")).find((el) => {
    const face = el.querySelector(":scope > .bob-run-chip-face");
    if (!face) return false;
    if (args.kind === "copy") return el.classList.contains("is-copy");
    return el.classList.contains("is-labeled") && face.textContent.indexOf(args.label) !== -1;
  });
  if (!chip) return { ok: false, reason: "no chip " + args.kind + " " + args.label };
  if (args.scroll) chip.scrollIntoView({ block: "center" });
  const well = chip.querySelector(":scope > .bob-run-chip-glyph");
  const face = chip.querySelector(":scope > .bob-run-chip-face");
  const tip = chip.querySelector(":scope > .bob-run-chip-tip");
  const pick = (el, props) => {
    const cs = getComputedStyle(el);
    const out = {};
    for (const prop of props) out[prop] = cs[prop];
    return out;
  };
  const probe = document.createElement("span");
  document.body.appendChild(probe);
  probe.style.color = "var(--interactive-accent)";
  const accent = getComputedStyle(probe).color;
  probe.style.color = "var(--color-blue)";
  const blue = getComputedStyle(probe).color;
  probe.style.color = "var(--color-green)";
  const green = getComputedStyle(probe).color;
  probe.style.color = "var(--interactive-normal)";
  const buttonFill = getComputedStyle(probe).color;
  probe.remove();
  const r = chip.getBoundingClientRect();
  const fr = face.getClientRects()[0];
  const tr = tip.getBoundingClientRect();
  const tcs = getComputedStyle(tip);
  const svg = well.querySelector("svg");
  const tipText = Array.from(tip.querySelectorAll(".bob-run-chip-tip-row")).map((row) => row.textContent).join(" · ");
  return {
    ok: true,
    tag: chip.tagName,
    point: { x: Math.round(fr.left + Math.min(fr.width / 2, 12)), y: Math.round(fr.top + fr.height / 2) },
    box: { left: r.left, top: r.top, width: r.width, height: r.height },
    host: pick(chip, args.hostProps),
    well: pick(well, args.wellProps),
    face: pick(face, args.faceProps),
    glyph: svg ? Array.from(svg.classList).find((name) => name.startsWith("lucide-")) || null : null,
    tip: { display: tcs.display, visibility: tcs.visibility, width: tr.width, height: tr.height, above: tr.bottom <= r.top + 0.5, text: tipText, role: tip.getAttribute("role"), described: chip.getAttribute("aria-describedby") === tip.id },
    hovered: chip.matches(":hover"),
    accent,
    blue,
    green,
    buttonFill,
  };
}

function lookExpression(mode, scroll, kind) {
  const args = { mode, scroll: Boolean(scroll), kind: kind || "run", label: LABEL, hostProps: HOST_PROPS, wellProps: WELL_PROPS, faceProps: FACE_PROPS };
  return "(" + pageLook.toString() + ")(" + JSON.stringify(args) + ")";
}

function diffLooks(a, b) {
  const diffs = [];
  for (const part of ["host", "well", "face"]) {
    for (const [prop, value] of Object.entries(a[part] || {})) {
      if (b[part][prop] !== value) diffs.push(part + "." + prop + ": " + value + " ≠ " + b[part][prop]);
    }
  }
  return diffs;
}

async function mouse(client, type, point, extra) {
  await client.call("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: "none", ...(extra || {}) }, 5000);
}

async function capture(client, outDir, name, box) {
  if (!outDir || !box) return null;
  try {
    const clip = { x: Math.max(0, Math.floor(box.left) - 24), y: Math.max(0, Math.floor(box.top) - 84), width: 520, height: Math.ceil(box.height) + 116, scale: 1 };
    const shot = await client.call("Page.captureScreenshot", { format: "png", clip }, 10_000);
    const file = path.join(outDir, name);
    fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
    return file;
  } catch (_error) {
    return null;
  }
}

function chipObjectExpression(mode, kind) {
  const labeled = kind === "copy"
    ? "el.classList.contains('is-copy')"
    : "el.classList.contains('is-labeled') && ((el.querySelector(':scope > .bob-run-chip-face') || {}).textContent || '').indexOf(" + JSON.stringify(LABEL) + ") !== -1";
  return "(() => { const view = window.app.workspace.activeLeaf && window.app.workspace.activeLeaf.view; const container = (view && (view.contentEl || view.containerEl)) || document; const root = " + JSON.stringify(mode) + " === 'preview' ? (container.querySelector('.markdown-reading-view') || container) : (container.querySelector('.markdown-source-view') || container); return Array.from(root.querySelectorAll('.bob-run-chip')).find((el) => " + labeled + ") || null; })()";
}

async function forcedHoverCapture(client, mode, outDir, name, record, kind) {
  let nodeId = null;
  try {
    await client.call("DOM.enable", {}, 5000);
    await client.call("CSS.enable", {}, 5000);
    await client.call("DOM.getDocument", { depth: 0 }, 5000);
    const found = await client.call("Runtime.evaluate", { expression: chipObjectExpression(mode, kind) }, 5000);
    if (!found.result || !found.result.objectId) throw new Error("no chip object");
    nodeId = (await client.call("DOM.requestNode", { objectId: found.result.objectId }, 5000)).nodeId;
    await client.call("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: ["hover"] }, 5000);
    await sleep(700);
    const look = await client.evaluate(lookExpression(mode, false, kind));
    const file = await capture(client, outDir, "command-chip-" + name + "-hover.png", look && look.box);
    record("look " + name + ": hover capture shows the tooltip", Boolean(look && look.tip.display === "block" && look.tip.visibility === "visible" && file), JSON.stringify({ file: file && path.basename(file), tip: look && look.tip.display }));
  } catch (error) {
    record("look " + name + ": hover capture shows the tooltip", false, String((error && error.message) || error));
  } finally {
    if (nodeId !== null) await client.call("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [] }, 5000).catch(() => null);
  }
}

async function reveal(client, mode, kind, needle) {
  const expression = "(() => { const view = window.app.workspace.activeLeaf && window.app.workspace.activeLeaf.view; const needle = " + JSON.stringify(needle) + "; const lines = (view.editor && view.editor.getValue && view.editor.getValue().split('\\n')) || []; const line = lines.findIndex((text) => text.includes(needle)); try { if (" + JSON.stringify(mode) + " === 'preview') { const preview = view.previewMode || view.currentMode; if (preview && typeof preview.applyScroll === 'function') preview.applyScroll(Math.max(0, line - 2)); } else if (view.editor && line >= 0) { view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true); } } catch (e) { return String(e && e.message || e); } return true; })()";
  const deadline = Date.now() + 8000;
  let look = null;
  while (Date.now() < deadline) {
    await client.evaluate(expression);
    await sleep(250);
    look = await client.evaluate(lookExpression(mode, true, kind));
    if (look && look.ok) return look;
  }
  return look;
}

async function surfaceCases(client, mode, outDir, record, kind) {
  const name = (kind === "copy" ? "copy-" : "") + (mode === "preview" ? "reading" : "live");
  const needle = kind === "copy" ? COPY_PAYLOAD : ("run[" + LABEL + "]: " + PAYLOAD);
  const rest = await reveal(client, mode, kind, needle);
  await sleep(400);
  const settled = await client.evaluate(lookExpression(mode, false, kind));
  record("look " + name + ": chip found", Boolean(settled && settled.ok), JSON.stringify(settled && settled.ok ? { tag: settled.tag } : rest).slice(0, 200));
  if (!settled || !settled.ok) return null;
  if (kind === "copy") {
    record(
      "look " + name + ": blue well, copy glyph, cursor:copy, no button fill",
      settled.well.backgroundColor === settled.blue && settled.host.cursor === "copy" && settled.host.backgroundColor !== settled.buttonFill && settled.host.boxShadow === "none" && settled.glyph === "lucide-copy",
      JSON.stringify({ well: settled.well.backgroundColor, blue: settled.blue, fill: settled.host.backgroundColor, cursor: settled.host.cursor, glyph: settled.glyph }),
    );
  } else {
    record(
      "look " + name + ": accent well, tinted body, play glyph, no button fill",
      settled.well.backgroundColor === settled.accent && settled.host.backgroundColor !== settled.buttonFill && settled.host.boxShadow === "none" && settled.glyph === "lucide-play",
      JSON.stringify({ well: settled.well.backgroundColor, accent: settled.accent, fill: settled.host.backgroundColor, shadow: settled.host.boxShadow, glyph: settled.glyph }),
    );
  }
  record("look " + name + ": tooltip hidden at rest and describes the chip", settled.tip.display === "none" && settled.tip.role === "tooltip" && settled.tip.described, JSON.stringify(settled.tip));
  await capture(client, outDir, "command-chip-" + name + "-rest.png", settled.box);

  const started = Date.now();
  await mouse(client, "mouseMoved", settled.point);
  let visibleAfter = null;
  let hover = null;
  while (Date.now() - started < 2000) {
    hover = await client.evaluate(lookExpression(mode, false, kind));
    if (hover && hover.ok && hover.tip.display !== "none" && hover.tip.visibility === "visible") {
      visibleAfter = Date.now() - started;
      break;
    }
    await sleep(40);
  }
  await sleep(200);
  hover = await client.evaluate(lookExpression(mode, false, kind));
  const payload = kind === "copy" ? COPY_PAYLOAD : PAYLOAD;
  record(
    "look " + name + ": tooltip shows about 0.4 s after a trusted hover",
    visibleAfter !== null && visibleAfter >= 300 && visibleAfter <= 1000 && hover.tip.above && hover.tip.width > 0 && String(hover.tip.text).includes(payload),
    JSON.stringify({ visibleAfter, tip: hover && hover.tip }).slice(0, 2500),
  );
  record(
    "look " + name + ": hover darkens the body and inks the border",
    Boolean(hover && hover.hovered && hover.host.backgroundColor !== settled.host.backgroundColor && hover.host.borderTopColor === (kind === "copy" ? hover.blue : hover.accent) && hover.host.boxShadow === "none"),
    JSON.stringify(hover && { hovered: hover.hovered, fill: hover.host.backgroundColor, border: hover.host.borderTopColor }),
  );
  await forcedHoverCapture(client, mode, outDir, name, record, kind);
  if (kind === "copy") await client.evaluate("navigator.clipboard.writeText('before-look-click').then(() => true, () => false)");
  await mouse(client, "mousePressed", settled.point, { button: "left", clickCount: 1 });
  await mouse(client, "mouseReleased", settled.point, { button: "left", clickCount: 1 });
  const deadline = Date.now() + 5000;
  let after = null;
  while (Date.now() < deadline) {
    await sleep(120);
    after = await client.evaluate(lookExpression(mode, false, kind));
    if (after && after.ok && after.well.backgroundColor === after.green) break;
  }
  if (kind === "copy") {
    const clipboard = await client.evaluate("navigator.clipboard.readText().then((t) => t, (e) => 'unreadable:' + e.message)");
    record(
      "look " + name + ": trusted click turns the well green and copies byte-exact",
      Boolean(after && after.ok && after.well.backgroundColor === after.green && after.glyph === "lucide-check" && clipboard === COPY_PAYLOAD),
      JSON.stringify({ well: after && after.well.backgroundColor, green: after && after.green, glyph: after && after.glyph, clipboard }),
    );
  } else {
    record(
      "look " + name + ": trusted click turns the well green",
      Boolean(after && after.ok && after.well.backgroundColor === after.green && after.glyph === "lucide-check"),
      JSON.stringify({ well: after && after.well.backgroundColor, green: after && after.green, glyph: after && after.glyph }),
    );
  }
  await capture(client, outDir, "command-chip-" + name + "-clicked.png", after && after.box);
  await mouse(client, "mouseMoved", { x: 2, y: 2 });
  await sleep(1400);
  return { rest: settled, hover };
}

async function runLookCases(client, openNote, record, outDir) {
  const live = await openNote(client, fixture.NOTES.main, "live");
  record("look: note open (live)", Boolean(live && live.ok), JSON.stringify(live).slice(0, 160));
  await sleep(600);
  const lp = await surfaceCases(client, "live", outDir, record, "run");
  const reading = await openNote(client, fixture.NOTES.main, "preview");
  record("look: note open (reading)", Boolean(reading && reading.ok), JSON.stringify(reading).slice(0, 160));
  await sleep(600);
  const rd = await surfaceCases(client, "preview", outDir, record, "run");
  if (!lp || !rd) {
    record("look: span and button parity", false, "a surface did not render the labeled chip");
  } else {
    record("look: span and button compute one look at rest", rd.rest.tag === "BUTTON" && lp.rest.tag === "SPAN" && diffLooks(lp.rest, rd.rest).length === 0, diffLooks(lp.rest, rd.rest).join("; ").slice(0, 400));
    record("look: span and button compute one look under hover", diffLooks(lp.hover, rd.hover).length === 0, diffLooks(lp.hover, rd.hover).join("; ").slice(0, 400));
  }

  const copyLive = await openNote(client, fixture.NOTES.ref, "live");
  record("look copy-only: note open (live)", Boolean(copyLive && copyLive.ok), JSON.stringify(copyLive).slice(0, 160));
  await sleep(600);
  const copyLp = await surfaceCases(client, "live", outDir, record, "copy");
  const copyReading = await openNote(client, fixture.NOTES.ref, "preview");
  record("look copy-only: note open (reading)", Boolean(copyReading && copyReading.ok), JSON.stringify(copyReading).slice(0, 160));
  await sleep(600);
  const copyRd = await surfaceCases(client, "preview", outDir, record, "copy");
  if (!copyLp || !copyRd) {
    record("look copy-only: span and button parity", false, "a surface did not render the copy-only chip");
    return;
  }
  record("look copy-only: span and button compute one look at rest", copyRd.rest.tag === "BUTTON" && copyLp.rest.tag === "SPAN" && diffLooks(copyLp.rest, copyRd.rest).length === 0, diffLooks(copyLp.rest, copyRd.rest).join("; ").slice(0, 400));
}

function selfTest() {
  const notes = fixture.noteText();
  const main = notes[fixture.NOTES.main];
  if (!main.includes("`run[" + LABEL + "]: " + PAYLOAD + "`")) throw new Error("seed note lacks the labeled look chip");
  const ref = notes[fixture.NOTES.ref];
  if (!ref.includes("`run: " + COPY_PAYLOAD + "`")) throw new Error("ref note lacks the copy-only look chip");
  const expression = lookExpression("live", true, "run");
  // eslint-disable-next-line no-new-func
  new Function("return " + expression);
  if (diffLooks({ host: { a: "1" }, well: {}, face: {} }, { host: { a: "2" }, well: {}, face: {} }).length !== 1) throw new Error("diffLooks");
  return true;
}

module.exports = { runLookCases, selfTest, LABEL, PAYLOAD, COPY_PAYLOAD, HOST_PROPS, WELL_PROPS, FACE_PROPS };
