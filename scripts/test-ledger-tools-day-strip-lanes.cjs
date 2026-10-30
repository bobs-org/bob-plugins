// Day strip lane switch: both, roots only, themes only.
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  LedgerToolsPlugin,
  TestNotice,
  makeFreshnessApp,
  withMissingConfig,
} = require("./ledger-tools-harness.cjs");

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
    this._focused = false;
    this._focusOpts = null;
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

  focus(opts) {
    this._focused = true;
    this._focusOpts = opts || null;
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
    activeElement: null,
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
  return { doc, root, returned: helpers.paintDayStrip(root, model, handlers) };
}

function modelFor(fixture, overrides = {}) {
  return helpers.dayStripModel(fixture.report, fixture.day, {
    localToday: fixture.localToday,
    fetchedAt: fixture.fetchedAt,
    ...overrides,
  });
}

function makeApp(overrides = {}) {
  const store = new Map();
  const app = makeFreshnessApp({ tasks: [] });
  app.loadLocalStorage = (key) => (store.has(key) ? store.get(key) : null);
  app.saveLocalStorage = (key, value) => {
    store.set(key, value);
  };
  app.__store = store;
  Object.assign(app, overrides);
  return app;
}

async function makePlugin(app) {
  const plugin = new LedgerToolsPlugin(app || makeApp(), {});
  plugin.onload();
  plugin.dayStripRecheckDelayMs = 15;
  return plugin;
}

test("lane view sanitizes and cycles both -> roots -> themes -> both", () => {
  assert.equal(helpers.dayStripLaneViewOf("both"), "both");
  assert.equal(helpers.dayStripLaneViewOf("roots"), "roots");
  assert.equal(helpers.dayStripLaneViewOf("themes"), "themes");
  assert.equal(helpers.dayStripLaneViewOf("bogus"), "both");
  assert.equal(helpers.dayStripLaneViewOf(null), "both");
  assert.equal(helpers.dayStripLaneViewOf(undefined), "both");
  assert.equal(helpers.dayStripNextLaneView("both"), "roots");
  assert.equal(helpers.dayStripNextLaneView("roots"), "themes");
  assert.equal(helpers.dayStripNextLaneView("themes"), "both");
  assert.equal(helpers.dayStripNextLaneView("bogus"), "roots");
});

