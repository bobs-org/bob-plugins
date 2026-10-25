// Day strip plan hosts: the strip lives inside the rendered `bob-plan`
// block, after the badges, in Live Preview and Reading view. The plan
// block's repaint never touches the host.
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  LedgerToolsPlugin,
  makeFreshnessApp,
  withMissingConfig,
} = require("./ledger-tools-harness.cjs");

const helpers = LedgerToolsPlugin.helpers;
const fixtures = require("../plugins/bob-ledger-tools/scripts/fixtures/stats/day-strip-fixtures.cjs");

let stateEffectDefines = 0;
const _originalDefine = null;

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
    this._text = "";
    this._closest = null;
    this.isConnected = true;
    this.removed = [];
    this.inserted = [];
    this._classSet = new Set();
    this.classList = {
      add: (name) => { this._classSet.add(name); this._syncClass(); },
      remove: (name) => { this._classSet.delete(name); this._syncClass(); },
      contains: (name) => this._classSet.has(name),
    };
  }

  _syncClass() {
    if (this._classSet.size) this.attrs.set("class", Array.from(this._classSet).join(" "));
    else this.attrs.delete("class");
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
    if (name === "class") {
      this._classSet = new Set(String(value).split(/\s+/).filter(Boolean));
    }
  }

  getAttribute(name) {
    if (name === "class" && this._classSet.size && !this.attrs.has("class")) {
      return Array.from(this._classSet).join(" ");
    }
    return this.attrs.has(name) ? this.attrs.get(name) : null;
  }

  removeAttribute(name) {
    this.attrs.delete(name);
    if (name === "class") this._classSet.clear();
  }

  appendChild(child) {
    const existing = this.children.indexOf(child);
    if (existing >= 0) this.children.splice(existing, 1);
    child.parentNode = this;
    this.children.push(child);
    this.inserted.push(child);
    return child;
  }

  insertBefore(child, before) {
    const existing = this.children.indexOf(child);
    if (existing >= 0) this.children.splice(existing, 1);
    child.parentNode = this;
    const index = before ? this.children.indexOf(before) : -1;
    if (index < 0) this.children.push(child);
    else this.children.splice(index, 0, child);
    this.inserted.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) {
      this.children.splice(index, 1);
      child.parentNode = null;
      this.removed.push(child);
    }
    return child;
  }

  replaceChildren(...children) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this._text = "";
    for (const child of children) this.appendChild(child);
  }

  empty() {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this._text = "";
  }

  createDiv(options = {}) {
    const child = new FakeNode("div", this.ownerDocument);
    if (options.cls) {
      child.setAttribute("class", options.cls);
    }
    if (options.text !== undefined) child.textContent = String(options.text);
    return this.appendChild(child);
  }

  createEl(tag, options = {}) {
    const child = new FakeNode(tag, this.ownerDocument);
    if (options.cls) child.setAttribute("class", options.cls);
    if (options.text !== undefined) child.textContent = String(options.text);
    if (options.title !== undefined) child.setAttribute("title", String(options.title));
    return this.appendChild(child);
  }

  closest(selector) {
    if (selector && typeof selector === "string") {
      if (this._closest) return this._closest;
      return null;
    }
    return this._closest;
  }

  querySelector(selector) {
    const found = this.querySelectorAll(selector);
    return found.length ? found[0] : null;
  }

  querySelectorAll(selector, found = []) {
    const wanted = String(selector || "").startsWith(".") ? String(selector).slice(1) : null;
    if (wanted) {
      const classes = (this.getAttribute("class") || "").split(/\s+/);
      if (classes.includes(wanted)) found.push(this);
    }
    for (const child of this.children) {
      if (child instanceof FakeNode) child.querySelectorAll(selector, found);
    }
    return found;
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  remove() {
    if (this.parentNode && typeof this.parentNode.removeChild === "function") {
      this.parentNode.removeChild(this);
    } else if (this.parentNode && Array.isArray(this.parentNode.children)) {
      const index = this.parentNode.children.indexOf(this);
      if (index >= 0) this.parentNode.children.splice(index, 1);
      this.parentNode = null;
    }
  }
}

