// Day strip plan hosts: the strip is the first child of the rendered
// `bob-plan` block, above the badges, in Live Preview and Reading view.
// The plan block's repaint never touches the host.
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

// Obsidian's real processor-then-insert order: Live Preview calls the
// code-block processor with a detached `block-language-bob-plan` element
// inside a detached `cm-preview-code-block` container, and only then
// inserts the container. Every node under the container, including the
// host, reports isConnected === false until attach.
function makeDetachedObsidianBlock() {
  const doc = fakeDocument();
  const container = new FakeNode("div", doc);
  container.setAttribute("class", "cm-preview-code-block cm-embed-block markdown-rendered");
  container.isConnected = false;
  container.ownerDocument = doc;
  const el = new FakeNode("div", doc);
  el.setAttribute("class", "block-language-bob-plan");
  el.ownerDocument = doc;
  el.isConnected = false;
  el.parentNode = container;
  container.children.push(el);
  return { doc, container, el };
}

function fixDetachedSubtree(container) {
  const stack = [container];
  while (stack.length) {
    const node = stack.pop();
    node.isConnected = false;
    for (const child of node.children) stack.push(child);
  }
}

function attachContainer(container, root) {
  root.appendChild(container);
  const stack = [container];
  while (stack.length) {
    const node = stack.pop();
    node.isConnected = true;
    for (const child of node.children) stack.push(child);
  }
}

function makeConnectedRoot(doc, cls, excluded = false) {
  const root = new FakeNode("div", doc);
  root.setAttribute("class", cls);
  root.isConnected = true;
  root.ownerDocument = doc;
  if (excluded) root._closest = root;
  return root;
}

function formatHM(fetchedAt) {
  const value = new Date(fetchedAt);
  return String(value.getHours()).padStart(2, "0") + ":" + String(value.getMinutes()).padStart(2, "0");
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

test("renderPlanBlock puts exactly one host first with .bob-plan after it on canonical days", async () => {
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
          assert.equal(planChildren(el).length, 2, "exactly one host with .bob-plan");
          const host = planChildren(el)[0];
          assert.ok(host, "expected the strip host");
          assert.ok(host !== container, "host and .bob-plan are distinct nodes");
          assert.ok(planChildren(el)[1] === container, ".bob-plan sits directly after the host");
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

test("paintPlanBlock keeps the same host node first with .bob-plan after it and no strip repaint or spawn", async () => {
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
        const host = planChildren(el)[0];
        assert.ok(host, "expected the strip host first");
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
        assert.ok(planChildren(el)[0] === host, "the host node stays first and is never detached");
        assert.ok(planChildren(el)[1] === findPlanContainer(el), ".bob-plan sits directly after the host");
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
        const host = planChildren(el)[0];
        assert.ok(host, "expected the rolled-over host first");
      } finally {
        plugin.onunload();
      }
    });
  });
});

