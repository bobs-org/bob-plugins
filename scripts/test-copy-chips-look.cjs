#!/usr/bin/env node
// Static checks on the copy-chip and bob-copy card styles in
// plugins/bob-chips/styles.css: the blue copy well, theme-only colors,
// state rules that change colors only, the tooltip reveal, the from-only
// pulse, reduced motion, print, and an untouched command-chip section.
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { helpers } = require("./copy-chips-test-helpers.cjs");

const css = fs.readFileSync(path.join(__dirname, "..", "plugins", "bob-chips", "styles.css"), "utf8");
const runStart = css.indexOf("/* Command chips:");
const fenceStart = css.indexOf(".bob-copy-fence {");
const runFenceStart = css.indexOf("/* `bob-run` sequence cards");
const authorStart = css.indexOf(".modal.bob-copy-author-modal {");
const inline = css.slice(0, runStart);
const fence = css.slice(fenceStart, runFenceStart);
const author = css.slice(authorStart);
const copy = inline + "\n" + fence + "\n" + author;
const INK = "--bob-copy-chip-ink: var(--bob-copy-chip-hue, var(--color-blue));";

// Split a selector list on top-level commas (`:is(span, button)` stays whole).
function splitSelectors(head) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of head) {
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  parts.push(current);
  return parts.map((part) => part.trim().replace(/\s+/g, " ")).filter(Boolean);
}

// Flat rule list: { selectors, body, at } with comments stripped and one
// level of @-block nesting (media queries, keyframes).
function rules(text) {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = [];
  let index = 0;
  const parseBlock = (end, at) => {
    while (index < end) {
      const open = src.indexOf("{", index);
      if (open === -1 || open >= end) break;
      const head = src.slice(index, open).trim();
      if (head.startsWith("@")) {
        let depth = 1;
        let close = open + 1;
        while (depth && close < src.length) {
          if (src[close] === "{") depth += 1;
          else if (src[close] === "}") depth -= 1;
          close += 1;
        }
        index = open + 1;
        parseBlock(close - 1, head);
        index = close;
        continue;
      }
      const close = src.indexOf("}", open);
      out.push({ selectors: splitSelectors(head), body: src.slice(open + 1, close), at });
      index = close + 1;
    }
  };
  parseBlock(src.length, null);
  return out;
}

const copyRules = rules(copy);
const ruleFor = (selector, at = null) => copyRules.find((r) => r.at === at && r.selectors.includes(selector));
const decl = (rule, property) => {
  const match = rule && rule.body.match(new RegExp("(?:^|;|\\s)" + property.replace(/[-]/g, "\\-") + ":\\s*([^;]+);"));
  return match ? match[1].trim() : null;
};

