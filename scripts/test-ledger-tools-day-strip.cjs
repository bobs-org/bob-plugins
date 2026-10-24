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

function treeShape(node) {
  return [node.tagName, node.children.map(treeShape)];
}

test("date words and day shifts use calendar integers, including leap day", () => {
  assert.equal(helpers.dayStripShiftDay("2028-03-01", -1), "2028-02-29");
  assert.equal(helpers.dayStripShiftDay("2028-02-29", 1), "2028-03-01");
  assert.equal(helpers.dayStripDateWords("2028-02-29").month, "February");
  assert.equal(helpers.dayStripDateParts("2028-02-30"), null);
});

test("tile displays are selected from the exact day point, even with null headline and grouped input", () => {
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
    for (const tile of result.tiles) {
      const metric = report.metrics.find((item) => item.id === tile.id);
      const point = helpers.statsChartDailyPoints(metric, report).find((item) => item.date === day);
      assert.ok(point, `${tile.id} has a point for ${day}`);
      assert.equal(tile.display, point.display, `${tile.id} keeps bob's display for ${day}`);
    }
  }
});

test("honest states preserve future, skeleton, unavailable, missing, not-tracked, and stale information", () => {
  assert.equal(helpers.dayStripModel(null, "2026-10-24", { localToday: "2026-10-24" }).state, "skeleton");
  assert.equal(helpers.dayStripModel(null, "2026-10-25", { localToday: "2026-10-24" }).state, "future");
  assert.equal(helpers.dayStripModel(null, "2026-10-24", { localToday: "2026-10-24", error: { code: "bob-not-found" } }).state, "unavailable");
  assert.equal(helpers.dayStripModel(null, "invalid", { localToday: "2026-10-24" }).state, "hidden");

  const notTracked = modelFor(fixtures.notTracked);
  const reviewed = notTracked.tiles.find((tile) => tile.id === "reviewed");
  assert.equal(reviewed.quality, "not_tracked");
  assert.equal(reviewed.display, "–");
  assert.match(reviewed.tooltip, /Tracking since 2026-10-25/);

  const missing = modelFor(fixtures.missingWarning);
  const missingTile = missing.tiles.find((tile) => tile.id === "reviewed");
  assert.equal(missingTile.display, "–");
  assert.match(missingTile.warning, /journal has a gap/);
  assert.match(missingTile.warning, /journal_gap|review journal/);

  const stale = modelFor(fixtures.today, { stale: true, error: { code: "timeout", title: "bob stats timed out" } });
  assert.equal(stale.stale, true);
  assert.match(stale.staleTitle, /showing the 14:50 report/);
});

test("marks cover eight dates with the requested day last and provisional marks hollow", () => {
  const model = modelFor(fixtures.today);
  for (const tile of model.tiles) {
    assert.equal(tile.marks.length, 8);
    assert.equal(tile.marks.at(-1).date, fixtures.today.day);
    assert.equal(tile.marks.at(-1).isDay, true);
  }
  const worked = model.tiles.find((tile) => tile.id === "worked");
  const painted = paint(model).root;
  assert.ok(byClass(painted, "bob-day-strip-mark-provisional").length > 0);
  assert.ok(byClass(painted, "bob-day-strip-mark-day").length > 0);
  assert.equal(worked.marks.at(-1).provisional, true);
});

test("time mix reuses Stats area ordering and hues, with buckets last", () => {
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
  assert.equal(byClass(paint(model).root, "bob-day-strip-overflow")[0].textContent, "+5");
});

test("zero worked renders no Pomodoros and redefined worked omits its mix", () => {
  const empty = modelFor(fixtures.noPomodoros);
  assert.equal(empty.mix.empty, true);
  const emptyRoot = paint(empty).root;
  assert.equal(byClass(emptyRoot, "bob-day-strip-no-pomodoros")[0].textContent, "no Pomodoros");
  assert.ok(byClass(emptyRoot, "bob-day-strip-mix-empty").length);

  const redefined = modelFor(fixtures.redefinedWorked);
  assert.equal(redefined.mix.omitted, true);
  assert.equal(byClass(paint(redefined).root, "bob-day-strip-mix-action")[0].getAttribute("hidden"), "true");
});

test("aria label carries the date, values, provisional state, and area names", () => {
  const model = modelFor(fixtures.today);
  assert.match(model.ariaLabel, /^Day stats for Saturday, October 24, so far:/);
  assert.match(model.ariaLabel, /Worked/);
  assert.match(model.ariaLabel, /Time by area: gtd/);
});

test("painter repaints in place, renders fixed skeleton geometry, and shows unavailable controls", () => {
  const ready = modelFor(fixtures.explicitDay8);
  const skeleton = helpers.dayStripModel(null, fixtures.explicitDay8.day, { localToday: fixtures.explicitDay8.localToday });
  const { root, returned } = paint(ready);
  assert.equal(returned, root);
  const shape = treeShape(root);
  helpers.paintDayStrip(root, skeleton);
  assert.deepEqual(treeShape(root), shape);
  helpers.paintDayStrip(root, ready);
  assert.equal(root.getAttribute("data-day"), ready.day);

  const unavailable = helpers.dayStripModel(null, ready.day, { localToday: ready.day, error: { code: "bob-not-found" } });
  helpers.paintDayStrip(root, unavailable, { retry() {} });
  assert.match(root.textContent, /bob was not found/);
  assert.ok(byClass(root, "bob-day-strip-retry").length);
  assert.ok(byClass(root, "bob-day-strip-stats-link").length);
});

test("tiles, mix, and Stats actions preserve day, focus, and new-leaf modifiers", () => {
  const calls = [];
  const fixture = fixtures.today;
  const { root } = paint(modelFor(fixture), {
    openStats: (options) => calls.push(options),
    toggleCollapsed: () => calls.push({ toggle: true }),
  });
  const tile = byAttribute(root, "data-day-strip-metric", "worked")[0];
  tile.dispatch("click", { button: 0, ctrlKey: true });
  assert.deepEqual(calls.pop(), { day: fixture.day, metric: "worked", newLeaf: true });

  byClass(root, "bob-day-strip-mix-action")[0].dispatch("auxclick", { button: 1 });
  assert.deepEqual(calls.pop(), { day: fixture.day, metric: "worked", panel: "homes", newLeaf: true });

  byClass(root, "bob-day-strip-stats-link")[0].dispatch("click", { button: 0, metaKey: true });
  assert.deepEqual(calls.pop(), { day: fixture.day, newLeaf: true });

  const mark = byClass(tile, "bob-day-strip-mark")[0];
  mark.dispatch("click", { button: 0 });
  assert.equal(calls.length, 0, "a mark is a tooltip target and does not activate its tile");

  const mousedown = tile.dispatch("mousedown", { button: 0 });
  assert.equal(mousedown.defaultPrevented, true);
  const collapse = byClass(root, "bob-day-strip-collapse")[0];
  collapse.dispatch("keydown", { key: "Enter" });
  assert.deepEqual(calls.pop(), { toggle: true });
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
