const assert = require("node:assert/strict");
const test = require("node:test");
const {
  helpers,
  coerceFreshnessConfig,
  defaultFreshnessConfig,
  freshnessBlock,
  freshnessCounts,
  freshnessIntervalFor,
  freshnessIntervalForLine,
  freshnessLaneForRow,
  freshnessLaneIntervalDays,
  freshnessTierLabel,
  freshnessQueue,
  freshnessState,
  loadFreshnessConfig,
  D,
  CFG,
  sRow,
} = require("./ledger-tools-harness.cjs");
test("S1 new through S4 overdue", () => {
  assert.equal(freshnessState(sRow(), D, CFG), "new");
  const fresh = freshnessState(
    sRow({ rawLine: "- [ ] #task T [fresh:: 2026-10-02]" }),
    D,
    CFG,
  );
  assert.equal(fresh, "fresh");
  const boundary = helpers.freshnessEvaluate(
    sRow({ rawLine: "- [ ] #task T [fresh:: 2026-10-01]" }),
    D,
    CFG,
  );
  assert.equal(boundary.state, "rotten");
  assert.equal(boundary.dueOn, "2026-10-08");
  assert.equal(boundary.daysOverdue, 0);
  const overdue = helpers.freshnessEvaluate(
    sRow({ rawLine: "- [ ] #task T [fresh:: 2026-09-20]" }),
    D,
    CFG,
  );
  assert.equal(overdue.state, "rotten");
  assert.equal(overdue.dueOn, "2026-09-27");
  assert.equal(overdue.daysOverdue, 11);
  const freshDue = helpers.freshnessEvaluate(
    sRow({ rawLine: "- [ ] #task T [fresh:: 2026-10-02]" }),
    D,
    CFG,
  );
  assert.equal(freshDue.dueOn, "2026-10-09");
});

test("S5 task beats note, S6 note beats config, S7 config", () => {
  const task = helpers.freshnessEvaluate(
    sRow({
      rawLine: "- [ ] #task T [fresh:: 2026-10-01] [refresh:: 14]",
      noteRefreshRaw: 3,
    }),
    D,
    CFG,
  );
  assert.equal(task.state, "fresh");
  assert.equal(task.intervalDays, 14);
  assert.equal(task.intervalSource, "task");

  const note = helpers.freshnessEvaluate(
    sRow({
      rawLine: "- [ ] #task T [fresh:: 2026-10-05]",
      noteRefreshRaw: 3,
    }),
    D,
    CFG,
  );
  assert.equal(note.state, "rotten");
  assert.equal(note.intervalSource, "note");

  const config = helpers.freshnessEvaluate(
    sRow({ rawLine: "- [ ] #task T [fresh:: 2026-10-01]" }),
    D,
    { interval: 10, intervalFromConfig: true, rottenDailyBudget: null },
  );
  assert.equal(config.state, "fresh");
  assert.equal(config.intervalSource, "config");
});

test("S8 invalid overrides fall through with lints", () => {
  const evaluated = helpers.freshnessEvaluate(
    sRow({
      rawLine: "- [ ] #task T [fresh:: 2026-10-01] [refresh:: 0]",
      noteRefreshRaw: "soon",
    }),
    D,
    CFG,
  );
  assert.ok(evaluated.lints.includes("refresh_invalid"));
  assert.ok(evaluated.lints.includes("task_refresh_invalid"));
  assert.equal(evaluated.intervalDays, 7);
  assert.equal(evaluated.intervalSource, "default");
});

test("S9 malformed and S10 future stamps read as new", () => {
  const malformed = helpers.freshnessEvaluate(
    sRow({ rawLine: "- [ ] #task T [fresh:: 2026-13-01]" }),
    D,
    CFG,
  );
  assert.equal(malformed.state, "new");
  assert.ok(malformed.lints.includes("fresh_malformed"));

  const future = helpers.freshnessEvaluate(
    sRow({ rawLine: "- [ ] #task T [fresh:: 2026-10-09]" }),
    D,
    CFG,
  );
  assert.equal(future.state, "new");
  assert.ok(future.lints.includes("fresh_future"));
});

test("S11 resurfaced beats rotten, S12 scheduled-equals-fresh stays fresh", () => {
  const resurfaced = helpers.freshnessEvaluate(
    sRow({
      rawLine:
        "- [ ] #task T [fresh:: 2026-10-05] [scheduled:: 2026-10-07]",
      scheduled: "2026-10-07",
    }),
    D,
    CFG,
  );
  assert.equal(resurfaced.state, "resurfaced");
  assert.equal(resurfaced.dueOn, "2026-10-07");

  assert.equal(
    freshnessState(
      sRow({
        rawLine:
          "- [ ] #task T [fresh:: 2026-10-07] [scheduled:: 2026-10-07]",
        scheduled: "2026-10-07",
      }),
      D,
      CFG,
    ),
    "fresh",
  );
});

