const assert = require("node:assert/strict");
const test = require("node:test");
const {
  LedgerToolsPlugin,
  TODAY_RELOAD_EVENT,
  freshnessStatusView,
  formatLocalDate,
  makeFreshnessTask,
  makeFreshnessApp,
  withMissingConfig,
  makeStatusEl,
} = require("./ledger-tools-harness.cjs");
test("freshness namespace v9 advertises checklist and recurring tiers without changing buckets", () => {
  withMissingConfig(() => {
    const tasks = [makeFreshnessTask()];
    const plugin = new LedgerToolsPlugin(makeFreshnessApp({ tasks }), {});
    plugin.onload();
    try {
      assert.equal(plugin.api.version, 3);
      for (const key of [
        "caps",
        "planBudget",
        "todayKeys",
        "isToday",
        "todayRank",
        "nextBudget",
        "pendingBudget",
      ]) {
        assert.equal(typeof plugin.api[key], "function", `v2 member ${key}`);
      }
      assert.equal(plugin.api.nowBudget, undefined);
      const freshness = plugin.api.freshness;
      assert.equal(freshness.version, 9);
      assert.equal(freshness.checklistTiers, true);
      assert.equal(freshness.recurringTier, true);
      for (const key of [
        "config",
        "stampLine",
        "setRefreshLine",
        "keepLine",
        "state",
        "bucket",
        "reviewModel",
        "isDue",
        "tier",
        "rank",
        "intervalFor",
        "intervalForLine",
        "queue",
        "counts",
        "lints",
        "reviewEntryView",
      ]) {
        assert.equal(typeof freshness[key], "function", `freshness ${key}`);
      }
      const apiConfig = freshness.config();
      assert.deepEqual(apiConfig, {
        interval: 7,
        pendingInterval: 1,
        nextInterval: 1,
        projectInterval: null,
        referenceInterval: null,
        rottenDailyBudget: null,
        intervalFromConfig: false,
        invalid: false,
        deprecatedStaleBudget: false,
        decay: { enabled: true, keeps: 3, enter: null },
      });
      assert.equal(apiConfig.activeFrom, undefined);
      assert.equal(apiConfig.active, undefined);
      assert.deepEqual(Object.keys(apiConfig.decay).sort(), [
        "enabled",
        "enter",
        "keeps",
      ]);
      assert.equal(freshness.state(tasks[0]), "new");
      assert.equal(freshness.bucket(tasks[0]), "new");
      assert.equal(freshness.isDue(tasks[0]), true);
      assert.equal(freshness.tier(tasks[0]), "new");
      assert.equal(freshness.rank(tasks[0]), 0);
      assert.deepEqual(freshness.intervalFor(tasks[0]), {
        days: 7,
        source: "default",
      });
      assert.deepEqual(
        freshness.intervalForLine("- [*] #task N [refresh:: 14]", null),
        { days: 1, source: "next", ready: { days: 14, source: "task" } },
      );
      assert.equal(freshness.queue().length, 1);
      assert.equal(freshness.queue()[0].tier, "new");
      assert.equal(freshness.queue()[0].tierLabel, "NEW");
      assert.equal(freshness.queue()[0].lane, "ready");
      assert.equal(freshness.counts().due, 1);
      assert.equal(freshness.counts().walk, 1);
      assert.deepEqual(freshness.lints(), []);
      assert.equal(
        freshness.stampLine("- [ ] #task Buy milk", "2026-10-08"),
        "- [ ] #task Buy milk [fresh:: 2026-10-08]",
      );
    } finally {
      plugin.onunload();
    }
  });
});

