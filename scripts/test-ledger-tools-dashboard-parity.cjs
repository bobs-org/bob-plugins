// Dashboard parity: badges agree with their Tasks sections.
// Compares badge models against an independent dashboard-query simulation
// (query-file defaults + global `_conflicts` exclusion), by identities and
// counts, never by calling the same helper twice.
const assert = require("node:assert/strict");
const Module = require("node:module");
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
  dashboardLaneBadgeModel,
  dashboardLaneBudgetFromTasks,
  defaultPlanCaps,
  laneBudgetFromTasks,
  readyBadgeModel,
  readyCountFromTasks,
} = helpers;

const DAY = new Date(2026, 8, 30);
const DAY_NUM = 2026 * 10000 + 9 * 100 + 30;

function task(overrides = {}) {
  return {
    status: { type: "TODO", name: "Todo", symbol: " " },
    tags: ["#task"],
    path: "notes/a.md",
    blockLink: " ^a1",
    description: "task",
    isBlocked: () => false,
    ...overrides,
  };
}

function pendingTask(overrides = {}) {
  return task({
    status: { type: "IN_PROGRESS", name: "In Progress", symbol: "/" },
    ...overrides,
  });
}

function nextTask(overrides = {}) {
  return task({
    status: { type: "ON_HOLD", name: "Next", symbol: "*" },
    ...overrides,
  });
}

