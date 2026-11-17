// Model, decode, and paint tests for the Bank Period closing-balance
// readout (bob-cli-mg readout phase). Every matrix row gets a golden:
// settled, as_of, so_far (+stale, +today), awaiting_import, gap,
// unverified, negative, and zero amounts.
const assert = require("node:assert/strict");
const test = require("node:test");
const { LedgerToolsPlugin } = require("./ledger-tools-harness.cjs");

const {
  bankDecodeReport,
  bankNormalizeBalances,
  bankPeriodBalanceModel,
  bankPeriodBuildBalance,
  bankPeriodChartsModel,
  bankPeriodPaint,
} = LedgerToolsPlugin.helpers;

test("malformed balances warn once and never fail the report", () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (message) => { warnings.push(String(message)); };
  try {
    const bad = minimalBody();
    bad.balances = [{ alias: "checking" }];
    const first = bankDecodeReport(JSON.stringify(bad), "");
    assert.equal(first.ok, true);
    assert.equal(first.report.balances, null);
    const bad2 = minimalBody();
    bad2.balances = "nope";
    const second = bankDecodeReport(JSON.stringify(bad2), "");
    assert.equal(second.ok, true);
    assert.equal(second.report.balances, null);
  } finally {
    console.warn = original;
  }
  assert.equal(warnings.length, 1);
});

test("balances decode: absent stays absent, null stays null, valid normalizes", () => {
  const absent = bankDecodeReport(JSON.stringify(minimalBody()), "");
  assert.equal(absent.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(absent.report, "balances"), false);

  const nulled = minimalBody();
  nulled.balances = null;
  const decodedNull = bankDecodeReport(JSON.stringify(nulled), "");
  assert.equal(decodedNull.ok, true);
  assert.equal(decodedNull.report.balances, null);

  const valid = minimalBody();
  valid.balances = [heroBalance()];
  const decoded = bankDecodeReport(JSON.stringify(valid), "");
  assert.equal(decoded.ok, true);
  assert.equal(decoded.report.balances.length, 1);
  assert.deepEqual(decoded.report.balances[0].target, {
    path: "bank/2026-11.md",
    line: 26,
    date: "2026-11-13",
  });
  assert.deepEqual(decoded.report.balances[0].anchors, { count: 5, agree: true });

  const badState = minimalBody();
  badState.balances = [heroBalance({ state: "tomorrow" })];
  assert.equal(bankDecodeReport(JSON.stringify(badState), "").report.balances, null);

  const numberWithoutCents = minimalBody();
  numberWithoutCents.balances = [heroBalance({ cents: null })];
  assert.equal(bankDecodeReport(JSON.stringify(numberWithoutCents), "").report.balances, null);

  const wordsWithCents = minimalBody();
  wordsWithCents.balances = [heroBalance({ state: "awaiting_import", reason: null, cents: 5, as_of: "2026-11-13" })];
  assert.equal(bankDecodeReport(JSON.stringify(wordsWithCents), "").report.balances, null);

  assert.deepEqual(bankNormalizeBalances(undefined), { ok: true, present: false, value: null });
});

test("balance model: as_of golden with tooltip, aria, and activation", () => {
  const model = bankPeriodBalanceModel(reportWithBalances([heroBalance()]), ctx());
  assert.equal(model.state, "as_of");
  assert.equal(model.amountText, "$1,234.56");
  assert.equal(model.asOfText, "Fri Nov 13");
  assert.equal(model.negative, false);
  assert.equal(model.words, "");
  assert.deepEqual(model.target, { path: "bank/2026-11.md", line: 26, date: "2026-11-13" });
  assert.equal(model.tooltip, [
    "Checking · closing balance (posted)",
    "$1,234.56 at the end of Fri Nov 13",
    "Sat Nov 14 – Sun Nov 15 not imported yet",
    "−$65.44 since Sun Nov 8, transfers included",
    "✓ Matches all 5 bank-reported balances",
    "Posted balance: your bank app's \"available\" balance also subtracts pending holds",
    "Click to open Fri Nov 13 in the bank month note",
  ].join("\n"));
  assert.equal(
    model.aria,
    "Checking closing balance $1,234.56, as of Fri Nov 13. Opens Fri Nov 13 in the bank month note.",
  );
});

