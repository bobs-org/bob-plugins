// Real-handler tests for the decision-card commit paths (bob-cli-3v landing).
// Drives `refreshTaskFreshness` → `maybeOpenFreshnessDecayCard` →
// `applyFreshnessDecayCardChoice` / `revalidateFreshnessDecayCard` / the
// `applyFreshnessDecayCard*` adapters with a fake editor and the real ledger
// keep/stamp placers. "Today" is pinned through the plugin date hooks
// (including dates before the former 2026-10-19 gate); never the wall
// clock.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestMarkdownView {}

class TestPlugin {
  constructor(app) {
    this.app = app;
  }
  addCommand(command) {
    this.commands = this.commands || [];
    this.commands.push(command);
  }
  registerEditorExtension(extension) {
    this.editorExtensions = this.editorExtensions || [];
    this.editorExtensions.push(extension);
  }
  registerEvent(ref) {
    this.registeredEvents = this.registeredEvents || [];
    this.registeredEvents.push(ref);
    return ref;
  }
  registerMarkdownCodeBlockProcessor(language, handler) {
    this.codeBlocks = this.codeBlocks || {};
    this.codeBlocks[language] = handler;
  }
  registerInterval(handle) {
    this.intervals = this.intervals || [];
    this.intervals.push(handle);
    return handle;
  }
}

const notices = [];
class TestNotice {
  constructor(message) {
    notices.push(String(message));
  }
}
function clearNotices() {
  notices.length = 0;
}