function dayNum(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

// Independent dashboard-query simulation: mirrors dash.md query-file
// defaults plus the global `_conflicts` exclusion and Tasks built-in
// case-insensitive hide/path matching. Never calls the badge helpers.
function querySection(tasks, lane, { isToday = () => false, isReviewBucket = null } = {}) {
  const list = Array.isArray(tasks) ? tasks : [];
  const out = [];
  for (const t of list) {
    if (!t || typeof t !== "object") {
      continue;
    }
    const type = t.status && t.status.type;
    if (type === "DONE" || type === "CANCELLED" || type === "NON_TASK") {
      continue;
    }
    if (t.done === true) {
      continue;
    }
    const rawPath = typeof t.path === "string" ? t.path : "";
    if (!rawPath) {
      continue;
    }
    const lowered = rawPath.toLowerCase();
    if (lowered.includes("_templates") || lowered.includes("_conflicts")) {
      continue;
    }
    if (lowered === "dash.md") {
      continue;
    }
    const tags = Array.isArray(t.tags) ? t.tags : [];
    if (tags.some((tag) => typeof tag === "string" && tag.toLowerCase().includes("#hide"))) {
      continue;
    }
    const scheduled = t.scheduledDate !== undefined ? t.scheduledDate : (t.scheduled ?? null);
    const scheduledDay = scheduled === null || scheduled === undefined ? null : dayNum(scheduled);
    if (scheduledDay !== null && scheduledDay > DAY_NUM) {
      continue;
    }
    let blocked = false;
    try {
      if (typeof t.isBlocked === "function") {
        blocked = Boolean(t.isBlocked(list));
      } else {
        blocked = t.isBlocked === true || t.blocked === true;
      }
    } catch (error) {
      blocked = false;
    }
    if (blocked) {
      continue;
    }
    if (lane === "pending") {
      if (type !== "IN_PROGRESS") {
        continue;
      }
    } else if (lane === "next") {
      const symbol =
        (t.status && (t.status.symbol || t.statusSymbol || t.symbol)) || "";
      if (symbol !== "*") {
        continue;
      }
    } else if (lane === "ready") {
      if (type !== "TODO") {
        continue;
      }
      if (isReviewBucket) {
        let review = false;
        try {
          review = Boolean(isReviewBucket(t));
        } catch (error) {
          review = false;
        }
        if (review) {
          continue;
        }
      }
    } else {
      continue;
    }
    let todayFlag = false;
    try {
      todayFlag = Boolean(isToday(t));
    } catch (error) {
      throw error;
    }
    if (todayFlag) {
      continue;
    }
    out.push(t);
  }
  return out;
}

function identities(tasks) {
  return tasks
    .map((t, index) => {
      const path = typeof t.path === "string" ? t.path : "";
      const link = typeof t.blockLink === "string" ? t.blockLink : `#row-${index}`;
      const text = typeof t.description === "string" ? t.description : "";
      return `${path}${link} :: ${text}`;
    })
    .sort();
}

function makeApp(overrides = {}) {
  return {
    vault: {
      getAbstractFileByPath: () => null,
      cachedRead: () => Promise.resolve(null),
    },
    workspace: {
      on: () => ({}),
      offref: () => {},
      onLayoutReady: () => {},
      getActiveFile: () => null,
      openLinkText: () => Promise.resolve(),
      trigger: () => {},
    },
    metadataCache: { on: () => ({}) },
    plugins: { plugins: {} },
    ...overrides,
  };
}

test("PENDING section excludes TODAY while the whole lane keeps it", () => {
  const ordinary = pendingTask({ path: "notes/a.md", blockLink: " ^aaa", description: "ordinary" });
  const todayTask = pendingTask({ path: "notes/b.md", blockLink: " ^bbb", description: "today" });
  const tasks = [ordinary, todayTask];
  const isToday = (t) => t.blockLink === " ^bbb";
  const whole = laneBudgetFromTasks(tasks, DAY, defaultPlanCaps(), "pending");
  assert.equal(whole.count, 2);
  const section = dashboardLaneBudgetFromTasks(tasks, DAY, defaultPlanCaps(), "pending", isToday);
  assert.equal(section.section, 1);
  assert.equal(section.count, 1);
  assert.equal(section.lane, 2);
  assert.equal(section.today, 1);
  assert.equal(section.over, whole.over);
  const queried = querySection(tasks, "pending", { isToday });
  assert.equal(queried.length, 1);
  assert.deepEqual(identities(queried), identities([ordinary]));
  assert.equal(section.section, queried.length);
  // Unlinking changes section membership without changing sticky status.
  const unlinked = dashboardLaneBudgetFromTasks(tasks, DAY, defaultPlanCaps(), "pending", () => false);
  assert.equal(unlinked.section, 2);
  assert.equal(unlinked.lane, 2);
  assert.equal(tasks[1].status.type, "IN_PROGRESS");
});

test("NEXT section excludes TODAY while the whole lane keeps it", () => {
  const ordinary = nextTask({ path: "notes/a.md", blockLink: " ^aaa", description: "ordinary" });
  const todayTask = nextTask({ path: "notes/b.md", blockLink: " ^bbb", description: "today" });
  const tasks = [ordinary, todayTask];
  const isToday = (t) => t.blockLink === " ^bbb";
  const whole = laneBudgetFromTasks(tasks, DAY, defaultPlanCaps(), "next");
  assert.equal(whole.count, 2);
  const section = dashboardLaneBudgetFromTasks(tasks, DAY, defaultPlanCaps(), "next", isToday);
  assert.equal(section.section, 1);
  assert.equal(section.lane, 2);
  assert.equal(section.today, 1);
  const queried = querySection(tasks, "next", { isToday });
  assert.deepEqual(identities(queried), identities([ordinary]));
  assert.equal(section.section, queried.length);
});

test("NEXT uses symbol *, not name matching", () => {
  const tasks = [
    nextTask({ path: "notes/a.md", description: "star" }),
    task({ path: "notes/b.md", status: { type: "ON_HOLD", name: "Nextish", symbol: "?" }, description: "name-only" }),
  ];
  const section = dashboardLaneBudgetFromTasks(tasks, DAY, defaultPlanCaps(), "next", () => false);
  assert.equal(section.section, 1);
  const queried = querySection(tasks, "next", {});
  assert.equal(queried.length, 1);
  assert.equal(queried[0].description, "star");
});

test("READY badge and query agree on hide and path case variants", () => {
  const keep = task({ path: "notes/keep.md", description: "keep" });
  const tasks = [
    keep,
    task({ path: "2026/20260930.md", description: "daily" }),
    task({ path: "dash.md", description: "dash" }),
    task({ path: "DASH.MD", description: "dash-case" }),
    task({ path: "_templates/t.md", description: "tpl" }),
    task({ path: "_TEMPLATES/u.md", description: "tpl-case" }),
    task({ path: "notes/_conflicts/a.md", description: "conf" }),
    task({ path: "notes/_Conflicts/b.md", description: "conf-case" }),
    task({ path: "notes/h.md", tags: ["#task", "#hide"], description: "hide" }),
    task({ path: "notes/s.md", tags: ["#task", "#hide/x"], description: "subtag" }),
    task({ path: "notes/u.md", tags: ["#task", "#Hide"], description: "upper" }),
    task({ path: "notes/f.md", scheduledDate: new Date(2026, 9, 5), description: "future" }),
    task({ path: "notes/p.md", scheduledDate: new Date(2026, 8, 29), description: "past" }),
    task({ path: "notes/n.md", description: "none" }),
  ];
  const count = readyCountFromTasks(tasks, DAY, () => false);
  const queried = querySection(tasks, "ready", {});
  assert.equal(count, queried.length);
  assert.deepEqual(identities(queried), identities([keep, tasks[1], tasks[12], tasks[13]]));
  assert.equal(count, 4);
});

test("blocked uses the full list even outside the visible subset", () => {
  const blocker = pendingTask({ path: "_templates/hidden.md", description: "blocker" });
  const blocked = pendingTask({
    path: "notes/a.md",
    description: "blocked",
    isBlocked: (all) => Array.isArray(all) && all.includes(blocker),
  });
  const tasks = [blocked, blocker];
  const section = dashboardLaneBudgetFromTasks(tasks, DAY, defaultPlanCaps(), "pending", () => false);
  // The blocker is template-hidden; the blocked task still sees it.
  assert.equal(section.section, 0);
  const queried = querySection(tasks, "pending", {});
  assert.equal(queried.length, 0);
});

test("duplicate block IDs, missing IDs, and reused objects stay per-row", () => {
  const first = pendingTask({ path: "notes/a.md", blockLink: " ^dup", description: "first" });
  const second = pendingTask({ path: "notes/b.md", blockLink: " ^dup", description: "second" });
  const noId = pendingTask({ path: "notes/c.md", blockLink: undefined, description: "no-id" });
  const tasks = [first, second, noId];
  const section = dashboardLaneBudgetFromTasks(tasks, DAY, defaultPlanCaps(), "pending", () => false);
  assert.equal(section.section, 3);
  const queried = querySection(tasks, "pending", {});
  assert.equal(queried.length, 3);
  // A different object identity with the same path+link is still Today.
  const clone = pendingTask({ path: "notes/a.md", blockLink: " ^dup", description: "first" });
  const isToday = (t) => t.path === "notes/a.md" && t.blockLink === " ^dup";
  assert.equal(isToday(clone), true);
  const todaySection = dashboardLaneBudgetFromTasks([clone], DAY, defaultPlanCaps(), "pending", isToday);
  assert.equal(todaySection.section, 0);
});

test("READY gating keeps exempt rows and drops NEW/ROTTEN", () => {
  const fresh = task({ path: "notes/fresh.md", description: "fresh" });
  const fresh2 = task({ path: "notes/fresh2.md", description: "fresh2" });
  const newcomer = task({ path: "notes/new.md", description: "new" });
  const rotten = task({ path: "notes/rotten.md", description: "rotten" });
  const recurring = task({ path: "notes/rec.md", description: "recurring" });
  const daily = task({ path: "2026/20260930.md", description: "daily" });
  const todayTask = task({ path: "notes/today.md", description: "today" });
  const tasks = [fresh, fresh2, newcomer, rotten, recurring, daily, todayTask];
  const isReview = (t) => t.description === "new" || t.description === "rotten";
  const isToday = (t) => t.description === "today";
  const count = readyCountFromTasks(tasks, DAY, isToday, isReview);
  const queried = querySection(tasks, "ready", { isToday, isReviewBucket: isReview });
  assert.equal(count, queried.length);
  assert.deepEqual(identities(queried), identities([fresh, fresh2, recurring, daily]));
});

test("throwing Today degrades to unavailable, never zero", () => {
  const tasks = [pendingTask({ path: "notes/a.md" })];
  assert.throws(() =>
    dashboardLaneBudgetFromTasks(tasks, DAY, defaultPlanCaps(), "pending", () => {
      throw new Error("today failed");
    }),
  );
  const savedXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = "/definitely/missing/dashboard-parity-test";
  try {
    for (const setup of [
      {},
      { "obsidian-tasks-plugin": { getTasks: () => { throw new Error("no tasks"); } } },
      { "obsidian-tasks-plugin": { getTasks: () => tasks, getState: () => "Cold" } },
      { "obsidian-tasks-plugin": { getTasks: () => tasks, getState: () => "Initializing" } },
    ]) {
      const app = makeApp({ plugins: { plugins: setup } });
      const plugin = new LedgerToolsPlugin(app, {});
      plugin.onload();
      assert.equal(plugin.dashboardLaneBudget("pending").section, null);
      assert.equal(plugin.dashboardLaneBudget("next").section, null);
      const pendingModel = dashboardLaneBadgeModel(plugin.dashboardLaneBudget("pending"), "pending");
      assert.equal(pendingModel.placeholder, true);
      assert.equal(pendingModel.text, "PENDING –");
      plugin.onunload();
    }
    // Warm cache before the initial Today build stays unavailable.
    const warm = makeApp({
      plugins: { plugins: { "obsidian-tasks-plugin": { getTasks: () => tasks, getState: () => "Warm" } } },
    });
    const plugin = new LedgerToolsPlugin(warm, {});
    plugin.onload();
    assert.equal(plugin.dashboardLaneBudget("pending").section, null);
    plugin.onunload();
  } finally {
    if (savedXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = savedXdg;
    }
  }
});

test("dashboard badges color the displayed section count and label whole-lane pressure", () => {
  const model = dashboardLaneBadgeModel(
    { section: 1, lane: 2, count: 1, laneCount: 2, today: 1, cap: 10, over: false },
    "pending",
  );
  assert.equal(model.text, "PENDING 1/10");
  assert.match(model.tooltip, /1 in this section/);
  assert.match(model.tooltip, /whole lane 2\/10/);
  assert.match(model.tooltip, /1 in TODAY/);
  assert.match(model.aria, /1 of 10 in this section/);
  assert.equal(model.over, false);
  const sectionOver = dashboardLaneBadgeModel(
    { section: 11, lane: 12, count: 11, laneCount: 12, today: 1, cap: 10, over: true },
    "pending",
  );
  assert.equal(sectionOver.text, "PENDING 11/10");
  assert.equal(sectionOver.over, true);
  assert.match(sectionOver.tooltip, /11 in this section/);
  assert.match(sectionOver.tooltip, /whole lane 12\/10/);
  assert.match(sectionOver.tooltip, /1 over the section cap/);
  assert.match(sectionOver.tooltip, /2 over the whole-lane cap/);
  assert.doesNotMatch(sectionOver.tooltip, /over the limit/);
  assert.match(sectionOver.aria, /whole lane 12 of 10, 2 over the whole-lane cap/);
  assert.match(sectionOver.aria, /11 of 10 in this section, 1 over the section cap/);
  // READY keeps its n/cap fraction and unavailable behavior.
  const ready = readyBadgeModel({ count: 3, cap: 100, over: false });
  assert.equal(ready.text, "READY 3/100");
  const missing = readyBadgeModel({ count: null, cap: 100, over: false });
  assert.equal(missing.placeholder, true);
});

test("dashboard section warning boundaries ignore TODAY-only whole-lane excess", () => {
  const cases = [
    ["next", 10, 17, 7, 15, false],
    ["next", 15, 16, 1, 15, false],
    ["next", 16, 16, 0, 15, true],
    ["next", 15, 15, 0, 15, false],
    ["next", 0, 0, 0, 20, false],
    ["next", 21, 25, 4, 20, true],
    ["pending", 4, 11, 7, 10, false],
    ["pending", 10, 11, 1, 10, false],
    ["pending", 11, 11, 0, 10, true],
    ["pending", 10, 10, 0, 10, false],
  ];
  for (const [lane, section, whole, today, cap, over] of cases) {
    const model = dashboardLaneBadgeModel(
      { section, lane: whole, today, cap, over: whole > cap },
      lane,
    );
    assert.equal(model.text, `${lane.toUpperCase()} ${section}/${cap}`);
    assert.equal(model.over, over, `${lane} ${section}/${whole} (${today} today)`);
    assert.equal(model.laneOver, whole > cap);
    assert.equal(model.sectionOver, section > cap);
  }

  // Non-dashboard callers retain the independent whole-lane budget policy.
  const nextWhole = laneBudgetFromTasks(
    Array.from({ length: 17 }, (_, index) => nextTask({ path: `notes/n${index}.md` })),
    DAY,
    defaultPlanCaps(),
    "next",
  );
  const pendingWhole = laneBudgetFromTasks(
    Array.from({ length: 11 }, (_, index) => pendingTask({ path: `notes/p${index}.md` })),
    DAY,
    defaultPlanCaps(),
    "pending",
  );
  assert.deepEqual([nextWhole.count, nextWhole.over], [17, true]);
  assert.deepEqual([pendingWhole.count, pendingWhole.over], [11, true]);
});

test("dashboard lane badge keeps unavailable data neutral", () => {
  // Unavailable never renders as 0/cap.
  const missing = dashboardLaneBadgeModel(
    { section: null, lane: 17, count: null, laneCount: 17, today: 7, cap: 15, over: true },
    "pending",
  );
  assert.equal(missing.text, "PENDING –");
  assert.equal(missing.placeholder, true);
  assert.equal(missing.over, false);
  assert.ok(!missing.text.includes("/"));
  // Whole-lane excess remains visible in details without turning an at-cap
  // displayed section red.
  const edge = dashboardLaneBadgeModel(
    { section: 15, lane: 16, count: 15, laneCount: 16, today: 1, cap: 15, over: true },
    "next",
  );
  assert.equal(edge.text, "NEXT 15/15");
  assert.equal(edge.over, false);
  assert.match(edge.tooltip, /15 in this section/);
  assert.match(edge.tooltip, /whole lane 16\/15/);
  assert.match(edge.tooltip, /1 over the whole-lane cap/);
  assert.match(edge.aria, /whole lane 16 of 15, 1 over the whole-lane cap/);
});

test("dashboard lane paint and refresh keep color aligned with the visible section", () => {
  const savedXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = "/definitely/missing/dashboard-parity-test";
  const app = makeApp({
    vault: {
      getAbstractFileByPath: () => null,
      cachedRead: () => Promise.resolve("## Pomodoros\n"),
    },
    plugins: {
      plugins: {
        "obsidian-tasks-plugin": {
          getTasks: () => [
            pendingTask({ path: "notes/a.md", blockLink: " ^aaa", description: "a" }),
          ],
          getState: () => "Warm",
        },
      },
    },
  });
  const plugin = new LedgerToolsPlugin(app, {});
  try {
    plugin.onload();
    plugin.rebuildTodayCache("## Pomodoros\n", plugin.currentTodayDailyPath(DAY) || "2026/20260930.md", DAY);
    const host = {
      children: [],
      createEl(tag, options = {}) {
        const anchor = {
          tag,
          cls: options.cls,
          text: options.text,
          title: options.title,
          href: options.href,
          attrs: {},
          children: [],
          createEl: (childTag, childOptions = {}) => {
            const span = {
              tag: childTag,
              cls: childOptions.cls,
              text: childOptions.text,
              setText(value) {
                this.text = String(value);
              },
            };
            anchor.children.push(span);
            return span;
          },
          querySelector: (selector) => {
            const cls = String(selector).replace(/^\./, "");
            return anchor.children.find((child) => String(child.cls || "").split(/\s+/).includes(cls)) || null;
          },
          querySelectorAll: (selector) => {
            const cls = String(selector).replace(/^\./, "");
            return anchor.children.filter((child) => String(child.cls || "").split(/\s+/).includes(cls));
          },
          setAttribute: (key, value) => {
            anchor.attrs[key] = value;
          },
          hasAttribute: () => false,
          addEventListener: () => {},
        };
        this.children.push(anchor);
        return anchor;
      },
    };
    const el = plugin.paintDashboardLaneElement(
      host,
      "next",
      { section: 10, lane: 17, count: 10, laneCount: 17, today: 7, cap: 15, over: true },
      {},
    );
    assert.ok(el);
    const valueText = () => {
      const span = el.querySelector(".bob-plan-ready-value");
      return span ? span.text : null;
    };
    assert.equal(valueText(), "10/15");
    assert.doesNotMatch(el.cls, /bob-plan-over/);
    assert.match(el.title, /2 over the whole-lane cap/);
    assert.match(el.attrs["aria-label"], /NEXT: 10 of 15 in this section/);
    assert.equal(el.querySelectorAll(".bob-plan-ready-value").length, 1);
    assert.equal(el.querySelectorAll(".bob-plan-ready-label").length, 1);
    plugin.dashboardLaneWidgets.add({ el, lane: "next", sourcePath: "dash.md", component: null });
    let currentBudget = { section: 16, lane: 16, count: 16, laneCount: 16, today: 0, cap: 15, over: true };
    plugin.dashboardLaneBudget = () => currentBudget;
    // Detach the parent createEl so refresh takes the live-widget path.
    const parent = { createEl: host.createEl.bind(host) };
    Object.defineProperty(el, "parentNode", { value: parent, configurable: true });
    assert.equal(plugin.refreshDashboardLaneBadges(DAY), true);
    assert.equal(valueText(), "16/15");
    assert.match(el.cls, /bob-plan-over/);
    assert.equal(el.attrs.class, el.cls);
    assert.match(el.attrs.title, /1 over the section cap/);
    assert.match(el.attrs["aria-label"], /1 over the section cap/);
    assert.match(el.attrs["aria-label"], /1 over the whole-lane cap/);
    assert.equal(el.querySelectorAll(".bob-plan-ready-value").length, 1);
    // A reused anchor crosses back to the at-cap section state. Whole-lane
    // pressure remains in text, but the warning class clears immediately.
    currentBudget = { section: 15, lane: 16, count: 15, laneCount: 16, today: 1, cap: 15, over: true };
    assert.equal(plugin.refreshDashboardLaneBadges(DAY), true);
    assert.equal(valueText(), "15/15");
    assert.doesNotMatch(el.cls, /bob-plan-over/);
    assert.equal(el.attrs.class, el.cls);
    assert.match(el.attrs.title, /1 over the whole-lane cap/);
    assert.doesNotMatch(el.attrs["aria-label"], /over the section cap/);
    assert.match(el.attrs["aria-label"], /1 over the whole-lane cap/);
  } finally {
    plugin.onunload();
    if (savedXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = savedXdg;
    }
  }
});

test("dashboard lane widgets refresh together and prune on unload", () => {
  const savedXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = "/definitely/missing/dashboard-parity-test";
  const lanes = [pendingTask({ path: "notes/a.md", blockLink: " ^aaa", description: "a" })];
  const app = makeApp({
    vault: {
      getAbstractFileByPath: () => null,
      cachedRead: () => Promise.resolve("## Pomodoros\n"),
    },
    plugins: {
      plugins: {
        "obsidian-tasks-plugin": { getTasks: () => lanes, getState: () => "Warm" },
      },
    },
  });
  const plugin = new LedgerToolsPlugin(app, {});
  try {
    plugin.onload();
    plugin.rebuildTodayCache("## Pomodoros\n", plugin.currentTodayDailyPath(DAY) || "2026/20260930.md", DAY);
    const host = (name) => ({
      name,
      children: [],
      createEl: function (tag, options = {}) {
        const anchor = {
          tag,
          cls: options.cls,
          text: options.text,
          title: options.title,
          href: options.href,
          attrs: {},
          children: [],
          parentNode: this,
          isConnected: true,
          createEl: (childTag, childOptions = {}) => {
            const span = {
              tag: childTag,
              cls: childOptions.cls,
              text: childOptions.text,
              setText(value) {
                this.text = String(value);
              },
            };
            anchor.children.push(span);
            return span;
          },
          querySelector: (selector) => {
            const cls = String(selector).replace(/^\./, "");
            return anchor.children.find((child) => String(child.cls || "").split(/\s+/).includes(cls)) || null;
          },
          querySelectorAll: (selector) => {
            const cls = String(selector).replace(/^\./, "");
            return anchor.children.filter((child) => String(child.cls || "").split(/\s+/).includes(cls));
          },
          setAttribute: (key, value) => {
            anchor.attrs[key] = value;
          },
          hasAttribute: () => false,
          addEventListener: () => {},
          remove: () => {},
        };
        this.children.push(anchor);
        return anchor;
      },
      contains: function (node) {
        return node && node.parentNode === this;
      },
    });
    const pendingHost = host("pending");
    const nextHost = host("next");
    const component = { register: () => {} };
    const pendingEl = plugin.renderDashboardLaneBadge(pendingHost, { lane: "pending", sourcePath: "dash.md", component });
    assert.ok(pendingEl);
    assert.equal(plugin.dashboardLaneWidgets.size, 1);
    const nextEl = plugin.renderDashboardLaneBadge(nextHost, { lane: "next", sourcePath: "dash.md", component });
    assert.ok(nextEl);
    assert.equal(plugin.dashboardLaneWidgets.size, 2);
    // A rerender for the same component replaces instead of accumulating.
    const pendingAgain = plugin.renderDashboardLaneBadge(pendingHost, { lane: "pending", sourcePath: "dash.md", component });
    assert.ok(pendingAgain);
    assert.equal(plugin.dashboardLaneWidgets.size, 2);
    assert.equal(plugin.refreshDashboardLaneBadges(DAY), true);
    plugin.onunload();
    assert.equal(plugin.dashboardLaneWidgets.size, 0);
  } finally {
    if (savedXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = savedXdg;
    }
  }
});

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
        String(child.cls || "")
          .split(/\s+/)
          .includes(cls),
      );
      if (found) {
        return found;
      }
      for (const child of node.children) {
        const nested = child.querySelector(selector);
        if (nested) {
          return nested;
        }
      }
      return null;
    },
    querySelectorAll(selector) {
      const cls = String(selector).replace(/^\./, "");
      const out = [];
      const walk = (current) => {
        if (
          String(current.cls || "")
            .split(/\s+/)
            .includes(cls)
        ) {
          out.push(current);
        }
        for (const child of current.children || []) {
          walk(child);
        }
      };
      for (const child of node.children) {
        walk(child);
      }
      return out;
    },
  };
  return node;
}