test("S13 out-of-scope rows read null", () => {
  const cases = [
    sRow({ recurring: true }),
    sRow({ laneVisible: false }),
    sRow({ isTodo: false }),
    sRow({ path: "_templates/x.md", laneVisible: false }),
    sRow({ path: "2026/20261008.md", isDailyNote: true }),
    sRow({ isToday: true }),
  ];
  for (const row of cases) {
    assert.equal(freshnessState(row, D, CFG), null, JSON.stringify(row));
  }
});

test("S14 queue order (rewritten): NEW then TICKLER beats ROTTEN", () => {
  const rows = [
    sRow({ path: "b.md", line: 3 }),
    sRow({ path: "a.md", line: 9 }),
    sRow({
      path: "c.md",
      line: 2,
      rawLine: "- [ ] #task C [fresh:: 2026-09-24]",
    }),
    sRow({
      path: "a.md",
      line: 4,
      rawLine: "- [ ] #task R [fresh:: 2026-10-05] [scheduled:: 2026-10-07]",
      scheduled: "2026-10-07",
    }),
    sRow({
      path: "a.md",
      line: 2,
      rawLine: "- [ ] #task S [fresh:: 2026-09-30]",
    }),
  ];
  const queue = freshnessQueue(rows, D, CFG);
  assert.deepEqual(
    queue.map((entry) => `${entry.path}:${entry.line}`),
    ["a.md:9", "b.md:3", "a.md:4", "c.md:2", "a.md:2"],
  );
  assert.deepEqual(
    queue.map((entry) => entry.rank),
    [1, 2, 3, 4, 5],
  );
  assert.deepEqual(
    queue.map((entry) => entry.tier),
    ["new", "new", "tickler", "rotten", "rotten"],
  );
  assert.deepEqual(
    queue.map((entry) => entry.tierLabel),
    ["NEW", "NEW", "TICKLER", "ROTTEN", "ROTTEN"],
  );
  assert.deepEqual(
    queue.map((entry) => entry.lane),
    ["ready", "ready", "ready", "ready", "ready"],
  );
  assert.deepEqual(
    queue.map((entry) => entry.tierRank),
    [1, 2, 1, 1, 2],
  );
  assert.deepEqual(
    queue.map((entry) => entry.tierTotal),
    [2, 2, 1, 2, 2],
  );
});

test("S15 counts (updated): upkeep outside the lanes drives the budget", () => {
  const rows = [
    sRow({
      path: "a.md",
      line: 1,
      statusSymbol: "*",
      isTodo: false,
      laneVisible: true,
      rawLine: "- [*] #task Next [fresh:: 2026-10-08]",
    }),
    sRow({
      path: "a.md",
      line: 2,
      statusSymbol: "x",
      isTodo: false,
      laneVisible: false,
      rawLine: "- [x] #task Done [fresh:: 2026-10-08]",
    }),
    sRow({
      path: "a.md",
      line: 3,
      rawLine: "- [ ] #task Old [fresh:: 2026-10-07]",
    }),
  ];
  const cfg = {
    interval: 7,
    intervalFromConfig: false,
    pendingInterval: 1,
    nextInterval: 1,
    rottenDailyBudget: 15,
  };
  const counts = freshnessCounts(rows, D, cfg);
  assert.equal(counts.refreshedToday, 2);
  assert.equal(counts.upkeepToday, 1);
  assert.equal(counts.new, 0);
  assert.equal(counts.budgetMet, false);

  const met = freshnessCounts(
    [
      ...rows,
      ...Array.from({ length: 14 }, (_, i) =>
        sRow({
          path: "u.md",
          line: 10 + i,
          statusSymbol: "x",
          isTodo: false,
          laneVisible: false,
          rawLine: `- [x] #task Done ${i} [fresh:: 2026-10-08]`,
        }),
      ),
    ],
    D,
    cfg,
  );
  assert.equal(met.refreshedToday, 16);
  assert.equal(met.upkeepToday, 15);
  assert.equal(met.budgetMet, true);

  const withNew = freshnessCounts(
    [...rows, sRow({ path: "b.md", line: 1 })],
    D,
    { ...cfg, rottenDailyBudget: 2 },
  );
  assert.equal(withNew.new, 1);
  assert.equal(withNew.budgetMet, false);
});

