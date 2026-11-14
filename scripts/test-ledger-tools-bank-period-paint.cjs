// DOM tests for the Bank Period Charts painter (`bankPeriodPaint`). The
// FakeNode below concatenates textContent realistically (no spacing
// getter), so missing separator text nodes fail instead of passing.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { LedgerToolsPlugin } = require("./ledger-tools-harness.cjs");

const {
  bankPeriodChartsModel,
  bankPeriodPaint,
  bankPeriodCompact,
} = LedgerToolsPlugin.helpers;

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
    this.focused = false;
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
  replaceChildren(...kids) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this._text = "";
    for (const kid of kids) this.appendChild(kid);
  }
  empty() { this.replaceChildren(); }
  focus() { this.focused = true; }
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

function totals(overrides = {}) {
  return {
    in_cents: 0, out_cents: 0, net_cents: 0, refund_cents: 0,
    transfer_out_cents: 0, transfer_in_cents: 0, cash_out_cents: 0,
    cash_traced_cents: 0, unclassified_out_cents: 0, unclassified_in_cents: 0,
    ...overrides,
  };
}

function entry(overrides = {}) {
  const inCents = overrides.in_cents || 0;
  const outCents = overrides.out_cents || 0;
  return {
    id: "2026-11-09", kind: "day", label: "Mon 9",
    start: "2026-11-09", end: "2026-11-09", group: null,
    so_far: false, state: "tracked", waiting: 0, rows: 0, top_out: [],
    target: { path: "bank/2026-11.md", line: 12 },
    ...overrides,
    in_cents: inCents, out_cents: outCents,
    net_cents: Object.prototype.hasOwnProperty.call(overrides, "net_cents")
      ? overrides.net_cents : inCents - outCents,
  };
}

function weekDays(fill) {
  const days = [
    ["2026-11-09", "Mon 9"], ["2026-11-10", "Tue 10"], ["2026-11-11", "Wed 11"],
    ["2026-11-12", "Thu 12"], ["2026-11-13", "Fri 13"], ["2026-11-14", "Sat 14"],
    ["2026-11-15", "Sun 15"],
  ];
  return days.map(([id, label]) => entry({ id, label, start: id, end: id, ...(fill(id, label) || {}) }));
}

function weekCategories() {
  return {
    limit: 5,
    series: [
      { key: "groceries", emoji: "🛒", label: "Groceries", kind: "category", out_cents: 14210, share: 0.569, rows: 3 },
      { key: "dining", emoji: "🍽", label: "Dining", kind: "category", out_cents: 6420, share: 0.257, rows: 2 },
      { key: "unclassified", emoji: "●", label: "Unclassified", kind: "unclassified", out_cents: 2047, share: 0.082, rows: 1 },
    ],
    rest: { count: 2, out_cents: 2300, share: 0.092, rows: 2 },
  };
}

function report(overrides = {}) {
  return {
    command: "report", teaching_empty: false,
    period: { kind: "week", key: "2026-W46", start: "2026-11-09", end: "2026-11-15", label: "2026-W46 · Nov 9–15, 2026", so_far: true, note: null },
    totals: totals({ out_cents: 24977, net_cents: -24977 }),
    breakdown: [], days: [],
    waiting: { period: 7, all: 7, oldest: "2026-11-11" },
    coverage: { tracked_since: "2026-11-01", imported_through: "2026-11-11", start: "2026-11-09", through: "2026-11-11", complete: false },
    navigation: {
      waiting: { path: "bank/2026-11.md", line: 12, date: "2026-11-11" },
      first: { path: "bank/2026-11.md", line: 12, date: "2026-11-11" },
      months: ["bank/2026-11.md"],
    },
    charts: {
      version: 1, granularity: "day",
      buckets: weekDays((id) => (id === "2026-11-11"
        ? { state: "tracked", out_cents: 24977, waiting: 7, rows: 7, top_out: [{ key: "groceries", emoji: "🛒", label: "Groceries", out_cents: 14210 }] }
        : { state: "awaiting_import", so_far: id === "2026-11-14" })),
      groups: [],
      categories: weekCategories(),
    },
    ...overrides,
  };
}

function ctx(overrides = {}) {
  return {
    kind: "week", periodId: "2026-W46", today: "2026-11-14",
    stale: false, refreshFailed: false, badgeEnabled: true, view: "both", collapsed: false,
    ...overrides,
  };
}

function paint(model, handlers = {}) {
  const doc = fakeDocument();
  const host = new FakeNode("div", doc);
  host.ownerDocument = doc;
  const returned = bankPeriodPaint(host, model, handlers);
  return { doc, host, returned };
}