function laneValue(anchor) {
  const span = anchor && anchor.querySelector(".bob-plan-ready-value");
  return span ? span.text : null;
}

function findLaneAnchor(el, lane) {
  const container = el.children[0];
  assert.ok(container, "expected the bob-plan container");
  const cls = lane === "next" ? "bob-plan-next" : "bob-plan-pending";
  const anchor = container.children.find((child) =>
    String(child.cls || "")
      .split(/\s+/)
      .includes(cls),
  );
  assert.ok(anchor, `expected the ${lane} anchor in the daily block`);
  return anchor;
}

function withParityPlugin(tasks, run, { todayIds = new Set(), opens = [] } = {}) {
  const savedXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = "/definitely/missing/dashboard-parity-test";
  const now = new Date();
  const app = makeApp({
    vault: {
      getAbstractFileByPath: () => ({ path: "2026/20260930.md" }),
      cachedRead: () =>
        Promise.resolve("## Pomodoros\n\n- [ ] () — GOALS\n"),
    },
    workspace: {
      on: () => ({}),
      offref: () => {},
      onLayoutReady: () => {},
      getActiveFile: () => null,
      openLinkText: (linktext, sourcePath, newLeaf) => {
        opens.push({ linktext, sourcePath, newLeaf });
        return Promise.resolve();
      },
      trigger: () => {},
    },
    plugins: {
      plugins: {
        "obsidian-tasks-plugin": {
          getTasks: () => tasks,
          getState: () => "Warm",
        },
      },
    },
  });
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.onload();
  plugin.rebuildTodayCache(
    "## Pomodoros\n",
    plugin.currentTodayDailyPath(now) || "2026/20260930.md",
    now,
  );
  plugin.isTodayTask = (task) => todayIds.has(task.blockLink);
  return Promise.resolve(run(plugin, now))
    .finally(() => {
      plugin.onunload();
      if (savedXdg === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = savedXdg;
      }
    });
}

