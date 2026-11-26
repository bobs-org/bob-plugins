// Planned-today conformance for the snoozed cache (`docs/freshness.md`
// "Planned-today conformance (SP)", `docs/plan.md` "Snoozed forecast").
// The stable inputs live in
// `plugins/bob-ledger-tools/scripts/fixtures/walks/planned-today.json`,
// a byte-for-byte copy of bob-cli `tests/fixtures/walks/planned-today.json`.
// Unless noted, the clock is 2026-11-17 12:00 local, `jobs.md` holds one
// unstamped task, and today's Snoozed row targets 15:30.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  helpers,
  LedgerToolsPlugin,
  withMissingConfig,
} = require("./ledger-tools-harness.cjs");

const {
  TODAY_RELOAD_EVENT,
  dashboardLaneBudgetFromTasks,
  laneBudgetFromTasks,
  laneWalkQueueFromTasks,
  readyCountFromTasks,
} = helpers;

const FIXTURE_PATH = path.join(
  __dirname,
  "..",
  "plugins",
  "bob-ledger-tools",
  "scripts",
  "fixtures",
  "walks",
  "planned-today.json",
);
const CANONICAL_PATH = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "tests",
  "fixtures",
  "walks",
  "planned-today.json",
);

const DAY = "2026/20261117.md";
const CLOCK = new Date(2026, 10, 17, 12, 0, 0);
const TODAY_DAY = 20261117;
const DATE_TEXT = "2026-11-17";
const CFG = {
  interval: 7,
  intervalFromConfig: false,
  pendingInterval: 1,
  nextInterval: 1,
  rottenDailyBudget: null,
};

function plannedTask({
  symbol = "*",
  taskPath = "jobs.md",
  blockId = "job",
  description = "Work",
  tags = ["#task"],
  extraMarkdown = "",
  recurrence = null,
} = {}) {
  const type = symbol === "/" ? "IN_PROGRESS" : "TODO";
  const line = `- [${symbol}] ${description}${extraMarkdown} ^${blockId}`;
  const task = {
    path: taskPath,
    lineNumber: 0,
    description,
    originalMarkdown: line,
    status: {
      type,
      symbol,
      name:
        symbol === "*"
          ? "Next"
          : symbol === "/"
            ? "In Progress"
            : symbol === "?"
              ? "Blocked"
              : "Todo",
    },
    tags: Array.isArray(tags) ? tags.slice() : [],
    blockLink: ` ^${blockId}`,
    isBlocked: () => symbol === "?",
  };
  if (recurrence) {
    task.recurrence = recurrence;
  }
  return task;
}

function dailyFor(vector) {
  let daily = "";
  if (vector.ledger === true) {
    daily += "## Pomodoros\n- [ ] ()\n";
    if (typeof vector.ledger_line === "string") {
      daily += vector.ledger_line;
    } else if (vector.linked === true) {
      daily += "  - [[jobs#^job|Live alias]]\n";
    }
  }
  daily += "\n## Snoozed\n";
  daily += vector.row;
  return daily;
}

function makePlannedApp({ files, targets, triggers, tasks }) {
  return {
    internalPlugins: { plugins: {} },
    vault: {
      getAbstractFileByPath: (filePath) =>
        files && files[filePath] ? { path: filePath } : null,
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
      on: () => ({}),
      getFirstLinkpathDest: (target) =>
        targets && Object.hasOwn(targets, target)
          ? { path: targets[target] }
          : null,
    },
    plugins: {
      plugins: {
        "obsidian-tasks-plugin": {
          getTasks: () => tasks,
          getState: () => "Warm",
        },
      },
    },
  };
}

function loadVectors() {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
}