test("config coercion keeps defaults, flags invalid, ignores unknown keys", () => {
  assert.deepEqual(defaultFreshnessConfig(), {
    interval: 7,
    pendingInterval: 1,
    nextInterval: 1,
    projectInterval: null,
    referenceInterval: null,
    rottenDailyBudget: null,
    decay: { enabled: true, keeps: 3, enter: null },
  });
  assert.equal(freshnessBlock({}), undefined);
  assert.deepEqual(freshnessBlock({ freshness: { interval: 3 } }), {
    interval: 3,
  });

  const good = coerceFreshnessConfig({
    interval: 10,
    rotten_daily_budget: 15,
    unknown_key: "ignored",
  });
  assert.equal(good.invalid, false);
  assert.equal(good.config.interval, 10);
  assert.equal(good.config.rottenDailyBudget, 15);
  assert.equal(good.config.deprecatedStaleBudget, false);

  // The removed key still supplies the budget for one release.
  const legacy = coerceFreshnessConfig({ stale_daily_budget: 15 });
  assert.equal(legacy.invalid, false);
  assert.equal(legacy.config.rottenDailyBudget, 15);
  assert.equal(legacy.config.deprecatedStaleBudget, true);

  // Canonical presence wins, including null (budget off) and equal
  // values; the legacy value is ignored but still flagged.
  const both = coerceFreshnessConfig({
    rotten_daily_budget: 20,
    stale_daily_budget: 15,
  });
  assert.equal(both.invalid, false);
  assert.equal(both.config.rottenDailyBudget, 20);
  assert.equal(both.config.deprecatedStaleBudget, true);
  const nulled = coerceFreshnessConfig({
    rotten_daily_budget: null,
    stale_daily_budget: 15,
  });
  assert.equal(nulled.invalid, false);
  assert.equal(nulled.config.rottenDailyBudget, null);
  assert.equal(nulled.config.deprecatedStaleBudget, true);

  assert.equal(coerceFreshnessConfig(undefined).invalid, false);
  assert.equal(coerceFreshnessConfig(null).invalid, false);
  for (const block of [
    { interval: 0 },
    { interval: 366 },
    { interval: "soon" },
    { interval: 7.5 },
    { rotten_daily_budget: 0 },
    { rotten_daily_budget: "soon" },
    { stale_daily_budget: 0 },
    { stale_daily_budget: "soon" },
    { pending_interval: 0 },
    { pending_interval: 366 },
    { pending_interval: "soon" },
    { pending_interval: true },
    { pending_interval: 7.5 },
    { next_interval: 0 },
    { next_interval: true },
    [1, 2],
  ]) {
    const coerced = coerceFreshnessConfig(block);
    assert.equal(coerced.invalid, true, JSON.stringify(block));
    assert.deepEqual(
      {
        interval: coerced.config.interval,
        pendingInterval: coerced.config.pendingInterval,
        nextInterval: coerced.config.nextInterval,
        projectInterval: coerced.config.projectInterval,
        referenceInterval: coerced.config.referenceInterval,
        rottenDailyBudget: coerced.config.rottenDailyBudget,
        decay: coerced.config.decay,
      },
      {
        interval: 7,
        pendingInterval: 1,
        nextInterval: 1,
        projectInterval: null,
        referenceInterval: null,
        rottenDailyBudget: null,
        decay: { enabled: true, keeps: 3, enter: null },
      },
    );
  }
  // Lane intervals: absent or null mean the default 1, false turns
  // the lane off, integers set it, camelCase is tolerated.
  assert.deepEqual(coerceFreshnessConfig({}).config.pendingInterval, 1);
  assert.deepEqual(coerceFreshnessConfig({ pending_interval: null }).config.pendingInterval, 1);
  assert.deepEqual(coerceFreshnessConfig({ pending_interval: false }).config.pendingInterval, null);
  assert.deepEqual(coerceFreshnessConfig({ pending_interval: 3 }).config.pendingInterval, 3);
  assert.deepEqual(coerceFreshnessConfig({ pendingInterval: 3 }).config.pendingInterval, 3);
  assert.deepEqual(coerceFreshnessConfig({ next_interval: false }).config.nextInterval, null);
  assert.deepEqual(coerceFreshnessConfig({ next_interval: null }).config.nextInterval, 1);
  assert.deepEqual(coerceFreshnessConfig({ nextInterval: 2 }).config.nextInterval, 2);
});