test("layout matrix: availability, skeleton, and hidden states", () => {
  const avail = (dimension) => ({
    segments: [{ key: "a" }],
    legend: [],
    overflow: [],
    overflowDefault: { count: 0, title: "" },
    empty: false,
    omitted: false,
    dimension,
    title: "",
  });
  const omitted = (dimension) => ({
    segments: [],
    legend: [],
    overflow: [],
    overflowDefault: { count: 0, title: "" },
    empty: false,
    omitted: true,
    dimension,
    title: "",
  });
  const roots = avail("root_parent");
  const themes = avail("theme");
  // Both available.
  assert.deepEqual(helpers.dayStripLaneLayout({ state: "ready", mix: roots, themes, view: "both" }).shown, ["roots", "themes"]);
  assert.equal(helpers.dayStripLaneLayout({ state: "ready", mix: roots, themes, view: "both" }).switchable, true);
  assert.deepEqual(helpers.dayStripLaneLayout({ state: "ready", mix: roots, themes, view: "roots" }).shown, ["roots"]);
  assert.deepEqual(helpers.dayStripLaneLayout({ state: "ready", mix: roots, themes, view: "themes" }).shown, ["themes"]);
  // Stale matches ready.
  assert.deepEqual(helpers.dayStripLaneLayout({ state: "stale", mix: roots, themes, view: "both" }).shown, ["roots", "themes"]);
  // Themes omitted falls back to roots.
  assert.deepEqual(helpers.dayStripLaneLayout({ state: "ready", mix: roots, themes: omitted("theme"), view: "both" }).shown, ["roots"]);
  assert.deepEqual(helpers.dayStripLaneLayout({ state: "ready", mix: roots, themes: omitted("theme"), view: "themes" }).shown, ["roots"]);
  assert.equal(helpers.dayStripLaneLayout({ state: "ready", mix: roots, themes: omitted("theme"), view: "both" }).switchable, false);
  // Roots omitted falls back to themes.
  assert.deepEqual(helpers.dayStripLaneLayout({ state: "ready", mix: omitted(null), themes, view: "both" }).shown, ["themes"]);
  assert.deepEqual(helpers.dayStripLaneLayout({ state: "ready", mix: omitted(null), themes, view: "roots" }).shown, ["themes"]);
  // Neither available.
  assert.deepEqual(helpers.dayStripLaneLayout({ state: "ready", mix: omitted(null), themes: omitted("theme"), view: "both" }).shown, []);
  assert.equal(helpers.dayStripLaneLayout({ state: "ready", mix: omitted(null), themes: omitted("theme"), view: "both" }).switchable, false);
  // Zero day: roots empty but available, themes omitted.
  const zeroRoots = { ...avail("root_parent"), empty: true, segments: [] };
  assert.deepEqual(helpers.dayStripLaneLayout({ state: "ready", mix: zeroRoots, themes: omitted("theme"), view: "both" }).shown, ["roots"]);
  // Skeleton per view.
  assert.deepEqual(helpers.dayStripLaneLayout({ state: "skeleton", mix: roots, themes, view: "both" }).shown, ["roots", "themes"]);
  assert.deepEqual(helpers.dayStripLaneLayout({ state: "skeleton", mix: roots, themes, view: "roots" }).shown, ["roots"]);
  assert.deepEqual(helpers.dayStripLaneLayout({ state: "skeleton", mix: roots, themes, view: "themes" }).shown, ["themes"]);
  // Unavailable, future, hidden have no lanes.
  for (const state of ["unavailable", "future", "hidden"]) {
    const layout = helpers.dayStripLaneLayout({ state, mix: roots, themes, view: "both" });
    assert.deepEqual(layout.shown, [], `${state} shows nothing`);
    assert.equal(layout.switchable, false);
  }
  // Never throws.
  assert.doesNotThrow(() => helpers.dayStripLaneLayout(null));
  assert.doesNotThrow(() => helpers.dayStripLaneLayout({}));
});

test("layout copy uses areas under the area fallback with exact strings", () => {
  const roots = {
    segments: [], legend: [], overflow: [], overflowDefault: { count: 0, title: "" },
    empty: false, omitted: false, dimension: "root_parent", title: "",
  };
  const areaRoots = { ...roots, dimension: "area" };
  const themes = {
    segments: [], legend: [], overflow: [], overflowDefault: { count: 0, title: "" },
    empty: false, omitted: false, dimension: "theme", title: "",
  };
  const both = helpers.dayStripLaneLayout({ state: "ready", mix: roots, themes, view: "both" });
  assert.equal(both.title, "Showing root parents and themes \u00b7 click for root parents only");
  assert.equal(both.ariaLabel, "Day stats bars: root parents and themes. Activate for root parents only.");
  const rootsOnly = helpers.dayStripLaneLayout({ state: "ready", mix: roots, themes, view: "roots" });
  assert.equal(rootsOnly.title, "Showing root parents only \u00b7 click for themes only");
  assert.equal(rootsOnly.ariaLabel, "Day stats bars: root parents only. Activate for themes only.");
  const themesOnly = helpers.dayStripLaneLayout({ state: "ready", mix: roots, themes, view: "themes" });
  assert.equal(themesOnly.title, "Showing themes only \u00b7 click for both");
  assert.equal(themesOnly.ariaLabel, "Day stats bars: themes only. Activate for root parents and themes.");
  const areaBoth = helpers.dayStripLaneLayout({ state: "ready", mix: areaRoots, themes, view: "both" });
  assert.equal(areaBoth.title, "Showing areas and themes \u00b7 click for areas only");
  assert.equal(areaBoth.ariaLabel, "Day stats bars: areas and themes. Activate for areas only.");
  const areaRootsOnly = helpers.dayStripLaneLayout({ state: "ready", mix: areaRoots, themes, view: "roots" });
  assert.equal(areaRootsOnly.title, "Showing areas only \u00b7 click for themes only");
});

