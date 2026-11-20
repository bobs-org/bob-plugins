"use strict";
// Look checks injected into the command-chip preview page. Serialized with
// toString(); keep it dependency-free.

function pageChecks() {
  const H = window.BobChipsModule.helpers;
  const M = window.PREVIEW_MATRIX;
  const P = window.commandChipsPreview;
  const well = (host) => host.querySelector(":scope > .bob-run-chip-glyph");
  const face = (host) => host.querySelector(":scope > .bob-run-chip-face");
  const tip = (host) => host.querySelector(":scope > .bob-run-chip-tip");
  const lookItems = () => P.mounted.filter((item) => item.group && item.group.startsWith("look|"));
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

  function wantedGlyph(item) {
    if (item.kind === "copy" || (item.group || "").includes("|copy|")) return "copy";
    if (item.state === "completed") return "check";
    if (item.state === "failed" && item.kind !== "copy") return "play";
    return "play";
  }

  function parity() {
    const failures = [];
    const pairs = new Map();
    let compared = 0;
    for (const item of lookItems()) {
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

  function geometry() {
    const failures = [];
    const groups = new Map();
    for (const item of lookItems()) {
      const host = item.host;
      const first = host.getClientRects()[0];
      const box = host.getBoundingClientRect();
      const w = well(host);
      const wr = w.getBoundingClientRect();
      const cs = getComputedStyle(host);
      const svg = w.querySelector("svg");
      const want = wantedGlyph(item);
      if (!svg || !svg.classList.contains("lucide-" + want)) failures.push(label(item) + ": glyph is not " + want);
      const bt = parseFloat(cs.borderTopWidth);
      const bb = parseFloat(cs.borderBottomWidth);
      const bl = parseFloat(cs.borderLeftWidth);
      const off = { top: wr.top - (first.top + bt), bottom: first.bottom - bb - wr.bottom, left: wr.left - (first.left + bl) };
      const hostH = first.bottom - first.top;
      const wellH = wr.bottom - wr.top;
      const startOff = [off.top, off.left];
      // A wrapping button is one atomic box taller than the first line;
      // the well still has to fill that line's start.
      if (startOff.some((d) => Math.abs(d) > 0.6) || (hostH <= wellH + 1.5 && Math.abs(off.bottom) > 0.6)) {
        failures.push(label(item) + ": well does not fill the body's start " + JSON.stringify(off));
      }
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

  function sweepSetup() {
    const old = document.getElementById("preview-sweep");
    if (old) old.remove();
    const root = document.createElement("div");
    root.id = "preview-sweep";
    const cases = [];
    for (const surface of ["live", "reading"]) {
      for (const variant of M.sweep.variants) {
        const chip = H.chipScanLine(variant.line).find((found) => found.kind === "run");
        const host = H.commandChipBuildInline(document, { label: chip.label, text: chip.text }, surface === "live" ? { interactive: false } : { interactive: true });
        P.paintSweepChip(host, chip, variant);
        const box = document.createElement("div");
        box.className = "preview-sweep-box";
        const lead = document.createTextNode("");
        box.append(lead, host, document.createTextNode(" and more after."));
        root.appendChild(box);
        cases.push({ key: surface + "/" + variant.name, long: Boolean(variant.long), box, host, lead });
      }
    }
    document.body.appendChild(root);
    window.commandChipsSweep = { cases, rest: null };
    return cases.length;
  }

  function sweep(phase) {
    const failures = [];
    const S = M.sweep;
    const state = window.commandChipsSweep;
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
      const faceEl = face(host);
      const first = faceEl.firstChild && faceEl.firstChild.nodeType === Node.TEXT_NODE ? faceEl.firstChild : faceEl.querySelector(".bob-run-chip-label, .bob-run-chip-step");
      const textNode = first && first.nodeType === Node.TEXT_NODE ? first : first && first.firstChild;
      if (!textNode) {
        note("no face text: " + item.key);
        continue;
      }
      range.setStart(textNode, 0);
      range.setEnd(textNode, 1);
      const faceRange = document.createRange();
      faceRange.selectNodeContents(faceEl);
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
    const page = getComputedStyle(document.querySelector(".preview-shell") || document.body).backgroundColor;
    const seen = new Set();
    for (const item of P.mounted) {
      if (item.force) continue;
      const faceName = item.model && item.model.face;
      const rest = item.state === "rest" && !item.force;
      if (!(rest || ["attention", "failed", "unavailable", "copy"].includes(faceName))) continue;
      const key = (item.kind || faceName) + "/" + item.surface + "/" + faceName;
      if (seen.has(key)) continue;
      seen.add(key);
      const hs = getComputedStyle(item.host);
      const ws = getComputedStyle(well(item.host));
      if (rest && faceName === "ready") {
        check(key + " face", getComputedStyle(face(item.host)).color, hs.backgroundColor, M.contrast.face);
        check(key + " well/page", ws.backgroundColor, page, M.contrast.glyph);
      }
      if (rest || ["attention", "failed", "unavailable", "copy"].includes(faceName)) {
        check(key + " glyph", ws.color, ws.backgroundColor, M.contrast.glyph);
      }
    }
    const card = P.fences.find((f) => f.row.group === "run-button" && !f.row.state && !f.row.force && !f.row.drive).card;
    const header = getComputedStyle(card.querySelector(".bob-run-fence-header"));
    const glyph = getComputedStyle(card.querySelector(".bob-run-fence-header .bob-run-fence-glyph"));
    const button = getComputedStyle(card.querySelector(".bob-run-fence-run"));
    check("card title", getComputedStyle(card.querySelector(".bob-run-fence-title")).color, header.backgroundColor, M.contrast.face);
    check("card glyph", glyph.color, glyph.backgroundColor, M.contrast.glyph);
    check("card Run button", button.color, button.backgroundColor, M.contrast.face);
    return { rows, failures };
  }

  function expectedTip(item) {
    const rows = Array.from(tip(item.host).querySelectorAll(".bob-run-chip-tip-row")).map((row) => row.textContent);
    return rows;
  }
  function tips(phase) {
    const failures = [];
    const shown = [];
    for (const item of P.mounted) {
      const t = tip(item.host);
      if (!t) continue;
      const cs = getComputedStyle(t);
      const forced = Boolean(item.force && item.force !== "active" && (item.group || "").startsWith("look|") === false);
      if (!item.force || (item.group || "").startsWith("look|")) {
        if (!(item.group || "").startsWith("look|") && !item.force && cs.display !== "none" && !(item.group || "").startsWith("look|")) {
          // States grid hides tips; the dedicated force section is the tooltip check.
        }
        if (!forced) continue;
      }
      if (!forced) continue;
      const animation = t.getAnimations().find((a) => a.animationName === "bob-run-chip-tip-in");
      const timing = animation ? animation.effect.getTiming() : null;
      const r = t.getBoundingClientRect();
      const host = item.host.getClientRects()[0];
      shown.push({ chip: label(item), visibility: cs.visibility, delay: timing ? timing.delay : null, width: r.width, height: r.height, above: r.bottom <= host.top + 0.5, rows: expectedTip(item) });
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

  function attributes() {
    const failures = [];
    let checked = 0;
    for (const item of P.mounted) {
      const payload = H.commandChipPayloadOf(item.host);
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
      const ids = (item.host.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
      const named = ids.map((id) => document.getElementById(id));
      const want = item.model.face === "copy" ? "Copy" : "Run";
      if (ids.length !== 2 || named[0] === null || named[0].textContent !== want || named[1] !== face(item.host)) failures.push(label(item) + ": aria-labelledby is not " + want + " + face");
      if (item.surface === "reading" && (item.host.tagName !== "BUTTON" || item.host.getAttribute("type") !== "button")) failures.push(label(item) + ": Reading chip is not a button");
      if (item.surface === "live" && (item.host.getAttribute("role") !== "button" || item.host.getAttribute("tabindex") !== "0")) failures.push(label(item) + ": Live Preview chip is not a focusable role=button");
    }
    return { checked, failures };
  }

  function cardButton() {
    const failures = [];
    const widths = { "run-button": [], "copy-button": [] };
    for (const f of P.fences) {
      const button = f.card.querySelector(".bob-run-fence-run");
      const cs = getComputedStyle(button);
      const group = f.row.group || "run-button";
      if (widths[group]) widths[group].push({ card: f.row.name, face: button.textContent, width: button.getBoundingClientRect().width });
      if (cs.boxShadow !== "none") failures.push("card " + f.row.name + ": button shadow " + cs.boxShadow);
      if (group === "copy-button" && !f.row.force && cs.cursor !== "copy") failures.push("card " + f.row.name + ": copy cursor " + cs.cursor);
      if (group === "run-button" && !f.row.force && cs.cursor !== "pointer") failures.push("card " + f.row.name + ": run cursor " + cs.cursor);
    }
    for (const [group, list] of Object.entries(widths)) {
      const dw = list.length ? Math.max(...list.map((w) => w.width)) - Math.min(...list.map((w) => w.width)) : NaN;
      if (!(list.length && dw <= 0.5)) failures.push("card " + group + " width varies: " + JSON.stringify(list));
    }
    const copyRow = P.fences.find((f) => f.row.group === "copy-button" && f.row.state === "copied");
    const failRow = P.fences.find((f) => f.row.group === "copy-button" && f.row.state === "failed");
    if (!copyRow || copyRow.card.querySelector(".bob-run-fence-run").textContent !== M.fenceFaces.copied) failures.push("copied fence button is not " + M.fenceFaces.copied);
    if (!failRow || failRow.card.querySelector(".bob-run-fence-run").textContent !== M.fenceFaces.failed) failures.push("failed fence button is not " + M.fenceFaces.failed);
    return { widths, failures };
  }

  function progress() {
    const failures = [];
    const running = P.mounted.filter((item) => item.model && item.model.face === "running" && item.host.classList.contains("has-progress"));
    for (const item of running) {
      const cs = getComputedStyle(face(item.host));
      if (!String(cs.backgroundImage).includes("linear-gradient")) failures.push(label(item) + ": progress is not on the face");
      const value = item.host.style.getPropertyValue("--bob-run-progress") || "";
      if (!value.includes("var(--bob-run-chip-ink, var(--interactive-accent))")) failures.push(label(item) + ": current segment is not run ink");
    }
    if (!running.length) failures.push("no running chip with progress");
    return { running: running.length, failures };
  }

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
    }
    for (const f of P.fences) {
      const card = f.card;
      const cs = getComputedStyle(card);
      if (cs.borderTopStyle !== "none") failures.push("card " + f.row.name + ": frame prints");
      for (const selector of [".bob-run-fence-glyph", ".bob-run-fence-run"]) {
        for (const el of card.querySelectorAll(selector)) if (getComputedStyle(el).display !== "none") failures.push("card " + f.row.name + ": " + selector + " prints");
      }
    }
    return { chips: P.mounted.length, cards: P.fences.length, failures };
  }

  function motion() {
    const animations = document.getAnimations();
    const names = animations.map((a) => a.animationName || "");
    const durations = [];
    for (const item of P.mounted) durations.push(getComputedStyle(item.host).transitionDuration, getComputedStyle(well(item.host)).transitionDuration);
    for (const f of P.fences) durations.push(getComputedStyle(f.card.querySelector(".bob-run-fence-run")).transitionDuration);
    return {
      spin: names.filter((n) => n === "bob-run-chip-spin").length,
      pulse: names.filter((n) => n === "bob-run-chip-pulse").length,
      fire: names.filter((n) => n === "bob-run-chip-fire").length,
      tipReveal: names.filter((n) => n === "bob-run-chip-tip-in").length,
      transitions: animations.filter((a) => typeof CSSTransition !== "undefined" && a instanceof CSSTransition).length,
      timedElements: durations.filter((d) => d.split(",").some((part) => parseFloat(part) > 0)).length,
    };
  }

  window.commandChipsChecks = { parity, geometry, sweepSetup, sweep, contrast, tips, attributes, cardButton, progress, print, motion };
}

module.exports = pageChecks;