test("daily paint matches dashboard section badges on screenshot fixtures", async () => {
  const nextTasks = Array.from({ length: 17 }, (_, index) =>
    nextTask({
      path: `notes/n${index}.md`,
      blockLink: ` ^n${index}`,
      description: `next ${index}`,
    }),
  );
  const todayIds = new Set(
    nextTasks.slice(10).map((task) => task.blockLink),
  );
  await withParityPlugin(nextTasks, async (plugin) => {
    const dailyEl = paintNode("div");
    plugin.paintPlanBlock(dailyEl, "2026/20260930.md");
    await new Promise((resolve) => setImmediate(resolve));
    const dashHost = paintNode("div");
    const dash = plugin.paintDashboardLaneElement(
      dashHost,
      "next",
      plugin.dashboardLaneBudget("next"),
      { sourcePath: "dash.md" },
    );
    const daily = findLaneAnchor(dailyEl, "next");
    assert.equal(laneValue(daily), "10/15");
    assert.equal(laneValue(dash), "10/15");
    assert.doesNotMatch(daily.cls, /bob-plan-over/);
    assert.doesNotMatch(dash.cls, /bob-plan-over/);
    assert.equal(daily.title, dash.title);
    assert.equal(daily.attrs["aria-label"], dash.attrs["aria-label"]);
    assert.match(daily.title, /whole lane 17\/15/);
    const container = dailyEl.children[0];
    assert.match(container.attrs["aria-label"], /NEXT 10\/15/);
    assert.doesNotMatch(container.attrs["aria-label"], /over plan/);
    const lint = container.children.find((child) =>
      String(child.cls || "").includes("bob-plan-lint"),
    );
    assert.match(
      lint.text,
      /NEXT whole lane has 17\/15 tasks \(including TODAY\)/,
    );
    assert.equal(plugin.dashboardLaneWidgets.size, 0);
  }, { todayIds });
});

