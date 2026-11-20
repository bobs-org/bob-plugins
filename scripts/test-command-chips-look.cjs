#!/usr/bin/env node
// Static checks on the command-chip and bob-run card styles in
// plugins/bob-chips/styles.css: the solid run well, theme-only colors,
// state rules that change colors only, the tooltip reveal, the from-only
// pulse and fire, reduced motion, print, and the copy-only copy look.
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
const inline = css.slice(runStart, fenceStart);
const card = css.slice(runFenceStart, authorStart);
const author = css.slice(authorStart);
const run = inline + "\n" + card;
const INK = "--bob-run-chip-ink: var(--bob-run-chip-hue, var(--interactive-accent));";

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

const runRules = rules(run);
const authorRules = rules(author);
const ruleFor = (selector, at = null, list = runRules) => list.find((r) => r.at === at && r.selectors.includes(selector));
const decl = (rule, property) => {
  const match = rule && rule.body.match(new RegExp("(?:^|;|\\s)" + property.replace(/[-]/g, "\\-") + ":\\s*([^;]+);"));
  return match ? match[1].trim() : null;
};

test("the command-chip sections exist in order", () => {
  assert.ok(runStart > 0 && fenceStart > runStart && runFenceStart > fenceStart && authorStart > runFenceStart);
});

