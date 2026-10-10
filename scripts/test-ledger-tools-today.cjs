// Tests for the bob-ledger-tools Today mirror and api v2 (`docs/plan.md`
// in bob-cli is the authoritative definition; the T-vectors below encode
// the "Today conformance examples" from that page verbatim, with a stub
// resolver standing in for `metadataCache.getFirstLinkpathDest`).
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

class TestNotice {
  constructor(message) {
    TestNotice.messages.push(String(message));
  }
}
TestNotice.messages = [];

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: TestMarkdownView,
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
  TODAY_RELOAD_EVENT,
  computeTodayLinks,
  defaultPlanCaps,
  laneBudgetFromTasks,
  resolveTodayKeys,
  todayDailyPath,
} = helpers;

const DAILY = "2026/20261001.md";

// A stub `getFirstLinkpathDest`: `targets` maps a written target to the
// vault-relative path it resolves to (without `.md`, as Obsidian returns
// file objects whose `.path` carries the extension).
function stubResolve(targets) {
  return (target) => {
    if (!Object.hasOwn(targets, target)) {
      return null;
    }
    return { path: targets[target] };
  };
}

function keysFor(content, dailyPath, targets) {
  return resolveTodayKeys(
    computeTodayLinks(content, dailyPath),
    dailyPath,
    stubResolve(targets),
  );
}

// docs/plan.md T1: an exempt entry's empty-target link resolves to the
// daily note itself.
test("T1 GTD: empty target resolves to the daily note", () => {
  const content = "## Pomodoros\n\n- [ ] () — GTD\n    - [[#^gtd]]\n";
  const links = computeTodayLinks(content, DAILY);
  assert.equal(links.length, 1);
  assert.equal(links[0].target, "");
  assert.equal(links[0].blockId, "gtd");
  assert.equal(links[0].embedded, false);
  assert.deepEqual(keysFor(content, DAILY, {}), [`${DAILY}#gtd`]);
});

// docs/plan.md T2: `🍅 [[a#^x]]` counts, `~~[[a#^y]]~~` doesn't,
// `![[a#^z]]` counts.
test("T2 markers: pomodoro mark counts, struck drops, embed counts", () => {
  const content =
    "## Pomodoros\n\n" +
    "- [ ] () — GOALS\n" +
    "    - 🍅 [[a#^x]]\n" +
    "    - ~~[[a#^y]]~~\n" +
    "    - ![[a#^z]]\n";
  const links = computeTodayLinks(content, DAILY);
  assert.deepEqual(
    links.map((link) => [link.target, link.blockId, link.embedded]),
    [
      ["a", "x", false],
      ["a", "z", true],
    ],
  );
  assert.deepEqual(keysFor(content, DAILY, { a: "a.md" }), [
    "a.md#x",
    "a.md#z",
  ]);
});

// docs/plan.md T3: links under `[x]` and `[-]` entries don't count.
test("T3 closed entries: links under completed/cancelled entries drop", () => {
  const content =
    "## Pomodoros\n\n" +
    "- [x] () — DONE\n" +
    "    - [[a#^x]]\n" +
    "- [-] () — GONE\n" +
    "    - [[a#^y]]\n" +
    "- [ ] () — OPEN\n";
  assert.deepEqual(computeTodayLinks(content, DAILY), []);
  assert.deepEqual(keysFor(content, DAILY, { a: "a.md" }), []);
});

// docs/plan.md T4: a mixed bullet and a link nested under a note bullet
// don't count.
test("T4 shapes: mixed text and deeper descendants drop", () => {
  const content =
    "## Pomodoros\n\n" +
    "- [ ] () — GOALS\n" +
    "    - Review [[a#^m]]\n" +
    "    - Note text\n" +
    "        - [[a#^deep]]\n";
  assert.deepEqual(computeTodayLinks(content, DAILY), []);
  assert.deepEqual(keysFor(content, DAILY, { a: "a.md" }), []);
});

// docs/plan.md T5: one task under two open entries, plus `[[a#^x]]` and
// `[[dir/a#^x]]` resolving to the same note → one key at first position.
test("T5 dedupe: same task twice keeps the first position", () => {
  const content =
    "## Pomodoros\n\n" +
    "- [ ] () — ONE\n" +
    "    - [[a#^x]]\n" +
    "- [ ] () — TWO\n" +
    "    - [[a#^x]]\n" +
    "    - [[dir/a#^x]]\n";
  const links = computeTodayLinks(content, DAILY);
  assert.equal(links.length, 3);
  assert.equal(links[0].entryLine, 3);
  assert.deepEqual(
    keysFor(content, DAILY, { a: "dir/a.md", "dir/a": "dir/a.md" }),
    ["dir/a.md#x"],
  );
});

