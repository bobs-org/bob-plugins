// Work badge tones: shared count-to-limit colors for TODAY, PENDING,
// NEXT, and READY (`todayBadgeTone` theme-overflow override included).
// Boundary vectors live here; lane/READY models and DOM update paths are
// exercised at their real boundaries, not via string mirrors.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

class TestPlugin {
  constructor(app) {
    this.app = app;
  }
  addCommand() {}
  registerEditorExtension() {}
  registerEvent() {}
  registerMarkdownCodeBlockProcessor(language, handler) {
    this.codeBlocks = this.codeBlocks || {};
    this.codeBlocks[language] = handler;
  }
  registerInterval(handle) {
    return handle;
  }
}

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: class {},
      Notice: class {},
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
    return {
      EditorView: { updateListener: { of: (listener) => ({ listener }) } },
      keymap: { of: (value) => value },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers } = LedgerToolsPlugin;
Module._load = originalLoad;

const {
  computePlanBudget,
  dashboardLaneBadgeModel,
  defaultPlanCaps,
  planBlockModel,
  readyBadgeModel,
  todayBadgeTone,
  workBadgeTone,
  workToneClass,
} = helpers;

assert.equal(typeof workBadgeTone, "function", "workBadgeTone is exported");
assert.equal(typeof todayBadgeTone, "function", "todayBadgeTone is exported");

// --- Shared boundary vectors (cap 100) -----------------------------------
test("workBadgeTone boundary vectors at cap 100 use exact comparisons", () => {
  assert.equal(workBadgeTone(0, 100), "grey");
  assert.equal(workBadgeTone(1, 100), "blue");
  assert.equal(workBadgeTone(49, 100), "blue");
  assert.equal(workBadgeTone(50, 100), "green");
  assert.equal(workBadgeTone(74, 100), "green");
  assert.equal(workBadgeTone(75, 100), "yellow");
  assert.equal(workBadgeTone(99, 100), "yellow");
  assert.equal(workBadgeTone(100, 100), "orange");
  assert.equal(workBadgeTone(101, 100), "red");
  assert.equal(workBadgeTone(250, 100), "red");
});

test("workBadgeTone at cap 15 has no percentage rounding", () => {
  assert.equal(workBadgeTone(0, 15), "grey");
  assert.equal(workBadgeTone(7, 15), "blue");
  assert.equal(workBadgeTone(8, 15), "green");
  assert.equal(workBadgeTone(11, 15), "green");
  assert.equal(workBadgeTone(12, 15), "yellow");
  assert.equal(workBadgeTone(14, 15), "yellow");
  assert.equal(workBadgeTone(15, 15), "orange");
  assert.equal(workBadgeTone(16, 15), "red");
});

test("workBadgeTone default caps, small caps, and cap changes", () => {
  assert.equal(workBadgeTone(0, 10), "grey");
  assert.equal(workBadgeTone(4, 10), "blue");
  assert.equal(workBadgeTone(5, 10), "green");
  assert.equal(workBadgeTone(7, 10), "green");
  assert.equal(workBadgeTone(8, 10), "yellow");
  assert.equal(workBadgeTone(9, 10), "yellow");
  assert.equal(workBadgeTone(10, 10), "orange");
  assert.equal(workBadgeTone(11, 10), "red");
  // Small caps naturally skip bands.
  assert.equal(workBadgeTone(0, 1), "grey");
  assert.equal(workBadgeTone(1, 1), "orange");
  assert.equal(workBadgeTone(2, 1), "red");
  assert.equal(workBadgeTone(1, 2), "green");
  assert.equal(workBadgeTone(2, 2), "orange");
  assert.equal(workBadgeTone(1, 3), "blue");
  assert.equal(workBadgeTone(2, 3), "green");
  assert.equal(workBadgeTone(3, 3), "orange");
  // A changed cap with an unchanged count changes the tone.
  assert.equal(workBadgeTone(10, 15), "green");
  assert.equal(workBadgeTone(10, 10), "orange");
});