test("command styles use theme variables only", () => {
  const stripped = run.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(stripped, /#[0-9a-f]{3,8}\b/i, "no hex colors");
  assert.doesNotMatch(stripped, /\b(?:rgba?|hsla?)\(/i, "no rgb()/hsl() colors");
  assert.doesNotMatch(stripped, /(?<![-\w])(?:white|black)(?![-\w])/i, "no named colors");
});

test("one ink, defaulting to accent, behind one user knob", () => {
  for (const [name, section] of [["inline", inline], ["card", card]]) {
    assert.ok(section.includes(INK), name + " section sets the ink from the hue knob");
  }
  assert.doesNotMatch(css, /--bob-run-chip-hue\s*:/, "styles.css never sets the knob");
  const chip = ruleFor(":is(span, button).bob-run-chip");
  assert.ok(chip, "base rule names both tags");
  assert.equal(decl(chip, "background-color"), "color-mix(in srgb, var(--bob-run-chip-ink) 10%, var(--background-primary))");
  assert.equal(decl(chip, "border"), "1px solid color-mix(in srgb, var(--bob-run-chip-ink) 50%, var(--background-primary))");
  assert.equal(decl(chip, "color"), "color-mix(in srgb, var(--bob-run-chip-ink) 30%, var(--text-normal))");
  assert.equal(decl(chip, "padding"), "0.1em 0.5em 0.12em");
  for (const [property, value] of [["font-size", "0.92em"], ["line-height", "inherit"], ["vertical-align", "baseline"], ["box-decoration-break", "clone"], ["cursor", "pointer"], ["box-shadow", "none"], ["height", "auto"], ["position", "relative"], ["display", "inline"]]) {
    assert.equal(decl(chip, property), value, property);
  }
  assert.equal(decl(ruleFor(".bob-run-chip.is-labeled .bob-run-chip-label"), "font-weight"), "500");
});

test("the host never wraps between the well and the face; the face wraps", () => {
  assert.equal(decl(ruleFor(":is(span, button).bob-run-chip"), "white-space"), "nowrap");
  const face = ruleFor(".bob-run-chip-face");
  assert.equal(decl(face, "white-space"), "normal");
  assert.equal(decl(face, "overflow-wrap"), "anywhere");
  const action = ruleFor(".bob-run-chip-action");
  assert.equal(decl(action, "font-size"), "0");
  assert.equal(decl(action, "position"), null);
});

test("the well is scoped under the chip; lucide-play is filled", () => {
  const well = ruleFor(".bob-run-chip > .bob-run-chip-glyph");
  assert.ok(well);
  assert.equal(decl(well, "background-color"), "var(--bob-run-chip-ink)");
  assert.equal(decl(well, "color"), "var(--bob-run-chip-on-ink, var(--text-on-accent))");
  assert.equal(decl(well, "padding"), "0.1em 0.3em 0.12em");
  assert.equal(decl(well, "margin-inline"), "-0.5em 0.42em");
  assert.equal(decl(well, "--icon-stroke"), "2.25px");
  const svg = ruleFor(".bob-run-chip > .bob-run-chip-glyph svg");
  assert.equal(decl(svg, "width"), "0.95em");
  assert.equal(decl(svg, "height"), "0.95em");
  assert.equal(decl(ruleFor(".bob-run-chip > .bob-run-chip-glyph svg.lucide-play"), "fill"), "currentColor");
  for (const rule of runRules) {
    for (const selector of rule.selectors) {
      if (!selector.includes("bob-run-chip-glyph")) continue;
      assert.match(selector, /\.bob-run-chip(?:\[class\]|\.[\w-]+)* > \.bob-run-chip-glyph/, "unscoped glyph rule: " + selector);
    }
  }
});

test("attention uses inverted on-accent ink; progress rides the face", () => {
  assert.equal(decl(ruleFor(":is(span, button).bob-run-chip.is-attention"), "--bob-run-chip-on-ink"), "var(--text-on-accent-inverted)");
  const progress = ruleFor(".bob-run-chip.has-progress > .bob-run-chip-face");
  assert.ok(progress);
  assert.equal(decl(progress, "background-image"), "var(--bob-run-progress)");
  assert.equal(decl(progress, "background-size"), "100% 2px");
  assert.equal(decl(progress, "padding-block"), "0.1em 0.12em");
});

test("pulse and fire keyframes are from-only", () => {
  const pulse = runRules.filter((r) => r.at === "@keyframes bob-run-chip-pulse");
  assert.deepEqual(pulse.map((r) => r.selectors.join(",")), ["from"]);
  assert.equal(decl(pulse[0], "background-color"), "var(--bob-yank-flash-bg, var(--text-highlight-bg))");
  const fire = runRules.filter((r) => r.at === "@keyframes bob-run-chip-fire");
  assert.deepEqual(fire.map((r) => r.selectors.join(",")), ["from"]);
  assert.equal(decl(ruleFor(":is(span, button).bob-run-chip.is-completed"), "animation"), "bob-run-chip-pulse 1.2s ease-out 1");
  assert.equal(decl(ruleFor(":is(span, button).bob-run-chip.is-fired"), "animation"), "bob-run-chip-fire 0.6s ease-out 1");
});

test("states change colors only: never border width, padding, weight, or size", () => {
  assert.doesNotMatch(run, /border-width|border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?:\s*[2-9]px/, "no rule sets a border wider than 1px");
  for (const face of helpers.COMMAND_CHIP_FACES.filter((f) => f !== "ready")) {
    assert.ok(run.includes(".bob-run-chip.is-" + face), face);
  }
  assert.equal(decl(ruleFor(":is(span, button).bob-run-chip.is-copy"), "--bob-run-chip-ink"), "var(--bob-copy-chip-hue, var(--color-blue))");
  assert.equal(decl(ruleFor(":is(span, button).bob-run-chip.is-copy"), "cursor"), "copy");
  const hover = ruleFor(":is(span, button).bob-run-chip:hover");
  assert.ok(hover.selectors.includes("button.bob-run-chip.mobile-tap"), "the tap state matches hover");
  assert.equal(decl(hover, "background-color"), "color-mix(in srgb, var(--bob-run-chip-ink) 17%, var(--background-primary))");
  const focus = ruleFor(":is(span, button).bob-run-chip:focus-visible");
  assert.equal(decl(focus, "outline"), "2px solid var(--bob-run-chip-ink)");
  assert.equal(decl(focus, "box-shadow"), "none");
});

test("reduced motion and print cover chip, well, svg, tooltip, and card parts", () => {
  const motion = runRules.filter((r) => r.at === "@media (prefers-reduced-motion: reduce)");
  const motionSelectors = motion.flatMap((r) => r.selectors).join(" ");
  for (const part of [/bob-run-chip\[class\]/, /bob-run-chip-glyph/, /bob-run-chip-tip/, /bob-run-fence\[class\]/, /bob-run-fence-run/]) {
    assert.match(motionSelectors, part);
  }
  for (const rule of motion) {
    assert.equal(decl(rule, "animation"), "none");
    assert.equal(decl(rule, "transition"), "none");
  }
  const print = runRules.filter((r) => r.at === "@media print");
  const chip = print.find((r) => r.selectors.includes(":is(span, button).bob-run-chip[class]"));
  assert.ok(chip, "print outranks state rules with [class]");
  for (const [property, value] of [["padding", "0"], ["border", "none"], ["background", "none"], ["box-shadow", "none"], ["outline", "none"], ["animation", "none"]]) {
    assert.equal(decl(chip, property), value, property);
  }
  const hidden = print.filter((r) => decl(r, "display") === "none").flatMap((r) => r.selectors);
  for (const selector of [".bob-run-chip[class] > .bob-run-chip-glyph", ".bob-run-chip[class] > .bob-run-chip-tip", ".bob-run-chip-action", ".bob-run-fence[class] .bob-run-fence-glyph", ".bob-run-fence[class] .bob-run-fence-run"]) {
    assert.ok(hidden.includes(selector), "print hides " + selector);
  }
});

test("the card Run button keeps one width per kind; the author icon is the run well", () => {
  const button = ruleFor(":is(span, button).bob-run-fence-run");
  assert.equal(decl(button, "min-width"), "5.5em");
  assert.equal(decl(ruleFor(".bob-run-fence.is-copy .bob-run-fence-run"), "min-width"), "7.5em");
  const icon = ruleFor(".bob-copy-author-modal.is-run .bob-copy-author-icon", null, authorRules);
  assert.equal(decl(icon, "--bob-copy-chip-ink"), "var(--bob-run-chip-hue, var(--interactive-accent))");
  assert.equal(decl(ruleFor(".bob-copy-author-modal.is-run .bob-copy-author-icon svg.lucide-play", null, authorRules), "fill"), "currentColor");
});
