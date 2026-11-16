// Subscription chips (bob-cli-ls.7): decode, chip model, ghost write plan,
// queue helper, and Reading-view wrap/restore. Live Preview decorations and
// queue-card DOM are covered in the bank-marks and bank-cards tests.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { LedgerToolsPlugin } = require("./ledger-tools-harness.cjs");

const h = LedgerToolsPlugin.helpers;
const fixtureDir = path.join(__dirname, "../plugins/bob-ledger-tools/scripts/fixtures/bank");
const reportDocument = JSON.parse(fs.readFileSync(path.join(fixtureDir, "report-month.json"), "utf8"));

function sub(overrides = {}) {
  return {
    stem: "tunely",
    path: "subscriptions/tunely.md",
    title: "Tunely",
    status: "active",
    status_label: "💚 Active",
    cadence: "monthly",
    pricing: "flat",
    amount_cents: 999,
    source: "link",
    needle: "TUNELY",
    drift_cents: null,
    price_change: null,
    state: "ok",
    ...overrides,
  };
}

function tokenFrom(line, extras = {}) {
  const token = h.bankTokenizeLine(line);
  assert.ok(token, `expected a bank row token for ${line}`);
  return {
    ...token,
    path: "bank/2026-11.md",
    line: 9,
    date: "2026-11-12",
    lineText: line,
    ...extras,
  };
}

function jsonRow(overrides = {}) {
  return {
    path: "bank/2026-11.md",
    line: 9,
    date: "2026-11-12",
    payee: "Tunely",
    cents: -999,
    id: "abcdef12",
    subscription: null,
    bank_recurring: false,
    subscription_candidate: false,
    ...overrides,
  };
}

test("older bob rows decode without subscription fields and stay unchipped", () => {
  const decoded = h.bankDecodeReport(JSON.stringify(reportDocument), "");
  assert.equal(decoded.ok, true);
  const shop = decoded.report.days[1].rows.find((row) => row.payee === "ShopRite");
  assert.ok(shop);
  assert.equal(shop.subscription, null);
  assert.equal(shop.bank_recurring, false);
  assert.equal(shop.subscription_candidate, false);
  const token = tokenFrom("- [ ] $61.20 ShopRite [cat:: groceries] ⚑ -- with Kelly");
  assert.equal(h.bankSubscriptionChipModel(token, shop), null);
});

test("row decoder accepts subscription JSON and the subscription suggestion source", () => {
  const body = JSON.parse(JSON.stringify(reportDocument));
  const shop = body.days[1].rows.find((row) => row.payee === "ShopRite");
  shop.subscription = sub({ source: "match", state: "ok" });
  shop.bank_recurring = true;
  shop.subscription_candidate = false;
  shop.suggestion = { category: "streaming", source: "subscription" };
  const decoded = h.bankDecodeReport(JSON.stringify(body), "");
  assert.equal(decoded.ok, true);
  const row = decoded.report.days[1].rows.find((entry) => entry.payee === "ShopRite");
  assert.equal(row.subscription.stem, "tunely");
  assert.equal(row.subscription.source, "match");
  assert.equal(row.bank_recurring, true);
  assert.equal(row.suggestion.source, "subscription");
  const withLatest = JSON.parse(JSON.stringify(body));
  withLatest.days[1].rows.find((entry) => entry.payee === "ShopRite").subscription.latest = "2026-11-21";
  const latestDecoded = h.bankDecodeReport(JSON.stringify(withLatest), "");
  assert.equal(
    latestDecoded.report.days[1].rows.find((entry) => entry.payee === "ShopRite").subscription.latest,
    "2026-11-21",
  );
  const malformed = JSON.parse(JSON.stringify(body));
  malformed.days[1].rows.find((entry) => entry.payee === "ShopRite").subscription = { title: "nope" };
  const dropped = h.bankDecodeReport(JSON.stringify(malformed), "");
  assert.equal(dropped.ok, true);
  assert.equal(dropped.report.days[1].rows.find((entry) => entry.payee === "ShopRite").subscription, null);
});

