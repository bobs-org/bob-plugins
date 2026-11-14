// Bracket mode footer indicator: status-bar `[[ s w n ]]` with thumb, flash, click.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
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
  BRACKET_REPEAT_STORAGE_KEY,
  BRACKET_REPEAT_EMPTY_NOTICE,
  BRACKET_REPEAT_NO_UPPERCASE_NOTICE,
  BRACKET_MODE_FAMILIES,
  BRACKET_MODE_FLASH_MS,
  bracketModeViewKey,
  buildBracketModeView,
  ensureBracketModeDom,
  paintBracketModeIndicator,
} = helpers;

const { createFragmentNode } = require("./navigation-hotkeys-harness.cjs");

function extendBracketNode(node) {
  if (!node || node.__bobBracketExtended) {
    return node;
  }
  Object.defineProperty(node, "__bobBracketExtended", {
    value: true,
    enumerable: false,
    configurable: true,
  });
  node.attrs = node.attrs || {};
  if (!node.style || typeof node.style.setProperty !== "function") {
    node.style = {
      _props: {},
      setProperty(name, value) {
        this._props[String(name)] = String(value);
      },
      getPropertyValue(name) {
        return this._props[String(name)] || "";
      },
    };
  }
  node.listeners = node.listeners || {};
  if (!node.classList) {
    node.classList = {};
  }
  if (typeof node.classList.add !== "function") {
    node.classList.add = (...classes) => {
      for (const cls of classes.flatMap((item) => String(item || "").split(/\s+/))) {
        if (cls && !node.classes.includes(cls)) {
          node.classes.push(cls);
        }
      }
    };
  }
  if (typeof node.classList.remove !== "function") {
    node.classList.remove = (...classes) => {
      const flat = classes.flatMap((item) => String(item || "").split(/\s+/));
      node.classes = node.classes.filter((c) => !flat.includes(c));
    };
  }
  if (typeof node.classList.toggle !== "function") {
    node.classList.toggle = (cls, force) => {
      const has = node.classes.includes(cls);
      const want = force === undefined ? !has : Boolean(force);
      if (want && !has) {
        node.classes.push(cls);
      }
      if (!want && has) {
        node.classes = node.classes.filter((c) => c !== cls);
      }
      return want;
    };
  }
  if (typeof node.classList.contains !== "function") {
    node.classList.contains = (cls) => node.classes.includes(cls);
  }
  if (typeof node.setAttribute !== "function") {
    node.setAttribute = (name, value) => {
      node.attrs[String(name)] = String(value);
    };
  }
  if (typeof node.getAttribute !== "function") {
    node.getAttribute = (name) => node.attrs[String(name)] ?? null;
  }
  if (typeof node.removeAttribute !== "function") {
    node.removeAttribute = (name) => {
      delete node.attrs[String(name)];
    };
  }
  if (typeof node.addClass !== "function") {
    node.addClass = (cls) => node.classList.add(cls);
  }
  if (typeof node.removeClass !== "function") {
    node.removeClass = (cls) => node.classList.remove(cls);
  }
  if (typeof node.empty !== "function") {
    node.empty = () => {
      node.children = [];
      node.text = "";
    };
  }
  if (typeof node.addEventListener !== "function") {
    node.addEventListener = (type, fn) => {
      node.listeners[type] = node.listeners[type] || [];
      node.listeners[type].push(fn);
    };
  }
  if (typeof node.createEl !== "function") {
    node.createEl = (tag, opts = {}) => {
      const child = createFragmentNode(tag);
      extendBracketNode(child);
      if (typeof opts.cls === "string" && opts.cls) {
        child.classList.add(opts.cls);
      }
      if (opts.text !== undefined) {
        child.text = String(opts.text);
      }
      if (opts.attr) {
        for (const [key, value] of Object.entries(opts.attr)) {
          child.setAttribute(key, value);
        }
      }
      node.children.push(child);
      return child;
    };
  }
  node.createSpan = (opts = {}) => node.createEl("span", opts);
  node.createDiv = (opts = {}) => node.createEl("div", opts);
  if (!Object.getOwnPropertyDescriptor(node, "offsetWidth")) {
    Object.defineProperty(node, "offsetWidth", {
      get: () => 100,
      configurable: true,
    });
  }
  return node;
}