test("daily and dashboard membership agree for exclusions and custom IN_PROGRESS", async () => {
  const keepPending = pendingTask({
    path: "notes/keep.md",
    blockLink: " ^keep",
    description: "keep",
  });
  const customPending = pendingTask({
    path: "notes/custom.md",
    blockLink: " ^custom",
    description: "custom",
    status: { type: "IN_PROGRESS", name: "Doing", symbol: ">" },
  });
  const keepNext = nextTask({
    path: "notes/next.md",
    blockLink: " ^next",
    description: "next",
  });
  const tasks = [
    keepPending,
    customPending,
    keepNext,
    pendingTask({ path: "dash.md", blockLink: " ^dash", description: "dash" }),
    pendingTask({
      path: "_templates/t.md",
      blockLink: " ^tpl",
      description: "tpl",
    }),
    pendingTask({
      path: "notes/_conflicts/a.md",
      blockLink: " ^conf",
      description: "conf",
    }),
    pendingTask({
      path: "notes/h.md",
      blockLink: " ^hide",
      tags: ["#task", "#hide"],
      description: "hide",
    }),
    pendingTask({
      path: "notes/f.md",
      blockLink: " ^fut",
      scheduledDate: new Date(2099, 0, 1),
      description: "future",
    }),
    pendingTask({
      path: "notes/d.md",
      blockLink: " ^done",
      status: { type: "DONE", name: "Done", symbol: "x" },
      description: "done",
    }),
    pendingTask({
      path: "notes/b.md",
      blockLink: " ^blk",
      description: "blocked",
      isBlocked: () => true,
    }),
    nextTask({
      path: "notes/today-next.md",
      blockLink: " ^today",
      description: "today-next",
    }),
  ];
  const todayIds = new Set([" ^today"]);
  const pendingQuery = querySection(tasks, "pending", {
    isToday: (t) => todayIds.has(t.blockLink),
  });
  const nextQuery = querySection(tasks, "next", {
    isToday: (t) => todayIds.has(t.blockLink),
  });
  assert.deepEqual(
    identities(pendingQuery),
    identities([keepPending, customPending]),
  );
  assert.deepEqual(identities(nextQuery), identities([keepNext]));
  await withParityPlugin(tasks, async (plugin) => {
    const dailyEl = paintNode("div");
    plugin.paintPlanBlock(dailyEl, "2026/20260930.md");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(laneValue(findLaneAnchor(dailyEl, "pending")), "2/10");
    assert.equal(laneValue(findLaneAnchor(dailyEl, "next")), "1/15");
    assert.equal(plugin.dashboardLaneBudget("pending").section, pendingQuery.length);
    assert.equal(plugin.dashboardLaneBudget("next").section, nextQuery.length);
  }, { todayIds });
});

