const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { LedgerToolsPlugin, makeFreshnessApp } = require("./ledger-tools-harness.cjs");
const { periodPartsFixtures } = require("../plugins/bob-ledger-tools/scripts/fixtures/stats/period-parts-fixtures.cjs");

const helpers = LedgerToolsPlugin.helpers;
const fixtureDir = path.join(__dirname, "..", "plugins/bob-ledger-tools/scripts/fixtures/stats");
const current = JSON.parse(fs.readFileSync(path.join(fixtureDir, "period-strip-current-week.json"), "utf8"));
const closed = JSON.parse(fs.readFileSync(path.join(fixtureDir, "period-strip-closed-week.json"), "utf8"));
const preLedger = JSON.parse(fs.readFileSync(path.join(fixtureDir, "period-strip-pre-ledger-week.json"), "utf8"));
const future = JSON.parse(fs.readFileSync(path.join(fixtureDir, "period-strip-future-week.json"), "utf8"));

function hideNodeFields(node, fields) {
  for (const field of fields) {
    Object.defineProperty(node, field, { enumerable: false, configurable: true, writable: true });
  }
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
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  get firstChild() { return this.children[0] || null; }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  dispatch(type, init = {}) {
    const event = { type, target: this, currentTarget: null, ...init, preventDefault() {}, stopPropagation() {} };
    let node = this;
    while (node) {
      event.currentTarget = node;
      for (const handler of node.listeners.get(type) || []) handler(event);
      node = node.parentNode;
    }
    return event;
  }
}

function fakeDocument() {
  return {
    createElement(tag) { return new FakeNode(tag, null); },
    createElementNS(ns, tag) { return new FakeNode(tag, null); },
  };
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
  root.ownerDocument = doc;
  return { root, returned: helpers.paintPeriodStrip(root, model, handlers) };
}

test("period ids classify week, quarter, year, all time, day, and junk", () => {
  assert.deepEqual(helpers.periodStripClassifyId("2026-W45"), { kind: "week", id: "2026-W45" });
  assert.deepEqual(helpers.periodStripClassifyId("2026/2026-W45.md"), { kind: "week", id: "2026-W45" });
  assert.deepEqual(helpers.periodStripClassifyId("2026-Q4"), { kind: "quarter", id: "2026-Q4" });
  assert.deepEqual(helpers.periodStripClassifyId("2026"), { kind: "year", id: "2026" });
  assert.deepEqual(helpers.periodStripClassifyId("all_time.md"), { kind: "all", id: "all" });
  assert.deepEqual(helpers.periodStripClassifyId("2026/20261103.md"), { kind: "day", id: "2026-11-03" });
  assert.equal(helpers.periodStripClassifyId("2026-W99"), null);
  assert.equal(helpers.periodStripClassifyId("notes.md"), null);
});

test("fence parsing selects period, day, or the muted line", () => {
  assert.deepEqual(helpers.periodStripParseFencePeriod("period: 2026-W45", "2026/2026-W45.md"), { kind: "week", id: "2026-W45" });
  assert.deepEqual(helpers.periodStripParseFencePeriod("day: 2026-11-03", ""), { kind: "day", id: "2026-11-03" });
  assert.deepEqual(helpers.periodStripParseFencePeriod("", "2026/2026-W45.md"), { kind: "week", id: "2026-W45" });
  assert.deepEqual(helpers.periodStripParseFencePeriod("", "2026/20261103.md"), { kind: "day", id: "2026-11-03" });
  assert.equal(helpers.periodStripParseFencePeriod("", "random/note.md"), null);
  assert.equal(helpers.periodStripParseFencePeriod("unrelated: yes", "random/note.md"), null);
});

test("week model maps bob facts with typical marks only when closed", () => {
  const openModel = helpers.periodStripModel(current, "2026-W45", { laneView: "both", fetchedAt: current.generated_at });
  assert.equal(openModel.state, "ready");
  assert.equal(openModel.periodId, "2026-W45");
  assert.deepEqual(openModel.facts.map((fact) => fact.id), ["worked", "reviewed", "done", "created", "review_closed"]);
  for (const fact of openModel.facts) {
    const source = current.facts.find((entry) => entry.metric === fact.id);
    assert.equal(fact.display, source.display);
    if (fact.ref.state === "ready") assert.equal(fact.ref.mark, null, `${fact.id} open week never marks`);
  }
  const closedModel = helpers.periodStripModel(closed, "2026-W44", { laneView: "both" });
  assert.equal(closedModel.state, "ready");
  const worked = closedModel.facts.find((fact) => fact.id === "worked");
  assert.equal(worked.ref.state, "ready");
  assert.equal(worked.ref.mark, "below");
  assert.match(worked.tooltip, /Typical/);
});

