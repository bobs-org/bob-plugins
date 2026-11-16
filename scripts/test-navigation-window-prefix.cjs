const test = require("node:test");
const assert = require("node:assert/strict");
const { NavigationHotkeysPlugin, helpers } = require("./navigation-hotkeys-harness.cjs");

const {
  WINDOW_PREFIX_HINT_DELAY_MS,
  getWindowPrefixArmingVerdict,
  windowPrefixOverlayFlags,
  windowPrefixTargetIsEditable,
  windowPrefixMoveReceiptText,
  windowPrefixNormalizeVimMode,
} = helpers;

class FakeScope {
  constructor() {
    this.handler = null;
    this.registers = [];
  }
  register(modifiers, key, handler) {
    this.registers.push({ modifiers, key });
    this.handler = handler;
    return this;
  }
}

function fakeKeymap() {
  const scopes = [];
  return {
    scopes,
    pushScope(scope) { scopes.push(scope); },
    popScope(scope) {
      const index = scopes.lastIndexOf(scope);
      if (index >= 0) scopes.splice(index, 1);
      else scopes.pop();
    },
  };
}

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
  plugin.windowPrefixPendingTimers = () => timers.size;
}

function keyEvent(overrides = {}) {
  const event = {
    key: "w",
    code: "KeyW",
    ctrlKey: true,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    target: { tagName: "DIV", closest: () => null },
    view: global.window,
    preventDefault() { this.defaultPrevented = true; this.prevented = true; },
    stopPropagation() { this.stopped = true; },
    stopImmediatePropagation() { this.immediate = true; },
    ...overrides,
  };
  if (overrides.target) event.target = overrides.target;
  return event;
}

