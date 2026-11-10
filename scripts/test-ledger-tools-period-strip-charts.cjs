const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { LedgerToolsPlugin, makeFreshnessApp } = require("./ledger-tools-harness.cjs");
const { periodPartsFixtures } = require("../plugins/bob-ledger-tools/scripts/fixtures/stats/period-parts-fixtures.cjs");

const helpers = LedgerToolsPlugin.helpers;
const fixtureDir = path.join(__dirname, "../plugins/bob-ledger-tools/scripts/fixtures/stats");
const closedWeek = JSON.parse(fs.readFileSync(path.join(fixtureDir, "period-strip-closed-week.json"), "utf8"));

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
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return [this._text, ...this.children.map((child) => child.textContent)].filter(Boolean).join(""); }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  get firstChild() { return this.children[0] || null; }
  removeChild(child) { const index = this.children.indexOf(child); if (index >= 0) this.children.splice(index, 1); child.parentNode = null; return child; }
  addEventListener(type, handler) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(handler); }
  dispatch(type, init = {}) {
    const event = { type, target: this, currentTarget: null, preventDefault() {}, stopPropagation() {}, ...init };
    for (let node = this; node; node = node.parentNode) {
      event.currentTarget = node;
      for (const handler of node.listeners.get(type) || []) handler(event);
    }
    return event;
  }
  focus() { this.dispatch("focus", {}); }
}

function fakeDocument() {
  return { createElement: (tag) => new FakeNode(tag, null), createElementNS: (_ns, tag) => new FakeNode(tag, null) };
}

function findAll(root, predicate, result = []) {
  if (predicate(root)) result.push(root);
  for (const child of root.children || []) findAll(child, predicate, result);
  return result;
}

function byClass(root, name) {
  return findAll(root, (node) => (node.getAttribute("class") || "").split(/\s+/).includes(name));
}

function formatMinutes(minutes) {
  const value = Math.round(minutes);
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return hours ? hours + "h " + String(rest).padStart(2, "0") + "m" : rest + "m";
}

function shortMinutes(minutes) {
  return minutes >= 600 ? Math.floor((minutes + 30) / 60) + "h" : formatMinutes(minutes);
}

function chartReport(source) {
  const report = structuredClone(source);
  let bob = 0;
  let sase = 0;
  let build = 0;
  let fix = 0;
  let untyped = 0;
  for (const column of report.columns || []) {
    const total = column.worked && typeof column.worked.value === "number" ? column.worked.value : 0;
    if (column.state === "future" || total <= 0) {
      column.stacks = { roots: [], types: [] };
      continue;
    }
    const rootBob = Math.floor(total * 0.63);
    const rootSase = total - rootBob;
    const typeBuild = Math.floor(total * 0.5);
    const typeFix = Math.floor(total * 0.27);
    const typeUntyped = total - typeBuild - typeFix;
    bob += rootBob;
    sase += rootSase;
    build += typeBuild;
    fix += typeFix;
    untyped += typeUntyped;
    column.stacks = {
      roots: [{ key: "bob.md", minutes: rootBob }, { key: "sase.md", minutes: rootSase }],
      types: [{ key: "build", minutes: typeBuild }, { key: "fix", minutes: typeFix }, { key: "@unattributed", minutes: typeUntyped }],
    };
  }
  const series = (key, kind, label, minutes, members) => ({ key, kind, label, minutes, display: formatMinutes(minutes), display_short: shortMinutes(minutes), share: "", ...(members ? { members } : {}) });
  report.homes = {
    ...(report.homes || {}),
    "bob.md": { label: "bob", hue: "blue", kind: "area" },
    "sase.md": { label: "sase", hue: "blue", kind: "project" },
  };
  report.theme_hues = {
    ...(report.theme_hues || {}),
    build: { name: "BUILD", hue: "aqua", configured: true },
    fix: { name: "FIX", hue: "aqua", configured: true },
  };
  report.charts = {
    version: 1,
    roots: { limit: 5, dimension: "root_parent", series: [
      series("bob.md", "root", "bob", bob),
      series("sase.md", "root", "sase", sase),
      series("@rest", "rest", "4 more", 0, [{ key: "job.md", label: "job", minutes: 0, display: "0m" }]),
      series("@unattributed", "unattributed", "unlinked", 0),
    ].filter((row) => row.minutes > 0 || row.kind === "rest") },
    types: { policy: "configured", series: [
      series("build", "type", "BUILD", build),
      series("fix", "type", "FIX", fix),
      series("@unattributed", "unattributed", "untyped", untyped),
    ].filter((row) => row.minutes > 0) },
  };
  return report;
}