function taskForVector(vector) {
  // The task line carries the lane symbol (`[*]`, `[/]`, `[ ]`, `[?]`)
  // exactly as the Rust vector runner sees it.
  const line = String(vector.task || "");
  const match = /^- \[(.)\]/.exec(line);
  const statusSymbol = match ? match[1] : "*";
  const tags = [...line.matchAll(/#[A-Za-z0-9/_-]+/g)].map((item) => item[0]);
  const recurrence = /\[repeat::/.test(line) ? {} : null;
  return plannedTask({
    symbol: statusSymbol,
    description: "Work",
    tags: tags.length > 0 ? tags : ["#task"],
    extraMarkdown: (/\[repeat::[^\]]*\]/.exec(line) || [""])[0]
      + (/\[due::[^\]]*\]/.exec(line) ? ` ${/\[due::[^\]]*\]/.exec(line)[0]}` : ""),
    recurrence,
  });
}

function setupVector(vector, overrides = {}) {
  const triggers = [];
  const task = taskForVector(vector);
  const dailyPath = vector.day;
  const daily = dailyFor(vector);
  const files = { [dailyPath]: daily, "jobs.md": vector.task };
  const app = makePlannedApp({
    files,
    targets: { jobs: "jobs.md" },
    triggers,
    tasks: [task],
  });
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.onload();
  return { plugin, triggers, task, daily, dailyPath, clock: CLOCK, ...overrides };
}

function rebuildVector(setup, clock = CLOCK) {
  const { plugin, daily, dailyPath } = setup;
  const todayChanged = plugin.rebuildTodayCache(daily, dailyPath, clock);
  const snoozedChanged = plugin.rebuildSnoozedCache(daily, dailyPath, clock, {
    zone: "UTC",
  });
  return { todayChanged, snoozedChanged };
}

function freshnessTierFor(plugin, task, tasks) {
  const row = helpers.freshnessRowFromTask(task, 0, {
    list: tasks,
    todayDay: TODAY_DAY,
    isToday: (candidate) => plugin.api.isToday(candidate),
    isSnoozed: (candidate) => plugin.api.isSnoozedToday(candidate),
  });
  return helpers.freshnessEvaluate(row, DATE_TEXT, CFG).tier;
}

test("planned-today fixture copy matches bob-cli byte-for-byte", () => {
  const copy = fs.readFileSync(FIXTURE_PATH);
  const canonical = fs.readFileSync(CANONICAL_PATH);
  assert.equal(copy.length, canonical.length);
  assert.deepEqual(copy, canonical);
});

test("every SP vector classifies the same membership Today keeps", () => {
  withMissingConfig(() => {
    const fixture = loadVectors();
    for (const vector of fixture.vectors) {
      const setup = setupVector(vector);
      const { plugin, task } = setup;
      try {
        rebuildVector(setup);
        const member = ["asleep", "due", "blocked"].includes(vector.snooze_state);
        assert.equal(
          plugin.api.isSnoozedToday(task),
          member,
          `${vector.id} isSnoozedToday`,
        );
        assert.equal(
          plugin.api.isToday(task),
          vector.today === 1,
          `${vector.id} isToday stays ledger-derived`,
        );
        assert.equal(
          plugin.api.isPlannedToday(task),
          member || vector.today === 1,
          `${vector.id} isPlannedToday is the union`,
        );
        const planned = plugin.api.snoozed.plannedKeys();
        assert.equal(
          planned.length,
          member ? 1 : 0,
          `${vector.id} planned key count`,
        );
        if (member) {
          assert.equal(planned[0], "jobs.md#^job", `${vector.id} identity`);
        }
        // Today membership is ledger-shaped (no caret); the snoozed
        // identity keeps the caret form the classifier returns.
        assert.equal(
          plugin.api.todayKeys().length,
          vector.today === 1 ? 1 : 0,
          `${vector.id} todayKeys`,
        );
        const tier = freshnessTierFor(plugin, task, [task]);
        assert.equal(tier || null, vector.tier, `${vector.id} review tier`);
      } finally {
        plugin.onunload();
      }
    }
  });
});

test("asleep and due rows wake next at 15:30; history reports woke_at", () => {
  withMissingConfig(() => {
    const fixture = loadVectors();
    const byId = Object.fromEntries(fixture.vectors.map((v) => [v.id, v]));
    // SP2 targets 11:00 (already due at the noon clock); the rest pin
    // the 15:30 target from the shared fixture row.
    for (const [id, hhmm, minutes] of [
      ["SP1", "15:30", 930],
      ["SP2", "11:00", 660],
      ["SP11", "15:30", 930],
      ["SP12", "15:30", 930],
    ]) {
      const setup = setupVector(byId[id]);
      try {
        rebuildVector(setup);
        const wake = setup.plugin.api.snoozed.nextWakeAt();
        assert.ok(
          typeof wake === "string" && wake.includes(hhmm),
          `${id} nextWakeAt pins ${hhmm}, got ${wake}`,
        );
        const rows = setup.plugin.api.snoozed.rows();
        assert.equal(rows.length, 1, `${id} one live snapshot`);
        assert.equal(rows[0].history, false, `${id} live row`);
        assert.equal(rows[0].minutes, minutes, `${id} target in minutes`);
        assert.equal(rows[0].hhmm, hhmm.replace(":", ""), `${id} HHMM`);
        assert.equal(rows[0].childrenText, "", `${id} no notes travel yet`);
      } finally {
        setup.plugin.onunload();
      }
    }
    const struck = setupVector(byId.SP10);
    try {
      rebuildVector(struck);
      assert.deepEqual(struck.plugin.api.snoozed.plannedKeys(), []);
      assert.equal(struck.plugin.api.snoozed.nextWakeAt(), null);
      const rows = struck.plugin.api.snoozed.rows();
      assert.equal(rows.length, 1, "SP10 reports its history row");
      assert.equal(rows[0].history, true, "SP10 history flag");
      assert.equal(rows[0].state, "woken", "SP10 history state");
      assert.equal(rows[0].wokeAt, "11:00", "SP10 woke provenance");
    } finally {
      struck.plugin.onunload();
    }
  });
});

test("linked PRE/POST keep their checklist tier; snoozed PRE/POST do not", () => {
  withMissingConfig(() => {
    const fixture = loadVectors();
    const byId = Object.fromEntries(fixture.vectors.map((v) => [v.id, v]));
    // SP5: live ledger link wins; the row is already_linked, so the
    // task keeps its ordinary PRE tier and Today membership.
    const linked = setupVector(byId.SP5);
    try {
      rebuildVector(linked);
      assert.equal(linked.plugin.api.isSnoozedToday(linked.task), false);
      assert.equal(linked.plugin.api.isToday(linked.task), true);
      assert.equal(freshnessTierFor(linked.plugin, linked.task, [linked.task]), "pre");
    } finally {
      linked.plugin.onunload();
    }
    // SP7/SP8: snoozed Next/Pending checklist rows never enter PRE/POST.
    for (const id of ["SP3", "SP7", "SP8"]) {
      const setup = setupVector(byId[id]);
      try {
        rebuildVector(setup);
        assert.equal(
          freshnessTierFor(setup.plugin, setup.task, [setup.task]),
          null,
          `${id} no checklist tier while snoozed`,
        );
      } finally {
        setup.plugin.onunload();
      }
    }
  });
});

test("due recurring occurrence loses its RECURRING tier while snoozed", () => {
  withMissingConfig(() => {
    const fixture = loadVectors();
    const vector = fixture.vectors.find((v) => v.id === "SP6");
    // The same occurrence walks RECURRING without the Snoozed row.
    const tasks = [taskForVector(vector)];
    const plain = helpers.freshnessRowFromTask(tasks[0], 0, {
      list: tasks,
      todayDay: TODAY_DAY,
      isToday: () => false,
      isSnoozed: () => false,
    });
    assert.equal(helpers.freshnessEvaluate(plain, DATE_TEXT, CFG).tier, "recurring");
    const setup = setupVector(vector);
    try {
      rebuildVector(setup);
      assert.equal(setup.plugin.api.isSnoozedToday(setup.task), true);
      assert.equal(
        freshnessTierFor(setup.plugin, setup.task, [setup.task]),
        null,
        "SP6 no RECURRING tier while snoozed",
      );
    } finally {
      setup.plugin.onunload();
    }
  });
});

test("snoozed rows leave the review queue, lane walk, and sections", () => {
  withMissingConfig(() => {
    const fixture = loadVectors();
    const byId = Object.fromEntries(fixture.vectors.map((v) => [v.id, v]));
    const setup = setupVector(byId.SP1);
    try {
      rebuildVector(setup);
      const { plugin, task } = setup;
      const tasks = [task];
      const isToday = (candidate) => plugin.api.isToday(candidate);
      const isSnoozed = (candidate) => plugin.api.isSnoozedToday(candidate);
      // Review queue: no tier, empty walk.
      const row = helpers.freshnessRowFromTask(task, 0, {
        list: tasks,
        todayDay: TODAY_DAY,
        isToday,
        isSnoozed,
      });
      assert.equal(helpers.freshnessEvaluate(row, DATE_TEXT, CFG).tier, null);
      assert.equal(helpers.freshnessQueue([row], DATE_TEXT, CFG).length, 0);
      // Lane walk: the held Next is neither an entry nor a Today tally.
      const queue = laneWalkQueueFromTasks(tasks, new Date(2026, 10, 17), isToday, {
        isSnoozed,
      });
      assert.equal(queue.entries.length, 0, "SP1 no lane-walk entry");
      assert.equal(queue.counts.next, 0, "SP1 filtered next count");
      assert.equal(queue.counts.todayNext, 0, "SP1 no Today tally");
      assert.equal(queue.counts.snoozed, 1, "SP1 snoozed tally");
      // Dashboard section drops the row; the whole lane keeps it.
      const section = dashboardLaneBudgetFromTasks(
        tasks,
        new Date(2026, 10, 17),
        helpers.defaultPlanCaps(),
        "next",
        isToday,
        isSnoozed,
      );
      assert.equal(section.section, 0, "SP1 section excludes snoozed");
      assert.equal(section.snoozed, 1, "SP1 section snoozed tally");
      assert.equal(section.lane, 1, "SP1 whole lane keeps the task");
      // Whole-lane plan meters never swing: the held task still counts.
      assert.equal(laneBudgetFromTasks(tasks, new Date(2026, 10, 17), helpers.defaultPlanCaps(), "next").count, 1);
      assert.equal(readyCountFromTasks(tasks, new Date(2026, 10, 17), isToday, null, isSnoozed), 0);
    } finally {
      setup.plugin.onunload();
    }
  });
});

test("previous-day rows and prose mentions stay neutral", () => {
  withMissingConfig(() => {
    const fixture = loadVectors();
    const byId = Object.fromEntries(fixture.vectors.map((v) => [v.id, v]));
    // SP9 reads the previous day's note: snooze ignored, NEXT tier held.
    const previous = setupVector(byId.SP9);
    try {
      rebuildVector(previous, new Date(2026, 10, 17, 12, 0, 0));
      assert.equal(previous.plugin.api.isSnoozedToday(previous.task), false);
      assert.equal(
        freshnessTierFor(previous.plugin, previous.task, [previous.task]),
        "next",
        "SP9 NEXT tier",
      );
      const tasks = [previous.task];
      const queue = laneWalkQueueFromTasks(tasks, new Date(2026, 10, 17), () => false, {});
      assert.equal(queue.entries.length, 1, "SP9 walks");
    } finally {
      previous.plugin.onunload();
    }
    // SP17: a prose mention is not a ledger link, so the task is not
    // Today — and the Snoozed row still parks it.
    const prose = setupVector(byId.SP17);
    try {
      rebuildVector(prose);
      assert.equal(prose.plugin.api.isToday(prose.task), false);
      assert.equal(prose.plugin.api.isSnoozedToday(prose.task), true);
      assert.equal(
        freshnessTierFor(prose.plugin, prose.task, [prose.task]),
        null,
      );
    } finally {
      prose.plugin.onunload();
    }
  });
});

test("SP16: lane excess falls without moving the whole plan lane", () => {
  withMissingConfig(() => {
    const held = plannedTask({ symbol: "/", blockId: "held" });
    const tasks = [held];
    for (let index = 0; index < 10; index += 1) {
      tasks.push(plannedTask({ symbol: "/", blockId: `open${index}` }));
    }
    const daily =
      "## Pomodoros\n- [ ] ()\n\n## Snoozed\n- **1530** [[jobs#^held]]\n";
    const triggers = [];
    const app = makePlannedApp({
      files: { [DAY]: daily, "jobs.md": "- [/] #task Held ^held\n" },
      targets: { jobs: "jobs.md" },
      triggers,
      tasks,
    });
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.onload();
    try {
      plugin.rebuildTodayCache(daily, DAY, CLOCK);
      plugin.rebuildSnoozedCache(daily, DAY, CLOCK, { zone: "UTC" });
      const isToday = (candidate) => plugin.api.isToday(candidate);
      const isSnoozed = (candidate) => plugin.api.isSnoozedToday(candidate);
      assert.equal(plugin.api.isSnoozedToday(held), true);
      const caps = { maxNext: 15, maxPending: 10, maxReady: 100 };
      const section = dashboardLaneBudgetFromTasks(
        tasks,
        new Date(2026, 10, 17),
        caps,
        "pending",
        isToday,
        isSnoozed,
      );
      assert.equal(section.section, 10, "SP16 filtered section");
      assert.equal(section.snoozed, 1, "SP16 parked row tallied");
      assert.equal(section.lane, 11, "SP16 whole lane keeps all eleven");
      assert.equal(section.over, true, "whole-lane pressure stays visible");
      const queue = laneWalkQueueFromTasks(tasks, new Date(2026, 10, 17), isToday, {
        isSnoozed,
      });
      assert.equal(queue.counts.pending, 10, "SP16 walk count drops");
      assert.equal(queue.counts.snoozed, 1, "SP16 walk snoozed tally");
    } finally {
      plugin.onunload();
    }
  });
});

test("SP13: a wake swaps the snoozed exclusion for ordinary Today", () => {
  withMissingConfig(() => {
    const task = plannedTask({ symbol: "*", extraMarkdown: " [fresh:: 2026-10-01] [keeps:: 3]" });
    const tasks = [task];
    const before = "## Pomodoros\n- [ ] ()\n\n## Snoozed\n- **1100** [[jobs#^job]]\n  - Bring notes\n";
    const triggers = [];
    const files = { [DAY]: before, "jobs.md": task.originalMarkdown };
    const app = makePlannedApp({
      files,
      targets: { jobs: "jobs.md" },
      triggers,
      tasks,
    });
    const plugin = new LedgerToolsPlugin(app, {});
    plugin.onload();
    try {
      plugin.rebuildTodayCache(before, DAY, CLOCK);
      plugin.rebuildSnoozedCache(before, DAY, CLOCK, { zone: "UTC" });
      assert.equal(plugin.api.isSnoozedToday(task), true);
      assert.equal(plugin.api.isToday(task), false);
      assert.equal(freshnessTierFor(plugin, task, tasks), null);
      const after =
        "## Pomodoros\n- [ ] ()\n  - [[jobs#^job]]\n    - Bring notes\n\n## Snoozed\n";
      plugin.rebuildTodayCache(after, DAY, CLOCK);
      plugin.rebuildSnoozedCache(after, DAY, CLOCK, { zone: "UTC" });
      assert.equal(plugin.api.isSnoozedToday(task), false);
      assert.equal(plugin.api.isToday(task), true);
      assert.equal(freshnessTierFor(plugin, task, tasks), null);
      assert.equal(task.originalMarkdown.includes("[fresh:: 2026-10-01]"), true);
    } finally {
      plugin.onunload();
    }
  });
});

test("membership changes refresh Tasks queries without a Today change", () => {
  withMissingConfig(() => {
    const fixture = loadVectors();
    const setup = setupVector(fixture.vectors.find((v) => v.id === "SP1"));
    const { plugin, daily, dailyPath } = setup;
    try {
      // No ledger links in this daily: the Today rebuild is a no-op
      // while the snoozed rebuild moves planned-today empty → held.
      assert.equal(plugin.rebuildTodayCache(daily, dailyPath, CLOCK), false);
      assert.equal(plugin.rebuildSnoozedCache(daily, dailyPath, CLOCK, { zone: "UTC" }), true);
      const firstTriggers = triggersOf(setup);
      assert.ok(firstTriggers.includes(TODAY_RELOAD_EVENT));
      const count = firstTriggers.length;
      // Same bytes: no membership change, no new fan-out.
      assert.equal(plugin.rebuildSnoozedCache(daily, dailyPath, CLOCK, { zone: "UTC" }), false);
      assert.equal(triggersOf(setup).length, count);
      // Dropping the row changes planned-today while Today stays put.
      const dropped = "## Pomodoros\n- [ ] ()\n\n## Snoozed\n";
      assert.equal(plugin.rebuildSnoozedCache(dropped, dailyPath, CLOCK, { zone: "UTC" }), true);
      assert.ok(triggersOf(setup).length > count);
      assert.deepEqual(plugin.api.snoozed.plannedKeys(), []);
    } finally {
      plugin.onunload();
    }
  });
});

function triggersOf(setup) {
  return setup.triggers;
}

test("target edits, rollover, and minute ticks invalidate the cache", async () => {
  withMissingConfig(() => {
    const fixture = loadVectors();
    const setup = setupVector(fixture.vectors.find((v) => v.id === "SP1"));
    const { plugin, daily, dailyPath } = setup;
    try {
      plugin.rebuildTodayCache(daily, dailyPath, CLOCK);
      plugin.rebuildSnoozedCache(daily, dailyPath, CLOCK, { zone: "UTC" });
      // An unrelated note never invalidates.
      assert.equal(
        plugin.refreshSnoozedCacheForChangedFile({ path: "notes/other.md" }, "text", CLOCK),
        false,
      );
      // A target-note edit schedules a debounced rebuild.
      assert.equal(
        plugin.refreshSnoozedCacheForChangedFile({ path: "jobs.md" }, "text", CLOCK),
        true,
      );
      assert.notEqual(plugin.snoozedRefreshTimer, null);
      plugin.cancelSnoozedRefresh();
      assert.equal(plugin.snoozedRefreshTimer, null);
      // Vault rename of a target note is target-aware too.
      assert.equal(
        plugin.refreshSnoozedCacheForVaultEvent({ path: "jobs.md" }, null, CLOCK),
        true,
      );
      plugin.cancelSnoozedRefresh();
      assert.equal(
        plugin.refreshSnoozedCacheForVaultEvent({ path: "notes/other.md" }, null, CLOCK),
        false,
      );
      // A new minute needs a rebuild; the same minute does not.
      assert.equal(
        plugin.snoozedCacheNeedsMinuteRefresh(new Date(2026, 10, 17, 12, 0, 30)),
        false,
      );
      assert.equal(
        plugin.snoozedCacheNeedsMinuteRefresh(new Date(2026, 10, 17, 12, 1, 0)),
        true,
      );
      // Rollover to a new daily path kicks off a refresh.
      assert.equal(
        plugin.refreshSnoozedCacheForRollover(new Date(2026, 10, 17, 12, 0, 0)),
        false,
      );
      assert.equal(
        plugin.refreshSnoozedCacheForRollover(new Date(2026, 10, 18, 0, 1, 0)),
        true,
      );
      plugin.cancelSnoozedRefresh();
    } finally {
      plugin.onunload();
    }
  });
});

test("async refresh discards stale generations", async () => {
  withMissingConfig(async () => {
    const fixture = loadVectors();
    const setup = setupVector(fixture.vectors.find((v) => v.id === "SP1"));
    const { plugin, dailyPath } = setup;
    try {
      const first = plugin.refreshSnoozedCacheFromDaily(CLOCK);
      const second = plugin.refreshSnoozedCacheFromDaily(CLOCK);
      const [firstResult, secondResult] = await Promise.all([first, second]);
      assert.equal(firstResult, false, "stale generation drops");
      assert.equal(typeof secondResult, "boolean");
      assert.equal(plugin.isSnoozedCacheReady(CLOCK), true);
    } finally {
      plugin.onunload();
    }
  });
});

test("SP14: a snoozed Blocked-to-Ready row takes no automatic field", () => {
  const line = "- [ ] #task Recovered (root::  sase) [fresh:: 2026-10-01]";
  const scope = { today: "2026-11-17" };
  assert.equal(
    helpers.freshnessMarkUnblockedLine(line, scope).includes("[unblocked::"),
    true,
    "ordinary recovery still stamps",
  );
  assert.equal(
    helpers.freshnessMarkUnblockedLine(line, { ...scope, isSnoozedToday: true }),
    line,
    "SP14 snoozed recovery writes nothing",
  );
  assert.equal(
    helpers.freshnessMarkUnblockedLine(line, { ...scope, isToday: true }),
    line,
    "Today recovery still writes nothing",
  );
});

test("api shape exposes additive snoozed namespace", () => {
  withMissingConfig(() => {
    const setup = setupVector(loadVectors().vectors[0]);
    const { plugin, triggers } = setup;
    try {
      assert.equal(plugin.api.version, 3);
      assert.equal(typeof plugin.api.isSnoozedToday, "function");
      assert.equal(typeof plugin.api.isPlannedToday, "function");
      assert.equal(plugin.api.snoozed.version, 1);
      assert.deepEqual(plugin.api.snoozed.rows(), []);
      assert.deepEqual(plugin.api.snoozed.plannedKeys(), []);
      assert.equal(plugin.api.snoozed.nextWakeAt(), null);
      assert.equal(plugin.api.isSnoozedToday(null), false);
      assert.equal(plugin.api.isSnoozedToday({}), false);
      assert.equal(plugin.api.isPlannedToday({}), false);
      void triggers;
    } finally {
      plugin.onunload();
    }
  });
});
