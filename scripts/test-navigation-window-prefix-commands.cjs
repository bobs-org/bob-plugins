const test = require("node:test");
const assert = require("node:assert/strict");
const { NavigationHotkeysPlugin, helpers, notices } = require("./navigation-hotkeys-harness.cjs");

const { WINDOW_PREFIX_PALETTE_COMMANDS, WINDOW_PREFIX_TAB_JUMP_COMMANDS } = helpers;

function fakeHost() {
  const calls = [];
  return {
    calls,
    showArmed: (...args) => calls.push(["showArmed", args[0], args[1], args[2]]),
    showCard: (...args) => calls.push(["showCard", args[0]]),
    nudge: (...args) => calls.push(["nudge", ...args]),
    bump: (...args) => calls.push(["bump", ...args]),
    pulse: (...args) => calls.push(["pulse", args[0]]),
    receipt: (...args) => calls.push(["receipt", ...args]),
    message: (...args) => calls.push(["message", ...args]),
    hide: () => calls.push(["hide"]),
    destroy: () => calls.push(["destroy"]),
  };
}

function installClock(plugin) {
  const timers = new Map();
  let nextId = 1;
  let now = 0;
  plugin.windowPrefixSetTimeout = (callback, delay) => {
    const id = nextId++;
    timers.set(id, { callback, due: now + Number(delay || 0) });
    return id;
  };
  plugin.windowPrefixClearTimeout = (id) => { timers.delete(id); };
  plugin.advanceWindowPrefixClock = (ms) => {
    now += ms;
    for (const [id, timer] of [...timers]) {
      if (timer.due <= now) {
        timers.delete(id);
        timer.callback();
      }
    }
  };
}

function fakeBody() {
  const classes = new Set();
  return {
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
    },
    classes,
  };
}

function twoSplitSnapshot() {
  return {
    activeLeafId: "b",
    splits: [
      {
        id: "left",
        rect: { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 },
        leaves: [{ id: "a", label: "WP-A" }, { id: "b", label: "WP-B" }],
        selectedLeafId: "b",
      },
      {
        id: "right",
        rect: { left: 100, top: 0, right: 200, bottom: 100, width: 100, height: 100 },
        leaves: [{ id: "c", label: "WP-C" }],
        selectedLeafId: "c",
      },
    ],
  };
}

function oneSplitSnapshot() {
  return {
    activeLeafId: "a",
    splits: [
      {
        id: "only",
        rect: { left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100 },
        leaves: [{ id: "a", label: "WP-A" }],
        selectedLeafId: "a",
      },
    ],
  };
}

function pluginFor(options = {}) {
  const host = options.host || fakeHost();
  const body = options.body || fakeBody();
  const commands = [];
  const listeners = {};
  const tabs = options.tabs || [];
  const leftGroup = { containerEl: { classList: { add() {}, remove() {} } } };
  const rightGroup = { containerEl: { classList: { add() {}, remove() {} } } };
  const workspace = {
    activeLeaf: { id: "leaf", containerEl: { contains: () => true } },
    rootSplit: {},
    containerEl: {
      ownerDocument: null,
      querySelectorAll: () => tabs,
    },
    on(event, handler) {
      listeners[event] = listeners[event] || [];
      listeners[event].push(handler);
      return { event, handler };
    },
    off() {},
  };
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  plugin.app = {
    workspace,
    keymap: {
      scopes: [],
      pushScope(scope) { this.scopes.push(scope); },
      popScope(scope) {
        const index = this.scopes.lastIndexOf(scope);
        if (index >= 0) this.scopes.splice(index, 1);
      },
    },
    scope: { constructor: function FakeScope() { this.register = () => this; } },
  };
  plugin.addCommand = (command) => { commands.push(command); return command; };
  plugin.register = (fn) => { plugin.cleanups = plugin.cleanups || []; plugin.cleanups.push(fn); };
  plugin.registerEvent = () => {};
  plugin.windowPrefixHintHost = host;
  plugin.windowPrefixDocument = {
    hidden: false,
    body,
    querySelector: () => null,
    addEventListener() {},
    removeEventListener() {},
  };
  plugin.windowPrefixWindow = { addEventListener() {}, removeEventListener() {} };
  plugin.windowPrefixSplitById = new Map([
    ["left", leftGroup],
    ["right", rightGroup],
  ]);
  plugin.snapshotWindowPrefixLayout = options.snapshot || (() => twoSplitSnapshot());
  plugin.executeWindowPrefixPlan = options.execute ||
    (async (plan) => ({ ok: true, action: plan.action, plan }));
  plugin.windowTabNumbersLitCalls = [];
  plugin.windowTabFlashes = [];
  plugin.setWindowTabNumbersLit = (on) => {
    plugin.windowTabNumbersLitCalls.push(on === true);
    plugin.windowTabNumbersLit = on === true;
  };
  plugin.flashWindowTabNumber = (id) => {
    plugin.windowTabFlashes.push(id);
    return true;
  };
  plugin.refreshWindowTabNumbersNow = () => ({ ok: true, shown: true });
  installClock(plugin);
  plugin.registerWindowPrefixInputListeners();
  notices.length = 0;
  return { plugin, host, body, commands, listeners, workspace };
}

