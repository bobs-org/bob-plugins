// Category-card subscription linking tests use synthetic records and bank rows.
const assert = require("node:assert/strict");
const test = require("node:test");
const { LedgerToolsPlugin } = require("./ledger-tools-harness.cjs");

const h = LedgerToolsPlugin.helpers;
const CATEGORIES = [
  { key: "media", label: "Media", emoji: "🎬", hotkey: "m", group: "Home", hidden: false },
  { key: "software", label: "Software", emoji: "💻", hotkey: "s", group: "Home", hidden: false },
];

function keyEvent(key, options = {}) {
  return {
    key,
    ctrlKey: options.ctrlKey === true,
    repeat: options.repeat === true,
    isComposing: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; },
  };
}

function cardRow(overrides = {}) {
  return {
    path: "bank/2026-11.md",
    line: 2,
    cents: -999,
    payee: "TUNELY MONTHLY",
    category: null,
    id: "aaa111",
    ...overrides,
  };
}

test("subscription picker filters titles and needles and ranks row matches first", () => {
  const entries = [
    { path: "subscriptions/close.md", title: "Close Amount", status: "active", amount_cents: 999, match: ["OTHER"] },
    { path: "subscriptions/tunely-old.md", title: "Tunely Old", status: "cancelled", amount_cents: 1099, match: ["TUNELY"] },
    { path: "subscriptions/tunely.md", title: "Tunely", status: "active", amount_cents: 1099, match: ["TUNELY"] },
  ];
  const items = h.bankSubscriptionPickerItems(entries, "tun", cardRow());
  assert.deepEqual(items.map((entry) => entry.title), ["Tunely", "Tunely Old"]);
  assert.equal(items[0].matched, true);
  assert.deepEqual(h.bankSubscriptionPickerItems(entries, "other", cardRow()).map((entry) => entry.title), ["Close Amount"]);
});

