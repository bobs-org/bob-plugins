const assert = require("node:assert/strict");
const test = require("node:test");
const {
  LedgerToolsPlugin,
  helpers,
  formatLocalDate,
  D,
  CFG,
  sRow,
  makeFreshnessTask,
  makeFreshnessApp,
  withMissingConfig,
} = require("./ledger-tools-harness.cjs");
test("bucket partition vectors: S1 new, S3/S4/S11 rotten, the rest null", () => {
  const { freshnessBucketForState, freshnessEvaluate } = helpers;
  const bucketed = (row, config = CFG) =>
    freshnessBucketForState(freshnessEvaluate(row, D, config).state);
  assert.equal(
    bucketed(sRow({ rawLine: "- [ ] #task T" })),
    "new",
    "S1 new",
  );
  assert.equal(
    bucketed(sRow({ rawLine: "- [ ] #task T [fresh:: 2026-10-01]" })),
    "rotten",
    "S3 boundary",
  );
  assert.equal(
    bucketed(sRow({ rawLine: "- [ ] #task T [fresh:: 2026-09-20]" })),
    "rotten",
    "S4 overdue",
  );
  assert.equal(
    bucketed(
      sRow({
        rawLine: "- [ ] #task T [fresh:: 2026-10-05]",
        scheduled: "2026-10-07",
      }),
    ),
    "rotten",
    "S11 resurfaced",
  );
  assert.equal(
    bucketed(sRow({ rawLine: "- [ ] #task T [fresh:: 2026-10-02]" })),
    null,
    "S2 fresh",
  );
  assert.equal(
    bucketed(
      sRow({
        rawLine: "- [ ] #task T [fresh:: 2026-10-01] [refresh:: 14]",
        noteRefreshRaw: 3,
      }),
    ),
    null,
    "S5 task interval",
  );
  assert.equal(
    bucketed(
      sRow({ rawLine: "- [ ] #task T [fresh:: 2026-10-01]" }),
      { interval: 10, intervalFromConfig: true, rottenDailyBudget: null },
    ),
    null,
    "S7 config interval",
  );
  assert.equal(
    bucketed(
      sRow({
        rawLine: "- [ ] #task T [fresh:: 2026-10-07]",
        scheduled: "2026-10-07",
      }),
    ),
    null,
    "S12 equal schedule",
  );
  for (const [name, row] of [
    ["recurring", sRow({ recurring: true })],
    ["hidden", sRow({ laneVisible: false })],
    ["today", sRow({ isToday: true })],
    ["daily", sRow({ isDailyNote: true, path: "2026/20261008.md" })],
    ["non-todo", sRow({ isTodo: false })],
  ]) {
    assert.equal(bucketed(row), null, `S13 ${name} has no bucket`);
  }
  assert.equal(freshnessBucketForState(null), null);
  assert.equal(freshnessBucketForState(undefined), null);
  assert.equal(freshnessBucketForState("fresh"), null);
  assert.equal(freshnessBucketForState("bogus"), null);
});

test("day numbers stay calendar-local across a DST boundary", () => {
  const { freshnessDayNumberForDateText } = helpers;
  const springForward = freshnessDayNumberForDateText("2026-03-08");
  const after = freshnessDayNumberForDateText("2026-03-09");
  assert.equal(typeof springForward, "number");
  assert.equal(after, springForward + 1);
  assert.equal(freshnessDayNumberForDateText("not-a-date"), null);
  assert.equal(freshnessDayNumberForDateText("2026-13-01"), null);
});