test("textContent reads naturally with real separators, not CSS content", () => {
  const model = bankPeriodChartsModel(report(), ctx());
  const { host } = paint(model);
  assert.match(host.textContent, /BANK CHARTS/);
  assert.match(host.textContent, /Wed 11/);
  assert.match(host.textContent, /Groceries/);
  assert.match(host.textContent, /2 more/);
  const waiting = bankPeriodChartsModel(
    report({ totals: totals(), waiting: { period: 3, all: 3, oldest: "2026-11-11" } }),
    ctx({ badgeEnabled: false }),
  );
  assert.match(paint(waiting).host.textContent, /3 waiting/);
  assert.match(paint(waiting).host.textContent, /oldest Nov 11/);
});

test("child order and roles carry no button element", () => {
  const model = bankPeriodChartsModel(report(), ctx());
  const { host, returned } = paint(model);
  assert.equal(findAll(host, (node) => node.tagName === "BUTTON").length, 0);
  assert.equal(returned.getAttribute("role"), "group");
  assert.ok(returned.getAttribute("aria-label"));
  const header = byClass(host, "bob-bank-period-header")[0];
  assert.ok(header, "header renders first");
  assert.ok(host.children[0] === returned, "panel root mounts in the host");
  assert.equal(byClass(host, "bob-bank-period-disclosure")[0].getAttribute("role"), "button");
  assert.equal(byClass(host, "bob-bank-period-switch")[0].getAttribute("role"), "button");
  assert.equal(byClass(host, "bob-bank-period-readout")[0].getAttribute("aria-live"), "polite");
  const tables = findAll(host, (node) => node.tagName === "TABLE");
  assert.equal(tables.length, 2);
  for (const table of tables) {
    assert.ok((table.getAttribute("class") || "").includes("bob-bank-period-sr"));
    assert.ok(findAll(table, (node) => node.tagName === "CAPTION").length === 1);
  }
});

test("aria labels name the period, money, top category, and coverage", () => {
  const model = bankPeriodChartsModel(report(), ctx());
  const { host } = paint(model);
  const panel = byClass(host, "bob-bank-period")[0];
  assert.match(panel.getAttribute("aria-label"), /out \$249\.77/);
  assert.match(panel.getAttribute("aria-label"), /top Groceries/);
  assert.match(panel.getAttribute("aria-label"), /6 of 7 days not imported yet/);
  const columns = byClass(host, "bob-bank-period-column").filter((node) => node.getAttribute("role") === "link");
  const counted = columns.find((node) => node.getAttribute("data-column") === "2026-11-11");
  assert.match(counted.getAttribute("aria-label"), /out \$249\.77/);
  assert.match(counted.getAttribute("title"), /Top out:/);
});

test("the cashflow axis keeps one roving tab stop across arrows, Home, and End", () => {
  const model = bankPeriodChartsModel(report(), ctx());
  const { host } = paint(model);
  const columns = byClass(host, "bob-bank-period-column").filter((node) => node.getAttribute("role") === "link");
  assert.equal(columns.length, 7);
  assert.deepEqual(columns.map((node) => node.getAttribute("tabindex")), ["0", "-1", "-1", "-1", "-1", "-1", "-1"]);
  columns[0].dispatch("keydown", { key: "ArrowRight" });
  assert.deepEqual(columns.map((node) => node.getAttribute("tabindex")), ["-1", "0", "-1", "-1", "-1", "-1", "-1"]);
  assert.equal(columns[1].focused, true);
  columns[1].dispatch("keydown", { key: "End" });
  assert.equal(columns[6].getAttribute("tabindex"), "0");
  columns[6].dispatch("keydown", { key: "Home" });
  assert.equal(columns[0].getAttribute("tabindex"), "0");
  columns[0].dispatch("keydown", { key: "ArrowLeft" });
  assert.equal(columns[0].getAttribute("tabindex"), "0");
});

test("hover and focus dim siblings and fill the readout; Escape clears it", () => {
  const model = bankPeriodChartsModel(report(), ctx());
  const { host } = paint(model);
  const columns = byClass(host, "bob-bank-period-column").filter((node) => node.getAttribute("role") === "link");
  const readout = byClass(host, "bob-bank-period-readout")[0];
  assert.equal(readout.textContent, "");
  columns[2].dispatch("focus", {});
  assert.match(readout.textContent, /Wed 11/);
  assert.match(readout.textContent, /out \$249\.77/);
  assert.equal(columns[0].style.opacity, "0.35");
  assert.equal(columns[2].style.opacity, "");
  columns[2].dispatch("blur", {});
  assert.equal(readout.textContent, "");
  assert.equal(columns[0].style.opacity, "");
  columns[2].dispatch("mouseenter", {});
  assert.match(readout.textContent, /Wed 11/);
  columns[2].dispatch("keydown", { key: "Escape" });
  assert.equal(readout.textContent, "");
});