test("week meta covers open, closed gaps, and future", () => {
  const openModel = helpers.periodStripModel(current, "2026-W45", { laneView: "both", fetchedAt: current.generated_at });
  assert.match(openModel.metaText, /so far/);
  const closedModel = helpers.periodStripModel(closed, "2026-W44", { laneView: "both" });
  assert.equal(closedModel.metaText, "");
  const gapsModel = helpers.periodStripModel(preLedger, "2026-W22", { laneView: "both" });
  assert.match(gapsModel.metaText, /logged/);
  const futureModel = helpers.periodStripModel(future, "2026-W46", { laneView: "both" });
  assert.equal(futureModel.state, "future");
  assert.match(futureModel.metaText, /Starts/);
});

test("lanes and columns share one hue per root", () => {
  const model = helpers.periodStripModel(current, "2026-W45", { laneView: "both" });
  const laneHues = new Map(model.roots.segments.map((segment) => [segment.key, segment.hue]));
  assert.ok(laneHues.size > 0);
  for (const column of model.columns) {
    if (column.missing) continue;
    for (const entry of column.stack) {
      assert.equal(entry.hue, laneHues.get(entry.key), `${entry.key} keeps one hue in lanes and columns`);
    }
  }
});

test("a muted root stays gray in the lane and the parts row", () => {
  // A grey `color:` slot on gtd: bob reports hue null with hue_source muted.
  const report = JSON.parse(JSON.stringify(current));
  report.homes["gtd_daily.md"] = { ...report.homes["gtd_daily.md"], hue: null, hue_source: "muted" };
  const model = helpers.periodStripModel(report, "2026-W45", { laneView: "both" });
  const segment = model.roots.segments.find((item) => item.key === "gtd_daily.md");
  assert.ok(segment, "gtd_daily keeps its lane segment");
  assert.equal(segment.hue, "gray");
  assert.equal(segment.tone, "gray");
  assert.equal(segment.shade, 0);
  const coloured = model.roots.segments.filter((item) => item.tone === "hue");
  assert.ok(coloured.length > 0);
  assert.equal(coloured.some((item) => item.hue === "gray"), false, "coloured roots keep palette hues");
  let stacked = 0;
  for (const column of model.columns) {
    for (const entry of column.stack || []) {
      if (entry.key !== "gtd_daily.md") continue;
      stacked += 1;
      assert.equal(entry.hue, "gray", "the parts row matches the lane");
    }
  }
  assert.ok(stacked > 0, "gtd_daily appears in the parts row");
});

test("week columns carry closed, current, future, and missing states", () => {
  const model = helpers.periodStripModel(current, "2026-W45", { laneView: "both" });
  assert.equal(model.columns.length, 7);
  const byId = Object.fromEntries(model.columns.map((column) => [column.id, column]));
  assert.equal(byId["2026-11-02"].state, "closed");
  assert.equal(byId["2026-11-02"].mark, "met");
  assert.equal(byId["2026-11-03"].state, "current");
  assert.equal(byId["2026-11-04"].state, "future");
  assert.equal(byId["2026-11-04"].worked, null);
  const gaps = helpers.periodStripModel(preLedger, "2026-W22", { laneView: "both" });
  const missing = gaps.columns.find((column) => column.id === "2026-05-25");
  assert.equal(missing.missing, true);
  assert.match(missing.tooltip, /not tracked/);
});

test("states: skeleton, unavailable, older-bob, and hidden", () => {
  assert.equal(helpers.periodStripModel(null, "2026-W45", { laneView: "both" }).state, "skeleton");
  const unavailable = helpers.periodStripModel(null, "2026-W45", { laneView: "both", error: { code: "timeout", title: "bob periods timed out" } });
  assert.equal(unavailable.state, "unavailable");
  const older = helpers.periodStripModel(null, "2026-W45", { laneView: "both", error: { code: "bob-not-found", title: "bob was not found" } });
  assert.equal(older.state, "older-bob");
  assert.equal(helpers.periodStripModel(null, "not-a-period", { laneView: "both" }).state, "hidden");
  assert.equal(helpers.periodStripModel(null, "2026-Q4", { laneView: "both" }).state, "skeleton");
});