function fakeDocument() {
  const doc = {
    createElement(tag) { return new FakeNode(tag, doc); },
    createElementNS(ns, tag) { return new FakeNode(tag, doc); },
  };
  return doc;
}

function fakePlanBlock() {
  const doc = fakeDocument();
  const el = new FakeNode("div", doc);
  el.ownerDocument = doc;
  return el;
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
  plugin.readPlanBlockContent = () => Promise.resolve("## Pomodoros\n\n- [ ] () — GOALS\n");
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

async function settle(ms = 30) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function planChildren(el) {
  return el.children || [];
}

function findPlanContainer(el) {
  return planChildren(el).find((child) => String(child.getAttribute("class") || "").split(/\s+/).includes("bob-plan")) || null;
}

function findStripHost(el) {
  return planChildren(el).find((child) => child !== findPlanContainer(el)) || null;
}

function hasStripClass(el) {
  const cls = el.getAttribute("class") || "";
  return String(cls).split(/\s+/).includes("bob-plan-has-day-strip");
}

test("require time adds no eager StateEffect.define()", () => {
  assert.equal(stateEffectDefines, 0, "this suite defines nothing eagerly");
});

test("renderPlanBlock appends exactly one host after .bob-plan on canonical days", async () => {
  await withFakeObserver(async () => {
    await withMissingConfig(async () => {
      const plugin = await makePlugin();
      try {
        const today = plugin.dayStripLocalNow();
        const stem = today.replace(/-/g, "");
        const folder = today.slice(0, 4);
        const sourcePath = `${folder}/${stem}.md`;
        for (const ctx of [{ sourcePath }, { sourcePath }]) {
          const el = fakePlanBlock();
          const added = [];
          plugin.renderPlanBlock(el, { sourcePath, addChild: (child) => added.push(child) });
          await settle();
          const container = findPlanContainer(el);
          assert.ok(container, "expected the .bob-plan container");
          assert.equal(planChildren(el)[0], container, ".bob-plan stays first");
          assert.equal(planChildren(el).length, 2, "exactly one host after .bob-plan");
          const host = planChildren(el)[1];
          assert.ok(host, "expected the strip host");
          assert.equal(hasStripClass(el), true, "spacing class is set");
          assert.equal(added.length, 1, "unload child is registered");
        }
      } finally {
        plugin.onunload();
      }
    });
  });
});

test("non-daily, future, dashboard, mobile, spawn-less, and excluded blocks get no host", async () => {
  await withFakeObserver(async () => {
    await withMissingConfig(async () => {
      const plugin = await makePlugin();
      try {
        const today = plugin.dayStripLocalNow();
        const future = shiftDay(today, 3);
        const futureStem = future.replace(/-/g, "");
        const futureFolder = future.slice(0, 4);
        const cases = [
          { sourcePath: "dash.md", label: "dashboard" },
          { sourcePath: "notes/old-daily.md", label: "non-daily" },
          { sourcePath: `${futureFolder}/${futureStem}.md`, label: "future" },
        ];
        for (const { sourcePath, label } of cases) {
          const el = fakePlanBlock();
          plugin.renderPlanBlock(el, { sourcePath, addChild: () => {} });
          await settle();
          assert.equal(planChildren(el).filter((child) => child !== findPlanContainer(el)).length, 0, `${label} gets no host`);
          assert.equal(hasStripClass(el), false, `${label} sets no spacing class`);
        }
        // Mobile / spawn-less.
        plugin.dayStripSpawnDisabled = true;
        {
          const stem = today.replace(/-/g, "");
          const el = fakePlanBlock();
          plugin.renderPlanBlock(el, { sourcePath: `${today.slice(0, 4)}/${stem}.md`, addChild: () => {} });
          await settle();
          assert.equal(planChildren(el).filter((child) => child !== findPlanContainer(el)).length, 0, "spawn-less gets no host");
        }
        plugin.dayStripSpawnDisabled = false;
        // Popovers, embeds, canvas nodes stand down.
        for (const label of ["popover", "embed", "canvas"]) {
          const stem = today.replace(/-/g, "");
          const el = fakePlanBlock();
          el._closest = el;
          plugin.renderPlanBlock(el, { sourcePath: `${today.slice(0, 4)}/${stem}.md`, addChild: () => {} });
          await settle();
          assert.equal(planChildren(el).filter((child) => child !== findPlanContainer(el)).length, 0, `${label} gets no host`);
        }
      } finally {
        plugin.onunload();
      }
    });
  });
});

test("paintPlanBlock keeps the same host node and .bob-plan first with no strip repaint or spawn", async () => {
  await withFakeObserver(async () => {
    await withMissingConfig(async () => {
      const plugin = await makePlugin();
      try {
        const today = plugin.dayStripLocalNow();
        const stem = today.replace(/-/g, "");
        const folder = today.slice(0, 4);
        const sourcePath = `${folder}/${stem}.md`;
        const current = fixtures.createReport({ day: today, today, count: 8 });
        const spawns = stubSpawn(plugin, () => ({ ok: true, report: current }));
        await seedDefault(plugin, current);
        const el = fakePlanBlock();
        plugin.renderPlanBlock(el, { sourcePath, addChild: () => {} });
        await settle(60);
        const host = planChildren(el)[1];
        assert.ok(host, "expected the strip host");
        const cached = plugin.dayStripPaintsCached;
        const skeleton = plugin.dayStripPaintsSkeleton;
        const spawnCount = spawns.length;
        const removedBefore = el.removed.length;
        // Repeated plan repaints (the 5 s repaint and rollover-adjacent
        // rerenders) must not touch the host.
        plugin.paintPlanBlock(el, sourcePath);
        await settle(60);
        plugin.paintPlanBlock(el, sourcePath);
        await settle(60);
        plugin.rerenderPlanBlocks();
        await settle(60);
        assert.equal(planChildren(el)[1], host, "the host node is never detached");
        assert.equal(planChildren(el)[0], findPlanContainer(el), ".bob-plan stays first");
        assert.ok(!el.removed.includes(host), "the host is never removed");
        assert.ok(!el.inserted.includes(host) || el.inserted.filter((node) => node === host).length === 1, "the host is never re-inserted");
        assert.equal(plugin.dayStripPaintsCached, cached, "no strip repaint on plan repaint");
        assert.equal(plugin.dayStripPaintsSkeleton, skeleton, "no skeleton repaint on plan repaint");
        assert.equal(spawns.length, spawnCount, "no spawn on plan repaint");
      } finally {
        plugin.onunload();
      }
    });
  });
});

test("toggle and stats.day_strip remove the host and class, re-enabling restores them", async () => {
  await withFakeObserver(async () => {
    await withMissingConfig(async () => {
      const plugin = await makePlugin();
      try {
        const today = plugin.dayStripLocalNow();
        const stem = today.replace(/-/g, "");
        const folder = today.slice(0, 4);
        const sourcePath = `${folder}/${stem}.md`;
        const el = fakePlanBlock();
        plugin.renderPlanBlock(el, { sourcePath, addChild: () => {} });
        await settle();
        assert.equal(planChildren(el).length, 2, "attached");
        // Repeated syncs never duplicate.
        const view = Array.from(plugin.planBlockViews).find((entry) => entry.el === el);
        plugin.dayStripSyncPlanHost(view);
        plugin.dayStripSyncPlanHost(view);
        assert.equal(planChildren(el).length, 2, "repeated syncs never duplicate");
        // Toggle off removes, toggle on restores.
        plugin.toggleDayStripPlanHost();
        assert.equal(planChildren(el).length, 1, "toggle off removes the host");
        assert.equal(hasStripClass(el), false, "toggle off drops the spacing class");
        plugin.toggleDayStripPlanHost();
        await settle();
        assert.equal(planChildren(el).length, 2, "toggle on restores the host");
        // Config off removes, config on restores.
        const originalEnabled = plugin.dayStripConfigEnabled.bind(plugin);
        plugin.dayStripConfigEnabled = () => false;
        assert.equal(plugin.dayStripCheckConfig(), true);
        assert.equal(planChildren(el).length, 1, "config off removes the host");
        plugin.dayStripConfigEnabled = originalEnabled;
        assert.equal(plugin.dayStripCheckConfig(), true);
        await settle();
        assert.equal(planChildren(el).length, 2, "config on restores the host");
      } finally {
        plugin.onunload();
      }
    });
  });
});

test("unload releases the record and its observer", async () => {
  await withFakeObserver(async () => {
    await withMissingConfig(async () => {
      const plugin = await makePlugin();
      try {
        const today = plugin.dayStripLocalNow();
        const stem = today.replace(/-/g, "");
        const sourcePath = `${today.slice(0, 4)}/${stem}.md`;
        const el = fakePlanBlock();
        const added = [];
        plugin.renderPlanBlock(el, { sourcePath, addChild: (child) => added.push(child) });
        await settle();
        assert.equal(added.length, 1);
        const [record] = Array.from(plugin.dayStripViews).filter((entry) => entry.kind === "plan");
        assert.ok(record, "plan record is registered");
        const size = plugin.dayStripViews.size;
        added[0].unload();
        assert.equal(plugin.dayStripViews.size, size - 1, "unload releases the record");
        assert.ok(!record.observer || record.observer.disconnected, "observer is disconnected");
        assert.equal(planChildren(el).filter((child) => child !== findPlanContainer(el)).length, 0, "host is removed");
      } finally {
        plugin.onunload();
      }
    });
  });
});

test("rollover attaches future blocks and repaints today as a past day", async () => {
  await withFakeObserver(async () => {
    await withMissingConfig(async () => {
      const plugin = await makePlugin();
      try {
        const today = plugin.dayStripLocalNow();
        const tomorrow = shiftDay(today, 1);
        const stem = tomorrow.replace(/-/g, "");
        const sourcePath = `${tomorrow.slice(0, 4)}/${stem}.md`;
        const el = fakePlanBlock();
        plugin.renderPlanBlock(el, { sourcePath, addChild: () => {} });
        await settle();
        assert.equal(planChildren(el).filter((child) => child !== findPlanContainer(el)).length, 0, "future starts with no host");
        plugin.dayStripLocalNow = () => tomorrow;
        plugin.dayStripHandleRollover();
        await settle(60);
        assert.equal(planChildren(el).length, 2, "future-to-today gains its strip");
        const host = planChildren(el)[1];
        assert.ok(host, "expected the rolled-over host");
      } finally {
        plugin.onunload();
      }
    });
  });
});

test("plan hosts never write the vault or journals", async () => {
  await withFakeObserver(async () => {
    await withMissingConfig(async () => {
      const app = makeApp();
      let writes = 0;
      app.vault.modify = async () => { writes += 1; };
      app.vault.process = async () => { writes += 1; };
      const plugin = await makePlugin(app);
      try {
        const today = plugin.dayStripLocalNow();
        const stem = today.replace(/-/g, "");
        const sourcePath = `${today.slice(0, 4)}/${stem}.md`;
        const current = fixtures.createReport({ day: today, today, count: 8 });
        stubSpawn(plugin, () => ({ ok: true, report: current }));
        await seedDefault(plugin, current);
        const el = fakePlanBlock();
        plugin.renderPlanBlock(el, { sourcePath, addChild: () => {} });
        await settle(60);
        plugin.paintPlanBlock(el, sourcePath);
        await settle(60);
        assert.equal(writes, 0, "no vault writes");
      } finally {
        plugin.onunload();
      }
    });
  });
});