test("Enter, Space, click, Ctrl-click, and middle-click activate with newLeaf", () => {
  const model = bankPeriodChartsModel(report(), ctx());
  const calls = [];
  const { host } = paint(model, { activateBucket: (target, column, newLeaf) => calls.push([column.id, newLeaf, target]) });
  const columns = byClass(host, "bob-bank-period-column").filter((node) => node.getAttribute("role") === "link");
  const target = columns[2];
  target.dispatch("keydown", { key: "Enter" });
  assert.deepEqual(calls.at(-1).slice(0, 2), ["2026-11-11", false]);
  assert.deepEqual(calls.at(-1)[2], { path: "bank/2026-11.md", line: 12 });
  target.dispatch("keydown", { key: " " });
  assert.deepEqual(calls.at(-1).slice(0, 2), ["2026-11-11", false]);
  target.dispatch("click", {});
  assert.deepEqual(calls.at(-1).slice(0, 2), ["2026-11-11", false]);
  columns[0].dispatch("click", { ctrlKey: true });
  assert.deepEqual(calls.at(-1).slice(0, 2), ["2026-11-09", true]);
  columns[0].dispatch("click", { button: 1 });
  assert.deepEqual(calls.at(-1).slice(0, 2), ["2026-11-09", true]);
});

test("the view switch cycles and the disclosure collapses", () => {
  const model = bankPeriodChartsModel(report(), ctx());
  const calls = [];
  const { host } = paint(model, { setView: (view) => calls.push(["view", view]), toggleCollapsed: () => calls.push(["collapse"]) });
  const toggle = byClass(host, "bob-bank-period-switch")[0];
  assert.equal(toggle.getAttribute("data-view"), "both");
  assert.match(toggle.getAttribute("aria-label"), /Activate for/);
  toggle.dispatch("click", {});
  assert.deepEqual(calls.at(-1), ["view", "cashflow"]);
  toggle.dispatch("keydown", { key: "Enter" });
  assert.deepEqual(calls.at(-1), ["view", "cashflow"]);
  const disclosure = byClass(host, "bob-bank-period-disclosure")[0];
  assert.equal(disclosure.getAttribute("aria-expanded"), "true");
  disclosure.dispatch("click", {});
  assert.deepEqual(calls.at(-1), ["collapse"]);
  disclosure.dispatch("keydown", { key: " " });
  assert.deepEqual(calls.at(-1), ["collapse"]);
});

test("table twins carry cashflow and category rows with exact copy", () => {
  const model = bankPeriodChartsModel(report(), ctx());
  const { host } = paint(model);
  const tables = findAll(host, (node) => node.tagName === "TABLE");
  const cashflow = tables.find((node) => node.textContent.includes("In and out by period"));
  const categories = tables.find((node) => node.textContent.includes("Out by category"));
  assert.ok(cashflow && categories);
  assert.match(cashflow.textContent, /Wed 11/);
  assert.match(cashflow.textContent, /not imported yet/);
  assert.match(categories.textContent, /Groceries/);
  assert.match(categories.textContent, /57%/);
});

test("stale paints last-good values with a dashed edge and a hint", () => {
  const model = bankPeriodChartsModel(report(), ctx({ stale: true, refreshFailed: true }));
  const { host } = paint(model);
  const panel = byClass(host, "bob-bank-period")[0];
  assert.equal(panel.getAttribute("data-stale"), "true");
  assert.match(panel.getAttribute("title"), /Refresh failed/);
  const columns = byClass(host, "bob-bank-period-column").filter((node) => node.getAttribute("role") === "link");
  const counted = columns.find((node) => node.getAttribute("data-column") === "2026-11-11");
  assert.match(counted.getAttribute("title"), /last good values shown/);
  assert.match(host.textContent, /Wed 11/);
});

test("unavailable paints one muted line with a hint title", () => {
  const missing = report();
  delete missing.charts;
  const model = bankPeriodChartsModel(missing, ctx());
  assert.equal(model.state, "unavailable");
  const { host } = paint(model, {});
  const line = byClass(host, "bob-bank-period-unavailable")[0];
  assert.ok(line);
  assert.equal(line.getAttribute("role"), "status");
  assert.equal(line.textContent, "Bank charts unavailable");
  assert.match(line.getAttribute("title"), /could not be read/);
});