test("workBadgeTone never coerces invalid input to zero", () => {
  for (const bad of [null, undefined, "5", NaN, -1, 1.5, {}, []]) {
    assert.equal(workBadgeTone(bad, 10), null);
  }
  for (const badCap of [null, undefined, 0, -3, 1.5, "10", NaN]) {
    assert.equal(workBadgeTone(5, badCap), null);
  }
  assert.equal(workToneClass(null), "");
  assert.equal(workToneClass("purple"), "");
  assert.equal(workToneClass("green"), "bob-work-tone-green");
});

// --- TODAY vectors --------------------------------------------------------
function ledgerBudget(themesCount, themesCap, linksCount, linksCap) {
  return {
    hasSection: true,
    themes: { count: themesCount, cap: themesCap, over: themesCount > themesCap },
    links: { count: linksCount, cap: linksCap, over: linksCount > linksCap },
    status: themesCount > themesCap || linksCount > linksCap ? "over" : "ok",
    themeNames: [],
    entries: [],
    warnings: [],
  };
}

test("TODAY links bands with themes at cap 3", () => {
  assert.equal(todayBadgeTone(ledgerBudget(3, 3, 0, 10)), "grey");
  assert.equal(todayBadgeTone(ledgerBudget(3, 3, 4, 10)), "blue");
  assert.equal(todayBadgeTone(ledgerBudget(3, 3, 5, 10)), "green");
  assert.equal(todayBadgeTone(ledgerBudget(3, 3, 8, 10)), "yellow");
  assert.equal(todayBadgeTone(ledgerBudget(3, 3, 10, 10)), "orange");
  assert.equal(todayBadgeTone(ledgerBudget(3, 3, 11, 10)), "red");
});

test("TODAY theme overflow forces red, exact cap does not", () => {
  assert.equal(todayBadgeTone(ledgerBudget(4, 3, 0, 10)), "red");
  assert.equal(todayBadgeTone(ledgerBudget(4, 3, 5, 10)), "red");
  assert.equal(todayBadgeTone(ledgerBudget(4, 3, 11, 10)), "red");
  assert.equal(todayBadgeTone(ledgerBudget(3, 3, 4, 10)), "blue");
});

test("TODAY unavailable stays neutral, empty section is grey", () => {
  assert.equal(todayBadgeTone(null), null);
  assert.equal(todayBadgeTone({}), null);
  assert.equal(todayBadgeTone({ hasSection: false }), null);
  assert.equal(todayBadgeTone({ hasSection: true }), null);
  const empty = computePlanBudget("## Pomodoros\n", defaultPlanCaps(), "2026/20261010.md");
  assert.equal(empty.hasSection, true);
  assert.equal(todayBadgeTone(empty), "grey");
  const missing = computePlanBudget("no ledger here\n", defaultPlanCaps(), "2026/20261010.md");
  assert.equal(missing.hasSection, false);
  assert.equal(todayBadgeTone(missing), null);
  // Unrelated lint warnings do not select the tone.
  const warned = ledgerBudget(2, 3, 4, 10);
  warned.warnings.push({ code: "duplicate_open_pomodoro_name", message: "x" });
  assert.equal(todayBadgeTone(warned), "blue");
});