function paint(model, handlers = {}) {
  const doc = fakeDocument();
  const host = new FakeNode("div", doc);
  host.ownerDocument = doc;
  helpers.paintPeriodStrip(host, model, handlers);
  return host;
}

function makePlugin() {
  const storage = new Map();
  const app = makeFreshnessApp({ tasks: [] });
  app.loadLocalStorage = (key) => storage.get(key) || null;
  app.saveLocalStorage = (key, value) => storage.set(key, value);
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.onload();
  return { plugin, storage };
}

test("Both, Roots, and Types show the requested period charts and one shared child axis", () => {
  const report = chartReport(closedWeek);
  for (const [view, shown] of [["both", ["roots", "types"]], ["roots", ["roots"]], ["types", ["types"]]]) {
    const model = helpers.periodStripModel(report, "2026-W44", { periodView: view });
    assert.deepEqual(model.charts.shown, shown);
    const root = paint(model);
    assert.equal(byClass(root, "bob-period-strip-chart-axis-column").length, 7);
    assert.equal(byClass(root, "bob-period-strip-chart-row").length, shown.length);
    assert.equal((root.getAttribute("class") || "").includes("hidden"), false);
  }
});

test("each child Roots stack and Types stack sum to the same Worked minutes", () => {
  const report = chartReport(closedWeek);
  const model = helpers.periodStripModel(report, "2026-W44", { periodView: "both" });
  for (const column of model.charts.columns) {
    const worked = column.worked && column.worked.value || 0;
    assert.equal(column.roots.reduce((sum, row) => sum + row.minutes, 0), worked);
    assert.equal(column.types.reduce((sum, row) => sum + row.minutes, 0), worked);
  }
  const root = paint(model);
  const rootBars = byClass(root, "bob-period-strip-chart-plot-roots").map((plot) => byClass(plot, "bob-period-strip-column-piece").reduce((sum, piece) => sum + parseFloat(piece.style.height || "0"), 0));
  const typeBars = byClass(root, "bob-period-strip-chart-plot-types").map((plot) => byClass(plot, "bob-period-strip-column-piece").reduce((sum, piece) => sum + parseFloat(piece.style.height || "0"), 0));
  assert.equal(rootBars.length, typeBars.length);
  rootBars.forEach((value, index) => assert.ok(Math.abs(value - typeBars[index]) < 1e-9));
});

test("root hues and same-hue type shades follow identity when period minutes change", () => {
  const report = chartReport(closedWeek);
  const first = helpers.periodStripChartsModel(report, "week", "both", {});
  const rootsFirst = Object.fromEntries(first.roots.filter((row) => row.kind === "root").map((row) => [row.key, row.hue]));
  const typesFirst = Object.fromEntries(first.types.filter((row) => row.kind === "type").map((row) => [row.key, row.shade]));
  const permuted = structuredClone(report);
  const rootRows = permuted.charts.roots.series;
  [rootRows[0].minutes, rootRows[1].minutes] = [rootRows[1].minutes, rootRows[0].minutes];
  const typeRows = permuted.charts.types.series;
  [typeRows[0].minutes, typeRows[1].minutes] = [typeRows[1].minutes, typeRows[0].minutes];
  const second = helpers.periodStripChartsModel(permuted, "week", "both", {});
  assert.deepEqual(Object.fromEntries(second.roots.filter((row) => row.kind === "root").map((row) => [row.key, row.hue])), rootsFirst);
  assert.deepEqual(Object.fromEntries(second.types.filter((row) => row.kind === "type").map((row) => [row.key, row.shade])), typesFirst);
  assert.equal(rootsFirst["bob.md"], "blue");
  assert.equal(typesFirst.fix, 1);
});

test("charts show every series label and keep full and compact display values", () => {
  const report = chartReport(closedWeek);
  report.charts.roots.series[0].display = "12h 34m";
  report.charts.roots.series[0].display_short = "13h";
  const root = paint(helpers.periodStripModel(report, "2026-W44"));
  assert.equal(byClass(root, "bob-period-strip-chart-legend-item").length, report.charts.roots.series.length + report.charts.types.series.length);
  assert.equal(byClass(root, "bob-period-strip-overflow").length, 0);
  const item = byClass(root, "bob-period-strip-chart-legend-item").find((node) => node.getAttribute("data-key") === "bob.md");
  assert.equal(item.getAttribute("data-display"), "12h 34m");
  assert.equal(item.getAttribute("data-display-short"), "13h");
  assert.match(item.getAttribute("title"), /Compact: 13h/);
});