function makeStatusBarEl() {
  const node = createFragmentNode("div");
  return extendBracketNode(node);
}

function findSegment(parts, type) {
  return parts.segments.find((node) => node.getAttribute("data-bracket-type") === type);
}

function fire(node, type, event = {}) {
  const listeners = (node.listeners && node.listeners[type]) || [];
  const full = {
    preventDefault: () => {
      full.defaultPrevented = true;
    },
    defaultPrevented: false,
    ...event,
  };
  for (const fn of [...listeners]) {
    fn(full);
  }
  return full;
}

function createMountedPlugin({ storage = new Map(), withStatusBar = true } = {}) {
  const plugin = new NavigationHotkeysPlugin();
  const commands = [];
  const statusBars = [];
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
  if (withStatusBar) {
    plugin.addStatusBarItem = () => {
      const el = makeStatusBarEl();
      statusBars.push(el);
      return el;
    };
  }
  plugin.onload();
  return { plugin, commands, storage, statusBars };
}

function commandById(commands, id) {
  const found = commands.find((item) => item.id === id);
  assert.ok(found, `missing command ${id}`);
  return found;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("family table is frozen and ordered s, w, n, b", () => {
  assert.deepEqual(
    BRACKET_MODE_FAMILIES.map((family) => family.type),
    ["s", "w", "n", "b"],
  );
  assert.ok(Object.isFrozen(BRACKET_MODE_FAMILIES));
  for (const family of BRACKET_MODE_FAMILIES) {
    assert.ok(Object.isFrozen(family));
  }
  assert.deepEqual(BRACKET_MODE_FLASH_MS, { forward: 450, backward: 450, empty: 650 });
  assert.ok(Object.isFrozen(BRACKET_MODE_FLASH_MS));
});

test("view model covers s, w, n, b, null, and garbage", () => {
  const expectations = [
    ["s", 0, "review walk", "]] / [[ repeat the review walk (]s / [s)", "]} / [{ jump to the next / previous review group (]S / [S)", "Review walk (]s / [s)"],
    ["w", 1, "lane walk", "]] / [[ repeat the lane walk (]w / [w)", "]} / [{ jump to the next / previous lane (]W / [W)", "Lane walk (]w / [w)"],
    ["n", 2, "links", "]] / [[ open the next / previous link (]n / [n)", "]} / [{ have no link variant (no ]N / [N)", "Links (]n / [n)"],
    ["b", 3, "bank walk", "]] / [[ repeat the bank walk (]b / [b)", "]} / [{ jump to the next / previous bank day (]B / [B)", "Bank walk (]b / [b)"],
  ];
  for (const [type, index, name, firstLine, secondLine, segmentAria] of expectations) {
    const view = buildBracketModeView(type);
    assert.equal(view.mode, type);
    assert.equal(view.index, index);
    assert.equal(view.ariaLabel, `Bracket repeat mode: ${name}`);
    assert.ok(view.tooltip.startsWith(firstLine), `${type} first line`);
    const lines = view.tooltip.split("\n");
    assert.equal(lines[1], secondLine, `${type} second line`);
    assert.ok(
      view.tooltip.includes("s review \u00b7 w lanes \u00b7 n links \u00b7 b bank \u2014 click a letter to switch"),
      `${type} hint line`,
    );
    assert.ok(Object.isFrozen(view));
    assert.ok(Object.isFrozen(view.segments));
    const active = view.segments.filter((segment) => segment.active);
    assert.equal(active.length, 1);
    assert.equal(active[0].type, type);
    const segment = view.segments.find((item) => item.type === type);
    assert.equal(segment.ariaLabel, segmentAria);
  }
  for (const input of [null, undefined, "garbage", "S", 1]) {
    const view = buildBracketModeView(input);
    assert.equal(view.mode, "none");
    assert.equal(view.index, -1);
    assert.equal(view.ariaLabel, "Bracket repeat mode: not set");
    assert.ok(view.tooltip.startsWith(BRACKET_REPEAT_EMPTY_NOTICE), `none first line for ${String(input)}`);
    assert.ok(
      view.tooltip.includes("s review \u00b7 w lanes \u00b7 n links \u00b7 b bank \u2014 click a letter to choose"),
      "none second line",
    );
    assert.ok(view.segments.every((segment) => segment.active === false));
    assert.ok(Object.isFrozen(view));
  }
  assert.equal(normalizeBracketRepeatType("s"), "s");
  assert.equal(normalizeBracketRepeatType("b"), "b");
});

test("desktop mount creates exactly one item with four letters and none on cold device", () => {
  const { plugin, statusBars } = createMountedPlugin();
  assert.equal(statusBars.length, 1);
  const el = plugin.bracketModeEl;
  assert.ok(el);
  assert.ok(el.classes.includes("bob-bracket-mode"));
  assert.equal(el.getAttribute("data-bracket-mode"), "none");
  assert.equal(el.style._props["--bob-bracket-index"], "-1");
  assert.equal(el.getAttribute("role"), "group");
  assert.equal(el.getAttribute("aria-label"), "Bracket repeat mode: not set");
  const parts = plugin.bracketModeParts;
  assert.ok(parts);
  assert.equal(parts.segments.length, 4);
  assert.deepEqual(
    parts.segments.map((node) => node.getAttribute("data-bracket-type")),
    ["s", "w", "n", "b"],
  );
  assert.ok(parts.back);
  assert.ok(parts.forward);
  assert.ok(parts.thumb);
});

test("mobile, non-desktop, or missing status bar mounts nothing and keeps type undefined", () => {
  const previousGlobal = globalThis.Platform;
  try {
    globalThis.Platform = { isDesktopApp: false };
    const { plugin, statusBars } = createMountedPlugin();
    assert.equal(statusBars.length, 0);
    assert.equal(plugin.bracketModeEl, null);
    assert.equal(plugin.bracketRepeatType, undefined);
  } finally {
    if (previousGlobal === undefined) {
      delete globalThis.Platform;
    } else {
      globalThis.Platform = previousGlobal;
    }
  }
  try {
    globalThis.Platform = { isMobile: true };
    const { plugin } = createMountedPlugin();
    assert.equal(plugin.bracketModeEl, null);
    assert.equal(plugin.bracketRepeatType, undefined);
  } finally {
    if (previousGlobal === undefined) {
      delete globalThis.Platform;
    } else {
      globalThis.Platform = previousGlobal;
    }
  }
  const { plugin: noBar } = createMountedPlugin({ withStatusBar: false });
  assert.equal(noBar.bracketModeEl, null);
  assert.equal(noBar.bracketRepeatType, undefined);
});

test("a second setup does not add a second item", () => {
  const { plugin, statusBars } = createMountedPlugin();
  assert.equal(statusBars.length, 1);
  const first = plugin.bracketModeEl;
  plugin.setupBracketModeIndicator();
  assert.equal(statusBars.length, 1);
  assert.strictEqual(plugin.bracketModeEl, first);
});

test("startup restores the stored mode with no key press; invalid stays none", () => {
  const stored = new Map([[BRACKET_REPEAT_STORAGE_KEY, "w"]]);
  const { plugin } = createMountedPlugin({ storage: stored });
  assert.equal(plugin.bracketRepeatType, "w");
  assert.equal(plugin.bracketModeEl.getAttribute("data-bracket-mode"), "w");
  assert.equal(plugin.bracketModeEl.style._props["--bob-bracket-index"], "1");

  const bad = new Map([[BRACKET_REPEAT_STORAGE_KEY, "garbage"]]);
  const { plugin: cold } = createMountedPlugin({ storage: bad });
  assert.equal(cold.bracketRepeatType, null);
  assert.equal(cold.bracketModeEl.getAttribute("data-bracket-mode"), "none");
});

test("family commands repaint to their family and reuse the same DOM nodes", () => {
  const { plugin, commands } = createMountedPlugin();
  const before = plugin.bracketModeParts;
  const beforeNodes = [before.back, before.track, before.thumb, before.forward, ...before.segments];
  plugin.jumpToDueTask = () => true;
  plugin.jumpToLaneTask = () => true;
  plugin.openLabeledBodyLink = () => true;
  plugin.jumpToBankRow = () => true;
  commandById(commands, "jump-to-next-due-task").callback();
  assert.equal(plugin.bracketModeEl.getAttribute("data-bracket-mode"), "s");
  assert.strictEqual(plugin.bracketModeParts, before);
  for (const node of beforeNodes) {
    assert.ok(
      before.back === node || before.track === node || before.thumb === node || before.forward === node || before.segments.includes(node),
    );
  }
  const afterS = plugin.bracketModeParts;
  commandById(commands, "jump-to-next-lane-task").callback();
  assert.equal(plugin.bracketModeEl.getAttribute("data-bracket-mode"), "w");
  assert.strictEqual(plugin.bracketModeParts, afterS);
  commandById(commands, "open-next-link").callback();
  assert.equal(plugin.bracketModeEl.getAttribute("data-bracket-mode"), "n");
  commandById(commands, "jump-to-next-bank-row").callback();
  assert.equal(plugin.bracketModeEl.getAttribute("data-bracket-mode"), "b");
});

test("same-family commands skip DOM writes because the paint key is unchanged", () => {
  const { plugin, commands } = createMountedPlugin();
  plugin.jumpToDueTask = () => true;
  commandById(commands, "jump-to-next-due-task").callback();
  const el = plugin.bracketModeEl;
  let writes = 0;
  const originalSet = el.setAttribute.bind(el);
  el.setAttribute = (name, value) => {
    writes += 1;
    return originalSet(name, value);
  };
  const originalStyleSet = el.style.setProperty.bind(el.style);
  el.style.setProperty = (name, value) => {
    writes += 1;
    return originalStyleSet(name, value);
  };
  commandById(commands, "jump-to-prev-due-task").callback();
  assert.equal(writes, 0);
});

test("is-instant applies on first appearance and none to family, not family to family", () => {
  const { plugin } = createMountedPlugin();
  assert.ok(plugin.bracketModeEl.classes.includes("is-instant"));
  const { plugin: moving } = createMountedPlugin();
  moving.bracketModeParts = moving.bracketModeParts;
  // First paint already used is-instant; clear it like the frame would.
  moving.bracketModeEl.classes = moving.bracketModeEl.classes.filter((c) => c !== "is-instant");
  moving.bracketRepeatType = null;
  moving.bracketModePaintKey = "none";
  moving.bracketModeEl._bobBracketModePaintKey = "none";
  moving.rememberBracketRepeatType("s");
  assert.ok(moving.bracketModeEl.classes.includes("is-instant"));
  moving.bracketModeEl.classes = moving.bracketModeEl.classes.filter((c) => c !== "is-instant");
  moving.bracketModeEl._bobBracketModeInstantFrame = null;
  moving.bracketModeInstantFrame = null;
  moving.rememberBracketRepeatType("w");
  assert.ok(!moving.bracketModeEl.classes.includes("is-instant"));
});

test("ensureBracketModeDom is idempotent and paint skips unchanged keys", () => {
  const el = makeStatusBarEl();
  const first = ensureBracketModeDom(el);
  assert.ok(first);
  const second = ensureBracketModeDom(el);
  assert.strictEqual(second, first);
  const view = buildBracketModeView("s");
  paintBracketModeIndicator(el, first, view, undefined);
  assert.equal(el.getAttribute("data-bracket-mode"), "s");
  let writes = 0;
  const original = el.setAttribute.bind(el);
  el.setAttribute = (name, value) => {
    writes += 1;
    return original(name, value);
  };
  paintBracketModeIndicator(el, first, view, "s");
  assert.equal(writes, 0);
});

test("repeat flashes forward and backward, delegates with args, and returns the result", async () => {
  const { plugin } = createMountedPlugin();
  plugin.rememberBracketRepeatType("s");
  const sentinel = {};
  const calls = [];
  plugin.jumpToDueTask = (...args) => {
    calls.push(args);
    return sentinel;
  };
  assert.strictEqual(plugin.repeatBracketWalk(1), sentinel);
  assert.deepEqual(calls, [[1]]);
  assert.equal(plugin.bracketModeEl.getAttribute("data-bracket-flash"), "forward");
  await sleep(BRACKET_MODE_FLASH_MS.forward + 60);
  assert.equal(plugin.bracketModeEl.getAttribute("data-bracket-flash"), null);

  plugin.rememberBracketRepeatType("w");
  const laneCalls = [];
  plugin.jumpToLaneTask = (...args) => {
    laneCalls.push(args);
    return sentinel;
  };
  assert.strictEqual(plugin.repeatBracketWalk(-1), sentinel);
  assert.deepEqual(laneCalls, [[-1]]);
  assert.equal(plugin.bracketModeEl.getAttribute("data-bracket-flash"), "backward");
  await sleep(BRACKET_MODE_FLASH_MS.backward + 60);
  assert.equal(plugin.bracketModeEl.getAttribute("data-bracket-flash"), null);
});

test("cold repeat flashes empty, shows the notice, and returns false", async () => {
  notices.length = 0;
  const { plugin } = createMountedPlugin();
  assert.equal(plugin.repeatBracketWalk(1), false);
  assert.deepEqual(notices, [BRACKET_REPEAT_EMPTY_NOTICE]);
  assert.equal(plugin.bracketModeEl.getAttribute("data-bracket-flash"), "empty");
  await sleep(BRACKET_MODE_FLASH_MS.empty + 60);
  assert.equal(plugin.bracketModeEl.getAttribute("data-bracket-flash"), null);
});

test("a throwing indicator never changes delegation, storage, or notices", () => {
  const { plugin, storage } = createMountedPlugin();
  plugin.rememberBracketRepeatType("s");
  const before = storage.get(BRACKET_REPEAT_STORAGE_KEY);
  plugin.flashBracketModeIndicator = () => {
    throw new Error("flash down");
  };
  plugin.refreshBracketModeIndicator = () => {
    throw new Error("paint down");
  };
  const sentinel = {};
  const calls = [];
  plugin.jumpToDueTask = (...args) => {
    calls.push(args);
    return sentinel;
  };
  assert.strictEqual(plugin.repeatBracketWalk(1), sentinel);
  assert.deepEqual(calls, [[1]]);
  notices.length = 0;
  const { plugin: cold, storage: coldStorage } = createMountedPlugin();
  cold.flashBracketModeIndicator = () => {
    throw new Error("flash down");
  };
  assert.equal(cold.repeatBracketWalk(1), false);
  assert.deepEqual(notices, [BRACKET_REPEAT_EMPTY_NOTICE]);
  assert.equal(coldStorage.has(BRACKET_REPEAT_STORAGE_KEY), false);
  assert.equal(storage.get(BRACKET_REPEAT_STORAGE_KEY), before);
});

test("clicking a letter selects the family, persists it, and never walks", () => {
  const { plugin, storage } = createMountedPlugin();
  let walked = false;
  plugin.jumpToDueTask = () => {
    walked = true;
  };
  plugin.jumpToLaneTask = () => {
    walked = true;
  };
  plugin.openLabeledBodyLink = () => {
    walked = true;
  };
  const parts = plugin.bracketModeParts;
  const wButton = findSegment(parts, "w");
  assert.ok(wButton);
  fire(wButton, "click");
  assert.equal(plugin.bracketRepeatType, "w");
  assert.equal(storage.get(BRACKET_REPEAT_STORAGE_KEY), "w");
  assert.equal(walked, false);
  assert.equal(plugin.bracketModeEl.getAttribute("data-bracket-mode"), "w");
  const writesBefore = storage.size;
  fire(wButton, "click");
  assert.equal(storage.size, writesBefore);
});

test("mousedown on a letter keeps editor focus and registerDomEvent is preferred", () => {
  const { plugin } = createMountedPlugin();
  const sButton = findSegment(plugin.bracketModeParts, "s");
  const event = fire(sButton, "mousedown");
  assert.equal(event.defaultPrevented, true);

  const pluginWithRegister = new NavigationHotkeysPlugin();
  const seen = [];
  pluginWithRegister.app = {
    workspace: { getActiveFile: () => null, on: () => ({}), onLayoutReady: () => {} },
    loadLocalStorage: () => null,
    saveLocalStorage: () => {},
  };
  pluginWithRegister.addCommand = () => {};
  pluginWithRegister.register = () => {};
  pluginWithRegister.registerEvent = () => {};
  pluginWithRegister.registerEditorExtension = () => {};
  pluginWithRegister.registerVimMappingsWhenReady = () => {};
  pluginWithRegister.registerVimJumpHistoryVaultEvents = () => {};
  pluginWithRegister.registerOpenTaskJumpInputListeners = () => {};
  pluginWithRegister.registerReviewRefreshInputListeners = () => {};
  pluginWithRegister.registerCountedTransclusionToggleInputListeners = () => {};
  pluginWithRegister.registerCountedBulletPropertyInputListeners = () => {};
  pluginWithRegister.registerCountedTaskMoveInputListeners = () => {};
  pluginWithRegister.registerCountedLaneToggleInputListeners = () => {};
  pluginWithRegister.registerClearSearchHighlightInputListeners = () => {};
  pluginWithRegister.captureActiveFilePosition = () => {};
  pluginWithRegister.refreshDashScrollCaptureTarget = () => {};
  pluginWithRegister.ensureTemplaterNewNoteTrigger = () => {};
  pluginWithRegister.addStatusBarItem = () => makeStatusBarEl();
  pluginWithRegister.registerDomEvent = (node, name, fn) => {
    seen.push(name);
    node.addEventListener(name, fn);
  };
  pluginWithRegister.onload();
  assert.ok(seen.includes("click"));
  assert.ok(seen.includes("mousedown"));
});

test("onunload clears flash and instant timers", async () => {
  const { plugin } = createMountedPlugin();
  plugin.rememberBracketRepeatType("s");
  plugin.jumpToDueTask = () => true;
  plugin.repeatBracketWalk(1);
  assert.ok(plugin.bracketModeFlashTimer);
  plugin.onunload();
  assert.equal(plugin.bracketModeFlashTimer, null);
  assert.equal(plugin.bracketModeInstantFrame, null);
});

test("uppercase repeat flashes forward and backward; no-uppercase flashes empty", async () => {
  const { plugin } = createMountedPlugin();
  plugin.rememberBracketRepeatType("s");
  plugin.jumpToDueTask = () => true;
  assert.strictEqual(plugin.repeatBracketWalk(1, { uppercase: true }), true);
  assert.equal(plugin.bracketModeEl.getAttribute("data-bracket-flash"), "forward");
  await sleep(BRACKET_MODE_FLASH_MS.forward + 60);
  plugin.rememberBracketRepeatType("w");
  plugin.jumpToLaneTask = () => true;
  assert.strictEqual(plugin.repeatBracketWalk(-1, { uppercase: true }), true);
  assert.equal(plugin.bracketModeEl.getAttribute("data-bracket-flash"), "backward");
  await sleep(BRACKET_MODE_FLASH_MS.backward + 60);
  notices.length = 0;
  plugin.rememberBracketRepeatType("n");
  let walked = false;
  plugin.jumpToDueTask = () => {
    walked = true;
  };
  plugin.jumpToLaneTask = () => {
    walked = true;
  };
  plugin.openLabeledBodyLink = () => {
    walked = true;
  };
  assert.equal(plugin.repeatBracketWalk(1, { uppercase: true }), false);
  assert.equal(walked, false);
  assert.deepEqual(notices, [BRACKET_REPEAT_NO_UPPERCASE_NOTICE]);
  assert.equal(plugin.bracketModeEl.getAttribute("data-bracket-flash"), "empty");
  await sleep(BRACKET_MODE_FLASH_MS.empty + 60);
});

test("per-family attention lands on s and b only while another family is selected", () => {
  const attention = {
    s: { tier: "next", label: "Review: 9 due" },
    b: { tier: "waiting", label: "Bank: 4 waiting" },
  };
  for (const mode of ["w", "n", "b", null]) {
    const view = buildBracketModeView(mode, attention);
    const s = view.segments.find((segment) => segment.type === "s");
    assert.equal(s.attention, mode !== "s", `mode ${mode}`);
    assert.equal(s.attentionTier, mode === "s" ? "" : "next", `mode ${mode}`);
    assert.equal(s.attentionLabel, mode === "s" ? "" : "Review: 9 due", `mode ${mode}`);
    const b = view.segments.find((segment) => segment.type === "b");
    assert.equal(b.attention, mode !== "b", `bank mode ${mode}`);
    assert.equal(b.attentionTier, mode === "b" ? "" : "waiting", `bank mode ${mode}`);
    assert.equal(b.attentionLabel, mode === "b" ? "" : "Bank: 4 waiting", `bank mode ${mode}`);
    for (const other of ["w", "n"]) {
      const seg = view.segments.find((segment) => segment.type === other);
      assert.equal(seg.attention, false, `mode ${mode} seg ${other}`);
      assert.equal(seg.attentionTier, "", `mode ${mode} seg ${other}`);
      assert.equal(seg.attentionLabel, "", `mode ${mode} seg ${other}`);
      assert.ok(!seg.ariaLabel.includes("Review: 9 due"), `mode ${mode} seg ${other}`);
    }
  }
  assert.equal(buildBracketModeView("s", attention).segments.find((seg) => seg.type === "s").attention, false);
  assert.equal(buildBracketModeView("b", attention).segments.find((seg) => seg.type === "b").attention, false);
  const none = buildBracketModeView("none", null);
  assert.ok(none.segments.every((segment) => segment.attention === false));
});

test("paint sets and clears the s dot without touching instant or animation classes", () => {
  const el = makeStatusBarEl();
  const parts = ensureBracketModeDom(el);
  const attention = { s: { tier: "Pending", label: "  Review: 5 due  " } };
  const view = buildBracketModeView("w", attention);
  paintBracketModeIndicator(el, parts, view, undefined);
  const sButton = findSegment(parts, "s");
  assert.ok(sButton.classes.includes("has-attention"));
  assert.equal(sButton.attrs["data-attention-tier"], "Pending");
  assert.equal(sButton.attrs.title, "  Review: 5 due  ");
  const cleared = buildBracketModeView("w", {});
  paintBracketModeIndicator(el, parts, cleared, "w");
  assert.ok(!sButton.classes.includes("has-attention"));
  assert.equal(sButton.attrs["data-attention-tier"], undefined);
  assert.equal(sButton.attrs.title, undefined);
  assert.equal(el.classes.includes("is-instant"), false);
});

test("bank waiting attention paints only the b dot and uses warning ink", () => {
  const el = makeStatusBarEl();
  const parts = ensureBracketModeDom(el);
  const view = buildBracketModeView("w", { b: { tier: "waiting", label: "Bank: 2 waiting" } });
  paintBracketModeIndicator(el, parts, view, undefined);
  const bButton = findSegment(parts, "b");
  const sButton = findSegment(parts, "s");
  assert.ok(bButton.classes.includes("has-attention"));
  assert.equal(bButton.attrs["data-attention-tier"], "waiting");
  assert.ok(!sButton.classes.includes("has-attention"));
  const css = fs.readFileSync(path.join(__dirname, "..", "plugins", "bob-navigation-hotkeys", "styles.css"), "utf8");
  assert.match(css, /data-attention-tier="waiting"[^}]*var\(--text-warning\)/);
});