test("painter per view: order, first-row meta and switch, themes-first", () => {
  const fixture = fixtures.today;
  for (const view of ["both", "roots", "themes"]) {
    const { root } = paint(modelFor(fixture, { laneView: view }));
    const rows = byClass(root, "bob-day-strip-mix-row");
    const bars = byClass(root, "bob-day-strip-bar");
    if (view === "both") {
      assert.equal(rows.length, 2, "both paints two rows");
      assert.equal(bars.length, 2, "both paints two bars");
      assert.equal(rows[0].getAttribute("data-lane"), "roots");
      assert.equal(bars[0].getAttribute("data-lane"), "roots");
      assert.equal(rows[1].getAttribute("data-lane"), "themes");
      assert.equal(bars[1].getAttribute("data-lane"), "themes");
      assert.equal(root.children[1], rows[0]);
      assert.equal(root.children[2], bars[0]);
      assert.equal(root.children[3], rows[1]);
      assert.equal(root.children[4], bars[1]);
      assert.ok(byClass(rows[0], "bob-day-strip-meta").length, "first row carries the meta");
      assert.ok(byClass(rows[0], "bob-day-strip-lanes").length, "first row carries the switch");
      assert.equal(byClass(rows[1], "bob-day-strip-meta").length, 0, "second row carries no meta");
      assert.equal(byClass(rows[1], "bob-day-strip-lanes").length, 0, "second row carries no switch");
    } else if (view === "roots") {
      assert.equal(rows.length, 1, "roots paints one row");
      assert.equal(bars.length, 1, "roots paints one bar");
      assert.equal(rows[0].getAttribute("data-lane"), "roots");
      assert.equal(bars[0].getAttribute("data-lane"), "roots");
      assert.ok(byClass(rows[0], "bob-day-strip-meta").length);
      assert.ok(byClass(rows[0], "bob-day-strip-lanes").length);
      assert.equal(bars[0], root.children[root.children.length - 1], "the bar is the strip's last line");
    } else {
      assert.equal(rows.length, 1, "themes paints one row");
      assert.equal(bars.length, 1, "themes paints one bar");
      assert.equal(rows[0].getAttribute("data-lane"), "themes");
      assert.equal(bars[0].getAttribute("data-lane"), "themes");
      assert.ok(byClass(rows[0], "bob-day-strip-meta").length, "themes-first row takes the meta");
      assert.ok(byClass(rows[0], "bob-day-strip-lanes").length, "themes-first row takes the switch");
      assert.equal(bars[0], root.children[root.children.length - 1]);
    }
    assert.equal(findAll(root, (node) => node.tagName === "BUTTON").length, 0, "no <button>");
  }
  // Single-lane fallback: roots requested but only themes available.
  const areaOnly = fixtures.areaOnly;
  const fallback = helpers.dayStripModel(areaOnly.report, areaOnly.day, {
    localToday: areaOnly.localToday,
    fetchedAt: areaOnly.fetchedAt,
    laneView: "roots",
  });
  assert.deepEqual(fallback.lanes.shown, ["roots"], "area-only still has roots");
  const redefined = modelFor(fixtures.redefinedWorked, { laneView: "both" });
  assert.deepEqual(redefined.lanes.shown, [], "redefined worked shows neither");
  const redefinedPaint = paint(redefined).root;
  assert.equal(byClass(redefinedPaint, "bob-day-strip-lanes").length, 0, "no switch when not switchable");
  assert.ok(byClass(redefinedPaint, "bob-day-strip-meta").length, "roots row holds the meta alone");
});