// --- Lane and READY models carry the displayed-count tone ------------------
test("PENDING/NEXT models color the section, READY its gated count", () => {
  const green = dashboardLaneBadgeModel(
    { section: 10, lane: 17, count: 10, laneCount: 17, today: 7, cap: 15, over: false },
    "next",
  );
  assert.equal(green.text, "NEXT 10/15");
  assert.equal(green.tone, "green");
  assert.equal(green.over, false);
  const orange = dashboardLaneBadgeModel(
    { section: 15, lane: 16, count: 15, laneCount: 16, today: 1, cap: 15, over: false },
    "next",
  );
  assert.equal(orange.tone, "orange");
  assert.equal(orange.over, false);
  assert.match(orange.tooltip, /1 over the whole-lane cap/);
  const ready = readyBadgeModel({ count: 87, cap: 100, over: false });
  assert.equal(ready.tone, "yellow");
  const readyOver = readyBadgeModel({ count: 101, cap: 100, over: true });
  assert.equal(readyOver.tone, "red");
  assert.equal(readyOver.over, true);
  const missing = readyBadgeModel({ count: null, cap: 100, over: false });
  assert.equal(missing.tone, null);
  assert.equal(missing.placeholder, true);
  const laneMissing = dashboardLaneBadgeModel(
    { section: null, lane: null, count: null, laneCount: null, today: null, cap: 15, over: false },
    "next",
  );
  assert.equal(laneMissing.tone, null);
  assert.equal(laneMissing.placeholder, true);
});

test("READY uses its gated count even when the total lane is larger", () => {
  const gated = readyBadgeModel(
    { count: 8, cap: 100, over: false },
    { lane: { total: 120, new: 30, rotten: 82, ready: 8 } },
  );
  assert.equal(gated.tone, "blue");
  assert.match(gated.tooltip, /lane 120 = 30 new/);
});

test("cap equality still emits no cap lint", () => {
  const model = planBlockModel({
    content: "## Pomodoros\n\n- [ ] () — A\n",
    tasks: [],
    today: new Date(2026, 9, 10),
    caps: defaultPlanCaps(),
    sourcePath: "2026/20261010.md",
    app: null,
    isToday: () => false,
  });
  assert.ok(!model.lints.some((line) => String(line).includes("next_cap_exceeded")));
  assert.ok(!model.lints.some((line) => String(line).includes("pending_cap_exceeded")));
  assert.ok(!model.lints.some((line) => String(line).includes("ready_cap_exceeded")));
});

// --- DOM boundaries: first paint, transitions, refresh ---------------------
function paintNode(tag, options = {}) {
  const node = {
    tag,
    cls: options.cls,
    text: options.text,
    title: options.title,
    href: options.href,
    attrs: {},
    children: [],
    parentNode: null,
    listeners: {},
    setAttribute(name, value) {
      node.attrs[name] = String(value);
    },
    hasAttribute(name) {
      return name in node.attrs;
    },
    setText(value) {
      node.text = String(value);
    },
    addEventListener(name, handler) {
      node.listeners[name] = node.listeners[name] || [];
      node.listeners[name].push(handler);
    },
    empty() {
      node.children = [];
    },
    createDiv(childOptions = {}) {
      return node.createEl("div", childOptions);
    },
    createEl(childTag, childOptions = {}) {
      const child = paintNode(childTag, childOptions);
      child.parentNode = node;
      node.children.push(child);
      return child;
    },
    querySelector(selector) {
      const cls = String(selector).replace(/^\./, "");
      const found = node.children.find((child) =>
        String(child.cls || "").split(/\s+/).includes(cls),
      );
      if (found) return found;
      for (const child of node.children) {
        const nested = child.querySelector(selector);
        if (nested) return nested;
      }
      return null;
    },
    querySelectorAll(selector) {
      const cls = String(selector).replace(/^\./, "");
      const out = [];
      const walk = (current) => {
        if (String(current.cls || "").split(/\s+/).includes(cls)) out.push(current);
        for (const child of current.children || []) walk(child);
      };
      for (const child of node.children) walk(child);
      return out;
    },
  };
  return node;
}

function tonesIn(cls) {
  return String(cls || "").split(/\s+/).filter((part) => part.startsWith("bob-work-tone-"));
}

function makeApp(overrides = {}) {
  return {
    vault: { getAbstractFileByPath: () => null, cachedRead: () => Promise.resolve(null) },
    workspace: { on: () => ({}), offref: () => {}, onLayoutReady: () => {}, getActiveFile: () => null, openLinkText: () => Promise.resolve(), trigger: () => {} },
    metadataCache: { on: () => ({}) },
    plugins: { plugins: {} },
    ...overrides,
  };
}