test("hidden states empty the host", () => {
  for (const model of [
    { state: "hidden", reason: "empty" },
    { state: "hidden", reason: "waiting-badge" },
    { state: "hidden", reason: "teaching-empty" },
    { state: "hidden", reason: "older-bob" },
    null,
  ]) {
    const { host, returned } = paint(model, {});
    assert.equal(returned, null);
    assert.equal(host.children.length, 0);
    assert.equal(host.textContent, "");
  }
  const empty = bankPeriodChartsModel(
    report({ totals: totals(), waiting: { period: 0, all: 0, oldest: null }, charts: { version: 1, granularity: "day", buckets: weekDays(() => ({ state: "tracked" })), groups: [], categories: { limit: 5, series: [], rest: null } } }),
    ctx(),
  );
  assert.equal(empty.state, "hidden");
  const painted = paint(empty, {});
  assert.equal(painted.host.children.length, 0);
});

test("waiting paints one quiet line that opens the waiting target", () => {
  const waiting = bankPeriodChartsModel(
    report({ totals: totals(), waiting: { period: 3, all: 3, oldest: "2026-11-11" } }),
    ctx({ badgeEnabled: false }),
  );
  assert.equal(waiting.state, "waiting");
  const calls = [];
  const { host } = paint(waiting, { openWaiting: (target, newLeaf) => calls.push([target, newLeaf]) });
  assert.match(host.textContent, /3 waiting/);
  const link = byClass(host, "bob-bank-period-waiting-link")[0];
  assert.ok(link);
  assert.equal(link.getAttribute("role"), "link");
  link.dispatch("click", {});
  assert.deepEqual(calls[0][0], { path: "bank/2026-11.md", line: 12 });
  assert.equal(calls[0][1], false);
});

test("a category label containing markup renders literally", () => {
  const evil = report({
    charts: {
      version: 1, granularity: "day",
      buckets: weekDays((id) => (id === "2026-11-11" ? { state: "tracked", out_cents: 100, rows: 1 } : { state: "tracked" })),
      groups: [],
      categories: { limit: 5, series: [{ key: "evil", emoji: "", label: "<b>Bold</b>", kind: "category", out_cents: 100, share: 1, rows: 1 }], rest: null },
    },
    totals: totals({ out_cents: 100, net_cents: -100 }),
  });
  const model = bankPeriodChartsModel(evil, ctx());
  const { host } = paint(model);
  assert.match(host.textContent, /<b>Bold<\/b>/);
  assert.equal(findAll(host, (node) => node.tagName === "B").length, 0);
});

test("collapsed shows only the header row", () => {
  const model = bankPeriodChartsModel(report(), ctx({ collapsed: true }));
  assert.equal(model.header.collapsed, true);
  const { host } = paint(model);
  assert.ok(byClass(host, "bob-bank-period-disclosure")[0]);
  assert.equal(byClass(host, "bob-bank-period-cashflow").length, 0);
  assert.equal(byClass(host, "bob-bank-period-categories").length, 0);
  assert.equal(findAll(host, (node) => node.tagName === "TABLE").length, 0);
});

test("a single available chart shows alone and hides the switch", () => {
  const buckets = weekDays((id) => (id === "2026-11-14" ? { in_cents: 250000, state: "tracked", so_far: true } : { state: "tracked" }));
  const model = bankPeriodChartsModel(report({
    totals: totals({ in_cents: 250000, net_cents: 250000 }),
    waiting: { period: 0, all: 0, oldest: null },
    charts: { version: 1, granularity: "day", buckets, groups: [], categories: { limit: 5, series: [], rest: null } },
  }), ctx());
  assert.deepEqual(model.header.shown, ["cashflow"]);
  const { host } = paint(model);
  assert.equal(byClass(host, "bob-bank-period-switch").length, 0);
  assert.ok(byClass(host, "bob-bank-period-cashflow")[0]);
  assert.equal(byClass(host, "bob-bank-period-categories").length, 0);
});