test("linked chip labels follow state, payee containment, and tooltip copy", () => {
  const linked = tokenFrom("- [ ] $9.99 Tunely [[subscriptions/tunely|🔁]] ^bank-abcdef12");
  const ok = h.bankSubscriptionChipModel(linked, jsonRow({ subscription: sub(), cents: -999 }));
  assert.equal(ok.kind, "linked");
  assert.equal(ok.state, "ok");
  assert.equal(ok.label, "🔁");
  assert.equal(ok.tone, "muted");
  assert.match(ok.tooltip, /Tunely/);
  assert.match(ok.tooltip, /💚 Active/);
  assert.match(ok.tooltip, /\$9\.99 a month/);
  assert.match(ok.tooltip, /charged Nov 12/);
  assert.equal(ok.ariaLabel, "Open Tunely subscription");
  assert.equal(ok.click, "open-record");

  const named = h.bankSubscriptionChipModel(
    tokenFrom("- [ ] $12.00 CloudCo [[subscriptions/cloudbox|🔁]]"),
    jsonRow({
      payee: "CloudCo",
      cents: -1200,
      subscription: sub({ stem: "cloudbox", path: "subscriptions/cloudbox.md", title: "Cloudbox", amount_cents: 1200 }),
    }),
  );
  assert.equal(named.label, "🔁 Cloudbox");

  const drift = h.bankSubscriptionChipModel(linked, jsonRow({
    subscription: sub({ state: "drift", drift_cents: 100 }),
  }));
  assert.equal(drift.label, "🔁 +$1.00");
  assert.equal(drift.tone, "muted");
  const priced = h.bankSubscriptionChipModel(linked, jsonRow({
    subscription: sub({
      state: "drift",
      drift_cents: 100,
      price_change: { from_cents: 899, to_cents: 999, since: "2026-11-01" },
    }),
  }));
  assert.equal(priced.tone, "amber");

  const usage = h.bankSubscriptionChipModel(linked, jsonRow({ subscription: sub({ state: "usage" }) }));
  assert.equal(usage.label, "🔁 usage");
  assert.equal(usage.tone, "muted");

  const cancel = h.bankSubscriptionChipModel(linked, jsonRow({ subscription: sub({ state: "to_cancel" }) }));
  assert.equal(cancel.label, "🔁 ✂️ still charging");
  assert.equal(cancel.tone, "amber");
  assert.equal(cancel.click, "open-url");

  const after = h.bankSubscriptionChipModel(linked, jsonRow({ subscription: sub({ state: "after_cancel" }) }));
  assert.equal(after.label, "🔁 🚫 after cancel");
  assert.equal(after.tone, "warning");
  assert.equal(after.click, "open-record");
});

test("subscription tooltip uses the record latest date when available", () => {
  const linked = tokenFrom("- [ ] $9.99 Tunely [[subscriptions/tunely|🔁]] ^bank-abcdef12");
  const model = h.bankSubscriptionChipModel(
    linked,
    jsonRow({ subscription: sub({ latest: "2026-11-21" }) }),
  );
  assert.match(model.tooltip, /latest charge Nov 21/);
  assert.doesNotMatch(model.tooltip, /charged Nov 12/);
});

test("matched-unlinked rows are dashed ghosts; candidates stay tooltip-only", () => {
  const bare = tokenFrom("- [ ] $9.99 Tunely ^bank-abcdef12");
  const ghost = h.bankSubscriptionChipModel(bare, jsonRow({
    subscription: sub({ source: "match" }),
    bank_recurring: true,
  }));
  assert.equal(ghost.kind, "ghost");
  assert.equal(ghost.ghost, true);
  assert.equal(ghost.label, "🔁");
  assert.equal(ghost.click, "insert-link");
  assert.equal(h.bankSubscriptionChipClass(ghost).includes("is-ghost"), true);

  const candidate = h.bankSubscriptionChipModel(bare, jsonRow({
    subscription: null,
    bank_recurring: true,
    subscription_candidate: true,
  }));
  assert.equal(candidate.kind, "candidate");
  assert.equal(candidate.label, "⟳ subscription?");
  assert.equal(candidate.click, "candidate");
  assert.equal(candidate.tooltip, h.BANK_SUBSCRIPTION_CANDIDATE_TOOLTIP);
  assert.equal(h.bankSubscriptionChipClass(candidate).includes("is-candidate"), true);
});

test("a 🔁 wikilink without JSON still paints a linked chip", () => {
  const token = tokenFrom("- [ ] $9.99 Tunely [[subscriptions/tunely|🔁]]");
  const chip = h.bankSubscriptionChipModel(token, jsonRow({ subscription: null }));
  assert.equal(chip.kind, "linked");
  assert.equal(chip.recordPath, "subscriptions/tunely");
  assert.equal(chip.click, "open-record");
});

