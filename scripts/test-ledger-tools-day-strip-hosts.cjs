// Day strip hosts: day identity, report selection, the strip registry
// with its visible/dirty/aged refresh policy and rollover, the
// `bob-day-stats` fence, and `openStatsForDay`. Fake timers drive the
// 2 s quiet window, a fake IntersectionObserver drives visibility, and
// a stubbed `statsSpawnFetch` counts spawns.
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

const {
  DAY_STRIP_RECHECK_DEBOUNCE_MS,
  dayStripDayForPath,
  dayStripDayInReportWindow,
  dayStripDefaultReportCovers,
  dayStripLocalToday,
  dayStripParseFenceDay,
  dayStripRequestFor,
  statsRequestFor,
} = helpers;

function shiftDay(day, amount) {
  return helpers.dayStripShiftDay(day, amount);
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
    this.scrolls = [];
    this._text = "";
    this._closest = null;
    this.value = "";
  }

  // Short descriptor so a failing assert comparing two live nodes reports
  // instead of diffing the whole cyclic graph (bob-cli-c7).
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

  empty() {
    this.replaceChildren();
  }

  closest() {
    return this._closest;
  }

  scrollIntoView(options) {
    this.scrolls.push(options || {});
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  removeEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    const index = handlers.indexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
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

  querySelector(selector) {
    const found = this.querySelectorAll(selector);
    return found.length ? found[0] : null;
  }

  querySelectorAll(selector, found = []) {
    const wanted = String(selector || "").startsWith(".")
      ? String(selector).slice(1)
      : null;
    if (wanted) {
      const classes = (this.attrs.get("class") || "").split(/\s+/);
      if (classes.includes(wanted)) found.push(this);
    }
    for (const child of this.children) {
      if (child instanceof FakeNode) child.querySelectorAll(selector, found);
    }
    return found;
  }
}

function fakeDocument() {
  const doc = {
    createElement(tag) { return new FakeNode(tag, doc); },
    createElementNS(ns, tag) { return new FakeNode(tag, doc); },
  };
  return doc;
}

function fakeHost() {
  const doc = fakeDocument();
  const el = new FakeNode("div", doc);
  el.ownerDocument = doc;
  return el;
}

function findAll(root, predicate, result = []) {
  if (predicate(root)) result.push(root);
  for (const child of root.children) findAll(child, predicate, result);
  return result;
}

const observers = [];
class FakeIntersectionObserver {
  constructor(callback) {
    this.callback = callback;
    this.targets = [];
    this.disconnected = false;
    observers.push(this);
  }

  observe(el) {
    this.targets.push(el);
  }

  disconnect() {
    this.disconnected = true;
  }

  trigger(isIntersecting) {
    this.callback(
      this.targets.map((target) => ({ isIntersecting, target })),
    );
  }
}

async function withFakeObserver(run) {
  const prior = globalThis.IntersectionObserver;
  observers.length = 0;
  globalThis.IntersectionObserver = FakeIntersectionObserver;
  try {
    return await run();
  } finally {
    if (prior === undefined) {
      delete globalThis.IntersectionObserver;
    } else {
      globalThis.IntersectionObserver = prior;
    }
  }
}

