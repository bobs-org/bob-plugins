const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { LedgerToolsPlugin, TestNotice, makeFreshnessApp, withMissingConfig } = require("./ledger-tools-harness.cjs");

const helpers = LedgerToolsPlugin.helpers;
const fixtureDir = path.join(__dirname, "../plugins/bob-ledger-tools/scripts/fixtures/bank-period");

class FakeNode {
  constructor(tag, ownerDocument) {
    this.tagName = String(tag).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.children = [];
    this.attrs = new Map();
    this.listeners = new Map();
    this.style = {};
    this._text = "";
    this._closest = null;
  }
  set textContent(value) {
    this._text = String(value);
    for (const child of this.children) child.parentNode = null;
    this.children = [];
  }
  get textContent() { return [this._text, ...this.children.map((child) => child.textContent)].filter(Boolean).join(""); }
  get firstChild() { return this.children[0] || null; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  removeAttribute(name) { this.attrs.delete(name); }
  appendChild(child) {
    if (child.parentNode && Array.isArray(child.parentNode.children)) {
      const old = child.parentNode.children.indexOf(child);
      if (old >= 0) child.parentNode.children.splice(old, 1);
    }
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  insertBefore(child, before) {
    if (child.parentNode && Array.isArray(child.parentNode.children)) {
      const old = child.parentNode.children.indexOf(child);
      if (old >= 0) child.parentNode.children.splice(old, 1);
    }
    child.parentNode = this;
    const index = before ? this.children.indexOf(before) : -1;
    if (index < 0) this.children.push(child);
    else this.children.splice(index, 0, child);
    return child;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  replaceChildren(...children) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this._text = "";
    for (const child of children) this.appendChild(child);
  }
  empty() { this.replaceChildren(); }
  closest() { return this._closest; }
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
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector, found = []) {
    const wanted = String(selector || "").startsWith(".") ? String(selector).slice(1) : null;
    if (wanted && (this.getAttribute("class") || "").split(/\s+/).includes(wanted)) found.push(this);
    for (const child of this.children) if (child instanceof FakeNode) child.querySelectorAll(selector, found);
    return found;
  }
}

function fakeHost() {
  const doc = { createElement: (tag) => new FakeNode(tag, doc), createElementNS: (_ns, tag) => new FakeNode(tag, doc) };
  return new FakeNode("div", doc);
}

function makePlugin(options = {}) {
  const files = new Map([["bank.md", { path: "bank.md" }], ["bank/2026-11.md", { path: "bank/2026-11.md" }]]);
  const app = makeFreshnessApp({ tasks: [] });
  app.vault = {
    ...app.vault,
    getAbstractFileByPath: (name) => files.get(name) || null,
    getMarkdownFiles: () => Array.from(files.values()),
    on: () => ({}),
  };
  const stored = options.stored || null;
  const saved = [];
  app.loadLocalStorage = (key) => key === "bob-ledger-tools-bank-period-view" ? stored : null;
  app.saveLocalStorage = (key, value) => saved.push([key, value]);
  let writes = 0;
  app.vault.create = app.vault.modify = app.vault.process = () => { writes += 1; };
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.onload();
  plugin.bankBadgeLocalToday = () => options.today || "2026-11-14";
  plugin.bankLocalDay = options.today || "2026-11-14";
  plugin.dayStripCanSpawn = () => options.canSpawn !== false;
  plugin.periodStripCanSpawn = () => options.canSpawn !== false;
  plugin.periodStripSpawnShow = async (periodId) => ({
    ok: true,
    report: { schema_version: 1, ok: true, period: { id: periodId, kind: "week", start: "2026-11-09", end: "2026-11-15", state: "current" }, facts: [], columns: [], children: [] },
  });
  const subscriptions = [];
  plugin.apiBankSubscribe = (spec, subscriber) => {
    const entry = { spec, subscriber, unloaded: false };
    subscriptions.push(entry);
    return () => { entry.unloaded = true; };
  };
  plugin.bankOpenMonthPathAtLine = async (notePath, line, _offset, opts) => {
    plugin.__opened = { notePath, line, opts };
    return true;
  };
  plugin.__files = files;
  plugin.__subscriptions = subscriptions;
  plugin.__saved = saved;
  plugin.__writes = () => writes;
  return plugin;
}

function mount(plugin, language, sourcePath, source = "") {
  const el = fakeHost();
  const added = [];
  plugin.codeBlocks[language](source, el, { sourcePath, addChild: (child) => added.push(child) });
  return { el, added };
}

function recordFor(plugin, el) {
  return Array.from(plugin.periodStripViews || []).find((record) => record.fenceEl === el || record.el === el || record.el.parentNode === el);
}

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir, name), "utf8"));
}