test("daily paint refreshes with dashboard when Today, lane, and cap change", async () => {
  const tasks = [
    nextTask({ path: "notes/a.md", blockLink: " ^a", description: "a" }),
    nextTask({ path: "notes/b.md", blockLink: " ^b", description: "b" }),
  ];
  const todayIds = new Set();
  await withParityPlugin(tasks, async (plugin) => {
    const dailyEl = paintNode("div");
    const dashHost = paintNode("div");
    plugin.renderPlanBlock(dailyEl, { sourcePath: "2026/20260930.md" });
    await new Promise((resolve) => setImmediate(resolve));
    const dash = plugin.renderDashboardLaneBadge(dashHost, {
      lane: "next",
      sourcePath: "dash.md",
    });
    assert.equal(laneValue(findLaneAnchor(dailyEl, "next")), "2/15");
    assert.equal(laneValue(dash), "2/15");
    todayIds.add(" ^a");
    plugin.rerenderPlanBlocks();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(laneValue(findLaneAnchor(dailyEl, "next")), "1/15");
    assert.equal(laneValue(dash), "1/15");
    tasks[1].status = { type: "TODO", name: "Todo", symbol: " " };
    plugin.rerenderPlanBlocks();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(laneValue(findLaneAnchor(dailyEl, "next")), "0/15");
    assert.equal(laneValue(dash), "0/15");
    const extra = Array.from({ length: 16 }, (_, index) =>
      nextTask({
        path: `notes/x${index}.md`,
        blockLink: ` ^x${index}`,
        description: `x${index}`,
      }),
    );
    tasks.push(...extra);
    plugin.rerenderPlanBlocks();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(laneValue(findLaneAnchor(dailyEl, "next")), "16/15");
    assert.match(findLaneAnchor(dailyEl, "next").cls, /bob-plan-over/);
    assert.match(dash.cls, /bob-plan-over/);
    tasks.pop();
    plugin.rerenderPlanBlocks();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(laneValue(findLaneAnchor(dailyEl, "next")), "15/15");
    assert.doesNotMatch(findLaneAnchor(dailyEl, "next").cls, /bob-plan-over/);
    assert.doesNotMatch(dash.cls, /bob-plan-over/);
  }, { todayIds });
});

