#!/usr/bin/env node
// Capture copy chips and `bob-copy` cards in Chromium from the built
// bob-chips main.js and styles.css: production scanner, builders, and
// feedback, under Obsidian's own button rules. Only the page around the
// chips, the context washes, and the Lucide icon shim are scaffolding.
//   node scripts/preview-copy-chips.cjs [--out DIR] [--self-test]
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const repoRoot = path.resolve(__dirname, "..");
const chipsRoot = path.join(repoRoot, "plugins", "bob-chips");
const TEMPLATE = path.join(__dirname, "preview-copy-chips.template.html");

// Obsidian 2.1.2's button rules, verbatim. Every copy-chip rule must beat
// them, so a Reading button and a Live Preview span compute one look.
const OBSIDIAN_BUTTON_RULES = `button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-color);
  font-size: var(--font-ui-small);
  border-radius: var(--button-radius);
  border: 0;
  padding: var(--size-4-1) var(--size-4-3);
  height: var(--input-height);
  font-weight: var(--input-font-weight);
  cursor: var(--cursor);
  font-family: inherit;
  outline: none;
  user-select: none;
  white-space: nowrap;
  transition: var(--button-transition);
}
button:not(.clickable-icon) {
  color: var(--text-color);
  background-color: var(--interactive-normal);
  box-shadow: var(--input-shadow);
}
@media (hover: hover) {
  button:hover {
    background-color: var(--interactive-hover);
    box-shadow: var(--input-shadow-hover);
  }
}
button:focus-visible {
  box-shadow: 0 0 0 3px var(--background-modifier-border-focus);
}
button:not(.clickable-icon).mobile-tap {
  background-color: var(--interactive-hover);
  box-shadow: var(--input-shadow-hover);
}`;

const BASELINE = [
  "*, *::before, *::after { box-sizing: border-box; }",
  ":root { --radius-s: 4px; --layer-tooltip: 40; --font-ui-small: 13px; --font-ui-smaller: 12px; --input-height: 30px;",
  "  --button-radius: 5px; --size-4-1: 4px; --size-4-3: 12px; --input-font-weight: 500; --cursor: default;",
  "  --button-transition: background-color 140ms ease, box-shadow 140ms ease; --icon-size: 18px; --icon-stroke: 1.75px;",
  "  --font-interface: Inter, ui-sans-serif, sans-serif; --font-text: Inter, ui-sans-serif, sans-serif; --font-monospace: ui-monospace, 'DejaVu Sans Mono', monospace; }",
  "body { --text-color: var(--text-normal); }",
  ".svg-icon { width: var(--icon-size); height: var(--icon-size); stroke-width: var(--icon-stroke); }",
  OBSIDIAN_BUTTON_RULES,
].join("\n");

const HELP = [
  "Usage: node scripts/preview-copy-chips.cjs [--out DIRECTORY] [--self-test]",
  "",
  "Render copy chips and bob-copy cards in light, dark, narrow, reduced-motion,",
  "and print captures, and fail on any look, parity, wrap, contrast, tooltip,",
  "print, motion, or attribute check. Set CHROMIUM_PATH when no Chrome/Chromium",
  "is on PATH.",
].join("\n");

const LONG_FENCE = Array.from({ length: 10 }, (_, index) => "line " + (index + 1)).join("\n");
const STATUS_FENCE = "Hi team —\nHere is where things stand this week:\n- shipped the copy well\n- next: the Obsidian e2e";

const MATRIX = Object.freeze({
  context: {
    title: "In context: plain and Blocked / Next / WIP rows, beside inline code and links",
    rows: [
      { line: "Weekly review: paste the `copy[summary prompt]: Summarize this week's daily notes into five bullets` beside `bob plan` and [Weekly review](#)." },
      { row: "blocked", line: "Draft the period note with `copy[last-week prompt]: Update the last-week period note (bob periods show last-week prints its path)` after `bob periods show` · [Last week](#)" },
      { row: "next", line: "Log in with `copy: ssh apollo`, then run `bob task reconcile` · [Apollo](#)" },
      { row: "wip", line: "Join `copy[Zoom]: https://zoom.us/j/123456789` and note `bob gcal sync` in [Standup](#)" },
    ],
  },
  statesTitle: "States: Live Preview span vs Reading button",
  stateLines: { labeled: "`copy[summary prompt]: Summarize this week`", literal: "`copy: ssh apollo`" },
  states: [
    { name: "Rest", state: "rest" },
    { name: "Hover", state: "rest", force: "hover" },
    { name: "Pressed", state: "rest", force: "active" },
    { name: "Keyboard focus", state: "rest", force: "focus" },
    { name: "Copied", state: "copied" },
    { name: "Failed", state: "failed" },
  ],
  tips: {
    title: "Tooltip on hover and keyboard focus",
    rows: [
      { line: "Hover the Reading `copy[summary prompt]: Summarize this week's daily notes into five bullets, then list the open loops and the one thing to drop` chip.", surface: "reading", force: "hover" },
      { line: "Focus `copy: git push origin HEAD` with Tab in Live Preview.", surface: "live", force: "focus" },
      { line: "Hover a Live Preview `copy[Zoom]: https://zoom.us/j/123456789` chip.", surface: "live", force: "hover" },
    ],
  },
  wrap: {
    title: "Wrapping in a narrow column",
    rows: [
      { line: "Before review copy `copy: bob periods show last-week --format=path --include-closed` and continue." },
      { line: "Or the labeled `copy[Weekly review prompt for the planning session]: Summarize` chip." },
    ],
  },
  fences: {
    title: "bob-copy cards",
    rows: [
      { name: "Labeled", label: "Weekly status", text: STATUS_FENCE, group: "button" },
      { name: "Unlabeled", text: "ssh apollo\ncd ~/bob" },
      { name: "Hover on Copy", label: "Weekly status", text: STATUS_FENCE, force: "hover" },
      { name: "Copied", label: "Weekly status", text: STATUS_FENCE, state: "copied", group: "button" },
      { name: "Failed", label: "Weekly status", text: STATUS_FENCE, state: "failed", group: "button" },
      { name: "Long (folds after eight lines)", label: "Long", text: LONG_FENCE },
      { name: "Ends with ⏎", label: "Trailing", text: "hello\n" },
      { name: "Authoring preview (inert)", label: "Weekly status", text: STATUS_FENCE, interactive: false },
    ],
  },
  fenceFaces: { copied: "Copied ✓", failed: "Copy failed" },
  // 101 widths × 12 lead-word counts × 3 faces = 3,636 layouts per surface.
  sweep: {
    widths: { from: 120, to: 420, step: 3 },
    leads: 12,
    words: ["Paste", "the", "weekly", "summary", "into", "today's", "note", "and", "then", "copy", "this", "chip"],
    variants: [
      { name: "short label", line: "`copy[summary prompt]: Summarize this week`" },
      { name: "one-letter label", line: "`copy[Z]: zoom`" },
      { name: "long literal", line: "`copy: bob periods show last-week --format=path --include-closed --since=2026-11-01`", long: true },
    ],
  },
  contrast: { face: 4.5, glyph: 3 },
});