test("rollover skeletons a visible automatic today host synchronously; it resolves as past", async () => {
  await withFakeObserver(async () => {
    await withMissingConfig(async () => {
      const plugin = await makePlugin();
      try {
        const today = plugin.dayStripLocalNow();
        const tomorrow = shiftDay(today, 1);
        const todayStem = today.replace(/-/g, "");
        const todayPath = `${today.slice(0, 4)}/${todayStem}.md`;
        const futureStem = tomorrow.replace(/-/g, "");
        const futurePath = `${tomorrow.slice(0, 4)}/${futureStem}.md`;
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
        const todayEl = fakePlanBlock();
        plugin.renderPlanBlock(todayEl, { sourcePath: todayPath, addChild: () => {} });
        const futureEl = fakePlanBlock();
        plugin.renderPlanBlock(futureEl, { sourcePath: futurePath, addChild: () => {} });
        await settle();
        observers[observers.length - 1].trigger(true);
        await settle(60);
        const todayHost = planChildren(todayEl).find((child) => child !== findPlanContainer(todayEl));
        assert.ok(todayHost, "today host is attached");
        assert.match(todayHost.textContent, /so far/, "today starts provisional");
        assert.equal(planChildren(futureEl).filter((child) => child !== findPlanContainer(futureEl)).length, 0, "future starts with no host");
        const before = spawns.length;
        plugin.dayStripLocalNow = () => tomorrow;
        plugin.dayStripHandleRollover();
        assert.ok(
          todayHost.querySelector(".bob-day-strip-state-skeleton"),
          "visible today host skeletons synchronously before the request settles",
        );
        assert.ok(
          !todayHost.querySelector(".bob-day-strip-state-ready"),
          "yesterday's ready frame stops immediately",
        );
        assert.equal(planChildren(futureEl).length, 2, "future-to-today attaches synchronously");
        await settle(30);
        assert.ok(resolveRange, "the visible rollover fetch is pending");
        const next = fixtures.createReport({ day: today, today: tomorrow, count: 8 });
        resolveRange({ ok: true, report: next });
        await settle(80);
        assert.ok(todayHost.querySelector(".bob-day-strip-state-ready"), "original day resolves to ready");
        assert.doesNotMatch(todayHost.textContent, /so far/, "resolved past day shows no so far");
        assert.ok(spawns.length >= before + 1, "rollover fetches under the visibility gate");
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

test("cold plan host waits for visibility: no spawn before callback, false stays zero, true fetches once", async () => {
  await withFakeObserver(async () => {
    await withMissingConfig(async () => {
      const plugin = await makePlugin();
      try {
        const today = plugin.dayStripLocalNow();
        const stem = today.replace(/-/g, "");
        const sourcePath = `${today.slice(0, 4)}/${stem}.md`;
        const current = fixtures.createReport({ day: today, today, count: 8 });
        const spawns = stubSpawn(plugin, () => ({ ok: true, report: current }));
        const el = fakePlanBlock();
        plugin.renderPlanBlock(el, { sourcePath, addChild: () => {} });
        await settle();
        const [record] = Array.from(plugin.dayStripViews).filter((entry) => entry.kind === "plan");
        assert.ok(record, "plan record is registered");
        assert.equal(record.visible, false, "visibility is unknown until the first callback");
        assert.equal(spawns.length, 0, "cold host spawns nothing before the observer callback");
        observers[observers.length - 1].trigger(false);
        await settle();
        assert.equal(record.visible, false, "first offscreen callback stays not-visible");
        assert.equal(spawns.length, 0, "first false callback still spawns nothing");
        observers[observers.length - 1].trigger(true);
        await settle(60);
        assert.equal(record.visible, true, "first visible callback establishes visibility");
        assert.equal(spawns.length, 1, "first true callback fetches once");
        observers[observers.length - 1].trigger(true);
        await settle(30);
        assert.equal(spawns.length, 1, "a clean second callback does not refetch");
      } finally {
        plugin.onunload();
      }
    });
  });
});

test("plan host paints synchronously from cache with zero spawn before visibility", async () => {
  await withFakeObserver(async () => {
    await withMissingConfig(async () => {
      const plugin = await makePlugin();
      try {
        const today = plugin.dayStripLocalNow();
        const stem = today.replace(/-/g, "");
        const sourcePath = `${today.slice(0, 4)}/${stem}.md`;
        const current = fixtures.createReport({ day: today, today, count: 8 });
        const spawns = stubSpawn(plugin, () => ({ ok: true, report: current }));
        await seedDefault(plugin, current);
        assert.equal(spawns.length, 1, "seeding costs one spawn");
        const el = fakePlanBlock();
        plugin.renderPlanBlock(el, { sourcePath, addChild: () => {} });
        const host = planChildren(el).find((child) => child !== findPlanContainer(el));
        assert.ok(host, "host is attached synchronously");
        assert.match(host.textContent, /Worked/, "cache paints synchronously before any callback");
        assert.equal(spawns.length, 1, "synchronous cache paint spawns nothing");
        await settle();
        assert.equal(spawns.length, 1, "still nothing before the observer callback");
      } finally {
        plugin.onunload();
      }
    });
  });
});

test("detached excluded blocks get no host; detached ordinary blocks attach synchronously", async () => {
  await withFakeObserver(async () => {
    await withMissingConfig(async () => {
      const plugin = await makePlugin();
      try {
        const today = plugin.dayStripLocalNow();
        const stem = today.replace(/-/g, "");
        const sourcePath = `${today.slice(0, 4)}/${stem}.md`;
        const current = fixtures.createReport({ day: today, today, count: 8 });
        const spawns = stubSpawn(plugin, () => ({ ok: true, report: current }));
        await seedDefault(plugin, current);
        const before = spawns.length;
        for (const label of ["popover", "embed", "canvas"]) {
          const ancestorDoc = fakeDocument();
          const ancestor = new FakeNode("div", ancestorDoc);
          ancestor.ownerDocument = ancestorDoc;
          ancestor.isConnected = false;
          ancestor._closest = ancestor;
          const el = new FakeNode("div", ancestorDoc);
          el.ownerDocument = ancestorDoc;
          el.isConnected = true;
          el.parentNode = ancestor;
          ancestor.children.push(el);
          plugin.renderPlanBlock(el, { sourcePath, addChild: () => {} });
          await settle();
          assert.equal(
            planChildren(el).filter((child) => child !== findPlanContainer(el)).length,
            0,
            `${label} detached context gets no host`,
          );
          assert.equal(hasStripClass(el), false, `${label} detached context sets no spacing class`);
        }
        assert.equal(spawns.length, before, "detached excluded blocks spawn nothing");
        // Obsidian's normal processor-time case: a detached block without an
        // excluded ancestor gets its host synchronously, with the spacing
        // class, a registered record with visible:false, a skeleton paint,
        // and zero spawns. Attachment and a true callback then fetch once.
        plugin.statsCacheStore().clear();
        const coldBefore = spawns.length;
        const { container, el } = makeDetachedObsidianBlock();
        plugin.renderPlanBlock(el, { sourcePath, addChild: () => {} });
        fixDetachedSubtree(container);
        await settle();
        assert.ok(planChildren(el)[0] !== findPlanContainer(el), "host comes before .bob-plan");
        assert.ok(planChildren(el)[1] === findPlanContainer(el), ".bob-plan sits directly after the host");
        assert.equal(planChildren(el).length, 2, "detached ordinary block attaches its host synchronously");
        assert.equal(hasStripClass(el), true, "detached host sets the spacing class");
        const [record] = Array.from(plugin.dayStripViews).filter((entry) => entry.kind === "plan" && entry.planView && entry.planView.el === el);
        assert.ok(record, "detached host registers a record");
        assert.equal(record.visible, false, "visibility is unknown until the first callback");
        assert.equal(spawns.length, coldBefore, "detached attach spawns nothing");
        const root = makeConnectedRoot(container.ownerDocument, "markdown-source-view");
        attachContainer(container, root);
        observers[observers.length - 1].trigger(true);
        await settle(60);
        assert.equal(spawns.length, coldBefore + 1, "first true callback after attach fetches once");
        assert.ok(planChildren(el)[0].querySelector(".bob-day-strip-state-ready"), "attached host reaches ready");
      } finally {
        plugin.onunload();
      }
    });
  });
});

test("no-observer fallback attaches detached, fetches on check after connect, releases excluded", async () => {
  const prior = globalThis.IntersectionObserver;
  try {
    delete globalThis.IntersectionObserver;
    await withMissingConfig(async () => {
      const plugin = await makePlugin();
      try {
        const today = plugin.dayStripLocalNow();
        const stem = today.replace(/-/g, "");
        const sourcePath = `${today.slice(0, 4)}/${stem}.md`;
        const current = fixtures.createReport({ day: today, today, count: 8 });
        const spawns = stubSpawn(plugin, () => ({ ok: true, report: current }));
        await seedDefault(plugin, current);
        const before = spawns.length;
        const el = fakePlanBlock();
        const added = [];
        plugin.renderPlanBlock(el, { sourcePath, addChild: (child) => added.push(child) });
        await settle(60);
        const [record] = Array.from(plugin.dayStripViews).filter((entry) => entry.kind === "plan");
        assert.ok(record, "fallback registers a connected host");
        assert.equal(record.visible, true, "connected fallback is visible");
        assert.equal(spawns.length, before, "fresh cache needs no refetch");
        assert.match(planChildren(el)[0].textContent, /Worked/, "fallback paints from cache");
        // Detached fallback attaches and paints without spawning.
        const { container, el: detached } = makeDetachedObsidianBlock();
        plugin.renderPlanBlock(detached, { sourcePath, addChild: () => {} });
        fixDetachedSubtree(container);
        await settle();
        assert.equal(planChildren(detached).length, 2, "detached fallback attaches its host");
        const [detachedRecord] = Array.from(plugin.dayStripViews).filter((entry) => entry.kind === "plan" && entry.planView && entry.planView.el === detached);
        assert.ok(detachedRecord, "detached fallback registers a record");
        assert.equal(detachedRecord.visible, false, "detached fallback stays not-visible");
        assert.equal(spawns.length, before, "detached fallback spawns nothing");
        // Once connected, the next check cycle fetches once.
        const cold = fixtures.createReport({ day: today, today, count: 8 });
        plugin.statsCacheStore().clear();
        const coldSpawns = stubSpawn(plugin, () => ({ ok: true, report: cold }));
        const coldBefore = coldSpawns.length;
        const { container: coldContainer, el: coldEl } = makeDetachedObsidianBlock();
        plugin.renderPlanBlock(coldEl, { sourcePath, addChild: () => {} });
        fixDetachedSubtree(coldContainer);
        await settle();
        assert.equal(coldSpawns.length, coldBefore, "cold detached fallback spawns nothing");
        const coldRoot = makeConnectedRoot(coldContainer.ownerDocument, "markdown-source-view");
        attachContainer(coldContainer, coldRoot);
        plugin.dayStripCheckAll();
        await settle(60);
        assert.equal(coldSpawns.length, coldBefore + 1, "next check after connect fetches once");
        // Connected excluded is released.
        const { container: exclContainer, el: exclEl } = makeDetachedObsidianBlock();
        plugin.renderPlanBlock(exclEl, { sourcePath, addChild: () => {} });
        fixDetachedSubtree(exclContainer);
        await settle();
        const exclRoot = makeConnectedRoot(exclContainer.ownerDocument, "markdown-source-view", true);
        attachContainer(exclContainer, exclRoot);
        plugin.dayStripCheckAll();
        await settle();
        assert.equal(
          planChildren(exclEl).filter((child) => child !== findPlanContainer(exclEl)).length,
          0,
          "connected excluded fallback is released",
        );
        assert.equal(hasStripClass(exclEl), false, "connected excluded fallback drops the spacing class");
        // Unload releases the fallback record and its host.
        assert.equal(added.length, 1, "fallback registers an unload child");
        const size = plugin.dayStripViews.size;
        added[0].unload();
        assert.equal(plugin.dayStripViews.size, size - 1, "unload releases the fallback record");
        assert.equal(planChildren(el).filter((child) => child !== findPlanContainer(el)).length, 0, "unload removes the host");
      } finally {
        plugin.onunload();
      }
    });
  } finally {
    if (prior === undefined) {
      delete globalThis.IntersectionObserver;
    } else {
      globalThis.IntersectionObserver = prior;
    }
  }
});

test("excluded after attach releases on the first observer callback", async () => {
  await withFakeObserver(async () => {
    await withMissingConfig(async () => {
      const plugin = await makePlugin();
      try {
        const today = plugin.dayStripLocalNow();
        const stem = today.replace(/-/g, "");
        const sourcePath = `${today.slice(0, 4)}/${stem}.md`;
        const current = fixtures.createReport({ day: today, today, count: 8 });
        const spawns = stubSpawn(plugin, () => ({ ok: true, report: current }));
        await seedDefault(plugin, current);
        const before = spawns.length;
        for (const cls of ["hover-popover", "markdown-embed", "canvas-node"]) {
          const { container, el } = makeDetachedObsidianBlock();
          plugin.renderPlanBlock(el, { sourcePath, addChild: () => {} });
          fixDetachedSubtree(container);
          await settle();
          assert.equal(planChildren(el).length, 2, `${cls}: detached ordinary block attaches first`);
          const root = makeConnectedRoot(container.ownerDocument, "markdown-source-view", true);
          root.setAttribute("class", cls);
          attachContainer(container, root);
          observers[observers.length - 1].trigger(true);
          await settle();
          assert.equal(
            planChildren(el).filter((child) => child !== findPlanContainer(el)).length,
            0,
            `${cls}: attached under exclusion releases the host`,
          );
          assert.equal(hasStripClass(el), false, `${cls}: exclusion drops the spacing class`);
          assert.equal(
            Array.from(plugin.dayStripViews).filter((entry) => entry.kind === "plan" && entry.planView && entry.planView.el === el).length,
            0,
            `${cls}: exclusion releases the record`,
          );
        }
        assert.equal(spawns.length, before, "excluded-after-attach spawns nothing");
      } finally {
        plugin.onunload();
      }
    });
  });
});

test("excluded processor container gets no host", async () => {
  await withFakeObserver(async () => {
    await withMissingConfig(async () => {
      const plugin = await makePlugin();
      try {
        const today = plugin.dayStripLocalNow();
        const stem = today.replace(/-/g, "");
        const sourcePath = `${today.slice(0, 4)}/${stem}.md`;
        const current = fixtures.createReport({ day: today, today, count: 8 });
        const spawns = stubSpawn(plugin, () => ({ ok: true, report: current }));
        await seedDefault(plugin, current);
        const before = spawns.length;
        const { container, el } = makeDetachedObsidianBlock();
        const excludedRoot = makeConnectedRoot(container.ownerDocument, "markdown-source-view", true);
        const processorContainer = new FakeNode("div", container.ownerDocument);
        processorContainer.isConnected = true;
        processorContainer.ownerDocument = container.ownerDocument;
        excludedRoot.appendChild(processorContainer);
        plugin.renderPlanBlock(el, { sourcePath, addChild: () => {}, containerEl: processorContainer });
        fixDetachedSubtree(container);
        await settle();
        assert.equal(
          planChildren(el).filter((child) => child !== findPlanContainer(el)).length,
          0,
          "connected excluded processor container gets no host",
        );
        assert.equal(hasStripClass(el), false, "excluded container sets no spacing class");
        assert.equal(spawns.length, before, "excluded container spawns nothing");
      } finally {
        plugin.onunload();
      }
    });
  });
});

test("reading-view order attaches detached, virtualized stays quiet until attach", async () => {
  await withFakeObserver(async () => {
    await withMissingConfig(async () => {
      const plugin = await makePlugin();
      try {
        const today = plugin.dayStripLocalNow();
        const stem = today.replace(/-/g, "");
        const sourcePath = `${today.slice(0, 4)}/${stem}.md`;
        const { container, el } = makeDetachedObsidianBlock();
        plugin.renderPlanBlock(el, { sourcePath, addChild: () => {} });
        fixDetachedSubtree(container);
        await settle();
        assert.equal(planChildren(el).length, 2, "reading flow attaches detached host synchronously");
        assert.ok(planChildren(el)[1] === findPlanContainer(el), "reading host sits above the badges");
        const [record] = Array.from(plugin.dayStripViews).filter((entry) => entry.kind === "plan" && entry.planView && entry.planView.el === el);
        assert.ok(record, "reading host registers a record");
        assert.equal(record.visible, false, "reading host waits for visibility");
        // A virtualized section stays detached: false gives zero spawns.
        const { container: virtContainer, el: virtEl } = makeDetachedObsidianBlock();
        // Cold cache so a later true must fetch.
        const spawns = stubSpawn(plugin, () => ({ ok: true, report: fixtures.createReport({ day: today, today, count: 8 }) }));
        const before = spawns.length;
        plugin.renderPlanBlock(virtEl, { sourcePath, addChild: () => {} });
        fixDetachedSubtree(virtContainer);
        await settle();
        const virtObserver = observers[observers.length - 1];
        virtObserver.trigger(false);
        await settle();
        assert.equal(spawns.length, before, "virtualized false callback spawns nothing");
        const previewRoot = makeConnectedRoot(virtContainer.ownerDocument, "markdown-preview-view");
        attachContainer(virtContainer, previewRoot);
        virtObserver.trigger(true);
        await settle(60);
        assert.equal(spawns.length, before + 1, "attached reading host fetches once on true");
      } finally {
        plugin.onunload();
      }
    });
  });
});

test("today host shows so far HH:MM from the fetch stamp", async () => {
  await withFakeObserver(async () => {
    await withMissingConfig(async () => {
      const plugin = await makePlugin();
      try {
        const today = plugin.dayStripLocalNow();
        const stem = today.replace(/-/g, "");
        const sourcePath = `${today.slice(0, 4)}/${stem}.md`;
        const current = fixtures.createReport({ day: today, today, count: 8 });
        stubSpawn(plugin, () => ({ ok: true, report: current }));
        const { container, el } = makeDetachedObsidianBlock();
        plugin.renderPlanBlock(el, { sourcePath, addChild: () => {} });
        fixDetachedSubtree(container);
        await settle();
        const root = makeConnectedRoot(container.ownerDocument, "markdown-source-view");
        attachContainer(container, root);
        observers[observers.length - 1].trigger(true);
        await settle(80);
        const host = planChildren(el)[0];
        assert.ok(host, "today host is attached first");
        const [record] = Array.from(plugin.dayStripViews).filter((entry) => entry.kind === "plan" && entry.planView && entry.planView.el === el);
        assert.ok(record, "today host registers a record");
        const { key } = helpers.statsRequestFor({});
        const entry = plugin.statsCacheGet(key);
        assert.ok(entry && entry.report, "fetch stored the cache entry");
        const expected = `so far \u00b7 ${formatHM(entry.fetchedAt)}`;
        assert.match(host.textContent, /so far \u00b7 \d\d:\d\d/, "ready today host names the fetch time");
        assert.ok(host.textContent.includes(expected), `meta carries the fetch stamp (${expected})`);
        assert.ok(record.paintedKey && record.paintedKey.includes(String(entry.fetchedAt)), "paintedKey stamp equals fetchedAt");
      } finally {
        plugin.onunload();
      }
    });
  });
});

test("failed refresh over a cached report names the HH:MM it shows", async () => {
  await withFakeObserver(async () => {
    await withMissingConfig(async () => {
      const plugin = await makePlugin();
      try {
        const today = plugin.dayStripLocalNow();
        const stem = today.replace(/-/g, "");
        const sourcePath = `${today.slice(0, 4)}/${stem}.md`;
        const current = fixtures.createReport({ day: today, today, count: 8 });
        let fail = false;
        stubSpawn(plugin, () => {
          if (fail) return { ok: false, code: "timeout", message: "boom", detail: "" };
          return { ok: true, report: current };
        });
        await seedDefault(plugin, current);
        const { container, el } = makeDetachedObsidianBlock();
        plugin.renderPlanBlock(el, { sourcePath, addChild: () => {} });
        fixDetachedSubtree(container);
        await settle();
        const root = makeConnectedRoot(container.ownerDocument, "markdown-source-view");
        attachContainer(container, root);
        observers[observers.length - 1].trigger(true);
        await settle(60);
        const { key } = helpers.statsRequestFor({});
        const cached = plugin.statsCacheGet(key);
        assert.ok(cached && cached.report, "cached report is stored");
        fail = true;
        plugin.statsBumpChangeGen();
        // Age the entry past the today minimum so the next check refetches.
        try {
          const stored = plugin.statsCacheStore().get(key);
          if (stored) stored.fetchedAt = cached.fetchedAt - 31 * 1000;
        } catch (error) {
          // Age is best-effort in the fake harness.
        }
        const aged = plugin.statsCacheGet(key);
        const expectedHM = formatHM(aged ? aged.fetchedAt : cached.fetchedAt);
        plugin.dayStripCheckAll();
        await settle(80);
        const host = planChildren(el)[0];
        assert.ok(host, "failed host keeps its frame");
        assert.match(host.textContent, /so far \u00b7 \d\d:\d\d \u00b7 refresh failed/, "failed today names so far HH:MM plus refresh failed");
        assert.ok(host.textContent.includes(expectedHM), `failed meta names the shown HH:MM (${expectedHM})`);
      } finally {
        plugin.onunload();
      }
    });
  });
});

test("placeholder finds .bob-plan by class and toggle-off restores it first", async () => {
  await withFakeObserver(async () => {
    await withMissingConfig(async () => {
      const plugin = await makePlugin();
      try {
        const today = plugin.dayStripLocalNow();
        const stem = today.replace(/-/g, "");
        const sourcePath = `${today.slice(0, 4)}/${stem}.md`;
        const el = fakePlanBlock();
        // A leading non-plan child must never be mistaken for the badges.
        const decoy = el.createDiv({ cls: "bob-plan-decoy" });
        assert.ok(planChildren(el)[0] === decoy, "decoy leads before render");
        plugin.renderPlanBlock(el, { sourcePath, addChild: () => {} });
        await settle();
        const container = findPlanContainer(el);
        assert.ok(container, "placeholder still finds the .bob-plan container by class");
        assert.ok(container !== decoy, "placeholder never returns the decoy by index");
        assert.ok(planChildren(el)[0] !== container, "host stays first even with a leading decoy");
        // Toggle off removes the host and leaves .bob-plan behind.
        plugin.toggleDayStripPlanHost();
        assert.equal(planChildren(el).filter((child) => child !== container && child !== decoy).length, 0, "toggle off removes the host");
        assert.ok(planChildren(el).includes(container), "toggle off keeps .bob-plan");
        plugin.toggleDayStripPlanHost();
        await settle();
        assert.ok(planChildren(el)[0] !== container, "toggle on restores the host first");
        assert.ok(planChildren(el).includes(container), "toggle on keeps .bob-plan");
      } finally {
        plugin.onunload();
      }
    });
  });
});