test("loadFreshnessConfig reads the block with plan-style injectables", () => {
  const missing = loadFreshnessConfig({
    fsModule: {
      readFileSync: () => {
        const error = new Error("missing");
        error.code = "ENOENT";
        throw error;
      },
    },
    parseYaml: (text) => JSON.parse(text),
    Platform: { isDesktopApp: true },
    configPath: "/cfg/bob/config.yml",
  });
  assert.equal(missing.invalid, false);
  assert.equal(missing.config.interval, 7);

  const good = loadFreshnessConfig({
    fsModule: {
      readFileSync: () => JSON.stringify({ freshness: { interval: 10 } }),
    },
    parseYaml: (text) => JSON.parse(text),
    Platform: { isDesktopApp: true },
    configPath: "/cfg/bob/config.yml",
  });
  assert.equal(good.invalid, false);
  assert.equal(good.config.interval, 10);

  const bad = loadFreshnessConfig({
    fsModule: {
      readFileSync: () => JSON.stringify({ freshness: { interval: "soon" } }),
    },
    parseYaml: (text) => JSON.parse(text),
    Platform: { isDesktopApp: true },
    configPath: "/cfg/bob/config.yml",
  });
  assert.equal(bad.invalid, true);
  assert.equal(bad.config.interval, 7);

  const mobile = loadFreshnessConfig({
    fsModule: { readFileSync: () => "{}" },
    Platform: { isDesktopApp: false },
  });
  assert.equal(mobile.invalid, false);
});

test("interval precedence is task, note, config, default", () => {
  assert.deepEqual(freshnessIntervalFor(14, 3, CFG), {
    days: 14,
    source: "task",
  });
  assert.deepEqual(freshnessIntervalFor(null, 3, CFG), {
    days: 3,
    source: "note",
  });
  assert.deepEqual(
    freshnessIntervalFor(null, null, {
      interval: 10,
      intervalFromConfig: true,
      rottenDailyBudget: null,
    }),
    { days: 10, source: "config" },
  );
  assert.deepEqual(freshnessIntervalFor(null, null, CFG), {
    days: 7,
    source: "default",
  });
  // Lane intervals override the whole Ready chain when walked.
  assert.deepEqual(freshnessIntervalFor(30, 3, CFG, "pending"), {
    days: 1,
    source: "pending",
  });
  assert.deepEqual(freshnessIntervalFor(null, null, CFG, "next"), {
    days: 1,
    source: "next",
  });
  assert.deepEqual(
    freshnessIntervalFor(null, null, { ...CFG, nextInterval: null }, "next"),
    { days: 7, source: "default" },
  );
  assert.deepEqual(
    freshnessIntervalFor(null, null, { ...CFG, pendingInterval: 3 }, "pending"),
    { days: 3, source: "pending" },
  );
});

test("intervalForLine covers every source with its Ready fallback", () => {
  const line = (text) => text;
  // Ready task interval.
  assert.deepEqual(
    freshnessIntervalForLine("- [ ] #task T [refresh:: 14]", null, CFG),
    { days: 14, source: "task", ready: { days: 14, source: "task" } },
  );
  assert.deepEqual(
    freshnessIntervalForLine("- [ ] #task T", 3, CFG),
    { days: 3, source: "note", ready: { days: 3, source: "note" } },
  );
  assert.deepEqual(
    freshnessIntervalForLine(
      "- [ ] #task T",
      null,
      { ...CFG, interval: 10, intervalFromConfig: true },
    ),
    { days: 10, source: "config", ready: { days: 10, source: "config" } },
  );
  assert.deepEqual(freshnessIntervalForLine("- [ ] #task T", null, CFG), {
    days: 7,
    source: "default",
    ready: { days: 7, source: "default" },
  });
  // Lane task: lane interval with the Ready chain as `ready`.
  assert.deepEqual(
    freshnessIntervalForLine("- [*] #task N [refresh:: 14]", null, CFG),
    { days: 1, source: "next", ready: { days: 14, source: "task" } },
  );
  assert.deepEqual(
    freshnessIntervalForLine("- [/] #task P", null, CFG),
    { days: 1, source: "pending", ready: { days: 7, source: "default" } },
  );
  // Unwalked lane falls back to the Ready chain.
  assert.deepEqual(
    freshnessIntervalForLine(
      "- [*] #task N",
      null,
      { ...CFG, nextInterval: null },
    ),
    { days: 7, source: "default", ready: { days: 7, source: "default" } },
  );
  // Never throws on bad input.
  assert.deepEqual(freshnessIntervalForLine(null, null, null), {
    days: 7,
    source: "default",
    ready: { days: 7, source: "default" },
  });
  assert.equal(freshnessLaneForRow("/", false), "pending");
  assert.equal(freshnessLaneForRow("*", false), "next");
  assert.equal(freshnessLaneForRow(" ", true), "ready");
  assert.equal(freshnessLaneForRow("?", false), null);
  assert.equal(freshnessLaneIntervalDays(CFG, "pending"), 1);
  assert.equal(
    freshnessLaneIntervalDays({ ...CFG, nextInterval: null }, "next"),
    null,
  );
  assert.equal(freshnessTierLabel("new"), "NEW");
  assert.equal(freshnessTierLabel("tickler"), "TICKLER");
  assert.equal(freshnessTierLabel("bogus"), "");
});