test("palette command table covers every verb with no default hotkeys", () => {
  assert.ok(Array.isArray(WINDOW_PREFIX_PALETTE_COMMANDS));
  const ids = WINDOW_PREFIX_PALETTE_COMMANDS.map((command) => command.id);
  assert.deepEqual(ids, [
    "window-focus-left",
    "window-focus-right",
    "window-focus-next",
    "window-move-tab-left",
    "window-move-tab-right",
  ]);
  for (const command of WINDOW_PREFIX_PALETTE_COMMANDS) {
    assert.ok(command.name && command.key);
    assert.equal(command.hotkeys, undefined);
  }
  const keys = WINDOW_PREFIX_PALETTE_COMMANDS.map((command) => command.key);
  assert.deepEqual(keys, ["h", "l", "w", "H", "L"]);
});

test("registerWindowPrefixCommands registers window and jump-tab palette commands and gates the underline", () => {
  const { plugin, body, commands } = pluginFor();
  plugin.registerWindowPrefixCommands();
  const ids = commands.map((command) => command.id);
  assert.deepEqual(ids, [
    "window-focus-left",
    "window-focus-right",
    "window-focus-next",
    "window-move-tab-left",
    "window-move-tab-right",
    "window-jump-tab-1",
    "window-jump-tab-2",
    "window-jump-tab-3",
    "window-jump-tab-4",
    "window-jump-tab-5",
    "window-jump-tab-6",
    "window-jump-tab-7",
    "window-jump-tab-8",
    "window-jump-tab-9",
    "window-keys",
  ]);
  for (const command of commands) {
    assert.equal(command.hotkeys, undefined);
  }
  assert.equal(body.classList.contains("bob-wp-multi-split"), true);
});

test("a successful palette focus pulses without a receipt", async () => {
  const { plugin, host } = pluginFor();
  plugin.registerWindowPrefixCommands();
  const callsBefore = host.calls.length;
  const ok = await plugin.runWindowPrefixPaletteKey("l");
  assert.equal(ok, true);
  const kinds = host.calls.slice(callsBefore).map((call) => call[0]);
  assert.ok(kinds.includes("showArmed"));
  assert.ok(kinds.includes("pulse"));
  assert.ok(!kinds.includes("receipt"));
  assert.equal(notices.length, 0);
});

test("a successful palette move shows a receipt naming the tab", async () => {
  const { plugin, host } = pluginFor();
  plugin.registerWindowPrefixCommands();
  const ok = await plugin.runWindowPrefixPaletteKey("L");
  assert.equal(ok, true);
  const receipts = host.calls.filter((call) => call[0] === "receipt");
  assert.equal(receipts.length, 1);
  assert.match(receipts[0][1], /WP-B/);
  assert.equal(notices.length, 0);
});

test("a blocked palette key shows a Notice and never executes", async () => {
  let executed = 0;
  const { plugin } = pluginFor({
    execute: async (plan) => { executed += 1; return { ok: true, action: plan.action, plan }; },
  });
  plugin.registerWindowPrefixCommands();
  const ok = await plugin.runWindowPrefixPaletteKey("h");
  assert.equal(ok, false);
  assert.equal(executed, 0);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /left edge/);
});

test("a palette key with no main-area tab shows a Notice", async () => {
  let executed = 0;
  const { plugin } = pluginFor({
    snapshot: () => null,
    execute: async (plan) => { executed += 1; return { ok: true, action: plan.action, plan }; },
  });
  plugin.registerWindowPrefixCommands();
  const ok = await plugin.runWindowPrefixPaletteKey("l");
  assert.equal(ok, false);
  assert.equal(executed, 0);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /main-area/);
});

