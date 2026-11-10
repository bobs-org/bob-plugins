const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { LedgerToolsPlugin } = require("./ledger-tools-harness.cjs");
const { periodPartsFixtures } = require("../plugins/bob-ledger-tools/scripts/fixtures/stats/period-parts-fixtures.cjs");

const helpers = LedgerToolsPlugin.helpers;
const fixtureDir = path.join(__dirname, "..", "plugins/bob-ledger-tools/scripts/fixtures/stats");
const week = JSON.parse(fs.readFileSync(path.join(fixtureDir, "period-strip-closed-week.json"), "utf8"));
const fixtures = periodPartsFixtures(week);

class FakeNode {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.attrs = new Map();
    this.style = {};
    this._text = "";
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return [this._text, ...this.children.map((child) => child.textContent)].filter(Boolean).join(""); }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
  addEventListener() {}
}

function fakeDocument() {
  return { createElement(tag) { return new FakeNode(tag, this); }, createElementNS(ns, tag) { return new FakeNode(tag, this); } };
}

function findAll(root, predicate, result = []) {
  if (predicate(root)) result.push(root);
  for (const child of root.children) findAll(child, predicate, result);
  return result;
}

function byClass(root, name) {
  return findAll(root, (node) => (node.getAttribute("class") || "").split(/\s+/).includes(name));
}

function paintParts(report, id) {
  const model = helpers.periodStripModel(report, id, { laneView: "both" });
  const doc = fakeDocument();
  const host = new FakeNode("div", doc);
  helpers.paintPeriodStripParts(doc, host, model, {});
  return { model, host };
}

function paintTable(report, id) {
  const model = helpers.periodStripModel(report, id, { laneView: "both" });
  const doc = fakeDocument();
  const host = new FakeNode("div", doc);
  helpers.paintPeriodPartsTable(host, model);
  return { model, host };
}

test("quarter parts render week columns, month ticks, review marks, and future ghosts", () => {
  const { model, host } = paintParts(fixtures.currentQuarter, "2026-Q4");
  assert.equal(model.state, "ready");
  assert.equal(model.columns.length, 14);
  assert.deepEqual(model.columns.filter((column) => column.tick).map((column) => column.tick), ["Oct", "Nov", "Dec", "Jan"]);
  assert.ok(model.columns.some((column) => column.mark === "reflected"));
  assert.ok(model.columns.some((column) => column.state === "future"));
  assert.equal(model.columns[0].caption, "40");
  assert.equal(model.columns[0].partial, "4/7");
  assert.equal(byClass(host, "bob-period-strip-column").length, 14);
  const ticks = byClass(host, "bob-period-strip-column-tick");
  assert.equal(ticks.length, 14, "every week keeps an aligned month-tick baseline");
  assert.deepEqual(ticks.map((node) => node.textContent).filter(Boolean), ["Oct", "Nov", "Dec", "Jan"]);
  assert.equal(byClass(host, "bob-period-strip-column-future").length, 3);
  assert.equal(byClass(host, "bob-period-strip-column-missing").length, 1);
});

test("year parts group 53 weeks by quarter and keep a four-quarter narrow fallback", () => {
  const { model, host } = paintParts(fixtures.year, "2026");
  assert.equal(model.columns.length, 53);
  assert.ok(model.columns.every((column) => column.caption === ""));
  assert.deepEqual(Array.from(new Set(model.columns.map((column) => column.group))), ["Q1", "Q2", "Q3", "Q4"]);
  assert.equal(model.quarterFallbackColumns.length, 4);
  assert.equal(byClass(host, "bob-period-strip-parts-detailed").length, 1);
  assert.equal(byClass(host, "bob-period-strip-parts-fallback").length, 1);
  assert.equal(byClass(host, "bob-period-strip-column").length, 57);
  assert.deepEqual(byClass(host, "bob-period-strip-group-caption").map((node) => node.textContent), ["Q1 · 412h 10m", "Q2 · 390h 00m", "Q3 · 401h 30m", "Q4 · 275h 05m"]);
});

test("all-time parts group quarters by year and keep year captions", () => {
  const { model, host } = paintParts(fixtures.all, "all");
  assert.equal(model.columns.length, 12);
  assert.equal(byClass(host, "bob-period-strip-column").length, 12);
  assert.deepEqual(byClass(host, "bob-period-strip-group-caption").map((node) => node.textContent), ["2024", "2025", "2026 · 1,204h 10m"]);
  assert.equal(byClass(host, "bob-period-strip-column-group").length, 3);
});

test("parts table uses live internal links, Headline or mostly, review states, and day closeout rows", () => {
  const { host, model } = paintTable(week, "2026-W44");
  const table = byClass(host, "bob-period-parts-table")[0];
  assert.equal(table.getAttribute("role"), "table");
  assert.equal(byClass(table, "bob-period-parts-row").length, 8);
  assert.equal(byClass(table, "bob-period-parts-cell-done").length, 8);
  assert.ok(byClass(table, "bob-period-parts-child-link").every((node) => node.tagName === "A" && node.getAttribute("data-href")));
  assert.ok(byClass(table, "bob-period-parts-summary-mostly").length > 0);
  assert.ok(byClass(table, "bob-period-parts-summary-headline").length === 0);
  assert.equal(model.children[0].kind, "day");

  const { host: quarterHost } = paintTable(fixtures.closedQuarter, "2026-Q2");
  assert.ok(byClass(quarterHost, "bob-period-parts-summary-headline").length > 0);
  assert.ok(byClass(quarterHost, "bob-period-parts-cell-done").length === 0);
  assert.ok(byClass(quarterHost, "bob-period-parts-cell-review").some((node) => node.textContent === "✓ reflected"));
});

test("table future rows stop at Child and Dates; not-tracked years and missing pre-adoption links are clear", () => {
  const { host: quarterHost } = paintTable(fixtures.currentQuarter, "2026-Q4");
  const future = byClass(quarterHost, "bob-period-parts-row-future")[0];
  assert.equal(findAll(future, (node) => node.getAttribute("role") === "cell").length, 2);

  const { host: allHost } = paintTable(fixtures.all, "all");
  assert.match(allHost.textContent, /not tracked/);
  const children = byClass(allHost, "bob-period-parts-cell-child").slice(1);
  assert.equal(findAll(children[0], (node) => node.tagName === "A").length, 1);
  assert.equal(findAll(children[1], (node) => node.tagName === "A").length, 0);
});

test("shared report command remains keyed once by the period id", () => {
  assert.deepEqual(helpers.periodStripShowArgs("2026-Q4"), ["periods", "show", "2026-Q4", "-f", "json"]);
});
