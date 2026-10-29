// Stats window time bars: model, renderer, Themes-panel cap, and stylesheet
// contract. FakeNode follows the Day-strip harness (parentNode, dispatch, style).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  LedgerToolsPlugin,
  makeFreshnessApp,
  withMissingConfig,
} = require("./ledger-tools-harness.cjs");

const helpers = LedgerToolsPlugin.helpers;
const lanesFixture = require("../plugins/bob-ledger-tools/scripts/fixtures/stats/synthetic-lanes.json");

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
  constructor(tag, doc, namespaceURI) {
    this.tagName = String(tag).toUpperCase();
    this.namespaceURI = namespaceURI || null;
    this.ownerDocument = doc;
    this.parentNode = null;
    this.children = [];
    this.attrs = new Map();
    this.listeners = new Map();
    this.style = {};
    this._text = "";
    this.value = "";
    this.hidden = false;
    hideNodeFields(this, ["ownerDocument", "parentNode"]);
  }

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

  setAttribute(name, value) {
    this.attrs.set(name, String(value));
    if (name === "value") this.value = String(value);
    if (name === "hidden") this.hidden = true;
  }

  getAttribute(name) {
    return this.attrs.has(name) ? this.attrs.get(name) : null;
  }

  removeAttribute(name) {
    this.attrs.delete(name);
    if (name === "hidden") this.hidden = false;
  }

  hasAttribute(name) {
    return this.attrs.has(name);
  }

  appendChild(child) {
    child.parentNode = this;
    if (!child.ownerDocument) child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this._text = "";
    for (const child of children) this.appendChild(child);
  }

  addEventListener(name, handler) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(handler);
  }

  dispatch(name, init = {}) {
    let stopped = false;
    let prevented = false;
    const event = {
      type: name,
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
      for (const handler of node.listeners.get(name) || []) handler(event);
      if (stopped || event.bubbles === false) break;
      node = node.parentNode;
    }
    return event;
  }

  querySelector(selector) {
    const wanted = String(selector || "").startsWith(".") ? String(selector).slice(1) : "";
    if (!wanted) return null;
    if ((this.getAttribute("class") || "").split(/\s+/).includes(wanted)) return this;
    for (const child of this.children) {
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  querySelectorAll(selector, result = []) {
    const wanted = String(selector || "").startsWith(".") ? String(selector).slice(1) : "";
    if (wanted && (this.getAttribute("class") || "").split(/\s+/).includes(wanted)) result.push(this);
    for (const child of this.children) child.querySelectorAll(selector, result);
    return result;
  }

  get text() {
    return [this._text, ...this.children.map((child) => child.text)].filter(Boolean).join(" ");
  }
}

function fakeDoc(view = null) {
  const doc = {
    activeElement: null,
    defaultView: view,
    createElement(tag) { return new FakeNode(tag, doc); },
    createElementNS(namespaceURI, tag) { return new FakeNode(tag, doc, namespaceURI); },
  };
  return doc;
}

function fakeContainer(doc = fakeDoc()) {
  const node = new FakeNode("div", doc);
  node.empty = () => node.replaceChildren();
  return node;
}

function findAll(root, predicate, result = []) {
  if (predicate(root)) result.push(root);
  for (const child of root.children || []) findAll(child, predicate, result);
  return result;
}

function byClass(root, name) {
  return findAll(root, (node) => (node.getAttribute("class") || "").split(/\s+/).includes(name));
}

function byAttr(root, name, value) {
  return findAll(root, (node) => node.getAttribute(name) === value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function laneReport(overrides = {}) {
  const report = clone(lanesFixture);
  if (overrides.range) Object.assign(report.range, overrides.range);
  if (overrides.worked) {
    const worked = report.metrics.find((metric) => metric.id === "worked");
    Object.assign(worked, overrides.worked);
    if (overrides.worked.summary) Object.assign(worked.summary, overrides.worked.summary);
    if (overrides.worked.parts_summary) Object.assign(worked.parts_summary, overrides.worked.parts_summary);
  }
  return report;
}

function paintHost(model, handlers = {}, memory, options = {}) {
  const raf = [];
  const view = {
    matchMedia: (query) => ({ matches: Boolean(options.reducedMotion) && String(query).includes("prefers-reduced-motion") }),
    requestAnimationFrame: options.raf === false ? undefined : (cb) => { raf.push(cb); return raf.length; },
  };
  const doc = fakeDoc(view);
  const host = new FakeNode("div", doc);
  if (options.layout !== false) {
    host.getBoundingClientRect = () => ({ width: 800, height: 40 });
    host.clientWidth = 800;
  }
  helpers.paintStatsWindowLanes(host, model, handlers, memory);
  return { host, raf, doc, view };
}

test("window lanes model matches panel root order and distinct hues", () => {
  const report = laneReport();
  const worked = report.metrics.find((metric) => metric.id === "worked");
  const rows = helpers.statsPanelHomeRows(worked, report, "root_parent", null)
    .filter((row) => typeof row.value === "number" && row.value > 0);
  const ordered = helpers.statsPanelHomeAreaRows(rows, report);
  const hues = helpers.statsPanelDistinctHues(ordered, report);
  const model = helpers.statsWindowLanesModel(report);
  assert.equal(model.state, "ready");
  assert.equal(model.windowKey, "2026-09-30..2026-10-27");
  assert.deepEqual(model.roots.segments.map((segment) => segment.key), ordered.map((row) => row.key));
  assert.deepEqual(model.roots.segments.map((segment) => segment.hue), ordered.map((row) => hues.get(row.key)));
});

test("legend labels use the root note name for daily review tasks", () => {
  const model = helpers.statsWindowLanesModel(laneReport());
  const root = model.roots.legend.find((entry) => entry.key === "gtd_daily.md");
  assert.ok(root);
  assert.equal(root.legendLabel, "gtd_daily");
  assert.equal(model.roots.legend.some((entry) => entry.key === "@daily" || entry.key.startsWith("@review:")), false);
});

test("tones mark unattributed none, muted gray, and hashed other/unnamed as gray", () => {
  const model = helpers.statsWindowLanesModel(laneReport());
  const tone = (lane, key) => lane.segments.find((segment) => segment.key === key).tone;
  assert.equal(tone(model.roots, "@unlinked"), "none");
  assert.equal(tone(model.roots, "@unfiled"), "none");
  const dailyRoot = model.roots.segments.find((segment) => segment.key === "gtd_daily.md");
  assert.equal(dailyRoot.tone, "hue");
  assert.equal(dailyRoot.hue, "orange");
  assert.equal(tone(model.themes, "(unnamed)"), "none");
  assert.equal(tone(model.themes, "PLAN"), "gray");
  const hashed = helpers.statsThemeRef({
    theme_hues: { other: { name: "other", hue: "green", hue_source: "hash" } },
  }, "other");
  assert.equal(hashed.gray, true);
  assert.equal(hashed.hue, "gray");
  const unnamed = helpers.statsThemeRef(laneReport(), "(unnamed)");
  assert.equal(unnamed.gray, true);
});

test("theme order is coloured, gray, other, unnamed, with same-hue shades", () => {
  const report = laneReport();
  const model = helpers.statsWindowLanesModel(report);
  const keys = model.themes.segments.map((segment) => segment.key);
  assert.equal(keys.at(-1), "(unnamed)");
  assert.ok(keys.indexOf("BUILD") < keys.indexOf("PLAN"));
  assert.ok(keys.indexOf("PLAN") < keys.indexOf("(unnamed)"));
  const chore = model.themes.segments.find((segment) => segment.key === "CHORE");
  const decks = model.themes.segments.find((segment) => segment.key === "DECKS");
  const blog = model.themes.segments.find((segment) => segment.key === "BLOG");
  assert.equal(chore.hue, "orange");
  assert.equal(decks.hue, "orange");
  assert.equal(blog.hue, "orange");
  assert.equal(chore.shade, 0);
  assert.equal(decks.shade, 1);
  assert.equal(blog.shade, 2);
  const old = laneReport();
  old.metrics[0].parts_summary.theme = [
    { key: "BUILD", value: 100, display: "1h 40m", share: "40%" },
    { key: "READ", value: 80, display: "1h 20m", share: "32%" },
    { key: "WRITE", value: 30, display: "30m", share: "12%" },
    { key: "CHORE", value: 20, display: "20m", share: "8%" },
    { key: "BOB", value: 10, display: "10m", share: "4%" },
    { key: "other", value: 10, display: "10m", share: "4%" },
  ];
  const collapsed = helpers.statsWindowLanesModel(old);
  assert.deepEqual(collapsed.themes.segments.map((segment) => segment.key).slice(-1), ["other"]);
  assert.equal(collapsed.themes.segments.find((segment) => segment.key === "other").tone, "gray");
});

test("ranks, overflow, titles, meta, and area fallback", () => {
  const model = helpers.statsWindowLanesModel(laneReport());
  assert.ok(model.roots.segments.every((segment) => segment.rank >= 1));
  assert.equal(model.roots.overflowDefault.count, Math.max(0, model.roots.segments.length - 3));
  const bob = model.roots.segments.find((segment) => segment.key === "bob.md");
  assert.match(bob.title, /bob · 28h 36m · 23%/);
  const vibe = model.themes.segments.find((segment) => segment.key === "VIBE");
  assert.match(vibe.title, /not in your themes/);
  assert.equal(model.meta.text, "122h 55m worked");
  assert.match(model.meta.title, /Worked Sep 30 – Oct 27/);
  assert.match(model.meta.title, /complete days; today is not included/);
  const noToday = laneReport({ range: { includes_today: false } });
  const closed = helpers.statsWindowLanesModel(noToday);
  assert.equal(closed.meta.title.includes("complete days"), false);
  const areaOnly = laneReport();
  delete areaOnly.metrics[0].parts_summary.root_parent;
  const fallback = helpers.statsWindowLanesModel(areaOnly);
  assert.equal(fallback.roots.dimension, "area");
  assert.equal(fallback.roots.sentence, "Time by area");
  assert.equal(fallback.roots.panelView, "areas");
});

test("omitted and empty states, and a pin never changes the model", () => {
  assert.equal(helpers.statsWindowLanesModel(null).state, "omitted");
  const noWorked = laneReport();
  noWorked.metrics = [];
  assert.equal(helpers.statsWindowLanesModel(noWorked).state, "omitted");
  const counted = laneReport({ worked: { unit: "count" } });
  assert.equal(helpers.statsWindowLanesModel(counted).state, "omitted");
  const missingTotal = laneReport();
  missingTotal.metrics[0].summary.total = null;
  assert.equal(helpers.statsWindowLanesModel(missingTotal).state, "omitted");
  const zero = laneReport();
  zero.metrics[0].summary.total = { value: 0, display: "0m" };
  zero.metrics[0].parts_summary.root_parent = [];
  zero.metrics[0].parts_summary.theme = [];
  const empty = helpers.statsWindowLanesModel(zero);
  assert.equal(empty.state, "ready");
  assert.equal(empty.roots.empty, true);
  assert.equal(empty.themes.omitted, true);
  assert.equal(empty.meta.text, "0m worked");
  const noRoots = laneReport();
  noRoots.metrics[0].parts_summary.root_parent = [];
  noRoots.metrics[0].parts_summary.area = [];
  const themesOnly = helpers.statsWindowLanesModel(noRoots);
  assert.equal(themesOnly.roots.omitted, true);
  assert.equal(themesOnly.themes.omitted, false);
  const first = helpers.statsWindowLanesModel(laneReport());
  const second = helpers.statsWindowLanesModel(laneReport(), { pinnedDay: "2026-10-09" });
  assert.deepEqual(first.roots.segments.map((segment) => segment.key), second.roots.segments.map((segment) => segment.key));
  assert.deepEqual(first.themes.segments.map((segment) => segment.value), second.themes.segments.map((segment) => segment.value));
});

test("lanes render after the header and before the tiles", async () => {
  await withMissingConfig(async () => {
    const plugin = new LedgerToolsPlugin(makeFreshnessApp({ tasks: [] }), {});
    plugin.onload();
    try {
      const doc = fakeDoc();
      const el = fakeContainer(doc);
      const view = { el, sourcePath: "dash_stats.md", fence: {} };
      plugin.renderStatsResult(view, { report: laneReport() });
      const root = el.querySelector(".bob-stats");
      const classes = root.children.map((child) => child.getAttribute("class") || "");
      const header = classes.findIndex((name) => name.split(/\s+/).includes("bob-stats-header"));
      const lanes = classes.findIndex((name) => name.split(/\s+/).includes("bob-stats-lanes"));
      const tiles = classes.findIndex((name) => name.split(/\s+/).includes("bob-stats-tiles"));
      assert.ok(header >= 0 && lanes === header + 1 && tiles === lanes + 1);
    } finally {
      plugin.onunload();
    }
  });
});

test("legend is a keyboard stop, bar is aria-hidden, and activation does not fetch", async () => {
  await withMissingConfig(async () => {
    const plugin = new LedgerToolsPlugin(makeFreshnessApp({ tasks: [] }), {});
    plugin.onload();
    let fetches = 0;
    plugin.apiStatsFetch = async () => { fetches += 1; return { report: null }; };
    try {
      const doc = fakeDoc();
      const el = fakeContainer(doc);
      const view = { el, sourcePath: "dash_stats.md", fence: {} };
      plugin.renderStatsResult(view, { report: laneReport() });
      const legend = byAttr(el, "data-stats-focus-key", "lanes-themes")[0];
      assert.equal(legend.getAttribute("role"), "button");
      assert.equal(legend.getAttribute("tabindex"), "0");
      assert.match(legend.getAttribute("aria-label"), /Time by theme/);
      const bar = byClass(el, "bob-stats-lane-bar").find((node) =>
        (node.getAttribute("class") || "").includes("bob-stats-lane-themes"));
      assert.equal(bar.getAttribute("aria-hidden"), "true");
      assert.equal(bar.getAttribute("tabindex"), null);
      assert.ok(byAttr(bar, "data-key", "BUILD").length);
      legend.dispatch("click");
      const state = plugin.statsViewStateFor("dash_stats.md");
      assert.equal(state.focus, "worked");
      assert.equal(state.homesView, "themes");
      assert.equal(state.pinnedDay, null);
      assert.equal(state.pinnedBucket, null);
      assert.equal(fetches, 0);
      const rootsLegend = byAttr(el, "data-stats-focus-key", "lanes-roots")[0];
      rootsLegend.dispatch("keydown", { key: "Enter" });
      assert.equal(plugin.statsViewStateFor("dash_stats.md").homesView, "roots");
      rootsLegend.dispatch("keydown", { key: " " });
      assert.equal(fetches, 0);
    } finally {
      plugin.onunload();
    }
  });
});

test("hover dims other keys, +N lights hidden keys, and leaving clears", () => {
  const model = helpers.statsWindowLanesModel(laneReport());
  const { host } = paintHost(model);
  const lane = byAttr(host, "data-lane", "roots")[0];
  const bob = byAttr(lane, "data-key", "bob.md").find((node) =>
    (node.getAttribute("class") || "").includes("bob-stats-lane-segment"));
  bob.dispatch("pointerover");
  assert.equal(lane.getAttribute("data-hot"), "true");
  assert.equal(bob.getAttribute("data-hot"), "true");
  const sase = byAttr(lane, "data-key", "sase.md").find((node) =>
    (node.getAttribute("class") || "").includes("bob-stats-lane-segment"));
  assert.equal(sase.getAttribute("data-hot"), null);
  lane.dispatch("pointerleave");
  assert.equal(lane.getAttribute("data-hot"), null);
  const overflow = byClass(lane, "bob-day-strip-overflow")[0];
  overflow.dispatch("pointerover");
  const hidden = byClass(lane, "bob-day-strip-legend-item").filter((node) => node.hasAttribute("hidden"));
  assert.ok(hidden.length);
  for (const item of hidden) assert.equal(item.getAttribute("data-hot"), "true");
});

test("skeleton paints two empty tracks, morph only on a window change", () => {
  const doc = fakeDoc();
  const skeleton = helpers.statsWindowLanesSkeleton(doc);
  assert.ok((skeleton.getAttribute("class") || "").includes("bob-stats-lanes-skeleton"));
  const bars = byClass(skeleton, "bob-stats-lane-bar");
  assert.equal(bars.length, 2);
  assert.equal(bars[0].children.filter((child) => (child.getAttribute("class") || "").includes("bob-stats-lane-segment")).length, 0);
  const first = helpers.statsWindowLanesModel(laneReport());
  const { host: firstHost } = paintHost(first);
  assert.equal((firstHost.getAttribute("class") || "").includes("bob-stats-lanes-morph"), false);
  const secondReport = laneReport({ range: { start: "2026-10-01", end: "2026-10-28" } });
  const bobPart = secondReport.metrics[0].parts_summary.root_parent.find((part) => part.key === "bob.md");
  bobPart.value = 100;
  bobPart.display = "1h 40m";
  const second = helpers.statsWindowLanesModel(secondReport);
  const memory = { windowKey: first.windowKey, roots: first.roots.segments.map((segment) => [segment.key, segment.value]), themes: [] };
  const { host, raf } = paintHost(second, {}, memory);
  assert.ok((host.getAttribute("class") || "").includes("bob-stats-lanes-morph"));
  const bob = byAttr(host, "data-key", "bob.md").find((node) =>
    (node.getAttribute("class") || "").includes("bob-stats-lane-segment"));
  const oldBob = first.roots.segments.find((segment) => segment.key === "bob.md").value;
  assert.equal(bob.style.flexGrow, String(oldBob));
  assert.equal(raf.length, 1);
  raf[0]();
  assert.equal(bob.style.flexGrow, String(second.roots.segments.find((segment) => segment.key === "bob.md").value));
  const same = paintHost(second, {}, { windowKey: second.windowKey, roots: memory.roots, themes: [] });
  assert.equal((same.host.getAttribute("class") || "").includes("bob-stats-lanes-morph"), false);
  const reduced = paintHost(second, {}, memory, { reducedMotion: true });
  assert.equal((reduced.host.getAttribute("class") || "").includes("bob-stats-lanes-morph"), false);
  const noRaf = paintHost(second, {}, memory, { raf: false });
  assert.equal((noRaf.host.getAttribute("class") || "").includes("bob-stats-lanes-morph"), false);
  const noLayout = paintHost(second, {}, memory, { layout: false });
  assert.equal((noLayout.host.getAttribute("class") || "").includes("bob-stats-lanes-morph"), false);
});

test("releasing the chart view also releases the lanes fit observer", async () => {
  await withMissingConfig(async () => {
    const plugin = new LedgerToolsPlugin(makeFreshnessApp({ tasks: [] }), {});
    plugin.onload();
    try {
      const doc = fakeDoc();
      const el = fakeContainer(doc);
      const view = { el, sourcePath: "dash_stats.md", fence: {} };
      plugin.renderStatsResult(view, { report: laneReport() });
      assert.ok(view.statsLanesHost);
      const memory = view.statsLanesMemory;
      plugin.statsReleaseChartView(view);
      assert.equal(view.statsLanesHost, null);
      assert.equal(view.statsLanesMemory, memory);
    } finally {
      plugin.onunload();
    }
  });
});

test("Themes panel caps at 8 with N more / Show fewer unless other is present", async () => {
  await withMissingConfig(async () => {
    const plugin = new LedgerToolsPlugin(makeFreshnessApp({ tasks: [] }), {});
    plugin.onload();
    try {
      const doc = fakeDoc();
      const el = fakeContainer(doc);
      const view = { el, sourcePath: "dash_stats.md", fence: {} };
      plugin.statsViewStateFor("dash_stats.md").homesView = "themes";
      plugin.renderStatsResult(view, { report: laneReport() });
      const rows = byClass(el, "bob-stats-panel-bar-row");
      assert.equal(rows.length, 8);
      const more = byAttr(el, "data-stats-focus-key", "panel-theme-more")[0];
      assert.match(more.textContent, /more/);
      more.dispatch("click");
      assert.equal(plugin.statsViewStateFor("dash_stats.md").themeRowsExpanded, true);
      assert.ok(byClass(el, "bob-stats-panel-bar-row").length > 8);
      const fewer = byAttr(el, "data-stats-focus-key", "panel-theme-more")[0];
      assert.equal(fewer.textContent, "Show fewer");
      const old = laneReport();
      old.metrics[0].parts_summary.theme = Array.from({ length: 6 }, (_, index) => ({
        key: index === 5 ? "other" : "T" + index,
        value: 10 - index,
        display: (10 - index) + "m",
        share: "10%",
      }));
      plugin.statsViewStateFor("dash_stats.md").themeRowsExpanded = false;
      plugin.renderStatsResult(view, { report: old });
      assert.equal(byClass(el, "bob-stats-panel-bar-row").length, 6);
      assert.equal(byAttr(el, "data-stats-focus-key", "panel-theme-more").length, 0);
    } finally {
      plugin.onunload();
    }
  });
});

test("stats window lanes stylesheet contract", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "plugins", "bob-ledger-tools", "styles.css"), "utf8");
  const marker = "Daily Stats page block (bob-cli-6l page)";
  const section = css.slice(css.indexOf(marker));
  for (const token of [
    ".bob-stats-lanes",
    ".bob-stats-lane-segment",
    "height: 6px",
    "[data-tone=\"gray\"] + .bob-stats-lane-segment[data-tone=\"gray\"]",
    "[data-tone=\"none\"] + .bob-stats-lane-segment[data-tone=\"none\"]",
    "prefers-reduced-motion",
    "forced-colors",
    "CanvasText",
    "GrayText",
    "cubic-bezier(.2, .8, .2, 1)",
  ]) {
    assert.ok(section.includes(token), token);
  }
});