test("balance model: settled names the close and drops the not-imported line", () => {
  const model = bankPeriodBalanceModel(
    reportWithBalances([heroBalance({
      state: "settled",
      as_of: "2026-11-15",
      wanted: "2026-11-15",
      open: null,
      change_cents: null,
      anchors: { count: 1, agree: true },
    })]),
    ctx(),
  );
  assert.equal(model.state, "settled");
  assert.equal(model.asOfText, "");
  assert.equal(model.tooltip, [
    "Checking · closing balance (posted)",
    "$1,234.56 at close Sun Nov 15",
    "From 1 bank-reported balance",
    "Posted balance: your bank app's \"available\" balance also subtracts pending holds",
    "Click to open Fri Nov 13 in the bank month note",
  ].join("\n"));
});

test("balance model: so_far says so far, flags stale, and reads today", () => {
  const stale = bankPeriodBalanceModel(
    reportWithBalances([heroBalance({ state: "so_far", wanted: "2026-11-14", stale: true })]),
    ctx(),
  );
  assert.equal(stale.asOfText, "Fri Nov 13");
  assert.ok(stale.tooltip.includes("$1,234.56 so far · at the end of Fri Nov 13"));
  assert.ok(stale.tooltip.includes("Last bank balance is 1 day old — import a current statement"));
  assert.ok(stale.aria.includes("so far Fri Nov 13, stale."));

  const today = bankPeriodBalanceModel(
    reportWithBalances([heroBalance({ state: "so_far", as_of: "2026-11-14", wanted: "2026-11-14", stale: false })]),
    ctx(),
  );
  assert.equal(today.asOfText, "today");
  assert.ok(today.tooltip.includes("$1,234.56 so far · at the end of Sat Nov 14"));
});

test("balance model: words states, negative and zero amounts", () => {
  const awaiting = bankPeriodBalanceModel(
    reportWithBalances([wordsBalance({ state: "awaiting_import" })]),
    ctx(),
  );
  assert.equal(awaiting.words, "not imported yet");
  assert.equal(awaiting.amountText, "");
  assert.equal(awaiting.tooltip, [
    "Checking · closing balance (posted)",
    "This period is not imported yet.",
    "Import a statement covering this period to see the close.",
  ].join("\n"));
  assert.equal(awaiting.aria, "Checking closing balance not imported yet.");

  const gap = bankPeriodBalanceModel(
    reportWithBalances([wordsBalance({ state: "gap" })]),
    ctx(),
  );
  assert.equal(gap.words, "not imported");
  assert.ok(gap.tooltip.includes("A coverage gap hides this close."));
  assert.ok(gap.aria.endsWith("Opens Fri Nov 13 in the bank month note."));

  const unverified = bankPeriodBalanceModel(
    reportWithBalances([wordsBalance({
      state: "unverified",
      reason: "anchor_mismatch",
      anchors: { count: 2, agree: false },
    })]),
    ctx(),
  );
  assert.equal(unverified.words, "unverified");
  assert.ok(unverified.tooltip.includes("Bank-reported balances disagree."));
  assert.ok(unverified.tooltip.includes("See bob bank check."));

  const negative = bankPeriodBalanceModel(
    reportWithBalances([heroBalance({ cents: -4510, change_cents: -4510 })]),
    ctx(),
  );
  assert.equal(negative.amountText, "−$45.10");
  assert.equal(negative.negative, true);
  assert.ok(negative.tooltip.includes("−$45.10 at the end of Fri Nov 13"));

  const zero = bankPeriodBalanceModel(
    reportWithBalances([heroBalance({ cents: 0, change_cents: 0 })]),
    ctx(),
  );
  assert.equal(zero.amountText, "$0.00");
  assert.equal(zero.negative, false);
});

