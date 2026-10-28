const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
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

function fakeDocumentWithoutNs() {
  const doc = { createElement(tag) { return new FakeNode(tag, doc); } };
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

function byAttribute(root, name, value) {
  return findAll(root, (node) => node.getAttribute(name) === value);
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

test("date words and day shifts use calendar integers, including leap day", () => {
  assert.equal(helpers.dayStripShiftDay("2028-03-01", -1), "2028-02-29");
  assert.equal(helpers.dayStripShiftDay("2028-02-29", 1), "2028-03-01");
  assert.equal(helpers.dayStripDateWords("2028-02-29").month, "February");
  assert.equal(helpers.dayStripDateParts("2028-02-30"), null);
});

test("fact displays are selected from the exact day point, even with null headline and grouped input", () => {
  const leap = fixtures.createReport({ day: "2028-02-29", today: "2028-02-29", count: 8 });
  const cases = [
    [fixtures.today.report, fixtures.today.day],
    [fixtures.past.report, fixtures.past.day],
    [leap, "2028-02-29"],
    [fixtures.weekGrouped.report, fixtures.weekGrouped.day],
  ];
  for (const [report, day] of cases) {
    assert.equal(report.metrics.find((metric) => metric.id === "worked").summary.headline, null);
    const result = helpers.dayStripModel(report, day, { localToday: report.today, fetchedAt: "2026-10-24T14:50:00" });
    assert.equal(result.state, "ready");
    assert.deepEqual(result.facts.map((fact) => fact.id), ["worked", "reviewed", "done", "created", "review_closed"]);
    for (const fact of result.facts) {
      const metric = report.metrics.find((item) => item.id === fact.id);
      const point = helpers.statsChartDailyPoints(metric, report).find((item) => item.date === day);
      assert.ok(point, `${fact.id} has a point for ${day}`);
      assert.equal(fact.display, point.display, `${fact.id} keeps bob's display for ${day}`);
    }
  }
});

test("honest states carry meta text for today, past, stale today, and stale past", () => {
  assert.equal(helpers.dayStripModel(null, "2026-10-24", { localToday: "2026-10-24" }).state, "skeleton");
  assert.equal(helpers.dayStripModel(null, "2026-10-25", { localToday: "2026-10-24" }).state, "future");
  assert.equal(helpers.dayStripModel(null, "2026-10-24", { localToday: "2026-10-24", error: { code: "bob-not-found" } }).state, "unavailable");
  assert.equal(helpers.dayStripModel(null, "invalid", { localToday: "2026-10-24" }).state, "hidden");

  const notTracked = modelFor(fixtures.notTracked);
  const reviewed = notTracked.facts.find((fact) => fact.id === "reviewed");
  assert.equal(reviewed.quality, "not_tracked");
  assert.equal(reviewed.display, "–");
  assert.match(reviewed.tooltip, /Tracking since 2026-10-25/);

  const missing = modelFor(fixtures.missingWarning);
  const missingReviewed = missing.facts.find((fact) => fact.id === "reviewed");
  assert.equal(missingReviewed.display, "–");
  assert.match(missingReviewed.warning, /journal has a gap/);
  assert.match(missingReviewed.warning, /journal_gap|review journal/);

  const today = modelFor(fixtures.today);
  assert.equal(today.metaText, "so far · 14:50");
  const past = modelFor(fixtures.past);
  assert.equal(past.metaText, "");
  const staleToday = modelFor(fixtures.today, { stale: true, error: { code: "timeout", title: "bob stats timed out" } });
  assert.equal(staleToday.stale, true);
  assert.equal(staleToday.metaText, "so far · 14:50 · refresh failed");
  assert.match(staleToday.staleTitle, /showing the 14:50 report/);
  const stalePast = modelFor(fixtures.past, { stale: true, error: { code: "timeout", title: "bob stats timed out" } });
  assert.equal(stalePast.metaText, "refresh failed");
});

test("time mix reuses Stats area ordering and hues, with buckets last and a tooltip title", () => {
  const fixture = fixtures.manyAreas;
  const model = modelFor(fixture);
  const worked = fixture.report.metrics.find((metric) => metric.id === "worked");
  const point = helpers.statsChartDailyPoints(worked, fixture.report).find((item) => item.date === fixture.day);
  const expected = helpers.statsPanelHomeAreaRows(helpers.statsPanelHomeRows(worked, fixture.report, "root_parent", point), fixture.report);
  const hueMap = helpers.statsPanelDistinctHues(expected, fixture.report);
  assert.equal(model.mix.dimension, "root_parent");
  assert.deepEqual(model.mix.segments.map((segment) => segment.key), expected.map((row) => row.key));
  assert.deepEqual(model.mix.segments.map((segment) => segment.hue), expected.map((row) => hueMap.get(row.key)));
  assert.ok(model.mix.segments.slice(-1)[0].key.startsWith("@"));
  assert.equal(model.mix.segments.at(-1).hue, "gray");
  assert.equal(model.mix.legend.length, model.mix.segments.length);
  assert.deepEqual(
    model.mix.legend.map((entry) => entry.key),
    model.mix.segments.map((segment) => segment.key),
    "legend holds every segment in bar order",
  );
  assert.equal(model.mix.overflowDefault.count, model.mix.segments.length - 3);
  assert.equal(model.mix.overflow.length, model.mix.segments.length - 3);
  assert.match(model.mix.title, /^Time by root parent\n/);
  const painted = paint(model).root;
  const rootsRow = byClass(painted, "bob-day-strip-mix-row").find((node) => node.getAttribute("data-lane") === "roots")
    || byClass(painted, "bob-day-strip-mix-row")[0];
  const rootsLegend = byClass(rootsRow, "bob-day-strip-legend")[0];
  assert.equal(byClass(rootsLegend, "bob-day-strip-overflow")[0].textContent, `+${model.mix.segments.length - 3}`);
  assert.equal(byClass(rootsLegend, "bob-day-strip-legend-item").length, model.mix.segments.length);
  const visible = byClass(rootsLegend, "bob-day-strip-legend-item").filter((node) => !node.hasAttribute("hidden"));
  assert.equal(visible.length, 3, "static pre-fit shows ranks 1-3");
  assert.deepEqual(
    visible.map((node) => Number(node.getAttribute("data-rank"))).sort((a, b) => a - b),
    [1, 2, 3],
  );
});

test("root_parent is preferred with an honest area fallback", () => {
  const rootModel = modelFor(fixtures.today);
  assert.equal(rootModel.mix.dimension, "root_parent");
  assert.match(rootModel.mix.title, /^Time by root parent/);
  const areaModel = modelFor(fixtures.areaOnly);
  assert.equal(areaModel.mix.dimension, "area");
  assert.match(areaModel.mix.title, /^Time by area/);
  assert.match(areaModel.ariaLabel, /Time by area:/);
  assert.ok(areaModel.mix.segments.length > 0);
});

test("zero worked renders no Pomodoros and redefined worked omits its mix", () => {
  const empty = modelFor(fixtures.noPomodoros);
  assert.equal(empty.mix.empty, true);
  assert.equal(empty.mix.omitted, false);
  const emptyRoot = paint(empty).root;
  assert.equal(byClass(emptyRoot, "bob-day-strip-no-pomodoros")[0].textContent, "no Pomodoros");

  const redefined = modelFor(fixtures.redefinedWorked);
  assert.equal(redefined.mix.omitted, true);
  const redefinedRoot = paint(redefined).root;
  assert.equal(byClass(redefinedRoot, "bob-day-strip-mix").length, 0, "a redefined worked omits the mix link");
  assert.ok(byClass(redefinedRoot, "bob-day-strip-meta").length, "today keeps only the meta");
});

test("aria label carries the date, values, provisional state, and area names", () => {
  const model = modelFor(fixtures.today);
  assert.match(model.ariaLabel, /^Day stats for Saturday, October 24, so far:/);
  assert.match(model.ariaLabel, /Worked/);
  assert.match(model.ariaLabel, /Time by root parent: gtd/);
});

test("skeleton carries placeholder text per fact and the same tag and class sequence", () => {
  const ready = modelFor(fixtures.today);
  const skeleton = helpers.dayStripModel(null, fixtures.today.day, { localToday: fixtures.today.localToday });
  assert.deepEqual(
    skeleton.facts.map((fact) => [fact.id, fact.display]),
    [["worked", "0h 00m"], ["reviewed", "00"], ["done", "00"], ["created", "00"], ["review_closed", "not yet"]],
  );
  const skeletonRoot = paint(skeleton).root;
  const readyRoot = paint(ready).root;
  assert.equal(byClass(skeletonRoot, "bob-day-strip-legend-item").length, 6, "skeleton keeps three placeholders per lane");
  assert.equal(
    byClass(readyRoot, "bob-day-strip-legend-item").length,
    ready.mix.legend.length + (ready.themes && !ready.themes.omitted ? ready.themes.legend.length : 0),
    "ready paints one item per root and theme",
  );
  const normalize = (classes) => (classes || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((name) => name === "bob-day-strip-state-ready" || name === "bob-day-strip-state-skeleton" ? "bob-day-strip-state-STATE" : name)
    .map((name) => name === "bob-day-strip-bar-segment" ? "bob-day-strip-segment" : name)
    .map((name) => name === "bob-day-strip-mix-segment" ? "bob-day-strip-segment" : name)
    .filter((name) => name !== "bob-day-strip-provisional" && name !== "bob-day-strip-stale" && name !== "bob-day-strip-bar-bucket" && name !== "bob-day-strip-mix-bucket" && !name.endsWith("-skeleton") && !name.startsWith("bob-day-strip-hue-") && !name.startsWith("bob-day-strip-theme-hue-"))
    .join(" ");
  const legendPart = (classes) => (classes || "").split(/\s+/).some((name) =>
    name === "bob-day-strip-legend-item" || name === "bob-day-strip-legend-dot" ||
    name === "bob-day-strip-legend-swatch" ||
    name === "bob-day-strip-legend-label" || name === "bob-day-strip-legend-value");
  const markPart = (classes) => (classes || "").split(/\s+/).some((name) =>
    name === "bob-day-strip-mark" || name.startsWith("bob-day-strip-mark-"));
  const refPart = (classes) => (classes || "").split(/\s+/).some((name) =>
    name === "bob-day-strip-ref-word" || name === "bob-day-strip-ref-num" ||
    name === "bob-day-strip-ref-mark");
  const shape = (root) => findAll(root, () => true)
    .filter((node) => !legendPart(node.getAttribute("class")) && !markPart(node.getAttribute("class")) && !refPart(node.getAttribute("class")))
    .map((node) => node.tagName + "|" + normalize(node.getAttribute("class")));
  assert.deepEqual(shape(skeletonRoot), shape(readyRoot));
});

test("painter repaints in place, emits no buttons, and shows unavailable controls", () => {
  const ready = modelFor(fixtures.today);
  const skeleton = helpers.dayStripModel(null, fixtures.today.day, { localToday: fixtures.today.localToday });
  const { root, returned } = paint(ready);
  assert.equal(returned, root);
  assert.equal(findAll(root, (node) => node.tagName === "BUTTON").length, 0, "no <button> elements");
  helpers.paintDayStrip(root, skeleton);
  assert.equal(findAll(root, (node) => node.tagName === "BUTTON").length, 0);
  helpers.paintDayStrip(root, ready);
  assert.equal(root.getAttribute("data-day"), ready.day);
  assert.equal(root.getAttribute("role"), "group");

  const unavailable = helpers.dayStripModel(null, ready.day, { localToday: ready.day, error: { code: "bob-not-found" } });
  helpers.paintDayStrip(root, unavailable, { retry() {} });
  assert.match(root.textContent, /bob was not found/);
  assert.match(root.textContent, /Set stats\.bob_path/);
  assert.ok(byClass(root, "bob-day-strip-retry").length);
  assert.equal(findAll(root, (node) => node.tagName === "BUTTON").length, 0);
});

test("facts, mix, and Retry preserve day, focus, and new-leaf modifiers", () => {
  const calls = [];
  const fixture = fixtures.today;
  const { root } = paint(modelFor(fixture), {
    openStats: (options) => calls.push(options),
    retry: () => calls.push({ retry: true }),
  });
  const fact = byAttribute(root, "data-day-strip-metric", "worked")[0];
  assert.equal(fact.getAttribute("role"), "link");
  assert.equal(fact.getAttribute("tabindex"), "0");
  fact.dispatch("click", { button: 0, ctrlKey: true });
  assert.deepEqual(calls.pop(), { day: fixture.day, metric: "worked", newLeaf: true });

  byClass(root, "bob-day-strip-mix")[0].dispatch("auxclick", { button: 1 });
  assert.deepEqual(calls.pop(), { day: fixture.day, metric: "worked", panel: "homes", newLeaf: true });

  const keydownFact = byAttribute(root, "data-day-strip-metric", "done")[0];
  keydownFact.dispatch("keydown", { key: "Enter" });
  assert.deepEqual(calls.pop(), { day: fixture.day, metric: "done", newLeaf: false });
  keydownFact.dispatch("keydown", { key: " " });
  assert.deepEqual(calls.pop(), { day: fixture.day, metric: "done", newLeaf: false });

  const mousedown = fact.dispatch("mousedown", { button: 0 });
  assert.equal(mousedown.defaultPrevented, true);

  const unavailable = helpers.dayStripModel(null, fixture.day, { localToday: fixture.day, error: { code: "timeout", title: "boom" } });
  helpers.paintDayStrip(root, unavailable, {
    openStats: (options) => calls.push(options),
    retry: () => calls.push({ retry: true }),
  });
  byClass(root, "bob-day-strip-retry")[0].dispatch("click", { button: 0 });
  assert.deepEqual(calls.pop(), { retry: true });
});

test("future and hidden models paint no children", () => {
  for (const model of [
    helpers.dayStripModel(null, "2026-10-25", { localToday: "2026-10-24" }),
    helpers.dayStripModel(null, "no-date", { localToday: "2026-10-24" }),
  ]) {
    const { root } = paint(model);
    assert.equal(root.children.length, 0);
  }
});

test("strip paints facts, legend row, then full-width bar with no buttons", () => {
  const { root } = paint(modelFor(fixtures.today));
  const tags = findAll(root, () => true).map((node) => node.tagName);
  assert.ok(tags.length > 0);
  const facts = byClass(root, "bob-day-strip-facts");
  const mixRows = byClass(root, "bob-day-strip-mix-row");
  const bars = byClass(root, "bob-day-strip-bar");
  assert.equal(facts.length, 1, "one facts line");
  assert.equal(mixRows.length, 2, "roots legend and themes legend rows");
  assert.equal(bars.length, 2, "roots bar and themes bar");
  assert.equal(findAll(root, (node) => node.tagName === "BUTTON").length, 0, "no <button> elements");
  assert.equal(root.children[0], facts[0], "facts paint first");
  assert.equal(root.children[1], mixRows[0], "roots legend row paints second");
  assert.equal(root.children[2], bars[0], "roots bar paints third");
  assert.equal(root.children[3], mixRows[1], "themes legend row paints fourth");
  assert.equal(root.children[4], bars[1], "themes bar paints last, above the badges");
  assert.equal(mixRows[0].getAttribute("data-lane"), "roots");
  assert.equal(bars[0].getAttribute("data-lane"), "roots");
  assert.equal(mixRows[1].getAttribute("data-lane"), "themes");
  assert.equal(bars[1].getAttribute("data-lane"), "themes");
  assert.equal(bars[0].getAttribute("aria-hidden"), "true", "bar is hidden from assistive tech");
  assert.equal(bars[0].getAttribute("role"), null, "bar carries no link role");
  assert.equal(bars[0].getAttribute("tabindex"), null, "bar carries no keyboard stop");
  assert.equal(bars[1].getAttribute("aria-hidden"), "true");
  assert.equal(bars[1].getAttribute("tabindex"), null);
});

test("bar click opens Stats homes with day and new-leaf modifiers", () => {
  const calls = [];
  const fixture = fixtures.manyRoots;
  const { root } = paint(modelFor(fixture), {
    openStats: (options) => calls.push(options),
  });
  const bar = byClass(root, "bob-day-strip-bar")[0];
  assert.ok(bar, "bar renders with several roots");
  bar.dispatch("mousedown", { button: 0 });
  bar.dispatch("click", { button: 0, ctrlKey: true });
  assert.deepEqual(calls.pop(), { day: fixture.day, metric: "worked", panel: "homes", newLeaf: true });
  bar.dispatch("auxclick", { button: 1 });
  assert.deepEqual(calls.pop(), { day: fixture.day, metric: "worked", panel: "homes", newLeaf: true });
  const keydownBefore = calls.length;
  for (const node of findAll(bar, () => true)) {
    if (typeof node.dispatch === "function") node.dispatch("keydown", { key: "Enter" });
  }
  assert.equal(calls.length, keydownBefore, "bar has no keyboard activation");
});

test("same-area roots get distinct hues and legend dots match their segments", () => {
  const fixture = fixtures.sameHueRoots;
  const model = modelFor(fixture);
  const worked = fixture.report.metrics.find((metric) => metric.id === "worked");
  const point = helpers.statsChartDailyPoints(worked, fixture.report).find((item) => item.date === fixture.day);
  const expectedOrder = helpers.statsPanelHomeAreaRows(helpers.statsPanelHomeRows(worked, fixture.report, "root_parent", point), fixture.report);
  assert.deepEqual(model.mix.segments.map((segment) => segment.key), expectedOrder.map((row) => row.key), "order is unchanged");
  const byKey = new Map(model.mix.segments.map((segment) => [segment.key, segment.hue]));
  assert.equal(byKey.get("sase.md"), "blue");
  assert.equal(byKey.get("@daily"), "gray");
  assert.equal(byKey.get("bob.md"), "aqua");
  assert.equal(byKey.get("gtd.md"), "yellow");
  assert.equal(byKey.get("dev.md"), "magenta");
  assert.equal(byKey.get("@unlinked"), "gray");
  const nonGray = model.mix.segments.filter((segment) => segment.hue !== "gray");
  assert.equal(new Set(nonGray.map((segment) => segment.hue)).size, nonGray.length, "non-gray segments differ");
  const { root } = paint(model);
  const hueOf = (className) => {
    const match = /bob-day-strip-hue-([a-z]+)/.exec(String(className || ""));
    return match ? match[1] : null;
  };
  const rootsBar = byClass(root, "bob-day-strip-bar").find((node) => node.getAttribute("data-lane") === "roots") || byClass(root, "bob-day-strip-bar")[0];
  const barNodes = findAll(rootsBar, (node) => (node.getAttribute("class") || "").split(/\s+/).includes("bob-day-strip-bar-segment"))
    .filter((node) => !node.hasAttribute("hidden"));
  const barHues = barNodes.map((node) => hueOf(node.getAttribute("class")));
  const nonGrayBar = barHues.filter((hue) => hue !== "gray");
  assert.equal(new Set(nonGrayBar).size, nonGrayBar.length, "painter bar segments differ");
  const byTitle = new Map(barNodes.map((node) => [node.getAttribute("title"), hueOf(node.getAttribute("class"))]));
  const rootsRow = byClass(root, "bob-day-strip-mix-row").find((node) => node.getAttribute("data-lane") === "roots") || byClass(root, "bob-day-strip-mix-row")[0];
  const rootsLegend = byClass(rootsRow, "bob-day-strip-legend")[0];
  const legendItems = byClass(rootsLegend, "bob-day-strip-legend-item").filter((node) => !node.hasAttribute("hidden"));
  assert.ok(legendItems.length > 0);
  for (const item of legendItems) {
    const dot = findAll(item, (node) => (node.getAttribute("class") || "").split(/\s+/).includes("bob-day-strip-legend-dot"))[0];
    assert.ok(dot, "legend item has a dot");
    assert.equal(hueOf(dot.getAttribute("class")), byTitle.get(item.getAttribute("title")), "legend dot matches its segment");
  }
});

test("dayStripValueRuns splits numerals from units and keeps words whole", () => {
  const cases = [
    ["3h 05m", [{ kind: "num", text: "3" }, { kind: "unit", text: "h" }, { kind: "space", text: " " }, { kind: "num", text: "05" }, { kind: "unit", text: "m" }]],
    ["45m", [{ kind: "num", text: "45" }, { kind: "unit", text: "m" }]],
    ["0m", [{ kind: "num", text: "0" }, { kind: "unit", text: "m" }]],
    ["12", [{ kind: "num", text: "12" }]],
    ["+3", [{ kind: "num", text: "+3" }]],
    ["−5m", [{ kind: "num", text: "−5" }, { kind: "unit", text: "m" }]],
    ["75%", [{ kind: "num", text: "75" }, { kind: "unit", text: "%" }]],
    ["met", [{ kind: "word", text: "met" }]],
    ["missed", [{ kind: "word", text: "missed" }]],
    ["not yet", [{ kind: "word", text: "not yet" }]],
    ["–", [{ kind: "word", text: "–" }]],
    ["", [{ kind: "word", text: "" }]],
    ["3 h", [{ kind: "word", text: "3 h" }]],
  ];
  for (const [display, expected] of cases) {
    assert.deepEqual(helpers.dayStripValueRuns(display), expected, `${JSON.stringify(display)} splits`);
  }
  for (const [display] of cases) {
    const runs = helpers.dayStripValueRuns(display);
    assert.equal(runs.map((run) => run.text).join(""), display, `${JSON.stringify(display)} round-trips`);
  }
});

test("facts stack a label head over a faithful value with warnings in the head", () => {
  for (const fixture of Object.values(fixtures)) {
    if (!fixture || typeof fixture !== "object" || !fixture.report) continue;
    const model = modelFor(fixture);
    if (model.state === "skeleton" || model.state === "unavailable" || model.state === "future" || model.state === "hidden") continue;
    if (!Array.isArray(model.facts) || model.facts.length === 0) continue;
    const { root } = paint(model);
    const factNodes = byClass(root, "bob-day-strip-fact");
    assert.equal(factNodes.length, model.facts.length, `${fixture.name} paints every fact`);
    for (const [index, fact] of model.facts.entries()) {
      const node = byAttribute(root, "data-day-strip-metric", fact.id)[0];
      assert.ok(node, `${fixture.name} ${fact.id} has a fact node`);
      assert.equal(node.getAttribute("aria-label"), fact.ariaLabel, `${fixture.name} ${fact.id} keeps its aria-label`);
      const head = byClass(node, "bob-day-strip-head")[0];
      assert.ok(head, `${fixture.name} ${fact.id} has a head`);
      const value = byClass(node, "bob-day-strip-value")[0];
      assert.ok(value, `${fixture.name} ${fact.id} has a value`);
      const refNode = byClass(node, "bob-day-strip-ref")[0];
      assert.ok(refNode, `${fixture.name} ${fact.id} reserves a reference line`);
      assert.equal(node.children[0], head, `${fixture.name} ${fact.id} head paints first`);
      assert.equal(node.children[1], value, `${fixture.name} ${fact.id} value paints second`);
      assert.equal(node.children[2], refNode, `${fixture.name} ${fact.id} reference paints third`);
      assert.equal(value.textContent, fact.display, `${fixture.name} ${fact.id} keeps bob's display`);
      const warnings = byClass(value, "bob-day-strip-warning");
      assert.equal(warnings.length, 0, `${fixture.name} ${fact.id} value holds no warning`);
      const words = findAll(value, (child) => (child.getAttribute("class") || "").split(/\s+/).includes("bob-day-strip-word"));
      if (fact.mark) {
        assert.ok((value.getAttribute("class") || "").split(/\s+/).includes("bob-day-strip-value-mark"), `${fixture.name} ${fact.id} paints a mark value`);
        assert.ok(!(value.getAttribute("class") || "").split(/\s+/).includes("bob-day-strip-value-word"), `${fixture.name} ${fact.id} mark is not a word`);
      } else if (fact.display === "–") {
        assert.ok((value.getAttribute("class") || "").split(/\s+/).includes("bob-day-strip-value-empty"), `${fixture.name} ${fact.id} marks empty`);
        assert.ok(!(value.getAttribute("class") || "").split(/\s+/).includes("bob-day-strip-value-word"), `${fixture.name} ${fact.id} empty is not a word`);
      } else {
        const runs = helpers.dayStripValueRuns(fact.display);
        const isWord = runs.length === 1 && runs[0].kind === "word";
        assert.equal((value.getAttribute("class") || "").split(/\s+/).includes("bob-day-strip-value-word"), isWord, `${fixture.name} ${fact.id} word class follows its runs`);
      }
      void index;
      void words;
    }
    const valueWarnings = factNodes.flatMap((node) => byClass(byClass(node, "bob-day-strip-value")[0] || node, "bob-day-strip-warning"));
    assert.equal(valueWarnings.length, 0, `${fixture.name} never warns inside a value`);
  }
});

test("short_label paints GTD with a full-label tooltip", () => {
  const model = modelFor(fixtures.screenshotDay);
  const entry = model.mix.legend.find((item) => item.key === "@review:GTD");
  assert.ok(entry, "review bucket is in the legend");
  assert.equal(entry.legendLabel, "GTD");
  assert.equal(entry.label, "GTD review");
  const { root } = paint(model);
  const item = byAttribute(root, "data-key", "@review:GTD")[0];
  assert.ok(item, "review legend item paints");
  const label = byClass(item, "bob-day-strip-legend-label")[0];
  assert.equal(label.textContent, "GTD");
  assert.equal(item.getAttribute("title"), "GTD review 45m");
});

test("daily root paints its label in gray after real roots", () => {
  const fixture = fixtures.sameHueRoots;
  const model = modelFor(fixture);
  const entry = model.mix.legend.find((item) => item.key === "@daily");
  assert.ok(entry, "daily root is in the legend");
  assert.equal(entry.legendLabel, "GTD");
  assert.equal(entry.label, "GTD");
  const realRoots = model.mix.legend.filter((item) => {
    const home = fixture.report.homes[item.key];
    return home && home.kind !== "bucket";
  });
  const lastRealRoot = Math.max(...realRoots.map((item) => model.mix.legend.indexOf(item)));
  assert.ok(model.mix.legend.indexOf(entry) > lastRealRoot, "buckets follow real roots");
  assert.equal(entry.hue, "gray");
  const { root } = paint(model);
  const item = byAttribute(root, "data-key", "@daily")[0];
  assert.ok(item, "daily root legend item paints");
  assert.equal(byClass(item, "bob-day-strip-legend-label")[0].textContent, "GTD");
  const dot = byClass(item, "bob-day-strip-legend-dot")[0];
  assert.ok(dot, "daily root has a legend dot");
  assert.match(dot.getAttribute("class"), /bob-day-strip-hue-gray/);
});

test("area roots paint the bare label with a project_label tooltip", () => {
  const model = modelFor(fixtures.today);
  const entry = model.mix.legend.find((item) => item.key === "gtd.md");
  assert.ok(entry, "gtd area root is in the legend");
  assert.equal(entry.legendLabel, "gtd");
  assert.match(entry.label, /gtd · area tasks/);
  const { root } = paint(model);
  const item = byAttribute(root, "data-key", "gtd.md")[0];
  assert.ok(item, "gtd legend item paints");
  assert.equal(byClass(item, "bob-day-strip-legend-label")[0].textContent, "gtd");
  assert.match(item.getAttribute("title"), /gtd · area tasks/);
});

test("case-insensitive legend collisions fall back to full labels", () => {
  const model = modelFor(fixtures.sameHueRoots);
  const byKey = new Map(model.mix.legend.map((entry) => [entry.key, entry]));
  assert.equal(byKey.get("@review:GTD").legendLabel, "GTD review");
  assert.equal(byKey.get("gtd.md").legendLabel, "gtd · area tasks");
  assert.equal(byKey.get("@daily").legendLabel, "GTD");
  const { root } = paint(model);
  assert.equal(byClass(byAttribute(root, "data-key", "@review:GTD")[0], "bob-day-strip-legend-label")[0].textContent, "GTD review");
  assert.equal(byClass(byAttribute(root, "data-key", "gtd.md")[0], "bob-day-strip-legend-label")[0].textContent, "gtd · area tasks");
  assert.equal(byClass(byAttribute(root, "data-key", "@daily")[0], "bob-day-strip-legend-label")[0].textContent, "GTD");
});

test("dayStripLegendFit fits every root, reserves the counter, and handles empty", () => {
  assert.deepEqual(
    helpers.dayStripLegendFit({ full: [40, 50, 60], gap: 8, counter: 30, available: 500 }),
    { count: 3, mode: "values" },
  );
  const partial = helpers.dayStripLegendFit({ full: [100, 100, 100, 100], gap: 10, counter: 30, available: 250 });
  assert.equal(partial.count, 2, "partial fit reserves room for the counter");
  assert.equal(partial.mode, "values");
  assert.deepEqual(
    helpers.dayStripLegendFit({ full: [100, 100], gap: 10, counter: 30, available: 10 }),
    { count: 0, mode: "values" },
  );
});

test("names mode wins only when it names strictly more roots", () => {
  const valuesOnly = helpers.dayStripLegendFit({
    full: [100, 100, 100],
    names: [60, 60, 60],
    gap: 10,
    counter: 30,
    available: 200,
  });
  assert.equal(valuesOnly.mode, "names");
  assert.ok(valuesOnly.count > 1);
  const tie = helpers.dayStripLegendFit({
    full: [80, 80],
    names: [80, 80],
    gap: 10,
    counter: 30,
    available: 170,
  });
  assert.equal(tie.mode, "values", "equal counts stay in values mode");
});

test("DOM glue hides overflow, writes the counter, and toggles names mode", () => {
  const model = modelFor(fixtures.manyRoots);
  const { root } = paint(model);
  const legend = byClass(root, "bob-day-strip-legend")[0];
  const items = byClass(legend, "bob-day-strip-legend-item");
  const counter = byClass(legend, "bob-day-strip-overflow")[0];
  assert.ok(legend && items.length > 3 && counter, "manyRoots paints a fittable legend");
  legend.clientWidth = 300;
  const widths = new Map(items.map((item, index) => [item, 40 + index * 5]));
  for (const item of items) {
    const width = widths.get(item);
    item.getBoundingClientRect = () => ({ width, height: 16, top: 0, left: 0, right: width, bottom: 16 });
  }
  counter.getBoundingClientRect = () => ({ width: 30, height: 16, top: 0, left: 0, right: 30, bottom: 16 });
  const view = { getComputedStyle: () => ({ columnGap: "8px" }) };
  root.ownerDocument.defaultView = view;
  legend.ownerDocument = root.ownerDocument;
  for (const item of items) item.ownerDocument = root.ownerDocument;
  counter.ownerDocument = root.ownerDocument;
  const result = helpers.dayStripFitLegend(root);
  assert.ok(result, "fit runs with layout");
  assert.ok(result.count < items.length, "narrow legend hides some roots");
  assert.equal(counter.textContent, `+${items.length - result.count}`);
  const title = counter.getAttribute("title") || "";
  assert.equal(title.split("\n").filter(Boolean).length, items.length - result.count);
  const hidden = items.filter((item) => item.hasAttribute("hidden"));
  assert.equal(hidden.length, items.length - result.count);
  if (result.mode === "names") {
    assert.ok((legend.getAttribute("class") || "").split(/\s+/).includes("bob-day-strip-legend-names"));
  } else {
    assert.ok(!(legend.getAttribute("class") || "").split(/\s+/).includes("bob-day-strip-legend-names"));
  }
});

function classList(node) {
  return (node && node.getAttribute("class") || "").split(/\s+/).filter(Boolean);
}

function markPartNames(svg) {
  return (svg.children || []).map((child) => {
    const names = classList(child);
    if (names.includes("bob-day-strip-mark-disc")) return "disc";
    if (names.includes("bob-day-strip-mark-rim")) return "rim";
    if (names.includes("bob-day-strip-mark-ring")) return "ring";
    if (names.includes("bob-day-strip-mark-glyph")) return "glyph";
    if (names.includes("bob-day-strip-mark-half")) return "half";
    return names.join(" ");
  });
}

function closedModel(model, mark, extra = {}) {
  const display = mark === "met" ? "met" : mark === "missed" ? "missed" : "not yet";
  return {
    ...model,
    state: extra.state || "ready",
    stale: extra.stale === true,
    day: extra.day || model.day,
    facts: (model.facts || []).map((fact) => fact.id === "review_closed"
      ? { ...fact, mark, display, provisional: mark === "pending" }
      : fact),
  };
}

function arriveClass(root) {
  const fact = byAttribute(root, "data-day-strip-metric", "review_closed")[0];
  const value = fact ? byClass(fact, "bob-day-strip-value")[0] : null;
  return classList(value).includes("bob-day-strip-mark-arrive");
}

test("dayStripMarkState maps bool points from the bob point, never the word", () => {
  const cases = [
    ["met", "bool", { value: 1, quality: "ok" }, "met"],
    ["missed on a complete day", "bool", { value: 0, quality: "ok" }, "missed"],
    ["pending provisional zero", "bool", { value: 0, quality: "ok", provisional: true }, "pending"],
    ["provisional met", "bool", { value: 1, quality: "ok", provisional: true }, "met"],
    ["null value", "bool", { value: null, quality: "ok" }, null],
    ["missing", "bool", { value: 0, quality: "missing" }, null],
    ["not_tracked", "bool", { value: 0, quality: "not_tracked" }, null],
    ["count unit", "count", { value: 1, quality: "ok" }, null],
    ["absent point", "bool", null, null],
  ];
  for (const [name, unit, point, expected] of cases) {
    assert.equal(helpers.dayStripMarkState(unit, point), expected, name);
  }
  const today = modelFor(fixtures.today).facts.find((fact) => fact.id === "review_closed");
  assert.equal(today.mark, "pending");
  const past = modelFor(fixtures.past).facts.find((fact) => fact.id === "review_closed");
  assert.equal(past.mark, "missed");
});

test("boolean facts paint an aria-hidden mark with hidden display text", () => {
  const expected = {
    pending: ["disc", "ring", "half"],
    missed: ["disc", "rim", "glyph"],
    met: ["disc", "rim", "glyph"],
  };
  const today = modelFor(fixtures.today);
  const cases = [
    ["pending", today],
    ["missed", modelFor(fixtures.past)],
    ["met", closedModel(today, "met")],
  ];
  for (const [state, model] of cases) {
    const { root } = paint(model);
    const fact = byAttribute(root, "data-day-strip-metric", "review_closed")[0];
    const value = byClass(fact, "bob-day-strip-value")[0];
    assert.equal(value.getAttribute("data-mark"), state, `${state} data-mark`);
    assert.ok(classList(value).includes("bob-day-strip-value-mark"), `${state} mark class`);
    assert.ok(!classList(value).includes("bob-day-strip-value-word"), `${state} is not a word`);
    const svgs = byClass(value, "bob-day-strip-mark");
    assert.equal(svgs.length, 1, `${state} paints one svg`);
    assert.equal(svgs[0].tagName, "SVG");
    assert.equal(svgs[0].getAttribute("aria-hidden"), "true");
    assert.equal(svgs[0].getAttribute("focusable"), "false");
    assert.deepEqual(markPartNames(svgs[0]), expected[state], `${state} parts`);
    const modelFact = model.facts.find((item) => item.id === "review_closed");
    assert.equal(value.textContent, modelFact.display, `${state} keeps bob's display`);
    assert.equal(fact.getAttribute("aria-label"), modelFact.ariaLabel);
  }
});

test("docs without createElementNS keep word runs", () => {
  const doc = fakeDocumentWithoutNs();
  const root = new FakeNode("div", doc);
  helpers.paintDayStrip(root, modelFor(fixtures.today));
  const fact = byAttribute(root, "data-day-strip-metric", "review_closed")[0];
  const value = byClass(fact, "bob-day-strip-value")[0];
  assert.ok(classList(value).includes("bob-day-strip-value-word"));
  assert.ok(!classList(value).includes("bob-day-strip-value-mark"));
  assert.equal(byClass(value, "bob-day-strip-mark").length, 0);
  assert.equal(value.textContent, "not yet");
  assert.equal(byClass(value, "bob-day-strip-word")[0].textContent, "not yet");
});

test("bool skeleton paints a round placeholder and no svg", () => {
  const skeleton = helpers.dayStripModel(null, fixtures.today.day, { localToday: fixtures.today.localToday });
  const closed = skeleton.facts.find((fact) => fact.id === "review_closed");
  assert.equal(closed.mark, null);
  assert.equal(closed.unit, "bool");
  const { root } = paint(skeleton);
  const fact = byAttribute(root, "data-day-strip-metric", "review_closed")[0];
  const value = byClass(fact, "bob-day-strip-value")[0];
  assert.ok(classList(value).includes("bob-day-strip-value-mark"));
  assert.ok(classList(value).includes("bob-day-strip-value-skeleton"));
  assert.equal(byClass(value, "bob-day-strip-mark-skeleton").length, 1);
  assert.equal(byClass(value, "bob-day-strip-mark").length, 0);
  assert.equal(findAll(value, (node) => node.tagName === "SVG").length, 0);
});

test("pending mark tooltip drops so far; numeric provisional keeps it", () => {
  const today = modelFor(fixtures.today);
  const closed = today.facts.find((fact) => fact.id === "review_closed");
  assert.equal(closed.mark, "pending");
  assert.match(closed.tooltip, /Sat Oct 24: not yet/);
  assert.doesNotMatch(closed.tooltip, /not yet so far/);
  const worked = today.facts.find((fact) => fact.id === "worked");
  assert.equal(worked.mark, null);
  assert.match(worked.tooltip, / so far/);
});

test("pending to met on the same host and day draws the check once", () => {
  const pending = closedModel(modelFor(fixtures.today), "pending");
  const { root } = paint(pending);
  assert.equal(arriveClass(root), false, "first pending paint does not arrive");
  helpers.paintDayStrip(root, closedModel(pending, "met"));
  assert.equal(arriveClass(root), true, "pending then met arrives");
  helpers.paintDayStrip(root, closedModel(pending, "met"));
  assert.equal(arriveClass(root), false, "met then met does not arrive");
});

test("arrive class stays off for other mark transitions", () => {
  const pending = closedModel(modelFor(fixtures.today), "pending");
  const { root } = paint(pending);
  helpers.paintDayStrip(root, closedModel(pending, "met", { day: "2026-10-21" }));
  assert.equal(arriveClass(root), false, "pending then met on another day");

  const skeleton = helpers.dayStripModel(null, fixtures.today.day, { localToday: fixtures.today.localToday });
  const fresh = new FakeNode("div", fakeDocument());
  helpers.paintDayStrip(fresh, skeleton);
  helpers.paintDayStrip(fresh, closedModel(pending, "met"));
  assert.equal(arriveClass(fresh), false, "skeleton then met");

  const staleHost = new FakeNode("div", fakeDocument());
  helpers.paintDayStrip(staleHost, pending);
  helpers.paintDayStrip(staleHost, closedModel(pending, "met", { stale: true }));
  assert.equal(arriveClass(staleHost), false, "stale met frame");

  const missedHost = new FakeNode("div", fakeDocument());
  helpers.paintDayStrip(missedHost, pending);
  helpers.paintDayStrip(missedHost, closedModel(pending, "missed"));
  assert.equal(arriveClass(missedHost), false, "pending then missed");
});

test("stroke-dashoffset lives only inside keyframes", () => {
  const css = fs.readFileSync(path.join(__dirname, "../plugins/bob-ledger-tools/styles.css"), "utf8");
  const withoutKeyframes = css.replace(/@keyframes[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, "");
  assert.doesNotMatch(withoutKeyframes, /stroke-dashoffset/);
  assert.match(css, /@keyframes[\s\S]*stroke-dashoffset/);
});

function refNode(root, metricId) {
  const fact = byAttribute(root, "data-day-strip-metric", metricId)[0];
  return byClass(fact, "bob-day-strip-ref")[0];
}

test("dayStripRef classifies bob's typical without computing it", () => {
  const ready = {
    value: 205,
    typical: {
      display: "4h 10m",
      value: 250,
      relation: "below",
      words: "45m below the typical day of 4h 10m",
      detail: "Typical day 4h 10m.",
    },
  };
  assert.deepEqual(helpers.dayStripRef("minutes", ready), {
    state: "ready",
    mark: "below",
    display: "4h 10m",
    words: "45m below the typical day of 4h 10m",
    detail: "Typical day 4h 10m.",
  });
  assert.equal(helpers.dayStripRef("minutes", { ...ready, provisional: true }).mark, null);
  assert.equal(helpers.dayStripRef("minutes", { ...ready, typical: { ...ready.typical, value: null } }).state, "short");
  assert.equal(helpers.dayStripRef("minutes", { ...ready, typical: { ...ready.typical, value: null } }).mark, null);
  assert.equal(helpers.dayStripRef("bool", ready).state, "blank");
  assert.equal(helpers.dayStripRef("minutes", { value: 10 }).state, "blank");
  assert.equal(helpers.dayStripRef("minutes", { value: null, typical: ready.typical }).state, "blank");
  assert.equal(helpers.dayStripRef("count", { value: 9, typical: { display: "23", value: 23, relation: "below", words: "w", detail: "d" } }).mark, "below");
});

test("typical line covers every States-table row", () => {
  const past = modelFor(fixtures.past);
  const worked = past.facts.find((fact) => fact.id === "worked");
  const reviewed = past.facts.find((fact) => fact.id === "reviewed");
  const done = past.facts.find((fact) => fact.id === "done");
  const created = past.facts.find((fact) => fact.id === "created");
  const closed = past.facts.find((fact) => fact.id === "review_closed");
  assert.equal(worked.ref.state, "ready");
  assert.equal(worked.ref.mark, "below");
  assert.equal(worked.ref.display, "4h 10m");
  assert.match(worked.ariaLabel, /^Worked .+ so far, |^Worked .+, /);
  assert.ok(worked.ariaLabel.endsWith(worked.ref.words));
  assert.match(worked.tooltip, /Typical day 4h 10m/);
  assert.equal(reviewed.ref.mark, "above");
  assert.equal(done.ref.mark, "equal");
  assert.equal(created.ref.mark, "below");
  assert.equal(closed.ref.state, "blank");
  assert.equal(closed.ariaLabel, `${closed.label} ${closed.display}`);

  const today = modelFor(fixtures.today);
  const todayWorked = today.facts.find((fact) => fact.id === "worked");
  assert.equal(todayWorked.ref.state, "ready");
  assert.equal(todayWorked.ref.mark, null);
  assert.ok(todayWorked.ariaLabel.startsWith("Worked "));
  assert.match(todayWorked.ariaLabel, / so far, /);
  assert.ok(todayWorked.ariaLabel.endsWith(todayWorked.ref.words));

  const short = modelFor(fixtures.shortHistory);
  const shortWorked = short.facts.find((fact) => fact.id === "worked");
  assert.equal(shortWorked.ref.state, "short");
  assert.equal(shortWorked.ref.mark, null);
  assert.equal(shortWorked.ref.display, "–");
  assert.ok(shortWorked.ariaLabel.endsWith("no typical day yet"));

  const missing = modelFor(fixtures.missingWarning);
  const missingReviewed = missing.facts.find((fact) => fact.id === "reviewed");
  assert.equal(missingReviewed.display, "–");
  assert.equal(missingReviewed.ref.state, "blank");
  assert.equal(missingReviewed.ariaLabel, "Reviewed –");

  const old = modelFor(fixtures.oldBob);
  for (const fact of old.facts) {
    assert.equal(fact.ref.state, "blank", `${fact.id} is blank on old bob`);
  }

  const skeleton = helpers.dayStripModel(null, fixtures.today.day, { localToday: fixtures.today.localToday });
  for (const fact of skeleton.facts) {
    assert.equal(fact.ref.state, "blank");
    assert.equal(fact.ariaLabel, `${fact.label}, loading`);
  }

  const stale = modelFor(fixtures.today, { stale: true, error: { code: "timeout", title: "bob stats timed out" } });
  assert.equal(stale.stale, true);
  assert.equal(stale.facts.find((fact) => fact.id === "worked").ref.state, "ready");
});

test("typical line is aria-hidden, reserved, and never a tab stop", () => {
  const cases = [
    modelFor(fixtures.past),
    modelFor(fixtures.today),
    modelFor(fixtures.shortHistory),
    modelFor(fixtures.missingWarning),
    modelFor(fixtures.oldBob),
    helpers.dayStripModel(null, fixtures.today.day, { localToday: fixtures.today.localToday }),
    modelFor(fixtures.today, { stale: true }),
  ];
  for (const model of cases) {
    const { root } = paint(model);
    const facts = byClass(root, "bob-day-strip-fact");
    assert.equal(facts.length, model.facts.length);
    for (const fact of facts) {
      const refs = byClass(fact, "bob-day-strip-ref");
      assert.equal(refs.length, 1, "exactly one reference line");
      assert.equal(refs[0].getAttribute("aria-hidden"), "true");
      assert.equal(refs[0].getAttribute("role"), null);
      assert.equal(refs[0].getAttribute("tabindex"), null);
      assert.equal(fact.getAttribute("role"), "link");
      assert.equal(fact.getAttribute("tabindex"), "0");
      assert.equal(findAll(fact, (node) => node.tagName === "BUTTON").length, 0);
    }
  }

  const pastRoot = paint(modelFor(fixtures.past)).root;
  const below = refNode(pastRoot, "worked");
  assert.equal(below.getAttribute("data-ref-state"), "ready");
  assert.equal(below.getAttribute("data-ref-mark"), "below");
  assert.equal(byClass(below, "bob-day-strip-ref-word")[0].textContent, "typical");
  assert.equal(byClass(below, "bob-day-strip-ref-num")[0].textContent, "4h 10m");
  assert.equal(byClass(below, "bob-day-strip-ref-mark").length, 1);

  const equal = refNode(pastRoot, "done");
  assert.equal(equal.getAttribute("data-ref-mark"), "equal");

  const todayRoot = paint(modelFor(fixtures.today)).root;
  const todayRef = refNode(todayRoot, "worked");
  assert.equal(todayRef.getAttribute("data-ref-mark"), null);
  assert.equal(byClass(todayRef, "bob-day-strip-ref-mark").length, 0);
  assert.equal(byClass(todayRef, "bob-day-strip-ref-word")[0].textContent, "typical");

  const shortRoot = paint(modelFor(fixtures.shortHistory)).root;
  const shortRef = refNode(shortRoot, "worked");
  assert.equal(shortRef.getAttribute("data-ref-state"), "short");
  assert.equal(byClass(shortRef, "bob-day-strip-ref-mark").length, 0);
  assert.equal(byClass(shortRef, "bob-day-strip-ref-num")[0].textContent, "–");

  const missingRoot = paint(modelFor(fixtures.missingWarning)).root;
  const missingRef = refNode(missingRoot, "reviewed");
  assert.equal(missingRef.getAttribute("data-ref-state"), "blank");
  assert.equal(missingRef.textContent, "");

  const boolRef = refNode(pastRoot, "review_closed");
  assert.equal(boolRef.getAttribute("data-ref-state"), "blank");
  assert.equal(boolRef.textContent, "");

  const skeletonRoot = paint(helpers.dayStripModel(null, fixtures.today.day, { localToday: fixtures.today.localToday })).root;
  for (const fact of byClass(skeletonRoot, "bob-day-strip-fact")) {
    const ref = byClass(fact, "bob-day-strip-ref")[0];
    assert.equal(ref.getAttribute("data-ref-state"), "blank");
  }

  const oldRoot = paint(modelFor(fixtures.oldBob)).root;
  for (const fact of byClass(oldRoot, "bob-day-strip-fact")) {
    assert.equal(byClass(fact, "bob-day-strip-ref")[0].getAttribute("data-ref-state"), "blank");
  }
});
