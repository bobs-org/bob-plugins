// Subscription album surfaces (bob-cli-ls.9): header strip, timeline,
// album card, and records-index pretty labels. Fixtures are fictional.
const assert = require("node:assert/strict");
const test = require("node:test");
const { LedgerToolsPlugin } = require("./ledger-tools-harness.cjs");

const h = LedgerToolsPlugin.helpers;

function bucket(start, due, state) {
  return { start, due, state };
}

function tunely(overrides = {}) {
  return {
    stem: "tunely",
    path: "subscriptions/tunely.md",
    title: "Tunely",
    status: "active",
    status_label: "💚 Active",
    cadence: "monthly",
    pricing: "fixed",
    amount_cents: 999,
    category: { key: "fun", emoji: "🎮", label: "Fun" },
    monthly_cents: 999,
    charges: {
      count: 6,
      total_cents: 5994,
      latest: {
        date: "2026-11-21",
        cents: 999,
        path: "bank/2026-11.md",
        line: 12,
        id: "abcdef12",
        journal_only: false,
      },
    },
    next_expected: "2026-12-21",
    price_change: null,
    still_charging: false,
    after_cancel: null,
    timeline: [
      bucket("2026-01-21", "2026-02-21", "charged"),
      bucket("2026-02-21", "2026-03-21", "charged"),
      bucket("2026-03-21", "2026-04-21", "missed"),
      bucket("2026-04-21", "2026-05-21", "charged"),
      bucket("2026-05-21", "2026-06-21", "uncovered"),
      bucket("2026-06-21", "2026-07-21", "charged"),
      bucket("2026-07-21", "2026-08-21", "charged"),
      bucket("2026-08-21", "2026-09-21", "charged"),
      bucket("2026-09-21", "2026-10-21", "charged"),
      bucket("2026-10-21", "2026-11-21", "charged"),
      bucket("2026-11-21", "2026-12-21", "charged"),
      bucket("2026-12-21", "2027-01-21", "upcoming"),
    ],
    findings: [],
    ...overrides,
  };
}

function cloudbox(overrides = {}) {
  return {
    stem: "cloudbox",
    path: "subscriptions/cloudbox.md",
    title: "Cloudbox",
    status: "to_decide",
    status_label: "🤔 To decide",
    cadence: "monthly",
    pricing: "fixed",
    amount_cents: 1999,
    category: { key: "tech", emoji: "💻", label: "Tech & AI" },
    monthly_cents: 1999,
    charges: {
      count: 4,
      total_cents: 7996,
      latest: {
        date: "2026-11-03",
        cents: 1999,
        path: "bank/2026-11.md",
        line: 8,
        id: "fedcba98",
        journal_only: false,
      },
    },
    next_expected: "2026-12-03",
    price_change: null,
    still_charging: false,
    after_cancel: null,
    timeline: [],
    findings: [],
    ...overrides,
  };
}

function report(overrides = {}) {
  const subscriptions = overrides.subscriptions || [tunely(), cloudbox()];
  const body = {
    ok: true,
    schema_version: 1,
    today: "2026-11-15",
    teaching_empty: false,
    command: "subscriptions",
    all: true,
    album: { stem: "subscriptions", path: "subscriptions.md", title: "Subscriptions", emoji: "🔁" },
    totals: {
      monthly_cents: 2998,
      yearly_cents: 35976,
      by_status: {
        to_decide: { count: 1, monthly_cents: 1999 },
        active: { count: 1, monthly_cents: 999 },
        cancelled: { count: 1, monthly_cents: 0 },
      },
    },
    subscriptions,
    hidden_cancelled: 0,
    issues: { errors: 0, warnings: 0 },
    findings: [],
    ...overrides,
    subscriptions,
  };
  return body;
}

