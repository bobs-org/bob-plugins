// Tests for the blocked-reason miniature renderer (`api.blockMarks.render`)
// and its gated paint: listener-free `span.bob-block-mark` elements in both
// aria modes, pip/miniature coverage, and computed WCAG contrast of the
// shipped CSS values in default light and dark themes. Owned by bob-cli
// `docs/blocked-marks.md`, child-epic phase paint_api.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");

class StubWidgetType {}
class StubPlugin {
  constructor(app) {
    this.app = app;
  }
}

const originalLoad = Module._load;
Module._load = function loadWithBlockMarkContrastStubs(request) {
  if (request === "obsidian") {
    return {
      MarkdownView: class MarkdownView {},
      Notice: class Notice {},
      Platform: { isDesktopApp: true },
      Plugin: StubPlugin,
      normalizePath: (value) => value,
      parseYaml: (text) => JSON.parse(text),
      editorInfoField: {},
      editorLivePreviewField: {},
    };
  }
  if (request === "@codemirror/state") {
    return {
      Prec: { highest: (value) => value },
      StateEffect: { define: () => ({ of: (value) => ({ value }) }) },
      RangeSetBuilder: class RangeSetBuilder {},
    };
  }
  if (request === "@codemirror/view") {
    return {
      EditorView: { updateListener: { of: (value) => value } },
      keymap: { of: (value) => value },
      ViewPlugin: { fromClass: (value) => value },
      Decoration: { none: {} },
      WidgetType: StubWidgetType,
    };
  }
  if (request === "@codemirror/language") {
    return { syntaxTree: () => ({ resolveInner: () => null }) };
  }
  return originalLoad.call(this, request, ...Array.prototype.slice.call(arguments, 1));
};

const MAIN_PATH = require.resolve("../plugins/bob-ledger-tools/main.js");
delete require.cache[MAIN_PATH];
const LedgerToolsPlugin = require(MAIN_PATH);
Module._load = originalLoad;

const { helpers } = LedgerToolsPlugin;
const { buildBlockMarkElement } = helpers;

const CSS_PATH = path.join(
  __dirname,
  "..",
  "plugins",
  "bob-ledger-tools",
  "styles.css",
);
const SECTION_BEGIN = "/* Blocked-reason marks (BM) paint: begin.";
const SECTION_END = "/* Blocked-reason marks (BM) paint: end. */";

function sectionCss() {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  const begin = css.indexOf(SECTION_BEGIN);
  const end = css.indexOf(SECTION_END);
  assert.ok(begin !== -1, "block-mark paint section opens styles.css");
  assert.ok(end !== -1 && end > begin, "block-mark paint section closes styles.css");
  return css.slice(begin, end + SECTION_END.length);
}

function fakeDoc() {
  const doc = {
    createElement(name) {
      const el = {
        tagName: String(name),
        attrs: {},
        children: [],
        ownerDocument: doc,
        setAttribute(key, value) {
          this.attrs[String(key)] = String(value);
        },
        getAttribute(key) {
          return Object.prototype.hasOwnProperty.call(this.attrs, key)
            ? this.attrs[key]
            : null;
        },
        appendChild(child) {
          this.children.push(child);
          return child;
        },
      };
      return el;
    },
  };
  return doc;
}

function fakeHost(doc) {
  return {
    ownerDocument: doc,
    children: [],
    appendChild(child) {
      this.children.push(child);
      return child;
    },
  };
}

const SYNTHETIC_DIGIT = Object.freeze({
  key: "p4",
  family: "waiting",
  digit: 4,
  more: null,
  reasons: Object.freeze([]),
  tooltip: "Blocked · P4 deferral · until Tue, Mar 3 · synthetic",
  modelKey: "synthetic-p4",
});

const MEANINGFUL_DEP = Object.freeze({
  key: "dep",
  family: "held",
  digit: null,
  more: "p3",
  reasons: Object.freeze([]),
  tooltip: "Blocked · after Finish the battery\nCtrl+Shift+B to edit prerequisites",
  modelKey: "meaningful-dep",
});