test("ghost columns are inert while real columns stay activatable", () => {
  const buckets = [
    entry({ id: "ghost:2019:2025", kind: "year", label: "2019–2025 · not tracked", start: "2019-01-01", end: "2025-12-31", group: null, state: "untracked", ghost: true, in_cents: 0, out_cents: 0, net_cents: 0 }),
    entry({ id: "2026-11-11", kind: "day", label: "Wed 11", start: "2026-11-11", end: "2026-11-11", state: "tracked", out_cents: 100, rows: 1 }),
  ];
  const model = {
    state: "charts", reason: "charts", hint: "", stale: false,
    header: { label: "BANK CHARTS", collapsed: false, view: "both", nextView: "cashflow", switchShown: false, shown: ["cashflow"], available: ["cashflow"] },
    cashflow: {
      encoding: "markers", granularity: "day", maxIn: 0, maxOut: 100, inBandRatio: null,
      columns: buckets.map((bucket) => ({
        id: bucket.id, kind: bucket.kind, label: bucket.label, group: bucket.group, start: bucket.start, end: bucket.end,
        state: bucket.state, soFar: false, inCents: bucket.in_cents, outCents: bucket.out_cents, netCents: bucket.net_cents,
        waiting: 0, rows: bucket.rows, topOut: [], target: bucket.target, ghost: Boolean(bucket.ghost),
        marker: false, inRatio: 0, outRatio: bucket.out_cents / 100,
        decorations: bucket.ghost ? ["untracked"] : [], words: bucket.ghost ? ["not tracked"] : [],
        extremeIn: false, extremeOut: !bucket.ghost, extremeOutLabel: bucket.ghost ? undefined : "$100",
        tooltip: bucket.ghost ? "2019–2025 · not tracked" : "Wed 11 · Out $1.00",
        readout: bucket.ghost ? "2019–2025 · not tracked" : "Wed 11 · out $1.00", aria: bucket.label,
      })),
      fallbackColumns: [], ghost: null,
    },
    categories: null, notCounted: null, waitingLine: null, ariaLabel: "ghost", tables: {},
  };
  const calls = [];
  const { host } = paint(model, { activateBucket: (target, column) => calls.push(column.id) });
  const ghost = byClass(host, "bob-bank-period-column-ghost")[0];
  assert.ok(ghost);
  assert.equal(ghost.getAttribute("role"), "presentation");
  ghost.dispatch("click", {});
  assert.deepEqual(calls, []);
});

test("contrast tokens ship calibrated fills and keep state words meaningful", () => {
  const full = fs.readFileSync(path.join(__dirname, "..", "plugins/bob-ledger-tools/styles.css"), "utf8");
  const begin = full.indexOf("/* Bank Period Charts paint (bob-cli-lj paint): begin.");
  const end = full.indexOf("/* Bank Period Charts paint (bob-cli-lj paint): end.");
  assert.ok(begin !== -1 && end !== -1 && end > begin, "bank period paint section ships in styles.css");
  const css = full.slice(begin, end);
  assert.match(full, /--bob-bank-in-fill: color-mix\(in srgb, var\(--color-green\) [\d.]+%, var\(--text-normal\)\)/);
  assert.match(full, /--bob-bank-out-fill: color-mix\(in srgb, var\(--text-normal\) [\d.]+%, var\(--background-primary\)\)/);
  assert.match(full, /--bob-bank-in-ink: color-mix\(in srgb, var\(--color-green\) 60%, var\(--text-normal\)\)/);
  assert.doesNotMatch(css, /var\(--text-error\)/);
  assert.doesNotMatch(css, /--color-red/);
  assert.doesNotMatch(css, /magenta/i);
  assert.ok(css.includes(".bob-bank-period-sr"));
  assert.ok(css.includes("clip-path: inset(50%)"));
  assert.ok(css.includes("prefers-reduced-motion"));
  assert.ok(css.includes("forced-colors"));
  const hexToRgb = (hex) => {
    const n = String(hex).replace("#", "");
    return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
  };
  const mix = (a, b, p) => a.map((value, index) => value * p + b[index] * (1 - p));
  const luminance = (rgb) => {
    const lin = rgb.map((channel) => {
      const c = channel / 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  };
  const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
  const themes = {
    light: { bg: hexToRgb("#ffffff"), normal: hexToRgb("#262521"), green: hexToRgb("#08b94e") },
    dark: { bg: hexToRgb("#202124"), normal: hexToRgb("#e7e6e2"), green: hexToRgb("#44cf6e") },
  };
  const failures = [];
  for (const [name, palette] of Object.entries(themes)) {
    const inFill = mix(palette.green, palette.normal, 0.7);
    const outFill = mix(palette.normal, palette.bg, 0.5);
    const inInk = mix(palette.green, palette.normal, 0.6);
    if (ratio(inFill, palette.bg) < 3) failures.push(`${name} in-fill`);
    if (ratio(outFill, palette.bg) < 3) failures.push(`${name} out-fill`);
    if (ratio(inInk, palette.bg) < 4.5) failures.push(`${name} in-ink`);
  }
  assert.deepEqual(failures, []);
});