test("attention-only change repaints while an unchanged view key skips DOM writes", () => {
  const el = makeStatusBarEl();
  const parts = ensureBracketModeDom(el);
  const first = buildBracketModeView("w", { s: { tier: "next", label: "one" } });
  const second = buildBracketModeView("w", { s: { tier: "next", label: "two" } });
  assert.notEqual(bracketModeViewKey(first), bracketModeViewKey(second));
  paintBracketModeIndicator(el, parts, first, undefined);
  let writes = 0;
  const sButton = findSegment(parts, "s");
  const originalSet = sButton.setAttribute.bind(sButton);
  sButton.setAttribute = (name, value) => {
    writes += 1;
    return originalSet(name, value);
  };
  paintBracketModeIndicator(el, parts, second, "w");
  assert.ok(writes > 0);
  assert.equal(sButton.attrs.title, "two");
  writes = 0;
  paintBracketModeIndicator(el, parts, second, "w");
  assert.equal(writes, 0);
  assert.equal(bracketModeViewKey(second), bracketModeViewKey(buildBracketModeView("w", { s: { tier: "next", label: "two" } })));
});

test("attention styles carry no motion and forced-colors uses Highlight", () => {
  const cssPath = path.join(__dirname, "..", "plugins", "bob-navigation-hotkeys", "styles.css");
  const css = fs.readFileSync(cssPath, "utf8");
  const dotRule = css.match(/button\.bob-bracket-mode-seg\.has-attention::after\s*\{[^}]*\}/);
  assert.ok(dotRule, "missing has-attention::after rule");
  assert.doesNotMatch(dotRule[0], /animation\s*:/);
  assert.doesNotMatch(dotRule[0], /transition\s*:/);
  assert.ok(css.includes("@media (forced-colors: active)"));
  const forced = css.slice(css.indexOf("@media (forced-colors: active)"));
  assert.ok(forced.includes("button.bob-bracket-mode-seg.has-attention::after"));
  assert.ok(forced.includes("Highlight"));
});