// Runs in the page after the template's scaffolding. Serialized with
// toString(); keep it dependency-free.
function pageChecks() {
  const H = window.BobChipsModule.helpers;
  const M = window.PREVIEW_MATRIX;
  const P = window.copyChipsPreview;
  const well = (host) => host.querySelector(":scope > .bob-copy-chip-glyph");
  const face = (host) => host.querySelector(":scope > .bob-copy-chip-face");
  const tip = (host) => host.querySelector(":scope > .bob-copy-chip-tip");
  const stateItems = () => P.mounted.filter((item) => item.group && item.group.startsWith("states|"));
  const label = (item) => item.kind + "/" + item.surface + "/" + item.state + (item.force ? "+" + item.force : "");

  function parseColor(value) {
    const text = String(value || "").trim();
    let match = text.match(/^rgba?\(([^)]+)\)$/);
    if (match) {
      const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      return { r: parts[0] / 255, g: parts[1] / 255, b: parts[2] / 255, a: parts.length > 3 ? parts[3] : 1 };
    }
    match = text.match(/^color\(srgb\s+([^)]+)\)$/);
    if (match) {
      const parts = match[1].split(/[\s/]+/).filter(Boolean).map(Number);
      return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
    }
    return null;
  }
  function luminance(c) {
    const lin = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  }
  function ratio(fg, bg) {
    const a = parseColor(fg);
    const b = parseColor(bg);
    if (!a || !b) return null;
    const la = luminance(a);
    const lb = luminance(b);
    return { ratio: (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05), opaque: b.a === 1 };
  }

  const HOST = ["backgroundColor", "backgroundImage", "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "borderTopLeftRadius", "borderBottomRightRadius", "boxShadow", "color", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "outlineStyle", "outlineWidth", "outlineColor", "outlineOffset", "cursor", "whiteSpace", "verticalAlign"];
  const WELL = ["backgroundColor", "color", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "marginLeft", "marginRight", "borderTopLeftRadius", "borderBottomLeftRadius", "display"];
  const FACE = ["fontWeight", "color", "whiteSpace", "overflowWrap"];

  // 1. Parity: each state's span and button compute the same look.
  function parity() {
    const failures = [];
    const pairs = new Map();
    let compared = 0;
    for (const item of stateItems()) {
      const key = item.kind + "|" + item.state + "|" + (item.force || "");
      if (!pairs.has(key)) pairs.set(key, {});
      pairs.get(key)[item.surface] = item.host;
    }
    for (const [key, pair] of pairs) {
      if (!pair.live || !pair.reading) {
        failures.push("parity " + key + ": missing a surface");
        continue;
      }
      for (const [part, props, pick] of [["chip", HOST, (h) => h], ["well", WELL, well], ["face", FACE, face]]) {
        const a = getComputedStyle(pick(pair.live));
        const b = getComputedStyle(pick(pair.reading));
        for (const prop of props) {
          compared += 1;
          if (a[prop] !== b[prop]) failures.push("parity " + key + " " + part + "." + prop + ": span " + a[prop] + " ≠ button " + b[prop]);
        }
      }
    }
    return { pairs: pairs.size, compared, failures };
  }

  // 2. Geometry: every state keeps the chip's and the well's size, the
  // well fills the body's start inside the border, and the glyph swaps.
  function geometry() {
    const failures = [];
    const groups = new Map();
    for (const item of stateItems()) {
      const host = item.host;
      const first = host.getClientRects()[0];
      const box = host.getBoundingClientRect();
      const w = well(host);
      const wr = w.getBoundingClientRect();
      const cs = getComputedStyle(host);
      const svg = w.querySelector("svg");
      const want = item.state === "copied" ? "check" : item.state === "failed" ? "alert-triangle" : "copy";
      if (!svg || !svg.classList.contains("lucide-" + want)) failures.push(label(item) + ": glyph is not " + want);
      const bt = parseFloat(cs.borderTopWidth);
      const bb = parseFloat(cs.borderBottomWidth);
      const bl = parseFloat(cs.borderLeftWidth);
      const off = { top: wr.top - (first.top + bt), bottom: first.bottom - bb - wr.bottom, left: wr.left - (first.left + bl) };
      if (Object.values(off).some((d) => Math.abs(d) > 0.6)) failures.push(label(item) + ": well does not fill the body's start " + JSON.stringify(off));
      const group = item.kind + "|" + item.surface;
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push({ state: label(item), chip: [box.width, box.height], well: [wr.width, wr.height] });
    }
    const report = [];
    for (const [group, list] of groups) {
      const delta = (pick) => Math.max(...list.map(pick)) - Math.min(...list.map(pick));
      const entry = { group, states: list.length, chipDw: delta((e) => e.chip[0]), chipDh: delta((e) => e.chip[1]), wellDw: delta((e) => e.well[0]), wellDh: delta((e) => e.well[1]) };
      report.push(entry);
      if (entry.chipDw > 0.5 || entry.chipDh > 0.5 || entry.wellDw > 0.5 || entry.wellDh > 0.5) failures.push("geometry " + group + " varies across states " + JSON.stringify(entry));
    }
    return { groups: report, failures };
  }

  // 3. No stranded glyph: across widths and lead-in lengths, the glyph and
  // the face's first character share a line, no fragment wraps alone
  // without face text, and long faces still wrap. Chromium does not reserve
  // a cloned end cap's padding at a wrap, so a fragment may overshoot the
  // column by at most that padding and border. The "hover" pass reruns
  // every layout with the tooltip revealed and must match "rest" exactly.
  function sweepSetup() {
    const old = document.getElementById("preview-sweep");
    if (old) old.remove();
    const root = document.createElement("div");
    root.id = "preview-sweep";
    const cases = [];
    for (const surface of ["live", "reading"]) {
      for (const variant of M.sweep.variants) {
        const chip = H.copyChipScanLine(variant.line)[0];
        const host = H.copyChipBuildInline(document, { label: chip.label, text: chip.text }, surface === "live" ? { interactive: false, editHint: true } : { interactive: true });
        const box = document.createElement("div");
        box.className = "preview-sweep-box";
        const lead = document.createTextNode("");
        box.append(lead, host, document.createTextNode(" and more after."));
        root.appendChild(box);
        cases.push({ key: surface + "/" + variant.name, long: Boolean(variant.long), box, host, lead });
      }
    }
    document.body.appendChild(root);
    window.copyChipsSweep = { cases, rest: null };
    return cases.length;
  }

  function sweep(phase) {
    const failures = [];
    const S = M.sweep;
    const state = window.copyChipsSweep;
    const signatures = [];
    let layouts = 0;
    let splits = 0;
    let empty = 0;
    let overshoot = 0;
    let maxOvershoot = 0;
    const wrapped = {};
    const note = (message) => {
      if (failures.length < 12) failures.push(message);
    };
    for (const item of state.cases) {
      const host = item.host;
      const cs = getComputedStyle(host);
      const allowance = parseFloat(cs.paddingRight) + parseFloat(cs.borderRightWidth) + 0.5;
      const svg = well(host).querySelector("svg");
      const range = document.createRange();
      range.setStart(face(host).firstChild, 0);
      range.setEnd(face(host).firstChild, 1);
      const faceRange = document.createRange();
      faceRange.selectNodeContents(face(host));
      wrapped[item.key] = 0;
      for (let n = 0; n < S.leads; n += 1) {
        item.lead.data = n ? S.words.slice(0, n).join(" ") + " " : "";
        for (let width = S.widths.from; width <= S.widths.to; width += S.widths.step) {
          item.box.style.width = width + "px";
          layouts += 1;
          const where = phase + " " + item.key + " width " + width + " lead " + n;
          const g = svg.getBoundingClientRect();
          const c = range.getBoundingClientRect();
          if (Math.min(g.bottom, c.bottom) - Math.max(g.top, c.top) <= 0) {
            splits += 1;
            note("stranded glyph: " + where);
          }
          const rects = Array.from(host.getClientRects());
          const lines = Array.from(faceRange.getClientRects());
          if (rects.some((r) => !lines.some((l) => Math.min(l.bottom, r.bottom) - Math.max(l.top, r.top) > 0))) {
            empty += 1;
            note("end cap wraps alone: " + where);
          }
          const over = Math.max(...rects.map((r) => r.right)) - item.box.getBoundingClientRect().right;
          if (over > 1) overshoot += 1;
          maxOvershoot = Math.max(maxOvershoot, over);
          if (over > allowance) note("overflow by " + over.toFixed(2) + " px: " + where);
          if (new Set(lines.map((l) => Math.round(l.top))).size > 1) wrapped[item.key] += 1;
          signatures.push(rects.map((r) => [r.left, r.right, r.top, r.bottom].map((v) => v.toFixed(1)).join(",")).join("|"));
        }
      }
      if (item.long && !wrapped[item.key]) note("long face never wraps: " + item.key);
    }
    let shifts = 0;
    if (phase === "rest") state.rest = signatures;
    else if (state.rest) {
      signatures.forEach((sig, index) => {
        if (sig !== state.rest[index]) {
          shifts += 1;
          note("layout shifts with the tooltip shown at layout " + index + ": " + state.rest[index] + " -> " + sig);
        }
      });
    } else note("no rest pass to compare");
    return { phase, layouts, splits, empty, overshoot, maxOvershoot: Number(maxOvershoot.toFixed(2)), shifts, wrapped, failures };
  }

  // 4. Contrast at rest: face ink on the body and the glyph on the well;
  // also the card title on its header and the card's Copy button.
  function contrast() {
    const failures = [];
    const rows = [];
    const check = (name, fg, bg, min) => {
      const r = ratio(fg, bg);
      rows.push({ name, ratio: r ? Number(r.ratio.toFixed(2)) : null, min });
      if (!r) failures.push(name + ": unparsed colors " + fg + " on " + bg);
      else if (!r.opaque) failures.push(name + ": fill is not opaque (" + bg + ")");
      else if (r.ratio < min) failures.push(name + ": contrast " + r.ratio.toFixed(2) + " < " + min);
    };
    for (const item of stateItems()) {
      if (item.state !== "rest" || item.force) continue;
      const hs = getComputedStyle(item.host);
      const ws = getComputedStyle(well(item.host));
      check(item.kind + "/" + item.surface + " face", getComputedStyle(face(item.host)).color, hs.backgroundColor, M.contrast.face);
      check(item.kind + "/" + item.surface + " glyph", ws.color, ws.backgroundColor, M.contrast.glyph);
    }
    const card = P.fences.find((f) => !f.row.state && !f.row.force && f.row.interactive !== false).card;
    const header = getComputedStyle(card.querySelector(".bob-copy-fence-header"));
    const glyph = getComputedStyle(card.querySelector(".bob-copy-fence-header .bob-copy-chip-glyph"));
    const button = getComputedStyle(card.querySelector(".bob-copy-fence-copy"));
    check("card title", getComputedStyle(card.querySelector(".bob-copy-fence-title")).color, header.backgroundColor, M.contrast.face);
    check("card glyph", glyph.color, glyph.backgroundColor, M.contrast.glyph);
    check("card Copy button", button.color, button.backgroundColor, M.contrast.face);
    return { rows, failures };
  }

  // 5. Tooltip: hidden at rest; under forced hover/focus it waits 0.4 s,
  // then shows above the chip with the builder's text.
  function expectedTip(item) {
    let text = item.chip.label != null ? "Copy: " + item.chip.text.slice(0, 120) : "Click to copy";
    if (item.surface === "live") text += " · Alt+Click to edit";
    return text;
  }
  function tips(phase) {
    const failures = [];
    const shown = [];
    for (const item of P.mounted) {
      const t = tip(item.host);
      const cs = getComputedStyle(t);
      const forced = Boolean(item.force && item.force !== "active" && !(item.group || "").startsWith("states|"));
      if (t.textContent !== expectedTip(item)) failures.push(label(item) + ": tooltip text " + JSON.stringify(t.textContent));
      if (!forced) {
        if (cs.display !== "none" && !(item.group || "").startsWith("states|")) failures.push(label(item) + ": tooltip shows at rest");
        continue;
      }
      const animation = t.getAnimations().find((a) => a.animationName === "bob-copy-chip-tip-in");
      const timing = animation ? animation.effect.getTiming() : null;
      const r = t.getBoundingClientRect();
      const host = item.host.getClientRects()[0];
      shown.push({ chip: label(item), visibility: cs.visibility, delay: timing ? timing.delay : null, width: r.width, height: r.height, above: r.bottom <= host.top + 0.5 });
      if (phase === "delay") {
        if (!timing || timing.delay !== 400 || timing.fill !== "both") failures.push(label(item) + ": tooltip has no 0.4 s reveal delay " + JSON.stringify(timing));
      } else if (phase === "now") {
        if (cs.display === "none" || cs.visibility !== "visible" || animation) failures.push(label(item) + ": reduced-motion tooltip is not shown at once");
      } else if (cs.display === "none" || cs.visibility !== "visible" || !(r.width > 0 && r.height > 0) || r.bottom > host.top + 0.5) {
        failures.push(label(item) + ": tooltip not visible above the chip " + JSON.stringify(shown[shown.length - 1]));
      }
    }
    if (!shown.length) failures.push("no forced tooltip");
    return { shown, failures };
  }

  // 8. Attributes: payloads stay out of attributes; names and descriptions
  // point at the right nodes.
  function attributes() {
    const failures = [];
    let checked = 0;
    for (const item of P.mounted) {
      const payload = H.copyChipPayloadOf(item.host);
      if (payload !== item.chip.text) failures.push(label(item) + ": payload record mismatch");
      for (const el of [item.host, ...item.host.querySelectorAll("*")]) {
        for (const name of el.getAttributeNames()) {
          checked += 1;
          if ((el.getAttribute(name) || "").includes(item.chip.text)) failures.push(label(item) + ": payload in attribute " + name);
        }
      }
      const t = tip(item.host);
      const described = item.host.getAttribute("aria-describedby");
      if (!described || document.getElementById(described) !== t || t.getAttribute("role") !== "tooltip") failures.push(label(item) + ": aria-describedby does not name the tooltip");
      if (item.surface === "reading") {
        const ids = (item.host.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
        const named = ids.map((id) => document.getElementById(id));
        if (item.host.tagName !== "BUTTON" || item.host.getAttribute("type") !== "button") failures.push(label(item) + ": Reading chip is not a button");
        if (ids.length !== 2 || named[0] === null || named[0].textContent !== "Copy" || named[1] !== face(item.host)) failures.push(label(item) + ": aria-labelledby is not Copy + face");
        if (item.host.getAttribute("aria-label") !== null) failures.push(label(item) + ": aria-label set");
      }
    }
    for (const f of P.fences) {
      const lines = f.row.text.split("\n").filter((line) => line.length > 3);
      for (const el of [f.card, ...f.card.querySelectorAll("*")]) {
        for (const name of el.getAttributeNames()) {
          checked += 1;
          const value = el.getAttribute(name) || "";
          if (lines.some((line) => value.includes(line))) failures.push("card " + f.row.name + ": payload in attribute " + name);
        }
      }
    }
    return { checked, failures };
  }

  // 9. The card's Copy button computes the chip body recipe, never
  // Obsidian's button fill or shadow, and keeps one width.
  function cardButton() {
    const failures = [];
    const probe = (decl) => {
      const el = document.createElement("span");
      el.className = "bob-copy-fence";
      el.style.cssText = decl;
      document.body.appendChild(el);
      const cs = getComputedStyle(el);
      const out = { bg: cs.backgroundColor, border: cs.borderTopColor, color: cs.color };
      el.remove();
      return out;
    };
    const ink = "var(--bob-copy-chip-ink)";
    const rest = probe("background-color: color-mix(in srgb, " + ink + " 12%, var(--background-primary)); border: 1px solid color-mix(in srgb, " + ink + " 50%, var(--background-primary)); color: color-mix(in srgb, " + ink + " 30%, var(--text-normal))");
    const hover = probe("background-color: color-mix(in srgb, " + ink + " 17%, var(--background-primary)); border: 1px solid " + ink);
    const widths = [];
    const restButtons = [];
    for (const f of P.fences) {
      const button = f.card.querySelector(".bob-copy-fence-copy");
      const cs = getComputedStyle(button);
      if (f.row.group === "button") widths.push({ card: f.row.name, face: button.textContent, width: button.getBoundingClientRect().width });
      if (f.row.state) continue;
      if (cs.boxShadow !== "none") failures.push("card " + f.row.name + ": button shadow " + cs.boxShadow);
      if (cs.fontWeight !== "500" || cs.cursor !== "copy") failures.push("card " + f.row.name + ": button weight/cursor " + cs.fontWeight + "/" + cs.cursor);
      const want = f.row.force === "hover" ? hover : rest;
      if (cs.backgroundColor !== want.bg) failures.push("card " + f.row.name + ": button fill " + cs.backgroundColor + " ≠ " + want.bg);
      if (cs.borderTopColor !== want.border) failures.push("card " + f.row.name + ": button border " + cs.borderTopColor + " ≠ " + want.border);
      if (!f.row.force && cs.color !== rest.color) failures.push("card " + f.row.name + ": button ink " + cs.color + " ≠ " + rest.color);
      if (!f.row.force) restButtons.push({ name: f.row.name, tag: button.tagName, cs });
    }
    const span = restButtons.find((b) => b.tag === "SPAN");
    const real = restButtons.find((b) => b.tag === "BUTTON");
    if (!span || !real) failures.push("card buttons: need an inert span and a real button");
    else {
      for (const prop of ["backgroundColor", "borderTopColor", "color", "paddingTop", "paddingLeft", "fontSize", "fontWeight", "boxShadow", "minWidth", "display", "height"]) {
        if (span.cs[prop] !== real.cs[prop]) failures.push("card button parity " + prop + ": span " + span.cs[prop] + " ≠ button " + real.cs[prop]);
      }
    }
    const dw = widths.length ? Math.max(...widths.map((w) => w.width)) - Math.min(...widths.map((w) => w.width)) : NaN;
    if (!(widths.length === 3 && dw <= 0.5)) failures.push("card Copy button width varies: " + JSON.stringify(widths));
    return { widths, failures };
  }

  // 6. Print: every state is plain inline code; cards print the body.
  function print() {
    const failures = [];
    for (const item of P.mounted) {
      const cs = getComputedStyle(item.host);
      const name = label(item);
      if (cs.borderTopStyle !== "none" || cs.borderLeftStyle !== "none") failures.push(name + ": border prints");
      if (cs.backgroundColor !== "rgba(0, 0, 0, 0)" || cs.backgroundImage !== "none") failures.push(name + ": fill prints");
      if (["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"].some((p) => cs[p] !== "0px")) failures.push(name + ": padding prints");
      if (cs.boxShadow !== "none" || cs.outlineStyle !== "none") failures.push(name + ": shadow or outline prints");
      if (cs.animationName !== "none") failures.push(name + ": animates in print");
      if (getComputedStyle(well(item.host)).display !== "none") failures.push(name + ": well prints");
      if (getComputedStyle(tip(item.host)).display !== "none") failures.push(name + ": tooltip prints");
      if (getComputedStyle(face(item.host)).fontWeight !== cs.fontWeight) failures.push(name + ": face weight prints");
      if (item.kind === "literal" && !/mono/i.test(cs.fontFamily)) failures.push(name + ": literal is not monospace");
    }
    for (const f of P.fences) {
      const card = f.card;
      const cs = getComputedStyle(card);
      const header = getComputedStyle(card.querySelector(".bob-copy-fence-header"));
      if (cs.borderTopStyle !== "none" || cs.backgroundColor !== "rgba(0, 0, 0, 0)") failures.push("card " + f.row.name + ": frame prints");
      if (header.backgroundColor !== "rgba(0, 0, 0, 0)" || header.animationName !== "none") failures.push("card " + f.row.name + ": header fill prints");
      for (const selector of [".bob-copy-fence-copy", ".bob-copy-fence-toggle", ".bob-copy-fence-header .bob-copy-chip-glyph"]) {
        for (const el of card.querySelectorAll(selector)) if (getComputedStyle(el).display !== "none") failures.push("card " + f.row.name + ": " + selector + " prints");
      }
      const body = getComputedStyle(card.querySelector(".bob-copy-fence-body"));
      if (body.maxHeight !== "none" || body.overflow !== "visible") failures.push("card " + f.row.name + ": body stays folded in print");
    }
    return { chips: P.mounted.length, cards: P.fences.length, failures };
  }

  // 7. Motion: pulses, transitions, and timed tooltip reveals.
  function motion() {
    const animations = document.getAnimations();
    const names = animations.map((a) => a.animationName || "");
    const durations = [];
    for (const item of P.mounted) durations.push(getComputedStyle(item.host).transitionDuration, getComputedStyle(well(item.host)).transitionDuration);
    for (const f of P.fences) durations.push(getComputedStyle(f.card.querySelector(".bob-copy-fence-copy")).transitionDuration);
    return {
      pulse: names.filter((n) => n === "bob-copy-chip-pulse").length,
      tipReveal: names.filter((n) => n === "bob-copy-chip-tip-in").length,
      transitions: animations.filter((a) => typeof CSSTransition !== "undefined" && a instanceof CSSTransition).length,
      timedElements: durations.filter((d) => d.split(",").some((part) => parseFloat(part) > 0)).length,
    };
  }

  window.copyChipsChecks = { parity, geometry, sweepSetup, sweep, contrast, tips, attributes, cardButton, print, motion };
}

function parseArgs(argv) {
  const args = { out: path.join(os.tmpdir(), "bob-copy-chips-preview"), selfTest: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--out" || token === "-o") {
      const value = argv[++index];
      if (!value || value.startsWith("-")) throw new Error("--out requires a DIRECTORY");
      args.out = path.resolve(value);
    } else if (token === "--self-test" || token === "-s") args.selfTest = true;
    else if (token === "--help" || token === "-h") args.help = true;
    else throw new Error("Unknown argument: " + token);
  }
  return args;
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function makeHtml() {
  const main = fs.readFileSync(path.join(chipsRoot, "main.js"), "utf8");
  if (/<\/script/i.test(main)) throw new Error("main.js contains a closing script tag; cannot inline it");
  const template = fs.readFileSync(TEMPLATE, "utf8");
  return template
    .replace("__OBSIDIAN_BASELINE_CSS__", () => BASELINE)
    .replace("__PRODUCTION_CSS__", () => fs.readFileSync(path.join(chipsRoot, "styles.css"), "utf8"))
    .replace("__BOB_CHIPS_MAIN__", () => main)
    .replace("__MATRIX__", () => safeJson(MATRIX))
    .replace("__CHECKS__", () => "(" + pageChecks.toString() + ")();");
}

function sweepLayouts() {
  const w = MATRIX.sweep.widths;
  return (Math.floor((w.to - w.from) / w.step) + 1) * MATRIX.sweep.leads * MATRIX.sweep.variants.length;
}

function findChromium() {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH;
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    const found = spawnSync("which", [name], { encoding: "utf8" });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  const cache = path.join(os.homedir(), ".cache", "ms-playwright");
  if (fs.existsSync(cache)) {
    const builds = fs.readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name)).sort().reverse();
    for (const build of builds) {
      for (const sub of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
        const candidate = path.join(cache, build, sub);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  throw new Error("Could not find Chromium. Set CHROMIUM_PATH to a browser executable.");
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const wait = this.pending.get(message.id);
      if (!wait) return;
      this.pending.delete(message.id);
      if (message.error) wait.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else wait.resolve(message.result || {});
    });
  }

  static async connect(endpoint) {
    let Socket = typeof globalThis.WebSocket === "function" ? globalThis.WebSocket : null;
    if (!Socket) Socket = require("undici").WebSocket;
    const socket = new Socket(endpoint);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    return new CdpClient(socket);
  }

  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result && response.result.value;
  }
}

