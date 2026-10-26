const assert = require("node:assert/strict");
const test = require("node:test");
const {
  LedgerToolsPlugin,
  makeFreshnessApp,
  withMissingConfig,
} = require("./ledger-tools-harness.cjs");

const helpers = LedgerToolsPlugin.helpers;

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
    this._text = "";
    this.value = "";
    this.hidden = false;
    this.isContentEditable = false;
    this.classList = {
      add: (name) => this.addClass(name),
      remove: (name) => this.removeClass(name),
      contains: (name) => this.hasClass(name),
    };
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
    return this._text;
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

  addClass(name) {
    const names = (this.getAttribute("class") || "").split(/\s+/).filter(Boolean);
    if (!names.includes(name)) names.push(name);
    this.setAttribute("class", names.join(" "));
  }

  removeClass(name) {
    const names = (this.getAttribute("class") || "").split(/\s+/).filter((value) => value && value !== name);
    this.setAttribute("class", names.join(" "));
  }

  hasClass(name) {
    return (this.getAttribute("class") || "").split(/\s+/).includes(name);
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

  removeEventListener(name, handler) {
    this.listeners.set(name, (this.listeners.get(name) || []).filter((item) => item !== handler));
  }

  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
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
    if (this.hasClass(wanted)) return this;
    for (const child of this.children) {
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  querySelectorAll(selector, result = []) {
    const wanted = String(selector || "").startsWith(".") ? String(selector).slice(1) : "";
    if (wanted && this.hasClass(wanted)) result.push(this);
    for (const child of this.children) child.querySelectorAll(selector, result);
    return result;
  }

  get text() {
    return [this._text, ...this.children.map((child) => child.text)].filter(Boolean).join(" ");
  }
}

function fakeDoc() {
  const doc = {
    activeElement: null,
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

function daily(date, value, extra = {}) {
  return {
    date,
    end: date,
    value,
    display: value === null ? "–" : String(value),
    quality: value === null ? "missing" : "ok",
    provisional: false,
    parts: {},
    parts_display: {},
    ...extra,
  };
}

function chartReport() {
  const worked = {
    id: "worked",
    label: "Worked",
    kind: "pomodoro",
    unit: "minutes",
    color: "orange",
    definition: "Worked minutes from closed ledger rows",
    source: "daily Pomodoros",
    since: "2026-06-01",
    limits: ["Open sessions are not counted"],
    summary: { p25: 110, p75: 330, headline: { display: "4h 50m" } },
    chart: { group: "week", p25: 180, p75: 420 },
    points: [
      {
        date: "2026-10-05", end: "2026-10-10", value: 360, display: "6h",
        quality: "ok", provisional: false, partial: true, rolling_median: 300,
        parts: { theme: { GTD: 65, SASE: 295 } },
        parts_display: { theme: { GTD: "1h 05m", SASE: "4h 55m" } },
      },
      {
        date: "2026-10-11", end: "2026-10-11", value: 25, display: "25m",
        quality: "ok", provisional: true, rolling_median: null,
        parts: { theme: { GTD: 25 } }, parts_display: { theme: { GTD: "25m" } },
      },
    ],
    prior_points: [
      { date: "2026-09-28", end: "2026-10-03", value: 240, display: "4h", quality: "ok", partial: true },
      { date: "2026-10-04", end: "2026-10-10", value: 300, display: "5h", quality: "ok" },
    ],
    daily_points: [
      daily("2026-10-05", 65, { display: "1h 05m", parts: { theme: { GTD: 65 } }, parts_display: { theme: { GTD: "1h 05m" } } }),
      daily("2026-10-06", null, { reason: "no daily note" }),
      daily("2026-10-07", 180, { display: "3h", parts: { theme: { SASE: 180 } }, parts_display: { theme: { SASE: "3h" } } }),
      daily("2026-10-08", 220, { display: "3h 40m" }),
      daily("2026-10-09", 130, { display: "2h 10m" }),
      daily("2026-10-10", 160, { display: "2h 40m" }),
      daily("2026-10-11", 25, { display: "25m", provisional: true }),
    ],
  };
  const sessions = {
    id: "sessions", label: "Sessions", kind: "pomodoro", unit: "count", color: "orange",
    chart: { group: "day", p25: 1, p75: 3 },
    points: [
      daily("2026-10-05", 3, { display: "3" }),
      daily("2026-10-11", 2, { display: "2" }),
    ],
    daily_points: [],
  };
  const habits = {
    id: "habits", label: "Habits", kind: "checklist", unit: "ratio", color: "green",
    definition: "PRE chores met divided by chores due",
    source: "daily checklist",
    chart: { group: "day", p25: 5000, p75: 9000 },
    points: [
      daily("2026-10-09", 9500, { display: "95%", rolling_median: 8000 }),
      daily("2026-10-10", null, { display: "–", quality: "missing", reason: "nothing tracked" }),
      daily("2026-10-11", 5000, { display: "50%", provisional: true, rolling_median: null }),
    ],
  };
  const custom = {
    id: "custom_signal", label: "Custom signal", kind: "field", unit: "signed", color: "blue",
    definition: "Unsafe looking metric text <img src=x>",
    source: "frontmatter",
    chart: { group: "day", p25: -3, p75: 0 },
    points: [
      daily("2026-10-09", -4, { display: "−4", rolling_median: -2, partial: true }),
      daily("2026-10-10", 0, { display: "0" }),
      daily("2026-10-11", 3, { display: "+3", provisional: true }),
    ],
    prior_points: [
      daily("2026-10-06", -1, { display: "−1" }),
      daily("2026-10-07", 1, { display: "+1" }),
    ],
  };
  return {
    ok: true,
    today: "2026-10-11",
    range: { preset: "4w", label: "Oct 5 – Oct 10", includes_today: true },
    metrics: [worked, sessions, habits, custom],
    health: {},
    warnings: [],
  };
}

function findByFocus(root, key) {
  const pending = [root];
  while (pending.length) {
    const node = pending.pop();
    if (node.getAttribute("data-stats-focus-key") === key) return node;
    pending.push(...node.children);
  }
  return null;
}

function findTag(root, tagName) {
  const wanted = String(tagName).toUpperCase();
  const pending = [root];
  while (pending.length) {
    const node = pending.pop();
    if (node.tagName === wanted) return node;
    pending.push(...node.children);
  }
  return null;
}

test("Stats chart geometry stays finite across empty, constant, signed, and narrow inputs", () => {
  assert.deepEqual(helpers.statsChartDomain([], "count"), [0, 1]);
  assert.deepEqual(helpers.statsChartDomain([0, 0], "count"), [0, 1]);
  assert.deepEqual(helpers.statsChartDomain([-5, -2], "signed"), [-5.3, 0]);
  assert.deepEqual(helpers.statsChartDomain([2, 2], "count"), [0, 2.12]);
  assert.deepEqual(helpers.statsChartDomain([100, 9500], "ratio"), [0, 10000]);
  const minutes = helpers.statsChartTicks([0, 700], "minutes", 5);
  assert.ok(minutes.step >= 60 && minutes.step % 60 === 0);
  assert.ok(minutes.values.every(Number.isFinite));
  assert.equal(helpers.statsChartFormatTick(8500, "ratio", 2000), "85%");
  const slots = helpers.statsChartPointSlots(5, 20, 100);
  assert.equal(slots.length, 5);
  assert.ok(slots.every((slot) => slot.width <= 24 && slot.width >= 0));
  const path = helpers.statsRoundedTerminalBarPath(2, 50, 10, 20, 4);
  assert.match(path, /Q/);
  assert.doesNotMatch(path, /NaN|Infinity/);
  assert.equal(helpers.statsRoundedTerminalBarPath(0, 4, 4, 10, 4), "");
  const negative = helpers.statsRoundedTerminalBarPath(2, 10, 50, 20, 4);
  assert.match(negative, /50/);
  const line = helpers.statsLinePath([
    { rolling_median: 10 }, { rolling_median: null }, { rolling_median: 20 },
  ], [0, 1, 2], (value) => 100 - value);
  assert.equal(line, "M 0 90 M 2 80");
  assert.deepEqual(helpers.statsResponsiveLabelDensity(360, 40).xIndices, [0, 39]);
  assert.ok(helpers.statsResponsiveLabelDensity(1000, 40).xIndices.length < 12);
});

test("prior buckets align by elapsed position and omit invalid and provisional points", () => {
  const current = [
    { date: "2026-10-01", end: "2026-10-07" },
    { date: "2026-10-08", end: "2026-10-14" },
    { date: "2026-10-15", end: "2026-10-15", provisional: true },
  ];
  const prior = [
    { date: "2026-09-10", end: "2026-09-16", value: 1, partial: true },
    { date: "2026-09-17", end: "2026-09-23", value: 2 },
    { date: "bad-date", end: "bad-date", value: 3 },
  ];
  const aligned = helpers.statsAlignPriorPoints(current, prior);
  assert.equal(aligned.length, 2);
  assert.ok(aligned[0].ratio > 0 && aligned[0].ratio < aligned[1].ratio);
  assert.equal(aligned[0].partial, true);
  assert.equal(aligned[0].unmatchedEdge, true);
});

test("chart renders SVG safely and keeps secondary focus metrics selectable", async () => {
  await withMissingConfig(async () => {
    const app = makeFreshnessApp({ tasks: [] });
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.onload();
    try {
      const doc = fakeDoc();
      const el = fakeContainer(doc);
      const view = { el, sourcePath: "dash_stats.md", fence: { metrics: ["worked"], focus: "custom_signal" } };
      plugin.renderStatsResult(view, { report: chartReport() });
      const root = el.querySelector(".bob-stats");
      const svg = el.querySelector(".bob-stats-chart-svg");
      assert.ok(svg, "SVG chart renders through the injected document");
      assert.equal(svg.namespaceURI, helpers.STATS_SVG_NS);
      assert.equal(findByFocus(root, "focus-selector").value, "custom_signal");
      assert.equal(el.querySelectorAll(".bob-stats-tile").length, 1, "fence limits only overview tiles");
      assert.ok(el.querySelector(".bob-stats-chart-today"), "today has an unfilled outline");
      assert.ok(el.querySelector(".bob-stats-chart-band"), "the report band is drawn");
      assert.ok(el.querySelector(".bob-stats-chart-median"), "supplied rolling median is drawn");
      assert.ok(el.querySelector(".bob-stats-chart-prior"), "prior comparison is drawn");
      assert.match(el.text, /Typical daily range/);
      assert.match(el.text, /Partial buckets/);
      findByFocus(root, "definition-toggle").dispatch("click");
      assert.match(el.text, /Unsafe looking metric text <img src=x>/);
      assert.equal(findTag(root, "img"), null, "metric labels use text, never HTML");
    } finally {
      plugin.onunload();
    }
  });
});

test("grouped chart pins honest buckets, bounds daily detail, and opens validated notes", async () => {
  await withMissingConfig(async () => {
    const opened = [];
    const app = makeFreshnessApp({ tasks: [] });
    app.workspace.openLinkText = (...args) => opened.push(args);
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.onload();
    try {
      const doc = fakeDoc();
      const el = fakeContainer(doc);
      const view = { el, sourcePath: "dash_stats.md", fence: { focus: "worked" } };
      plugin.renderStatsResult(view, { report: chartReport() });
      const firstHit = el.querySelectorAll(".bob-stats-chart-hit")[0];
      assert.match(firstHit.getAttribute("aria-label"), /6h, 10\/05–10\/10, Partial bucket, theme: SASE — 4h 55m/);
      firstHit.dispatch("click");
      assert.equal(plugin.statsViewStateFor("dash_stats.md").pinnedDay, "2026-10-05");
      assert.match(el.text, /1h 05m/);
      assert.match(el.text, /Sessions: 3/);
      const daySelect = findByFocus(el.querySelector(".bob-stats"), "day-selector");
      assert.ok(daySelect);
      assert.deepEqual(daySelect.children.map((option) => option.value), [
        "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10",
      ]);
      daySelect.value = "2026-10-06";
      daySelect.dispatch("change");
      assert.equal(plugin.statsViewStateFor("dash_stats.md").pinnedDay, "2026-10-06");
      assert.match(el.text, /no daily note/);
      const openButton = findByFocus(el.querySelector(".bob-stats"), "open-daily-note");
      openButton.dispatch("click", { metaKey: true });
      assert.deepEqual(opened, [["2026/20261006.md", "dash_stats.md", true]], "missing-value dates may still be opened");
      assert.equal(helpers.statsIsoOrdinal("2026-02-30"), null);
    } finally {
      plugin.onunload();
    }
  });
});

test("local focus, table, pin, and definition changes reuse the retained report", async () => {
  await withMissingConfig(async () => {
    const app = makeFreshnessApp({ tasks: [] });
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.onload();
    try {
      let fetches = 0;
      plugin.apiStatsFetch = async () => {
        fetches += 1;
        return { report: chartReport(), stale: false };
      };
      const doc = fakeDoc();
      const el = fakeContainer(doc);
      const view = { el, sourcePath: "dash_stats.md", fence: { focus: "worked" } };
      plugin.renderStatsResult(view, { report: chartReport() });
      const focus = findByFocus(el.querySelector(".bob-stats"), "focus-selector");
      focus.focus();
      focus.value = "habits";
      focus.dispatch("change");
      assert.equal(plugin.statsViewStateFor("dash_stats.md").focus, "habits");
      assert.equal(doc.activeElement.getAttribute("data-stats-focus-key"), "focus-selector", "focus survives local redraw");
      assert.equal(fetches, 0, "focus change does not spawn bob");
      const table = findByFocus(el.querySelector(".bob-stats"), "table-toggle");
      table.focus();
      table.dispatch("click");
      assert.ok(el.querySelector(".bob-stats-table"));
      assert.equal(fetches, 0, "table toggle is local");
      const definition = findByFocus(el.querySelector(".bob-stats"), "definition-toggle");
      definition.focus();
      definition.dispatch("click");
      assert.equal(doc.activeElement.getAttribute("data-stats-focus-key"), "definition-toggle");
      assert.ok(el.querySelector(".bob-stats-definition-panel"));
      findByFocus(el.querySelector(".bob-stats"), "definition-close").focus();
      findByFocus(el.querySelector(".bob-stats"), "definition-close").dispatch("keydown", { key: "Escape" });
      assert.equal(plugin.statsViewStateFor("dash_stats.md").definitionOpen, false);
      assert.equal(doc.activeElement.getAttribute("data-stats-focus-key"), "definition-toggle");
      assert.equal(fetches, 0);
    } finally {
      plugin.onunload();
    }
  });
});

test("keyboard moves the daily cursor, cycles metrics, exempts controls, and fetches only shifts", async () => {
  await withMissingConfig(async () => {
    const app = makeFreshnessApp({ tasks: [] });
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.onload();
    try {
      const calls = [];
      plugin.apiStatsFetch = async (args) => {
        calls.push(args);
        return { report: chartReport(), stale: false };
      };
      const doc = fakeDoc();
      const el = fakeContainer(doc);
      const view = { el, sourcePath: "dash_stats.md", fence: { focus: "worked" } };
      plugin.renderStatsResult(view, { report: chartReport() });
      const state = plugin.statsViewStateFor("dash_stats.md");
      state.cursorDay = "2026-10-05";
      const root = el.querySelector(".bob-stats");
      root.dispatch("keydown", { key: "ArrowRight" });
      assert.equal(state.cursorDay, "2026-10-06");
      assert.equal(calls.length, 0);
      assert.ok(findByFocus(root, "range-next").getAttribute("disabled"), "forward shift is disabled at offset zero");
      el.querySelector(".bob-stats").dispatch("keydown", { key: "j" });
      assert.equal(state.focus, "sessions");
      const selector = findByFocus(el.querySelector(".bob-stats"), "focus-selector");
      selector.dispatch("keydown", { key: "j" });
      assert.equal(state.focus, "sessions", "native select keeps its own keys");
      el.querySelector(".bob-stats").dispatch("keydown", { key: "l" });
      assert.equal(state.offset, 0);
      assert.equal(calls.length, 0, "forward shift at the newest window does not fetch");
      el.querySelector(".bob-stats").dispatch("keydown", { key: "ArrowRight", ctrlKey: true });
      assert.equal(state.cursorDay, "2026-10-06", "modified shortcuts are ignored");
      el.querySelector(".bob-stats").dispatch("keydown", { key: "h" });
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal(state.offset, 1);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].offset, 1);
      assert.equal(doc.activeElement.getAttribute("data-stats-focus-key"), "range-previous");
      state.range = "all";
      plugin.renderStatsResult(view, { report: chartReport() });
      assert.ok(findByFocus(el.querySelector(".bob-stats"), "range-previous").getAttribute("disabled"));
      assert.ok(findByFocus(el.querySelector(".bob-stats"), "range-next").getAttribute("disabled"));
      el.querySelector(".bob-stats").dispatch("keydown", { key: "h" });
      assert.equal(calls.length, 1, "all range cannot be shifted");
    } finally {
      plugin.onunload();
    }
  });
});

test("schema-1 fallback keeps day quartiles and never invents grouped daily history", async () => {
  await withMissingConfig(async () => {
    const plugin = new LedgerToolsPlugin(makeFreshnessApp({ tasks: [] }), {});
    plugin.onload();
    try {
      const doc = fakeDoc();
      const el = fakeContainer(doc);
      const grouped = chartReport();
      grouped.range.group = "week";
      delete grouped.metrics[0].chart;
      delete grouped.metrics[0].daily_points;
      const groupedView = { el, sourcePath: "grouped.md", fence: { focus: "worked" } };
      plugin.renderStatsResult(groupedView, { report: grouped });
      assert.equal(el.querySelector(".bob-stats-chart-band"), null);
      assert.match(el.text, /Grouped range band unavailable/);
      assert.match(el.text, /Daily detail is unavailable for this grouped report schema/);

      const daily = chartReport();
      daily.range.group = "day";
      daily.metrics[0].points = [daily.metrics[0].daily_points[5]];
      delete daily.metrics[0].chart;
      delete daily.metrics[0].daily_points;
      const dailyView = { el: fakeContainer(doc), sourcePath: "daily.md", fence: { focus: "worked" } };
      plugin.renderStatsResult(dailyView, { report: daily });
      assert.ok(dailyView.el.querySelector(".bob-stats-chart-band"));
      assert.equal(dailyView.el.querySelector(".bob-stats-chart-band").getAttribute("data-band-group"), "day");
    } finally {
      plugin.onunload();
    }
  });
});

test("ResizeObserver redraws cached data and disconnects across rerenders and unload", async () => {
  await withMissingConfig(async () => {
    const original = global.ResizeObserver;
    const observers = [];
    global.ResizeObserver = class {
      constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
      observe(target) { this.target = target; }
      disconnect() { this.disconnected = true; }
      emit(width) { this.callback([{ contentRect: { width } }]); }
    };
    const plugin = new LedgerToolsPlugin(makeFreshnessApp({ tasks: [] }), {});
    plugin.onload();
    try {
      const doc = fakeDoc();
      const el = fakeContainer(doc);
      const view = { el, sourcePath: "dash_stats.md", fence: { focus: "worked" } };
      plugin.renderStatsResult(view, { report: chartReport() });
      assert.equal(observers.length, 1);
      observers[0].emit(380);
      await new Promise((resolve) => setTimeout(resolve, 130));
      assert.equal(view.chartWidth, 380);
      assert.equal(observers[0].disconnected, true);
      assert.equal(observers.length, 2);
      plugin.statsReleaseChartView(view);
      assert.equal(observers[1].disconnected, true);
    } finally {
      plugin.onunload();
      if (original === undefined) delete global.ResizeObserver;
      else global.ResizeObserver = original;
    }
  });
});