function activatePanelWithFixture(plugin, record, filename) {
  const decoded = helpers.bankDecodeReport(JSON.stringify(loadFixture(filename)), "");
  assert.equal(decoded.ok, true, `${filename} decodes: ${decoded.error && decoded.error.message}`);
  const panel = record.bankPeriodRecord;
  assert.ok(panel, "period panel subscribed");
  const state = { today: "2026-11-14", results: { [panel.key]: { report: decoded.report, stale: false, error: null } } };
  panel.state = state;
  panel.result = state.results[panel.key];
  panel.sync();
  return decoded.report;
}

const observerList = [];
class FakeIntersectionObserver {
  constructor(callback) { this.callback = callback; this.targets = []; observerList.push(this); }
  observe(target) { this.targets.push(target); }
  disconnect() { this.disconnected = true; }
  trigger(isIntersecting) { this.callback(this.targets.map((target) => ({ isIntersecting, target }))); }
}

async function withObserver(run) {
  const previous = globalThis.IntersectionObserver;
  observerList.length = 0;
  globalThis.IntersectionObserver = FakeIntersectionObserver;
  try { await run(); }
  finally {
    if (previous === undefined) delete globalThis.IntersectionObserver;
    else globalThis.IntersectionObserver = previous;
  }
}

test("real bob JSON decodes into models and paints through the period host", async () => {
  await withMissingConfig(async () => {
    const plugin = makePlugin();
    try {
      const { el } = mount(plugin, "bob-stats-strip", "2026/2026-W46.md");
      const record = recordFor(plugin, el);
      assert.deepEqual(el.children.map((child) => child.getAttribute("class")), [
        "bob-stats-strip-host", "bob-bank-badge-host", "bob-bank-period-host",
      ]);
      const files = [
        ["week-2026-W46.json", "week", "2026-W46"],
        ["quarter-2026-Q4.json", "quarter", "2026-Q4"],
        ["iso-year-2026.json", "year", "2026"],
        ["all-time.json", "all", "all"],
        ["future-week-2026-W48.json", "week", "2026-W48"],
      ];
      for (const [filename, kind, periodId] of files) {
        const decoded = helpers.bankDecodeReport(JSON.stringify(loadFixture(filename)), "");
        assert.equal(decoded.ok, true, filename);
        const model = helpers.bankPeriodChartsModel(decoded.report, {
          kind, periodId, today: "2026-11-14", badgeEnabled: true, view: "both", collapsed: false,
        });
        assert.equal(model.state, filename.startsWith("future-") ? "hidden" : "charts", filename);
        if (filename === "week-2026-W46.json") {
          const host = fakeHost();
          helpers.bankPeriodPaint(host, model, {});
          assert.ok(host.querySelector(".bob-bank-period"));
          assert.ok(host.querySelector(".bob-bank-period-sr"));
          activatePanelWithFixture(plugin, record, filename);
          assert.ok(record.periodHost.querySelector(".bob-bank-period"));
        }
      }
    } finally {
      plugin.onunload();
    }
  });
});

test("only non-day strip fences mount a third host, and future or unsupported hosts do not subscribe", async () => {
  await withMissingConfig(async () => {
    const plugin = makePlugin();
    try {
      for (const sourcePath of ["2026/2026-Q4.md", "2026.md", "all_time.md"]) {
        const { el } = mount(plugin, "bob-stats-strip", sourcePath);
        assert.equal(el.children.length, 3, sourcePath);
        assert.equal(el.children[2].getAttribute("class"), "bob-bank-period-host");
      }
      const day = mount(plugin, "bob-stats-strip", "2026/20261114.md");
      assert.equal(day.el.querySelector(".bob-bank-period-host"), null);
      const dayStats = mount(plugin, "bob-day-stats", "2026/20261114.md");
      assert.equal(dayStats.el.querySelector(".bob-bank-period-host"), null);
      const parts = mount(plugin, "bob-period-parts", "2026/2026-Q4.md");
      assert.equal(parts.el.querySelector(".bob-bank-period-host"), null);
      const embed = fakeHost();
      embed._closest = embed;
      plugin.codeBlocks["bob-stats-strip"]("", embed, { sourcePath: "2026/2026-W46.md", addChild() {} });
      assert.equal(embed.querySelector(".bob-bank-period-host"), null);
      const before = plugin.__subscriptions.filter((entry) => entry.spec.charts === true).length;
      const future = mount(plugin, "bob-stats-strip", "2027/2027-W01.md");
      assert.equal(future.el.children.length, 2, "future periods do not mount the panel host");
      assert.equal(plugin.__subscriptions.filter((entry) => entry.spec.charts === true).length, before);
      const blocked = makePlugin({ canSpawn: false });
      try {
        const noSpawn = mount(blocked, "bob-stats-strip", "2026/2026-W46.md");
        assert.equal(noSpawn.el.querySelector(".bob-bank-period-host"), null);
      } finally {
        blocked.onunload();
      }
    } finally {
      plugin.onunload();
    }
  });
});