async function waitForFile(file, child, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(file)) return;
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("Chromium exited before publishing its DevTools port (exit " + child.exitCode + ").");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for Chromium's DevTools port file.");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const frames = "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))";

// Hover, press, and keyboard-focus the forced cases through DevTools'
// forced pseudo-classes.
async function forceSelectors(client, pairs) {
  const { root } = await client.call("DOM.getDocument", { depth: -1 });
  let forced = 0;
  for (const [selector, classes] of pairs) {
    const { nodeIds } = await client.call("DOM.querySelectorAll", { nodeId: root.nodeId, selector });
    for (const nodeId of nodeIds) {
      await client.call("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: classes });
      forced += 1;
    }
  }
  return forced;
}

function forceStates(client) {
  return forceSelectors(client, [
    [".preview-force-hover > .bob-copy-chip", ["hover"]],
    [".preview-force-active > .bob-copy-chip", ["hover", "active"]],
    [".preview-force-focus > .bob-copy-chip", ["focus", "focus-visible"]],
    [".preview-force-card-hover", ["hover"]],
  ]);
}

// Render a theme, force the states, and (unless told otherwise) wait out
// the tooltip delay and finish every animation and transition.
async function render(client, theme, options = {}) {
  const counts = await client.evaluate("window.copyChipsPreview.render(" + safeJson(theme) + ")");
  await client.evaluate("document.fonts && document.fonts.ready");
  await client.evaluate(frames);
  counts.forced = await forceStates(client);
  await client.evaluate(frames);
  if (options.before) await options.before();
  if (options.settle !== false) {
    await sleep(600);
    await client.evaluate("window.copyChipsPreview.settleAnimations()");
    await client.evaluate(frames);
  }
  return counts;
}

async function capture(client, output, selector) {
  await client.evaluate(frames);
  let clip;
  if (selector) {
    const box = await client.evaluate("(() => { const r = document.querySelector(" + JSON.stringify(selector) + ").getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }; })()");
    clip = { x: Math.max(0, Math.floor(box.x) - 12), y: Math.max(0, Math.floor(box.y) - 12), width: Math.ceil(box.width) + 24, height: Math.ceil(box.height) + 24, scale: 1 };
  } else {
    const metrics = await client.call("Page.getLayoutMetrics");
    clip = { x: 0, y: 0, width: Math.ceil(metrics.cssContentSize.width), height: Math.ceil(metrics.cssContentSize.height), scale: 1 };
  }
  const screenshot = await client.call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: true, clip });
  fs.writeFileSync(output, Buffer.from(screenshot.data, "base64"));
  return output;
}