test("lane DOM keeps exactly one tone through transitions and unavailability", () => {
  const savedXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = "/definitely/missing/work-tone-test";
  const app = makeApp();
  const plugin = new LedgerToolsPlugin(app, {});
  try {
    plugin.onload();
    const host = paintNode("div");
    const el = plugin.paintDashboardLaneElement(
      host, "next",
      { section: 1, lane: 1, count: 1, laneCount: 1, today: 0, cap: 15, over: false }, {},
    );
    assert.ok(el);
    assert.deepEqual(tonesIn(el.cls), ["bob-work-tone-blue"]);
    assert.deepEqual(tonesIn(el.attrs.class), ["bob-work-tone-blue"]);
    const clickCount = (el.listeners.click || []).length;
    const keyCount = (el.listeners.keydown || []).length;
    assert.ok(clickCount >= 1 && keyCount >= 1);
    plugin.dashboardLaneWidgets.add({ el, lane: "next", sourcePath: "dash.md", component: null });
    const parent = { createEl: host.createEl.bind(host) };
    Object.defineProperty(el, "parentNode", { value: parent, configurable: true });
    let budget = { section: 15, lane: 15, count: 15, laneCount: 15, today: 0, cap: 15, over: false };
    plugin.dashboardLaneBudget = () => budget;
    assert.equal(plugin.refreshDashboardLaneBadges(new Date()), true);
    assert.deepEqual(tonesIn(el.cls), ["bob-work-tone-orange"]);
    assert.equal(el.querySelectorAll(".bob-plan-ready-value").length, 1);
    assert.equal(el.querySelectorAll(".bob-plan-ready-label").length, 1);
    budget = { section: 16, lane: 16, count: 16, laneCount: 16, today: 0, cap: 15, over: true };
    assert.equal(plugin.refreshDashboardLaneBadges(new Date()), true);
    assert.deepEqual(tonesIn(el.cls), ["bob-work-tone-red"]);
    assert.match(el.cls, /bob-plan-over/);
    budget = { section: 0, lane: 0, count: 0, laneCount: 0, today: 0, cap: 15, over: false };
    assert.equal(plugin.refreshDashboardLaneBadges(new Date()), true);
    assert.deepEqual(tonesIn(el.cls), ["bob-work-tone-grey"]);
    assert.doesNotMatch(el.cls, /bob-plan-over/);
    budget = { section: null, lane: null, count: null, laneCount: null, today: null, cap: 15, over: false };
    assert.equal(plugin.refreshDashboardLaneBadges(new Date()), true);
    assert.deepEqual(tonesIn(el.cls), []);
    assert.deepEqual(tonesIn(el.attrs.class), []);
    assert.match(el.cls, /bob-plan-unavailable/);
    // Listeners and spans survive every refresh.
    assert.equal((el.listeners.click || []).length, clickCount);
    assert.equal(el.querySelectorAll(".bob-plan-ready-value").length, 1);
    // Back to available recovers the tone.
    budget = { section: 8, lane: 8, count: 8, laneCount: 8, today: 0, cap: 15, over: false };
    assert.equal(plugin.refreshDashboardLaneBadges(new Date()), true);
    assert.deepEqual(tonesIn(el.cls), ["bob-work-tone-green"]);
  } finally {
    plugin.onunload();
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = savedXdg;
  }
});