test("balance model: delta status adds a ledger line; null without hero or numbers", () => {
  const withDelta = reportWithBalances([heroBalance()]);
  withDelta.accounts = [{
    alias: "checking",
    label: "Checking",
    kind: "checking",
    status: "delta",
    delta_cents: -1200,
  }];
  const model = bankPeriodBalanceModel(withDelta, ctx());
  assert.ok(model.tooltip.includes("Ledger rows differ from the bank by $12.00 — see bob bank check"));

  const balanced = reportWithBalances([heroBalance()]);
  balanced.accounts = [{ alias: "checking", label: "Checking", kind: "checking", status: "balanced" }];
  assert.ok(!bankPeriodBalanceModel(balanced, ctx()).tooltip.includes("Ledger rows differ"));

  assert.equal(bankPeriodBalanceModel(reportWithBalances([]), ctx()), null);
  assert.equal(bankPeriodBalanceModel(reportWithBalances([heroBalance({ hero: false })]), ctx()), null);
  assert.equal(bankPeriodBalanceModel(reportWithBalances([heroBalance({ state: "none", reason: "future" })]), ctx()), null);
  assert.equal(bankPeriodBalanceModel({ command: "report" }, ctx()), null);
  assert.equal(bankPeriodBalanceModel(null, ctx()), null);
});

test("charts model: older-bob, missing hero, and none stay byte-identical", () => {
  const bare = bankPeriodChartsModel(chartsReport(null), ctx());
  const emptyBalances = bankPeriodChartsModel(chartsReport([]), ctx());
  const heroNone = bankPeriodChartsModel(
    chartsReport([heroBalance({ state: "none", reason: "future", cents: null, as_of: null })]),
    ctx(),
  );
  const noHero = bankPeriodChartsModel(chartsReport([heroBalance({ hero: false })]), ctx());
  assert.equal(bare.state, "charts");
  assert.equal(bare.digest, emptyBalances.digest);
  assert.equal(bare.digest, heroNone.digest);
  assert.equal(bare.digest, noHero.digest);
  assert.equal(bare.balance, null);
  assert.equal(heroNone.balance, null);

  const one = bankPeriodChartsModel(chartsReport([heroBalance()]), ctx());
  const two = bankPeriodChartsModel(chartsReport([heroBalance({ cents: 999 })]), ctx());
  assert.notEqual(one.digest, two.digest);
  assert.equal(one.balance.state, "as_of");
});

test("charts model: quiet weeks and waiting-badge weeks become header-only balance states", () => {
  const quiet = bankPeriodChartsModel(
    reportWithBalances([heroBalance()], { totals: totals(), waiting: { period: 0, all: 0, oldest: null } }),
    ctx(),
  );
  assert.equal(quiet.state, "balance");
  assert.equal(quiet.reason, "empty");
  assert.equal(quiet.balance.state, "as_of");

  const waitingBadge = bankPeriodChartsModel(
    reportWithBalances([heroBalance()], { totals: totals(), waiting: { period: 3, all: 3, oldest: "2026-11-11" } }),
    ctx({ badgeEnabled: true }),
  );
  assert.equal(waitingBadge.state, "balance");
  assert.equal(waitingBadge.reason, "waiting-badge");

  const waitingLine = bankPeriodChartsModel(
    reportWithBalances([heroBalance()], { totals: totals(), waiting: { period: 3, all: 3, oldest: "2026-11-11" } }),
    ctx({ badgeEnabled: false }),
  );
  assert.equal(waitingLine.state, "waiting");
  assert.equal(waitingLine.balance.state, "as_of");
});