test("the period fetch waits for visibility and has a cache key separate from the badge", async () => {
  await withMissingConfig(async () => withObserver(async () => {
    const plugin = makePlugin();
    try {
      const { el } = mount(plugin, "bob-stats-strip", "2026/2026-W46.md");
      const record = recordFor(plugin, el);
      assert.equal(plugin.__subscriptions.length, 0);
      observerList.at(-1).trigger(true);
      const panel = record.bankPeriodRecord;
      assert.ok(panel);
      const badge = record.bankBadgeRecord;
      assert.ok(badge);
      assert.notEqual(panel.key, badge.key);
      assert.deepEqual(panel.spec, { command: "report", period: "2026-W46", summary: true, charts: true });
      assert.ok(plugin.__subscriptions.some((entry) => entry.spec.charts === true));
      observerList.at(-1).trigger(false);
      plugin.bankRefreshBadgeHosts();
      assert.equal(record.bankPeriodRecord, null);
      assert.equal(record.periodHost.textContent, "");
    } finally {
      plugin.onunload();
    }
  }));
});

test("the no-observer hidden-to-shown retry subscribes once", async () => {
  await withMissingConfig(async () => {
    const previous = globalThis.IntersectionObserver;
    delete globalThis.IntersectionObserver;
    try {
      const plugin = makePlugin();
      try {
        let shown = false;
        const { el } = mount(plugin, "bob-stats-strip", "2026/2026-W46.md");
        const record = recordFor(plugin, el);
        plugin.bankReleaseFencePeriod(record, { keepHost: true });
        plugin.bankReleaseFenceBadge(record, { keepHost: true });
        plugin.__subscriptions.length = 0;
        record.fenceEl.isShown = () => shown;
        plugin.periodStripCheckAll();
        assert.equal(plugin.__subscriptions.length, 0);
        shown = true;
        plugin.periodStripCheckAll();
        assert.equal(plugin.__subscriptions.filter((entry) => entry.spec.charts === true).length, 1);
        plugin.periodStripCheckAll();
        assert.equal(plugin.__subscriptions.filter((entry) => entry.spec.charts === true).length, 1);
      } finally {
        plugin.onunload();
      }
    } finally {
      if (previous !== undefined) globalThis.IntersectionObserver = previous;
    }
  });
});

test("bank_period and bank_badge gate independently; older bob warns once", async () => {
  await withMissingConfig(async () => {
    const previous = globalThis.Notice;
    const previousWarn = console.warn;
    const warns = [];
    TestNotice.messages.length = 0;
    console.warn = (message) => warns.push(String(message));
    const plugin = makePlugin();
    try {
      const { el } = mount(plugin, "bob-stats-strip", "2026/2026-W46.md");
      const record = recordFor(plugin, el);
      const report = activatePanelWithFixture(plugin, record, "week-2026-W46.json");
      assert.ok(record.badgeRecord || record.bankBadgeRecord);
      assert.ok(record.periodHost.querySelector(".bob-bank-period"));

      plugin.bankBadgeConfigEnabled = () => false;
      assert.equal(plugin.bankBadgeCheckConfig(), true);
      assert.equal(record.bankBadgeRecord, null);
      assert.ok(record.periodHost.querySelector(".bob-bank-period"));

      plugin.bankPeriodConfigEnabled = () => false;
      assert.equal(plugin.bankBadgeCheckConfig(), true);
      assert.equal(record.bankPeriodRecord, null);
      assert.equal(record.periodHost.textContent, "");

      plugin.bankBadgeConfigEnabled = () => true;
      plugin.bankPeriodConfigEnabled = () => true;
      plugin.bankBadgeCheckConfig();
      const panel = record.bankPeriodRecord;
      assert.ok(panel);
      panel.result = {
        report: null,
        stale: false,
        error: { message: "unexpected argument '-c'", detail: "error: unexpected argument '-c' found", exitCode: 2, code: "bad-json" },
      };
      panel.sync();
      panel.sync();
      assert.equal(record.periodHost.textContent, "");
      assert.equal(warns.length, 1);
      assert.ok(record.bankBadgeRecord, "the badge remains subscribed when this bob lacks -c");

      const missing = await plugin.bankPeriodNavigateBucket({ path: "2026/2026-W45.md", line: 1 }, { label: "W45" });
      assert.equal(missing, false);
      assert.match(TestNotice.messages.at(-1), /No note for W45 yet/);
      assert.equal(plugin.__writes(), 0);
      assert.ok(report);
    } finally {
      console.warn = previousWarn;
      if (previous !== undefined) globalThis.Notice = previous;
      plugin.onunload();
    }
  });
});