test("paint renders facts, lanes, and the seven-day parts row with no buttons", () => {
  const model = helpers.periodStripModel(closed, "2026-W44", { laneView: "both" });
  const { root } = paint(model);
  assert.equal(byClass(root, "bob-period-strip-fact").length, 5);
  assert.ok(byClass(root, "bob-period-strip-parts").length >= 1);
  assert.equal(byClass(root, "bob-period-strip-column").length, 7);
  assert.equal(findAll(root, (node) => node.tagName === "BUTTON").length, 0);
  const paintedFuture = paint(helpers.periodStripModel(future, "2026-W46", { laneView: "both" })).root;
  assert.match(paintedFuture.textContent, /Starts/);
  assert.equal(byClass(paintedFuture, "bob-period-strip-column").length, 0);
});

test("parts row is one roving-tabindex group with tooltips", () => {
  const model = helpers.periodStripModel(closed, "2026-W44", { laneView: "both" });
  const { root } = paint(model);
  const columns = byClass(root, "bob-period-strip-column");
  assert.equal(columns[0].getAttribute("tabindex"), "0");
  for (const column of columns.slice(1)) assert.equal(column.getAttribute("tabindex"), "-1");
  for (const column of columns) assert.match(column.getAttribute("title") || "", /Worked/);
});

test("clicks reach the day note and Stats hand-offs, never a spawn on future", () => {
  const model = helpers.periodStripModel(closed, "2026-W44", { laneView: "both" });
  let opened = null;
  let statsForColumn = null;
  const { root } = paint(model, {
    openColumn: (column, newLeaf) => { opened = { id: column.id, newLeaf }; },
    openStatsForColumn: (column, newLeaf) => { statsForColumn = { id: column.id, newLeaf }; },
  });
  const first = byClass(root, "bob-period-strip-column")[0];
  first.dispatch("click", { ctrlKey: false, metaKey: false, button: 0, altKey: false });
  assert.equal(opened.id, "2026-10-26");
  first.dispatch("keydown", { key: "Enter", altKey: true, preventDefault() {} });
  assert.equal(statsForColumn.id, "2026-10-26");
  let factStats = null;
  const { root: factsRoot } = paint(model, { openStats: (opts) => { factStats = opts; } });
  byClass(factsRoot, "bob-period-strip-fact")[0].dispatch("click", {});
  assert.equal(factStats.metric, "worked");
});

test("period show args are one audited call per period", () => {
  assert.deepEqual(helpers.periodStripShowArgs("2026-W45"), ["periods", "show", "2026-W45", "-f", "json"]);
});

// The fences live on the real plugin, not just the helpers: a mixin that is
// defined but never installed leaves `bob-stats-strip` and `bob-period-parts`
// as plain code blocks in every period note.
function loadedPlugin() {
  const store = new Map();
  const app = makeFreshnessApp({ tasks: [] });
  app.loadLocalStorage = (key) => (store.has(key) ? store.get(key) : null);
  app.saveLocalStorage = (key, value) => {
    store.set(key, value);
  };
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.onload();
  return plugin;
}

function mountFence(plugin, language, sourcePath) {
  const doc = fakeDocument();
  const el = new FakeNode("div", doc);
  el.ownerDocument = doc;
  const added = [];
  plugin.codeBlocks[language]("", el, { sourcePath, addChild: (child) => added.push(child) });
  return { el, added };
}

async function settle(ms = 20) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

test("onload registers the bob-stats-strip and bob-period-parts fences", () => {
  const plugin = loadedPlugin();
  assert.equal(typeof plugin.setupPeriodStripHosts, "function");
  assert.equal(typeof plugin.openStatsForPeriod, "function");
  assert.equal(typeof plugin.codeBlocks["bob-stats-strip"], "function");
  assert.equal(typeof plugin.codeBlocks["bob-period-parts"], "function");
});

test("period-note fences fetch once per period and paint the strip and the parts table", async () => {
  const plugin = loadedPlugin();
  const quarter = periodPartsFixtures(closed).closedQuarter;
  const reports = { "2026-W44": closed, "2026-Q2": quarter };
  const spawns = [];
  plugin.periodStripSpawnShow = async (periodId) => {
    spawns.push(periodId);
    return { ok: true, report: reports[periodId] };
  };
  const strip = mountFence(plugin, "bob-stats-strip", "2026/2026-W44.md");
  assert.equal(strip.added.length, 1, "the strip registers a render child for cleanup");
  await settle();
  assert.equal(byClass(strip.el, "bob-period-strip-fact").length, 5);
  assert.equal(byClass(strip.el, "bob-period-strip-column").length, 7);
  const table = mountFence(plugin, "bob-period-parts", "2026/2026-Q2.md");
  await settle();
  assert.ok(byClass(table.el, "bob-period-parts-table").length >= 1);
  assert.equal(byClass(table.el, "bob-period-parts-row").length, 1 + quarter.children.length);
  assert.deepEqual(spawns, ["2026-W44", "2026-Q2"]);
});