test("record selection inserts one link, fills a missing category, and closes in one edit", () => {
  const path = "bank/2026-11.md";
  const line = "- [ ] $9.99 TUNELY MONTHLY ^bank-aaa111";
  const source = `## Thu Nov 12\n${line}\n`;
  const plan = h.bankCategorySubscriptionWritePlan({
    mode: "close",
    capture: h.bankCategoryCapture({ path, line: 2, lineText: line }),
    currentPath: path,
    currentSource: source,
    categoryKey: "media",
    recordPath: "subscriptions/tunely.md",
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.edits.length, 1);
  const updated = h.bankCategoryApplyLineEdits(line, plan);
  assert.match(updated, /^- \[x\]/);
  assert.match(updated, /\[cat:: media\]/);
  assert.match(updated, /\[\[subscriptions\/tunely\|🔁\]\]/);
});

test("set mode can link without a category and replaces one prior subscription link", () => {
  const path = "bank/2026-11.md";
  const line = "- [x] $9.99 TUNELY [[subscriptions/old|🔁]] ^bank-aaa111";
  const plan = h.bankCategorySubscriptionWritePlan({
    mode: "set",
    capture: h.bankCategoryCapture({ path, line: 2, lineText: line }),
    currentPath: path,
    currentSource: `## Thu Nov 12\n${line}\n`,
    categoryKey: null,
    recordPath: "subscriptions/new.md",
  });
  assert.equal(plan.ok, true);
  const updated = h.bankCategoryApplyLineEdits(line, plan);
  assert.match(updated, /\[\[subscriptions\/new\|🔁\]\]/);
  assert.doesNotMatch(updated, /subscriptions\/old/);
  assert.equal((updated.match(/subscriptions\//g) || []).length, 1);
});

test("new subscription fields default from the candidate proposal and stay argv-safe", () => {
  const stage = h.bankSubscriptionCreateStageInit(cardRow(), {
    title: "Cloudbox",
    amount_cents: 1999,
    cadence: "four_weekly",
    match: ["CLOUDBOX BILLING"],
    category: "software",
  }, CATEGORIES);
  assert.deepEqual(stage, {
    title: "Cloudbox",
    status: "to_decide",
    amount: "19.99",
    cadence: "four_weekly",
    match: "CLOUDBOX BILLING",
    category: "software",
    focus: "title",
    error: "",
    applying: false,
  });
  const built = h.bankSubscriptionCreateArgs({
    ...stage,
    title: "$service; do-not-run",
  });
  assert.equal(built.ok, true);
  assert.equal(built.args[3], "$service; do-not-run");
  assert.ok(built.args.includes("status=to_decide"));
  assert.ok(built.args.includes("match=CLOUDBOX BILLING"));
  assert.ok(built.args.includes("category=software"));
  assert.equal(built.args.at(-1), "json");
  assert.equal(h.bankSubscriptionCreateStageInit(cardRow(), { title: "Ambiguous" }, CATEGORIES).match, "");
});

test("subscription JSON decoders accept reports and reject malformed record paths", () => {
  const report = h.bankDecodeSubscriptions(JSON.stringify({
    ok: true,
    schema_version: 1,
    album: { stem: "subscriptions", path: "subscriptions.md", title: "Subscriptions" },
    subscriptions: [
      { path: "subscriptions/tunely.md", title: "Tunely" },
      { path: "", title: "Missing path" },
    ],
  }), "");
  assert.equal(report.ok, true);
  assert.equal(report.report.subscriptions.length, 1);
  assert.equal(h.bankDecodeSubscriptions("{}", "").ok, false);

  const created = h.bankDecodeRecordCreation(JSON.stringify({ status: "written", path: "subscriptions/new.md" }), "", 0);
  assert.equal(created.ok, true);
  assert.equal(h.bankDecodeRecordCreation(JSON.stringify({ status: "written", path: "../other.md" }), "", 0).ok, false);
});

test("slash picker returns its selected record through the card writer options", async () => {
  const choices = [];
  const modal = new h.BankCategoryCardModal({}, {
    mode: "set",
    categories: CATEGORIES,
    context: { cardRow: cardRow() },
    onChoose: async (category, kind, _modal, options) => choices.push({ category, kind, options }),
    plugin: {
      apiBankRefresh: async () => ({
        report: {
          album: { path: "subscriptions.md" },
          subscriptions: [
            { path: "subscriptions/tunely.md", title: "Tunely", status: "active", amount_cents: 999, cadence: "monthly", match: ["TUNELY"], category: { key: "media", label: "Media" } },
          ],
          findings: [],
        },
        error: null,
      }),
    },
  });
  await modal.openSubscriptionPicker();
  assert.equal(modal.subscriptionPicker.items.length, 1);
  await modal.onKeyDown(keyEvent("Enter"));
  assert.deepEqual(choices, [{
    category: "media",
    kind: "pick",
    options: { subscriptionPath: "subscriptions/tunely", title: "Tunely" },
  }]);
});

test("picker arrows move, Escape backs out, and the opening chord cannot double-commit", async () => {
  const choices = [];
  const modal = new h.BankCategoryCardModal({}, {
    mode: "set",
    categories: CATEGORIES,
    openedWithCtrlEnter: true,
    context: { cardRow: cardRow() },
    onChoose: async (category, kind, _modal, options) => choices.push({ category, kind, options }),
    plugin: {
      apiBankRefresh: async () => ({
        report: {
          album: { path: "subscriptions.md" },
          subscriptions: [
            { path: "subscriptions/one.md", title: "One", status: "active", amount_cents: 999, match: ["TUNELY"] },
            { path: "subscriptions/two.md", title: "Two", status: "active", amount_cents: 999, match: ["TUNELY"] },
          ],
        },
        error: null,
      }),
    },
  });
  await modal.openSubscriptionPicker();
  await modal.onKeyDown(keyEvent("ArrowDown"));
  assert.equal(modal.subscriptionPicker.selected, 1);
  await modal.onKeyDown(keyEvent("Enter"));
  assert.equal(choices.length, 0);
  modal.onKeyUp(keyEvent("Enter"));
  await modal.onKeyDown(keyEvent("Escape"));
  assert.equal(modal.subscriptionPicker, null);
  assert.equal(modal.closed, false);
  await modal.openSubscriptionPicker();
  await modal.onKeyDown(keyEvent("Enter"));
  assert.equal(choices[0].options.subscriptionPath, "subscriptions/one");
});

test("new subscription sheet creates a record then links that created path", async () => {
  const choices = [];
  const calls = [];
  const modal = new h.BankCategoryCardModal({}, {
    mode: "set",
    categories: CATEGORIES,
    context: { cardRow: cardRow() },
    onChoose: async (category, kind, _modal, options) => choices.push({ category, kind, options }),
    plugin: {
      apiBankRefresh: async () => ({
        report: {
          album: { path: "subscriptions.md" },
          subscriptions: [],
          findings: [{
            code: "bank_subscription_candidate",
            path: "bank/2026-11.md",
            line: 2,
            proposal: { title: "Tunely", amount_cents: 999, cadence: "monthly", match: ["TUNELY"], category: "media" },
          }],
        },
        error: null,
      }),
      apiBankCreateSubscription: async (fields) => {
        calls.push({ ...fields });
        return { ok: true, report: { path: "subscriptions/tunely.md" } };
      },
    },
  });
  await modal.openSubscriptionPicker();
  assert.equal(modal.subscriptionProposal.title, "Tunely");
  assert.equal(modal.openSubscriptionCreateStage(), true);
  assert.equal(await modal.applySubscriptionCreateStage(), true);
  assert.equal(calls[0].status, "to_decide");
  assert.equal(calls[0].amount, "9.99");
  assert.deepEqual(choices, [{
    category: "media",
    kind: "pick",
    options: { subscriptionPath: "subscriptions/tunely.md", title: "Tunely" },
  }]);
});

test("bank subscription fetch builds an argv command without changing other readers", () => {
  assert.deepEqual(h.bankBuildArgs({ command: "subscriptions" }), ["bank", "subscriptions", "-f", "json"]);
  assert.deepEqual(h.bankBuildArgs({ command: "list", month: "2026-11" }), ["bank", "list", "-m", "2026-11", "-f", "json"]);
});

test("candidate ghost activation opens the row in set mode and starts the picker", async () => {
  const path = "bank/2026-11.md";
  const editor = { cursor: null, setCursor(value) { this.cursor = value; } };
  const opened = [];
  const plugin = new LedgerToolsPlugin({});
  plugin.bankOpenMonthPathAtLine = async (...args) => { opened.push(["open", ...args]); return true; };
  plugin.bankActiveFilePath = () => path;
  plugin.bankActiveEditor = () => editor;
  plugin.bankCategoryOpenAtCursor = (_editor, _view, mode, chord) => {
    opened.push(["card", mode, chord]);
    plugin.bankCategoryModal = { async openSubscriptionPicker() { opened.push(["picker"]); } };
    return true;
  };
  assert.equal(plugin.bankSubscriptionCandidateActivate({ rowPath: path, rowLine: 4 }), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(editor.cursor, { line: 3, ch: 0 });
  assert.deepEqual(opened, [
    ["open", path, 4, 0],
    ["card", "set", false],
    ["picker"],
  ]);
});