const openedModals = [];
class TestModal {
  constructor(app) {
    this.app = app;
    this.isOpen = false;
    this.modalEl = { addClass: () => {} };
    this.contentEl = { empty: () => {} };
  }
  open() {
    this.isOpen = true;
    openedModals.push(this);
    return this;
  }
  close() {
    if (!this.isOpen) {
      return this;
    }
    this.isOpen = false;
    if (typeof this.onClose === "function") {
      this.onClose();
    }
    return this;
  }
}

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: TestMarkdownView,
      Modal: TestModal,
      Notice: TestNotice,
      Platform: { isDesktopApp: true },
      Plugin: TestPlugin,
      normalizePath: (value) => value,
      parseYaml: (text) => JSON.parse(text),
    };
  }
  if (request === "@codemirror/state") {
    return { Prec: { highest: (value) => value } };
  }
  if (request === "@codemirror/view") {
    class TestEditorView {}
    TestEditorView.updateListener = { of: (listener) => ({ listener }) };
    return {
      EditorView: TestEditorView,
      keymap: { of: (value) => value },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const NavigationHotkeysPlugin = require("../plugins/bob-navigation-hotkeys/main.js");
const { helpers } = NavigationHotkeysPlugin;
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers: ledgerHelpers } = LedgerToolsPlugin;
Module._load = originalLoad;

const DATE = "2026-10-20";
const BEFORE = "2026-10-18";

function buildDecayConfig(options = {}) {
  const levels = [
    { label: "P1", value: "high", min_days: 2, max_days: 7 },
    { label: "P2", value: "medium", min_days: 8, max_days: 30 },
    { label: "P3", value: "low", min_days: 31, max_days: 90 },
    { label: "P4", value: "lowest", min_days: 91, max_days: 365 },
  ];
  const entry = {
    name: "priority",
    values: "priority",
    schedules: "scheduled",
    levels: options.levels || levels,
  };
  return helpers.validateBulletPropertyConfig({
    properties: [{ name: "scheduled", values: "date" }, entry],
  });
}

function decayConfig() {
  const config = buildDecayConfig();
  assert.ok(config);
  return config;
}

const realKeep = (line, dateText, options) =>
  ledgerHelpers.freshnessKeepLine(line, dateText || DATE, options).line;
const realStamp = (line, dateText) =>
  ledgerHelpers.freshnessStampLine(line, dateText || DATE).line;

function rottenEntry(overrides = {}) {
  return {
    key: "a.md:3",
    path: "a.md",
    line: 3,
    lineNumber: 2,
    text: "Buy milk",
    originalMarkdown: "- [ ] #task Buy milk [fresh:: 2026-09-30] [keeps:: 3]",
    blockId: null,
    state: "rotten",
    bucket: "rotten",
    tier: "rotten",
    tierLabel: "ROTTEN",
    lane: "ready",
    fresh: "2026-09-30",
    dueOn: "2026-10-07",
    daysOverdue: 13,
    interval: 7,
    keeps: 3,
    decide: true,
    rank: 1,
    tierRank: 1,
    tierTotal: 1,
    ...overrides,
  };
}

const BASE_COUNTS = {
  due: 23,
  new: 3,
  resurfaced: 0,
  rotten: 5,
  fresh: 0,
  refreshedToday: 12,
  upkeepToday: 12,
  budget: null,
  budgetMet: false,
};

function applyTxChanges(state, changes) {
  const list = Array.isArray(changes) ? changes.slice() : [];
  if (
    list.length === 1 &&
    list[0] &&
    list[0].from &&
    list[0].to &&
    typeof list[0].text === "string" &&
    String(list[0].text).includes("\n") &&
    list[0].from.line === 0
  ) {
    state.lines = String(list[0].text).split("\n");
    return;
  }
  const sorted = list.sort((left, right) => right.from.line - left.from.line);
  for (const change of sorted) {
    const text = String(change.text);
    const fromLine = change.from.line;
    if (text.includes("\n")) {
      if (text.startsWith("\n")) {
        const insertLines = text.slice(1).split("\n");
        state.lines.splice(fromLine + 1, 0, ...insertLines);
      } else if (text.endsWith("\n")) {
        const insertLines = text.slice(0, -1).split("\n");
        state.lines.splice(fromLine, 0, ...insertLines);
      } else {
        state.lines.splice(fromLine, 1, ...text.split("\n"));
      }
    } else {
      state.lines[fromLine] = text;
    }
  }
}

function makeEditor(initial, cursorLine = 0) {
  const state = {
    lines: String(initial).split("\n"),
    cursor: { line: cursorLine, ch: 0 },
    transactions: [],
    replaceRanges: [],
    valueQueue: [],
    cursorSet: [],
  };
  const editor = {
    state,
    getCursor: () => ({ ...state.cursor }),
    getLine: (line) => state.lines[line],
    getValue: () =>
      state.valueQueue.length > 0
        ? state.valueQueue.shift()
        : state.lines.join("\n"),
    transaction: (tx) => {
      state.transactions.push(tx);
      applyTxChanges(state, tx.changes);
      if (tx.selection) {
        const from = tx.selection.from || tx.selection;
        if (from && Number.isInteger(from.line)) {
          state.cursor = { line: from.line, ch: from.ch || 0 };
          state.cursorSet.push({ ...state.cursor });
        }
      }
    },
    replaceRange: (text, from, to) => {
      state.replaceRanges.push({ text, from, to });
      applyTxChanges(state, [{ from, to, text }]);
    },
    getScrollInfo: () => null,
    setCursor: (line, ch) => {
      if (typeof line === "object" && line !== null) {
        state.cursor = { line: line.line, ch: line.ch || 0 };
      } else {
        state.cursor = { line, ch: ch || 0 };
      }
      state.cursorSet.push({ ...state.cursor });
    },
    focus: () => {},
  };
  return editor;
}

function freshnessCapable(queue, counts, overrides = {}) {
  const decayState = {
    enabled: true,
    keeps: 3,
    enter: null,
    ...(overrides.decay || {}),
  };
  return {
    version: 6,
    queue: () => queue.map((entry) => ({ ...entry })),
    counts: () => ({ ...counts }),
    stampLine: realStamp,
    setRefreshLine: (line, days, dateText) =>
      ledgerHelpers.freshnessSetRefreshLine(line, days, dateText || DATE).line,
    keepLine: realKeep,
    config: () => ({
      interval: 7,
      invalid: false,
      decay: { ...decayState },
    }),
    intervalFor: () => null,
    ...overrides.extra,
  };
}

function makePlugin({ filePath, editor, freshness, dateText = DATE }) {
  const file = { path: filePath, extension: "md", basename: filePath };
  const view = { file, editor };
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  plugin.app = {
    plugins: {
      plugins: {
        "bob-ledger-tools": { api: { version: 3, freshness } },
      },
    },
    workspace: { getActiveViewOfType: () => view },
    vault: { getAbstractFileByPath: () => null },
  };
  plugin.config = decayConfig();
  plugin.reviewAnchor = null;
  plugin.view = view;
  plugin.laneReleaseDateText = () => dateText;
  plugin.getFreshnessDateText = () => dateText;
  plugin.jumpCalls = 0;
  const realJump = plugin.jumpToDueTask;
  plugin.jumpToDueTask = async (...args) => {
    plugin.jumpCalls += 1;
    return true;
  };
  plugin.openedCards = [];
  const realOpen = plugin.openFreshnessDecayCard;
  plugin.openFreshnessDecayCard = function (cardCtx) {
    plugin.openedCards.push(cardCtx);
    return realOpen.call(this, cardCtx);
  };
  return plugin;
}

const ROTTEN_AT_LIMIT = "- [ ] #task Buy milk [fresh:: 2026-09-30] [keeps:: 3]";

function singleAtLimitFixture({ dateText = DATE, line = ROTTEN_AT_LIMIT } = {}) {
  const content = ["# Tasks", "", line].join("\n");
  const editor = makeEditor(content, 2);
  const entry = rottenEntry({
    line: 3,
    originalMarkdown: line,
    keeps: 3,
    decide: true,
  });
  const plugin = makePlugin({
    filePath: "a.md",
    editor,
    freshness: freshnessCapable([entry], BASE_COUNTS),
    dateText,
  });
  return { editor, plugin, entry, content, line };
}

// --- 1. single Alt+F opens the card and writes nothing; Esc writes nothing ---

test("single Alt+F on an at-limit task opens the card and writes nothing", async () => {
  clearNotices();
  openedModals.length = 0;
  const { editor, plugin, content } = singleAtLimitFixture();
  const ok = await plugin.refreshTaskFreshness(editor, { dateText: DATE });
  assert.equal(ok, true);
  assert.equal(editor.state.lines.join("\n"), content);
  assert.equal(editor.state.transactions.length, 0);
  assert.equal(editor.state.replaceRanges.length, 0);
  assert.ok(plugin.activeFreshnessDecayCard);
  assert.equal(plugin.openedCards.length, 1);
  assert.doesNotMatch(notices.join("\n"), /kept \d+×/);
});

test("dismissing the card writes nothing and does not advance", async () => {
  clearNotices();
  openedModals.length = 0;
  const { editor, plugin, content } = singleAtLimitFixture();
  await plugin.refreshTaskFreshness(editor, { dateText: DATE });
  const modal = plugin.activeFreshnessDecayCard;
  assert.ok(modal);
  const before = editor.state.lines.join("\n");
  assert.equal(typeof modal.onDismiss, "function");
  modal.onDismiss();
  assert.equal(editor.state.lines.join("\n"), before);
  assert.equal(editor.state.lines.join("\n"), content);
  assert.equal(plugin.jumpCalls, 0);
});

// --- 2. early dates still open the card; older namespaces fall back ---

test("early dates open the card and write nothing", async () => {
  clearNotices();
  openedModals.length = 0;
  const { editor, plugin, content } = singleAtLimitFixture({
    dateText: BEFORE,
  });
  const ok = await plugin.refreshTaskFreshness(editor, { dateText: BEFORE });
  assert.equal(ok, true);
  assert.equal(editor.state.lines.join("\n"), content);
  assert.equal(editor.state.transactions.length, 0);
  assert.equal(editor.state.replaceRanges.length, 0);
  assert.ok(plugin.activeFreshnessDecayCard);
  assert.equal(plugin.openedCards.length, 1);
});

test("namespace v5 with decide true stamps counted and opens no card", async () => {
  clearNotices();
  openedModals.length = 0;
  const line = ROTTEN_AT_LIMIT;
  const editor = makeEditor(["# Tasks", "", line].join("\n"), 2);
  const entry = rottenEntry({
    line: 3,
    originalMarkdown: line,
    keeps: 3,
    decide: true,
  });
  const plugin = makePlugin({
    filePath: "a.md",
    editor,
    freshness: freshnessCapable([entry], BASE_COUNTS, {
      extra: { version: 5 },
    }),
    dateText: BEFORE,
  });
  const ok = await plugin.refreshTaskFreshness(editor, { dateText: BEFORE });
  assert.equal(ok, true);
  assert.match(editor.state.lines[2], /\[fresh:: 2026-10-18\]/);
  assert.match(editor.state.lines[2], /\[keeps:: 4\]/);
  assert.equal(plugin.openedCards.length, 0);
  assert.equal(Boolean(plugin.activeFreshnessDecayCard), false);
});

// --- 3. stale rejection rebuilds or closes without writing ---

async function openCard() {
  clearNotices();
  openedModals.length = 0;
  const fixture = singleAtLimitFixture();
  const ok = await fixture.plugin.refreshTaskFreshness(fixture.editor, {
    dateText: DATE,
  });
  assert.equal(ok, true);
  assert.equal(fixture.plugin.openedCards.length, 1);
  return fixture;
}

test("stale task-line change writes nothing", async () => {
  const { editor, plugin } = await openCard();
  const cardCtx = plugin.openedCards[0];
  editor.state.lines[2] = "- [ ] #task Buy milk edited [fresh:: 2026-09-30] [keeps:: 3]";
  const before = editor.state.lines.join("\n");
  const txBefore = editor.state.transactions.length;
  const ok = await plugin.applyFreshnessDecayCardChoice(cardCtx, "notNow");
  assert.equal(ok, false);
  assert.equal(editor.state.lines.join("\n"), before);
  assert.equal(editor.state.transactions.length, txBefore);
  assert.match(notices[notices.length - 1], /Review queue changed/);
});

test("stale local-day change writes nothing", async () => {
  const { editor, plugin } = await openCard();
  const cardCtx = plugin.openedCards[0];
  plugin.getFreshnessDateText = () => "2026-10-21";
  const before = editor.state.lines.join("\n");
  const ok = await plugin.applyFreshnessDecayCardChoice(cardCtx, "notNow");
  assert.equal(ok, false);
  assert.equal(editor.state.lines.join("\n"), before);
  assert.match(notices[notices.length - 1], /Review queue changed/);
});

test("stale decay-config change writes nothing", async () => {
  const { editor, plugin } = await openCard();
  const cardCtx = plugin.openedCards[0];
  const api = plugin.app.plugins.plugins["bob-ledger-tools"].api.freshness;
  const origConfig = api.config;
  api.config = () => ({ interval: 7, invalid: false, decay: { enabled: true, keeps: 5, enter: null } });
  try {
    const before = editor.state.lines.join("\n");
    const ok = await plugin.applyFreshnessDecayCardChoice(cardCtx, "notNow");
    assert.equal(ok, false);
    assert.equal(editor.state.lines.join("\n"), before);
    assert.match(notices[notices.length - 1], /Review queue changed/);
  } finally {
    api.config = origConfig;
  }
});

test("stale priority-ladder config writes nothing", async () => {
  const { editor, plugin } = await openCard();
  const cardCtx = plugin.openedCards[0];
  const levels = [
    { label: "P1", value: "high", min_days: 2, max_days: 7 },
    { label: "P2", value: "medium", min_days: 8, max_days: 45 },
    { label: "P3", value: "low", min_days: 46, max_days: 90 },
    { label: "P4", value: "lowest", min_days: 91, max_days: 365 },
  ];
  plugin.config = helpers.validateBulletPropertyConfig({
    properties: [
      { name: "scheduled", values: "date" },
      { name: "priority", values: "priority", schedules: "scheduled", levels },
    ],
  });
  const before = editor.state.lines.join("\n");
  const ok = await plugin.applyFreshnessDecayCardChoice(cardCtx, "notNow");
  assert.equal(ok, false);
  assert.equal(editor.state.lines.join("\n"), before);
  assert.match(notices[notices.length - 1], /Review queue changed/);
});

test("stale child Schedule Log writes nothing", async () => {
  const { editor, plugin } = await openCard();
  const cardCtx = plugin.openedCards[0];
  editor.state.lines.splice(
    3,
    0,
    "\t- 📅 **SCHEDULE LOG**",
    "\t\t- *2026-10-19* — 🎲 P0 → P2 decay · kept 3×",
  );
  const before = editor.state.lines.join("\n");
  const txBefore = editor.state.transactions.length;
  const ok = await plugin.applyFreshnessDecayCardChoice(cardCtx, "notNow");
  assert.equal(ok, false);
  assert.equal(editor.state.lines.join("\n"), before);
  assert.equal(editor.state.transactions.length, txBefore);
  assert.match(notices[notices.length - 1], /Review queue changed/);
});

// --- 4. Not now writes the previewed date and reason in one transaction ---

test("Not now stamps, clears keeps, and advances exactly once", async () => {
  clearNotices();
  openedModals.length = 0;
  const content = ["# Tasks", "", ROTTEN_AT_LIMIT].join("\n");
  const editor = makeEditor(content, 2);
  const entry = rottenEntry({ line: 3, originalMarkdown: ROTTEN_AT_LIMIT });
  const plugin = makePlugin({
    filePath: "a.md",
    editor,
    freshness: freshnessCapable([entry], BASE_COUNTS),
    dateText: DATE,
  });
  const opened = await plugin.refreshTaskFreshness(editor, {
    dateText: DATE,
    advance: true,
  });
  assert.equal(opened, true);
  const cardCtx = plugin.openedCards[0];
  assert.ok(cardCtx.plan.notNow.available);
  const previewDate = cardCtx.plan.notNow.date;
  const previewReason = cardCtx.plan.notNow.reason;
  assert.ok(previewDate);
  assert.match(previewReason, /kept 3×/);
  const txBefore = editor.state.transactions.length;
  const ok = await plugin.applyFreshnessDecayCardChoice(cardCtx, "notNow");
  assert.equal(ok, true);
  assert.equal(editor.state.transactions.length, txBefore + 1);
  assert.doesNotMatch(editor.state.lines[2], /keeps::/);
  assert.match(editor.state.lines[2], /\[fresh:: 2026-10-20\]/);
  assert.ok(editor.state.lines[2].includes(previewDate));
  assert.equal(plugin.jumpCalls, 1);
});

// --- 5. Keep increments through keepLine and saturates at 999 ---

test("Keep counts once and saturates at 999 without reset", async () => {
  for (const [start, expected] of [
    [ROTTEN_AT_LIMIT, /\[keeps:: 4\]/],
    [
      "- [ ] #task Buy milk [fresh:: 2026-09-30] [keeps:: 999]",
      /\[keeps:: 999\]/,
    ],
  ]) {
    clearNotices();
    const editor = makeEditor(["# Tasks", "", start].join("\n"), 2);
    const entry = rottenEntry({ line: 3, originalMarkdown: start });
    const plugin = makePlugin({
      filePath: "a.md",
      editor,
      freshness: freshnessCapable([entry], BASE_COUNTS),
      dateText: DATE,
    });
    await plugin.refreshTaskFreshness(editor, { dateText: DATE });
    const cardCtx = plugin.openedCards[0];
    const ok = await plugin.applyFreshnessDecayCardChoice(cardCtx, "keep");
    assert.equal(ok, true, start);
    assert.match(editor.state.lines[2], expected, start);
    assert.match(editor.state.lines[2], /\[fresh:: 2026-10-20\]/, start);
    assert.match(notices[notices.length - 1], /Kept \d+× · next review asks/, start);
  }
});

// --- 6. Reword stamps, logs, places the cursor, and never advances ---

test("Reword stamps, clears, logs, and never advances", async () => {
  clearNotices();
  openedModals.length = 0;
  const editor = makeEditor(["# Tasks", "", ROTTEN_AT_LIMIT].join("\n"), 2);
  const entry = rottenEntry({ line: 3, originalMarkdown: ROTTEN_AT_LIMIT });
  const plugin = makePlugin({
    filePath: "a.md",
    editor,
    freshness: freshnessCapable([entry], BASE_COUNTS),
    dateText: DATE,
  });
  await plugin.refreshTaskFreshness(editor, {
    dateText: DATE,
    advance: true,
  });
  const cardCtx = plugin.openedCards[0];
  const ok = await plugin.applyFreshnessDecayCardChoice(cardCtx, "reword");
  assert.equal(ok, true);
  assert.doesNotMatch(editor.state.lines[2], /keeps::/);
  assert.match(editor.state.lines[2], /\[fresh:: 2026-10-20\]/);
  const after = editor.state.lines.join("\n");
  assert.match(after, /🎲 reword · kept 3×/);
  const placed = editor.state.cursorSet[editor.state.cursorSet.length - 1];
  const expectedCh = helpers.freshnessDecayRewordCursorCh(editor.state.lines[2]);
  assert.equal(placed.line, 2);
  assert.equal(placed.ch, expectedCh);
  assert.equal(plugin.jumpCalls, 0);
});

// --- 7. Drop goes through the cancel writer with the kept reason ---

test("Drop cancels with the dropped-after-keeps reason and keeps history", async () => {
  clearNotices();
  const editor = makeEditor(["# Tasks", "", ROTTEN_AT_LIMIT].join("\n"), 2);
  const entry = rottenEntry({ line: 3, originalMarkdown: ROTTEN_AT_LIMIT });
  const plugin = makePlugin({
    filePath: "a.md",
    editor,
    freshness: freshnessCapable([entry], BASE_COUNTS),
    dateText: DATE,
  });
  await plugin.refreshTaskFreshness(editor, { dateText: DATE });
  const cardCtx = plugin.openedCards[0];
  assert.match(cardCtx.plan.drop.reason, /dropped after 3 keeps/);
  const seen = [];
  plugin.applyTaskCancelFromPicker = async (picker, options) => {
    seen.push({ picker: { ...picker, editor: undefined }, reason: options.reason });
    return true;
  };
  const ok = await plugin.applyFreshnessDecayCardChoice(cardCtx, "drop");
  assert.equal(ok, true);
  assert.equal(seen.length, 1);
  assert.match(seen[0].reason, /🍂 dropped after 3 keeps/);
});

// --- 8. Less often at 90+ opens the picker; dismiss writes nothing ---

test("Less often at 90+ opens the picker and dismiss writes nothing", async () => {
  clearNotices();
  const line90 = "- [ ] #task Long lease [fresh:: 2026-09-01] [refresh:: 90] [keeps:: 3]";
  const editor = makeEditor(["# Tasks", "", line90].join("\n"), 2);
  const entry = rottenEntry({
    line: 3,
    originalMarkdown: line90,
    keeps: 3,
    decide: true,
    interval: 90,
  });
  const plugin = makePlugin({
    filePath: "a.md",
    editor,
    freshness: freshnessCapable([entry], BASE_COUNTS),
    dateText: DATE,
  });
  await plugin.refreshTaskFreshness(editor, { dateText: DATE });
  const cardCtx = plugin.openedCards[0];
  assert.equal(cardCtx.plan.lessOften.mode, "picker");
  let pickerOpened = 0;
  plugin.openFreshnessDecayLessOftenPicker = () => {
    pickerOpened += 1;
    return true;
  };
  const before = editor.state.lines.join("\n");
  const ok = await plugin.applyFreshnessDecayCardChoice(cardCtx, "lessOften");
  assert.equal(ok, true);
  assert.equal(pickerOpened, 1);
  assert.equal(editor.state.lines.join("\n"), before);
  assert.equal(plugin.jumpCalls, 0);
});

// --- 9. counted session skips at-limit, counts below-limit ---

test("counted session skips at-limit and counts below-limit", async () => {
  clearNotices();
  const atLimit = ROTTEN_AT_LIMIT;
  const below = "- [ ] #task Walk dog [fresh:: 2026-09-29] [keeps:: 1]";
  const content = [atLimit, below].join("\n");
  const editor = makeEditor(content, 0);
  const plugin = makePlugin({
    filePath: "a.md",
    editor,
    freshness: freshnessCapable(
      [
        rottenEntry({ key: "a.md:1", line: 1, originalMarkdown: atLimit, keeps: 3, decide: true }),
        rottenEntry({ key: "a.md:2", line: 2, originalMarkdown: below, keeps: 1, decide: false, rank: 2, tierRank: 2, tierTotal: 2 }),
      ],
      BASE_COUNTS,
    ),
    dateText: DATE,
  });
  const ok = await plugin.refreshTaskFreshness(editor, {
    dateText: DATE,
    countExplicit: true,
    additionalTaskCount: 1,
  });
  assert.equal(ok, true);
  assert.equal(editor.state.lines[0], atLimit);
  assert.match(editor.state.lines[1], /\[keeps:: 2\]/);
  assert.match(notices[notices.length - 1], /1 needs a decision/);
});

test("counted session skips at-limit on an early date", async () => {
  clearNotices();
  const atLimit = ROTTEN_AT_LIMIT;
  const below = "- [ ] #task Walk dog [fresh:: 2026-09-29] [keeps:: 1]";
  const content = [atLimit, below].join("\n");
  const editor = makeEditor(content, 0);
  const plugin = makePlugin({
    filePath: "a.md",
    editor,
    freshness: freshnessCapable(
      [
        rottenEntry({ key: "a.md:1", line: 1, originalMarkdown: atLimit, keeps: 3, decide: true }),
        rottenEntry({ key: "a.md:2", line: 2, originalMarkdown: below, keeps: 1, decide: false, rank: 2, tierRank: 2, tierTotal: 2 }),
      ],
      BASE_COUNTS,
    ),
    dateText: BEFORE,
  });
  const ok = await plugin.refreshTaskFreshness(editor, {
    dateText: BEFORE,
    countExplicit: true,
    additionalTaskCount: 1,
  });
  assert.equal(ok, true);
  assert.equal(editor.state.lines[0], atLimit);
  assert.match(editor.state.lines[1], /\[keeps:: 2\]/);
  assert.match(editor.state.lines[1], /\[fresh:: 2026-10-18\]/);
  assert.match(notices[notices.length - 1], /1 needs a decision/);
});

test("counted session with every target skipped writes nothing", async () => {
  clearNotices();
  const content = [ROTTEN_AT_LIMIT, ROTTEN_AT_LIMIT].join("\n");
  const editor = makeEditor(content, 0);
  const plugin = makePlugin({
    filePath: "a.md",
    editor,
    freshness: freshnessCapable(
      [
        rottenEntry({ key: "a.md:1", line: 1, originalMarkdown: ROTTEN_AT_LIMIT, decide: true }),
        rottenEntry({ key: "a.md:2", line: 2, originalMarkdown: ROTTEN_AT_LIMIT, decide: true, rank: 2 }),
      ],
      BASE_COUNTS,
    ),
    dateText: DATE,
  });
  const ok = await plugin.refreshTaskFreshness(editor, {
    dateText: DATE,
    countExplicit: true,
    additionalTaskCount: 1,
  });
  assert.equal(ok, true);
  assert.equal(editor.state.lines.join("\n"), content);
  assert.match(notices[notices.length - 1], /need a decision/);
});