test("reviewModel shares counts, meter, tooltip, and severity", () => {
  const { freshnessReviewModel, freshnessReviewUnavailable } = helpers;
  const down = freshnessReviewUnavailable();
  assert.equal(down.available, false);
  assert.equal(down.new, null);
  assert.equal(down.severity, "unavailable");
  assert.equal(down.newText, "NEW –");
  assert.equal(down.rottenText, "ROTTEN –");

  const queue = [
    { state: "new", daysOverdue: null, interval: 7 },
    { state: "resurfaced", daysOverdue: 1, interval: 7 },
    { state: "rotten", daysOverdue: 11, interval: 7 },
  ];
  const counts = {
    due: 3,
    new: 1,
    resurfaced: 1,
    rotten: 1,
    fresh: 4,
    refreshedToday: 12,
    budget: null,
    budgetMet: false,
  };
  const model = freshnessReviewModel(counts, queue);
  assert.equal(model.available, true);
  assert.equal(model.new, 1);
  assert.equal(model.tickler, 1);
  assert.equal(model.rotten, 2);
  assert.equal(model.meter, "✓ 12");
  assert.equal(model.newText, "NEW 1");
  assert.equal(model.rottenText, "ROTTEN 2 · ✓ 12");
  assert.equal(model.severity, "new");
  assert.equal(model.escalated, true);
  assert.equal(model.oldestDaysOverdue, 11);
  assert.match(model.tooltip, /ROTTEN 2 = 1 tickler \+ 1 rotten/);

  const calm = freshnessReviewModel(
    {
      due: 1,
      new: 0,
      resurfaced: 0,
      rotten: 1,
      fresh: 4,
      refreshedToday: 12,
      budget: 15,
      budgetMet: false,
    },
    [{ state: "rotten", daysOverdue: 2, interval: 7 }],
  );
  assert.equal(calm.severity, "rotten");
  assert.equal(calm.meter, "✓ 12/15");
  assert.equal(calm.rottenText, "ROTTEN 1 · ✓ 12/15");

  const empty = freshnessReviewModel(
    {
      due: 0,
      new: 0,
      resurfaced: 0,
      rotten: 0,
      fresh: 0,
      refreshedToday: 0,
      budget: null,
      budgetMet: false,
    },
    [],
  );
  assert.equal(empty.severity, "none");
  assert.equal(empty.newText, "NEW 0");

  // Escalation is per-row daysOverdue >= that row's interval, never the
  // confirmation age or the global default.
  const mild = freshnessReviewModel(
    { ...counts, new: 0, due: 1 },
    [{ state: "rotten", daysOverdue: 6, interval: 7 }],
  );
  assert.equal(mild.escalated, false);
  assert.equal(mild.severity, "rotten");
});

test("memo serves warm map hits and misses use the per-row evaluator", () => {
  withMissingConfig(() => {
    const tasks = [makeFreshnessTask()];
    const plugin = new LedgerToolsPlugin(makeFreshnessApp({ tasks }), {});
    plugin.onload();
    try {
      const memo = plugin.freshnessEnsureMemo();
      assert.ok(memo.indexByTask instanceof Map);
      assert.ok(memo.evaluatedByKey instanceof Map);
      assert.equal(memo.indexByTask.get(tasks[0]), 0);
      assert.equal(
        memo.evaluatedByKey.get("notes/a.md:1").state,
        "new",
      );
      assert.equal(
        memo.evaluatedByKey.get("notes/a.md:1").bucket,
        "new",
      );
      // Warm hit: the snapshot row, not a re-parse.
      assert.equal(
        plugin.apiFreshnessRowFor(tasks[0]),
        memo.rows[0],
      );
      assert.equal(plugin.apiFreshnessBucket(tasks[0]), "new");
      // Miss: a task object outside the snapshot still classifies
      // through the per-row evaluator with the memo's config.
      const outsider = makeFreshnessTask({
        path: "notes/other.md",
        lineNumber: 4,
        description: "Old",
        originalMarkdown: "- [ ] #task Old [fresh:: 2000-01-01]",
      });
      assert.equal(plugin.freshnessEnsureMemo(), memo);
      assert.equal(plugin.apiFreshnessBucket(outsider), "rotten");
      assert.equal(plugin.apiFreshnessState(outsider), "rotten");
    } finally {
      plugin.onunload();
    }
  });
});

test("config snapshot caches the parse and invalidates explicitly", () => {
  withMissingConfig(() => {
    const plugin = new LedgerToolsPlugin(makeFreshnessApp({ tasks: [] }), {});
    plugin.onload();
    try {
      const first = plugin.freshnessConfigSnapshot();
      assert.deepEqual(first, {
        config: {
          interval: 7,
          pendingInterval: 1,
          nextInterval: 1,
          projectInterval: null,
          referenceInterval: null,
          rottenDailyBudget: null,
          decay: { enabled: true, keeps: 3, enter: null },
          intervalFromConfig: false,
        },
        invalid: false,
      });
      const cache = plugin.freshnessConfigCache;
      assert.equal(typeof cache.path, "string");
      assert.ok(cache.path.endsWith("config.yml"));
      // A second read inside the tick reuses the cache entry.
      const second = plugin.freshnessConfigSnapshot();
      assert.deepEqual(second, first);
      assert.equal(plugin.freshnessConfigCache, cache);
      assert.equal(plugin.refreshFreshnessConfig(), true);
      assert.equal(plugin.freshnessConfigCache, null);
      assert.equal(plugin.refreshFreshnessConfig(), false);
    } finally {
      plugin.onunload();
    }
  });
});