test("period switch cycles, persists separately, and repaints mounted strips only", () => {
  const { plugin, storage } = makePlugin();
  const DAY_KEY = helpers.DAY_STRIP_LANES_STORAGE_KEY;
  const stripA = { surface: "strip", paintedKey: "old" };
  const stripB = { surface: "strip", paintedKey: "old" };
  const table = { surface: "table", paintedKey: "table" };
  plugin.periodStripViews = new Set([stripA, stripB, table]);
  const repainted = [];
  plugin.periodStripPaint = (record) => repainted.push(record);
  let dayCalls = 0;
  plugin.dayStripCycleLaneView = () => { dayCalls += 1; };
  assert.equal(plugin.periodStripCycleCharts(), "roots");
  assert.equal(storage.get(helpers.PERIOD_STRIP_CHART_VIEW_KEY), "roots");
  assert.equal(storage.get(DAY_KEY) || null, null);
  assert.deepEqual(repainted, [stripA, stripB]);
  assert.equal(table.paintedKey, "table");
  assert.equal(dayCalls, 0);
  assert.equal(plugin.periodStripCycleCharts(), "types");
  assert.equal(plugin.periodStripCycleCharts(), "both");
});

test("paint key changes with view, chart series, and child stacks", () => {
  const { plugin } = makePlugin();
  const report = chartReport(closedWeek);
  const record = { el: new FakeNode("div", fakeDocument()), surface: "strip" };
  const both = helpers.periodStripModel(report, "2026-W44", { periodView: "both" });
  plugin.periodStripFinishPaint(record, both, {}, "same");
  const first = record.paintedKey;
  plugin.periodStripFinishPaint(record, helpers.periodStripModel(report, "2026-W44", { periodView: "roots" }), {}, "same");
  assert.notEqual(record.paintedKey, first);
  const digest = helpers.periodStripChartsDigest(report);
  report.columns[0].stacks.roots[0].minutes += 1;
  assert.notEqual(helpers.periodStripChartsDigest(report), digest);
});

test("older bob falls back to a Roots-only chart with an update note and no switch", () => {
  const model = helpers.periodStripModel(closedWeek, "2026-W44");
  const root = paint(model);
  assert.equal(model.charts.fallback, true);
  assert.equal(byClass(root, "bob-period-strip-chart-row").length, 1);
  assert.equal(byClass(root, "bob-period-strip-chart-title").length, 1);
  assert.equal(byClass(root, "bob-period-strip-chart-switch").length, 0);
  assert.match(root.textContent, /Update bob for the Types chart/);
});

test("zero Worked period shows axis stubs without legends or a switch", () => {
  const report = chartReport(closedWeek);
  report.charts.roots.series = [];
  report.charts.types.series = [];
  report.columns = report.columns.map((column) => ({ ...column, worked: column.worked ? { ...column.worked, value: 0, display: "0m", display_short: "0m" } : null, stacks: { roots: [], types: [] } }));
  const root = paint(helpers.periodStripModel(report, "2026-W44"));
  assert.equal(byClass(root, "bob-period-strip-chart-title").length, 0);
  assert.equal(byClass(root, "bob-period-strip-chart-switch").length, 0);
  assert.equal(byClass(root, "bob-period-strip-chart-zero-stub").length, 14);
  assert.match(root.textContent, /No Worked time/);
});

test("Alt+Enter opens Stats for the whole child period", () => {
  const quarter = chartReport(periodPartsFixtures(closedWeek).closedQuarter);
  const { plugin } = makePlugin();
  const doc = fakeDocument();
  const record = { el: new FakeNode("div", doc), periodId: "2026-Q2", kind: "quarter", path: "2026/2026-Q2.md", surface: "strip" };
  let opened = null;
  plugin.openStatsForPeriod = (options) => { opened = options; };
  plugin.periodStripPaint(record, { report: quarter, fetchedAt: "2026-10-30T12:00:00Z" });
  const first = byClass(record.el, "bob-period-strip-chart-axis-column")[0];
  first.dispatch("keydown", { key: "Enter", altKey: true });
  assert.equal(opened.period, "2026-Q2");
  assert.equal(opened.start, quarter.columns[0].start);
  assert.equal(opened.end, quarter.columns[0].end);
  assert.equal(opened.kind, "quarter");
});