class FakeNode {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase();
    this.nodeName = this.tagName;
    this.nodeType = 1;
    this.ownerDocument = doc;
    this.parentNode = null;
    this._childNodes = [];
    this.attrs = new Map();
    this.style = {};
    this._text = "";
  }
  get children() { return this._childNodes.filter((node) => node.nodeType === 1); }
  get childNodes() { return this._childNodes; }
  get textContent() {
    if (this.nodeType === 3) return this._text;
    return this._childNodes.map((child) => child.textContent).join("") || this._text;
  }
  set textContent(value) {
    this._text = String(value);
    for (const child of this._childNodes) child.parentNode = null;
    this._childNodes = [];
  }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  removeAttribute(name) { this.attrs.delete(name); }
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this._childNodes.push(child);
    return child;
  }
  insertBefore(child, before) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    const at = before ? this._childNodes.indexOf(before) : -1;
    if (at < 0) this._childNodes.push(child);
    else this._childNodes.splice(at, 0, child);
    return child;
  }
  removeChild(child) {
    const at = this._childNodes.indexOf(child);
    if (at >= 0) {
      this._childNodes.splice(at, 1);
      child.parentNode = null;
    }
    return child;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
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
      for (const child of node._childNodes) {
        if (child.nodeType === 1 && child.matches(selector)) found.push(child);
        if (child.nodeType === 1) visit(child);
      }
    };
    visit(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function fakeDom() {
  const doc = {
    createElement: (tag) => new FakeNode(tag, doc),
  };
  const el = new FakeNode("div", doc);
  el.ownerDocument = doc;
  return { doc, el };
}

test("subscription argv includes -a for cancelled records on surfaces", () => {
  assert.deepEqual(h.bankBuildArgs({ command: "subscriptions", all: true }), [
    "bank", "subscriptions", "-a", "-f", "json",
  ]);
  assert.equal(h.bankSubscriptionIsRecordPath("subscriptions/tunely.md"), true);
  assert.equal(h.bankSubscriptionIsAlbumPath("subscriptions.md"), true);
  assert.equal(h.bankIsSubscriptionPath("subscriptions/tunely.md"), true);
  assert.equal(h.bankSubscriptionIsRecordPath("subscriptions.md"), false);
});

test("record header reads money, last/next, timeline, and finding sentence", () => {
  const body = report({
    findings: [{
      code: "bank_subscription_price",
      severity: "info",
      path: "subscriptions/tunely.md",
      line: 1,
      message: "Tunely's latest charge does not match the record amount.",
      hint: "update the amount",
    }],
  });
  const model = h.bankSubscriptionHeaderModel(body, "subscriptions/tunely.md");
  assert.equal(model.kind, "header");
  assert.equal(model.factsText, "$9.99 a month · ≈ $120 a year · last Nov 21 · next ≈ Dec 21");
  assert.equal(model.timeline.length, 12);
  assert.equal(model.timeline[0].kind, "charged");
  assert.equal(model.timeline[2].kind, "missed");
  assert.equal(model.timeline[4].kind, "faint");
  assert.equal(model.timeline[11].kind, "faint");
  assert.equal(model.finding, "Tunely's latest charge does not match the record amount.");
});

test("yearly record header shows its monthly equivalent", () => {
  const yearly = tunely({
    cadence: "yearly",
    amount_cents: 14999,
    monthly_cents: 1250,
  });
  const model = h.bankSubscriptionHeaderModel(
    report({ subscriptions: [yearly] }),
    "subscriptions/tunely.md",
  );
  assert.match(model.factsText, /^\$149\.99 a year · ≈ \$12\.50 a month/);
});

test("timeline paints amber on the price-changed bucket, else the latest charged", () => {
  const matched = tunely({
    price_change: { from_cents: 899, to_cents: 999, since: "2026-06-22" },
  });
  const matchedDots = h.bankSubscriptionTimelineDots(matched);
  assert.equal(matchedDots.filter((dot) => dot.amber).length, 1);
  assert.equal(matchedDots[5].amber, true);
  const fallback = tunely({
    price_change: { from_cents: 899, to_cents: 999, since: "2025-01-01" },
  });
  const fallbackDots = h.bankSubscriptionTimelineDots(fallback);
  assert.equal(fallbackDots.filter((dot) => dot.amber).length, 1);
  assert.equal(fallbackDots[10].amber, true);
});

test("finding fallbacks stay generic and never invent amounts", () => {
  assert.equal(
    h.bankSubscriptionFindingFallback("bank_subscription_to_cancel_charged"),
    "This record is marked to cancel and still charged.",
  );
  assert.equal(
    h.bankSubscriptionFindingFallback("bank_subscription_cancelled_charge"),
    "A charge arrived after this record was cancelled.",
  );
  const body = report({
    subscriptions: [tunely({ findings: ["bank_subscription_overlap"] })],
    findings: [],
  });
  assert.equal(
    h.bankSubscriptionFindingSentence(body, "subscriptions/tunely.md"),
    "Two records claim the same charge.",
  );
});

test("album card estimates commitments, counts statuses, and ranks live bars", () => {
  const cancelled = tunely({
    stem: "oldbox",
    path: "subscriptions/oldbox.md",
    title: "Oldbox",
    status: "cancelled",
    status_label: "🚫 Cancelled",
    monthly_cents: 0,
    amount_cents: 499,
  });
  const body = report({
    subscriptions: [tunely(), cloudbox(), cancelled],
    findings: [{ code: "bank_subscription_price", path: "subscriptions/tunely.md", message: "price" }],
  });
  const model = h.bankSubscriptionAlbumCardModel(body);
  assert.equal(model.kind, "card");
  assert.equal(model.monthly, "$29.98");
  assert.equal(model.yearly, "$359.76");
  assert.equal(model.estimateNote, "an estimate of commitments, not bank spend");
  assert.deepEqual(model.statuses.map((item) => item.key), ["to_decide", "active", "cancelled"]);
  assert.deepEqual(model.bars.map((item) => item.title), ["Cloudbox", "Tunely"]);
  assert.equal(model.bars[0].share, 1);
  assert.ok(model.bars[1].share < 1);
  assert.equal(model.findingsCount, 1);
});

test("teaching empty points at bob albums create", () => {
  const model = h.bankSubscriptionAlbumCardModel({
    teaching_empty: true,
    command: "subscriptions",
    subscriptions: [],
  });
  assert.equal(model.kind, "teaching-empty");
  assert.match(model.teach, /bob albums create/);
  assert.equal(model.commandHint, "bob albums create");
});

test("index pretty paints bank category labels, money cadence, and next chip", () => {
  const body = report();
  const heading = h.bankSubscriptionPrettyHeading("fun", body);
  assert.equal(heading.pretty, "🎮 Fun");
  const tech = h.bankSubscriptionPrettyHeading("tech", body);
  assert.equal(tech.pretty, "💻 Tech & AI");
  assert.equal(h.bankSubscriptionPrettyHeading("💚 Active", body), null);
  const facets = h.bankSubscriptionPrettyFacets("9.99 · Monthly");
  assert.equal(facets.pretty, "$9.99 a month");
  assert.equal(h.bankSubscriptionPrettyFacets("200 · Yearly").pretty, "$200.00 a year");
  assert.equal(h.bankSubscriptionPrettyFacets("58.5 · Monthly").pretty, "$58.50 a month");
  const row = h.bankSubscriptionIndexRowModel(tunely(), "9.99 · Monthly");
  assert.equal(row.amountText, "$9.99 a month");
  assert.equal(row.nextText, "next ≈ Dec 21");
});

test("header and card paint fictional Tunely/Cloudbox chrome", () => {
  const { el } = fakeDom();
  const header = h.bankSubscriptionPaintHeader(el, h.bankSubscriptionHeaderModel(report(), "subscriptions/tunely.md"));
  assert.ok(header);
  assert.match(header.textContent, /\$9\.99 a month/);
  assert.match(header.textContent, /next ≈ Dec 21/);
  assert.equal(header.querySelectorAll(".bob-subscription-dot").length, 12);
  const { el: cardHost } = fakeDom();
  h.bankSubscriptionPaintCard(cardHost, h.bankSubscriptionAlbumCardModel(report()));
  assert.match(cardHost.textContent, /an estimate of commitments, not bank spend/);
  assert.match(cardHost.textContent, /Cloudbox/);
  assert.match(cardHost.textContent, /Tunely/);
  assert.match(cardHost.textContent, /no findings/);
});

test("unknown bob-bank views stay quiet and subscriptions is a real view", () => {
  assert.deepEqual(h.bankCardParseFence("view: subscriptions"), { ok: true, view: "subscriptions" });
  assert.deepEqual(h.bankCardParseFence("view: inbox"), { ok: true, view: "inbox", quiet: true });
});