test("paint: header order, link role, and inert balance", () => {
  const doc = fakeDocument();
  const model = bankPeriodBalanceModel(reportWithBalances([heroBalance()]), ctx());
  const opened = [];
  const node = bankPeriodBuildBalance(doc, model, { openBalance: (target, newLeaf) => opened.push([target, newLeaf]) });
  assert.equal(node.getAttribute("class"), "bob-bank-period-balance");
  assert.equal(node.getAttribute("role"), "link");
  assert.equal(node.getAttribute("tabindex"), "0");
  assert.equal(node.getAttribute("data-state"), "as_of");
  assert.ok(String(node.getAttribute("title")).includes("at the end of Fri Nov 13"));
  assert.deepEqual(node.children.map((child) => child.getAttribute("class")), [
    "bob-bank-period-balance-label",
    "bob-bank-period-balance-amount",
    "bob-bank-period-balance-asof",
  ]);
  assert.equal(node.children[1].textContent, "$1,234.56");
  assert.equal(node.children[2].textContent, "· as of Fri Nov 13");
  node.dispatch("click", { ctrlKey: true });
  assert.deepEqual(opened, [[{ path: "bank/2026-11.md", line: 26, date: "2026-11-13" }, true]]);
  node.dispatch("keydown", { key: "Enter" });
  assert.equal(opened.length, 2);

  const inertDoc = fakeDocument();
  const inertModel = bankPeriodBalanceModel(
    reportWithBalances([wordsBalance({ state: "awaiting_import" })]),
    ctx(),
  );
  const inert = bankPeriodBuildBalance(inertDoc, inertModel, {});
  assert.equal(inert.getAttribute("role"), null);
  assert.equal(inert.getAttribute("tabindex"), null);
  assert.equal(inert.getAttribute("aria-label"), null);
  assert.equal(inert.textContent, "BALANCEnot imported yet");

  const host = new FakeNode("div", doc);
  const charts = bankPeriodChartsModel(chartsReport([heroBalance()]), ctx());
  bankPeriodPaint(host, charts, {});
  const header = byClass(host, "bob-bank-period-header")[0];
  const classes = header.children.map((child) => child.getAttribute("class"));
  assert.deepEqual(classes, ["bob-bank-period-disclosure", "bob-bank-period-readout", "bob-bank-period-balance"]);
});

test("paint: header-only root, waiting line, and collapsed panels", () => {
  const doc = fakeDocument();
  const quiet = bankPeriodChartsModel(
    reportWithBalances([heroBalance()], { totals: totals(), waiting: { period: 0, all: 0, oldest: null } }),
    ctx(),
  );
  const quietHost = new FakeNode("div", doc);
  bankPeriodPaint(quietHost, quiet, {});
  const root = byClass(quietHost, "bob-bank-period")[0];
  assert.equal(root.getAttribute("data-state"), "balance");
  assert.equal(byClass(quietHost, "bob-bank-period-disclosure").length, 0);
  assert.equal(byClass(quietHost, "bob-bank-period-switch").length, 0);
  assert.equal(byClass(quietHost, "bob-bank-period-static")[0].textContent, "BANK");
  assert.equal(byClass(quietHost, "bob-bank-period-balance").length, 1);

  const waiting = bankPeriodChartsModel(
    reportWithBalances([heroBalance()], { totals: totals(), waiting: { period: 3, all: 3, oldest: "2026-11-11" } }),
    ctx({ badgeEnabled: false }),
  );
  const waitingHost = new FakeNode("div", doc);
  bankPeriodPaint(waitingHost, waiting, {});
  const line = byClass(waitingHost, "bob-bank-period-waiting")[0];
  assert.ok(line.children.some((child) => (child.getAttribute("class") || "").includes("bob-bank-period-balance")));

  const collapsedHost = new FakeNode("div", doc);
  const collapsed = bankPeriodChartsModel(chartsReport([heroBalance()]), ctx({ collapsed: true }));
  bankPeriodPaint(collapsedHost, collapsed, {});
  assert.equal(byClass(collapsedHost, "bob-bank-period-balance").length, 1);
});

// --- Fixtures and fakes ---

function totals(overrides = {}) {
  return {
    in_cents: 0, out_cents: 0, net_cents: 0, refund_cents: 0,
    transfer_out_cents: 0, transfer_in_cents: 0, cash_out_cents: 0,
    cash_traced_cents: 0, unclassified_out_cents: 0, unclassified_in_cents: 0,
    ...overrides,
  };
}

function minimalBody() {
  return {
    schema_version: 1,
    ok: true,
    today: "2026-11-14",
    categories: [],
    accounts: [],
    issues: { errors: 0, warnings: 0 },
    findings: [],
    period: {
      kind: "week",
      key: "2026-W46",
      start: "2026-11-09",
      end: "2026-11-15",
      label: "2026-W46",
      so_far: true,
      note: null,
    },
    totals: totals(),
    breakdown: [],
    days: [],
    waiting: { period: 0, all: 0, oldest: null },
    coverage: { complete: false, tracked_since: null, imported_through: null, start: null, through: null },
    navigation: { waiting: null, first: null, months: [] },
    flagged: 0,
  };
}