test("READY DOM keeps exactly one tone and daily/dashboard models agree", () => {
  const savedXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = "/definitely/missing/work-tone-test";
  const app = makeApp();
  const plugin = new LedgerToolsPlugin(app, {});
  try {
    plugin.onload();
    const host = paintNode("div");
    const el = plugin.paintReadyElement(host, { count: 0, cap: 100, over: false }, {});
    assert.deepEqual(tonesIn(el.cls), ["bob-work-tone-grey"]);
    const daily = planBlockModel({
      content: "## Pomodoros\n",
      tasks: [],
      today: new Date(2026, 9, 10),
      caps: defaultPlanCaps(),
      sourcePath: "2026/20261010.md",
      app: null,
      isToday: () => false,
    });
    assert.equal(daily.readyModel.tone, workBadgeTone(0, 100));
    assert.equal(readyBadgeModel({ count: 50, cap: 100, over: false }).tone, "green");
    assert.equal(readyBadgeModel({ count: 100, cap: 100, over: false }).tone, "orange");
  } finally {
    plugin.onunload();
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = savedXdg;
  }
});

test("daily TODAY chip uses the theme-overflow tone", async () => {
  const savedXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = "/definitely/missing/work-tone-test";
  const app = makeApp({
    vault: {
      getAbstractFileByPath: () => ({ path: "2026/20261010.md" }),
      cachedRead: () => Promise.resolve("## Pomodoros\n\n- [ ] () — A\n    - [[x#^one]]\n- [ ] () — B\n    - [[y#^two]]\n- [ ] () — C\n    - [[z#^three]]\n- [ ] () — D\n    - [[w#^four]]\n"),
    },
    plugins: { plugins: { "obsidian-tasks-plugin": { getTasks: () => [], getState: () => "Warm" } } },
  });
  const plugin = new LedgerToolsPlugin(app, {});
  try {
    plugin.onload();
    const el = paintNode("div");
    plugin.paintPlanBlock(el, "2026/20261010.md");
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    const container = el.children[0];
    assert.ok(container, "expected the bob-plan container");
    const todayChip = container.children.find((child) =>
      String(child.cls || "").split(/\s+/).includes("bob-plan-plan"),
    );
    assert.ok(todayChip, "expected the TODAY chip");
    // 4 themes over the default cap of 3 forces red.
    assert.ok(tonesIn(todayChip.cls).includes("bob-work-tone-red"));
    // Historical daily keeps its own TODAY ledger: an older note with one
    // theme stays blue while TODAY uses the current day for lanes.
    const oldEl = paintNode("div");
    plugin.paintPlanBlock(oldEl, "2026/20260101.md");
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    plugin.onunload();
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = savedXdg;
  }
});