test("render appends one listener-free miniature with row-identical attributes", () => {
  const doc = fakeDoc();
  const host = fakeHost(doc);
  const el = buildBlockMarkElement(doc, MEANINGFUL_DEP, {});
  assert.ok(el, "builder returns the span");
  assert.equal(el.tagName, "span");
  assert.equal(el.attrs.class, "bob-block-mark");
  assert.equal(el.attrs["data-bob-block"], "dep");
  assert.equal(el.attrs["data-bob-block-family"], "held");
  assert.equal(el.attrs["data-bob-block-more"], "p3");
  assert.equal(el.attrs.role, "img");
  assert.equal(el.attrs["aria-label"], MEANINGFUL_DEP.tooltip);
  assert.deepEqual(el.children, [], "no children: the CSS draws glyph and pip");
  assert.equal(typeof el.addEventListener, "undefined", "listener-free");

  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.blockMarksEnabled = true;
  const rendered = plugin.blockMarkRender(host, MEANINGFUL_DEP, {});
  assert.strictEqual(rendered.ownerDocument, doc, "built in the host document");
  assert.equal(host.children.length, 1, "exactly one append");
  assert.strictEqual(host.children[0], rendered);
});

test("render decorative miniatures hide from assistive tech", () => {
  const doc = fakeDoc();
  const el = buildBlockMarkElement(doc, SYNTHETIC_DIGIT, { decorative: true });
  assert.equal(el.attrs["aria-hidden"], "true");
  assert.equal(el.attrs.role, undefined);
  assert.equal(el.attrs["aria-label"], undefined);
  assert.equal(el.attrs["data-bob-block"], "p4");
  assert.equal(el.attrs["data-bob-block-more"], undefined);
});

test("render accepts a synthetic digit model with no source task", () => {
  const doc = fakeDoc();
  const host = fakeHost(doc);
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.blockMarksEnabled = true;
  const rendered = plugin.blockMarkRender(host, SYNTHETIC_DIGIT, {});
  assert.ok(rendered, "synthetic digit renders without a source task");
  assert.equal(rendered.attrs["data-bob-block"], "p4");
  assert.equal(rendered.attrs["data-bob-block-family"], "waiting");
  assert.equal(rendered.attrs.role, "img");
});

test("render uses the host ownerDocument, never a foreign one", () => {
  const hostDoc = fakeDoc();
  const foreignDoc = fakeDoc();
  const host = fakeHost(hostDoc);
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.blockMarksEnabled = true;
  const rendered = plugin.blockMarkRender(host, SYNTHETIC_DIGIT, {});
  assert.strictEqual(rendered.ownerDocument, hostDoc);
  assert.notStrictEqual(rendered.ownerDocument, foreignDoc);
  const direct = buildBlockMarkElement(foreignDoc, SYNTHETIC_DIGIT, {});
  assert.strictEqual(direct.ownerDocument, foreignDoc);
});

test("render returns null for bad input, a disabled gate, or no DOM", () => {
  const doc = fakeDoc();
  const host = fakeHost(doc);
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.blockMarksEnabled = true;
  assert.equal(plugin.blockMarkRender(null, SYNTHETIC_DIGIT, {}), null);
  assert.equal(plugin.blockMarkRender(host, null, {}), null);
  assert.equal(plugin.blockMarkRender(host, { key: "nope", family: "waiting" }, {}), null);
  assert.equal(plugin.blockMarkRender(host, { key: "p1", family: "nope" }, {}), null);
  assert.equal(buildBlockMarkElement(null, SYNTHETIC_DIGIT, {}), null);
  assert.equal(buildBlockMarkElement(doc, null, {}), null);

  const gated = Object.create(LedgerToolsPlugin.prototype);
  gated.blockMarksEnabled = false;
  assert.equal(gated.blockMarkRender(host, SYNTHETIC_DIGIT, {}), null);

  const orphan = { appendChild(child) { return child; } };
  assert.equal(
    typeof document === "undefined" ? plugin.blockMarkRender(orphan, SYNTHETIC_DIGIT, {}) : "skip",
    typeof document === "undefined" ? null : "skip",
    "no host document and no global document is null",
  );
});

test("api.blockMarks v1 keeps model and adds a gated render", () => {
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.blockMarksEnabled = true;
  const api = plugin.blockMarksApi();
  assert.equal(api.version, 1, "namespace stays v1");
  assert.ok(Object.isFrozen(api), "namespace stays frozen");
  assert.equal(typeof api.model, "function");
  assert.equal(typeof api.render, "function");

  const doc = fakeDoc();
  const host = fakeHost(doc);
  const rendered = api.render(host, SYNTHETIC_DIGIT, {});
  assert.ok(rendered, "api.render appends through the gate");
  plugin.blockMarksEnabled = false;
  assert.equal(api.render(host, SYNTHETIC_DIGIT, {}), null, "toggle off removes render");
  assert.equal(api.render(null, null, null), null, "render never throws");
});