// docs/plan.md T6: a link inside a fenced block doesn't count.
test("T6 fenced: links inside fenced blocks drop", () => {
  const content =
    "## Pomodoros\n\n" +
    "- [ ] () — GOALS\n" +
    "    - [[a#^x]]\n" +
    "\n" +
    "```\n" +
    "- [[a#^q]]\n" +
    "```\n";
  assert.deepEqual(keysFor(content, DAILY, { a: "a.md" }), ["a.md#x"]);
});

// docs/plan.md T7: linked `[x]` and `[-]` tasks drop out; `[?]` stays.
// Task status lives in the Tasks cache in JavaScript, so the link layer
// lists every dedicated link.
test("T7 status: the link layer lists every dedicated link", () => {
  const content =
    "## Pomodoros\n\n" +
    "- [ ] () — GOALS\n" +
    "    - [[a#^x]]\n" +
    "    - [[a#^y]]\n" +
    "    - [[a#^z]]\n" +
    "    - [[a#^w]]\n";
  assert.deepEqual(keysFor(content, DAILY, { a: "a.md" }), [
    "a.md#x",
    "a.md#y",
    "a.md#z",
    "a.md#w",
  ]);
});

// docs/plan.md T8: `[[missing#^q]]` gives no key (Rust reports
// `today_link_unresolved`; JavaScript skips unresolved targets).
test("T8 unresolved: missing notes give no key", () => {
  const content =
    "## Pomodoros\n\n- [ ] () — GOALS\n    - [[missing#^q]]\n";
  assert.deepEqual(keysFor(content, DAILY, {}), []);
});

// docs/plan.md T9: `[[a#^x|alias]]` counts, pinned to whatever
// `list_queued_links` does with aliases.
test("T9 alias: aliased links count under their target", () => {
  const content =
    "## Pomodoros\n\n- [ ] () — GOALS\n    - [[a#^x|alias]]\n";
  const links = computeTodayLinks(content, DAILY);
  assert.equal(links.length, 1);
  assert.equal(links[0].target, "a");
  assert.equal(links[0].blockId, "x");
  assert.deepEqual(keysFor(content, DAILY, { a: "a.md" }), ["a.md#x"]);
});

test("laneBudgetFromTasks counts the whole Next lane, Today included", () => {
  const today = new Date(2026, 8, 30);
  const next = (overrides = {}) => ({
    description: "next",
    tags: ["#task"],
    path: "notes/a.md",
    status: { type: "ON_HOLD", name: "Next", symbol: "*" },
    isBlocked: () => false,
    ...overrides,
  });
  const tasks = [
    next(),
    next({ status: { type: "DONE", name: "Done", symbol: "x" } }),
    next({ tags: ["#task", "#hide"] }),
    next({ path: "_templates/x.md" }),
    next({ scheduledDate: new Date(2026, 9, 1) }),
    next({ isBlocked: () => true }),
    next({ status: { type: "TODO", name: "Todo", symbol: " " } }),
  ];
  const budget = laneBudgetFromTasks(tasks, today, undefined, "next");
  assert.equal(budget.count, 1);
  assert.equal(budget.cap, 15);
  assert.equal(budget.over, false);
});

test("laneBudgetFromTasks counts Pending by type and flags over-cap", () => {
  const today = new Date(2026, 8, 30);
  const tasks = Array.from({ length: 11 }, (_, index) => ({
    description: `pending ${index}`,
    tags: ["#task"],
    path: "notes/a.md",
    status: { type: "IN_PROGRESS", name: "In Progress", symbol: "/" },
  }));
  const budget = laneBudgetFromTasks(tasks, today, undefined, "pending");
  assert.equal(budget.count, 11);
  assert.equal(budget.cap, 10);
  assert.equal(budget.over, true);
});

test("lane caps come from max_next/max_pending; legacy max_now is ignored", () => {
  const task = {
    description: "next",
    tags: ["#task"],
    path: "notes/a.md",
    status: { type: "ON_HOLD", name: "Next", symbol: "*" },
  };
  const budget = laneBudgetFromTasks(
    [task],
    new Date(2026, 8, 30),
    { max_now: 99, maxNext: 20, maxPending: 12 },
    "next",
  );
  assert.equal(budget.cap, 20);
  const pending = laneBudgetFromTasks(
    [],
    new Date(2026, 8, 30),
    { max_now: 99 },
    "pending",
  );
  assert.equal(pending.cap, 10);
});