test("switch attributes, marks, and skeleton placeholder", () => {
  const { root } = paint(modelFor(fixtures.today, { laneView: "both" }));
  const sw = byClass(root, "bob-day-strip-lanes")[0];
  assert.ok(sw, "switch paints when both lanes are available");
  assert.equal(sw.getAttribute("role"), "button");
  assert.equal(sw.getAttribute("tabindex"), "0");
  assert.equal(sw.getAttribute("data-view"), "both");
  assert.ok(sw.getAttribute("aria-label"));
  assert.ok(sw.getAttribute("title"));
  const marks = byClass(sw, "bob-day-strip-lanes-mark");
  assert.equal(marks.length, 2);
  const rootsMark = marks.find((node) => (node.getAttribute("class") || "").includes("bob-day-strip-lanes-mark-roots"));
  const themesMark = marks.find((node) => (node.getAttribute("class") || "").includes("bob-day-strip-lanes-mark-themes"));
  assert.ok(rootsMark && themesMark);
  assert.equal(rootsMark.getAttribute("data-on"), "true");
  assert.equal(themesMark.getAttribute("data-on"), "true");
  assert.equal(rootsMark.getAttribute("aria-hidden"), "true");
  const rootsOnly = paint(modelFor(fixtures.today, { laneView: "roots" })).root;
  const rootsSw = byClass(rootsOnly, "bob-day-strip-lanes")[0];
  assert.equal(rootsSw.getAttribute("data-view"), "roots");
  assert.equal(byClass(rootsSw, "bob-day-strip-lanes-mark-roots")[0].getAttribute("data-on"), "true");
  assert.equal(byClass(rootsSw, "bob-day-strip-lanes-mark-themes")[0].getAttribute("data-on"), "false");
  // Skeleton placeholder is inert.
  const skeleton = helpers.dayStripModel(null, fixtures.today.day, { localToday: fixtures.today.localToday, laneView: "both" });
  const { root: skeletonRoot } = paint(skeleton);
  const placeholder = byClass(skeletonRoot, "bob-day-strip-lanes")[0];
  assert.ok(placeholder, "skeleton paints the placeholder");
  assert.equal(placeholder.getAttribute("tabindex"), null, "placeholder has no tabindex");
  assert.equal(placeholder.getAttribute("role"), null, "placeholder has no role");
  assert.equal((placeholder.listeners.get("click") || []).length, 0, "placeholder has no listeners");
  assert.equal(findAll(skeletonRoot, (node) => node.tagName === "BUTTON").length, 0);
});

test("switch activation: click, Enter, Space call cycleLanes once with focus", () => {
  const calls = [];
  const { doc, root } = paint(modelFor(fixtures.today, { laneView: "both" }), {
    cycleLanes: (opts) => calls.push(opts),
  });
  const sw = byClass(root, "bob-day-strip-lanes")[0];
  doc.activeElement = null;
  sw.dispatch("click", { button: 0 });
  assert.deepEqual(calls.pop(), { focused: false });
  doc.activeElement = sw;
  sw.dispatch("click", { button: 0 });
  assert.deepEqual(calls.pop(), { focused: true });
  doc.activeElement = null;
  sw.dispatch("keydown", { key: "Enter" });
  assert.deepEqual(calls.pop(), { focused: false });
  doc.activeElement = sw;
  sw.dispatch("keydown", { key: " " });
  assert.deepEqual(calls.pop(), { focused: true });
  const mousedown = sw.dispatch("mousedown", { button: 0 });
  assert.equal(mousedown.defaultPrevented, true, "mousedown never steals focus");
  const before = calls.length;
  sw.dispatch("auxclick", { button: 1 });
  sw.dispatch("keydown", { key: "a" });
  sw.dispatch("keydown", { key: "Tab" });
  assert.equal(calls.length, before, "auxclick and other keys do nothing");
});