const check = (client, name, arg) => client.evaluate("window.copyChipsChecks." + name + "(" + (arg === undefined ? "" : safeJson(arg)) + ")");

let cachedHtml = null;
function html0() {
  if (cachedHtml === null) cachedHtml = makeHtml();
  return cachedHtml;
}

function selfTest() {
  const { helpers } = require("./copy-chips-test-helpers.cjs");
  const html = html0();
  assert.doesNotMatch(html, /__[A-Z_]+__/, "every template placeholder is filled");
  assert.match(html, /copyChipBuildInline/);
  assert.match(html, /copyChipBuildFence/);
  assert.match(html, /:is\(span, button\)\.bob-copy-chip \{/, "the production chip rules ship in the page");
  assert.ok(html.indexOf("button:not(.clickable-icon) {") < html.indexOf(":is(span, button).bob-copy-chip {"), "Obsidian's button rules load before the plugin's");
  for (const rule of ["button {", "button:not(.clickable-icon) {", "button:hover {", "button:focus-visible {", "button:not(.clickable-icon).mobile-tap {"]) assert.ok(BASELINE.includes(rule), "baseline has " + rule);
  assert.match(html, /window\.copyChipsChecks = /);
  // Every context, state, tip, and wrap line holds exactly the chips it means to.
  const scan = helpers.copyChipScanLine;
  for (const row of MATRIX.context.rows) assert.equal(scan(row.line).length, 1, row.line);
  for (const line of Object.values(MATRIX.stateLines)) assert.equal(scan(line).length, 1, line);
  for (const row of [...MATRIX.tips.rows, ...MATRIX.wrap.rows]) assert.equal(scan(row.line).length, 1, row.line);
  for (const variant of MATRIX.sweep.variants) assert.equal(scan(variant.line).length, 1, variant.line);
  assert.deepEqual(scan(MATRIX.stateLines.labeled).map((c) => c.label), ["summary prompt"]);
  assert.deepEqual(scan(MATRIX.stateLines.literal).map((c) => c.label), [null]);
  // The state matrix covers rest, hover, press, focus, copied, and failed.
  assert.deepEqual(MATRIX.states.map((s) => s.force || s.state), ["rest", "hover", "active", "focus", "copied", "failed"]);
  assert.ok(MATRIX.context.rows.some((r) => r.row === "blocked") && MATRIX.context.rows.some((r) => r.row === "next") && MATRIX.context.rows.some((r) => r.row === "wip"));
  assert.ok(MATRIX.tips.rows.some((r) => r.surface === "reading" && r.force === "hover") && MATRIX.tips.rows.some((r) => r.surface === "live" && r.force === "focus"));
  assert.equal(sweepLayouts(), 3636, "3,636 sweep layouts per surface");
  // The card matrix covers the Copy button's three faces with the builder's strings.
  const main = fs.readFileSync(path.join(chipsRoot, "main.js"), "utf8");
  for (const faceText of Object.values(MATRIX.fenceFaces)) assert.ok(main.includes(JSON.stringify(faceText)), "main.js flashes " + faceText);
  assert.equal(MATRIX.fences.rows.filter((r) => r.group === "button").length, 3);
  assert.ok(MATRIX.fences.rows.some((r) => r.interactive === false) && MATRIX.fences.rows.some((r) => r.text.split("\n").length > 8));
  assert.deepEqual(parseArgs(["--out", "/tmp/x", "--self-test"]), { out: "/tmp/x", selfTest: true, help: false });
  assert.throws(() => parseArgs(["--out"]));
  assert.throws(() => parseArgs(["--wat"]));
  console.log("offline self-test complete (no browser; not a visual pass)");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }
  if (args.selfTest) {
    selfTest();
    return;
  }
  fs.mkdirSync(args.out, { recursive: true });
  const htmlFile = path.join(args.out, "index.html");
  fs.writeFileSync(htmlFile, makeHtml());
  const chromium = findChromium();
  const profile = fs.mkdtempSync(path.join("/tmp", "bob-copy-chip-preview-"));
  const child = spawn(chromium, [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--force-color-profile=srgb",
    "--remote-debugging-port=0", "--user-data-dir=" + profile, "about:blank",
  ], { stdio: "ignore", env: { ...process.env, TMPDIR: "/tmp" } });
  let client = null;
  try {
    const portFile = path.join(profile, "DevToolsActivePort");
    await waitForFile(portFile, child);
    const port = fs.readFileSync(portFile, "utf8").split(/\s+/)[0];
    const pages = await fetch("http://127.0.0.1:" + port + "/json/list").then((response) => response.json());
    const page = pages.find((item) => item.type === "page");
    if (!page) throw new Error("Chromium did not publish a DevTools page.");
    client = await CdpClient.connect(page.webSocketDebuggerUrl);
    for (const domain of ["Page", "Runtime", "DOM", "CSS"]) await client.call(domain + ".enable");
    const wide = { width: 1040, height: 1400, deviceScaleFactor: 1, mobile: false };
    await client.call("Emulation.setDeviceMetricsOverride", wide);
    await client.call("Page.navigate", { url: pathToFileURL(htmlFile).href });
    const start = Date.now();
    while (Date.now() - start < 15000) {
      if (await client.evaluate("Boolean(window.copyChipsPreviewReady && window.copyChipsChecks)")) break;
      await sleep(50);
    }
    const screenshots = [];
    const report = {};
    const failures = [];
    const take = (name, result) => {
      report[name] = result;
      for (const failure of (result && result.failures) || []) failures.push(name + ": " + failure);
    };

    // Light: motion and the tooltip delay before settling, then the rest.
    report.counts = await render(client, "light", {
      before: async () => {
        report.motion = await check(client, "motion");
        take("tipsDelay", await check(client, "tips", "delay"));
      },
    });
    take("tips", await check(client, "tips", "shown"));
    take("parity", await check(client, "parity"));
    take("geometry", await check(client, "geometry"));
    take("attributes", await check(client, "attributes"));
    take("cardButton", await check(client, "cardButton"));
    take("contrastLight", await check(client, "contrast"));
    screenshots.push(await capture(client, path.join(args.out, "copy-chips-light.png")));
    screenshots.push(await capture(client, path.join(args.out, "copy-fences-light.png"), "#preview-fences"));
    await check(client, "sweepSetup");
    take("sweep", await check(client, "sweep", "rest"));
    await forceSelectors(client, [[".preview-sweep-box > .bob-copy-chip", ["hover", "focus", "focus-visible"]]]);
    take("sweepHover", await check(client, "sweep", "hover"));
    if (!(report.motion.pulse > 0 && report.motion.transitions > 0 && report.motion.timedElements > 0)) failures.push("motion: normal motion shows no pulse or transition " + JSON.stringify(report.motion));

    await render(client, "dark");
    take("contrastDark", await check(client, "contrast"));
    take("parityDark", await check(client, "parity"));
    screenshots.push(await capture(client, path.join(args.out, "copy-chips-dark.png")));
    screenshots.push(await capture(client, path.join(args.out, "copy-fences-dark.png"), "#preview-fences"));

    await client.call("Emulation.setDeviceMetricsOverride", { ...wide, width: 390 });
    await render(client, "light");
    screenshots.push(await capture(client, path.join(args.out, "copy-chips-narrow-light.png")));
    await client.call("Emulation.setDeviceMetricsOverride", wide);

    await client.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await render(client, "dark", {
      before: async () => {
        report.reducedMotion = await check(client, "motion");
        take("tipsReducedMotion", await check(client, "tips", "now"));
      },
    });
    const rm = report.reducedMotion;
    if (!(rm.pulse === 0 && rm.transitions === 0 && rm.tipReveal === 0 && rm.timedElements === 0)) failures.push("reducedMotion: still animates " + JSON.stringify(rm));
    screenshots.push(await capture(client, path.join(args.out, "copy-chips-reduced-motion-dark.png")));

    await client.call("Emulation.setEmulatedMedia", { media: "print", features: [] });
    await render(client, "light");
    take("print", await check(client, "print"));
    screenshots.push(await capture(client, path.join(args.out, "copy-chips-print.png")));
    await client.call("Emulation.setEmulatedMedia", { media: "", features: [] });

    for (const pass of [report.sweep, report.sweepHover]) {
      if (pass && pass.layouts !== 2 * sweepLayouts()) failures.push("sweep: " + pass.phase + " ran " + pass.layouts + " layouts, expected " + 2 * sweepLayouts());
    }
    if (!report.sweepHover || report.sweepHover.phase !== "hover") failures.push("sweep: the hover pass did not run");
    fs.writeFileSync(path.join(args.out, "checks.json"), JSON.stringify({ ...report, failures }, null, 2));
    const geometry = report.geometry ? report.geometry.groups : [];
    fs.writeFileSync(path.join(args.out, "matrix-report.md"), [
      "# Bob copy chips preview",
      "",
      "Rendered from the built `plugins/bob-chips/main.js` (copyChipScanLine, copyChipBuildInline, copyChipBuildFence, copyChipShowFeedback) and `styles.css` under Obsidian 2.1.2's button rules and default light/dark palette.",
      "",
      "Cases: labeled and literal chips as Live Preview spans and Reading buttons at rest, hover, pressed, keyboard focus, copied, and failed; in context on plain, Blocked, Next, and WIP rows beside cyan inline code and accent links; tooltips under hover and focus; wrapping in a 240 px column and a 390 px viewport; bob-copy cards (labeled, unlabeled, hovered Copy, copied, failed, folded, trailing newline, inert authoring preview) and the authoring icon; reduced motion; print.",
      "",
      "Checks: " + (failures.length ? "FAILED" : "passed") + " — parity " + (report.parity ? report.parity.compared : 0) + " properties over " + (report.parity ? report.parity.pairs : 0) + " span/button pairs; geometry " + geometry.map((g) => g.group + " Δ " + [g.chipDw, g.chipDh, g.wellDw, g.wellDh].map((d) => d.toFixed(2)).join("/")).join("; ") + "; sweep " + [report.sweep, report.sweepHover].filter(Boolean).map((p) => p.phase + " " + p.layouts + " layouts, " + p.splits + " glyph splits, " + p.empty + " lone end caps, " + p.shifts + " shifts, max end-cap overshoot " + p.maxOvershoot + " px").join("; ") + "; contrast light " + (report.contrastLight ? report.contrastLight.rows.map((r) => r.name + " " + r.ratio).join(", ") : "") + "; contrast dark " + (report.contrastDark ? report.contrastDark.rows.map((r) => r.name + " " + r.ratio).join(", ") : "") + "; " + (report.attributes ? report.attributes.checked : 0) + " attributes; card button widths " + (report.cardButton ? report.cardButton.widths.map((w) => w.face + " " + w.width.toFixed(2)).join(", ") : "") + "; reduced motion " + JSON.stringify(report.reducedMotion) + ".",
      ...failures.map((failure) => "- FAIL " + failure),
      "",
      ...screenshots.map((file) => "- " + path.basename(file)),
      "",
    ].join("\n"));
    console.log(JSON.stringify({ output: args.out, html: htmlFile, chromium, screenshots, failures }, null, 2));
    if (failures.length) process.exitCode = 1;
  } finally {
    if (client) client.socket.close();
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) resolve();
      else child.once("exit", resolve);
    });
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((error) => { console.error(error && error.stack || error); process.exitCode = 1; });
}

module.exports = { MATRIX, BASELINE, parseArgs, makeHtml, sweepLayouts };