function heroBalance(overrides = {}) {
  return {
    alias: "checking",
    label: "Checking",
    kind: "checking",
    hero: true,
    state: "as_of",
    reason: null,
    cents: 123456,
    as_of: "2026-11-13",
    wanted: "2026-11-15",
    stale: false,
    open: { date: "2026-11-08", cents: 130000 },
    change_cents: -6544,
    coverage: { since: "2026-05-01", through: "2026-11-13" },
    anchors: { count: 5, agree: true },
    target: { path: "bank/2026-11.md", line: 26, date: "2026-11-13" },
    ...overrides,
  };
}

function wordsBalance(overrides = {}) {
  return {
    alias: "checking",
    label: "Checking",
    kind: "checking",
    hero: true,
    state: "awaiting_import",
    reason: null,
    cents: null,
    as_of: null,
    wanted: "2026-11-15",
    stale: false,
    open: null,
    change_cents: null,
    coverage: null,
    anchors: { count: 0, agree: true },
    target: null,
    ...overrides,
    ...(overrides.state === "gap" && !("target" in overrides)
      ? { target: { path: "bank/2026-11.md", line: 26, date: "2026-11-13" } }
      : {}),
  };
}

function ctx(overrides = {}) {
  return {
    kind: "week",
    periodId: "2026-W46",
    today: "2026-11-14",
    stale: false,
    refreshFailed: false,
    badgeEnabled: true,
    view: "both",
    collapsed: false,
    ...overrides,
  };
}

function reportWithBalances(balances, overrides = {}) {
  return {
    command: "report",
    teaching_empty: false,
    period: {
      kind: "week",
      key: "2026-W46",
      start: "2026-11-09",
      end: "2026-11-15",
      label: "2026-W46",
      so_far: true,
      note: null,
    },
    totals: totals({ out_cents: 24977, net_cents: -24977 }),
    breakdown: [],
    days: [],
    waiting: { period: 7, all: 7, oldest: "2026-11-11" },
    coverage: {
      tracked_since: "2026-11-01",
      imported_through: "2026-11-11",
      start: "2026-11-09",
      through: "2026-11-11",
      complete: false,
    },
    navigation: {
      waiting: { path: "bank/2026-11.md", line: 12, date: "2026-11-11" },
      first: { path: "bank/2026-11.md", line: 12, date: "2026-11-11" },
      months: ["bank/2026-11.md"],
    },
    accounts: [],
    balances: balances === null || balances === undefined ? undefined : balances,
    ...overrides,
  };
}

function chartsReport(balances) {
  const report = reportWithBalances(balances);
  const days = [
    ["2026-11-09", "Mon 9"],
    ["2026-11-10", "Tue 10"],
    ["2026-11-11", "Wed 11"],
    ["2026-11-12", "Thu 12"],
    ["2026-11-13", "Fri 13"],
    ["2026-11-14", "Sat 14"],
    ["2026-11-15", "Sun 15"],
  ];
  report.charts = {
    version: 1,
    granularity: "day",
    buckets: days.map(([id, label]) => ({
      id,
      kind: "day",
      label,
      start: id,
      end: id,
      group: null,
      so_far: false,
      state: id === "2026-11-11" ? "tracked" : "awaiting_import",
      in_cents: 0,
      out_cents: id === "2026-11-11" ? 24977 : 0,
      net_cents: id === "2026-11-11" ? -24977 : 0,
      waiting: 0,
      rows: 0,
      top_out: [],
      target: null,
    })),
    groups: [],
    categories: { limit: 5, series: [], rest: null },
  };
  return report;
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
  replaceChildren(...kids) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this._text = "";
    for (const kid of kids) this.appendChild(kid);
  }
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
  return {
    createElement(tag) { return new FakeNode(tag, this); },
    createElementNS(ns, tag) { return new FakeNode(tag, this); },
  };
}

function findAll(root, predicate, result = []) {
  if (predicate(root)) result.push(root);
  for (const child of root.children) findAll(child, predicate, result);
  return result;
}

function byClass(root, name) {
  return findAll(root, (node) => (node.getAttribute("class") || "").split(/\s+/).includes(name));
}
