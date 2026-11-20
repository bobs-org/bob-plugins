"use strict";
// The blue copy well in a real Obsidian: one labeled chip as a Live
// Preview span and as a Reading button computes one look at rest and under
// a trusted CDP hover, shows its tooltip about 0.4 s after the hover, and
// a trusted click turns the well green and copies byte-exact. Called from
// scripts/obsidian-copy-chips-e2e.cjs against its scratch vault.

const fs = require("node:fs");
const path = require("node:path");
const fixture = require("./obsidian-copy-chips-e2e-lib.cjs");

const LABEL = "Zoom";
const PAYLOAD = "https://zoom.us/j/123";
const HOST_PROPS = ["backgroundColor", "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor", "borderTopWidth", "borderLeftWidth", "boxShadow", "color", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "fontFamily", "fontSize", "fontWeight", "fontStyle", "outlineStyle", "outlineWidth", "cursor", "whiteSpace"];
const WELL_PROPS = ["backgroundColor", "color", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "marginLeft", "marginRight"];
const FACE_PROPS = ["fontWeight", "color"];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Runs in the page (serialized with toString()): the labeled chip in the
// active view, its computed look, its tooltip, and the theme's blue/green.
function pageLook(args) {
  const view = window.app.workspace.activeLeaf && window.app.workspace.activeLeaf.view;
  const container = (view && (view.contentEl || view.containerEl)) || document;
  const root = args.mode === "preview"
    ? container.querySelector(".markdown-reading-view") || container
    : container.querySelector(".markdown-source-view") || container;
  const chip = Array.from(root.querySelectorAll(".bob-copy-chip.is-labeled")).find((el) => {
    const face = el.querySelector(":scope > .bob-copy-chip-face");
    return face && face.textContent === args.label;
  });
  if (!chip) return { ok: false, reason: "no labeled chip " + args.label };
  if (args.scroll) chip.scrollIntoView({ block: "center" });
  const well = chip.querySelector(":scope > .bob-copy-chip-glyph");
  const face = chip.querySelector(":scope > .bob-copy-chip-face");
  const tip = chip.querySelector(":scope > .bob-copy-chip-tip");
  const pick = (el, props) => {
    const cs = getComputedStyle(el);
    const out = {};
    for (const prop of props) out[prop] = cs[prop];
    return out;
  };
  const probe = document.createElement("span");
  document.body.appendChild(probe);
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
  // Ancestors that can clip the tooltip or trap it in a stacking context.
  const clippers = [];
  for (let el = chip.parentElement; el && el !== document.documentElement; el = el.parentElement) {
    const cs = getComputedStyle(el);
    const flags = [];
    if (cs.overflowX !== "visible" || cs.overflowY !== "visible") flags.push("overflow:" + cs.overflowX + "/" + cs.overflowY);
    if (cs.contain && cs.contain !== "none") flags.push("contain:" + cs.contain);
    if (cs.clipPath && cs.clipPath !== "none") flags.push("clip-path");
    if (cs.transform && cs.transform !== "none") flags.push("transform");
    if (cs.zIndex !== "auto" && cs.position !== "static") flags.push("z:" + cs.zIndex);
    if (cs.contentVisibility && cs.contentVisibility !== "visible") flags.push("content-visibility:" + cs.contentVisibility);
    if (flags.length) {
      const b = el.getBoundingClientRect();
      clippers.push({ el: el.tagName.toLowerCase() + "." + String(el.className || "").split(/\s+/).slice(0, 3).join("."), flags, top: Math.round(b.top) });
    }
  }
  return {
    clippers,
    ok: true,
    tag: chip.tagName,
    point: { x: Math.round(fr.left + Math.min(fr.width / 2, 12)), y: Math.round(fr.top + fr.height / 2) },
    box: { left: r.left, top: r.top, width: r.width, height: r.height },
    host: pick(chip, args.hostProps),
    well: pick(well, args.wellProps),
    face: pick(face, args.faceProps),
    glyph: svg ? Array.from(svg.classList).find((name) => name.startsWith("lucide-")) || null : null,
    tip: { display: tcs.display, visibility: tcs.visibility, width: tr.width, height: tr.height, above: tr.bottom <= r.top + 0.5, text: tip.textContent, role: tip.getAttribute("role"), described: chip.getAttribute("aria-describedby") === tip.id },
    hovered: chip.matches(":hover"),
    blue,
    green,
    buttonFill,
  };
}