test("read-only navigation, isolated repaint, persistence, and release work", async () => {
  await withMissingConfig(async () => {
    const plugin = makePlugin({ stored: { view: "invalid", collapsed: "yes" } });
    try {
      const { el, added } = mount(plugin, "bob-stats-strip", "2026/2026-W46.md");
      const record = recordFor(plugin, el);
      activatePanelWithFixture(plugin, record, "week-2026-W46.json");
      const badgeHost = record.badgeHost;
      const stripHost = record.el;
      assert.ok(record.periodHost.querySelector(".bob-bank-period"));

      const clickableDay = record.periodHost.querySelectorAll(".bob-bank-period-column")
        .find((node) => node.getAttribute("data-column") === "2026-11-11");
      assert.ok(clickableDay, "a real day bucket with a bank heading is activated through the painter");
      clickableDay.dispatch("click", { button: 0 });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(plugin.__opened.notePath, "bank/2026-11.md");
      assert.equal(plugin.__writes(), 0);

      plugin.__files.set("2026/2026-W46.md", { path: "2026/2026-W46.md" });
      await plugin.bankPeriodNavigateBucket(
        { path: "2026/2026-W46.md", line: 1 }, { label: "W46" }, true,
      );
      assert.equal(plugin.__opened.notePath, "2026/2026-W46.md");
      assert.equal(plugin.__opened.line, 1);
      assert.equal(plugin.__opened.opts.newLeaf, true);
      assert.equal(plugin.__opened.opts.skipPendingSave, true);
      await plugin.bankPeriodNavigateBucket(
        { path: "bank/2026-11.md", line: 12 }, { kind: "day", label: "Wed 11" }, false,
      );
      assert.equal(plugin.__opened.notePath, "bank/2026-11.md");
      assert.equal(plugin.__writes(), 0);

      const normalized = plugin.bankPeriodViewState();
      assert.deepEqual(normalized, { view: "both", collapsed: false });
      plugin.bankPeriodSetView("categories");
      assert.deepEqual(plugin.__saved.at(-1), ["bob-ledger-tools-bank-period-view", { view: "categories", collapsed: false }]);
      assert.equal(record.badgeHost, badgeHost);
      assert.equal(record.el, stripHost);
      assert.ok(record.periodHost.querySelector(".bob-bank-period"));
      plugin.bankPeriodToggleCollapsed();
      assert.equal(plugin.__saved.at(-1)[1].collapsed, true);
      assert.equal(record.periodHost.querySelector(".bob-bank-period-collapsed") !== null, true);

      plugin.periodStripPaint(record);
      assert.ok(record.periodHost.querySelector(".bob-bank-period"), "strip repaint leaves the panel intact");
      assert.equal(record.badgeHost, badgeHost);
      const panel = record.bankPeriodRecord;
      plugin.bankPeriodPaintFenceRecord(panel);
      assert.equal(record.el, stripHost, "panel repaint does not clear the strip");
      assert.equal(record.badgeHost, badgeHost, "panel repaint does not clear the badge");

      assert.ok(added.length);
      const subscribed = plugin.__subscriptions.filter((entry) => !entry.unloaded).length;
      added[0].unload();
      assert.ok(plugin.__subscriptions.filter((entry) => entry.unloaded).length >= 2);
      assert.ok(plugin.__subscriptions.filter((entry) => !entry.unloaded).length < subscribed);
      assert.equal(plugin.__writes(), 0);
    } finally {
      plugin.onunload();
    }
  });
});
