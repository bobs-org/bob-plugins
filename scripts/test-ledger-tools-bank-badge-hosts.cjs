// Fence hosts for the Bank Badge: sibling strip + badge hosts after every
// Day and period strip, visibility-gated fetches, future skip, older-bob.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { LedgerToolsPlugin, makeFreshnessApp, withMissingConfig } = require("./ledger-tools-harness.cjs");

const helpers = LedgerToolsPlugin.helpers;
const fixtureDir = path.join(__dirname, "../plugins/bob-ledger-tools/scripts/fixtures/bank");
const reportDoc = JSON.parse(fs.readFileSync(path.join(fixtureDir, "report-month.json"), "utf8"));
const reportDecoded = helpers.bankDecodeReport(JSON.stringify(reportDoc), "");

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function drain() {
  for (let index = 0; index < 16; index += 1) await Promise.resolve();
  await flush();
}

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
  get textContent() {
    return [this._text, ...this.children.map((child) => child.textContent)].filter(Boolean).join("");
  }
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
  querySelector(selector) {
    const found = this.querySelectorAll(selector);
    return found.length ? found[0] : null;
  }
  querySelectorAll(selector, found = []) {
    const wanted = String(selector || "").startsWith(".") ? String(selector).slice(1) : null;
    if (wanted && (this.getAttribute("class") || "").split(/\s+/).includes(wanted)) found.push(this);
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

function hostClasses(el) {
  return el.children.map((child) => child.getAttribute("class") || "");
}

function reportEndFor(kind, id, start) {
  try {
    if (kind === "day") return start;
    if (kind === "week") return helpers.dayStripShiftDay(start, 6) || start;
    if (kind === "quarter") {
      const match = /^(\d{4})-Q([1-4])$/.exec(id);
      if (!match) return start;
      const year = Number(match[1]);
      const quarter = Number(match[2]);
      const nextStart = quarter < 4
        ? helpers.periodNotesIsoWeekMonday(year, quarter * 13 + 1)
        : helpers.periodNotesIsoWeekMonday(year + 1, 1);
      return (nextStart && helpers.dayStripShiftDay(nextStart, -1)) || start;
    }
    if (kind === "year" || kind === "iso_year") {
      const year = Number(id);
      if (!Number.isInteger(year)) return start;
      const nextStart = helpers.periodNotesIsoWeekMonday(year + 1, 1);
      return (nextStart && helpers.dayStripShiftDay(nextStart, -1)) || start;
    }
    if (kind === "all" || kind === "all_time") return "2026-11-14";
  } catch (error) {
    // Fall through to the start date.
  }
  return start;
}

function reportFor(kind, id, extra = {}) {
  const starts = {
    day: id,
    week: helpers.bankBadgePeriodStart("week", id) || "2026-11-09",
    quarter: helpers.bankBadgePeriodStart("quarter", id) || "2026-09-28",
    year: helpers.bankBadgePeriodStart("year", id) || "2025-12-29",
    all: "2026-11-11",
    iso_year: helpers.bankBadgePeriodStart("year", id) || "2025-12-29",
    all_time: "2026-11-11",
  };
  const reportKind = kind === "year" ? "iso_year" : kind === "all" ? "all_time" : kind;
  const start = extra.start || starts[kind] || starts[reportKind] || id;
  const key = reportKind === "all_time" ? "all_time" : id;
  return {
    ...reportDecoded.report,
    period: {
      kind: reportKind,
      key,
      start,
      end: extra.end || reportEndFor(kind === "year" ? "year" : kind, id, start),
      label: extra.label || id,
      so_far: extra.so_far !== false,
      note: null,
    },
  };
}

function makePlugin(options = {}) {
  const files = new Map();
  if (options.hub !== false) files.set("bank.md", { path: "bank.md" });
  const app = makeFreshnessApp({ tasks: [] });
  app.vault = {
    ...app.vault,
    getAbstractFileByPath: (name) => files.get(name) || null,
    getMarkdownFiles: () => Array.from(files.values()),
    on: () => ({}),
  };
  app.metadataCache = {
    ...app.metadataCache,
    on: () => ({}),
  };
  app.loadLocalStorage = () => null;
  app.saveLocalStorage = () => {};
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
  const spawns = [];
  plugin.bankSpawnFetch = async (args) => {
    spawns.push(args.slice());
    if (typeof options.spawn === "function") return options.spawn(args, spawns);
    const periodIndex = args.indexOf("-p");
    const weekIndex = args.indexOf("-w");
    const dayIndex = args.indexOf("-D");
    if (periodIndex >= 0) {
      const id = args[periodIndex + 1];
      const kind = id === "all" ? "all" : /^\d{4}-Q/.test(id) ? "quarter" : "year";
      return { ok: true, report: reportFor(kind, id) };
    }
    if (weekIndex >= 0) return { ok: true, report: reportFor("week", args[weekIndex + 1]) };
    if (dayIndex >= 0) return { ok: true, report: reportFor("day", args[dayIndex + 1], { end: args[dayIndex + 1] }) };
    return { ok: true, report: reportDecoded.report };
  };
  plugin.__spawns = spawns;
  plugin.__files = files;
  return plugin;
}

function mount(plugin, language, sourcePath, source = "") {
  const el = fakeHost();
  const added = [];
  plugin.codeBlocks[language](source, el, { sourcePath, addChild: (child) => added.push(child) });
  return { el, added };
}

function stripRecord(plugin, el) {
  const fromDay = Array.from(plugin.dayStripViews || []).find((entry) =>
    entry.fenceEl === el || entry.el === el || (entry.el && entry.el.parentNode === el),
  );
  if (fromDay) return fromDay;
  return Array.from(plugin.periodStripViews || []).find((entry) =>
    entry.fenceEl === el || entry.el === el || (entry.el && entry.el.parentNode === el),
  );
}

const observers = [];
class FakeIntersectionObserver {
  constructor(callback) {
    this.callback = callback;
    this.targets = [];
    this.disconnected = false;
    observers.push(this);
  }
  observe(el) { this.targets.push(el); }
  disconnect() { this.disconnected = true; }
  trigger(isIntersecting) {
    this.callback(this.targets.map((target) => ({ isIntersecting, target })));
  }
}

async function withFakeObserver(run) {
  const prior = globalThis.IntersectionObserver;
  observers.length = 0;
  globalThis.IntersectionObserver = FakeIntersectionObserver;
  try {
    return await run();
  } finally {
    if (prior === undefined) delete globalThis.IntersectionObserver;
    else globalThis.IntersectionObserver = prior;
  }
}

test("strip, badge, and period hosts land on period fences; day fences keep two", async () => {
  await withMissingConfig(async () => {
    const plugin = makePlugin();
    try {
      const cases = [
        ["bob-stats-strip", "2026/2026-W46.md", ""],
        ["bob-stats-strip", "2026/2026-Q4.md", ""],
        ["bob-stats-strip", "2026.md", ""],
        ["bob-stats-strip", "all_time.md", ""],
        ["bob-stats-strip", "2026/20261114.md", ""],
        ["bob-day-stats", "2026/20261114.md", ""],
      ];
      for (const [language, sourcePath, source] of cases) {
        const { el } = mount(plugin, language, sourcePath, source);
        const hasPeriodPanel = language === "bob-stats-strip" && !/\/\d{8}\.md$/.test(sourcePath);
        assert.equal(el.children.length, hasPeriodPanel ? 3 : 2, sourcePath);
        assert.match(hostClasses(el)[0], /bob-stats-strip-host|bob-day-strip/);
        assert.equal(hostClasses(el)[1], "bob-bank-badge-host");
        if (hasPeriodPanel) assert.equal(hostClasses(el)[2], "bob-bank-period-host");
        const record = stripRecord(plugin, el);
        assert.ok(record, sourcePath);
        assert.equal(record.el, el.children[0]);
        assert.equal(record.badgeHost, el.children[1]);
        assert.equal(record.periodHost || null, hasPeriodPanel ? el.children[2] : null);
      }
      const table = mount(plugin, "bob-period-parts", "2026/2026-Q4.md");
      assert.equal(table.el.querySelector(".bob-bank-badge-host"), null);
      const popover = fakeHost();
      popover._closest = popover;
      plugin.codeBlocks["bob-stats-strip"]("", popover, { sourcePath: "2026/2026-W46.md", addChild: () => {} });
      assert.equal(popover.querySelector(".bob-bank-badge-host"), null);
    } finally {
      plugin.onunload();
    }
  });
});

test("a strip repaint keeps the badge node", async () => {
  await withMissingConfig(async () => {
    const plugin = makePlugin();
    try {
      const { el } = mount(plugin, "bob-stats-strip", "2026/2026-W46.md");
      const badge = el.children[1];
      const record = stripRecord(plugin, el);
      record.paintedKey = null;
      plugin.periodStripPaint(record);
      assert.equal(el.children[1], badge);
      assert.equal(el.children[0], record.el);
    } finally {
      plugin.onunload();
    }
  });
});

test("each strip kind fetches the matching bank report args", async () => {
  await withMissingConfig(async () => {
    const plugin = makePlugin();
    try {
      mount(plugin, "bob-day-stats", "2026/20261114.md");
      mount(plugin, "bob-stats-strip", "2026/2026-W46.md");
      mount(plugin, "bob-stats-strip", "2026/2026-Q4.md");
      mount(plugin, "bob-stats-strip", "2026.md");
      mount(plugin, "bob-stats-strip", "all_time.md");
      await drain();
      const keys = plugin.__spawns.map((args) => args.join(" "));
      assert.ok(keys.includes("bank report -D 2026-11-14 -f json"), keys.join(" | "));
      assert.ok(keys.includes("bank report -w 2026-W46 -f json"), keys.join(" | "));
      assert.ok(keys.includes("bank report -p 2026-Q4 -s -f json"), keys.join(" | "));
      assert.ok(keys.includes("bank report -p 2026 -s -f json"), keys.join(" | "));
      assert.ok(keys.includes("bank report -p all -s -f json"), keys.join(" | "));
      assert.ok(keys.includes("bank report -p 2026-W46 -s -c -f json"), keys.join(" | "));
      assert.ok(keys.includes("bank report -p 2026-Q4 -s -c -f json"), keys.join(" | "));
      assert.ok(keys.includes("bank report -p 2026 -s -c -f json"), keys.join(" | "));
      assert.ok(keys.includes("bank report -p all -s -c -f json"), keys.join(" | "));
    } finally {
      plugin.onunload();
    }
  });
});

test("fence badges wait for visibility and skip future periods", async () => {
  await withMissingConfig(async () => {
    await withFakeObserver(async () => {
      const plugin = makePlugin();
      try {
        const visible = mount(plugin, "bob-stats-strip", "2026/2026-W46.md");
        assert.equal(plugin.__spawns.length, 0, "no bank spawn before the observer fires");
        observers.at(-1).trigger(true);
        await drain();
        assert.ok(plugin.__spawns.some((args) => args.includes("2026-W46")));
        const before = plugin.__spawns.length;
        mount(plugin, "bob-stats-strip", "2027/2027-W01.md");
        observers.at(-1).trigger(true);
        await drain();
        assert.equal(plugin.__spawns.length, before, "a future week never spawns bob bank");
        const future = stripRecord(plugin, mount(plugin, "bob-stats-strip", "2027/2027-W01.md").el);
        assert.equal(future.badgeHost.textContent, "");
      } finally {
        plugin.onunload();
      }
    });
  });
});

test("older bob -p refusals hide the host and warn once", async () => {
  await withMissingConfig(async () => {
    const warns = [];
    const original = console.warn;
    console.warn = (message) => warns.push(String(message));
    const plugin = makePlugin({
      spawn: (args) => {
        if (args.includes("-c")) {
          return {
            ok: false,
            code: "bad-json",
            message: "bob bank report returned output that is not JSON.",
            detail: "error: unexpected argument '-c' found",
            exitCode: 2,
          };
        }
        const periodIndex = args.indexOf("-p");
        if (periodIndex >= 0) {
          const id = args[periodIndex + 1];
          return { ok: true, report: reportFor(/^\d{4}-Q/.test(id) ? "quarter" : "year", id) };
        }
        return { ok: true, report: reportFor("week", "2026-W46") };
      },
    });
    try {
      const quarter = mount(plugin, "bob-stats-strip", "2026/2026-Q4.md");
      const year = mount(plugin, "bob-stats-strip", "2026.md");
      await drain();
      assert.ok(quarter.el.querySelector(".bob-bank-badge"), "the badge remains available because -p works");
      assert.ok(year.el.querySelector(".bob-bank-badge"), "the badge remains available because -p works");
      assert.equal(quarter.el.querySelector(".bob-bank-period"), null);
      assert.equal(year.el.querySelector(".bob-bank-period"), null);
      assert.equal(warns.length, 1);
      assert.match(warns[0], /bank report -c/);
    } finally {
      console.warn = original;
      plugin.onunload();
    }
  });
});

test("unload unsubscribes and pref off clears every fence badge", async () => {
  await withMissingConfig(async () => {
    const plugin = makePlugin();
    try {
      const week = mount(plugin, "bob-stats-strip", "2026/2026-W46.md");
      const day = mount(plugin, "bob-day-stats", "2026/20261114.md");
      await drain();
      assert.ok(week.el.querySelector(".bob-bank-badge"));
      assert.ok(day.el.querySelector(".bob-bank-badge"));
      const mounts = plugin.bankMountsStore().size;
      assert.ok(week.added.length, "the strip registers a render child");
      week.added[0].unload();
      assert.ok(plugin.bankMountsStore().size < mounts);
      plugin.bankBadgeConfigEnabled = () => false;
      plugin.bankBadgeCheckConfig();
      assert.equal(day.el.querySelector(".bob-bank-badge"), null);
      assert.equal(day.el.querySelector(".bob-bank-badge-host").textContent, "");
    } finally {
      plugin.onunload();
    }
  });
});

test("hidden fences subscribe once they become visible without an observer", async () => {
  await withMissingConfig(async () => {
    const prior = globalThis.IntersectionObserver;
    if ("IntersectionObserver" in globalThis) delete globalThis.IntersectionObserver;
    try {
      const plugin = makePlugin();
      try {
        let shown = false;
        const { el, added } = mount(plugin, "bob-stats-strip", "2026/2026-W46.md");
        await drain();
        const record = stripRecord(plugin, el);
        const fenceEl = record.fenceEl || record.el;
        // Simulate a hidden-at-mount fence that never subscribed.
        plugin.bankReleaseFenceBadge(record, { keepHost: true });
        plugin.bankReleaseFencePeriod(record, { keepHost: true });
        plugin.__spawns.length = 0;
        fenceEl.isShown = () => shown;
        plugin.periodStripCheckAll();
        await drain();
        assert.ok(!plugin.__spawns.some((args) => args.includes("2026-W46")), "no W46 fetch while hidden");
        // Become visible and re-run the shown/check cycle.
        shown = true;
        plugin.periodStripCheckAll();
        await drain();
        const badgeW46 = plugin.__spawns.filter((args) => args.includes("-w") && args.includes("2026-W46"));
        const panelW46 = plugin.__spawns.filter((args) => args.includes("-p") && args.includes("-c") && args.includes("2026-W46"));
        assert.equal(badgeW46.length, 1, "exactly one badge W46 request");
        assert.equal(panelW46.length, 1, "exactly one independent chart W46 request");
        const before = plugin.__spawns.length;
        plugin.periodStripCheckAll();
        await drain();
        assert.equal(plugin.__spawns.length, before, "no repeated subscription on re-check");
        assert.ok(el.querySelector(".bob-bank-badge") || el.querySelector(".bob-bank-badge-host").textContent !== "");
        assert.equal(added.length, 1, "day delegation retains the owning fence record");
      } finally {
        plugin.onunload();
      }
    } finally {
      if (prior !== undefined) globalThis.IntersectionObserver = prior;
    }
  });
});

test("day fences retry badge subscription when shown later without an observer", async () => {
  await withMissingConfig(async () => {
    const prior = globalThis.IntersectionObserver;
    if ("IntersectionObserver" in globalThis) delete globalThis.IntersectionObserver;
    try {
      const plugin = makePlugin();
      try {
        let shown = false;
        const { el } = mount(plugin, "bob-day-stats", "2026/20261114.md");
        await drain();
        const record = stripRecord(plugin, el);
        const fenceEl = record.fenceEl || record.el;
        plugin.bankReleaseFenceBadge(record, { keepHost: true });
        plugin.__spawns.length = 0;
        fenceEl.isShown = () => shown;
        plugin.dayStripCheckAll();
        await drain();
        assert.ok(!plugin.__spawns.some((args) => args.includes("2026-11-14")), "no day fetch while hidden");
        shown = true;
        // Detached-to-connected: the fence element reports shown on the next check.
        plugin.dayStripCheckAll();
        await drain();
        const day = plugin.__spawns.filter((args) => args.includes("2026-11-14"));
        assert.equal(day.length, 1, "exactly one day bank report request");
        assert.ok(el.querySelector(".bob-bank-badge"));
      } finally {
        plugin.onunload();
      }
    } finally {
      if (prior !== undefined) globalThis.IntersectionObserver = prior;
    }
  });
});

test("losing periodId in the host adapter cannot silently undo validation", async () => {
  await withMissingConfig(async () => {
    const plugin = makePlugin();
    try {
      const { el } = mount(plugin, "bob-stats-strip", "2026/2026-W46.md");
      await drain();
      const record = stripRecord(plugin, el);
      const badgeRecord = record.bankBadgeRecord;
      assert.ok(badgeRecord, "fence badge subscribed");
      assert.equal(badgeRecord.kind, "week");
      assert.equal(badgeRecord.id, "2026-W46");
      // A W45 report for a W46 strip must be unavailable, not a badge.
      const wrong = reportFor("week", "2026-W45");
      const mismatched = helpers.bankBadgeModel(wrong, { kind: badgeRecord.kind, day: undefined, periodId: badgeRecord.id, today: "2026-11-14" });
      assert.equal(mismatched.state, "unavailable");
      assert.equal(mismatched.reason, "period-mismatch");
      // Dropping periodId must not validate: the adapter always passes it.
      const dropped = helpers.bankBadgeModel(wrong, { kind: badgeRecord.kind, day: undefined, today: "2026-11-14" });
      assert.equal(dropped.state, "unavailable");
      // The right report validates through the real host callback path.
      const right = reportFor("week", "2026-W46");
      const matched = helpers.bankBadgeModel(right, { kind: badgeRecord.kind, day: undefined, periodId: badgeRecord.id, today: "2026-11-14" });
      assert.equal(matched.state === "badge" || matched.state === "hidden", true);
    } finally {
      plugin.onunload();
    }
  });
});

function attachNav(plugin, walkMode) {
  plugin.app.plugins = {
    plugins: {
      "bob-navigation-hotkeys": {
        api: { version: 1, walkMode },
      },
    },
  };
}

test("opening a waiting badge row selects family b and sets the walk anchor", async () => {
  await withMissingConfig(async () => {
    const plugin = makePlugin();
    try {
      const selected = [];
      attachNav(plugin, {
        version: 4,
        select(type) { selected.push(type); return { ok: true }; },
      });
      plugin.__files.set("bank/2026-11.md", { path: "bank/2026-11.md" });
      plugin.bankOpenMonthPathAtLine = async () => true;
      const opened = await plugin.bankBadgeNavigate({
        type: "waiting", path: "bank/2026-11.md", line: 12, date: "2026-11-12",
      });
      assert.equal(opened, true);
      assert.deepEqual(selected, ["b"]);
      const anchor = plugin.bankWalkAnchor();
      assert.equal(anchor.path, "bank/2026-11.md");
      assert.equal(anchor.line, 12);
      assert.equal(anchor.date, "2026-11-12");
    } finally {
      plugin.onunload();
    }
  });
});

test("heading and hub badge opens leave the family and walk anchor alone", async () => {
  await withMissingConfig(async () => {
    const plugin = makePlugin();
    try {
      const selected = [];
      attachNav(plugin, {
        version: 4,
        select(type) { selected.push(type); return { ok: true }; },
      });
      plugin.__files.set("bank/2026-11.md", { path: "bank/2026-11.md" });
      plugin.bankOpenMonthPathAtLine = async () => true;
      assert.equal(await plugin.bankBadgeNavigate({
        type: "day", path: "bank/2026-11.md", line: 5, date: "2026-11-12",
      }), true);
      assert.deepEqual(selected, []);
      assert.equal(plugin.bankWalkAnchor(), null);
      assert.equal(await plugin.bankBadgeNavigate({
        type: "hub", path: "bank.md", line: 1, date: null,
      }), true);
      assert.deepEqual(selected, []);
      assert.equal(plugin.bankWalkAnchor(), null);
    } finally {
      plugin.onunload();
    }
  });
});

test("old nav still anchors a waiting badge open and skips select", async () => {
  await withMissingConfig(async () => {
    const plugin = makePlugin();
    try {
      const selected = [];
      attachNav(plugin, {
        version: 3,
        select(type) { selected.push(type); return { ok: true }; },
      });
      plugin.__files.set("bank/2026-10.md", { path: "bank/2026-10.md" });
      plugin.bankOpenMonthPathAtLine = async () => true;
      assert.equal(await plugin.bankBadgeNavigate({
        type: "waiting", path: "bank/2026-10.md", line: 19, date: "2026-10-31",
      }), true);
      assert.deepEqual(selected, []);
      const anchor = plugin.bankWalkAnchor();
      assert.equal(anchor.path, "bank/2026-10.md");
      assert.equal(anchor.line, 19);
    } finally {
      plugin.onunload();
    }
  });
});