test("paint covers miniature, Live Preview, and reading rows under one gate", () => {
  const section = sectionCss();
  assert.ok(
    section.indexOf('span.bob-block-mark[data-bob-block]') !== -1,
    "miniature spans are painted",
  );
  assert.ok(
    section.indexOf('.HyperMD-task-line[data-task="?"][data-bob-block]') !== -1,
    "Live Preview lines are painted",
  );
  assert.ok(
    section.indexOf('li.task-list-item[data-task="?"][data-bob-block]') !== -1,
    "reading rows are painted",
  );
  assert.ok(
    section.indexOf('[data-bob-block-more]') !== -1,
    "the losing-reason pip is painted",
  );
  assert.ok(
    section.indexOf('content: "1"') !== -1 &&
    section.indexOf('content: "4"') !== -1 &&
    section.indexOf('content: "&"') !== -1,
    "text glyphs reuse --task-status-symbol content",
  );
  assert.ok(
    section.indexOf("M4 10.25 8 6.25l4 4") !== -1,
    "chevron geometry matches the contract",
  );
  assert.ok(
    section.indexOf("var(--bob-date-glyph-repeat)") !== -1,
    "recurrence reuses the date-mark loop mask",
  );
  assert.ok(
    section.indexOf("font-variant-numeric: tabular-nums") !== -1,
    "digits are tabular",
  );
  const declarations = section.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal(
    (declarations.match(/!important/g) || []).length,
    0,
    "paint beats the snippet by specificity, never !important",
  );
});

test("every paint rule except the token block and motion query carries the gate", () => {
  const section = sectionCss();
  const lines = section.split("\n");
  const offenders = [];
  for (const line of lines) {
    if (line.indexOf("{") === -1) continue;
    const trimmed = line.trim();
    if (trimmed === "body {") continue;
    if (trimmed.indexOf("@media") === 0) continue;
    if (trimmed === "}") continue;
    if (trimmed.indexOf("bob-block-marks") === -1) offenders.push(trimmed);
  }
  assert.deepEqual(offenders, [], "ungated paint rules: " + offenders.join(" | "));
});

test("paint keeps pip geometry, reduced motion, and the 120ms budget", () => {
  const section = sectionCss();
  for (const declaration of [
    "width: 6px",
    "height: 6px",
    "top: -3px",
    "right: -3px",
    "box-shadow: 0 0 0 1.5px var(--background-primary)",
    "overflow: visible",
    "pointer-events: none",
  ]) {
    assert.ok(section.indexOf(declaration) !== -1, "pip keeps " + declaration);
  }
  assert.ok(
    section.indexOf("prefers-reduced-motion") !== -1 &&
    section.indexOf("transition: none") !== -1,
    "nothing animates under reduced motion",
  );
  const transitions = Array.from(
    section.matchAll(/transition:\s*([^;]+);/g),
    (match) => match[1],
  ).filter((value) => value.trim() !== "none");
  assert.ok(transitions.length > 0, "transitions exist to bound");
  for (const value of transitions) {
    for (const match of value.matchAll(/(\d+)ms/g)) {
      assert.ok(Number(match[1]) <= 120, "transition over budget: " + value);
    }
  }
});

function hexToRgb(hex) {
  const n = String(hex || "").replace("#", "");
  return [
    parseInt(n.slice(0, 2), 16),
    parseInt(n.slice(2, 4), 16),
    parseInt(n.slice(4, 6), 16),
  ];
}

function mixRgb(a, b, p) {
  return a.map((value, index) => value * p + b[index] * (1 - p));
}