test("the sections exist in order and the command-chip slice is untouched", () => {
  assert.ok(runStart > 0 && fenceStart > runStart && runFenceStart > fenceStart && authorStart > runFenceStart);
  const run = css.slice(runStart, fenceStart);
  assert.doesNotMatch(run, /#[0-9a-f]{3,6}\b|rgba?\(/i, "no fixed colors");
  assert.match(run, /:is\(span, button\)\.bob-run-chip \{/);
  assert.doesNotMatch(run, /bob-copy-chip(?!-glyph|-hue)/, "no copy-chip rule hides in the command-chip slice");
});

test("copy styles use theme variables only", () => {
  const allowed = /var\(--bob-yank-flash-bg, rgba\(80, 200, 120, 0\.35\)\)/g;
  const stripped = copy.replace(/\/\*[\s\S]*?\*\//g, "").replace(allowed, "");
  assert.doesNotMatch(stripped, /#[0-9a-f]{3,8}\b/i, "no hex colors");
  assert.doesNotMatch(stripped, /\b(?:rgba?|hsla?)\(/i, "no rgb()/hsl() colors");
  assert.doesNotMatch(stripped, /(?<![-\w])(?:white|black)(?![-\w])/i, "no named colors");
});

test("one ink, defaulting to blue, behind one user knob", () => {
  for (const [name, section] of [["inline", inline], ["card", fence], ["author", author]]) {
    assert.ok(section.includes(INK), name + " section sets the ink from the hue knob");
  }
  assert.doesNotMatch(css, /--bob-copy-chip-hue\s*:/, "styles.css never sets the knob");
  const chip = ruleFor(":is(span, button).bob-copy-chip");
  assert.ok(chip, "base rule names both tags");
  assert.equal(decl(chip, "background-color"), "color-mix(in srgb, var(--bob-copy-chip-ink) 10%, var(--background-primary))");
  assert.equal(decl(chip, "border"), "1px solid color-mix(in srgb, var(--bob-copy-chip-ink) 50%, var(--background-primary))");
  assert.equal(decl(chip, "color"), "color-mix(in srgb, var(--bob-copy-chip-ink) 30%, var(--text-normal))");
  assert.equal(decl(chip, "padding"), "0.1em 0.5em 0.12em");
  for (const [property, value] of [["font-size", "0.92em"], ["line-height", "inherit"], ["vertical-align", "baseline"], ["box-decoration-break", "clone"], ["cursor", "copy"], ["box-shadow", "none"], ["height", "auto"], ["position", "relative"], ["display", "inline"]]) {
    assert.equal(decl(chip, property), value, property);
  }
  assert.equal(decl(ruleFor(".bob-copy-chip.is-labeled > .bob-copy-chip-face"), "font-weight"), "500");
});

test("the host never wraps between the well and the face; the face wraps", () => {
  assert.equal(decl(ruleFor(":is(span, button).bob-copy-chip"), "white-space"), "nowrap");
  const face = ruleFor(".bob-copy-chip-face");
  assert.equal(decl(face, "white-space"), "normal");
  assert.equal(decl(face, "overflow-wrap"), "anywhere");
  // The hidden Copy prefix stays in flow (an out-of-flow placeholder after
  // the face would let the end cap wrap alone).
  const prefix = ruleFor(".bob-copy-chip-copy-prefix");
  assert.equal(decl(prefix, "font-size"), "0");
  assert.equal(decl(prefix, "position"), null);
});

test("the well is scoped under the chip; shared glyph rules stay as they were", () => {
  const well = ruleFor(".bob-copy-chip > .bob-copy-chip-glyph");
  assert.ok(well);
  assert.equal(decl(well, "background-color"), "var(--bob-copy-chip-ink)");
  assert.equal(decl(well, "color"), "var(--text-on-accent)");
  assert.equal(decl(well, "padding"), "0.1em 0.3em 0.12em", "the chip's own vertical padding");
  assert.equal(decl(well, "margin-inline"), "-0.5em 0.42em");
  assert.equal(decl(well, "--icon-stroke"), "2.25px");
  const svg = ruleFor(".bob-copy-chip > .bob-copy-chip-glyph svg");
  assert.equal(decl(svg, "width"), "0.95em");
  assert.equal(decl(svg, "height"), "0.95em");
  // Command chips and bob-run cards share the glyph class: the base rule
  // is unchanged, and every other glyph rule is scoped to copy surfaces.
  assert.match(inline, /\.bob-copy-chip-glyph \{\n {2}display: inline-flex;\n {2}width: 1\.1em;\n {2}min-width: 1\.1em;\n {2}align-items: center;\n {2}justify-content: center;\n {2}margin-right: 0\.25em;\n {2}color: var\(--text-faint\);\n {2}vertical-align: text-bottom;\n\}/);
  for (const rule of copyRules) {
    for (const selector of rule.selectors) {
      if (!selector.includes("bob-copy-chip-glyph")) continue;
      if (selector === ".bob-copy-chip-glyph" || selector === ".bob-copy-chip-glyph svg") continue;
      assert.match(selector, /\.bob-copy-chip(\[class\])? > \.bob-copy-chip-glyph|\.bob-copy-fence-header \.bob-copy-chip-glyph/, "unscoped glyph rule: " + selector);
    }
  }
});

test("hover and keyboard focus reveal the tooltip after a delay", () => {
  const reveal = ruleFor(".bob-copy-chip:hover > .bob-copy-chip-tip");
  assert.ok(reveal && reveal.selectors.includes(".bob-copy-chip:focus-visible > .bob-copy-chip-tip"));
  for (const [property, value] of [["display", "block"], ["position", "absolute"], ["bottom", "calc(100% + 6px)"], ["left", "0"], ["max-width", "min(36em, 80vw)"], ["z-index", "var(--layer-tooltip)"], ["pointer-events", "none"], ["box-shadow", "var(--shadow-s)"], ["font-family", "var(--font-interface)"], ["font-size", "var(--font-ui-smaller)"], ["font-weight", "normal"], ["white-space", "normal"], ["animation", "bob-copy-chip-tip-in 0s linear 0.4s both"]]) {
    assert.equal(decl(reveal, property), value, property);
  }
  assert.equal(decl(ruleFor(".bob-copy-chip-tip"), "display"), "none");
  assert.ok(copyRules.some((r) => r.at === "@keyframes bob-copy-chip-tip-in"));
});

test("the pulse is from-only, so it eases back to the element's own fill", () => {
  const frames = copyRules.filter((r) => r.at === "@keyframes bob-copy-chip-pulse");
  assert.deepEqual(frames.map((r) => r.selectors.join(",")), ["from"]);
  assert.equal(decl(frames[0], "background-color"), "var(--bob-yank-flash-bg, rgba(80, 200, 120, 0.35))");
  assert.equal(decl(ruleFor(":is(span, button).bob-copy-chip.is-copied"), "animation"), "bob-copy-chip-pulse 1.2s ease-out 1");
  assert.equal(decl(ruleFor(".bob-copy-fence.is-copied .bob-copy-fence-header"), "animation"), "bob-copy-chip-pulse 1.2s ease-out 1");
});

test("states change colors only: never border width, padding, weight, or size", () => {
  assert.doesNotMatch(copy, /border-width|border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?:\s*[2-9]px/, "no rule sets a border wider than 1px");
  const stateful = /:hover|:active|:focus-visible|\.is-copied|\.is-failed|\.mobile-tap/;
  let states = 0;
  for (const rule of copyRules) {
    if (rule.at || !rule.selectors.some((s) => stateful.test(s) && /bob-copy-(chip|fence-copy)/.test(s))) continue;
    if (rule.selectors.some((s) => s.includes("bob-copy-chip-tip"))) continue;
    states += 1;
    assert.doesNotMatch(rule.body, /(?:^|[\s;])(?:padding(?:-[a-z-]+)?|margin(?:-[a-z-]+)?|font|font-weight|font-size|line-height|(?:min-|max-)?width|(?:min-|max-)?height|border|border-(?:top|right|bottom|left)|border(?:-[a-z]+)?-width)\s*:/, "state rule changes geometry: " + rule.selectors.join(", "));
  }
  assert.ok(states >= 8, "found the state rules");
  assert.equal(decl(ruleFor(":is(span, button).bob-copy-chip.is-copied"), "--bob-copy-chip-ink"), "var(--color-green)");
  assert.equal(decl(ruleFor(":is(span, button).bob-copy-chip.is-failed"), "--bob-copy-chip-ink"), "var(--text-error)");
  assert.equal(decl(ruleFor(".bob-copy-fence.is-copied"), "--bob-copy-chip-ink"), "var(--color-green)");
  assert.equal(decl(ruleFor(".bob-copy-fence.is-failed"), "--bob-copy-chip-ink"), "var(--text-error)");
  const hover = ruleFor(":is(span, button).bob-copy-chip:hover");
  assert.ok(hover.selectors.includes("button.bob-copy-chip.mobile-tap"), "the tap state matches hover");
  assert.equal(decl(hover, "background-color"), "color-mix(in srgb, var(--bob-copy-chip-ink) 17%, var(--background-primary))");
  assert.equal(decl(hover, "border-color"), "var(--bob-copy-chip-ink)");
  assert.equal(decl(ruleFor(":is(span, button).bob-copy-chip:active"), "background-color"), "color-mix(in srgb, var(--bob-copy-chip-ink) 24%, var(--background-primary))");
  const focus = ruleFor(":is(span, button).bob-copy-chip:focus-visible");
  assert.equal(decl(focus, "outline"), "2px solid var(--bob-copy-chip-ink)");
  assert.equal(decl(focus, "box-shadow"), "none", "neutralizes Obsidian's button focus ring");
});

test("reduced motion and print cover the chip, the well, and the tooltip", () => {
  const motion = copyRules.filter((r) => r.at === "@media (prefers-reduced-motion: reduce)");
  const motionSelectors = motion.flatMap((r) => r.selectors).join(" ");
  for (const part of [/bob-copy-chip\[class\]/, /bob-copy-chip-glyph/, /bob-copy-chip-tip/, /bob-copy-fence-header/, /bob-copy-fence-copy/]) assert.match(motionSelectors, part);
  for (const rule of motion) {
    assert.equal(decl(rule, "animation"), "none");
    assert.equal(decl(rule, "transition"), "none");
  }
  const print = copyRules.filter((r) => r.at === "@media print");
  const chip = print.find((r) => r.selectors.includes(":is(span, button).bob-copy-chip[class]"));
  assert.ok(chip, "print outranks state rules with [class]");
  for (const [property, value] of [["padding", "0"], ["border", "none"], ["background", "none"], ["box-shadow", "none"], ["outline", "none"], ["animation", "none"]]) assert.equal(decl(chip, property), value, property);
  const hidden = print.filter((r) => decl(r, "display") === "none").flatMap((r) => r.selectors);
  for (const selector of [".bob-copy-chip[class] > .bob-copy-chip-glyph", ".bob-copy-chip[class] > .bob-copy-chip-tip", ".bob-copy-chip-copy-prefix", ".bob-copy-fence[class] .bob-copy-fence-copy", ".bob-copy-fence[class] .bob-copy-fence-toggle", ".bob-copy-fence[class] .bob-copy-fence-header .bob-copy-chip-glyph"]) {
    assert.ok(hidden.includes(selector), "print hides " + selector);
  }
  assert.equal(decl(print.find((r) => r.selectors.includes(".bob-copy-chip[class] > .bob-copy-chip-face")), "font-weight"), "inherit");
  assert.equal(decl(print.find((r) => r.selectors.includes(".bob-copy-fence[class] .bob-copy-fence-header")), "background"), "none");
  assert.equal(decl(print.find((r) => r.selectors.includes(".bob-copy-fence-body.is-folded")), "max-height"), "none");
});

test("the card and the authoring icon wear the same well", () => {
  const card = ruleFor(".bob-copy-fence");
  assert.equal(decl(card, "background-color"), "var(--background-primary)");
  assert.equal(decl(card, "border"), "1px solid color-mix(in srgb, var(--bob-copy-chip-ink) 35%, var(--background-modifier-border))");
  const header = ruleFor(".bob-copy-fence-header");
  assert.equal(decl(header, "background-color"), "color-mix(in srgb, var(--bob-copy-chip-ink) 8%, var(--background-primary))");
  const glyph = ruleFor(".bob-copy-fence-header .bob-copy-chip-glyph");
  assert.equal(decl(glyph, "background-color"), "var(--bob-copy-chip-ink)");
  assert.equal(decl(glyph, "color"), "var(--text-on-accent)");
  assert.equal(decl(glyph, "width"), "1.5em");
  const button = ruleFor(":is(span, button).bob-copy-fence-copy");
  assert.equal(decl(button, "background-color"), "color-mix(in srgb, var(--bob-copy-chip-ink) 12%, var(--background-primary))");
  assert.equal(decl(button, "box-shadow"), "none");
  assert.equal(decl(button, "cursor"), "copy");
  assert.match(decl(button, "min-width") || "", /^\d+(\.\d+)?em$/, "a fixed min-width keeps the header from reflowing");
  assert.equal(decl(ruleFor(".bob-copy-fence-title"), "font-weight"), "600");
  assert.equal(decl(ruleFor("button.bob-copy-fence-toggle:hover"), "color"), "var(--bob-copy-chip-ink)");
  const icon = ruleFor(".bob-copy-author-icon");
  assert.equal(decl(icon, "background-color"), "var(--bob-copy-chip-ink)");
  assert.equal(decl(icon, "color"), "var(--text-on-accent)");
  const runIcon = ruleFor(".bob-copy-author-modal.is-run .bob-copy-author-icon");
  assert.equal(decl(runIcon, "--bob-copy-chip-ink"), "var(--bob-run-chip-hue, var(--interactive-accent))", "a command chip's authoring icon is the run well");
  const inert = copyRules.find((r) => r.selectors.includes(".bob-copy-author .bob-copy-fence-copy"));
  assert.ok(inert && inert.selectors.includes(".bob-copy-author .bob-copy-fence-toggle"));
  assert.equal(decl(inert, "pointer-events"), "none");
});
