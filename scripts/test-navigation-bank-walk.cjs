// Bank walk navigation: family runtime, counted landings, scope hand-off,
// retries, and payee-start positioning through the shared landing path.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const notices = [];
global.Notice = class {
  constructor(message) {
    notices.push(message && typeof message === "object" ? "[fragment]" : String(message));
    this.message = message;
  }
  hide() { this.hidden = true; }
};
global.window = global.window || { setTimeout: (callback) => setTimeout(callback, 0) };

class TestMarkdownView {}
class TestPlugin {}
const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: TestMarkdownView,
      Modal: class {},
      Notice: global.Notice,
      Platform: { isDesktopApp: true },
      Plugin: TestPlugin,
      normalizePath: (value) => value,
      parseYaml: (text) => JSON.parse(text),
    };
  }
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value } };
  if (request === "@codemirror/view") {
    class TestEditorView {}
    TestEditorView.updateListener = { of: (listener) => ({ listener }) };
    return { EditorView: TestEditorView, keymap: { of: (value) => value } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const NavigationHotkeysPlugin = require("../plugins/bob-navigation-hotkeys/main.js");
const { helpers } = NavigationHotkeysPlugin;
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const ledger = LedgerToolsPlugin.helpers;
const { TransactionEditor } = require("./navigation-hotkeys-harness.cjs");
Module._load = originalLoad;

function bankEntry({ key, date = "2026-11-13", line = 2, path = "bank/2026-11.md", text, payee, ackId, label, month, monthLabel, inflow, amountText }) {
  return {
    key,
    date,
    line,
    path,
    text: text || `- [ ] $12.34 ${payee || key}`,
    payee: payee || key,
    amountText: amountText || "-$12.34",
    inflow: inflow === true,
    acknowledged: false,
    ackId: ackId || null,
    label: label || "Fri Nov 13",
    month: month || "2026-11",
    monthLabel: monthLabel || "November 2026",
    dayRank: 1,
    dayTotal: 1,
  };
}

function fakeNode() {
  const node = {
    children: [],
    cls: "",
    text: "",
    attr: {},
    attrs: {},
    createDiv(options = {}) {
      const child = fakeNode();
      child.cls = options.cls || "";
      child.text = options.text || "";
      child.attr = options.attr || {};
      this.children.push(child);
      return child;
    },
    createSpan(options = {}) {
      return this.createDiv(options);
    },
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
  };
  return node;
}

function bankSnapshot(scope, entries, generation = 1) {
  const days = [];
  const dayIndex = new Map();
  entries.forEach((entry, index) => {
    let day = dayIndex.get(entry.date);
    if (!day) {
      day = { date: entry.date, first: index, last: index, count: 0 };
      dayIndex.set(entry.date, day);
      days.push(day);
    }
    day.last = index;
    day.count += 1;
  });
  for (const day of days) {
    entries.slice(day.first, day.last + 1).forEach((entry, index) => {
      entry.dayRank = index + 1;
      entry.dayTotal = day.count;
    });
  }
  return {
    available: true,
    scope,
    entries,
    days,
    generation,
    counts: { waiting: scope === "waiting" ? entries.length : 0, total: entries.length },
  };
}

function makeRuntimePlugin({ snapshots, cursor = null, anchor = null, busy = false, plan = ledger.bankWalkPlan } = {}) {
  let index = 0;
  const planCalls = [];
  const landings = [];
  const anchors = [];
  const api = {
    version: 1,
    snapshot() {
      const at = index++;
      return typeof snapshots === "function"
        ? snapshots(at)
        : snapshots[Math.min(at, snapshots.length - 1)];
    },
    plan(snapshot, options) {
      planCalls.push({ snapshot, options });
      return plan(snapshot, options);
    },
    resolve: () => ({ ok: true, line0: 1, ch: 9 }),
    anchor: () => anchor,
    setAnchor: (entry) => anchors.push(entry),
    busy: () => busy,
  };
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  plugin.app = { plugins: { plugins: { "bob-ledger-tools": { api: { bankWalk: api } } } } };
  plugin.bankWalkChain = Promise.resolve();
  plugin.bankWalkPendingCount = 0;
  plugin.lastBankWalkScope = null;
  plugin.reviewWalkBusy = () => false;
  plugin.getReviewJumpCursor = () => cursor;
  plugin.getReviewWalkOriginCursor = () => ({ path: "origin.md", line: 0, ch: 2 });
  plugin.getActiveMarkdownView = () => null;
  plugin.isVimNormalModeEditor = () => false;
  plugin.landOnWalkEntry = async (entry, options) => {
    landings.push({ entry, options });
    return { ok: true, stale: false, settled: Promise.resolve(true) };
  };
  return { plugin, api, planCalls, landings, anchors, snapshotsRead: () => index };
}

test("ledger planner is the runtime planner for counted bank gestures", async () => {
  const entries = [
    bankEntry({ key: "a", line: 2, payee: "Cafe" }),
    bankEntry({ key: "b", line: 4, payee: "Market" }),
    bankEntry({ key: "c", line: 6, payee: "Pharmacy" }),
  ];
  const snapshot = bankSnapshot("waiting", entries);
  const expected = ledger.bankWalkPlan(snapshot, { direction: 1, repeat: 3 });
  assert.equal(expected.entry.key, "c");

  const state = makeRuntimePlugin({ snapshots: [snapshot], cursor: { path: "bank/2026-11.md", line: 5 } });
  notices.length = 0;
  assert.equal(await state.plugin.jumpToBankRow(1, { repeat: 3 }), true);
  assert.equal(state.snapshotsRead(), 1);
  assert.equal(state.planCalls.length, 1);
  assert.equal(state.planCalls[0].options.repeat, 3);
  assert.deepEqual(state.planCalls[0].options.cursor, { path: "bank/2026-11.md", line0: 4 });
  assert.equal(state.landings.length, 1);
  assert.equal(state.landings[0].entry.key, "c");
  assert.equal(state.anchors[0].key, "c");
});

test("stale landing takes one fresh snapshot and replans from the original origin", async () => {
  const first = bankEntry({ key: "old", line: 2, payee: "Old row" });
  const next = bankEntry({ key: "new", line: 3, payee: "Current row" });
  const state = makeRuntimePlugin({
    snapshots: [bankSnapshot("waiting", [first], 1), bankSnapshot("waiting", [next], 2)],
    cursor: { path: "bank/2026-11.md", line: 7 },
  });
  let count = 0;
  state.plugin.landOnWalkEntry = async (entry, options) => {
    state.landings.push({ entry, options });
    count += 1;
    return count === 1
      ? { ok: false, stale: true, settled: Promise.resolve(false) }
      : { ok: true, stale: false, settled: Promise.resolve(true) };
  };
  assert.equal(await state.plugin.jumpToBankRow(1), true);
  assert.equal(state.snapshotsRead(), 2);
  assert.equal(state.planCalls.length, 2);
  assert.equal(state.landings.length, 2);
  assert.equal(state.landings[0].entry.key, "old");
  assert.equal(state.landings[1].entry.key, "new");
  assert.deepEqual(state.planCalls[1].options.cursor, { path: "bank/2026-11.md", line0: 6 });
  assert.equal(state.anchors[0].key, "new");
});

test("queued gesture is dropped when its captured scope flips before it runs", async () => {
  const waiting = bankSnapshot("waiting", [bankEntry({ key: "wait", payee: "Waiting" })], 1);
  const all = bankSnapshot("all", [bankEntry({ key: "all", payee: "Archive" })], 2);
  let current = waiting;
  const state = makeRuntimePlugin({ snapshots: () => current });
  let finishFirst;
  let landingCount = 0;
  state.plugin.landOnWalkEntry = async (entry, options) => {
    landingCount += 1;
    state.landings.push({ entry, options });
    if (landingCount === 1) {
      return new Promise((resolve) => { finishFirst = () => resolve({ ok: true, settled: Promise.resolve(true) }); });
    }
    return { ok: true, settled: Promise.resolve(true) };
  };
  notices.length = 0;
  const first = state.plugin.jumpToBankRow(1);
  await Promise.resolve();
  await Promise.resolve();
  const queued = state.plugin.jumpToBankRow(1);
  current = all;
  finishFirst();
  assert.equal(await first, true);
  assert.equal(await queued, false);
  assert.equal(landingCount, 1);
  assert.equal(state.planCalls.length, 1);
  assert.equal(notices.filter((notice) => notice === "Nothing waiting — ]b now walks every row").length, 1);
});

test("busy and unavailable states do not move the cursor", async () => {
  notices.length = 0;
  const busy = makeRuntimePlugin({ snapshots: [bankSnapshot("waiting", [bankEntry({ key: "x" })])], busy: true });
  assert.equal(await busy.plugin.jumpToBankRow(1), false);
  assert.equal(busy.snapshotsRead(), 0);
  assert.deepEqual(notices, []);

  const missing = Object.create(NavigationHotkeysPlugin.prototype);
  missing.app = { plugins: { plugins: {} } };
  missing.reviewWalkBusy = () => false;
  assert.equal(await missing.jumpToBankRow(1), false);
  assert.deepEqual(notices, ["Bob Ledger Tools bank walk api required"]);

  notices.length = 0;
  const indexing = makeRuntimePlugin({ snapshots: [{ available: false, reason: "indexing", scope: "waiting" }] });
  assert.equal(await indexing.plugin.jumpToBankRow(1), false);
  assert.deepEqual(notices, ["Bank walk unavailable — still indexing bank notes"]);
});

test("empty walk reports import guidance without a phantom landing", async () => {
  notices.length = 0;
  const state = makeRuntimePlugin({ snapshots: [bankSnapshot("all", [])] });
  assert.equal(await state.plugin.jumpToBankRow(1), false);
  assert.deepEqual(state.landings, []);
  assert.ok(notices.some((notice) => notice === "No bank rows yet — bob bank import adds them"));
});

function landingHarness(activePath, targetContent) {
  const targetFile = { path: "bank/2026-11.md", extension: "md" };
  const sourceFile = { path: activePath, extension: "md" };
  const sourceEditor = new TransactionEditor("source", { line: 0, ch: 0 });
  const targetEditor = new TransactionEditor(targetContent, { line: 0, ch: 0 });
  let active = { file: sourceFile, editor: sourceEditor };
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  plugin.app = {
    vault: { getAbstractFileByPath: (path) => path === targetFile.path ? targetFile : null },
    workspace: { getLeaf: () => ({ openFile: async () => true }) },
  };
  plugin.getActiveMarkdownView = () => active;
  plugin.isMarkdownFile = (file) => Boolean(file && file.extension === "md");
  plugin.readLinkPickerNoteContent = async () => targetContent;
  plugin.findMarkdownLeafByPath = (path) => path === targetFile.path ? { view: { file: targetFile, editor: targetEditor } } : null;
  plugin.activateWorkspaceLeaf = async (leaf) => { active = leaf.view; return true; };
  plugin.pendingTaskMoveJumpDeferred = null;
  plugin.pendingTaskMoveJumpCompletion = null;
  plugin.pendingTaskMoveJumpLandingId = null;
  plugin.pendingOpenTaskJumpCenterDeferred = null;
  plugin.vimJumpOperationToken = 0;
  plugin.taskMoveLandingSeq = 0;
  return { plugin, sourceEditor, targetEditor, active: () => active };
}

test("same-note and cross-note bank landings keep the payee column", async () => {
  const content = "# Nov 2026\n- [ ] $12.34 Coffee ^bank-abcdef12";
  const entry = bankEntry({ key: "bank:abcdef12", line: 2, text: "- [ ] $12.34 Coffee ^bank-abcdef12", payee: "Coffee", ackId: "abcdef12" });
  const resolveLine = () => ({ ok: true, line: 1, ch: 12 });

  const same = landingHarness("bank/2026-11.md", content);
  same.plugin.getActiveMarkdownView = () => ({ file: { path: entry.path }, editor: same.targetEditor });
  const sameResult = await same.plugin.landOnWalkEntry(entry, { resolveLine });
  assert.equal(sameResult.ok, true);
  assert.deepEqual(same.targetEditor.getCursor(), { line: 1, ch: 12 });

  const cross = landingHarness("daily/2026-11-14.md", content);
  const crossResult = await cross.plugin.landOnWalkEntry(entry, { resolveLine });
  assert.equal(crossResult.ok, true);
  assert.equal(await crossResult.settled, true);
  assert.equal(cross.active().file.path, entry.path);
  assert.deepEqual(cross.targetEditor.getCursor(), { line: 1, ch: 12 });
});

test("shared bank resolver refuses a stale row instead of clamping its old line", () => {
  const resolved = helpers.resolveTaskMoveDestinationLine("# bank\n- [ ] changed", {
    line: 1,
    ch: 5,
    resolve: () => ({ ok: false }),
  });
  assert.deepEqual(resolved, { ok: false, source: "resolver" });
});

test("palette names match the bank-walk contract", () => {
  const plugin = new NavigationHotkeysPlugin();
  const commands = [];
  plugin.app = {
    workspace: {
      getActiveFile: () => null,
      on: () => ({}),
      onLayoutReady: () => {},
    },
    loadLocalStorage: () => null,
    saveLocalStorage: () => {},
  };
  plugin.addCommand = (spec) => commands.push(spec);
  plugin.register = () => {};
  plugin.registerEvent = () => {};
  plugin.registerEditorExtension = () => {};
  plugin.registerVimMappingsWhenReady = () => {};
  plugin.registerVimJumpHistoryVaultEvents = () => {};
  plugin.registerOpenTaskJumpInputListeners = () => {};
  plugin.registerReviewRefreshInputListeners = () => {};
  plugin.registerCountedTransclusionToggleInputListeners = () => {};
  plugin.registerCountedBulletPropertyInputListeners = () => {};
  plugin.registerCountedTaskMoveInputListeners = () => {};
  plugin.registerCountedLaneToggleInputListeners = () => {};
  plugin.registerClearSearchHighlightInputListeners = () => {};
  plugin.captureActiveFilePosition = () => {};
  plugin.refreshDashScrollCaptureTarget = () => {};
  plugin.ensureTemplaterNewNoteTrigger = () => {};
  plugin.onload();
  const name = (id) => {
    const found = commands.find((item) => item.id === id);
    assert.ok(found, id);
    return found.name;
  };
  assert.equal(name("jump-to-next-bank-row"), "Jump to next bank row (waiting rows first)");
  assert.equal(name("jump-to-prev-bank-row"), "Jump to previous bank row (waiting rows first)");
  assert.equal(name("jump-to-next-bank-day"), "Jump to the first row of the next bank day");
  assert.equal(name("jump-to-prev-bank-day"), "Jump to the first row of the previous bank day");
});

test("scope flip banner is shown once and folds into the landing toast", async () => {
  const waitingEntry = bankEntry({ key: "wait", payee: "Waiting" });
  const allEntry = bankEntry({ key: "all", payee: "Archive" });
  const waiting = bankSnapshot("waiting", [waitingEntry], 1);
  waiting.counts.waiting = 1;
  const all = bankSnapshot("all", [allEntry], 2);
  all.counts.waiting = 0;
  let current = waiting;
  const state = makeRuntimePlugin({ snapshots: () => current });
  notices.length = 0;
  state.plugin.lastBankWalkScope = "waiting";
  current = all;
  assert.equal(await state.plugin.jumpToBankRow(1), true);
  const first = notices.filter((notice) => String(notice).includes("Nothing waiting — ]b now walks every row"));
  assert.equal(first.length, 1);
  assert.equal(notices.includes("Nothing waiting — ]b now walks every row"), false);
  notices.length = 0;
  assert.equal(await state.plugin.jumpToBankRow(1), true);
  assert.equal(notices.some((notice) => String(notice).includes("Nothing waiting — ]b now walks every row")), false);

  notices.length = 0;
  state.plugin.lastBankWalkScope = "all";
  current = waiting;
  assert.equal(await state.plugin.jumpToBankRow(1), true);
  assert.equal(notices.filter((notice) => String(notice).includes("1 waiting — ]b now walks waiting rows")).length, 1);
  notices.length = 0;
  assert.equal(await state.plugin.jumpToBankRow(1), true);
  assert.equal(notices.some((notice) => String(notice).includes("]b now walks waiting rows")), false);
});

test("a flip that lands nothing still shows the banner as a Notice", async () => {
  const waiting = bankSnapshot("waiting", [bankEntry({ key: "wait" })], 1);
  const empty = bankSnapshot("all", [], 2);
  empty.counts.waiting = 0;
  let current = waiting;
  const state = makeRuntimePlugin({ snapshots: () => current });
  notices.length = 0;
  state.plugin.lastBankWalkScope = "waiting";
  current = empty;
  assert.equal(await state.plugin.jumpToBankRow(1), false);
  assert.ok(notices.includes("Nothing waiting — ]b now walks every row"));
  assert.ok(notices.includes("No bank rows yet — bob bank import adds them"));
});

test("a failed open names the target path", async () => {
  const entry = bankEntry({ key: "shop", path: "bank/2026-11.md", payee: "ShopRite" });
  const state = makeRuntimePlugin({ snapshots: [bankSnapshot("waiting", [entry])] });
  state.plugin.landOnWalkEntry = async () => ({ ok: false, stale: false });
  notices.length = 0;
  assert.equal(await state.plugin.jumpToBankRow(1), false);
  assert.ok(notices.includes("Could not open bank/2026-11.md"));
});

test("toast model paints the day rail, day line, month, and hint", () => {
  const shop = bankEntry({
    key: "shop",
    date: "2026-11-13",
    payee: "ShopRite",
    amountText: "$42.50",
    label: "Fri Nov 13",
  });
  const payroll = bankEntry({
    key: "pay",
    date: "2026-11-13",
    line: 4,
    payee: "Payroll",
    amountText: "+$1,200.00",
    inflow: true,
    label: "Fri Nov 13",
  });
  const waiting = bankSnapshot("waiting", [shop, payroll]);
  waiting.counts.waiting = 2;
  const plan = ledger.bankWalkPlan(waiting, { direction: 1 });
  const banner = "Nothing waiting — ]b now walks every row";
  const model = helpers.buildBankWalkNoticeModel(waiting, plan, banner);
  assert.equal(model.banner, banner);
  assert.equal(model.scope, "waiting");
  assert.equal(model.rank, 1);
  assert.equal(model.total, 2);
  assert.equal(model.dayRank, 1);
  assert.equal(model.dayTotal, 2);
  assert.equal(model.dayIndex, 0);
  assert.equal(model.dayCount, 1);
  assert.equal(model.monthLabel, "November 2026");
  assert.equal(model.hint, "Ctrl+Enter file");
  assert.match(model.text, /Fri Nov 13 · 1 of 2/);
  assert.equal(helpers.bankWalkNoticeMonthLabel({ month: "2026-10" }), "October 2026");

  const all = bankSnapshot("all", [shop, payroll]);
  all.scope = "all";
  const allPlan = ledger.bankWalkPlan(all, { direction: 1 });
  const allModel = helpers.buildBankWalkNoticeModel(all, allPlan);
  assert.equal(allModel.hint, "]} next day");
  assert.equal(allModel.banner, null);

  const rail = fakeNode();
  helpers.renderBankWalkDayRail(rail, { dayCount: 5, dayIndex: 2 });
  assert.equal(rail.children.length, 5);
  assert.equal(rail.children[2].cls.includes("is-current"), true);
  assert.equal(rail.children.filter((child) => child.cls.includes("bob-nh-bank-walk-dot")).length, 5);

  const bar = fakeNode();
  helpers.renderBankWalkDayRail(bar, { dayCount: 31, dayIndex: 10 });
  assert.equal(bar.children.length, 1);
  assert.equal(bar.children[0].cls, "bob-nh-bank-walk-bar");
});