function relativeLuminance(rgb) {
  const lin = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrastRatio(a, b) {
  const hi = Math.max(relativeLuminance(a), relativeLuminance(b));
  const lo = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (hi + 0.05) / (lo + 0.05);
}

// Obsidian default-theme tokens, read from the shipped Electron bundle
// (`--color-base-00` background, `--color-base-100` normal text,
// `--color-base-70` muted text, `--color-red` blocked): light first.
const THEMES = Object.freeze({
  light: Object.freeze({
    bg: hexToRgb("#ffffff"),
    normal: hexToRgb("#222222"),
    muted: hexToRgb("#5c5c5c"),
    red: hexToRgb("#e93147"),
  }),
  dark: Object.freeze({
    bg: hexToRgb("#1c1c1c"),
    normal: hexToRgb("#dadada"),
    muted: hexToRgb("#b3b3b3"),
    red: hexToRgb("#fb464c"),
  }),
});

function shippedMixPercents() {
  const section = sectionCss();
  const anchor = section.match(
    /--bob-block-ink-anchor:\s*color-mix\(in srgb,\s*var\(--color-red\)\s*([\d.]+)%/,
  );
  const inks = Array.from(
    section.matchAll(
      /--bob-block-ink-[234]:\s*color-mix\(in srgb,\s*var\(--bob-block-ink-anchor\)\s*([\d.]+)%/g,
    ),
    (match) => Number(match[1]),
  );
  const held = Array.from(
    section.matchAll(
      /--bob-block-held-fill:\s*color-mix\(in srgb,\s*black\s*([\d.]+)%/g,
    ),
    (match) => Number(match[1]),
  );
  assert.ok(anchor, "anchor mix ships in styles.css");
  assert.equal(inks.length, 3, "three level mixes ship in styles.css");
  assert.equal(held.length, 2, "light and dark held darkening mixes ship");
  return {
    anchor: Number(anchor[1]),
    levels: inks,
    held: held.slice().sort((a, b) => a - b),
  };
}

function waitingInks(palette, mixes) {
  const anchor = mixRgb(palette.red, palette.normal, mixes.anchor / 100);
  return {
    p1: anchor,
    date: anchor,
    p2: mixRgb(anchor, palette.muted, mixes.levels[0] / 100),
    p3: mixRgb(anchor, palette.muted, mixes.levels[1] / 100),
    p4: mixRgb(anchor, palette.muted, mixes.levels[2] / 100),
    repeat: mixRgb(anchor, palette.muted, mixes.levels[2] / 100),
  };
}

test("shipped mixes match the calibrated contract ramp", () => {
  const mixes = shippedMixPercents();
  assert.equal(mixes.anchor, 72, "72% red anchor");
  assert.deepEqual(mixes.levels, [68, 38, 12], "68/38/12 level mixes");
  assert.deepEqual(mixes.held, [4, 14], "4% light and 14% dark held darkening");
});

test("waiting glyphs meet 4.5:1 on their washed rows, both themes", () => {
  const mixes = shippedMixPercents();
  const failures = [];
  for (const [theme, palette] of Object.entries(THEMES)) {
    const row = mixRgb(palette.red, palette.bg, 0.055);
    for (const [key, ink] of Object.entries(waitingInks(palette, mixes))) {
      const box = mixRgb(ink, row, 0.12);
      const ratio = contrastRatio(ink, box);
      if (ratio < 4.5) failures.push(theme + " " + key + " " + ratio.toFixed(3));
    }
  }
  assert.deepEqual(failures, [], "below 4.5:1: " + failures.join("; "));
});

test("white on the darkened held fill meets 4.5:1, both themes", () => {
  const mixes = shippedMixPercents();
  const white = [255, 255, 255];
  const ordered = [THEMES.light, THEMES.dark].map((palette, index) => ({
    palette,
    darkening: index === 0 ? Math.min(...mixes.held) : Math.max(...mixes.held),
  }));
  const failures = [];
  for (const [theme, entry] of Object.entries(
    Object.fromEntries([["light", ordered[0]], ["dark", ordered[1]]]),
  )) {
    const fill = mixRgb([0, 0, 0], entry.palette.red, entry.darkening / 100);
    const ratio = contrastRatio(white, fill);
    if (ratio < 4.5) failures.push(theme + " held " + ratio.toFixed(3));
  }
  assert.deepEqual(failures, [], "below 4.5:1: " + failures.join("; "));
});

test("row tint and rail percentages ship in the gated rules", () => {
  const section = sectionCss();
  assert.ok(section.indexOf("13%, transparent") !== -1, "held keeps the 13% tint");
  assert.ok(section.indexOf("5.5%, transparent") !== -1, "waiting uses the 5.5% tint");
  assert.ok(
    section.indexOf("45%, transparent") !== -1,
    "waiting rails at 45%",
  );
  assert.ok(
    section.indexOf("border: 1.5px solid") !== -1 &&
    section.indexOf("border: 1.5px dashed") !== -1,
    "waiting and stale keep their 1.5px borders",
  );
  assert.ok(
    section.indexOf("color-mix(in srgb, var(--bob-block-ink) 12%, transparent)") !== -1,
    "waiting boxes wash 12% of their ink",
  );
});

test("helpers never throw on bad input", () => {
  assert.equal(buildBlockMarkElement(null, SYNTHETIC_DIGIT, {}), null);
  assert.equal(buildBlockMarkElement(fakeDoc(), null, {}), null);
  assert.equal(buildBlockMarkElement(fakeDoc(), { key: "nope", family: "waiting" }, {}), null);
  assert.equal(buildBlockMarkElement(fakeDoc(), { key: "p1", family: "nope" }, {}), null);
  const noTooltip = buildBlockMarkElement(
    fakeDoc(),
    { key: "p1", family: "waiting" },
    null,
  );
  assert.ok(noTooltip, "missing tooltip still renders");
  assert.equal(noTooltip.attrs["aria-label"], "");
});