test("older daily notes follow today's dashboard lanes", async () => {
  const tasks = [
    nextTask({ path: "notes/a.md", blockLink: " ^a", description: "a" }),
    nextTask({ path: "notes/b.md", blockLink: " ^b", description: "b" }),
  ];
  await withParityPlugin(tasks, async (plugin) => {
    const oldReads = [];
    const originalRead = plugin.readPlanBlockContent.bind(plugin);
    plugin.readPlanBlockContent = (path) => {
      oldReads.push(path);
      if (path === "2026/20250101.md") {
        return Promise.resolve("## Pomodoros\n\n- [ ] () — OLD\n    - [[gone#^z]]\n");
      }
      return originalRead(path);
    };
    const dailyEl = paintNode("div");
    plugin.paintPlanBlock(dailyEl, "2026/20250101.md");
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(oldReads.includes("2026/20250101.md"));
    const container = dailyEl.children[0];
    assert.match(container.attrs["aria-label"], /TODAY 1\/3 · 1\/10/);
    assert.equal(laneValue(findLaneAnchor(dailyEl, "next")), "2/15");
    const dashHost = paintNode("div");
    const dash = plugin.paintDashboardLaneElement(
      dashHost,
      "next",
      plugin.dashboardLaneBudget("next"),
      { sourcePath: "dash.md" },
    );
    assert.equal(laneValue(dash), "2/15");
  });
});