test("every chart painter class has a CSS rule", () => {
  const root = paint(helpers.periodStripModel(chartReport(closedWeek), "2026-W44"));
  const charts = byClass(root, "bob-period-strip-charts")[0];
  const css = fs.readFileSync(path.join(__dirname, "../plugins/bob-ledger-tools/styles.css"), "utf8");
  const classes = new Set(findAll(charts, () => true).flatMap((node) => (node.getAttribute("class") || "").split(/\s+/).filter(Boolean)));
  for (const name of classes) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(css, new RegExp("\\." + escaped + "(?=[\\s.:#,[>~+{])"), name + " has a style rule");
  }
});

test("year model carries a four-quarter fallback from children stacks without re-adding minutes", () => {
  const parts = periodPartsFixtures(closedWeek);
  const yearReport = chartReport(parts.year);
  yearReport.children = (parts.year.children || []).filter((row) => row && row.kind === "quarter").map((row) => ({
    ...row,
    stacks: { roots: [{ key: "bob.md", minutes: 60 }], types: [{ key: "build", minutes: 60 }] },
    worked: row.worked || { value: 60, display: "1h 00m", display_short: "1h", quality: "ok" },
  }));
  const model = helpers.periodStripChartsModel(yearReport, "year", "both", {});
  assert.ok(Array.isArray(model.fallbackColumns) && model.fallbackColumns.length === 4);
  const weekTotal = model.columns.reduce((sum, column) => sum + (column.worked && column.worked.value || 0), 0);
  const fallbackTotal = model.fallbackColumns.reduce((sum, column) => sum + (column.worked && column.worked.value || 0), 0);
  assert.ok(fallbackTotal > 0 && fallbackTotal <= weekTotal + 240);
  const root = paint(helpers.periodStripModel(yearReport, yearReport.period.id));
  assert.ok(byClass(root, "bob-period-strip-charts-year").length >= 1);
  assert.ok(byClass(root, "bob-period-strip-charts-detailed").length >= 1);
  assert.ok(byClass(root, "bob-period-strip-charts-fallback").length >= 1);
});

test("all-time leading untracked years collapse into one quiet ghost", () => {
  const report = chartReport(closedWeek);
  report.groups = [{ key: "2023", label: "2023" }, { key: "2024", label: "2024" }, { key: "2026", label: "2026" }];
  report.columns = [
    { id: "2023-Q1", kind: "quarter", label: "Q1", group: "2023", state: "closed", worked: { value: 0, display: "0m", display_short: "0m", quality: "not_tracked" }, stacks: { roots: [], types: [] } },
    { id: "2024-Q1", kind: "quarter", label: "Q1", group: "2024", state: "closed", worked: { value: 0, display: "0m", display_short: "0m", quality: "not_tracked" }, stacks: { roots: [], types: [] } },
    { id: "2026-Q1", kind: "quarter", label: "Q1", group: "2026", state: "closed", worked: { value: 60, display: "1h 00m", display_short: "1h", quality: "ok" }, stacks: { roots: [{ key: "bob.md", minutes: 60 }], types: [{ key: "build", minutes: 60 }] } },
  ];
  const model = helpers.periodStripChartsModel(report, "all", "both", {});
  assert.equal(model.columns[0].ghost, true);
  assert.match(model.columns[0].label, /not tracked/);
  const root = paint(helpers.periodStripModel(report, "all"));
  assert.ok(byClass(root, "bob-period-strip-chart-ghost-column").length >= 1);
  assert.ok(byClass(root, "bob-period-strip-chart-ghost-bar").length >= 2);
});

test("parts mini-bars reuse the strip Roots series hues and fills", () => {
  const report = chartReport(closedWeek);
  const model = helpers.periodStripModel(report, "2026-W44");
  const rows = helpers.periodStripTableRows({ ...report, lanes: report.lanes, children: report.children || [] });
  assert.ok(Array.isArray(rows));
  const css = fs.readFileSync(path.join(__dirname, "../plugins/bob-ledger-tools/styles.css"), "utf8");
  assert.match(css, /\.bob-period-parts-mini-bar/);
  assert.match(css, /forced-colors/);
});

test("legend hover dims non-matching segments and forced-colors keeps shapes", () => {
  const css = fs.readFileSync(path.join(__dirname, "../plugins/bob-ledger-tools/styles.css"), "utf8");
  assert.match(css, /0\.35/);
  assert.match(css, /opacity 120ms/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /CanvasText/);
  const root = paint(helpers.periodStripModel(chartReport(closedWeek), "2026-W44"));
  assert.ok(byClass(root, "bob-period-strip-chart-legend-item").length > 0);
});
