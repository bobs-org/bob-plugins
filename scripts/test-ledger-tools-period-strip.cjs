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

test("period strips stay on Both and do not render a Day strip switch", () => {
  const model = helpers.periodStripModel(current, "2026-W45", { laneView: "roots" });
  assert.deepEqual(model.lanes, { view: "both", shown: ["roots", "themes"], switchable: false });
  const { root } = paint(model, { cycleLanes: () => assert.fail("period strips must not cycle Day strip lanes") });
  assert.equal(byClass(root, "bob-period-strip-lanes-switch").length, 0);
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

test("paint renders facts, a legacy Roots fallback, and the seven-child axis", () => {
  const model = helpers.periodStripModel(closed, "2026-W44", { laneView: "both" });
  const { root } = paint(model);
  assert.equal(byClass(root, "bob-period-strip-fact").length, 5);
  assert.equal(byClass(root, "bob-period-strip-chart-title").length, 1);
  assert.match(root.textContent, /Update bob for the Types chart/);
  assert.equal(byClass(root, "bob-period-strip-column").length, 7);
  assert.equal(byClass(root, "bob-period-strip-chart-switch").length, 0);
  assert.equal(findAll(root, (node) => node.tagName === "BUTTON").length, 0);
  const paintedFuture = paint(helpers.periodStripModel(future, "2026-W46", { laneView: "both" })).root;
  assert.match(paintedFuture.textContent, /Starts/);
  assert.equal(byClass(paintedFuture, "bob-period-strip-column").length, 0);
});

test("Roots and Types legend marks reuse their identity hue classes", () => {
  const css = fs.readFileSync(path.join(__dirname, "../plugins/bob-ledger-tools/styles.css"), "utf8");
  const hues = ["blue", "orange", "aqua", "yellow", "magenta", "green", "violet", "red", "gray"];
  const emitted = new Set();
  for (const hue of hues) {
    const report = JSON.parse(JSON.stringify(closed));
    report.homes["root-" + hue] = { label: "Root " + hue, hue, kind: "project" };
    report.theme_hues["type-" + hue] = { name: "Type " + hue, hue, configured: true };
    report.charts = {
      version: 1,
      roots: { limit: 5, series: [{ key: "root-" + hue, kind: "root", label: "Root " + hue, minutes: 60, display: "1h", display_short: "1h" }] },
      types: { policy: "configured", series: [{ key: "type-" + hue, kind: "type", label: "Type " + hue, minutes: 60, display: "1h", display_short: "1h" }] },
    };
    report.columns = report.columns.map((column) => ({ ...column, stacks: { roots: [], types: [] } }));
    const { root } = paint(helpers.periodStripModel(report, "2026-W44"));
    const rootMark = byClass(root, "bob-period-strip-legend-dot")[0];
    const typeMark = byClass(root, "bob-period-strip-legend-swatch")[0];
    const rootClass = (rootMark.getAttribute("class").split(/\s+/).find((name) => name.startsWith("bob-day-strip-hue-")));
    const typeClass = (typeMark.getAttribute("class").split(/\s+/).find((name) => name.startsWith("bob-day-strip-theme-hue-")));
    emitted.add(rootClass);
    emitted.add(typeClass);
    assert.ok(css.includes("." + rootClass));
    assert.ok(css.includes("." + typeClass));
  }
});

test("new chart legends show every series and do not collapse entries into +N", () => {
  const report = JSON.parse(JSON.stringify(closed));
  const rows = [
    { key: "tiny.md", label: "Tiny", minutes: 5, display: "5m", share: "2%" },
    { key: "largest.md", label: "Largest", minutes: 120, display: "2h", share: "50%" },
    { key: "middle.md", label: "Middle", minutes: 60, display: "1h", share: "25%" },
    { key: "small.md", label: "Small", minutes: 20, display: "20m", share: "8%" },
    { key: "next.md", label: "Next", minutes: 40, display: "40m", share: "17%" },
  ];
  report.lanes.root_parent = rows;
  for (const row of rows) report.homes[row.key] = { label: row.label, hue: "blue", kind: "project" };
  report.charts = {
    version: 1,
    roots: { limit: 5, series: rows.map((row) => ({ ...row, kind: "root", display_short: row.display })) },
    types: { policy: "configured", series: [] },
  };
  report.columns = report.columns.map((column) => ({ ...column, stacks: { roots: [], types: [] } }));
  const { root } = paint(helpers.periodStripModel(report, "2026-W44"));
  const items = byClass(root, "bob-period-strip-chart-legend-item");
  assert.deepEqual(items.map((item) => item.getAttribute("data-key")), rows.map((row) => row.key));
  assert.equal(byClass(root, "bob-period-strip-overflow").length, 0);
});

test("quarter month ticks occupy one shared row above aligned chart columns", () => {
  const quarter = periodPartsFixtures(closed).closedQuarter;
  const model = helpers.periodStripModel(quarter, "2026-Q2");
  const { root } = paint(model);
  const row = byClass(root, "bob-period-strip-chart-ticks")[0];
  const ticks = byClass(row, "bob-period-strip-chart-tick");
  assert.equal(ticks.length, 13);
  assert.deepEqual(ticks.map((column) => column.textContent), [
    "Apr", "", "", "", "May", "", "", "", "Jun", "", "", "", "",
  ]);
  const css = fs.readFileSync(path.join(__dirname, "../plugins/bob-ledger-tools/styles.css"), "utf8");
  assert.match(css, /\.bob-period-strip-chart-ticks\s*\{/);
});

test("period slices keep honest heights, skip sub-pixel pieces, and omit year values", () => {
  const model = helpers.periodStripModel(closed, "2026-W44");
  const first = model.charts.columns[0];
  first.worked = { ...first.worked, value: 215, display: "3h 35m" };
  first.roots = [
    { key: "tiny.md", minutes: 1, label: "Tiny", hue: "green", fill: "identity", kind: "root" },
    { key: "large.md", minutes: 214, label: "Large", hue: "blue", fill: "identity", kind: "root" },
  ];
  model.charts.tallest = 215;
  const { root } = paint(model);
  const firstPlot = byClass(root, "bob-period-strip-chart-plot-roots")[0];
  const bar = byClass(firstPlot, "bob-period-strip-column-bar")[0];
  assert.deepEqual(bar.children.map((piece) => piece.getAttribute("data-key")), ["large.md"]);
  assert.equal(bar.children[0].style.height, String((214 / 215) * 62) + "px");
  assert.match(bar.children[0].getAttribute("class"), /bob-period-strip-column-piece-top/);
  const css = fs.readFileSync(path.join(__dirname, "../plugins/bob-ledger-tools/styles.css"), "utf8");
  const barCss = css.match(/\.bob-period-strip-column-bar\s*\{([^}]+)\}/)[1];
  const pieceCss = css.match(/\.bob-period-strip-column-piece\s*\{([^}]+)\}/)[1];
  assert.match(barCss, /gap:\s*0;/);
  assert.doesNotMatch(pieceCss, /min-height/);
  assert.match(css, /\.bob-period-strip-column-piece-seamed\s*\{[^}]*inset 0 1px 0 var\(--background-primary\)/);

  const year = periodPartsFixtures(closed).year;
  const yearRoot = paint(helpers.periodStripModel(year, "2026")).root;
  assert.equal(byClass(yearRoot, "bob-period-strip-column-value").length, 0);
});

test("so-far stays in fact accessibility text and column tooltips use catalog labels", () => {
  const model = helpers.periodStripModel(current, "2026-W45");
  const { root } = paint(model);
  const workedFact = byClass(root, "bob-period-strip-fact").find((node) => node.getAttribute("data-period-strip-metric") === "worked");
  assert.ok(workedFact.getAttribute("aria-label").includes("so far"));
  assert.equal(byClass(workedFact, "bob-period-strip-so-far").length, 0);
  assert.equal(byClass(workedFact, "bob-period-strip-value")[0].textContent.includes("so far"), false);
  const column = byClass(root, "bob-period-strip-column")[0];
  assert.match(column.getAttribute("title"), /bob 1h 30m/);
  assert.match(column.getAttribute("title"), /gtd_daily 1h 30m/);
  assert.doesNotMatch(column.getAttribute("title"), /\.md\b/);
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
  assert.equal(byClass(strip.el, "bob-period-strip-lanes-switch").length, 0);
  let cycleCalls = 0;
  plugin.dayStripCycleLaneView = () => { cycleCalls += 1; };
  byClass(strip.el, "bob-period-strip-mix")[0].dispatch("click", {});
  for (const column of byClass(strip.el, "bob-period-strip-column")) column.dispatch("click", {});
  assert.equal(cycleCalls, 0);
  assert.equal(plugin.app.loadLocalStorage(helpers.DAY_STRIP_LANES_STORAGE_KEY), null);
  assert.equal(plugin.dayStripLaneView, "both");
  const table = mountFence(plugin, "bob-period-parts", "2026/2026-Q2.md");
  await settle();
  assert.ok(byClass(table.el, "bob-period-parts-table").length >= 1);
  assert.equal(byClass(table.el, "bob-period-parts-row").length, 1 + quarter.children.length);
  assert.deepEqual(spawns, ["2026-W44", "2026-Q2"]);
});