test("reload event name matches the Tasks bundle subscription", () => {
  // Pinned: TasksEvents.onReloadOpenSearchResults subscribes under exactly
  // this name in the installed obsidian-tasks-plugin bundle.
  assert.equal(
    TODAY_RELOAD_EVENT,
    "obsidian-tasks-plugin:reload-open-search-results",
  );
});

function makeTodayApp({ files, targets, triggers } = {}) {
  const metadataHandlers = {};
  return {
    metadataHandlers,
    internalPlugins: { plugins: {} },
    vault: {
      getAbstractFileByPath: (path) =>
        files && files[path] ? { path } : null,
      cachedRead: (file) =>
        Promise.resolve(files && files[file.path] ? files[file.path] : null),
      on: () => ({}),
    },
    workspace: {
      on: () => ({}),
      offref: () => {},
      onLayoutReady: () => {},
      getActiveFile: () => null,
      trigger: (event) => {
        triggers.push(event);
      },
    },
    metadataCache: {
      on: (event, handler) => {
        metadataHandlers[event] = handler;
        return {};
      },
      getFirstLinkpathDest: (target) =>
        targets && Object.hasOwn(targets, target)
          ? { path: targets[target] }
          : null,
    },
    plugins: { plugins: {} },
  };
}

function withMissingConfig(run) {
  const savedXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = "/definitely/missing/ledger-tools-today-test";
  try {
    return run();
  } finally {
    if (savedXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = savedXdg;
    }
  }
}

const LEDGER = "## Pomodoros\n\n- [ ] () — GOALS\n    - [[a#^x]]\n";

test("api v2 shape: Today and lane budgets, no nowBudget", () => {
  // Note: the plugin now exposes api v3 (additive: freshness); the v2
  // members asserted below are unchanged.
  withMissingConfig(() => {
    const app = makeTodayApp({ files: {}, targets: {}, triggers: [] });
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.onload();
    try {
      assert.equal(plugin.api.version, 3);
      assert.equal(typeof plugin.api.caps, "function");
      assert.equal(typeof plugin.api.planBudget, "function");
      assert.equal(typeof plugin.api.todayKeys, "function");
      assert.equal(typeof plugin.api.isToday, "function");
      assert.equal(typeof plugin.api.todayRank, "function");
      assert.equal(typeof plugin.api.nextBudget, "function");
      assert.equal(typeof plugin.api.pendingBudget, "function");
      assert.equal(plugin.api.nowBudget, undefined);
      assert.deepEqual(plugin.api.todayKeys(), []);
      assert.equal(
        plugin.api.isToday({ path: "a.md", blockLink: " ^x" }),
        false,
      );
      assert.equal(
        plugin.api.todayRank({ path: "a.md", blockLink: " ^x" }),
        Number.MAX_SAFE_INTEGER,
      );
      // Missing fields degrade to false, never an error.
      assert.equal(plugin.api.isToday({}), false);
      assert.equal(plugin.api.isToday(null), false);
      assert.equal(
        plugin.api.todayRank({ path: "a.md" }),
        Number.MAX_SAFE_INTEGER,
      );
    } finally {
      plugin.onunload();
    }
  });
});

test("cache rebuild answers isToday/todayRank in ledger order", () => {
  withMissingConfig(() => {
    const triggers = [];
    const app = makeTodayApp({ files: {}, targets: { a: "a.md" }, triggers });
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.onload();
    try {
      const content =
        "## Pomodoros\n\n" +
        "- [ ] () — ONE\n" +
        "    - [[a#^x]]\n" +
        "- [ ] () — TWO\n" +
        "    - [[a#^z]]\n";
      const changed = plugin.rebuildTodayCache(content, DAILY);
      assert.equal(changed, true);
      assert.deepEqual(plugin.api.todayKeys(), ["a.md#x", "a.md#z"]);
      assert.equal(
        plugin.api.isToday({ path: "a.md", blockLink: " ^x" }),
        true,
      );
      assert.equal(
        plugin.api.isToday({ path: "a.md", blockLink: " ^other" }),
        false,
      );
      assert.equal(
        plugin.api.todayRank({ path: "a.md", blockLink: " ^z" }),
        1,
      );
      // todayKeys returns a copy.
      const keys = plugin.api.todayKeys();
      keys.push("forged.md#q");
      assert.deepEqual(plugin.api.todayKeys(), ["a.md#x", "a.md#z"]);
    } finally {
      plugin.onunload();
    }
  });
});