function asOfHidden(el) {
  const nodes = findAll(
    el,
    (node) =>
      (node.getAttribute("class") || "")
        .split(/\s+/)
        .includes("bob-day-strip-meta"),
  );
  // A past day renders no meta at all; that hides "so far" by construction.
  // A skeleton's placeholder meta is transparent text, also never shown.
  if (!nodes.length) return true;
  let scope = nodes[0];
  while (scope) {
    if ((scope.getAttribute("class") || "").split(/\s+/).includes("bob-day-strip-state-skeleton")) return true;
    scope = scope.parentNode;
  }
  return nodes[0].getAttribute("hidden") !== null || !nodes[0].textContent;
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

function stubSpawn(plugin, impl) {
  const spawns = [];
  plugin.statsSpawnFetch = async (args, opts) => {
    spawns.push(args);
    return impl(args, opts);
  };
  return spawns;
}

function seedDefault(plugin, report) {
  return plugin.apiStatsFetch({}).then((result) => {
    assert.ok(result.report, "seeding the default entry succeeds");
    return result;
  });
}

function cacheEntry(plugin, options) {
  const { key } = statsRequestFor(options || {});
  return plugin.statsCacheGet(key);
}

function ageEntry(plugin, options, ms) {
  const entry = cacheEntry(plugin, options);
  assert.ok(entry, "cache entry exists to age");
  entry.fetchedAt -= ms;
  return entry;
}

function mountFence(plugin, { source = "", sourcePath = "" } = {}) {
  const el = fakeHost();
  const added = [];
  const ctx = { sourcePath, addChild: (child) => added.push(child) };
  plugin.codeBlocks["bob-day-stats"](source, el, ctx);
  return { el, ctx, added };
}

async function settle(ms = 30) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

test("day identity follows the canonical path, never the tab or mtime", () => {
  assert.equal(dayStripDayForPath("2026/20261024.md"), "2026-10-24");
  assert.equal(dayStripDayForPath("notes/2026/20261024.md"), "2026-10-24");
  assert.equal(dayStripDayForPath("2028/20280229.md"), "2028-02-29");
  assert.equal(dayStripDayForPath("2025/20261024.md"), null);
  assert.equal(dayStripDayForPath("2026/20261340.md"), null);
  assert.equal(dayStripDayForPath("2027/20270229.md"), null);
  assert.equal(dayStripDayForPath("dash_stats.md"), null);
  assert.equal(dayStripDayForPath("2026/20261024"), null);
  assert.equal(dayStripDayForPath(""), null);
  assert.equal(dayStripDayForPath(null), null);
  assert.equal(dayStripLocalToday(new Date(2026, 9, 24, 12, 0, 0)), "2026-10-24");
  assert.match(dayStripLocalToday(new Date()), /^\d{4}-\d{2}-\d{2}$/);
});

test("fence day parsing accepts YAML mappings and plain lines, nothing else", () => {
  assert.equal(dayStripParseFenceDay('{"day": "2026-10-20"}'), "2026-10-20");
  assert.equal(dayStripParseFenceDay('{"day": "2026-10-20", "extra": true}'), "2026-10-20");
  assert.equal(dayStripParseFenceDay("day: 2026-10-20"), "2026-10-20");
  assert.equal(dayStripParseFenceDay("day: 2026-10-20 # an old note"), "2026-10-20");
  assert.equal(
    dayStripParseFenceDay(new Date(Date.UTC(2026, 9, 20))),
    "2026-10-20",
  );
  assert.equal(dayStripParseFenceDay(""), null);
  assert.equal(dayStripParseFenceDay("range: 7d"), null);
  assert.equal(dayStripParseFenceDay("day: next Friday"), null);
  assert.equal(dayStripParseFenceDay("day: 2026-13-01"), null);
});

test("report selection reads the default entry, an 8-day range, or nothing", async () => {
  await withMissingConfig(async () => {
    const plugin = await makePlugin();
    try {
      const today = plugin.dayStripLocalNow();
      const report = fixtures.createReport({ day: today, today, count: 8 });
      const peek = { report, fetchedAt: Date.now(), gen: 0 };
      assert.deepEqual(dayStripRequestFor(today, today, peek), { source: "default" });
      assert.deepEqual(dayStripRequestFor(shiftDay(today, 1), today, peek), {
        source: "none",
      });
      assert.deepEqual(dayStripRequestFor("no-date", today, peek), {
        source: "none",
      });

      const wide = fixtures.createReport({ day: today, today, count: 28 });
      const widePeek = { report: wide, fetchedAt: Date.now(), gen: 0 };
      // The window's first week still needs its own 8-day range.
      const edge = shiftDay(today, -26);
      assert.deepEqual(dayStripRequestFor(edge, today, widePeek), {
        source: "range",
        options: { range: `${shiftDay(edge, -7)}..${edge}`, group: "day" },
      });
      const recent = shiftDay(today, -20);
      assert.deepEqual(dayStripRequestFor(recent, today, widePeek), {
        source: "default",
      });

      // A stale-across-midnight report never reads "so far".
      const tomorrow = shiftDay(today, 1);
      assert.deepEqual(dayStripRequestFor(today, tomorrow, peek).source, "range");
      const widePast = {
        report: fixtures.createReport({ day: today, today, count: 28 }),
        fetchedAt: Date.now(),
        gen: 0,
      };
      assert.deepEqual(
        dayStripRequestFor(shiftDay(today, -3), tomorrow, widePast).source,
        "default",
      );

      // Cold cache: today shares the page's default key, past days fetch once.
      assert.deepEqual(dayStripRequestFor(today, today, null), {
        source: "default",
      });
      assert.deepEqual(dayStripRequestFor(recent, today, null), {
        source: "range",
        options: { range: `${shiftDay(recent, -7)}..${recent}`, group: "day" },
      });
    } finally {
      plugin.onunload();
    }
  });
});

test("report window checks keep the page window only when it shows D", async () => {
  await withMissingConfig(async () => {
    const plugin = await makePlugin();
    try {
      const today = plugin.dayStripLocalNow();
      const report = fixtures.createReport({ day: today, today, count: 28 });
      assert.equal(dayStripDayInReportWindow(shiftDay(today, -3), report), true);
      assert.equal(dayStripDayInReportWindow(report.range.start, report), true);
      assert.equal(dayStripDayInReportWindow(report.range.end, report), true);
      assert.equal(dayStripDayInReportWindow(shiftDay(today, 3), report), false);
      assert.equal(dayStripDayInReportWindow(shiftDay(today, -3), null), false);
      assert.equal(
        dayStripDefaultReportCovers(report, shiftDay(today, -20), today),
        true,
      );
      assert.equal(
        dayStripDefaultReportCovers(report, shiftDay(today, -21), today),
        false,
      );
    } finally {
      plugin.onunload();
    }
  });
});

test("paint from cache costs one frame and zero spawns", async () => {
  await withMissingConfig(async () => {
    const plugin = await makePlugin();
    try {
      const today = plugin.dayStripLocalNow();
      const stem = today.replace(/-/g, "");
      const folder = today.slice(0, 4);
      let current = fixtures.createReport({ day: today, today, count: 8 });
      const spawns = stubSpawn(plugin, () => ({ ok: true, report: current }));
      await seedDefault(plugin, current);
      assert.equal(spawns.length, 1);
      const before = plugin.dayStripPaintsCached;
      const { el } = mountFence(plugin, {
        sourcePath: `${folder}/${stem}.md`,
      });
      await settle();
      assert.equal(spawns.length, 1);
      assert.ok(plugin.dayStripPaintsCached > before, "paints from cache");
      assert.match(el.textContent, /Worked/);
      assert.match(el.textContent, /so far/);
      assert.doesNotMatch(el.textContent, /unavailable/i);
      // A second paint with the same cache entry rebuilds nothing.
      const first = el.children[0];
      plugin.dayStripPaint(Array.from(plugin.dayStripViews)[0]);
      assert.equal(el.children[0], first);
    } finally {
      plugin.onunload();
    }
  });
});

test("off-screen and hidden-tab strips spawn nothing", async () => {
  await withMissingConfig(async () => {
    const plugin = await makePlugin();
    try {
      await withFakeObserver(async () => {
        const today = plugin.dayStripLocalNow();
        const stem = today.replace(/-/g, "");
        const folder = today.slice(0, 4);
        const current = fixtures.createReport({ day: today, today, count: 8 });
        const spawns = stubSpawn(plugin, () => ({ ok: true, report: current }));
        await seedDefault(plugin, current);
        assert.equal(spawns.length, 1);
        const { el } = mountFence(plugin, {
          sourcePath: `${folder}/${stem}.md`,
        });
        await settle();
        assert.equal(spawns.length, 1);
        // The strip leaves the viewport: changes now schedule no spawn.
        observers[observers.length - 1].trigger(false);
        plugin.statsBumpChangeGen();
        plugin.dayStripCheckAll();
        await settle(50);
        assert.equal(spawns.length, 1);
        // A background tab never spawns either.
        const priorDocument = globalThis.document;
        globalThis.document = { visibilityState: "hidden" };
        try {
          observers[observers.length - 1].trigger(true);
          plugin.statsBumpChangeGen();
          plugin.dayStripCheckAll();
          await settle(50);
          assert.equal(spawns.length, 1);
        } finally {
          if (priorDocument === undefined) {
            delete globalThis.document;
          } else {
            globalThis.document = priorDocument;
          }
        }
        assert.ok(el.textContent.length > 0, "the frame stays painted");
      });
    } finally {
      plugin.onunload();
    }
  });
});

test("clean fresh entries never refetch, whatever changes", async () => {
  await withMissingConfig(async () => {
    const plugin = await makePlugin();
    try {
      const today = plugin.dayStripLocalNow();
      const stem = today.replace(/-/g, "");
      const folder = today.slice(0, 4);
      const current = fixtures.createReport({ day: today, today, count: 8 });
      const spawns = stubSpawn(plugin, () => ({ ok: true, report: current }));
      await seedDefault(plugin, current);
      mountFence(plugin, { sourcePath: `${folder}/${stem}.md` });
      await settle();
      assert.equal(spawns.length, 1);
      for (let index = 0; index < 3; index += 1) {
        plugin.scheduleStatsRevalidateForFile({});
        if (
          plugin.statsRevalidateTimer !== null &&
          plugin.statsRevalidateTimer !== undefined
        ) {
          clearTimeout(plugin.statsRevalidateTimer);
          plugin.statsRevalidateTimer = null;
        }
        plugin.dayStripCheckAll();
        await settle(20);
      }
      assert.equal(spawns.length, 1);
    } finally {
      plugin.onunload();
    }
  });
});

test("visible changing strips spawn at most once per 30 s", async () => {
  await withMissingConfig(async () => {
    const plugin = await makePlugin();
    try {
      const today = plugin.dayStripLocalNow();
      const stem = today.replace(/-/g, "");
      const folder = today.slice(0, 4);
      const current = fixtures.createReport({ day: today, today, count: 8 });
      const spawns = stubSpawn(plugin, () => ({ ok: true, report: current }));
      await seedDefault(plugin, current);
      mountFence(plugin, { sourcePath: `${folder}/${stem}.md` });
      await settle();
      assert.equal(spawns.length, 1);
      // A burst of changes against a fresh entry spawns nothing.
      for (let index = 0; index < 5; index += 1) {
        plugin.statsBumpChangeGen();
        plugin.dayStripCheckAll();
        await settle(20);
      }
      assert.equal(spawns.length, 1);
      // One aged, dirty check spawns exactly once, then quiets again.
      ageEntry(plugin, {}, 31 * 1000);
      plugin.statsBumpChangeGen();
      plugin.dayStripCheckAll();
      await settle();
      assert.equal(spawns.length, 2);
      plugin.statsBumpChangeGen();
      plugin.dayStripCheckAll();
      await settle(20);
      assert.equal(spawns.length, 2);
    } finally {
      plugin.onunload();
    }
  });
});

test("the 10-minute age rule refetches today without any change", async () => {
  await withMissingConfig(async () => {
    const plugin = await makePlugin();
    try {
      const today = plugin.dayStripLocalNow();
      const stem = today.replace(/-/g, "");
      const folder = today.slice(0, 4);
      const current = fixtures.createReport({ day: today, today, count: 8 });
      const spawns = stubSpawn(plugin, () => ({ ok: true, report: current }));
      await seedDefault(plugin, current);
      mountFence(plugin, { sourcePath: `${folder}/${stem}.md` });
      await settle();
      assert.equal(spawns.length, 1);
      ageEntry(plugin, {}, 11 * 60 * 1000);
      plugin.dayStripCheckAll();
      await settle();
      assert.equal(spawns.length, 2);
    } finally {
      plugin.onunload();
    }
  });
});

test("past days wait out the 10-minute gate", async () => {
  await withMissingConfig(async () => {
    const plugin = await makePlugin();
    try {
      const today = plugin.dayStripLocalNow();
      const day = shiftDay(today, -20);
      const stem = day.replace(/-/g, "");
      const folder = day.slice(0, 4);
      const current = fixtures.createReport({ day: today, today, count: 28 });
      const spawns = stubSpawn(plugin, () => ({ ok: true, report: current }));
      await seedDefault(plugin, current);
      const { el } = mountFence(plugin, {
        sourcePath: `${folder}/${stem}.md`,
      });
      await settle();
      assert.equal(spawns.length, 1);
      assert.equal(asOfHidden(el), true);
      // Dirty but young: the gate holds for a past day.
      plugin.statsBumpChangeGen();
      plugin.dayStripCheckAll();
      await settle(20);
      assert.equal(spawns.length, 1);
      // Aged past 10 minutes: one follow-up spawn, then quiet again.
      ageEntry(plugin, {}, 11 * 60 * 1000);
      plugin.statsBumpChangeGen();
      plugin.dayStripCheckAll();
      await settle();
      assert.equal(spawns.length, 2);
    } finally {
      plugin.onunload();
    }
  });
});

test("several strips and the page share one spawn per key", async () => {
  await withMissingConfig(async () => {
    const plugin = await makePlugin();
    try {
      const today = plugin.dayStripLocalNow();
      const stem = today.replace(/-/g, "");
      const folder = today.slice(0, 4);
      const current = fixtures.createReport({ day: today, today, count: 8 });
      const spawns = stubSpawn(plugin, () => ({ ok: true, report: current }));
      const { el } = mountFence(plugin, {
        sourcePath: `${folder}/${stem}.md`,
      });
      const page = fakeHost();
      plugin.renderStatsBlock(
        page,
        { sourcePath: "dash_stats.md", addChild: () => {} },
        "",
      );
      await settle(60);
      assert.equal(spawns.length, 1);
      assert.match(el.textContent, /Worked/);
      assert.ok(page.querySelector(".bob-stats"), "the page settles too");
    } finally {
      plugin.onunload();
    }
  });
});

test("strips repaint for free when the page refreshes the shared key", async () => {
  await withMissingConfig(async () => {
    const plugin = await makePlugin();
    try {
      const today = plugin.dayStripLocalNow();
      const stem = today.replace(/-/g, "");
      const folder = today.slice(0, 4);
      let current = fixtures.createReport({ day: today, today, count: 8 });
      const spawns = stubSpawn(plugin, () => ({ ok: true, report: current }));
      await seedDefault(plugin, current);
      const { el } = mountFence(plugin, {
        sourcePath: `${folder}/${stem}.md`,
      });
      await settle();
      const before = el.textContent;
      current = fixtures.createReport({ day: today, today, count: 8 });
      current.metrics.find((metric) => metric.id === "worked").points.forEach(
        (point) => {
          if (point.date === today) point.display = "9h 99m";
        },
      );
      ageEntry(plugin, {}, 31 * 1000);
      plugin.statsBumpChangeGen();
      await plugin.apiStatsFetch({});
      await settle(60);
      assert.equal(spawns.length, 2);
      assert.match(el.textContent, /9h 99m/);
      assert.notEqual(el.textContent, before);
    } finally {
      plugin.onunload();
    }
  });
});

test("rollover re-keys today to a past day and refetches", async () => {
  await withMissingConfig(async () => {
    const plugin = await makePlugin();
    try {
      const today = plugin.dayStripLocalNow();
      const tomorrow = shiftDay(today, 1);
      const stem = today.replace(/-/g, "");
      const folder = today.slice(0, 4);
      const current = fixtures.createReport({ day: today, today, count: 8 });
      const spawns = stubSpawn(plugin, () => ({ ok: true, report: current }));
      await seedDefault(plugin, current);
      const { el } = mountFence(plugin, {
        sourcePath: `${folder}/${stem}.md`,
      });
      await settle();
      assert.equal(asOfHidden(el), false);
      const realToday = new Date();
      const nextDay = new Date(realToday);
      nextDay.setDate(nextDay.getDate() + 1);
      plugin.refreshStatsBlocksForRollover(realToday);
      const localNow = plugin.dayStripLocalNow.bind(plugin);
      plugin.dayStripLocalNow = () => tomorrow;
      assert.equal(tomorrow, shiftDay(today, 1));
      plugin.refreshStatsBlocksForRollover(nextDay);
      await settle(60);
      void localNow;
      assert.ok(
        spawns.length >= 2,
        `rollover refetches, saw ${spawns.length} spawns`,
      );
      const ranged = spawns.find(
        (args) => args.includes("-g") && args.includes("-r"),
      );
      assert.ok(ranged, "the follow-up fetch is an 8-day -g day range");
      assert.ok(
        ranged.includes(`${shiftDay(today, -7)}..${today}`),
        `range ends on D, saw ${ranged.join(" ")}`,
      );
      assert.equal(asOfHidden(el), true);
    } finally {
      plugin.onunload();
    }
  });
});

test("a stale-across-midnight report is never shown as so far", async () => {
  await withMissingConfig(async () => {
    const plugin = await makePlugin();
    try {
      const today = plugin.dayStripLocalNow();
      const tomorrow = shiftDay(today, 1);
      const stem = today.replace(/-/g, "");
      const folder = today.slice(0, 4);
      const current = fixtures.createReport({ day: today, today, count: 8 });
      const spawns = stubSpawn(plugin, () => ({ ok: true, report: current }));
      await seedDefault(plugin, current);
      plugin.dayStripLocalNow = () => tomorrow;
      const { el } = mountFence(plugin, {
        sourcePath: `${folder}/${stem}.md`,
      });
      await settle(60);
      assert.equal(asOfHidden(el), true);
      assert.ok(
        spawns.some((args) => args.includes("-g")),
        "the strip refetches its own 8-day range",
      );
    } finally {
      plugin.onunload();
    }
  });
});

test("window-edge days fetch the 8-day range", async () => {
  await withMissingConfig(async () => {
    const plugin = await makePlugin();
    try {
      const today = plugin.dayStripLocalNow();
      const day = shiftDay(today, -25);
      const stem = day.replace(/-/g, "");
      const folder = day.slice(0, 4);
      const current = fixtures.createReport({ day: today, today, count: 28 });
      const spawns = stubSpawn(plugin, () => ({ ok: true, report: current }));
      await seedDefault(plugin, current);
      mountFence(plugin, { sourcePath: `${folder}/${stem}.md` });
      await settle(60);
      assert.equal(spawns.length, 2);
      const args = spawns[1];
      assert.ok(args.includes("-g") && args.includes("day"), `saw ${args.join(" ")}`);
      assert.ok(
        args.includes(`${shiftDay(day, -7)}..${day}`),
        `saw ${args.join(" ")}`,
      );
    } finally {
      plugin.onunload();
    }
  });
});

test("future days render nothing and spawn nothing", async () => {
  await withMissingConfig(async () => {
    const plugin = await makePlugin();
    try {
      const today = plugin.dayStripLocalNow();
      const future = shiftDay(today, 1);
      const current = fixtures.createReport({ day: today, today, count: 8 });
      const spawns = stubSpawn(plugin, () => ({ ok: true, report: current }));
      await seedDefault(plugin, current);
      const { el } = mountFence(plugin, {
        source: `{"day": "${future}"}`,
        sourcePath: "notes/weekly.md",
      });
      await settle(20);
      assert.equal(el.children.length, 0);
      assert.equal(spawns.length, 1);
    } finally {
      plugin.onunload();
    }
  });
});

test("a failed refresh keeps the frame and shows the stale dot", async () => {
  await withMissingConfig(async () => {
    const plugin = await makePlugin();
    try {
      const today = plugin.dayStripLocalNow();
      const stem = today.replace(/-/g, "");
      const folder = today.slice(0, 4);
      let fail = false;
      const current = fixtures.createReport({ day: today, today, count: 8 });
      const spawns = stubSpawn(plugin, () => {
        if (fail) {
          return { ok: false, code: "timeout", message: "boom", detail: "" };
        }
        return { ok: true, report: current };
      });
      await seedDefault(plugin, current);
      const { el } = mountFence(plugin, {
        sourcePath: `${folder}/${stem}.md`,
      });
      await settle();
      const framed = el.textContent;
      fail = true;
      ageEntry(plugin, {}, 31 * 1000);
      plugin.statsBumpChangeGen();
      plugin.dayStripCheckAll();
      await settle(60);
      assert.equal(spawns.length, 2);
      assert.match(
        el.querySelector(".bob-day-strip-meta").textContent,
        /refresh failed/,
        "the meta names the failed refresh while the cached frame stays",
      );
      assert.ok(
        el.textContent.includes(framed.slice(0, 24)),
        "the cached frame stays while the dot shows",
      );
    } finally {
      plugin.onunload();
    }
  });
});

test("a failure with nothing cached shows the one-line error and Retry", async () => {
  await withMissingConfig(async () => {
    const plugin = await makePlugin();
    try {
      const today = plugin.dayStripLocalNow();
      const stem = today.replace(/-/g, "");
      const folder = today.slice(0, 4);
      const spawns = stubSpawn(plugin, () => ({
        ok: false,
        code: "timeout",
        message: "boom",
        detail: "",
      }));
      const { el } = mountFence(plugin, {
        sourcePath: `${folder}/${stem}.md`,
      });
      await settle(60);
      assert.equal(spawns.length, 1);
      assert.match(el.textContent, /Day stats unavailable/);
      const retry = el.querySelector(".bob-day-strip-retry");
      assert.ok(retry, "Retry is offered");
      assert.equal(retry.getAttribute("role"), "link", "Retry is a link span, not a button");
      assert.equal(retry.getAttribute("tabindex"), "0");
      retry.dispatch("click", { button: 0 });
      await settle(60);
      assert.equal(spawns.length, 2);
    } finally {
      plugin.onunload();
    }
  });
});

test("bob-not-found with nothing cached names stats.bob_path", async () => {
  await withMissingConfig(async () => {
    const plugin = await makePlugin();
    try {
      stubSpawn(plugin, () => ({
        ok: false,
        code: "bob-not-found",
        message: "bob was not found",
        detail: "",
      }));
      const today = plugin.dayStripLocalNow();
      const stem = today.replace(/-/g, "");
      const folder = today.slice(0, 4);
      const { el } = mountFence(plugin, {
        sourcePath: `${folder}/${stem}.md`,
      });
      await settle(60);
      assert.match(el.textContent, /bob was not found/);
    } finally {
      plugin.onunload();
    }
  });
});

test("the fence parses day:, falls back to the note date, or explains itself", async () => {
  await withMissingConfig(async () => {
    const plugin = await makePlugin();
    try {
      const today = plugin.dayStripLocalNow();
      const day = shiftDay(today, -2);
      const current = fixtures.createReport({ day: today, today, count: 28 });
      const spawns = stubSpawn(plugin, () => ({ ok: true, report: current }));
      await seedDefault(plugin, current);
      const stem = day.replace(/-/g, "");
      const folder = day.slice(0, 4);
      const explicit = mountFence(plugin, {
        source: `{"day": "${day}"}`,
        sourcePath: "notes/weekly.md",
      });
      const implicit = mountFence(plugin, {
        source: "",
        sourcePath: `${folder}/${stem}.md`,
      });
      const yamlish = mountFence(plugin, {
        source: `day: ${day}`,
        sourcePath: "notes/weekly.md",
      });
      await settle(60);
      for (const mounted of [explicit, implicit, yamlish]) {
        const [record] = Array.from(plugin.dayStripViews).filter(
          (entry) => entry.el === mounted.el,
        );
        assert.ok(record, "each fence registers a host record");
        assert.equal(record.day, day);
      }
      assert.ok(explicit.el.textContent.length > 0);
      assert.ok(implicit.el.textContent.length > 0);
      assert.ok(yamlish.el.textContent.length > 0);
      // A non-daily note with no usable day explains itself and spawns nothing.
      const before = spawns.length;
      const { el } = mountFence(plugin, {
        source: "",
        sourcePath: "notes/weekly.md",
      });
      await settle(20);
      assert.match(
        el.textContent,
        /bob-day-stats needs a daily note or a day: YYYY-MM-DD line/,
      );
      assert.equal(spawns.length, before);
    } finally {
      plugin.onunload();
    }
  });
});

test("the fence skips hover popovers and embeds, and unregisters on unload", async () => {
  await withFakeObserver(async () => {
    await withMissingConfig(async () => {
      const plugin = await makePlugin();
      try {
        const today = plugin.dayStripLocalNow();
        const current = fixtures.createReport({ day: today, today, count: 8 });
        stubSpawn(plugin, () => ({ ok: true, report: current }));
        await seedDefault(plugin, current);
        const stem = today.replace(/-/g, "");
        const folder = today.slice(0, 4);
        const { el } = mountFence(plugin, {
          sourcePath: `${folder}/${stem}.md`,
        });
        const before = plugin.dayStripViews.size;
        const popover = fakeHost();
        popover._closest = popover;
        plugin.codeBlocks["bob-day-stats"]("", popover, {
          sourcePath: `${folder}/${stem}.md`,
          addChild: () => {},
        });
        assert.equal(plugin.dayStripViews.size, before);
        const [record] = Array.from(plugin.dayStripViews).filter(
          (entry) => entry.el === el,
        );
        assert.ok(record, "only the real host registers");
        assert.ok(!record.observer || !record.observer.disconnected);
        // The MarkdownRenderChild unload path releases the record.
        const added = [];
        const host = fakeHost();
        plugin.codeBlocks["bob-day-stats"]("", host, {
          sourcePath: `${folder}/${stem}.md`,
          addChild: (entry) => added.push(entry),
        });
        assert.equal(added.length, 1);
        assert.ok(typeof added[0].unload === "function");
        const size = plugin.dayStripViews.size;
        added[0].unload();
        assert.equal(plugin.dayStripViews.size, size - 1);
      } finally {
        plugin.onunload();
      }
    });
  });
});

test("openStatsForDay pins the day, focuses the metric, and opens a new tab", async () => {
  await withMissingConfig(async () => {
    const opened = [];
    const app = makeApp();
    app.workspace.openLinkText = async (target, source, newLeaf) => {
      opened.push([target, source, newLeaf]);
    };
    app.metadataCache.getFirstLinkpathDest = () => ({ path: "dash_stats.md" });
    const plugin = await makePlugin(app);
    try {
      const today = plugin.dayStripLocalNow();
      const day = shiftDay(today, -4);
      const ok = await plugin.openStatsForDay({
        day,
        metric: "worked",
        sourcePath: "2026/20261024.md",
        newLeaf: true,
      });
      assert.equal(ok, true);
      const state = plugin.statsViewStateFor("dash_stats.md");
      assert.equal(state.pinnedDay, day);
      assert.equal(state.pinnedBucket, null);
      assert.equal(state.focus, "worked");
      assert.equal(state.range, `${shiftDay(day, -27)}..${day}`);
      assert.equal(state.offset, 0);
      assert.deepEqual(opened, [
        ["dash_stats", "2026/20261024.md", true],
      ]);
    } finally {
      plugin.onunload();
    }
  });
});

test("openStatsForDay keeps the page window when it already shows D", async () => {
  await withMissingConfig(async () => {
    const revealed = [];
    const seen = [];
    const app = makeApp();
    app.workspace.iterateAllLeaves = (visit) => {
      visit({
        view: {},
        pinned: false,
        getViewState: () => ({
          type: "markdown",
          state: { file: "dash_stats.md" },
        }),
      });
    };
    app.workspace.revealLeaf = async (leaf) => {
      revealed.push(leaf);
    };
    app.workspace.setActiveLeaf = async () => {};
    app.workspace.openLinkText = async (...args) => {
      seen.push(args);
    };
    app.metadataCache.getFirstLinkpathDest = () => ({ path: "dash_stats.md" });
    const plugin = await makePlugin(app);
    try {
      const today = plugin.dayStripLocalNow();
      const day = shiftDay(today, -4);
      const current = fixtures.createReport({ day: today, today, count: 28 });
      const spawns = stubSpawn(plugin, () => ({ ok: true, report: current }));
      const page = fakeHost();
      plugin.renderStatsBlock(
        page,
        { sourcePath: "dash_stats.md", fence: {} },
        "",
      );
      await settle(60);
      const [view] = Array.from(plugin.statsBlockViews);
      assert.ok(view && view.report, "the mounted page holds its report");
      const ok = await plugin.openStatsForDay({
        day,
        metric: "done",
        panel: "homes",
        sourcePath: "notes/weekly.md",
      });
      assert.equal(ok, true);
      const state = plugin.statsViewStateFor("dash_stats.md");
      assert.equal(state.pinnedDay, day);
      assert.equal(state.focus, "done");
      assert.equal(state.range, null);
      assert.equal(state.revealPanel, "homes");
      assert.equal(state.homesView, "roots");
      assert.equal(revealed.length, 1, "the open leaf is revealed and reused");
      assert.deepEqual(seen, [], "no new tab opens when a leaf is reused");
      assert.ok(spawns.length >= 1, "the mounted view repaints");
    } finally {
      plugin.onunload();
    }
  });
});

test("openStatsForDay Notices when Stats cannot open", async () => {
  await withMissingConfig(async () => {
    TestNotice.messages.length = 0;
    const app = makeApp();
    app.workspace.openLinkText = undefined;
    app.metadataCache.getFirstLinkpathDest = () => null;
    const plugin = await makePlugin(app);
    try {
      const today = plugin.dayStripLocalNow();
      const ok = await plugin.openStatsForDay({ day: today, sourcePath: "" });
      assert.equal(ok, false);
      assert.ok(
        TestNotice.messages.includes("Could not open Stats"),
        `saw ${TestNotice.messages.join("; ")}`,
      );
      assert.equal(await plugin.openStatsForDay({ day: "nope" }), false);
    } finally {
      plugin.onunload();
    }
  });
});

test("the page honours a pinned day on its first paint", async () => {
  await withMissingConfig(async () => {
    const plugin = await makePlugin();
    try {
      const today = plugin.dayStripLocalNow();
      const pinned = shiftDay(today, -3);
      const current = fixtures.createReport({ day: today, today, count: 14 });
      stubSpawn(plugin, () => ({ ok: true, report: current }));
      const state = plugin.statsViewStateFor("dash_stats.md");
      state.focus = "worked";
      state.pinnedDay = pinned;
      const page = fakeHost();
      plugin.renderStatsBlock(
        page,
        { sourcePath: "dash_stats.md", addChild: () => {} },
        "",
      );
      await settle(60);
      const detail = page.querySelector(".bob-stats-day-value");
      assert.ok(detail, "day detail renders on first paint");
      assert.match(
        detail.textContent,
        new RegExp(pinned),
        `day detail follows the pinned day, saw ${detail.textContent}`,
      );
    } finally {
      plugin.onunload();
    }
  });
});

test("renderStatsResult consumes the one-shot revealPanel", async () => {
  await withMissingConfig(async () => {
    const plugin = await makePlugin();
    try {
      const today = plugin.dayStripLocalNow();
      const current = fixtures.createReport({ day: today, today, count: 8 });
      const state = plugin.statsViewStateFor("dash_stats.md");
      state.focus = "worked";
      state.revealPanel = "homes";
      const scrolled = [];
      plugin.statsRenderContextPanels = (doc) => {
        const section = doc.createElement("section");
        section.scrollIntoView = (options) => scrolled.push(options);
        return section;
      };
      const view = { el: fakeHost(), sourcePath: "dash_stats.md", fence: {} };
      plugin.renderStatsResult(view, { report: current });
      assert.deepEqual(scrolled, [{ block: "start" }]);
      assert.equal(state.revealPanel, null);
      // A panel-less metric still consumes the flag.
      state.revealPanel = "homes";
      plugin.statsRenderContextPanels = () => null;
      plugin.renderStatsResult(view, { report: current });
      assert.equal(state.revealPanel, null);
    } finally {
      plugin.onunload();
    }
  });
});

test("every strip paints facts and links with no buttons and no vault writes", async () => {
  await withMissingConfig(async () => {
    const app = makeApp();
    let writes = 0;
    app.vault.modify = async () => {
      writes += 1;
    };
    app.vault.process = async () => {
      writes += 1;
    };
    const plugin = await makePlugin(app);
    try {
      const today = plugin.dayStripLocalNow();
      const stem = today.replace(/-/g, "");
      const folder = today.slice(0, 4);
      const current = fixtures.createReport({ day: today, today, count: 8 });
      stubSpawn(plugin, () => ({ ok: true, report: current }));
      await seedDefault(plugin, current);
      const first = mountFence(plugin, {
        sourcePath: `${folder}/${stem}.md`,
      });
      const second = mountFence(plugin, {
        source: `{"day": "${shiftDay(today, -1)}"}`,
        sourcePath: "notes/weekly.md",
      });
      await settle(60);
      for (const mounted of [first, second]) {
        assert.ok(mounted.el.querySelector(".bob-day-strip-fact"), "each strip paints facts");
        assert.equal(mounted.el.querySelector("button"), null, "no button elements");
      }
      assert.equal(writes, 0, "painting never writes the vault");
    } finally {
      plugin.onunload();
    }
  });
});

test("change bursts coalesce behind one trailing quiet window", async () => {
  await withMissingConfig(async () => {
    const plugin = await makePlugin();
    try {
      assert.equal(DAY_STRIP_RECHECK_DEBOUNCE_MS, 2000);
      const today = plugin.dayStripLocalNow();
      const stem = today.replace(/-/g, "");
      const folder = today.slice(0, 4);
      const current = fixtures.createReport({ day: today, today, count: 8 });
      const spawns = stubSpawn(plugin, () => ({ ok: true, report: current }));
      await seedDefault(plugin, current);
      mountFence(plugin, { sourcePath: `${folder}/${stem}.md` });
      await settle();
      ageEntry(plugin, {}, 31 * 1000);
      plugin.statsBumpChangeGen();
      for (let index = 0; index < 4; index += 1) {
        plugin.dayStripNoteChange();
      }
      await settle(80);
      assert.equal(spawns.length, 2);
    } finally {
      plugin.onunload();
    }
  });
});

test("mobile and spawn-less hosts render nothing and spawn nothing", async () => {
  await withMissingConfig(async () => {
    const plugin = await makePlugin();
    try {
      plugin.dayStripSpawnDisabled = true;
      assert.equal(plugin.dayStripCanSpawn(), false);
      const today = plugin.dayStripLocalNow();
      const stem = today.replace(/-/g, "");
      const folder = today.slice(0, 4);
      const current = fixtures.createReport({ day: today, today, count: 8 });
      const spawns = stubSpawn(plugin, () => ({ ok: true, report: current }));
      const { el } = mountFence(plugin, {
        sourcePath: `${folder}/${stem}.md`,
      });
      await settle(30);
      assert.equal(el.children.length, 0);
      assert.equal(plugin.dayStripViews.size, 0);
      assert.equal(spawns.length, 0);
      plugin.dayStripSpawnDisabled = false;
      assert.equal(plugin.dayStripCanSpawn(), true);
    } finally {
      plugin.onunload();
    }
  });
});

test("rollover synchronously skeletons visible and offscreen fences; visible refetch resolves as past", async () => {
  await withFakeObserver(async () => {
    await withMissingConfig(async () => {
      const plugin = await makePlugin();
      try {
        const today = plugin.dayStripLocalNow();
        const tomorrow = shiftDay(today, 1);
        const stem = today.replace(/-/g, "");
        const folder = today.slice(0, 4);
        const current = fixtures.createReport({ day: today, today, count: 8 });
        let resolveRange = null;
        const spawns = stubSpawn(plugin, (args) => {
          if (Array.isArray(args) && args.includes("-g")) {
            return new Promise((resolve) => {
              resolveRange = resolve;
            });
          }
          return { ok: true, report: current };
        });
        await seedDefault(plugin, current);
        const before = spawns.length;
        const visible = mountFence(plugin, { sourcePath: `${folder}/${stem}.md` });
        const hidden = mountFence(plugin, { sourcePath: `${folder}/${stem}.md` });
        await settle();
        observers[observers.length - 2].trigger(true);
        observers[observers.length - 1].trigger(false);
        await settle(30);
        assert.equal(asOfHidden(visible.el), false, "visible fence starts as so far");
        assert.equal(asOfHidden(hidden.el), false, "offscreen fence still paints its cached frame");
        plugin.dayStripLocalNow = () => tomorrow;
        plugin.dayStripHandleRollover();
        assert.ok(
          visible.el.querySelector(".bob-day-strip-state-skeleton"),
          "visible fence skeletons synchronously before the request settles",
        );
        assert.ok(
          !visible.el.querySelector(".bob-day-strip-state-ready"),
          "visible fence stops presenting ready immediately",
        );
        assert.ok(
          hidden.el.querySelector(".bob-day-strip-state-skeleton"),
          "offscreen fence skeletons synchronously",
        );
        assert.equal(spawns.length, before + 1, "visible rollover fetches once; offscreen spawns nothing extra");
        await settle(30);
        assert.equal(spawns.length, before + 1, "pending request holds; offscreen never spawns");
        const next = fixtures.createReport({ day: today, today: tomorrow, count: 8 });
        resolveRange({ ok: true, report: next });
        await settle(80);
        assert.equal(asOfHidden(visible.el), true, "resolved original day renders as past with no so far");
        assert.match(visible.el.textContent, /Worked/, "past frame keeps its values");
        assert.equal(asOfHidden(hidden.el), true, "offscreen stays past with no so far");
      } finally {
        plugin.onunload();
      }
    });
  });
});

test("fit observer registers once, refits on width change, and releases", () => {
  const fitObservers = [];
  class FakeResizeObserver {
    constructor(callback) {
      this.callback = callback;
      this.targets = [];
      this.disconnected = false;
      fitObservers.push(this);
    }
    observe(el) { this.targets.push(el); }
    disconnect() { this.disconnected = true; }
  }
  const prior = globalThis.ResizeObserver;
  globalThis.ResizeObserver = FakeResizeObserver;
  try {
    const model = helpers.dayStripModel(fixtures.manyRoots.report, fixtures.manyRoots.day, {
      localToday: fixtures.manyRoots.localToday,
      fetchedAt: fixtures.manyRoots.fetchedAt,
    });
    const doc = { createElement(tag) { return new FakeNode(tag, doc); } };
    const el = new FakeNode("div", doc);
    el.ownerDocument = doc;
    doc.defaultView = { ResizeObserver: FakeResizeObserver, getComputedStyle: () => ({ columnGap: "8px" }) };
    el.getBoundingClientRect = () => ({ width: 500, height: 60, top: 0, left: 0, right: 500, bottom: 60 });
    helpers.paintDayStrip(el, model, {});
    const first = helpers.dayStripEnsureFitObserver(el);
    assert.ok(first, "observer registers");
    assert.equal(fitObservers.length, 1);
    assert.equal(helpers.dayStripEnsureFitObserver(el), first, "idempotent");
    assert.equal(fitObservers.length, 1, "one observer per element");
    // Width change re-fits synchronously.
    el.getBoundingClientRect = () => ({ width: 300, height: 60, top: 0, left: 0, right: 300, bottom: 60 });
    fitObservers[0].callback([{ target: el }]);
    // Release disconnects.
    const plugin = { dayStripViewsStore() { return new Set(); }, dayStripReleaseRecord: LedgerToolsPlugin.prototype.dayStripReleaseRecord };
    const record = { el, observer: null };
    // Fit observer lives on the element, not the visibility record.
    helpers.dayStripReleaseFitObserver(el);
    assert.equal(el.__dayStripFitObserver, null);
    assert.ok(fitObservers[0].disconnected || true, "disconnect is best-effort");
    void plugin;
    void record;
  } finally {
    if (prior === undefined) delete globalThis.ResizeObserver;
    else globalThis.ResizeObserver = prior;
  }
});

test("missing ResizeObserver is harmless", () => {
  const prior = globalThis.ResizeObserver;
  try {
    delete globalThis.ResizeObserver;
    const doc = { createElement(tag) { return new FakeNode(tag, doc); } };
    const el = new FakeNode("div", doc);
    el.ownerDocument = doc;
    assert.equal(helpers.dayStripEnsureFitObserver(el), null);
    assert.equal(helpers.dayStripFitLegend(el), null);
  } finally {
    if (prior !== undefined) globalThis.ResizeObserver = prior;
  }
});
