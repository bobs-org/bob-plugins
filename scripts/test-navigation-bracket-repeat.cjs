// Bracket repeat remembers the last command family and repeats in key-owned direction.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const notices = [];
global.Notice = class {
  constructor(message) {
    notices.push(String(message));
    this.message = message;
  }
};
global.window = global.window || { setTimeout: (callback) => callback() };

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
  if (request === "@codemirror/state") {
    return { Prec: { highest: (value) => value } };
  }
  if (request === "@codemirror/view") {
    class TestEditorView {}
    TestEditorView.updateListener = { of: (listener) => ({ listener }) };
    return { EditorView: TestEditorView, keymap: { of: (value) => value } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const NavigationHotkeysPlugin = require("../plugins/bob-navigation-hotkeys/main.js");
const { helpers } = NavigationHotkeysPlugin;
Module._load = originalLoad;

const {
  normalizeBracketRepeatType,
  planBracketRepeat,
  BRACKET_REPEAT_STORAGE_KEY,
  BRACKET_REPEAT_EMPTY_NOTICE,
} = helpers;

function createLoadedPlugin({ storage = new Map() } = {}) {
  const plugin = new NavigationHotkeysPlugin();
  const commands = [];
  plugin.app = {
    workspace: {
      getActiveFile: () => null,
      on: () => ({}),
      onLayoutReady: () => {},
    },
    loadLocalStorage: (key) => storage.get(key),
    saveLocalStorage: (key, value) => storage.set(key, value),
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
  return { plugin, commands, storage };
}

function makeBarePlugin({ storage = new Map(), load, save } = {}) {
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  plugin.bracketRepeatType = undefined;
  plugin.app = {
    loadLocalStorage: load || ((key) => storage.get(key)),
    saveLocalStorage: save || ((key, value) => storage.set(key, value)),
  };
  return { plugin, storage };
}

function command(commands, id) {
  const found = commands.find((item) => item.id === id);
  assert.ok(found, `missing command ${id}`);
  return found;
}

test("pure helpers accept only s, w, and n and return frozen direction plans", () => {
  for (const type of ["s", "w", "n"]) {
    assert.equal(normalizeBracketRepeatType(type), type);
  }
  for (const value of ["S", "W", "", "x", null, 1, undefined]) {
    assert.equal(normalizeBracketRepeatType(value), null);
  }

  const rows = [
    ["s", 1, "jumpToDueTask", [1]],
    ["s", -1, "jumpToDueTask", [-1]],
    ["w", 1, "jumpToLaneTask", [1]],
    ["w", -1, "jumpToLaneTask", [-1]],
    ["n", 1, "openLabeledBodyLink", ["next"]],
    ["n", -1, "openLabeledBodyLink", ["prev"]],
  ];
  for (const [type, direction, method, args] of rows) {
    const plan = planBracketRepeat(type, direction);
    assert.deepEqual(plan, { method, args });
    assert.ok(Object.isFrozen(plan));
    assert.ok(Object.isFrozen(plan.args));
  }
  assert.equal(planBracketRepeat("unknown", 1), null);
});

test("registration adds repeat commands and keeps all bracket family commands", () => {
  const { plugin, commands } = createLoadedPlugin();
  assert.equal(plugin.bracketRepeatType, undefined);
  const ids = new Set(commands.map((item) => item.id));
  for (const id of [
    "open-next-link",
    "open-prev-link",
    "jump-to-next-due-task",
    "jump-to-prev-due-task",
    "jump-to-first-due-task",
    "jump-to-last-due-task",
    "jump-to-next-lane-task",
    "jump-to-prev-lane-task",
    "jump-to-next-lane",
    "jump-to-prev-lane",
  ]) {
    assert.ok(ids.has(id), `missing family command ${id}`);
  }

  const next = command(commands, "repeat-next-bracket-walk");
  const prev = command(commands, "repeat-prev-bracket-walk");
  assert.equal(next.name, "Repeat last bracket walk forward (]s, ]w, or ]n)");
  assert.equal(prev.name, "Repeat last bracket walk backward ([s, [w, or [n)");
  assert.equal(Object.hasOwn(next, "hotkeys"), false);
  assert.equal(Object.hasOwn(prev, "hotkeys"), false);
});

test("each family callback records its family and preserves its original arguments", () => {
  const saves = [];
  const { plugin, commands } = createLoadedPlugin();
  plugin.app.saveLocalStorage = (key, value) => saves.push([key, value]);
  const sentinel = {};
  const rows = [
    ["open-next-link", "n", "openLabeledBodyLink", ["next"]],
    ["open-prev-link", "n", "openLabeledBodyLink", ["prev"]],
    ["jump-to-next-due-task", "s", "jumpToDueTask", [1]],
    ["jump-to-prev-due-task", "s", "jumpToDueTask", [-1]],
    ["jump-to-first-due-task", "s", "jumpToDueTask", [-1, { groupJump: true }]],
    ["jump-to-last-due-task", "s", "jumpToDueTask", [1, { groupJump: true }]],
    ["jump-to-next-lane-task", "w", "jumpToLaneTask", [1]],
    ["jump-to-prev-lane-task", "w", "jumpToLaneTask", [-1]],
    ["jump-to-next-lane", "w", "jumpToLaneTask", [1, { laneJump: true }]],
    ["jump-to-prev-lane", "w", "jumpToLaneTask", [-1, { laneJump: true }]],
  ];
  for (const [id, type, method, args] of rows) {
    const calls = [];
    plugin[method] = (...actual) => {
      calls.push(actual);
      return sentinel;
    };
    assert.strictEqual(command(commands, id).callback(), sentinel);
    assert.deepEqual(calls, [args]);
    assert.equal(plugin.bracketRepeatType, type);
  }
  assert.deepEqual(saves, [
    [BRACKET_REPEAT_STORAGE_KEY, "n"],
    [BRACKET_REPEAT_STORAGE_KEY, "s"],
    [BRACKET_REPEAT_STORAGE_KEY, "w"],
  ]);
});

test("repeat delegates every type in both directions with key-owned direction", () => {
  for (const [type, rows] of [
    ["s", [[1, "jumpToDueTask", [1]], [-1, "jumpToDueTask", [-1]]]],
    ["w", [[1, "jumpToLaneTask", [1]], [-1, "jumpToLaneTask", [-1]]]],
    ["n", [[1, "openLabeledBodyLink", ["next"]], [-1, "openLabeledBodyLink", ["prev"]]]],
  ]) {
    for (const [direction, method, expectedArgs] of rows) {
      const { plugin } = makeBarePlugin();
      const actual = [];
      const result = {};
      plugin.rememberBracketRepeatType(type);
      plugin[method] = (...args) => {
        actual.push(args);
        return result;
      };
      assert.strictEqual(plugin.repeatBracketWalk(direction), result);
      assert.deepEqual(actual, [expectedArgs]);
    }
  }
});

test("a review direction key followed by ]] repeats forward; the last family wins", () => {
  const { plugin, commands, storage } = createLoadedPlugin();
  const writes = [];
  plugin.app.saveLocalStorage = (key, value) => {
    writes.push([key, value]);
    storage.set(key, value);
  };
  plugin.jumpToDueTask = () => true;
  command(commands, "jump-to-prev-due-task").callback();
  const dueCalls = [];
  plugin.jumpToDueTask = (...args) => dueCalls.push(args);
  command(commands, "repeat-next-bracket-walk").callback();
  assert.deepEqual(dueCalls, [[1]]);

  command(commands, "jump-to-next-due-task").callback();
  command(commands, "jump-to-next-lane-task").callback();
  const laneCalls = [];
  plugin.jumpToLaneTask = (...args) => laneCalls.push(args);
  const saveCount = writes.length;
  command(commands, "repeat-next-bracket-walk").callback();
  command(commands, "repeat-next-bracket-walk").callback();
  assert.deepEqual(laneCalls, [[1], [1]]);
  assert.equal(plugin.bracketRepeatType, "w");
  assert.equal(storage.get(BRACKET_REPEAT_STORAGE_KEY), "w");
  assert.equal(writes.length, saveCount);
});

test("cold start and invalid stored values show the empty notice without moving", () => {
  for (const stored of [undefined, "garbage"]) {
    notices.length = 0;
    const storage = new Map();
    if (stored !== undefined) {
      storage.set(BRACKET_REPEAT_STORAGE_KEY, stored);
    }
    const { plugin } = makeBarePlugin({ storage });
    let moved = false;
    plugin.jumpToDueTask = () => {
      moved = true;
    };
    assert.equal(plugin.repeatBracketWalk(1), false);
    assert.equal(moved, false);
    assert.deepEqual(notices, [BRACKET_REPEAT_EMPTY_NOTICE]);
  }
});

test("a fresh instance lazily restores its stored type", () => {
  const storage = new Map([[BRACKET_REPEAT_STORAGE_KEY, "w"]]);
  const { plugin } = makeBarePlugin({ storage });
  const calls = [];
  plugin.jumpToLaneTask = (...args) => calls.push(args);
  plugin.repeatBracketWalk(1);
  assert.equal(plugin.bracketRepeatType, "w");
  assert.deepEqual(calls, [[1]]);
});

test("missing or throwing local storage keeps repeat state in memory", () => {
  const missing = Object.create(NavigationHotkeysPlugin.prototype);
  missing.app = {};
  missing.bracketRepeatType = undefined;
  missing.rememberBracketRepeatType("s");
  const missingCalls = [];
  missing.jumpToDueTask = (...args) => missingCalls.push(args);
  missing.repeatBracketWalk(1);
  assert.deepEqual(missingCalls, [[1]]);

  const throwing = Object.create(NavigationHotkeysPlugin.prototype);
  throwing.app = {
    loadLocalStorage() {
      throw new Error("unavailable");
    },
    saveLocalStorage() {
      throw new Error("unavailable");
    },
  };
  throwing.bracketRepeatType = undefined;
  throwing.rememberBracketRepeatType("w");
  const throwingCalls = [];
  throwing.jumpToLaneTask = (...args) => throwingCalls.push(args);
  throwing.repeatBracketWalk(-1);
  assert.deepEqual(throwingCalls, [[-1]]);

  const loadThrowing = Object.create(NavigationHotkeysPlugin.prototype);
  loadThrowing.app = {
    loadLocalStorage() {
      throw new Error("unavailable");
    },
  };
  loadThrowing.bracketRepeatType = undefined;
  assert.equal(loadThrowing.repeatBracketWalk(1), false);
});

function laneEntry(line, text) {
  const originalMarkdown = `- [ ] #task ${text}`;
  return {
    key: `walk.md:${line}`,
    path: "walk.md",
    line,
    lineNumber: line - 1,
    originalMarkdown,
    text,
    blockId: null,
    lane: "pending",
    laneLabel: "PENDING",
    created: null,
    rank: line,
    total: 3,
    laneRank: line,
    laneTotal: 3,
  };
}

test("repeat delegates synchronously so the real lane walk consumes Vim count before landing", async () => {
  const entries = [laneEntry(1, "one"), laneEntry(2, "two"), laneEntry(3, "three")];
  const queue = {
    available: true,
    entries,
    counts: { pending: 3, next: 0, ready: 0, total: 3, todayPending: 0, todayNext: 0, todayReady: 0, reviewReady: 0 },
  };
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  const order = [];
  const landings = [];
  plugin.app = {
    plugins: { plugins: { "bob-ledger-tools": { api: { laneWalk: { version: 2, queue: () => queue } } } } },
    loadLocalStorage: () => "w",
    vault: { getAbstractFileByPath: () => null },
  };
  plugin.bracketRepeatType = undefined;
  plugin.laneWalkAnchor = null;
  plugin.laneWalkChain = Promise.resolve();
  plugin.reviewWalkBusy = () => false;
  plugin.consumePendingLaneWalkRepeat = () => {
    order.push("count");
    return 2;
  };
  plugin.getReviewJumpCursor = () => ({
    path: entries[0].path,
    line: entries[0].line,
    text: entries[0].originalMarkdown,
  });
  plugin.getReviewWalkOriginCursor = () => null;
  plugin.laneReleaseDateText = () => "2026-10-28";
  plugin.getActiveMarkdownView = () => null;
  plugin.landOnWalkEntry = async (entry) => {
    order.push("land");
    landings.push(entry.key);
    return { ok: true, stale: false, settled: Promise.resolve(true) };
  };
  plugin.readLinkPickerNoteContent = async () => null;
  plugin.showLaneWalkNotice = () => {};

  const pending = plugin.repeatBracketWalk(1);
  assert.equal(typeof pending.then, "function");
  assert.deepEqual(order, ["count"]);
  await pending;
  assert.deepEqual(landings, [entries[2].key]);
  assert.deepEqual(order, ["count", "land"]);
});

test("other navigation, internal advances, and blank-line commands do not record", () => {
  const saves = [];
  const { plugin, commands } = createLoadedPlugin();
  plugin.app.saveLocalStorage = (key, value) => saves.push([key, value]);
  plugin.rememberBracketRepeatType("w");
  const initialSaves = saves.length;
  plugin.refreshTaskFreshness = () => true;
  plugin.jumpToOpenObsidianTask = () => true;
  plugin.jumpToDueTask = () => true;
  plugin.insertBlankLine = () => true;

  command(commands, "refresh-task-freshness-and-advance").editorCallback({});
  command(commands, "jump-to-next-open-task").editorCallback({});
  plugin.jumpToDueTask(1, { fromAdvance: true });
  command(commands, "insert-blank-line-above").editorCallback({});
  command(commands, "insert-blank-line-below").editorCallback({});

  assert.equal(plugin.bracketRepeatType, "w");
  assert.equal(saves.length, initialSaves);
});
