const assert = require("node:assert/strict");
const test = require("node:test");
const { LedgerToolsPlugin } = require("./ledger-tools-harness.cjs");

const helpers = LedgerToolsPlugin.helpers;
const fixtures = require("../plugins/bob-ledger-tools/scripts/fixtures/stats/day-strip-fixtures.cjs");

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
  const expected = helpers.statsPanelHomeAreaRows(helpers.statsPanelHomeRows(worked, fixture.report, "area", point), fixture.report);
  assert.deepEqual(model.mix.segments.map((segment) => segment.key), expected.map((row) => row.key));
  assert.deepEqual(model.mix.segments.map((segment) => segment.hue), expected.map((row) => row.hue));
  assert.ok(model.mix.segments.slice(-1)[0].key.startsWith("@"));
  assert.equal(model.mix.segments.at(-1).hue, "gray");
  assert.equal(model.mix.legend.length, 3);
  assert.equal(model.mix.overflow.length, 5);
  assert.match(model.mix.title, /^Time by area\n/);
  assert.equal(byClass(paint(model).root, "bob-day-strip-overflow")[0].textContent, "+5");
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
  assert.match(model.ariaLabel, /Time by area: gtd/);
});

test("skeleton carries placeholder text per fact and the same tag and class sequence", () => {
  const ready = modelFor(fixtures.today);
  const skeleton = helpers.dayStripModel(null, fixtures.today.day, { localToday: fixtures.today.localToday });
  assert.deepEqual(
    skeleton.facts.map((fact) => [fact.id, fact.display]),
    [["worked", "0h 00m"], ["reviewed", "00"], ["done", "00"], ["created", "00"], ["review_closed", "not yet"]],
  );
  const normalize = (classes) => (classes || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((name) => name === "bob-day-strip-state-ready" || name === "bob-day-strip-state-skeleton" ? "bob-day-strip-state-STATE" : name)
    .filter((name) => name !== "bob-day-strip-provisional" && name !== "bob-day-strip-stale" && !name.endsWith("-skeleton") && !name.startsWith("bob-day-strip-hue-"))
    .join(" ");
  const shape = (root) => findAll(root, () => true).map((node) => node.tagName + "|" + normalize(node.getAttribute("class")));
  assert.deepEqual(shape(paint(skeleton).root), shape(paint(ready).root));
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