test("checklist rows report tier and rank while keeping the READY bucket null", () => {
  withMissingConfig(() => {
    const task = makeFreshnessTask({
      tags: ["#task", "#gtd", "#pre"],
      recurrence: { rule: "every day" },
      path: "gtd_daily.md",
      lineNumber: 0,
      description: "Brush teeth",
      originalMarkdown:
        "- [ ] #task #gtd #pre Brush teeth [repeat:: every day when done]",
    });
    const plugin = new LedgerToolsPlugin(makeFreshnessApp({ tasks: [task] }), {});
    plugin.onload();
    try {
      const freshness = plugin.api.freshness;
      assert.equal(freshness.tier(task), "pre");
      assert.equal(freshness.isDue(task), true);
      assert.equal(freshness.rank(task), 0);
      assert.equal(freshness.state(task), null);
      assert.equal(freshness.bucket(task), null);
      assert.deepEqual(freshness.queue().map((entry) => entry.tier), ["pre"]);
    } finally {
      plugin.onunload();
    }
  });
});

test("tier, isDue, and rank cover lane rows", () => {
  withMissingConfig(() => {
    const todayText = formatLocalDate(new Date());
    const yesterday = (() => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return formatLocalDate(d);
    })();
    const nextTask = makeFreshnessTask({
      status: { type: "ON_HOLD", name: "Next", symbol: "*" },
      path: "notes/n.md",
      lineNumber: 0,
      description: "Next",
      originalMarkdown: `- [*] #task Next [fresh:: ${yesterday}]`,
    });
    const readyTask = makeFreshnessTask({
      path: "notes/a.md",
      lineNumber: 1,
      description: "Ready",
      originalMarkdown: "- [ ] #task Ready [fresh:: 2026-09-20]",
    });
    const tasks = [readyTask, nextTask];
    const plugin = new LedgerToolsPlugin(makeFreshnessApp({ tasks }), {});
    plugin.onload();
    try {
      const freshness = plugin.api.freshness;
      assert.equal(freshness.state(nextTask), null);
      assert.equal(freshness.bucket(nextTask), null);
      assert.equal(freshness.tier(nextTask), "next");
      assert.equal(freshness.isDue(nextTask), true);
      assert.equal(freshness.tier(readyTask), "rotten");
      assert.equal(freshness.isDue(readyTask), true);
      const queue = freshness.queue();
      assert.deepEqual(
        queue.map((entry) => entry.tier),
        ["next", "rotten"],
      );
      // Rank covers lane rows: the lane row sorts before ROTTEN.
      assert.equal(freshness.rank(nextTask), 0);
      assert.equal(freshness.rank(readyTask), 1);
      assert.deepEqual(freshness.intervalFor(nextTask), {
        days: 1,
        source: "next",
      });
      // A lane task stamped today leaves the walk but keeps its mark.
      const todayTask = makeFreshnessTask({
        status: { type: "ON_HOLD", name: "Next", symbol: "*" },
        path: "notes/t.md",
        lineNumber: 0,
        description: "Today",
        originalMarkdown: `- [*] #task Today [fresh:: ${todayText}]`,
      });
      const plugin2 = new LedgerToolsPlugin(
        makeFreshnessApp({ tasks: [todayTask] }),
        {},
      );
      plugin2.onload();
      try {
        assert.equal(plugin2.api.freshness.tier(todayTask), null);
        assert.equal(plugin2.api.freshness.isDue(todayTask), false);
      } finally {
        plugin2.onunload();
      }
    } finally {
      plugin.onunload();
    }
  });
});