function snapshotTwoSplits() {
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

function pluginFor(options = {}) {
  const keymap = options.keymap || fakeKeymap();
  const host = options.host || fakeHost();
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  const workspace = options.workspace || {
    activeLeaf: { id: "b", containerEl: { contains: () => true } },
    rootSplit: { containerEl: { getBoundingClientRect: () => ({ left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100 }) } },
    containerEl: { ownerDocument: options.document || null },
    on() { return {}; },
    off() {},
  };
  plugin.app = {
    workspace,
    keymap,
    scope: { constructor: FakeScope },
  };
  plugin.register = (fn) => { plugin.cleanups = plugin.cleanups || []; plugin.cleanups.push(fn); };
  plugin.registerEvent = () => {};
  plugin.windowPrefixHintHost = host;
  plugin.windowPrefixDocument = options.document || {
    hidden: false,
    body: {},
    querySelector: () => null,
    addEventListener() {},
    removeEventListener() {},
  };
  plugin.windowPrefixWindow = options.window || {
    addEventListener() {},
    removeEventListener() {},
  };
  plugin.snapshotWindowPrefixLayout = options.snapshot || (() => snapshotTwoSplits());
  plugin.executeWindowPrefixPlan = options.execute || (async (plan) => ({ ok: true, action: plan.action, plan }));
  plugin.collectWindowPrefixArmingContext = options.context || ((event) => ({
    key: event.key,
    code: event.code,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    repeat: event.repeat,
    isComposing: event.isComposing,
    defaultPrevented: event.defaultPrevented,
    isMainWindow: true,
    activeLeafInRootSplit: true,
    isMarkdownEditor: true,
    vimMode: "normal",
    vimKeyBuffer: [],
    isEditable: true,
  }));
  installClock(plugin);
  plugin.registerWindowPrefixInputListeners();
  return { plugin, keymap, host };
}

function arm(plugin) {
  plugin.handleWindowPrefixCaptureKeydown(keyEvent());
}

test("WINDOW_PREFIX_HINT_DELAY_MS is 300", () => {
  assert.equal(WINDOW_PREFIX_HINT_DELAY_MS, 300);
});

test("null getCurrentVimMode with vim state is normal", () => {
  assert.equal(windowPrefixNormalizeVimMode(null, { insertMode: false }), "normal");
  assert.equal(windowPrefixNormalizeVimMode("visual-line", {}), "visual");
  assert.equal(windowPrefixNormalizeVimMode("insert", { insertMode: true }), "insert");
  assert.equal(windowPrefixNormalizeVimMode(null, null), null);
});

test("arming in each allowed context and passing through excluded ones", () => {
  const { plugin, keymap, host } = pluginFor();
  const allowed = [
    { isMarkdownEditor: true, vimMode: "normal", vimKeyBuffer: [] },
    { isMarkdownEditor: true, vimMode: "visual", vimKeyBuffer: "" },
    { isMarkdownEditor: false, isEditable: false },
  ];
  for (const extra of allowed) {
    plugin.disarmWindowPrefix({ silent: true });
    host.calls.length = 0;
    plugin.collectWindowPrefixArmingContext = (event) => ({
      key: event.key, code: event.code, ctrlKey: event.ctrlKey, isMainWindow: true,
      activeLeafInRootSplit: true, ...extra,
    });
    const event = keyEvent();
    plugin.handleWindowPrefixCaptureKeydown(event);
    assert.equal(plugin.windowPrefixState, "armed", extra.vimMode || "view");
    assert.equal(event.prevented, true);
    assert.equal(keymap.scopes.length, 1);
    assert.equal(host.calls[0][0], "showArmed");
  }

  const blocked = [
    { defaultPrevented: true, isEditable: false },
    { isMarkdownEditor: true, vimMode: "insert", vimKeyBuffer: [] },
    { isMarkdownEditor: true, vimMode: "normal", vimKeyBuffer: ["d"] },
    { isMarkdownEditor: false, isEditable: true },
    { isMarkdownEditor: false, isEditable: false, inModal: true },
    { isMarkdownEditor: false, isEditable: false, inBobCard: true },
    { isMarkdownEditor: false, isEditable: false, isMainWindow: false },
    { isMarkdownEditor: false, isEditable: false, activeLeafInRootSplit: false },
  ];
  for (const extra of blocked) {
    plugin.disarmWindowPrefix({ silent: true });
    host.calls.length = 0;
    plugin.collectWindowPrefixArmingContext = (event) => ({
      key: event.key, code: event.code, ctrlKey: event.ctrlKey === undefined ? true : event.ctrlKey,
      metaKey: event.metaKey, altKey: event.altKey, shiftKey: event.shiftKey,
      repeat: event.repeat, isComposing: event.isComposing,
      defaultPrevented: extra.defaultPrevented === true,
      isMainWindow: extra.isMainWindow !== false,
      activeLeafInRootSplit: extra.activeLeafInRootSplit !== false,
      isEditable: extra.isEditable,
      isMarkdownEditor: extra.isMarkdownEditor === true,
      vimMode: extra.vimMode,
      vimKeyBuffer: extra.vimKeyBuffer,
      inModal: extra.inModal,
      inBobCard: extra.inBobCard,
    });
    const event = keyEvent({ defaultPrevented: extra.defaultPrevented === true });
    plugin.handleWindowPrefixCaptureKeydown(event);
    assert.equal(plugin.windowPrefixState, "idle", JSON.stringify(extra));
    assert.equal(event.prevented, undefined);
  }
});

test("a defaultPrevented Ctrl+W (Linux Close tab) does not arm", () => {
  const { plugin } = pluginFor();
  const event = keyEvent({ defaultPrevented: true });
  plugin.collectWindowPrefixArmingContext = (evt) => ({
    key: evt.key, code: evt.code, ctrlKey: true, defaultPrevented: true,
    isMainWindow: true, activeLeafInRootSplit: true, isEditable: false,
  });
  plugin.handleWindowPrefixCaptureKeydown(event);
  assert.equal(plugin.windowPrefixState, "idle");
  assert.equal(getWindowPrefixArmingVerdict({
    key: "w", code: "KeyW", ctrlKey: true, defaultPrevented: true,
    isMainWindow: true, activeLeafInRootSplit: true, isEditable: false,
  }).reason, "default-prevented");
});

test("Shift-only keydowns do not cancel, and held-Ctrl suffixes map", () => {
  const { plugin, keymap } = pluginFor();
  arm(plugin);
  plugin.handleWindowPrefixCaptureKeydown(keyEvent({ key: "Shift", code: "ShiftLeft", ctrlKey: false }));
  assert.equal(plugin.windowPrefixState, "armed");
  assert.equal(keymap.scopes.length, 1);

  const executed = [];
  plugin.executeWindowPrefixPlan = async (plan) => {
    executed.push(plan.key);
    return { ok: true, action: plan.action, plan };
  };
  plugin.handleWindowPrefixCaptureKeydown(keyEvent({
    key: "l", code: "KeyL", ctrlKey: true, text: "",
  }));
  return plugin.windowPrefixQueue.then(() => {
    assert.deepEqual(executed, ["l"]);
  });
});

test("a second Ctrl+W cycles to the next split", () => {
  const { plugin } = pluginFor();
  const executed = [];
  plugin.executeWindowPrefixPlan = async (plan) => {
    executed.push(plan.key);
    return { ok: true, action: plan.action, plan };
  };
  arm(plugin);
  plugin.handleWindowPrefixCaptureKeydown(keyEvent({ key: "w", code: "KeyW", ctrlKey: true }));
  return plugin.windowPrefixQueue.then(() => {
    assert.deepEqual(executed, ["w"]);
  });
});

test("Meta and Alt chords cancel and pass through", () => {
  const { plugin, keymap } = pluginFor();
  arm(plugin);
  const save = keyEvent({ key: "s", code: "KeyS", ctrlKey: false, metaKey: true });
  const result = plugin.handleWindowPrefixCaptureKeydown(save);
  assert.equal(plugin.windowPrefixState, "idle");
  assert.equal(keymap.scopes.length, 0);
  assert.equal(save.prevented, undefined);
  assert.equal(result, true);

  arm(plugin);
  const alt = keyEvent({ key: "l", code: "KeyL", ctrlKey: false, altKey: true });
  plugin.handleWindowPrefixCaptureKeydown(alt);
  assert.equal(plugin.windowPrefixState, "idle");
  assert.equal(alt.prevented, undefined);
});

test("blocked keys stay armed and unmapped printable keys are consumed", () => {
  const { plugin, host, keymap } = pluginFor();
  plugin.snapshotWindowPrefixLayout = () => ({
    activeLeafId: "a",
    splits: [{
      id: "only",
      rect: { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 },
      leaves: [{ id: "a", label: "WP-A" }],
      selectedLeafId: "a",
    }],
  });
  arm(plugin);
  host.calls.length = 0;
  const h = keyEvent({ key: "h", code: "KeyH", ctrlKey: false });
  plugin.handleWindowPrefixCaptureKeydown(h);
  assert.equal(plugin.windowPrefixIsArmed(), true);
  assert.equal(keymap.scopes.length, 1);
  assert.equal(h.prevented, true);
  assert.ok(host.calls.some((call) => call[0] === "showCard"));
  assert.ok(host.calls.some((call) => call[0] === "nudge"));
  assert.ok(host.calls.some((call) => call[0] === "bump" && call[1] === "left"));

  host.calls.length = 0;
  const j = keyEvent({ key: "j", code: "KeyJ", ctrlKey: false });
  plugin.handleWindowPrefixCaptureKeydown(j);
  assert.equal(plugin.windowPrefixIsArmed(), true);
  assert.equal(j.prevented, true);
  assert.ok(host.calls.some((call) => call[0] === "message" && String(call[1]).includes("isn't a window key")));
});

test("the scope is popped on every exit path, including a thrown action", async () => {
  const { plugin, keymap } = pluginFor();
  arm(plugin);
  assert.equal(keymap.scopes.length, 1);
  plugin.handleWindowPrefixCaptureKeydown(keyEvent({ key: "Escape", code: "Escape", ctrlKey: false }));
  assert.equal(plugin.windowPrefixState, "idle");
  assert.equal(keymap.scopes.length, 0);

  arm(plugin);
  plugin.handleWindowPrefixCaptureKeydown(keyEvent({ key: "q", code: "KeyQ", ctrlKey: false }));
  assert.equal(keymap.scopes.length, 0);

  plugin.executeWindowPrefixPlan = async () => { throw new Error("boom"); };
  arm(plugin);
  plugin.handleWindowPrefixCaptureKeydown(keyEvent({ key: "l", code: "KeyL", ctrlKey: false }));
  await plugin.windowPrefixQueue;
  assert.equal(plugin.windowPrefixState, "idle");
  assert.equal(keymap.scopes.length, 0);
});

test("a stale source cancels with layout-changed", async () => {
  const { plugin, host } = pluginFor();
  plugin.executeWindowPrefixPlan = async () => ({ ok: false, reason: "layout-changed" });
  arm(plugin);
  host.calls.length = 0;
  plugin.handleWindowPrefixCaptureKeydown(keyEvent({ key: "l", code: "KeyL", ctrlKey: false }));
  await plugin.windowPrefixQueue;
  assert.equal(plugin.windowPrefixState, "idle");
  assert.ok(host.calls.some((call) => call[0] === "message" && /Layout changed/.test(call[1])));
});

test("actions are serialized through the prefix queue", async () => {
  const { plugin } = pluginFor();
  let current = 0;
  let max = 0;
  const order = [];
  const gates = [];
  plugin.executeWindowPrefixPlan = async (plan) => {
    current += 1;
    max = Math.max(max, current);
    order.push(plan.key);
    await new Promise((resolve) => { gates.push(resolve); });
    current -= 1;
    return { ok: true, action: plan.action, plan };
  };
  arm(plugin);
  plugin.handleWindowPrefixCaptureKeydown(keyEvent({ key: "l", code: "KeyL", ctrlKey: false }));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(plugin.windowPrefixState, "running");
  plugin.handleWindowPrefixCaptureKeydown(keyEvent({ key: "w", code: "KeyW", ctrlKey: true }));
  assert.equal(current, 1);
  assert.equal(gates.length, 1);
  gates[0]();
  await plugin.windowPrefixQueue;
  await plugin.windowPrefixQueue;
  assert.equal(max, 1);
  assert.ok(order.includes("l"));
});

test("no card is painted for a fluent sequence, and the card appears at 300 ms", () => {
  const { plugin, host } = pluginFor();
  arm(plugin);
  assert.equal(plugin.windowPrefixState, "armed");
  assert.ok(host.calls.some((call) => call[0] === "showArmed"));
  assert.equal(host.calls.some((call) => call[0] === "showCard"), false);
  plugin.advanceWindowPrefixClock(299);
  assert.equal(host.calls.some((call) => call[0] === "showCard"), false);
  plugin.advanceWindowPrefixClock(1);
  assert.ok(host.calls.some((call) => call[0] === "showCard"));
  assert.equal(plugin.windowPrefixState, "carded");
});

test("a fluent mapped key runs before the card delay fires", async () => {
  const { plugin, host } = pluginFor();
  const executed = [];
  plugin.executeWindowPrefixPlan = async (plan) => {
    executed.push(plan.key);
    return { ok: true, action: plan.action, plan };
  };
  arm(plugin);
  host.calls.length = 0;
  plugin.handleWindowPrefixCaptureKeydown(keyEvent({ key: "l", code: "KeyL", ctrlKey: false }));
  await plugin.windowPrefixQueue;
  assert.deepEqual(executed, ["l"]);
  assert.equal(host.calls.some((call) => call[0] === "showCard"), false);
  plugin.advanceWindowPrefixClock(300);
  assert.equal(plugin.windowPrefixState, "idle");
});

test("cancel listeners (mousedown, blur, layout-change) pop the scope", () => {
  const { plugin, keymap } = pluginFor();
  arm(plugin);
  plugin.handleWindowPrefixMouseDown({ target: { closest: () => null } });
  assert.equal(plugin.windowPrefixState, "idle");
  assert.equal(keymap.scopes.length, 0);

  arm(plugin);
  plugin.handleWindowPrefixCancelEvent("blur");
  assert.equal(keymap.scopes.length, 0);

  arm(plugin);
  plugin.windowPrefixSelfCaused = true;
  plugin.handleWindowPrefixWorkspaceEvent("layout-change");
  assert.equal(plugin.windowPrefixIsArmed(), true);
  plugin.windowPrefixSelfCaused = false;
  plugin.handleWindowPrefixWorkspaceEvent("layout-change");
  assert.equal(plugin.windowPrefixState, "idle");
});

test("overlay flags detect Bob cards and ignore the hint host", () => {
  const card = { closest: (sel) => (String(sel).includes("bob-copy-card") ? card : null), ownerDocument: { querySelector: () => null } };
  const flags = windowPrefixOverlayFlags({}, card);
  assert.equal(flags.inBobCard, true);

  const hint = { closest: (sel) => (String(sel).includes("bob-wp") ? hint : null), ownerDocument: { querySelector: () => ({ className: "modal" }) } };
  const hintFlags = windowPrefixOverlayFlags({}, hint);
  assert.equal(hintFlags.inModal, false);
});

test("contenteditable and inputs count as editable", () => {
  assert.equal(windowPrefixTargetIsEditable({ tagName: "INPUT", closest: () => null }), true);
  assert.equal(windowPrefixTargetIsEditable({ tagName: "DIV", isContentEditable: true, closest: () => null }), true);
  assert.equal(windowPrefixTargetIsEditable({ tagName: "DIV", closest: () => null }), false);
  assert.equal(windowPrefixTargetIsEditable(null), null);
});

test("move receipts name the tab and a closed split", () => {
  const snapshot = snapshotTwoSplits();
  assert.match(
    windowPrefixMoveReceiptText(
      { action: "join", direction: "right", movedLeafId: "b", preview: "join WP-C" },
      { sourceCollapsed: true },
      snapshot,
    ),
    /Moved “WP-B” → WP-C · left split closed/,
  );
  assert.match(
    windowPrefixMoveReceiptText(
      { action: "create-split", direction: "right", movedLeafId: "b" },
      {},
      snapshot,
    ),
    /new right split/,
  );
});

test("successful focus pulses then disarms without a receipt", async () => {
  const { plugin, host, keymap } = pluginFor();
  plugin.executeWindowPrefixPlan = async (plan) => ({ ok: true, action: "focus", plan });
  arm(plugin);
  plugin.handleWindowPrefixCaptureKeydown(keyEvent({ key: "l", code: "KeyL", ctrlKey: false }));
  await plugin.windowPrefixQueue;
  assert.equal(plugin.windowPrefixState, "idle");
  assert.equal(keymap.scopes.length, 0);
  assert.ok(host.calls.some((call) => call[0] === "pulse"));
  assert.equal(host.calls.some((call) => call[0] === "receipt"), false);
});