test("group aria-label names only the shown lanes", () => {
  const both = modelFor(fixtures.today, { laneView: "both" });
  assert.match(both.ariaLabel, /Time by root parent:/);
  assert.match(both.ariaLabel, /Time by type:/);
  const roots = modelFor(fixtures.today, { laneView: "roots" });
  assert.match(roots.ariaLabel, /Time by root parent:/);
  assert.doesNotMatch(roots.ariaLabel, /Time by type:/);
  const themes = modelFor(fixtures.today, { laneView: "themes" });
  assert.match(themes.ariaLabel, /Time by type:/);
  assert.doesNotMatch(themes.ariaLabel, /Time by root parent:/);
  const areaRoots = modelFor(fixtures.areaOnly, { laneView: "both" });
  assert.match(areaRoots.ariaLabel, /Time by area:/);
});

test("lane-enter class appears only on a same-day view change", () => {
  const fixture = fixtures.today;
  const doc = fakeDocument();
  const el = new FakeNode("div", doc);
  const both = modelFor(fixture, { laneView: "both" });
  helpers.paintDayStrip(el, both, {});
  assert.equal(byClass(el, "bob-day-strip-lane-enter").length, 0, "first paint never animates");
  // Same view repaint: no animation.
  const bothAgain = modelFor(fixture, { laneView: "both" });
  helpers.paintDayStrip(el, bothAgain, {});
  assert.equal(byClass(el, "bob-day-strip-lane-enter").length, 0, "data repaints never animate");
  // Both -> themes: themes is newly shown? No, themes was already shown.
  // Themes was shown in both, so no newly shown lane. Use roots -> themes.
  const roots = modelFor(fixture, { laneView: "roots" });
  helpers.paintDayStrip(el, roots, {});
  assert.equal(byClass(el, "bob-day-strip-lane-enter").length, 0, "both -> roots shows nothing new");
  const themes = modelFor(fixture, { laneView: "themes" });
  helpers.paintDayStrip(el, themes, {});
  const entering = byClass(el, "bob-day-strip-lane-enter");
  assert.ok(entering.length >= 2, "roots -> themes animates the newly shown lane row and bar");
  // Day change never animates.
  const otherDay = helpers.dayStripModel(fixture.report, "1999-01-02", {
    localToday: "1999-01-03",
    fetchedAt: fixture.fetchedAt,
    laneView: "both",
  });
  // Force the memory day to differ by painting a different day with a new view.
  helpers.paintDayStrip(el, otherDay, {});
  assert.equal(byClass(el, "bob-day-strip-lane-enter").length, 0, "day changes never animate");
  // Skeleton -> ready never animates.
  const doc2 = fakeDocument();
  const el2 = new FakeNode("div", doc2);
  const skeleton = helpers.dayStripModel(null, fixture.day, { localToday: fixture.localToday, laneView: "both" });
  helpers.paintDayStrip(el2, skeleton, {});
  helpers.paintDayStrip(el2, both, {});
  assert.equal(byClass(el2, "bob-day-strip-lane-enter").length, 0, "skeleton to ready never animates");
});

test("registry: a switch repaints every record without a spawn, dedupes, and restores focus", async () => {
  await withMissingConfig(async () => {
    const plugin = await makePlugin();
    try {
      const doc = fakeDocument();
      const makeRecord = (day) => {
        const el = new FakeNode("div", doc);
        const record = { el, day, path: "", kind: "fence", observer: null, visible: true };
        plugin.dayStripViewsStore().add(record);
        plugin.dayStripPaint(record);
        return record;
      };
      const day = "2026-10-24";
      const first = makeRecord(day);
      const second = makeRecord(day);
      const spawnsBefore = plugin.dayStripSpawns || 0;
      const firstKey = first.paintedKey;
      assert.ok(firstKey, "initial paint sets a key");
      // Dedupe: painting the same view again keeps the key.
      plugin.dayStripPaint(first);
      assert.equal(first.paintedKey, firstKey, "unchanged view dedupes");
      // Cycle repaints every record without spawning.
      plugin.dayStripCycleLaneView();
      assert.equal(plugin.dayStripSpawns || 0, spawnsBefore, "switching is cache-first");
      assert.notEqual(first.paintedKey, firstKey, "a switch always repaints");
      assert.ok(second.paintedKey, "every record repaints");
      const sw = byClass(first.el, "bob-day-strip-lanes")[0];
      assert.ok(sw, "repainted record has a switch");
      // Focus restoration: the new switch takes focus when the old one had it.
      const focusable = byClass(first.el, "bob-day-strip-lanes")[0];
      assert.ok(focusable, "switch exists for focus");
      plugin.dayStripSetLaneView("themes", { focusFrom: first.el });
      const next = byClass(first.el, "bob-day-strip-lanes")[0];
      assert.ok(next._focused, "focus moves to the new switch");
      assert.deepEqual(next._focusOpts, { preventScroll: true });
    } finally {
      plugin.onunload();
    }
  });
});