test("memo invalidates on a new tasks array, rollover, and frontmatter", () => {
  withMissingConfig(() => {
    const triggers = [];
    let tasks = [makeFreshnessTask()];
    const frontmatter = {};
    const app = makeFreshnessApp({ tasks: undefined, frontmatter, triggers });
    app.plugins.plugins["obsidian-tasks-plugin"].getTasks = () => tasks;
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.onload();
    try {
      const first = plugin.freshnessEnsureMemo(new Date(2026, 9, 8));
      assert.equal(first.queue.length, 1);
      const same = plugin.freshnessEnsureMemo(new Date(2026, 9, 8));
      assert.equal(same, first, "same array, date, frontmatter: memoized");
      assert.deepEqual(triggers, [], "task edits never fire the reload event");

      tasks = [makeFreshnessTask()];
      const rebuilt = plugin.freshnessEnsureMemo(new Date(2026, 9, 8));
      assert.notEqual(rebuilt, first, "new getTasks() array rebuilds");
      assert.deepEqual(triggers, [], "still no reload for task edits");

      const rolled = plugin.refreshFreshnessForRollover(new Date(2026, 9, 9));
      assert.equal(rolled, true);
      assert.equal(
        plugin.freshnessEnsureMemo(new Date(2026, 9, 9)).dateText,
        "2026-10-09",
      );
      assert.equal(
        plugin.refreshFreshnessForRollover(new Date(2026, 9, 9)),
        false,
      );

      frontmatter["notes/a.md"] = 30;
      const bumped = plugin.refreshFreshnessForChangedFile({
        path: "notes/a.md",
      });
      assert.equal(bumped, true);
      assert.equal(
        plugin.refreshFreshnessForChangedFile({ path: "notes/a.md" }),
        false,
        "same frontmatter value does not bump twice",
      );
      assert.equal(
        plugin.refreshFreshnessForChangedFile({ path: "notes/unseen.md" }),
        false,
        "unseen paths without task_refresh stay quiet",
      );
    } finally {
      plugin.onunload();
    }
  });
});

test("the reload event fires only when the due key set changes", () => {
  withMissingConfig(() => {
    const triggers = [];
    const tasks = [
      makeFreshnessTask({
        path: "notes/a.md",
        lineNumber: 0,
        description: "Old",
        originalMarkdown: "- [ ] #task Old [fresh:: 2026-10-01]",
      }),
    ];
    const frontmatter = {};
    const app = makeFreshnessApp({ tasks: undefined, frontmatter, triggers });
    app.plugins.plugins["obsidian-tasks-plugin"].getTasks = () => tasks;
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.onload();
    try {
      plugin.freshnessEnsureMemo(new Date(2026, 9, 8));
      assert.deepEqual(triggers, []);

      // A longer interval clears the ROTTEN entry, so the due set changes.
      frontmatter["notes/a.md"] = 30;
      plugin.refreshFreshnessForChangedFile({ path: "notes/a.md" });
      assert.deepEqual(triggers, [TODAY_RELOAD_EVENT]);

      // An unrelated note leaves the due set alone: no further reload.
      frontmatter["notes/other.md"] = 30;
      plugin.refreshFreshnessForChangedFile({ path: "notes/other.md" });
      assert.deepEqual(triggers, [TODAY_RELOAD_EVENT]);
    } finally {
      plugin.onunload();
    }
  });
});

