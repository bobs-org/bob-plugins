const assert = require("node:assert/strict");
const test = require("node:test");
const { LedgerToolsPlugin } = require("./ledger-tools-harness.cjs");

const helpers = LedgerToolsPlugin.helpers;
const fixtures = require("../plugins/bob-ledger-tools/scripts/fixtures/stats/day-strip-fixtures.cjs");

function hideNodeFields(node, fields) {
  for (const field of fields) {
    Object.defineProperty(node, field, {
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
  assert.deepEqual(fields.filter((field) => Object.keys(node).includes(field)), []);
}

class FakeNode {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.children = [];
    this.attrs = new Map();
    this.listeners = new Map();
    this.style = {};
    this._text = "";
    hideNodeFields(this, ["ownerDocument", "parentNode"]);
  }

  // Hidden back-references bound assert diffs; this descriptor keeps inspect and reporter output short.
  [require("node:util").inspect.custom]() {
    const cls = this.getAttribute("class");
    const kids = Array.isArray(this.children) ? this.children.length : 0;
    const raw = typeof this._text === "string" ? this._text : "";
    const flat = raw.replace(/\s+/g, " ");
    const text = flat.length > 40 ? flat.slice(0, 40) + "…" : flat;
    const dot = cls ? "." + String(cls).split(/\s+/).filter(Boolean).join(".") : "";
    return `FakeNode(${this.tagName}${dot} children=${kids} text=${JSON.stringify(text)})`;
  }

  set textContent(value) {
    this._text = String(value);
    for (const child of this.children) child.parentNode = null;
    this.children = [];
  }

  get textContent() {
    return [this._text, ...this.children.map((child) => child.textContent)].filter(Boolean).join("");
  }

  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  removeAttribute(name) { this.attrs.delete(name); }
  hasAttribute(name) { return this.attrs.has(name); }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this._text = "";
    for (const child of children) this.appendChild(child);
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  dispatch(type, init = {}) {
    let prevented = false;
    let stopped = false;
    const event = {
      type,
      target: this,
      currentTarget: null,
      ...init,
      preventDefault() { prevented = true; },
      stopPropagation() { stopped = true; },
      get defaultPrevented() { return prevented; },
    };
    let node = this;
    while (node) {
      event.currentTarget = node;
      for (const handler of node.listeners.get(type) || []) handler(event);
      if (stopped) break;
      node = node.parentNode;
    }
    return event;
  }
}

function fakeDocument() {
  const doc = {
    createElement(tag) { return new FakeNode(tag, doc); },
    createElementNS(ns, tag) { return new FakeNode(tag, doc); },
  };
  return doc;
}

function findAll(root, predicate, result = []) {
  if (predicate(root)) result.push(root);
  for (const child of root.children) findAll(child, predicate, result);
  return result;
}

function byClass(root, name) {
  return findAll(root, (node) => (node.getAttribute("class") || "").split(/\s+/).includes(name));
}

function paint(model, handlers = {}) {
  const doc = fakeDocument();
  const root = new FakeNode("div", doc);
  return { root, returned: helpers.paintDayStrip(root, model, handlers) };
}

function modelFor(fixture, overrides = {}) {
  return helpers.dayStripModel(fixture.report, fixture.day, {
    localToday: fixture.localToday,
    fetchedAt: fixture.fetchedAt,
    ...overrides,
  });
}

function themeMix(fixture, overrides = {}) {
  const worked = fixture.report.metrics.find((metric) => metric.id === "worked");
  return helpers.dayStripThemeMix(fixture.report, worked, fixture.day, overrides);
}

function lane(root, name, kind) {
  const nodes = kind === "bar"
    ? byClass(root, "bob-day-strip-bar")
    : byClass(root, "bob-day-strip-mix-row");
  return nodes.find((node) => node.getAttribute("data-lane") === name) || null;
}

test("statsThemeRef prefers theme_hues names and hues, with gray fallbacks", () => {
  const report = fixtures.screenshotDay.report;
  const gtd = helpers.statsThemeRef(report, "GTD");
  assert.equal(gtd.label, "GTD");
  assert.equal(gtd.hue, "gray");
  assert.equal(gtd.gray, true);
  const sase = helpers.statsThemeRef(report, "SASE");
  assert.equal(sase.label, "SASE");
  assert.equal(sase.hue, "aqua");
  assert.equal(sase.gray, false);
  const unnamed = helpers.statsThemeRef(report, "(unnamed)", () => ({ hue: "blue", hue_source: "hash" }));
  assert.equal(unnamed.label, "(unnamed)");
  assert.equal(unnamed.gray, true);
  const other = helpers.statsThemeRef(report, "other", () => ({ hue: "red", hue_source: "hash" }));
  assert.equal(other.label, "other");
  assert.equal(other.gray, true);
  const missing = helpers.statsThemeRef({ theme_hues: {} }, "BOB");
  assert.equal(missing.gray, true);
  const fallback = helpers.statsThemeRef({ theme_hues: {} }, "BOB", () => ({ hue: "magenta", hue_source: "hash" }));
  assert.equal(fallback.hue, "magenta");
  assert.equal(fallback.gray, false);
  const mapWins = helpers.statsThemeRef(report, "BOB", () => ({ hue: "red", hue_source: "hash" }));
  assert.equal(mapWins.hue, "magenta");
  assert.equal(mapWins.gray, false);
});

test("theme mix orders coloured by minutes then gray, with unnamed last", () => {
  const mix = themeMix(fixtures.themeCollision);
  assert.equal(mix.omitted, false);
  assert.equal(mix.dimension, "theme");
  assert.deepEqual(mix.segments.map((segment) => segment.key), ["PYPI", "READ", "WRITE", "BLOG", "VIBE", "GTD"]);
  assert.deepEqual(mix.segments.map((segment) => segment.label), ["PYPI", "READ", "WRITE", "BLOG", "VIBE", "GTD"]);
  assert.deepEqual(mix.legend.map((entry) => entry.key), mix.segments.map((segment) => segment.key));
  assert.equal(mix.segments.at(-1).key, "GTD");
  assert.equal(mix.segments.at(-1).gray, true);
  assert.equal(mix.segments.at(-1).hue, "gray");
  const many = themeMix(fixtures.manyThemes);
  assert.deepEqual(many.segments.map((segment) => segment.key), [
    "GOLF", "FOXTROT", "ECHO", "DELTA", "CHARLIE", "BRAVO", "ALPHA", "(unnamed)",
  ]);
  assert.equal(many.segments.at(-1).key, "(unnamed)");
  assert.equal(many.segments.at(-1).gray, true);
});

test("same-hue coloured themes take shade 0 then 1 then 2; gray is never shaded", () => {
  const mix = themeMix(fixtures.themeCollision);
  const byKey = Object.fromEntries(mix.segments.map((segment) => [segment.key, segment]));
  assert.equal(byKey.PYPI.hue, "green");
  assert.equal(byKey.PYPI.shade, 0);
  assert.equal(byKey.READ.hue, "green");
  assert.equal(byKey.READ.shade, 1);
  assert.equal(byKey.WRITE.hue, "magenta");
  assert.equal(byKey.WRITE.shade, 0);
  assert.equal(byKey.BLOG.hue, "orange");
  assert.equal(byKey.BLOG.shade, 0);
  assert.equal(byKey.VIBE.hue, "orange");
  assert.equal(byKey.VIBE.shade, 1);
  assert.equal(byKey.GTD.gray, true);
  assert.equal(byKey.GTD.shade, 0);

  const fixture = JSON.parse(JSON.stringify(fixtures.themeCollision));
  const worked = fixture.report.metrics.find((metric) => metric.id === "worked");
  const point = helpers.statsChartDailyPoints(worked, fixture.report).find((item) => item.date === fixture.day);
  point.parts.theme.CODE = 10;
  point.parts_display.theme.CODE = "10m";
  fixture.report.theme_hues.code = { key: "code", name: "CODE", hue: "green", hue_source: "hash" };
  const shaded = helpers.dayStripThemeMix(fixture.report, worked, fixture.day, {});
  const third = Object.fromEntries(shaded.segments.map((segment) => [segment.key, segment]));
  assert.equal(third.PYPI.shade, 0);
  assert.equal(third.READ.shade, 1);
  assert.equal(third.CODE.shade, 2);
  assert.equal(third.GTD.shade, 0);
});

test("theme mix labels, ranks, overflow, titles, and aria follow the report", () => {
  const mix = themeMix(fixtures.screenshotDay);
  assert.deepEqual(mix.segments.map((segment) => segment.key), ["SASE", "BOB", "DECKS", "GTD"]);
  assert.equal(mix.overflowDefault.count, 1);
  assert.equal(mix.overflow.length, 1);
  assert.equal(mix.overflow[0].key, "DECKS");
  assert.match(mix.title, /^Time by type\n/);
  assert.match(mix.title, /Pomodoros with several types are split evenly between them\.$/);
  const noSplit = themeMix(fixtures.today);
  assert.equal(noSplit.title.includes("Pomodoros with several types"), false);
  const model = modelFor(fixtures.screenshotDay);
  assert.match(model.ariaLabel, /Time by type: SASE 40m, BOB 20m, DECKS 10m, GTD 45m\./);
  const hiddenStillShown = themeMix(fixtures.themeCollision);
  assert.ok(hiddenStillShown.segments.some((segment) => segment.key === "VIBE"), "hidden-from-Recent themes still appear");
});

test("theme lane is omitted for zero days, missing parts, and redefined worked", () => {
  assert.equal(themeMix(fixtures.noPomodoros).omitted, true);
  assert.equal(themeMix(fixtures.redefinedWorked).omitted, true);
  const empty = helpers.dayStripThemeEmpty();
  assert.equal(empty.omitted, true);
  assert.equal(empty.segments.length, 0);
  const missingDay = helpers.dayStripThemeMix(fixtures.today.report, fixtures.today.report.metrics.find((metric) => metric.id === "worked"), "1999-01-01", {});
  assert.equal(missingDay.omitted, true);
  const noMinutes = helpers.dayStripThemeMix(fixtures.today.report, { id: "worked", unit: "count", points: [] }, fixtures.today.day, {});
  assert.equal(noMinutes.omitted, true);
  const area = modelFor(fixtures.areaOnly);
  assert.equal(area.mix.dimension, "area");
  assert.equal(area.themes.omitted, false);
  assert.ok(area.themes.segments.length > 0, "an old bob without root_parent still paints the theme lane");
  const zeroRoot = paint(modelFor(fixtures.noPomodoros)).root;
  assert.equal(lane(zeroRoot, "themes", "row"), null);
  assert.equal(lane(zeroRoot, "themes", "bar"), null);
  assert.ok(lane(zeroRoot, "roots", "bar"), "zero day keeps the roots empty track");
});

test("fallback hue uses context.themeHueFor and stays gray without it", () => {
  const gray = themeMix(fixtures.noThemeHues);
  assert.equal(gray.omitted, false);
  assert.ok(gray.segments.every((segment) => segment.gray), "no theme_hues and no fallback stays gray");
  const coloured = themeMix(fixtures.noThemeHues, {
    themeHueFor: (key) => ({ hue: key === "BOB" ? "magenta" : "orange", hue_source: "hash" }),
  });
  const byKey = Object.fromEntries(coloured.segments.map((segment) => [segment.key, segment]));
  assert.equal(byKey.BOB.hue, "magenta");
  assert.equal(byKey.BOB.gray, false);
  assert.equal(byKey.DECKS.hue, "orange");
});

test("painter uses swatches, shades, data-lane, and no buttons on the theme lane", () => {
  const model = modelFor(fixtures.themeCollision);
  const { root } = paint(model);
  assert.equal(findAll(root, (node) => node.tagName === "BUTTON").length, 0);
  const themesRow = lane(root, "themes", "row");
  const themesBar = lane(root, "themes", "bar");
  assert.ok(themesRow && themesBar);
  assert.ok((themesRow.getAttribute("class") || "").split(/\s+/).includes("bob-day-strip-lane-themes"));
  assert.ok((themesBar.getAttribute("class") || "").split(/\s+/).includes("bob-day-strip-bar-themes"));
  const mix = byClass(themesRow, "bob-day-strip-mix")[0];
  assert.equal(mix.getAttribute("tabindex"), "0");
  assert.equal(mix.getAttribute("role"), "link");
  assert.equal(byClass(themesRow, "bob-day-strip-meta").length, 0, "themes legend has no meta");
  const items = byClass(themesRow, "bob-day-strip-legend-item");
  assert.ok(items.length > 0);
  for (const item of items) {
    assert.equal(byClass(item, "bob-day-strip-legend-dot").length, 0, "theme items never paint a home dot");
    assert.equal(byClass(item, "bob-day-strip-legend-swatch").length, 1);
  }
  const swatchOf = (key) => {
    const item = items.find((node) => node.getAttribute("data-key") === key);
    return byClass(item, "bob-day-strip-legend-swatch")[0];
  };
  assert.equal(swatchOf("READ").getAttribute("data-shade"), "1");
  assert.equal(swatchOf("VIBE").getAttribute("data-shade"), "1");
  assert.equal(swatchOf("PYPI").getAttribute("data-shade"), null);
  assert.equal(swatchOf("GTD").getAttribute("data-shade"), null);
  const segments = byClass(themesBar, "bob-day-strip-bar-segment").filter((node) => !node.hasAttribute("hidden"));
  const read = segments.find((node) => (node.getAttribute("title") || "").startsWith("READ "));
  assert.equal(read.getAttribute("data-shade"), "1");
  const gtd = segments.find((node) => (node.getAttribute("title") || "").startsWith("GTD "));
  assert.ok((gtd.getAttribute("class") || "").split(/\s+/).includes("bob-day-strip-bar-bucket"));
  assert.equal(gtd.getAttribute("data-shade"), null);
});

test("theme legend and bar open Stats on the Themes view", () => {
  const calls = [];
  const fixture = fixtures.screenshotDay;
  const { root } = paint(modelFor(fixture), {
    openStats: (options) => calls.push(options),
  });
  const mix = byClass(lane(root, "themes", "row"), "bob-day-strip-mix")[0];
  mix.dispatch("click", { button: 0 });
  assert.deepEqual(calls.pop(), { day: fixture.day, metric: "worked", panel: "themes", newLeaf: false });
  mix.dispatch("keydown", { key: "Enter" });
  assert.deepEqual(calls.pop(), { day: fixture.day, metric: "worked", panel: "themes", newLeaf: false });
  mix.dispatch("keydown", { key: " " });
  assert.deepEqual(calls.pop(), { day: fixture.day, metric: "worked", panel: "themes", newLeaf: false });
  mix.dispatch("click", { button: 0, ctrlKey: true });
  assert.deepEqual(calls.pop(), { day: fixture.day, metric: "worked", panel: "themes", newLeaf: true });
  mix.dispatch("click", { button: 0, metaKey: true });
  assert.deepEqual(calls.pop(), { day: fixture.day, metric: "worked", panel: "themes", newLeaf: true });
  mix.dispatch("auxclick", { button: 1 });
  assert.deepEqual(calls.pop(), { day: fixture.day, metric: "worked", panel: "themes", newLeaf: true });
  const bar = lane(root, "themes", "bar");
  bar.dispatch("click", { button: 0, ctrlKey: true });
  assert.deepEqual(calls.pop(), { day: fixture.day, metric: "worked", panel: "themes", newLeaf: true });
  bar.dispatch("auxclick", { button: 1 });
  assert.deepEqual(calls.pop(), { day: fixture.day, metric: "worked", panel: "themes", newLeaf: true });
  const before = calls.length;
  for (const node of findAll(bar, () => true)) {
    if (typeof node.dispatch === "function") node.dispatch("keydown", { key: "Enter" });
  }
  assert.equal(calls.length, before, "theme bar has no keyboard activation");
});

test("fitter fits both legends independently and returns the roots result", () => {
  const { root } = paint(modelFor(fixtures.manyThemes));
  const rootsLegend = byClass(lane(root, "roots", "row"), "bob-day-strip-legend")[0];
  const themesLegend = byClass(lane(root, "themes", "row"), "bob-day-strip-legend")[0];
  const view = { getComputedStyle: () => ({ columnGap: "8px" }) };
  root.ownerDocument.defaultView = view;
  const layout = (legend, itemWidth, available) => {
    legend.clientWidth = available;
    legend.ownerDocument = root.ownerDocument;
    const items = byClass(legend, "bob-day-strip-legend-item");
    const counter = byClass(legend, "bob-day-strip-overflow")[0];
    for (const item of items) {
      item.getBoundingClientRect = () => ({ width: itemWidth, height: 16, top: 0, left: 0, right: itemWidth, bottom: 16 });
      item.ownerDocument = root.ownerDocument;
    }
    counter.getBoundingClientRect = () => ({ width: 30, height: 16, top: 0, left: 0, right: 30, bottom: 16 });
    counter.ownerDocument = root.ownerDocument;
    return { items, counter };
  };
  const roots = layout(rootsLegend, 40, 400);
  const themes = layout(themesLegend, 80, 220);
  const result = helpers.dayStripFitLegend(root);
  assert.ok(result, "fit returns the roots legend result");
  assert.equal(result.count, roots.items.length, "wide roots legend shows every root");
  assert.ok(result.count !== themes.items.length || themes.items.length === roots.items.length);
  assert.ok(themes.counter.textContent.startsWith("+"));
  const hidden = themes.items.filter((item) => item.hasAttribute("hidden"));
  assert.ok(hidden.length > 0, "narrow themes legend hides overflow");
  const visible = themes.items.filter((item) => !item.hasAttribute("hidden")).length;
  assert.equal(themes.counter.textContent, `+${themes.items.length - visible}`);
  assert.equal(roots.items.filter((item) => item.hasAttribute("hidden")).length, 0);
});
