// Card Keep stage tests: the decay card's Keep swaps the row list for the
// in-card keep-reason stage and commits stamp, increment, and one Rotten Log
// entry in a single editor transaction. Uses the DOM modal harness because
// the stage owns rendered input, focus, and key routing.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");
const harness = require("./modal-harness.cjs");
const { ModalStub, defer, pressKey } = harness;

global.window = { setTimeout: defer };

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

const modals = [];
class TestModal extends ModalStub {
  constructor(app) {
    super(app);
    modals.push(this);
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
    undoStack: [],
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
      state.undoStack.push(state.lines.slice());
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
    undo: () => {
      const previous = state.undoStack.pop();
      if (previous) {
        state.lines = previous;
      }
    },
    replaceRange: (text, from, to) => {
      state.undoStack.push(state.lines.slice());
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

function text(el) {
  if (!el) {
    return "";
  }
  return [el.textContent, ...el.children.map(text)].join(" ");
}

async function openCardAtLimit({ content, advance = false, entryOverrides = {} } = {}) {
  clearNotices();
  modals.length = 0;
  const body = content || ["# Tasks", "", ROTTEN_AT_LIMIT].join("\n");
  const editor = makeEditor(body, 2);
  const taskLine = String(body).split("\n")[2];
  const entry = rottenEntry({
    line: 3,
    originalMarkdown: taskLine,
    ...entryOverrides,
  });
  const plugin = makePlugin({
    filePath: "a.md",
    editor,
    freshness: freshnessCapable([entry], BASE_COUNTS),
    dateText: DATE,
  });
  const ok = await plugin.refreshTaskFreshness(editor, {
    dateText: DATE,
    advance,
  });
  assert.equal(ok, true);
  assert.equal(modals.length, 1);
  const modal = modals[0];
  assert.equal(modal.isOpen, true);
  return { editor, plugin, entry, modal, before: body };
}

function pressAltF(modal) {
  return pressKey(modal, "f", { code: "KeyF", altKey: true });
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

// --- Opening and Esc write nothing ---

test("opening the card writes nothing and shows the Keep row detail", async () => {
  const { editor, modal, before } = await openCardAtLimit();
  assert.equal(editor.getValue(), before);
  assert.equal(editor.state.transactions.length, 0);
  assert.equal(modal.keepStageActive, false);
  assert.match(text(modal.contentEl), /say why · logs 🥀 · asks again next review/);
});

test("Esc on the rows closes the card and writes nothing", async () => {
  const { editor, plugin, modal, before } = await openCardAtLimit();
  pressKey(modal, "Escape");
  assert.equal(modal.isOpen, false);
  assert.equal(editor.getValue(), before);
  assert.equal(editor.state.transactions.length, 0);
  assert.equal(plugin.jumpCalls, 0);
});

// --- Keep stage: enter without flash, Esc returns, second Esc writes nothing ---

test("Keep swaps the rows for the reason stage without closing", async () => {
  const { editor, modal, before } = await openCardAtLimit();
  pressAltF(modal);
  assert.equal(modal.isOpen, true);
  assert.equal(modals.length, 1);
  assert.equal(modal.keepStageActive, true);
  assert.ok(modal.keepStage);
  assert.equal(harness.activeElement, modal.keepStage.inputEl);
  assert.equal(editor.getValue(), before);
  assert.equal(editor.state.transactions.length, 0);
  assert.match(text(modal.contentEl), /Keep as written\?/);
});

test("repeat Alt+F never enters or submits the stage", async () => {
  const { modal } = await openCardAtLimit();
  pressKey(modal, "f", { code: "KeyF", altKey: true, repeat: true });
  assert.equal(modal.keepStageActive, false);
  assert.equal(modal.isOpen, true);
  pressAltF(modal);
  assert.equal(modal.keepStageActive, true);
  pressKey(modal, "f", { code: "KeyF", altKey: true, repeat: true });
  assert.equal(modal.keepStageActive, true);
  assert.equal(modal.isOpen, true);
});

test("Esc in the stage returns to the rows; a second Esc writes nothing", async () => {
  const { editor, plugin, modal, before } = await openCardAtLimit();
  pressAltF(modal);
  assert.equal(modal.keepStageActive, true);
  pressKey(modal, "Escape");
  assert.equal(modal.keepStageActive, false);
  assert.equal(modal.isOpen, true);
  assert.equal(editor.getValue(), before);
  pressKey(modal, "Escape");
  assert.equal(modal.isOpen, false);
  assert.equal(editor.getValue(), before);
  assert.equal(editor.state.transactions.length, 0);
  assert.equal(plugin.jumpCalls, 0);
});

// --- Keep stage: Enter commits stamp, increment, and entry in one undo ---

test("Keep stage Enter logs the reason with one transaction; one undo restores", async () => {
  const { editor, modal, before } = await openCardAtLimit();
  pressAltF(modal);
  modal.keepStage.inputEl.value = "still needed";
  modal.keepStage.inputEl.listeners.input();
  assert.match(text(modal.contentEl), /still needed · kept 4×/);
  pressKey(modal, "Enter");
  await settle();
  assert.equal(modal.isOpen, false);
  assert.equal(editor.state.transactions.length, 1);
  const after = editor.getValue();
  assert.match(after.split("\n")[2], /\[keeps:: 4\]/);
  assert.match(after, /\*2026-10-20\* — still needed · kept 4×/);
  assert.equal(helpers.readRottenLog(after, 2).entries.length, 1);
  assert.match(notices.join("\n"), /Kept 4× · Rotten Log updated · next review asks/);
  editor.undo();
  assert.equal(editor.getValue(), before);
});

test("blank Keep stage Enter logs no reason given", async () => {
  const { editor, modal } = await openCardAtLimit();
  pressAltF(modal);
  assert.match(text(modal.contentEl), /🤷 no reason given · kept 4×/);
  pressKey(modal, "Enter");
  await settle();
  assert.equal(editor.state.transactions.length, 1);
  assert.match(editor.getValue(), /🤷 no reason given · kept 4×/);
});

test("a double Enter submits once", async () => {
  const { editor, modal } = await openCardAtLimit();
  pressAltF(modal);
  modal.keepStage.inputEl.value = "still needed";
  modal.keepStage.inputEl.listeners.input();
  pressKey(modal, "Enter");
  pressKey(modal, "Enter");
  await settle();
  assert.equal(editor.state.transactions.length, 1);
  assert.equal(helpers.readRottenLog(editor.getValue(), 2).entries.length, 1);
});

test("IME Enter never submits the stage", async () => {
  const { editor, modal, before } = await openCardAtLimit();
  pressAltF(modal);
  pressKey(modal, "Enter", { isComposing: true });
  assert.equal(modal.isOpen, true);
  assert.equal(modal.keepStageActive, true);
  assert.equal(editor.getValue(), before);
  assert.equal(editor.state.transactions.length, 0);
});

// --- Card header and ambiguous logs ---

test("the card header shows the logged count and last reason", async () => {
  const logged =
    "- [ ] #task Buy milk [fresh:: 2026-09-30] [keeps:: 2]\n" +
    "\t- 🥀 **ROTTEN LOG**\n" +
    "\t\t- *2026-10-16* — old reason · kept 2×";
  const { modal } = await openCardAtLimit({
    content: ["# Tasks", "", logged].join("\n"),
    entryOverrides: { keeps: 2 },
  });
  assert.match(
    text(modal.contentEl),
    /🥀 1 keep logged · last Oct 16 — old reason/,
  );
  const header = helpers.buildFreshnessDecayRottenHeaderLine(
    modal.rottenKeep.history,
  );
  assert.equal(header, "🥀 1 keep logged · last Oct 16 — old reason");
});

test("an unreadable log shows the header even with no countable entries", () => {
  assert.equal(
    helpers.buildFreshnessDecayRottenHeaderLine({ status: "unknown", entries: [] }),
    "🥀 log unreadable",
  );
  assert.equal(
    helpers.buildFreshnessDecayRottenHeaderLine({ status: "ambiguous", entries: [] }),
    "🥀 log unreadable",
  );
  assert.equal(
    helpers.buildFreshnessDecayRottenHeaderLine({ status: "missing", entries: [] }),
    "",
  );
});

test("the decay card Keep stage uses the reviews streak copy", () => {
  const base = {
    raw: ROTTEN_AT_LIMIT,
    entry: rottenEntry(),
    dateText: DATE,
    keepsBefore: 3,
    keepsAfter: 4,
    history: { status: "missing", entries: [] },
  };
  const card = helpers.buildRottenKeepPromptModel({ ...base, decayCard: true });
  assert.equal(
    card.subtitleLines[1],
    "Kept 3 reviews in a row · this keep makes 4 · none logged yet",
  );
  const modal = helpers.buildRottenKeepPromptModel(base);
  assert.equal(modal.subtitleLines[1], "kept 3 in a row · none logged yet");
});

test("ambiguous Rotten Logs refuse the Keep write", async () => {
  clearNotices();
  modals.length = 0;
  const ambiguous =
    "- [ ] #task Buy milk [fresh:: 2026-09-30] [keeps:: 3]\n" +
    "\t- 🥀 **ROTTEN LOG**\n" +
    "\t\t- *2026-10-19* — first · kept 3×\n" +
    "\t- 🥀 **ROTTEN LOG**\n" +
    "\t\t- *2026-10-18* — second · kept 2×";
  const editor = makeEditor(["# Tasks", "", ambiguous].join("\n"), 2);
  const entry = rottenEntry({
    line: 3,
    originalMarkdown: ROTTEN_AT_LIMIT,
    keeps: 3,
  });
  const plugin = makePlugin({
    filePath: "a.md",
    editor,
    freshness: freshnessCapable([entry], BASE_COUNTS),
    dateText: DATE,
  });
  const opened = await plugin.refreshTaskFreshness(editor, { dateText: DATE });
  assert.equal(opened, true);
  assert.equal(plugin.openedCards.length, 1);
  const cardCtx = plugin.openedCards[0];
  const before = editor.getValue();
  const ok = await plugin.applyFreshnessDecayCardChoice(cardCtx, "keep", {
    reason: "still needed",
  });
  assert.equal(ok, false);
  assert.equal(editor.getValue(), before);
  assert.match(notices.join("\n"), /Multiple Rotten Logs found/);
});