test("status bar text covers every state, and a missing host stays quiet", () => {
  assert.deepEqual(
    freshnessStatusView(null, { tasksAvailable: false }),
    { text: "⟳ –", tooltip: "Tasks unavailable", mode: "unavailable" },
  );
  const status = freshnessStatusView(
    {
      due: 23,
      new: 3,
      resurfaced: 2,
      rotten: 18,
      pendingDue: 10,
      nextDue: 15,
      walk: 48,
      refreshedToday: 20,
      upkeepToday: 12,
    },
    { mostOverdue: 11 },
  );
  assert.equal(
    status.text,
    "⟳ 0 pre · 3 new · 0 projects · 10 pending · 15 next · 0 recurring · 0 references · 20 rotten · 0 post · ✓ 12 today",
  );
  assert.equal(status.mode, "new");
  assert.match(status.tooltip, /Walk 48 · PRE 0 · NEW 3 · PROJECTS 0 · PENDING 10 · NEXT 15/);
  assert.match(status.tooltip, /TICKLER 2 · REFERENCES 0 · ROTTEN 18/);
  assert.match(status.tooltip, /oldest 11d overdue/);
  assert.match(status.tooltip, /✓ 12 today/);
  const budgeted = freshnessStatusView(
    {
      due: 5,
      new: 0,
      resurfaced: 1,
      rotten: 4,
      pendingDue: 0,
      nextDue: 0,
      walk: 5,
      refreshedToday: 20,
      upkeepToday: 12,
      budget: 15,
      budgetMet: false,
    },
    { mostOverdue: 4 },
  );
  assert.equal(
    budgeted.text,
    "⟳ 0 pre · 0 new · 0 projects · 0 pending · 0 next · 0 recurring · 0 references · 5 rotten · 0 post · ✓ 12/15 today",
  );
  assert.equal(budgeted.mode, "due");
  assert.match(budgeted.tooltip, /TICKLER 1 · REFERENCES 0 · ROTTEN 4/);
  // A `byTier` histogram drives the surfaces so the numbers sum to
  // the walk; `references` counts on the commitment side.
  const tiered = freshnessStatusView(
    {
      due: 2,
      new: 2,
      resurfaced: 0,
      rotten: 1,
      walk: 3,
      refreshedToday: 0,
      upkeepToday: 0,
      byTier: {
        new: 0,
        projects: 1,
        pending: 0,
        next: 0,
        tickler: 0,
        references: 1,
        rotten: 1,
      },
    },
    {},
  );
  assert.equal(
    tiered.text,
    "⟳ 0 pre · 0 new · 1 projects · 0 pending · 0 next · 0 recurring · 1 references · 1 rotten · 0 post · ✓ 0 today",
  );
  assert.match(tiered.tooltip, /REFERENCES 1/);
  assert.equal(tiered.mode, "due");
  assert.equal(
    freshnessStatusView({ due: 0, walk: 1, byTier: { references: 1 } }, {}).mode,
    "due",
  );
  // Mode table: new, then due while commitments remain, then
  // budget, then clear, else due.
  const modes = [
    [{ new: 1, pendingDue: 0, nextDue: 0, resurfaced: 0, walk: 5 }, "new"],
    [{ new: 0, pendingDue: 2, nextDue: 0, resurfaced: 0, walk: 5 }, "due"],
    [{ new: 0, pendingDue: 0, nextDue: 1, resurfaced: 0, walk: 5 }, "due"],
    [{ new: 0, pendingDue: 0, nextDue: 0, resurfaced: 1, walk: 5 }, "due"],
    [
      {
        new: 0,
        pendingDue: 0,
        nextDue: 0,
        resurfaced: 0,
        rotten: 3,
        walk: 3,
        upkeepToday: 15,
        budget: 15,
        budgetMet: true,
      },
      "budget",
    ],
    [
      {
        new: 0,
        pendingDue: 0,
        nextDue: 0,
        resurfaced: 0,
        rotten: 0,
        walk: 0,
        upkeepToday: 0,
      },
      "clear",
    ],
    [
      {
        new: 0,
        pendingDue: 0,
        nextDue: 0,
        resurfaced: 0,
        rotten: 4,
        walk: 4,
        upkeepToday: 2,
      },
      "due",
    ],
  ];
  for (const [counts, mode] of modes) {
    assert.equal(
      freshnessStatusView(
        { due: 0, rotten: 0, refreshedToday: 0, upkeepToday: 0, ...counts },
        {},
      ).mode,
      mode,
      JSON.stringify(counts),
    );
  }
  assert.equal(
    freshnessStatusView(
      {
        due: 0,
        new: 0,
        resurfaced: 0,
        rotten: 0,
        pendingDue: 0,
        nextDue: 0,
        walk: 0,
        refreshedToday: 12,
        upkeepToday: 12,
      },
      {},
    ).mode,
    "clear",
  );
  assert.equal(
    freshnessStatusView(
      {
        due: 0,
        new: 0,
        resurfaced: 0,
        rotten: 0,
        pendingDue: 0,
        nextDue: 0,
        walk: 0,
        refreshedToday: 15,
        upkeepToday: 15,
        budget: 15,
        budgetMet: true,
      },
      {},
    ).mode,
    "budget",
  );

  withMissingConfig(() => {
    const plugin = new LedgerToolsPlugin(
      makeFreshnessApp({ tasks: [makeFreshnessTask()] }),
      {},
    );
    plugin.onload();
    try {
      assert.equal(plugin.freshnessStatusEl, null);
      plugin.updateFreshnessStatusBar();
      plugin.scheduleFreshnessStatusBar();
    } finally {
      plugin.onunload();
    }
  });
});

