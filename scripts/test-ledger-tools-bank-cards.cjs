// Bank card models and fake-DOM views. Every fixture is synthetic; monetary
// totals are decoded from the checked-in bob bank JSON captures.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { LedgerToolsPlugin, makeFreshnessApp, withMissingConfig } = require("./ledger-tools-harness.cjs");

const helpers = LedgerToolsPlugin.helpers;
const fixtureDir = path.join(__dirname, "../plugins/bob-ledger-tools/scripts/fixtures/bank");
const listDoc = JSON.parse(fs.readFileSync(path.join(fixtureDir, "list-waiting.json"), "utf8"));
const reportDoc = JSON.parse(fs.readFileSync(path.join(fixtureDir, "report-month.json"), "utf8"));
const listDecoded = helpers.bankDecodeList(JSON.stringify(listDoc), "");
const reportDecoded = helpers.bankDecodeReport(JSON.stringify(reportDoc), "");
const monthSource = fs.readFileSync(path.join(fixtureDir, "month-2026-11.md"), "utf8");

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function drain() {
  for (let i = 0; i < 16; i += 1) await Promise.resolve();
  await flush();
}

class FakeNode {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase();
    this.ownerDocument = doc;
    this.parentNode = null;
    this.children = [];
    this.attrs = new Map();
    this.listeners = new Map();
    this.style = {};
    this._text = "";
    this.disabled = false;
    this.checked = false;
  }

  set textContent(value) {
    this._text = String(value);
    for (const child of this.children) child.parentNode = null;
    this.children = [];
  }

  get textContent() {
    return [this._text, ...this.children.map((child) => child.textContent)].filter(Boolean).join(" ");
  }

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
  prepend(child) {
    child.parentNode = this;
    this.children.unshift(child);
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
  createDiv(options = {}) {
    const node = new FakeNode("div", this.ownerDocument);
    if (options.cls) node.setAttribute("class", options.cls);
    if (options.text !== undefined) node.textContent = options.text;
    return this.appendChild(node);
  }
  createEl(tag, options = {}) {
    const node = new FakeNode(tag, this.ownerDocument);
    if (options.cls) node.setAttribute("class", options.cls);
    if (options.text !== undefined) node.textContent = options.text;
    return this.appendChild(node);
  }
  addEventListener(event, callback) {
    const handlers = this.listeners.get(event) || [];
    handlers.push(callback);
    this.listeners.set(event, handlers);
  }
  fire(event, payload = {}) {
    const results = [];
    const fired = { preventDefault() {}, target: this, ...payload };
    for (const handler of this.listeners.get(event) || []) results.push(handler(fired));
    return results;
  }
  matches(selector) {
    const cls = (this.getAttribute("class") || "").split(/\s+/);
    return Array.from(selector.matchAll(/\.([\w-]+)/g)).every((match) => cls.includes(match[1])) &&
      Array.from(selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)).every((match) => {
        const value = this.getAttribute(match[1]);
        return value !== null && (match[2] === undefined || match[2] === value);
      });
  }
  querySelectorAll(selector) {
    const found = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (child.matches(selector)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
}

function fakeDom() {
  const doc = { createElement: (tag) => new FakeNode(tag, doc) };
  return { doc, el: new FakeNode("div", doc) };
}

function textOf(node) { return node ? node.textContent : ""; }
function nodes(node, selector) { return node.querySelectorAll(selector); }
function unloadChild(child) {
  if (!child) return;
  if (typeof child.onunload === "function") child.onunload();
  else if (typeof child.unload === "function") child.unload();
}

function eventSource() {
  const handlers = new Map();
  return {
    on(event, callback) {
      const list = handlers.get(event) || [];
      list.push(callback);
      handlers.set(event, list);
      return { event, callback };
    },
    emit(event, ...args) { for (const callback of handlers.get(event) || []) callback(...args); },
  };
}

function makeHarness(options = {}) {
  const allPaths = options.paths || ["bank.md", "bank/2026-11.md"];
  const files = new Map();
  for (const name of allPaths) {
    files.set(name, {
      path: name,
      source: name === "bank/2026-11.md" ? monthSource : "",
      frontmatter: name === "bank/2026-11.md" ? { month: "2026-11", color: "blue" } : { color: "magenta" },
    });
  }
  const vaultEvents = eventSource();
  const metadataEvents = eventSource();
  const workspaceEvents = eventSource();
  const opened = [];
  const app = makeFreshnessApp({ tasks: [] });
  app.vault = {
    adapter: { basePath: "/synthetic-bank-vault" },
    getMarkdownFiles: () => Array.from(files.values()),
    getAbstractFileByPath: (name) => files.get(name) || null,
    cachedRead: (file) => Promise.resolve(file && files.get(file.path) ? files.get(file.path).source : null),
    on: vaultEvents.on.bind(vaultEvents),
  };
  app.metadataCache = {
    on: metadataEvents.on.bind(metadataEvents),
    getFileCache: (file) => file && files.get(file.path) ? { frontmatter: files.get(file.path).frontmatter } : null,
    getCache: (name) => files.has(name) ? { frontmatter: files.get(name).frontmatter } : null,
  };
  app.workspace = {
    on: workspaceEvents.on.bind(workspaceEvents),
    openLinkText: async (...args) => { opened.push(args); return true; },
    getActiveFile: () => null,
  };
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.bankTimers = {
    setTimeout: (callback) => setTimeout(callback, 0),
    clearTimeout: clearTimeout,
    setInterval: () => 1,
    clearInterval: () => {},
  };
  plugin.registerEvent = () => {};
  plugin.registerInterval = (handle) => clearInterval(handle);
  plugin.setupBankData();
  const dailyReport = {
    ...reportDecoded.report,
    period: { kind: "day", key: "2026-11-12", start: "2026-11-12", end: "2026-11-12", label: "Thu Nov 12", so_far: true, note: null },
    days: reportDecoded.report.days.filter((day) => day.date === "2026-11-12"),
  };
  plugin.bankSpawnFetch = async (args) => {
    if (args[1] === "list") return { ok: true, report: options.listReport || listDecoded.report };
    if (args.includes("-D")) return { ok: true, report: dailyReport };
    const month = args[args.indexOf("-m") + 1] || "2026-11";
    if (month === "2026-11") return { ok: true, report: reportDecoded.report };
    const report = {
      ...reportDecoded.report,
      period: { ...reportDecoded.report.period, key: month, label: month },
    };
    return { ok: true, report };
  };
  plugin.bankOpenMonthPathAtLine = async (pathName, line) => {
    opened.push([pathName, line]);
    return true;
  };
  return { plugin, app, files, opened, vaultEvents, metadataEvents, workspaceEvents };
}

test("bank card fence and filename frontmatter validation are explicit", () => {
  assert.deepEqual(helpers.bankCardParseFence("view: month"), { ok: true, view: "month" });
  assert.deepEqual(helpers.bankCardParseFence("view: queue"), { ok: true, view: "queue" });
  assert.equal(helpers.bankCardParseFence("view: inbox").ok, false);
  assert.equal(helpers.bankCardParseFence("view: month\nlayout: wide").ok, false);
  assert.equal(helpers.bankCardParseFence("").errors.length, 1);
  assert.deepEqual(helpers.bankCardValidateMonthFrontmatter("bank/2026-11.md", "2026-11"), { ok: true, month: "2026-11" });
  assert.equal(helpers.bankCardValidateMonthFrontmatter("bank/2026-11.md", "2026-10").code, "month-mismatch");
  assert.equal(helpers.bankCardValidateMonthFrontmatter("notes/2026-11.md", "2026-11").code, "month-path");
});

test("month card model keeps Bob totals, ordered category shares, account caveats, and waiting row", () => {
  assert.equal(reportDecoded.ok, true);
  const model = helpers.bankCardMonthModel(reportDecoded.report, "2026-11", {
    headingDates: new Set(["2026-11-12", "2026-11-13"]),
  });
  assert.equal(model.kind, "month");
  assert.equal(model.title, "November 2026");
  assert.equal(model.soFar, true);
  assert.equal(model.totals.out_cents, 136256);
  assert.equal(model.totals.unclassified_out_cents, 30);
  assert.equal(model.totals.cash_out_cents, 6350);
  assert.deepEqual(model.breakdown.map((entry) => entry.key), ["groceries", "cash", "unclassified"]);
  assert.equal(model.accounts[0].status, "unverified");
  assert.equal(model.firstWaiting.date, "2026-11-12");
  assert.equal(model.days.length, 30);
  assert.equal(model.days.find((day) => day.date === "2026-11-01").hasHeading, false);
  assert.equal(model.days.find((day) => day.date === "2026-11-12").hasHeading, true);
});

test("heat strip is Monday-first, includes the whole month, and ties share a quantile", () => {
  const zeros = helpers.bankCardMonthHeatModel("2026-11", [], { today: "2026-11-12" });
  assert.equal(zeros.leading, 6, "November 2026 starts on Sunday, after six Monday-first pads");
  assert.equal(zeros.cells.length, 30);
  assert.ok(zeros.cells.every((day) => day.bucket === 0));
  assert.equal(zeros.cells[11].today, true);
  const tied = helpers.bankCardMonthHeatModel("2026-11", [
    { date: "2026-11-01", out_cents: 500, waiting: 0 },
    { date: "2026-11-02", out_cents: 500, waiting: 1 },
    { date: "2026-11-03", out_cents: 1000, waiting: 0 },
  ]);
  assert.equal(tied.cells[0].bucket, tied.cells[1].bucket);
  assert.ok(tied.cells[0].bucket < tied.cells[2].bucket);
  assert.equal(tied.cells[1].waiting, 1);
});

test("queue model sorts oldest-first, snapshots displayed IDs, and bounds existing month footer to six", () => {
  const report = structuredClone(listDecoded.report);
  report.days[0].rows[0].id = "typed001";
  report.days[1].rows[0].id = "import002";
  report.days[1].rows.push({ ...report.days[1].rows[0], id: null, line: report.days[1].rows[0].line + 1 });
  const paths = Array.from({ length: 8 }, (_, index) => {
    const number = 11 - index;
    const month = `2026-${String(number).padStart(2, "0")}`;
    return { path: `bank/${month}.md`, month };
  });
  const reports = new Map(paths.map(({ month }) => [month, {
    report: { ...reportDecoded.report, period: { ...reportDecoded.report.period, key: month, label: month } },
    stale: false,
    error: null,
  }]));
  const model = helpers.bankCardQueueModel(report, { monthPaths: paths, monthReports: reports });
  assert.equal(model.kind, "queue");
  assert.equal(model.rows[0].date, "2026-10-31");
  assert.deepEqual(model.days[0].ids, ["typed001"]);
  assert.equal(model.days[1].idLess, 1);
  assert.equal(model.recentMonths.length, 6);
  assert.equal(model.recentMonths[0].month, "2026-11");
  assert.equal(model.recentMonths[0].outCents, 136256);
});

test("daily chip distinguishes today from history and never turns missing data into zero", () => {
  const report = {
    ...reportDecoded.report,
    days: reportDecoded.report.days.filter((day) => day.date === "2026-11-12"),
  };
  const today = helpers.bankCardDailyChipModel(report, "2026-11-12", "2026-11-12");
  const historical = helpers.bankCardDailyChipModel(report, "2026-11-12", "2026-11-13");
  assert.equal(today.outCents, 136256);
  assert.equal(today.inCents, 201500);
  assert.equal(today.waitingAll, report.waiting.all);
  assert.equal(historical.waitingAll, null);
  assert.equal(helpers.bankCardDailyChipModel(report, "2026-11-11", "2026-11-12").kind, "day-unavailable");
  assert.equal(helpers.bankCardDailyChipModel({ error: true }, "2026-11-12", "2026-11-12").kind, "invalid-report");
});

test("month card renders report data and disables days without real headings", async () => {
  await withMissingConfig(async () => {
    const { plugin, app, opened } = makeHarness();
    plugin.setupBankCards();
    assert.equal(typeof plugin.codeBlocks["bob-bank"], "function");
    const { el } = fakeDom();
    const children = [];
    plugin.renderBankCard(el, { sourcePath: "bank/2026-11.md", addChild: (child) => children.push(child) }, "view: month");
    await drain();
    const card = el.querySelector(".bob-bank-card-month");
    assert.ok(card);
    assert.match(textOf(card), /November 2026/);
    assert.match(textOf(card), /Unclassified:/);
    assert.match(textOf(card), /destination unknown/);
    assert.match(textOf(card), /so far/);
    assert.equal(card.getAttribute("data-root-hue"), "blue");
    const heat = nodes(card, ".bob-bank-heat-day");
    assert.equal(heat.length, 30);
    assert.equal(heat.find((button) => button.getAttribute("data-date") === "2026-11-01").disabled, true);
    const realDay = heat.find((button) => button.getAttribute("data-date") === "2026-11-12");
    assert.equal(realDay.disabled, false);
    await Promise.all(realDay.fire("click"));
    await drain();
    assert.equal(opened.at(-1)[0], "bank/2026-11.md");
    assert.equal(opened.at(-1)[1], helpers.bankLocateDayHeading(monthSource, "2026-11", "2026-11-12").line);
    assert.equal(children.length, 1);
    unloadChild(children[0]);
    plugin.teardownBankCards();
    plugin.teardownBankData();
  });
});

test("queue card keeps account caveats visible, lists bounded report months, and sends its drawn ID snapshot", async () => {
  await withMissingConfig(async () => {
    const { plugin } = makeHarness();
    plugin.setupBankCards();
    const { el } = fakeDom();
    const children = [];
    plugin.renderBankCard(el, { sourcePath: "bank.md", addChild: (child) => children.push(child) }, "view: queue");
    await drain();
    const card = el.querySelector(".bob-bank-card-queue");
    assert.ok(card);
    assert.match(textOf(card), /unverified/);
    assert.match(textOf(card), /Weekly import: bob bank import/);
    assert.match(textOf(card), /2026-11 · Out/);
    assert.equal(nodes(card, ".bob-bank-queue-row").length, 2);
    const day = helpers.bankCardQueueModel(listDecoded.report).days[0];
    const captured = [];
    plugin.apiBank = () => ({ ackIds: async (ids, options) => { captured.push([ids, options]); return { ok: true }; } });
    await plugin.bankCardAckSnapshot({ date: day.date, ids: ["^bank-AbC", "abc", "abc"], idLess: 1 });
    assert.deepEqual(captured, [[ ["^bank-AbC"], { label: day.date, idLess: 1 } ]]);
    assert.match(textOf(card), /typed row needs its individual checkbox|typed rows need their individual checkbox/);
    unloadChild(children[0]);
    plugin.teardownBankCards();
    plugin.teardownBankData();
  });
});

test("missing day headings and changed row snapshots cannot navigate to fallback line one", async () => {
  await withMissingConfig(async () => {
    const { plugin, opened } = makeHarness();
    assert.equal(await plugin.bankCardNavigateDay("bank/2026-11.md", "2026-11-01"), false);
    assert.deepEqual(opened, []);
    const row = { path: "bank/2026-11.md", date: "2026-11-12", line: 9, cents: -6120, id: "unknown" };
    assert.equal(await plugin.bankCardNavigateRow(row), false);
    assert.deepEqual(opened, []);
    plugin.teardownBankData();
  });
});

test("daily chip mounts after the day strip even when it is disabled, and clicks ensure its exact date", async () => {
  await withMissingConfig(async () => {
    const { plugin, app } = makeHarness();
    plugin.bankDailyChipConfigEnabled = () => true;
    plugin.bankDailyChipLocalToday = () => "2026-11-12";
    plugin.bankLocalDay = "2026-11-12";
    plugin.setupBankDailyChip();
    const { el } = fakeDom();
    const strip = el.createDiv({ cls: "bob-day-strip-plan-host" });
    const plan = el.createDiv({ cls: "bob-plan" });
    const view = { el, sourcePath: "2026/20261112.md", dayStripHost: strip };
    plugin.planBlockViews = new Set([view]);
    let ensured = null;
    plugin.apiBank = () => ({ ensureOpenDay: async (day) => { ensured = day; return { ok: true }; } });
    plugin.bankSyncPlanHost(view);
    await drain();
    assert.equal(el.children[0], strip);
    assert.ok(el.children.some((node) => node.getAttribute("class") === "bob-bank-daily-plan-host"), el.children.map((node) => node.getAttribute("class")).join(", "));
    assert.equal(el.children.indexOf(el.querySelector(".bob-bank-daily-plan-host")), 1);
    const chip = el.querySelector(".bob-bank-daily-chip");
    assert.ok(chip);
    assert.match(chip.textContent, /out \$1,362\.56 · in \+\$2,015\.00 · 2 waiting/);
    await Promise.all(chip.fire("click"));
    assert.equal(ensured, "2026-11-12");
    plugin.bankReleasePlanHost(view);
    assert.equal(el.querySelector(".bob-bank-daily-plan-host"), null);
    plugin.teardownBankDailyChip();
    plugin.teardownBankData();
  });
});

test("daily chip is hidden without bank.md and follows the cached persistent default-on preference", async () => {
  await withMissingConfig(async () => {
    const { plugin, files } = makeHarness({ paths: ["bank/2026-11.md"] });
    plugin.bankDailyChipConfigEnabled = () => plugin.preference !== false;
    plugin.bankDailyChipLocalToday = () => "2026-11-12";
    plugin.setupBankDailyChip();
    const { el } = fakeDom();
    const view = { el, sourcePath: "2026/20261112.md" };
    plugin.planBlockViews = new Set([view]);
    plugin.bankSyncPlanHost(view);
    assert.equal(el.querySelector(".bob-bank-daily-plan-host"), null);
    assert.equal(plugin.bankDailyHubExists(), false);
    files.set("bank.md", { path: "bank.md", source: "", frontmatter: {} });
    assert.equal(plugin.bankDailyHubExists(), true);
    plugin.bankRefreshPlanHosts();
    assert.ok(el.querySelector(".bob-bank-daily-plan-host"));
    assert.equal(plugin.bankDailyChipEnabled(), true);
    plugin.preference = false;
    assert.equal(plugin.bankDailyChipCheckConfig(), true);
    assert.equal(el.querySelector(".bob-bank-daily-plan-host"), null);
    plugin.teardownBankDailyChip();
    plugin.teardownBankData();
  });
});

test("disabled render children unsubscribe and unload blocks later repaint", async () => {
  await withMissingConfig(async () => {
    const { plugin } = makeHarness();
    plugin.setupBankCards();
    const { el } = fakeDom();
    const children = [];
    plugin.renderBankCard(el, { sourcePath: "bank.md", addChild: (child) => children.push(child) }, "view: queue");
    const view = Array.from(plugin.bankCardViews).at(-1);
    const before = plugin.bankMounts.size;
    assert.ok(before > 0);
    const initialText = textOf(el);
    unloadChild(children[0]);
    assert.equal(view.unloaded, true);
    assert.equal(plugin.bankCardViews.has(view), false);
    plugin.bankCardPaint(view);
    await drain();
    assert.equal(textOf(el), initialText);
    plugin.teardownBankCards();
    plugin.teardownBankData();
  });
});

test("bank UI keeps narrow-pane stacking and native keyboard focus styles", () => {
  const css = fs.readFileSync(path.join(__dirname, "../plugins/bob-ledger-tools/styles.css"), "utf8");
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*\.bob-bank-summary \{ grid-template-columns: 1fr;/);
  assert.match(css, /\.bob-bank-card button:focus-visible/);
  assert.match(css, /\.bob-bank-daily-chip:focus-visible/);
});