test("command Cycle Day stats bars is registered with its Notice copy", async () => {
  await withMissingConfig(async () => {
    const plugin = await makePlugin();
    try {
      const commands = plugin.commands || [];
      const ids = commands.map((command) => command.id);
      assert.ok(ids.includes("toggle-day-stats"), "Toggle Day stats stays registered");
      assert.ok(ids.includes("cycle-day-stats-bars"), "Cycle Day stats bars is registered");
      const cycle = commands.find((command) => command.id === "cycle-day-stats-bars");
      assert.equal(cycle.name, "Cycle Day stats bars");
      TestNotice.messages.length = 0;
      const view = cycle.callback();
      assert.ok(["both", "roots", "themes"].includes(view));
      assert.ok(TestNotice.messages.length > 0, "command shows a Notice");
      const message = TestNotice.messages[TestNotice.messages.length - 1];
      assert.match(message, /^Day stats bars: (root parents and themes|root parents only|themes only)$/);
    } finally {
      plugin.onunload();
    }
  });
});

test("persistence remember = device: setup loads, saves, and tolerates missing storage", async () => {
  await withMissingConfig(async () => {
    const app = makeApp();
    app.__store.set(helpers.DAY_STRIP_LANES_STORAGE_KEY, "themes");
    const plugin = await makePlugin(app);
    try {
      assert.equal(plugin.dayStripLaneViewCurrent(), "themes", "setup loads a stored view");
    } finally {
      plugin.onunload();
    }
    const badApp = makeApp();
    badApp.__store.set(helpers.DAY_STRIP_LANES_STORAGE_KEY, "bogus");
    const badPlugin = await makePlugin(badApp);
    try {
      assert.equal(badPlugin.dayStripLaneViewCurrent(), "both", "an invalid stored value loads as both");
    } finally {
      badPlugin.onunload();
    }
    const freshApp = makeApp();
    const freshPlugin = await makePlugin(freshApp);
    try {
      freshPlugin.dayStripSetLaneView("roots");
      assert.equal(freshApp.__store.get(helpers.DAY_STRIP_LANES_STORAGE_KEY), "roots", "changes save under the key");
      assert.equal(freshPlugin.dayStripLaneViewCurrent(), "roots");
    } finally {
      freshPlugin.onunload();
    }
    // Missing API keeps the in-memory view without throwing.
    const noStorageApp = makeFreshnessApp({ tasks: [] });
    const noStoragePlugin = await makePlugin(noStorageApp);
    try {
      assert.doesNotThrow(() => noStoragePlugin.dayStripLoadLaneView());
      assert.doesNotThrow(() => noStoragePlugin.dayStripSetLaneView("themes"));
      assert.equal(noStoragePlugin.dayStripLaneViewCurrent(), "themes");
    } finally {
      noStoragePlugin.onunload();
    }
    // A throwing write keeps the in-memory view without throwing.
    const throwingApp = makeApp();
    throwingApp.saveLocalStorage = () => { throw new Error("denied"); };
    const throwingPlugin = await makePlugin(throwingApp);
    try {
      assert.doesNotThrow(() => throwingPlugin.dayStripSetLaneView("roots"));
      assert.equal(throwingPlugin.dayStripLaneViewCurrent(), "roots");
    } finally {
      throwingPlugin.onunload();
    }
  });
});