function lookExpression(mode, scroll) {
  const args = { mode, scroll: Boolean(scroll), label: LABEL, hostProps: HOST_PROPS, wellProps: WELL_PROPS, faceProps: FACE_PROPS };
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

// The labeled chip as a remote object, for DevTools' forced pseudo-states.
function chipObjectExpression(mode) {
  return "(() => { const view = window.app.workspace.activeLeaf && window.app.workspace.activeLeaf.view; const container = (view && (view.contentEl || view.containerEl)) || document; const root = " + JSON.stringify(mode) + " === 'preview' ? (container.querySelector('.markdown-reading-view') || container) : (container.querySelector('.markdown-source-view') || container); return Array.from(root.querySelectorAll('.bob-copy-chip.is-labeled')).find((el) => { const f = el.querySelector(':scope > .bob-copy-chip-face'); return f && f.textContent === " + JSON.stringify(LABEL) + "; }) || null; })()";
}

async function forcedHoverCapture(client, mode, outDir, name, record) {
  let nodeId = null;
  try {
    await client.call("DOM.enable", {}, 5000);
    await client.call("CSS.enable", {}, 5000);
    await client.call("DOM.getDocument", { depth: 0 }, 5000);
    const found = await client.call("Runtime.evaluate", { expression: chipObjectExpression(mode) }, 5000);
    if (!found.result || !found.result.objectId) throw new Error("no chip object");
    nodeId = (await client.call("DOM.requestNode", { objectId: found.result.objectId }, 5000)).nodeId;
    await client.call("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: ["hover"] }, 5000);
    await sleep(700);
    const look = await client.evaluate(lookExpression(mode, false));
    const file = await capture(client, outDir, "copy-chip-" + name + "-hover.png", look && look.box);
    record("look " + name + ": hover capture shows the tooltip", Boolean(look && look.tip.display === "block" && look.tip.visibility === "visible" && file), JSON.stringify({ file: file && path.basename(file), tip: look && look.tip.display }));
  } catch (error) {
    record("look " + name + ": hover capture shows the tooltip", false, String((error && error.message) || error));
  } finally {
    if (nodeId !== null) await client.call("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [] }, 5000).catch(() => null);
  }
}

// Live Preview and Reading view render only what is near the viewport, and
// the note reopens at its last scroll, so bring the chip's line into view
// first, then wait for the chip to render.
async function reveal(client, mode) {
  const line = fixture.seedNote().split("\n").findIndex((text) => text.includes("`copy[" + LABEL + "]: " + PAYLOAD + "`"));
  const expression = "(() => { const view = window.app.workspace.activeLeaf && window.app.workspace.activeLeaf.view; const line = " + line + "; try { if (" + JSON.stringify(mode) + " === 'preview') { const preview = view.previewMode || view.currentMode; if (preview && typeof preview.applyScroll === 'function') preview.applyScroll(Math.max(0, line - 2)); } else if (view.editor) { view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true); } } catch (e) { return String(e && e.message || e); } return true; })()";
  const deadline = Date.now() + 8000;
  let look = null;
  while (Date.now() < deadline) {
    await client.evaluate(expression);
    await sleep(250);
    look = await client.evaluate(lookExpression(mode, true));
    if (look && look.ok) return look;
  }
  return look;
}

// One surface: rest look, trusted hover (tooltip timing and hover look),
// then a trusted click (green well, byte-exact clipboard).
async function surfaceCases(client, mode, outDir, record) {
  const name = mode === "preview" ? "reading" : "live";
  const rest = await reveal(client, mode);
  await sleep(400);
  const settled = await client.evaluate(lookExpression(mode, false));
  record("look " + name + ": labeled chip found", Boolean(settled && settled.ok), JSON.stringify(settled && settled.ok ? { tag: settled.tag } : rest).slice(0, 200));
  if (!settled || !settled.ok) return null;
  record(
    "look " + name + ": blue well, tinted body, no button fill",
    settled.well.backgroundColor === settled.blue && settled.host.backgroundColor !== settled.buttonFill && settled.host.boxShadow === "none" && settled.glyph === "lucide-copy",
    JSON.stringify({ well: settled.well.backgroundColor, blue: settled.blue, fill: settled.host.backgroundColor, shadow: settled.host.boxShadow, glyph: settled.glyph }),
  );
  record("look " + name + ": tooltip hidden at rest and describes the chip", settled.tip.display === "none" && settled.tip.role === "tooltip" && settled.tip.described, JSON.stringify(settled.tip));
  await capture(client, outDir, "copy-chip-" + name + "-rest.png", settled.box);

  const started = Date.now();
  await mouse(client, "mouseMoved", settled.point);
  let visibleAfter = null;
  let hover = null;
  while (Date.now() - started < 2000) {
    hover = await client.evaluate(lookExpression(mode, false));
    if (hover && hover.ok && hover.tip.display !== "none" && hover.tip.visibility === "visible") {
      visibleAfter = Date.now() - started;
      break;
    }
    await sleep(40);
  }
  await sleep(200);
  hover = await client.evaluate(lookExpression(mode, false));
  const expectedTip = "Copy: " + PAYLOAD + (mode === "preview" ? "" : " · Alt+Click to edit");
  record(
    "look " + name + ": tooltip shows about 0.4 s after a trusted hover",
    visibleAfter !== null && visibleAfter >= 300 && visibleAfter <= 1000 && hover.tip.above && hover.tip.width > 0 && hover.tip.text === expectedTip,
    JSON.stringify({ visibleAfter, tip: hover && hover.tip, clippers: hover && hover.clippers }).slice(0, 2500),
  );
  record(
    "look " + name + ": hover darkens the body and inks the border",
    Boolean(hover && hover.hovered && hover.host.backgroundColor !== settled.host.backgroundColor && hover.host.borderTopColor === hover.blue && hover.host.boxShadow === "none"),
    JSON.stringify(hover && { hovered: hover.hovered, fill: hover.host.backgroundColor, border: hover.host.borderTopColor }),
  );
  // A clipped screenshot drops a trusted hover in Electron, so the hover
  // captures force :hover through DevTools; the checks above use the
  // trusted hover.
  await forcedHoverCapture(client, mode, outDir, name, record);
  await client.evaluate("navigator.clipboard.writeText('before-look-click').then(() => true, () => false)");
  await mouse(client, "mousePressed", settled.point, { button: "left", clickCount: 1 });
  await mouse(client, "mouseReleased", settled.point, { button: "left", clickCount: 1 });
  await sleep(300);
  const copied = await client.evaluate(lookExpression(mode, false));
  const clipboard = await client.evaluate("navigator.clipboard.readText().then((t) => t, (e) => 'unreadable:' + e.message)");
  record(
    "look " + name + ": trusted click turns the well green and copies byte-exact",
    Boolean(copied && copied.ok && copied.well.backgroundColor === copied.green && copied.glyph === "lucide-check" && clipboard === PAYLOAD),
    JSON.stringify({ well: copied && copied.well.backgroundColor, green: copied && copied.green, glyph: copied && copied.glyph, clipboard }),
  );
  await capture(client, outDir, "copy-chip-" + name + "-copied.png", copied && copied.box);
  await mouse(client, "mouseMoved", { x: 2, y: 2 });
  await sleep(1400);
  return { rest: settled, hover };
}

async function runLookCases(client, openNote, record, outDir) {
  const live = await openNote(client, fixture.notePath(), "live");
  record("look: note open (live)", Boolean(live && live.ok), JSON.stringify(live).slice(0, 160));
  await sleep(600);
  const lp = await surfaceCases(client, "live", outDir, record);
  const reading = await openNote(client, fixture.notePath(), "preview");
  record("look: note open (reading)", Boolean(reading && reading.ok), JSON.stringify(reading).slice(0, 160));
  await sleep(600);
  const rd = await surfaceCases(client, "preview", outDir, record);
  if (!lp || !rd) {
    record("look: span and button parity", false, "a surface did not render the labeled chip");
    return;
  }
  record("look: span and button compute one look at rest", rd.rest.tag === "BUTTON" && lp.rest.tag === "SPAN" && diffLooks(lp.rest, rd.rest).length === 0, diffLooks(lp.rest, rd.rest).join("; ").slice(0, 400));
  record("look: span and button compute one look under hover", diffLooks(lp.hover, rd.hover).length === 0, diffLooks(lp.hover, rd.hover).join("; ").slice(0, 400));
}

function selfTest() {
  const note = fixture.seedNote();
  if (!note.includes("`copy[" + LABEL + "]: " + PAYLOAD + "`")) throw new Error("seed note lacks the labeled look chip");
  const expression = lookExpression("live", true);
  // The page function must parse as a standalone expression.
  // eslint-disable-next-line no-new-func
  new Function("return " + expression);
  if (diffLooks({ host: { a: "1" }, well: {}, face: {} }, { host: { a: "2" }, well: {}, face: {} }).length !== 1) throw new Error("diffLooks");
  return true;
}

module.exports = { runLookCases, selfTest, LABEL, PAYLOAD, HOST_PROPS, WELL_PROPS, FACE_PROPS };