test("ghost write plan inserts the wikilink before the bank id as one edit", () => {
  const source = [
    "---",
    "month: 2026-11",
    "---",
    "",
    "# 🏦 November 2026",
    "",
    "## Thu Nov 12",
    "",
    "- [ ] $9.99 Tunely ^bank-abcdef12",
    "",
  ].join("\n");
  const plan = h.bankSubscriptionLinkWritePlan({
    currentPath: "bank/2026-11.md",
    currentSource: source,
    capture: {
      path: "bank/2026-11.md",
      line: 9,
      lineText: "- [ ] $9.99 Tunely ^bank-abcdef12",
      bankId: "abcdef12",
    },
    recordPath: "subscriptions/tunely",
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.action, "insert");
  assert.equal(plan.edits.length, 1);
  assert.match(plan.edits[0].insert, /\[\[subscriptions\/tunely\|🔁\]\]/);
  const linked = source.replace(
    "- [ ] $9.99 Tunely ^bank-abcdef12",
    "- [ ] $9.99 Tunely [[subscriptions/tunely|🔁]] ^bank-abcdef12",
  );
  const exists = h.bankSubscriptionLinkWritePlan({
    currentPath: "bank/2026-11.md",
    currentSource: linked,
    capture: {
      path: "bank/2026-11.md",
      line: 9,
      lineText: "- [ ] $9.99 Tunely [[subscriptions/tunely|🔁]] ^bank-abcdef12",
      bankId: "abcdef12",
    },
    recordPath: "subscriptions/tunely",
  });
  assert.equal(exists.ok, true);
  assert.equal(exists.action, "exists");
  assert.deepEqual(exists.edits, []);
});

test("queue helper paints the same chip model as the month-note token", () => {
  const row = jsonRow({
    subscription: sub({ state: "to_cancel" }),
    category: "streaming",
    links: ["[[subscriptions/tunely|🔁]]"],
  });
  const chip = h.bankSubscriptionChipForQueueRow(row);
  assert.equal(chip.kind, "linked");
  assert.equal(chip.label, "🔁 ✂️ still charging");
  assert.equal(chip.tone, "amber");
});

test("Reading wrap hides the native 🔁 link and restore removes appended ghosts", () => {
  const doc = {
    createElement(tag) {
      return makeEl(tag, doc);
    },
    createTextNode(value) {
      return { nodeType: 3, nodeValue: String(value), textContent: String(value), parentNode: null };
    },
  };
  function makeEl(tag, owner) {
    const node = {
      tagName: String(tag).toUpperCase(),
      nodeName: String(tag).toUpperCase(),
      nodeType: 1,
      ownerDocument: owner,
      parentNode: null,
      childNodes: [],
      className: "",
      attrs: {},
      classList: {
        contains(name) { return node.className.split(/\s+/).includes(name); },
      },
      setAttribute(name, value) {
        node.attrs[name] = String(value);
        if (name === "class") node.className = String(value);
      },
      getAttribute(name) { return name === "class" ? node.className : (node.attrs[name] ?? null); },
      appendChild(child) {
        if (child.parentNode && child.parentNode.removeChild) child.parentNode.removeChild(child);
        child.parentNode = node;
        node.childNodes.push(child);
        return child;
      },
      insertBefore(child, ref) {
        if (child.parentNode && child.parentNode.removeChild) child.parentNode.removeChild(child);
        child.parentNode = node;
        const index = node.childNodes.indexOf(ref);
        if (index < 0) node.childNodes.push(child);
        else node.childNodes.splice(index, 0, child);
        return child;
      },
      removeChild(child) {
        const index = node.childNodes.indexOf(child);
        if (index >= 0) node.childNodes.splice(index, 1);
        child.parentNode = null;
        return child;
      },
      get textContent() {
        return node.childNodes.map((child) => child.textContent || child.nodeValue || "").join("");
      },
      querySelectorAll(selector) {
        const wanted = selector.split(",").map((part) => part.trim());
        const out = [];
        const visit = (current) => {
          for (const child of current.childNodes || []) {
            if (child.nodeType !== 1) continue;
            const tag = child.tagName.toLowerCase();
            if (wanted.some((part) => {
              const classes = part.match(/\.[A-Za-z0-9_-]+/g) || [];
              const tagPart = part.replace(/\.[A-Za-z0-9_-]+/g, "").trim().toLowerCase();
              if (tagPart && tagPart !== "*" && tag !== tagPart) return false;
              return classes.every((name) => (child.className || "").split(/\s+/).includes(name.slice(1)));
            })) out.push(child);
            visit(child);
          }
        };
        visit(node);
        return out;
      },
      querySelector(selector) { return node.querySelectorAll(selector)[0] || null; },
    };
    return node;
  }
  const row = makeEl("li", doc);
  const link = makeEl("a", doc);
  link.setAttribute("class", "internal-link");
  link.setAttribute("data-href", "subscriptions/tunely");
  link.appendChild(doc.createTextNode("🔁"));
  row.appendChild(link);
  const model = h.bankSubscriptionChipModel(
    tokenFrom("- [ ] $9.99 Tunely [[subscriptions/tunely|🔁]]"),
    jsonRow({ subscription: sub() }),
  );
  assert.equal(h.bankMarkWrapSubscriptionAnchor(row, model, null), true);
  assert.equal(row.querySelectorAll(".bob-bank-mark-host").length, 1);
  assert.equal(row.querySelectorAll(".bob-bank-mark-sub").length, 1);
  assert.equal(row.querySelector(".bob-bank-mark-native").textContent, "🔁");

  const ghostRow = makeEl("li", doc);
  const ghost = h.bankSubscriptionChipModel(
    tokenFrom("- [ ] $9.99 Tunely ^bank-abcdef12"),
    jsonRow({ subscription: sub({ source: "match" }) }),
  );
  assert.equal(h.bankMarkAppendSubscriptionChip(ghostRow, ghost, null), true);
  assert.equal(ghostRow.querySelectorAll(".bob-bank-mark-sub.is-appended").length, 1);
  h.bankRestoreMarkHosts(ghostRow);
  assert.equal(ghostRow.querySelectorAll(".bob-bank-mark-sub.is-appended").length, 0);
});