test("window-keys opens the prefix with the card shown at once", () => {
  const { plugin, host } = pluginFor();
  plugin.registerWindowPrefixInputListeners();
  plugin.registerWindowPrefixCommands();
  const shown = plugin.openWindowPrefixFromPalette();
  assert.equal(shown, true);
  assert.ok(plugin.windowPrefixIsArmed());
  const cards = host.calls.filter((call) => call[0] === "showCard");
  assert.ok(cards.length >= 1);
  plugin.disarmWindowPrefix();
});

test("window-keys with no main-area tab refuses with a Notice", () => {
  const { plugin } = pluginFor({ snapshot: () => null });
  plugin.registerWindowPrefixCommands();
  const shown = plugin.openWindowPrefixFromPalette();
  assert.equal(shown, false);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /main-area/);
});

test("the underline gates on split count and clears on unload", () => {
  const { plugin, body } = pluginFor();
  plugin.registerWindowPrefixCommands();
  assert.equal(body.classList.contains("bob-wp-multi-split"), true);
  plugin.snapshotWindowPrefixLayout = () => oneSplitSnapshot();
  plugin.updateWindowPrefixUnderline();
  assert.equal(body.classList.contains("bob-wp-multi-split"), false);
  plugin.snapshotWindowPrefixLayout = () => twoSplitSnapshot();
  plugin.updateWindowPrefixUnderline();
  assert.equal(body.classList.contains("bob-wp-multi-split"), true);
  plugin.clearWindowPrefixUnderline();
  assert.equal(body.classList.contains("bob-wp-multi-split"), false);
});

test("nine jump-to-tab commands register with no hotkeys", () => {
  assert.ok(Array.isArray(WINDOW_PREFIX_TAB_JUMP_COMMANDS));
  assert.equal(WINDOW_PREFIX_TAB_JUMP_COMMANDS.length, 9);
  WINDOW_PREFIX_TAB_JUMP_COMMANDS.forEach((command, index) => {
    const n = index + 1;
    assert.equal(command.id, "window-jump-tab-" + n);
    assert.equal(command.name, "Jump to tab " + n);
    assert.equal(command.key, String(n));
    assert.equal(command.hotkeys, undefined);
  });
});

test("a blocked jump-tab command shows its copy-table reason as a Notice", async () => {
  let executed = 0;
  const { plugin } = pluginFor({
    execute: async (plan) => { executed += 1; return { ok: true, action: plan.action, plan }; },
  });
  plugin.registerWindowPrefixCommands();
  const ok = await plugin.runWindowPrefixPaletteKey("7");
  assert.equal(ok, false);
  assert.equal(executed, 0);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /No tab 7/);
});

test("a successful jump-tab command flashes and pulses", async () => {
  const { plugin, host } = pluginFor();
  plugin.registerWindowPrefixCommands();
  const ok = await plugin.runWindowPrefixPaletteKey("1");
  assert.equal(ok, true);
  assert.ok(host.calls.some((call) => call[0] === "pulse"));
  assert.deepEqual(plugin.windowTabFlashes, ["a"]);
  assert.equal(notices.length, 0);
});

test("Show window keys lights the numerals along with its card", () => {
  const { plugin, host } = pluginFor();
  plugin.registerWindowPrefixInputListeners();
  plugin.registerWindowPrefixCommands();
  const shown = plugin.openWindowPrefixFromPalette();
  assert.equal(shown, true);
  assert.ok(plugin.windowPrefixIsArmed());
  assert.ok(host.calls.some((call) => call[0] === "showCard"));
  assert.equal(plugin.windowTabNumbersLit, true);
  plugin.disarmWindowPrefix();
  assert.equal(plugin.windowTabNumbersLit, false);
});

test("layout-change refreshes the underline gate", () => {
  const { plugin, body, listeners } = pluginFor();
  plugin.registerWindowPrefixCommands();
  assert.equal(body.classList.contains("bob-wp-multi-split"), true);
  plugin.snapshotWindowPrefixLayout = () => oneSplitSnapshot();
  for (const handler of listeners["layout-change"] || []) handler();
  assert.equal(body.classList.contains("bob-wp-multi-split"), false);
});