test("daily lane anchors keep shared navigation and reject stale paints", async () => {
  const tasks = [
    nextTask({ path: "notes/a.md", blockLink: " ^a", description: "a" }),
  ];
  const opens = [];
  await withParityPlugin(tasks, async (plugin) => {
    const dailyEl = paintNode("div");
    plugin.paintPlanBlock(dailyEl, "notes/old-daily.md");
    await new Promise((resolve) => setImmediate(resolve));
    const next = findLaneAnchor(dailyEl, "next");
    assert.equal(next.attrs.role, "link");
    assert.equal(next.attrs.tabindex, "0");
    next.listeners.click[0]({
      preventDefault() {},
      ctrlKey: true,
    });
    assert.deepEqual(opens[0], {
      linktext: "dash#NEXT Tasks",
      sourcePath: "notes/old-daily.md",
      newLeaf: true,
    });
    next.listeners.keydown[0]({
      preventDefault() {},
      key: "Enter",
    });
    assert.equal(opens[1].linktext, "dash#NEXT Tasks");
    let releaseFirst;
    plugin.readPlanBlockContent = () =>
      new Promise((resolve) => {
        releaseFirst = resolve;
      });
    plugin.paintPlanBlock(dailyEl, "notes/old-daily.md");
    plugin.readPlanBlockContent = () =>
      Promise.resolve("## Pomodoros\n\n- [ ] () — GOALS\n");
    plugin.paintPlanBlock(dailyEl, "notes/old-daily.md");
    await new Promise((resolve) => setImmediate(resolve));
    releaseFirst("## Pomodoros\n\n- [ ] () — STALE\n");
    await new Promise((resolve) => setImmediate(resolve));
    assert.doesNotMatch(
      dailyEl.children[0].attrs["aria-label"],
      /STALE/,
    );
    assert.equal(laneValue(findLaneAnchor(dailyEl, "next")), "1/15");
  }, { opens });
});

test("daily paint stays unavailable until Tasks and Today are ready", async () => {
  const savedXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = "/definitely/missing/dashboard-parity-test";
  try {
    const plugin = new LedgerToolsPlugin(makeApp({}), {});
    plugin.onload();
    plugin.readPlanBlockContent = () =>
      Promise.resolve("## Pomodoros\n\n- [ ] () — GOALS\n");
    const el = paintNode("div");
    plugin.paintPlanBlock(el, "2026/20260930.md");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(laneValue(findLaneAnchor(el, "next")), "–");
    assert.doesNotMatch(findLaneAnchor(el, "next").cls, /bob-plan-over/);
    plugin.onunload();
  } finally {
    if (savedXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = savedXdg;
    }
  }
});