test("refresh fires only when the key set changes", () => {
  withMissingConfig(() => {
    const triggers = [];
    const app = makeTodayApp({ files: {}, targets: { a: "a.md" }, triggers });
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.onload();
    try {
      assert.equal(plugin.rebuildTodayCache(LEDGER, DAILY), true);
      assert.deepEqual(triggers, [TODAY_RELOAD_EVENT]);
      assert.equal(plugin.rebuildTodayCache(LEDGER, DAILY), false);
      assert.deepEqual(triggers, [TODAY_RELOAD_EVENT]);
      assert.equal(
        plugin.rebuildTodayCache(
          "## Pomodoros\n\n- [ ] () — GOALS\n    - [[a#^y]]\n",
          DAILY,
        ),
        true,
      );
      assert.deepEqual(triggers, [TODAY_RELOAD_EVENT, TODAY_RELOAD_EVENT]);
    } finally {
      plugin.onunload();
    }
  });
});

test("unready to ready with empty TODAY still refreshes open badges", () => {
  withMissingConfig(() => {
    const now = new Date(2026, 8, 30);
    const triggers = [];
    const app = makeTodayApp({ files: {}, targets: {}, triggers });
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.onload();
    try {
      const dailyPath =
        plugin.currentTodayDailyPath(now) || "2026/20260930.md";
      const scheduled = [];
      plugin.schedulePlanBlockRerender = () => scheduled.push("plan");
      assert.equal(plugin.isTodayCacheReady(now), false);
      assert.equal(
        plugin.rebuildTodayCache("## Pomodoros\n", dailyPath, now),
        false,
      );
      assert.equal(plugin.isTodayCacheReady(now), true);
      assert.deepEqual(plugin.api.todayKeys(), []);
      assert.deepEqual(triggers, [TODAY_RELOAD_EVENT]);
      assert.deepEqual(scheduled, ["plan"]);
      assert.equal(
        plugin.rebuildTodayCache("## Pomodoros\n", dailyPath, now),
        false,
      );
      assert.deepEqual(triggers, [TODAY_RELOAD_EVENT]);
      assert.deepEqual(scheduled, ["plan"]);
    } finally {
      plugin.onunload();
    }
  });
});

test("cache rebuilds on the daily changed event with the event content", () => {
  withMissingConfig(() => {
    const day = new Date(2026, 8, 30);
    const dailyPath = todayDailyPath(day, {});
    const triggers = [];
    const app = makeTodayApp({ files: {}, targets: { a: "a.md" }, triggers });
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.onload();
    try {
      const handler = app.metadataHandlers.changed;
      assert.equal(typeof handler, "function");
      // An unrelated note never touches the cache.
      assert.equal(
        plugin.refreshTodayCacheForChangedFile(
          { path: "notes/other.md" },
          LEDGER,
          day,
        ),
        false,
      );
      assert.deepEqual(plugin.api.todayKeys(), []);
      // The daily note rebuilds synchronously from the event content.
      assert.equal(
        plugin.refreshTodayCacheForChangedFile(
          { path: dailyPath },
          LEDGER,
          day,
        ),
        true,
      );
      assert.deepEqual(plugin.api.todayKeys(), ["a.md#x"]);
      assert.deepEqual(triggers, [TODAY_RELOAD_EVENT]);
    } finally {
      plugin.onunload();
    }
  });
});

test("cache rebuilds once on resolved and at midnight rollover", async () => {
  await withMissingConfig(async () => {
    const first = new Date(2026, 8, 30);
    const firstPath = todayDailyPath(first, {});
    const files = { [firstPath]: LEDGER };
    const triggers = [];
    const app = makeTodayApp({ files, targets: { a: "a.md" }, triggers });
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.onload();
    try {
      assert.equal(typeof app.metadataHandlers.resolved, "function");
      await plugin.refreshTodayCacheFromDaily(first);
      assert.deepEqual(plugin.api.todayKeys(), ["a.md#x"]);
      // Same day: no rebuild.
      assert.equal(plugin.refreshTodayCacheForRollover(first), false);
      // Next day: the daily path changed, so rebuild (empty Today here).
      const next = new Date(2026, 9, 1);
      assert.equal(plugin.refreshTodayCacheForRollover(next), true);
      await Promise.resolve();
      await Promise.resolve();
      assert.deepEqual(plugin.api.todayKeys(), []);
    } finally {
      plugin.onunload();
    }
  });
});