test("status bar clicks through, falling back to rotten", () => {
  withMissingConfig(() => {
    const executed = [];
    const opened = [];
    const el = makeStatusEl();
    const app = makeFreshnessApp({ tasks: [makeFreshnessTask()] });
    app.commands = {
      commands: {
        "bob-navigation-hotkeys:jump-to-next-due-task": {},
      },
      executeCommandById: (id) => executed.push(id),
    };
    app.workspace.openLinkText = (target) => opened.push(target);
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.addStatusBarItem = () => el;
    plugin.onload();
    try {
      assert.equal(plugin.freshnessStatusEl, el);
      plugin.updateFreshnessStatusBar();
      const button = el.children.find((child) => child.tag === "button");
      assert.ok(button);
      assert.equal(button.children.find((child) => child.classList.has("bob-freshness-due")).textContent, "Review 1 due");
      assert.equal(el.classList.has("bob-freshness-hidden"), false);
      button.handlers.click();
      assert.deepEqual(executed, [
        "bob-navigation-hotkeys:jump-to-next-due-task",
      ]);
      assert.deepEqual(opened, []);
    } finally {
      plugin.onunload();
    }

    const fallbackEl = makeStatusEl();
    const fallbackOpened = [];
    const fallbackApp = makeFreshnessApp({ tasks: [] });
    fallbackApp.workspace.openLinkText = (target) =>
      fallbackOpened.push(target);
    const fallback = new LedgerToolsPlugin(fallbackApp, {});
    fallback.addStatusBarItem = () => fallbackEl;
    fallback.onload();
    try {
      fallback.updateFreshnessStatusBar();
      assert.equal(fallbackEl.classList.has("bob-freshness-hidden"), true);
      const button = fallbackEl.children.find((child) => child.tag === "button");
      assert.ok(button);
      button.handlers.click();
      assert.deepEqual(fallbackOpened, ["rotten"]);
    } finally {
      fallback.onunload();
    }
  });
});

test("every freshness api member is synchronous and never throws", () => {
  withMissingConfig(() => {
    const plugin = new LedgerToolsPlugin(makeFreshnessApp({}), {});
    plugin.onload();
    try {
      const freshness = plugin.api.freshness;
      assert.equal(freshness.state(null), null);
      assert.equal(freshness.isDue(undefined), false);
      assert.equal(freshness.tier(42), null);
      assert.equal(
        freshness.rank(null),
        Number.MAX_SAFE_INTEGER,
      );
      assert.deepEqual(freshness.intervalFor(null), {
        days: 7,
        source: "default",
      });
      assert.deepEqual(freshness.intervalForLine(null, null), {
        days: 7,
        source: "default",
        ready: { days: 7, source: "default" },
      });
      assert.deepEqual(freshness.queue(), []);
      assert.equal(freshness.reviewEntryView(null).ok, false);
      assert.equal(freshness.counts().due, 0);
      assert.equal(freshness.counts().walk, 0);
      assert.equal(freshness.counts().upkeepToday, 0);
      assert.deepEqual(freshness.lints(), []);
      assert.equal(freshness.stampLine(null), "");
      assert.equal(typeof freshness.stampLine("x"), "string");
      assert.equal(freshness.bucket(null), null);
      assert.equal(freshness.bucket(42), null);
      const unavailable = freshness.reviewModel();
      assert.equal(unavailable.available, false);
      assert.equal(unavailable.new, null);
      assert.equal(unavailable.rottenText, "ROTTEN –");
    } finally {
      plugin.onunload();
    }
  });
});