// --- Dashboard integration: actual first dataviewjs block from dash.md -----
function extractFirstDataviewJs(markdown) {
  const lines = String(markdown).split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (start === -1 && lines[i].trim() === "```dataviewjs") {
      start = i + 1;
    } else if (start !== -1 && lines[i].trim().startsWith("```")) {
      return lines.slice(start, i).join("\n");
    }
  }
  throw new Error("no dataviewjs block found in dash.md");
}
function dashStubHarness({ ledgerApi, tasks }) {
  const created = [];
  const mkEl = (tag, opts = {}) => {
    const el = {
      tag, cls: opts.cls, text: opts.text, title: opts.title, href: opts.href,
      attrs: { ...(opts.attr || {}) }, children: [], textContent: "",
      className: opts.cls || "",
      getAttribute: (k) => el.attrs[k] ?? null,
      setAttribute: (k, v) => { el.attrs[k] = String(v); },
      hasAttribute: (k) => k in el.attrs,
      remove: () => { el.removed = true; },
      addEventListener: () => {},
      createEl: (childTag, childOpts = {}) => {
        const child = mkEl(childTag, childOpts);
        child.parentNode = el;
        el.children.push(child);
        created.push(child);
        return child;
      },
    };
    if (opts.cls) el.attrs.class = opts.cls;
    if (opts.title) el.attrs.title = opts.title;
    created.push(el);
    return el;
  };
  const container = mkEl("div");
  const dv = { current: () => ({ file: { path: "dash.md" } }), container, component: { register: () => {} } };
  const app = { plugins: { plugins: { "bob-ledger-tools": ledgerApi ? { api: ledgerApi } : undefined, "obsidian-tasks-plugin": { getTasks: () => tasks } } }, workspace: { openLinkText: () => Promise.resolve(), trigger: () => {} } };
  const windowStub = { moment: () => ({ format: () => "2026/20261010", isSameOrBefore: () => true }) };
  return { dv, app, windowStub, container, created };
}
async function runDashBlock({ ledgerApi, tasks }) {
  const dashPath = process.env.BOB_DASHBOARD_FILE;
  assert.ok(dashPath, "BOB_DASHBOARD_FILE must point at the edited dash.md checkout");
  const markdown = fs.readFileSync(dashPath, "utf8");
  const code = extractFirstDataviewJs(markdown);
  const { dv, app, windowStub, container } = dashStubHarness({ ledgerApi, tasks });
  const fn = new Function("dv", "app", "window", `return (async () => { ${code} })();`);
  const windowSaved = globalThis.window;
  const appSaved = globalThis.app;
  globalThis.window = windowStub;
  globalThis.app = app;
  try { await fn(dv, app, windowStub); }
  finally {
    if (windowSaved === undefined) delete globalThis.window; else globalThis.window = windowSaved;
    if (appSaved === undefined) delete globalThis.app; else globalThis.app = appSaved;
  }
  return container;
}
function workChips(container) {
  const out = [];
  const walk = (node) => {
    const cls = String(node.cls || node.className || node.attrs?.class || "");
    if (/\btask-count-chip\b/.test(cls) || /\bbob-plan-chip\b/.test(cls)) out.push(node);
    for (const child of node.children || []) walk(child);
  };
  walk(container);
  return out;
}
test("dashboard integration uses Work tones, TODAY override, and keeps Work order", async () => {
  const dashPath = process.env.BOB_DASHBOARD_FILE;
  if (!dashPath) { console.log("SKIP dashboard integration: BOB_DASHBOARD_FILE is not set"); return; }
  const savedXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = "/definitely/missing/work-tone-test";
  const app = makeApp({ vault: { getAbstractFileByPath: () => null, cachedRead: () => Promise.resolve("## Pomodoros\n") }, plugins: { plugins: { "obsidian-tasks-plugin": { getTasks: () => [], getState: () => "Warm" } } } });
  const plugin = new LedgerToolsPlugin(app, {});
  try {
    plugin.onload();
    plugin.planBudgetForCallers = () => Promise.resolve({ hasSection: true, themes: { count: 4, cap: 3, over: true }, links: { count: 0, cap: 10, over: false }, status: "over", themeNames: [], entries: [], warnings: [] });
    plugin.dashboardLaneBudget = (lane) => (lane === "next" ? { section: 10, lane: 17, count: 10, laneCount: 17, today: 7, cap: 15, over: false } : { section: 4, lane: 4, count: 4, laneCount: 4, today: 0, cap: 10, over: false });
    plugin.readyBudget = () => ({ count: 15, cap: 100, over: false });
    const ledgerApi = plugin.api;
    assert.equal(ledgerApi.version, 3);
    assert.equal(ledgerApi.workBadges.version, 1);
    const container = await runDashBlock({ ledgerApi, tasks: [] });
    const chips = workChips(container);
    const labels = chips.map((chip) => { const labelChild = (chip.children || []).find((child) => String(child.cls || "").includes("-label")); return labelChild ? labelChild.text : String(chip.cls || ""); });
    const workLabels = labels.filter((label) => ["TODAY", "PENDING", "NEXT", "READY"].includes(label));
    assert.deepEqual(workLabels, ["TODAY", "PENDING", "NEXT", "READY"]);
    assert.equal(new Set(workLabels).size, 4, "exactly one badge per Work item");
    const byLabel = {};
    for (const chip of chips) { const labelChild = (chip.children || []).find((child) => String(child.cls || "").includes("-label")); if (labelChild) byLabel[labelChild.text] = chip; }
    const clsOf = (label) => String(byLabel[label]?.cls || byLabel[label]?.attrs?.class || "");
    assert.match(clsOf("TODAY"), /bob-work-tone-red/);
    assert.match(clsOf("NEXT"), /bob-work-tone-green/);
    assert.match(clsOf("PENDING"), /bob-work-tone-blue/);
    assert.match(clsOf("READY"), /bob-work-tone-blue/);
    assert.ok(labels.includes("NEW"), "Review NEW remains");
    assert.ok(labels.includes("ROTTEN"), "Review ROTTEN remains");
    assert.ok(labels.includes("BLOCKED"), "Browse BLOCKED remains");
  } finally {
    plugin.onunload();
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = savedXdg;
  }
});
test("dashboard fallbacks keep Work tones without plugin renderers or colors", async () => {
  const dashPath = process.env.BOB_DASHBOARD_FILE;
  if (!dashPath) { console.log("SKIP dashboard fallback integration: BOB_DASHBOARD_FILE is not set"); return; }
  const savedXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = "/definitely/missing/work-tone-test";
  const app = makeApp({ vault: { getAbstractFileByPath: () => null, cachedRead: () => Promise.resolve("## Pomodoros\n") }, plugins: { plugins: { "obsidian-tasks-plugin": { getTasks: () => [], getState: () => "Warm" } } } });
  const plugin = new LedgerToolsPlugin(app, {});
  try {
    plugin.onload();
    plugin.planBudgetForCallers = () => Promise.resolve({ hasSection: true, themes: { count: 2, cap: 3, over: false }, links: { count: 10, cap: 10, over: false }, status: "ok", themeNames: [], entries: [], warnings: [] });
    plugin.dashboardLaneBudget = (lane) => (lane === "next" ? { section: 8, lane: 8, count: 8, laneCount: 8, today: 0, cap: 15, over: false } : { section: 4, lane: 4, count: 4, laneCount: 4, today: 0, cap: 10, over: false });
    plugin.readyBudget = () => ({ count: 50, cap: 100, over: false });
    const oldApi = { ...plugin.api };
    delete oldApi.workBadges;
    const container = await runDashBlock({ ledgerApi: oldApi, tasks: [] });
    const chips = workChips(container);
    const byWorkLabel = {};
    for (const chip of chips) { const labelChild = (chip.children || []).find((child) => String(child.cls || "").includes("-label")); if (labelChild && ["PENDING", "NEXT", "READY"].includes(labelChild.text)) byWorkLabel[labelChild.text] = chip; }
    for (const lane of ["PENDING", "NEXT", "READY"]) {
      const chip = byWorkLabel[lane];
      assert.ok(chip, `expected inline ${lane} fallback`);
      const cls = String(chip.cls || chip.attrs?.class || "");
      assert.match(cls, /task-count-chip/, `${lane} fallback uses the inline chip`);
      assert.doesNotMatch(cls, /bob-plan-chip/, `${lane} old renderer must not reintroduce identity colors`);
      assert.match(cls, /bob-work-tone-/, `${lane} fallback carries a Work tone`);
    }
    const absent = await runDashBlock({ ledgerApi: null, tasks: [] });
    const absentChips = workChips(absent);
    assert.ok(absentChips.length >= 4, "absent plugin still shows Work navigation");
    const throwingApi = { ...plugin.api, renderDashboardLaneBadge: () => { throw new Error("renderer failed"); }, renderReadyBadge: () => { throw new Error("renderer failed"); } };
    const fallbackContainer = await runDashBlock({ ledgerApi: throwingApi, tasks: [] });
    const fallbackChips = workChips(fallbackContainer);
    const fallbackLabels = fallbackChips.map((chip) => { const labelChild = (chip.children || []).find((child) => String(child.cls || "").includes("-label")); return labelChild ? labelChild.text : ""; }).filter((label) => ["TODAY", "PENDING", "NEXT", "READY"].includes(label));
    assert.deepEqual(fallbackLabels, ["TODAY", "PENDING", "NEXT", "READY"]);
  } finally {
    plugin.onunload();
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = savedXdg;
  }
});
