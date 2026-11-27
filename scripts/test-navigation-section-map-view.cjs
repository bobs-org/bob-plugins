const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { ElementStub } = require("./modal-harness.cjs");
const { helpers } = require("./navigation-hotkeys-harness.cjs");

const {
  buildSectionMapModel,
  computeSectionMapPlacement,
  createSectionMapHost,
} = helpers;
const STYLES = fs.readFileSync(
  path.join(__dirname, "../plugins/bob-navigation-hotkeys/styles.css"),
  "utf8",
);

function rect(left, top, width, height) {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

function descendants(element) {
  return (element?.children || []).flatMap((child) => [child, ...descendants(child)]);
}

function byAttr(root, name, value) {
  return descendants(root).filter((node) => node.attributes && node.attributes[name] === value);
}

function byClass(root, className) {
  return descendants(root).filter((node) => node.classes && node.classes.includes(className));
}

function flattenText(element) {
  return [element.textContent, ...(element.children || []).map(flattenText)].filter(Boolean).join(" ");
}

function makeDoc(options = {}) {
  const body = new ElementStub({ tag: "body" });
  const doc = {
    body,
    documentElement: { clientHeight: options.viewportHeight ?? 0 },
    createElement(tag) {
      const el = new ElementStub({ tag });
      el.ownerDocument = doc;
      return el;
    },
    defaultView: {
      innerHeight: options.viewportHeight ?? 0,
      matchMedia: (query) => ({
        matches: Boolean(options.reducedMotion) && String(query).includes("prefers-reduced-motion"),
      }),
    },
  };
  body.ownerDocument = doc;
  return doc;
}

function wideHost() {
  return {
    host: rect(0, 0, 1000, 600),
    scroller: rect(0, 0, 1000, 600),
    textColumn: rect(100, 0, 500, 600),
    notices: [],
  };
}

function jumpModel() {
  return buildSectionMapModel(["# Alpha", "body", "## Beta", "details", "# Gamma"], {
    cursorLine: 3,
    fromLine: 1,
    direction: 1,
  });
}

test("styles: section map tokens cover surface, rows, pill, chips, motion, and reduced motion", () => {
  for (const token of [
    "/* Section Map */",
    ".bob-section-map-host",
    ".bob-section-map",
    ".bob-section-map-header",
    ".bob-section-map-title",
    ".bob-section-map-wrap",
    ".bob-section-map-counter",
    ".bob-section-map-rows",
    ".bob-section-map-row",
    ".bob-section-map-guide",
    ".bob-section-map-ring",
    ".bob-section-map-label",
    ".bob-section-map-chips",
    ".bob-section-map-chip",
    ".bob-section-map-gap",
    ".bob-section-map-pill",
    ".bob-section-map-compact",
    ".bob-section-map-live",
    "pointer-events: none",
    "backdrop-filter: blur(10px)",
    "color-mix(in srgb, var(--background-secondary) 92%, transparent)",
    "color-mix(in srgb, var(--interactive-accent) 16%, transparent)",
    "@keyframes bob-section-map-in",
    "@keyframes bob-section-map-pop",
    "@keyframes bob-section-map-cross",
    "font-variant-numeric: tabular-nums",
    "prefers-reduced-motion",
    "inset 3px 0 0 var(--interactive-accent)",
  ]) {
    assert.ok(STYLES.includes(token), token);
  }
});

test("placement picks margin, overlay, and compact at the documented boundaries", () => {
  const host = rect(0, 0, 1000, 600);
  const scroller = rect(0, 0, 1000, 600);
  const wideColumn = rect(100, 0, 500, 600);
  // Gutter is exactly 220 + 2*16 = 252: margin wins with the minimum card width.
  const edge = computeSectionMapPlacement({
    host,
    scroller,
    textColumn: rect(100, 0, 648, 600),
    notices: [],
  });
  assert.equal(edge.mode, "margin");
  assert.equal(edge.width, 220);
  assert.equal(edge.top, 12);
  assert.equal(edge.left, 764);

  const margin = computeSectionMapPlacement({ host, scroller, textColumn: wideColumn, notices: [] });
  assert.equal(margin.mode, "margin");
  assert.equal(margin.width, 300);
  assert.equal(margin.left, 650);
  assert.equal(margin.top, 12);
  assert.equal(margin.maxRows, 12);

  const overlay = computeSectionMapPlacement({ host, scroller, textColumn: null, notices: [] });
  assert.equal(overlay.mode, "overlay");
  assert.equal(overlay.width, 300);
  assert.equal(overlay.left, 688);
  assert.equal(overlay.top, 12);

  const narrowColumn = computeSectionMapPlacement({
    host,
    scroller,
    textColumn: rect(100, 0, 700, 600),
    notices: [],
  });
  assert.equal(narrowColumn.mode, "overlay");

  const compactWidth = computeSectionMapPlacement({
    host: rect(0, 0, 479, 600),
    scroller: rect(0, 0, 479, 600),
    textColumn: null,
    notices: [],
  });
  assert.equal(compactWidth.mode, "compact");
  assert.equal(compactWidth.width, 479 - 24);
  assert.equal(compactWidth.top, 600 - 12 - 24 - 18);

  const compactHeight = computeSectionMapPlacement({
    host: rect(0, 0, 900, 160),
    scroller: rect(0, 0, 900, 160),
    textColumn: wideColumn,
    notices: [],
  });
  assert.equal(compactHeight.mode, "compact");

  const fullHeight = computeSectionMapPlacement({
    host: rect(0, 0, 900, 168),
    scroller: rect(0, 0, 900, 168),
    textColumn: wideColumn,
    notices: [],
  });
  assert.equal(fullHeight.mode, "margin");

  // A visible Notice intersecting the card nudges the card top below it, once.
  const nudged = computeSectionMapPlacement({
    host,
    scroller,
    textColumn: null,
    notices: [rect(500, 0, 400, 60)],
  });
  assert.equal(nudged.mode, "overlay");
  assert.ok(nudged.top >= 68, `top ${nudged.top}`);

  // Malformed input never throws and still positions a compact card.
  assert.doesNotThrow(() => computeSectionMapPlacement(null));
  const fallback = computeSectionMapPlacement(null);
  assert.equal(fallback.mode, "compact");
});

test("painter renders header, rows, ring, chips, gaps, and the live region", () => {
  const doc = makeDoc();
  const host = createSectionMapHost(doc);
  const state = host.render(jumpModel(), computeSectionMapPlacement(wideHost()));
  assert.equal(state.visible, true);

  const card = byAttr(doc.body, "data-bob-section-map", "card")[0];
  assert.ok(card.classes.includes("is-margin"));
  assert.ok(card.classes.includes("is-entering"));
  assert.equal(
    flattenText(byAttr(card, "data-bob-section-map", "counter")[0]).replace(/\s+/g, " "),
    "2 / 3",
  );

  const rows = byAttr(card, "data-bob-section-map", "row");
  assert.equal(rows.length, 3);
  const rowByLabel = Object.fromEntries(
    rows.map((row) => [flattenText(byAttr(row, "data-bob-section-map", "label")[0]), row]),
  );
  assert.ok(rowByLabel.Alpha.classes.includes("is-from"));
  assert.ok(!rowByLabel.Alpha.classes.includes("is-current"));
  assert.ok(rowByLabel.Beta.classes.includes("is-current"));
  assert.ok(rowByLabel.Gamma.classes.includes("is-chip-target"));
  const chips = byAttr(card, "data-bob-section-map", "chip").map(flattenText);
  assert.ok(chips.includes("⌃K"));
  assert.ok(chips.includes("⌃J"));

  const rowsEl = byAttr(doc.body, "data-bob-section-map", "rows")[0];
  assert.equal(rowsEl.attributes["aria-hidden"], "true");
  const live = byAttr(doc.body, "data-bob-section-map", "live")[0];
  assert.equal(live.attributes.role, "status");
  assert.equal(live.attributes["aria-live"], "polite");
  assert.equal(live.attributes["aria-atomic"], "true");
  host.setLiveText("Section 2 of 3, Beta");
  assert.equal(flattenText(live), "Section 2 of 3, Beta");

  // Gap rows report exact counts.
  const many = Array.from({ length: 40 }, (_unused, index) => `# Heading ${index}`);
  const wrapped = buildSectionMapModel(many, { cursorLine: 39, direction: 1 });
  host.render(wrapped, computeSectionMapPlacement(wideHost()));
  const gaps = byAttr(doc.body, "data-bob-section-map", "gap");
  assert.ok(gaps.length > 0);
  const total = gaps
    .map((gap) => Number(/⋯ (\d+) more/.exec(flattenText(gap))[1]))
    .reduce((sum, count) => sum + count, 0);
  assert.equal(total, 40 - wrapped.rows.filter((row) => row.type === "heading").length);
  host.destroy();
});

test("painter keeps node identity for the same keys and reorders in place", () => {
  const doc = makeDoc();
  const host = createSectionMapHost(doc);
  const first = buildSectionMapModel(["# A", "# B", "# C"], { cursorLine: 0, direction: 1 });
  host.render(first, computeSectionMapPlacement(wideHost()));
  const before = byAttr(doc.body, "data-bob-section-map", "row");
  assert.equal(before.length, 3);

  const second = buildSectionMapModel(["# A", "# B", "# C"], { cursorLine: 2, direction: 1 });
  host.render(second, computeSectionMapPlacement(wideHost()));
  const after = byAttr(doc.body, "data-bob-section-map", "row");
  assert.equal(after.length, 3);
  for (const row of after) {
    const key = row.attributes["data-bob-section-map-key"];
    const match = before.find((candidate) => candidate.attributes["data-bob-section-map-key"] === key);
    assert.ok(match, `reused node for ${key}`);
    assert.equal(match, row, `same node for ${key}`);
  }

  // A removed heading's node leaves the tree.
  const third = buildSectionMapModel(["# A", "# C"], { cursorLine: 2, direction: 1 });
  host.render(third, computeSectionMapPlacement(wideHost()));
  assert.equal(byAttr(doc.body, "data-bob-section-map", "row").length, 2);
  host.destroy();
});

test("pill slides between painted rows and crossfades on wrap or unpainted rows", () => {
  const doc = makeDoc();
  const host = createSectionMapHost(doc);
  const placement = computeSectionMapPlacement(wideHost());
  const first = host.render(jumpModel(), placement);
  assert.equal(first.lastTransition, "enter");
  const card = byAttr(doc.body, "data-bob-section-map", "card")[0];
  const pill = byAttr(doc.body, "data-bob-section-map", "pill")[0];
  assert.equal(pill.attributes["data-bob-section-map-line"], "sm:2");

  const second = host.render(
    buildSectionMapModel(["# Alpha", "body", "## Beta", "details", "# Gamma"], {
      cursorLine: 4,
      fromLine: 3,
      direction: 1,
    }),
    placement,
  );
  assert.equal(second.lastTransition, "slide");
  assert.ok(card.classes.includes("is-slide"));
  assert.equal(pill.attributes["data-bob-section-map-line"], "sm:4");
  assert.equal(pill.style.transform, "translateY(48px)");

  // A wrap replaces the slide with a crossfade.
  const wrapped = host.render(
    buildSectionMapModel(["# Alpha", "body", "## Beta", "details", "# Gamma"], {
      cursorLine: 0,
      fromLine: 4,
      direction: 1,
      wrapped: true,
    }),
    placement,
  );
  assert.equal(wrapped.lastTransition, "crossfade");
  assert.ok(card.classes.includes("is-crossfade"));
  assert.ok(!card.classes.includes("is-slide"));
  assert.match(
    flattenText(byAttr(doc.body, "data-bob-section-map", "wrap")[0]),
    /↻ wrapped/,
  );

  // The entrance class plays once: updates never replay it.
  assert.ok(!card.classes.includes("is-entering"));
  host.destroy();
});

test("compact strip reads as one line with chips, rail, and counter", () => {
  const doc = makeDoc();
  const host = createSectionMapHost(doc);
  const placement = computeSectionMapPlacement({
    host: rect(0, 0, 400, 600),
    scroller: rect(0, 0, 400, 600),
    textColumn: null,
    notices: [],
  });
  assert.equal(placement.mode, "compact");
  host.render(jumpModel(), placement);
  const card = byAttr(doc.body, "data-bob-section-map", "card")[0];
  assert.ok(card.classes.includes("is-compact"));
  assert.ok(byAttr(doc.body, "data-bob-section-map", "rows")[0].classes.includes("is-hidden"));
  assert.ok(byAttr(card, "data-bob-section-map", "header")[0].classes.includes("is-hidden"));
  const strip = byAttr(doc.body, "data-bob-section-map", "compact")[0];
  assert.equal(strip.attributes["aria-hidden"], "true");
  const text = flattenText(strip);
  assert.match(text, /⌃K/);
  assert.match(text, /┃/);
  assert.match(text, /Beta/);
  assert.match(text, /2 \/ 3/);
  assert.match(text, /⌃J/);
  host.destroy();
});

test("only-section state, hostile labels, and malformed models", () => {
  const doc = makeDoc();
  const host = createSectionMapHost(doc);
  const placement = computeSectionMapPlacement(wideHost());

  const single = buildSectionMapModel(["body", "# Only"], { cursorLine: 1, wrapped: true });
  host.render(single, placement);
  assert.match(
    flattenText(byAttr(doc.body, "data-bob-section-map", "wrap")[0]),
    /only section/,
  );
  assert.equal(byAttr(doc.body, "data-bob-section-map", "chip").length, 0);

  // Hostile labels stay inert text: the painter only ever sets text, so no
  // markup is parsed and no handler attribute can appear.
  const evil = jumpModel();
  evil.rows.find((row) => row.type === "heading").label = "<img src=x onerror=alert(1)>";
  host.render(evil, placement);
  const evilLabels = byAttr(doc.body, "data-bob-section-map", "label").map(flattenText);
  assert.ok(evilLabels.some((label) => label.includes("<img src=x onerror=alert(1)>")));
  for (const node of descendants(doc.body)) {
    for (const key of Object.keys(node.attributes || {})) {
      assert.ok(!/^on/i.test(key), `handler attribute ${key}`);
    }
  }

  // Malformed models hide the card instead of throwing.
  assert.doesNotThrow(() => host.render(null, placement));
  assert.doesNotThrow(() => host.render({ rows: "nope" }, placement));
  assert.doesNotThrow(() => host.render({ rows: [{ type: "wat", key: 1 }] }, placement));
  assert.doesNotThrow(() => host.render({ rows: [{ type: "heading" }] }, placement));
  assert.doesNotThrow(() => host.render(jumpModel(), null));
  assert.doesNotThrow(() => renderSectionMapCardSmoke());
  function renderSectionMapCardSmoke() {
    const smoke = createSectionMapHost(makeDoc());
    smoke.render(undefined, undefined);
    smoke.hide();
    smoke.destroy();
    smoke.render(jumpModel(), placement);
  }
  host.destroy();
  assert.equal(doc.body.children.length, 0);
});

test("reduced motion marks the host and a second agent stays passive and idempotent", () => {
  const doc = makeDoc({ reducedMotion: true });
  const host = createSectionMapHost(doc);
  host.render(jumpModel(), computeSectionMapPlacement(wideHost()));
  const root = byAttr(doc.body, "data-bob-section-map", "host")[0];
  assert.ok(root.classes.includes("is-reduced"));
  assert.equal(doc.body.children.length, 1);
  host.render(jumpModel(), computeSectionMapPlacement(wideHost()));
  assert.equal(doc.body.children.length, 1);
  host.hide();
  assert.ok(root.classes.includes("is-hidden"));
  host.render(jumpModel(), computeSectionMapPlacement(wideHost()));
  assert.ok(!root.classes.includes("is-hidden"));
  assert.ok(byAttr(doc.body, "data-bob-section-map", "card")[0].classes.includes("is-entering"));
  host.destroy();
});