test("review chips share the model with severity classes", () => {
  const {
    freshnessReviewModel,
    paintReviewElement,
    setReviewAnchorContent,
  } = helpers;
  const host = () => ({
    children: [],
    createEl(tag, options = {}) {
      const child = {
        tag,
        cls: options.cls,
        text: options.text,
        title: options.title,
        href: options.href,
        attrs: {},
        children: [],
        setAttribute(key, value) {
          child.attrs[key] = value;
        },
        createEl(innerTag, innerOptions = {}) {
          const inner = {
            tag: innerTag,
            cls: innerOptions.cls,
            text: innerOptions.text,
            attrs: {},
            setAttribute(key, value) {
              inner.attrs[key] = value;
            },
          };
          child.children.push(inner);
          return inner;
        },
      };
      this.children.push(child);
      return child;
    },
  });
  const model = freshnessReviewModel(
    {
      due: 2,
      new: 1,
      resurfaced: 1,
      rotten: 0,
      fresh: 0,
      refreshedToday: 5,
      budget: null,
      budgetMet: false,
    },
    [
      { state: "new", daysOverdue: null, interval: 7 },
      { state: "resurfaced", daysOverdue: 1, interval: 7 },
    ],
  );
  const parent = host();
  const fresh = paintReviewElement(parent, "new", model);
  assert.match(fresh.attrs.class, /bob-plan-new/);
  assert.match(fresh.attrs.class, /bob-plan-over/);
  assert.equal(fresh.href, "dash#NEW Tasks");
  const freshSpans = fresh.children.map((span) => span.cls);
  assert.ok(freshSpans.includes("bob-plan-review-label"));
  assert.ok(freshSpans.includes("bob-plan-review-value"));
  const rotten = paintReviewElement(parent, "rotten", model);
  assert.match(rotten.attrs.class, /bob-plan-rotten/);
  assert.match(rotten.attrs.class, /bob-plan-warn/);
  assert.ok(!/bob-plan-over/.test(rotten.attrs.class));
  assert.equal(rotten.href, "rotten");
  assert.match(rotten.attrs.title, /1 tickler \+ 0 rotten/);
  // A full interval overdue escalates ROTTEN to red.
  const bad = freshnessReviewModel(
    {
      due: 1,
      new: 0,
      resurfaced: 0,
      rotten: 1,
      fresh: 0,
      refreshedToday: 5,
      budget: null,
      budgetMet: false,
    },
    [{ state: "rotten", daysOverdue: 9, interval: 7 }],
  );
  const escalated = paintReviewElement(host(), "rotten", bad);
  assert.match(escalated.attrs.class, /bob-plan-over/);
  // Unavailable models render an explicit placeholder, never zero.
  const down = paintReviewElement(host(), "rotten", {
    available: false,
  });
  assert.match(down.attrs.class, /bob-plan-unavailable/);
  assert.match(down.attrs.title, /unavailable/);
  // Live refresh repaints spans in place without replacing the anchor.
  setReviewAnchorContent(rotten, "rotten", bad);
  assert.match(rotten.attrs.class, /bob-plan-over/);
});

test("warm lookups reuse one snapshot without re-reading config", () => {
  withMissingConfig(() => {
    const fs = require("node:fs");
    const tasks = [
      makeFreshnessTask(),
      makeFreshnessTask({
        path: "notes/b.md",
        lineNumber: 2,
        description: "- [ ] #task Other",
        originalMarkdown: "- [ ] #task Other",
      }),
    ];
    const plugin = new LedgerToolsPlugin(makeFreshnessApp({ tasks }), {});
    plugin.onload();
    const originalRead = fs.readFileSync;
    const originalStat = fs.statSync;
    let reads = 0;
    let stats = 0;
    fs.readFileSync = (...args) => {
      reads += 1;
      return originalRead(...args);
    };
    fs.statSync = (...args) => {
      stats += 1;
      return originalStat(...args);
    };
    try {
      const memo = plugin.freshnessEnsureMemo();
      const readsAfterBuild = reads;
      const statsAfterBuild = stats;
      for (let round = 0; round < 5; round += 1) {
        for (const task of tasks) {
          plugin.apiFreshnessState(task);
          plugin.apiFreshnessBucket(task);
        }
      }
      assert.equal(plugin.freshnessEnsureMemo(), memo);
      assert.equal(reads, readsAfterBuild);
      assert.equal(stats, statsAfterBuild);
      assert.equal(memo.evaluatedByKey.size, tasks.length);
    } finally {
      fs.readFileSync = originalRead;
      fs.statSync = originalStat;
      plugin.onunload();
    }
  });
});

test("same-array cache updates and Today changes rebuild the memo", () => {
  withMissingConfig(() => {
    const cacheUpdates = [];
    const base = makeFreshnessApp({ tasks: [makeFreshnessTask()] });
    base.workspace.on = (event, handler) => {
      if (event === "obsidian-tasks-plugin:cache-update") {
        cacheUpdates.push(handler);
      }
      return {};
    };
    const plugin = new LedgerToolsPlugin(base, {});
    plugin.onload();
    try {
      const triggers = [];
      base.workspace.trigger = (event) => triggers.push(event);
      const before = plugin.freshnessEnsureMemo();
      assert.equal(plugin.freshnessEnsureMemo(), before);
      // Mutate the same array object, then fire the cache-update event:
      // the memo must rebuild even though the identity never changed.
      base.plugins.plugins["obsidian-tasks-plugin"].getTasks = () =>
        before.tasks;
      const stamped = makeFreshnessTask({
        description: "Stamped",
        originalMarkdown: `- [ ] #task Stamped [fresh:: ${plugin.freshnessTodayText()}]`,
      });
      before.tasks.push(stamped);
      assert.equal(cacheUpdates.length, 1);
      cacheUpdates[0]();
      const after = plugin.freshnessEnsureMemo();
      assert.notEqual(after, before);
      assert.equal(after.rows.length, before.rows.length + 1);
      // Task edits re-render through Tasks itself: no reload trigger.
      assert.deepEqual(triggers, []);
      // A Today-membership change invalidates too.
      plugin.todayCache = {
        date: plugin.todayLocalDate(new Date()),
        dailyPath: plugin.currentTodayDailyPath(new Date()),
        keys: ["notes/a.md#^x"],
        rank: new Map([["notes/a.md#^x", 0]]),
      };
      const retired = plugin.freshnessEnsureMemo();
      assert.notEqual(retired, after);
    } finally {
      plugin.onunload();
    }
  });
});
test("duplicate block IDs keep each row's own classification", () => {
  withMissingConfig(() => {
    // The FRESH row is stamped today (whatever today is), so the
    // NEW/FRESH split holds on any calendar date.
    const today = formatLocalDate(new Date());
    const tasks = [
      makeFreshnessTask({
        path: "notes/a.md",
        lineNumber: 0,
        description: "New",
        originalMarkdown: "- [ ] #task New",
        blockLink: " ^duplicate",
      }),
      makeFreshnessTask({
        path: "notes/a.md",
        lineNumber: 1,
        description: "Fresh",
        originalMarkdown: `- [ ] #task Fresh [fresh:: ${today}]`,
        blockLink: " ^duplicate",
      }),
    ];
    const plugin = new LedgerToolsPlugin(
      makeFreshnessApp({ tasks }),
      {},
    );
    plugin.onload();
    try {
      const memo = plugin.freshnessEnsureMemo();
      // Independent evaluation: NEW vs FRESH.
      assert.equal(memo.rows.map((row) => row.line).join(","), "1,2");
      // Each resolvable source row serves its own cached result, even
      // though both rank keys collide on `notes/a.md#duplicate`.
      assert.equal(plugin.apiFreshnessState(tasks[0]), "new");
      assert.equal(plugin.apiFreshnessBucket(tasks[0]), "new");
      assert.equal(plugin.apiFreshnessState(tasks[1]), "fresh");
      assert.equal(plugin.apiFreshnessBucket(tasks[1]), null);
      // The ambiguous key carries no borrowed classification.
      assert.equal(memo.evaluatedByKey.has("notes/a.md#duplicate"), false);
      // Membership, not just totals: the queue holds only the NEW row.
      assert.equal(memo.queue.length, 1);
      assert.equal(memo.queue[0].state, "new");
      assert.equal(memo.queue[0].path, "notes/a.md");
      assert.equal(memo.queue[0].line, 1);
      assert.equal(memo.counts.new, 1);
      assert.equal(memo.counts.fresh, 1);
      // The review predicate partitions B the same way.
      const isReview = plugin.freshnessReviewPredicate(memo);
      assert.equal(isReview(tasks[0]), true);
      assert.equal(isReview(tasks[1]), false);
      // A cloned Tasks query object (same key, new identity) with an
      // unambiguous key shares that key's cached result.
      const lone = makeFreshnessTask({
        path: "notes/b.md",
        lineNumber: 2,
        description: "Lone",
        originalMarkdown: "- [ ] #task Lone",
      });
      const app2 = makeFreshnessApp({ tasks: [lone] });
      const plugin2 = new LedgerToolsPlugin(app2, {});
      plugin2.onload();
      try {
        const memo2 = plugin2.freshnessEnsureMemo();
        assert.equal(memo2.evaluatedByKey.has("notes/b.md:3"), true);
        const clone = { ...lone };
        assert.equal(plugin2.apiFreshnessBucket(clone), "new");
        assert.equal(plugin2.apiFreshnessState(clone), "new");
      } finally {
        plugin2.onunload();
      }
    } finally {
      plugin.onunload();
    }
  });
});

test("line identity separates same-path rows without block IDs", () => {
  withMissingConfig(() => {
    const today = formatLocalDate(new Date());
    const tasks = [
      makeFreshnessTask({
        path: "notes/a.md",
        lineNumber: 0,
        description: "Fresh",
        originalMarkdown: `- [ ] #task Fresh [fresh:: ${today}]`,
      }),
      makeFreshnessTask({
        path: "notes/a.md",
        lineNumber: 1,
        description: "New",
        originalMarkdown: "- [ ] #task New",
      }),
    ];
    const plugin = new LedgerToolsPlugin(
      makeFreshnessApp({ tasks }),
      {},
    );
    plugin.onload();
    try {
      plugin.freshnessEnsureMemo();
      assert.equal(plugin.apiFreshnessBucket(tasks[0]), null);
      assert.equal(plugin.apiFreshnessBucket(tasks[1]), "new");
      assert.equal(plugin.apiFreshnessState(tasks[0]), "fresh");
      assert.equal(plugin.apiFreshnessState(tasks[1]), "new");
    } finally {
      plugin.onunload();
    }
  });
});

test("interval lookup serves the cached interval with one memo acquisition", () => {
  withMissingConfig(() => {
    const fs = require("node:fs");
    const tasks = [
      makeFreshnessTask({
        description: "Custom",
        originalMarkdown: "- [ ] #task Custom [refresh:: 14]",
      }),
      makeFreshnessTask({
        path: "notes/b.md",
        lineNumber: 2,
        description: "Plain",
        originalMarkdown: "- [ ] #task Plain",
      }),
    ];
    const plugin = new LedgerToolsPlugin(
      makeFreshnessApp({ tasks }),
      {},
    );
    plugin.onload();
    const originalRead = fs.readFileSync;
    const originalStat = fs.statSync;
    let reads = 0;
    let stats = 0;
    fs.readFileSync = (...args) => {
      reads += 1;
      return originalRead(...args);
    };
    fs.statSync = (...args) => {
      stats += 1;
      return originalStat(...args);
    };
    try {
      const memo = plugin.freshnessEnsureMemo();
      const readsAfterBuild = reads;
      const statsAfterBuild = stats;
      let ensures = 0;
      const originalEnsure = plugin.freshnessEnsureMemo.bind(plugin);
      plugin.freshnessEnsureMemo = (...args) => {
        ensures += 1;
        return originalEnsure(...args);
      };
      try {
        assert.deepEqual(plugin.apiFreshnessIntervalFor(tasks[0]), {
          days: 14,
          source: "task",
        });
        assert.deepEqual(plugin.apiFreshnessIntervalFor(tasks[1]), {
          days: 7,
          source: "default",
        });
        // The warm row is the snapshot row: no reparse,
        // re-evaluation, or config re-read.
        assert.equal(plugin.apiFreshnessRowFor(tasks[0], memo), memo.rows[0]);
        assert.equal(reads, readsAfterBuild);
        assert.equal(stats, statsAfterBuild);
        // The served interval matches the evaluated result used for
        // state/bucket.
        assert.equal(
          plugin.freshnessEvaluatedFor(tasks[0], memo).intervalDays,
          14,
        );
        assert.equal(
          plugin.freshnessEvaluatedFor(tasks[1], memo).intervalDays,
          7,
        );
        // Two interval calls plus this identity check: exactly one
        // acquisition per call, all serving the same memo.
        assert.equal(plugin.freshnessEnsureMemo(), memo);
        assert.equal(ensures, 3);
      } finally {
        plugin.freshnessEnsureMemo = originalEnsure;
      }
    } finally {
      fs.readFileSync = originalRead;
      fs.statSync = originalStat;
      plugin.onunload();
    }
  });
});

