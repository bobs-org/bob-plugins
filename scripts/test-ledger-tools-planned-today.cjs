// Planned-today conformance for the snoozed cache (`docs/freshness.md`
// "Planned-today conformance (SP)", `docs/plan.md` "Snoozed forecast").
// The stable inputs live in
// `plugins/bob-ledger-tools/scripts/fixtures/walks/planned-today.json`,
// a byte-for-byte copy of bob-cli `tests/fixtures/walks/planned-today.json`.
// Unless noted, the clock is 2026-11-17 12:00 local, `jobs.md` holds one
// unstamped task, and today's Snoozed row targets 15:30.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
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
      getFileCache: () => null,
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

test("snoozed cache uses structural Event Task detection", () => {
  const dailyPath = "2026/20261117.md";
  const snoozedContent = "## Snoozed\n- **1530** [[Projects/Plan#^work]]\n";
  const projectTask = {
    ...plannedTask({ taskPath: "Projects/Plan.md", blockId: "work", description: "MEET launch planning" }),
    originalMarkdown: "- [ ] #task MEET launch planning ^work",
  };
  const projectInput = helpers.snoozedBuildClassifyInput({
    content: snoozedContent,
    dailyPath,
    tasks: [projectTask],
    resolve: () => ({ path: "Projects/Plan.md" }),
    todayKeySet: new Set(),
    clock: CLOCK,
    zone: "UTC",
    metadataCache: { getFileCache: () => null },
    vault: { getAbstractFileByPath: (filePath) => ({ path: filePath }) },
  });
  assert.equal(projectInput.rows[0].is_event, false, "a MEET word in a project note is ordinary task text");
  const projectClassified = helpers.snoozeModel.classifyRows(projectInput.classifierInput);
  assert.notEqual(projectClassified.rows[0].state, "event_task");
  assert.deepEqual(projectClassified.planned, ["Projects/Plan.md#^work"]);

  const eventLine = "- [ ] **1300-1330** Plan the launch ^event";
  const eventContent = [
    "## Events",
    eventLine,
    "",
    "## Snoozed",
    "- **1530** [[#^event]]",
  ].join("\n");
  const eventTask = {
    ...plannedTask({ taskPath: dailyPath, blockId: "event", description: "Plan the launch" }),
    lineNumber: 1,
    originalMarkdown: eventLine,
  };
  const eventInput = helpers.snoozedBuildClassifyInput({
    content: eventContent,
    dailyPath,
    tasks: [eventTask],
    resolve: () => ({ path: dailyPath }),
    todayKeySet: new Set(),
    clock: CLOCK,
    zone: "UTC",
    metadataCache: { getFileCache: () => null },
    vault: { getAbstractFileByPath: (filePath) => ({ path: filePath }) },
  });
  assert.equal(eventInput.rows[0].is_event, true, "a valid Events-section row needs no MEET marker");
  const eventClassified = helpers.snoozeModel.classifyRows(eventInput.classifierInput);
  assert.equal(eventClassified.rows[0].state, "event_task");
  assert.deepEqual(eventClassified.planned, []);
});

function wakeReport(now, { woken = [], notified = "none", status = woken.length ? "woke" : "nothing_due" } = {}) {
  return {
    schema_version: 1,
    date: helpers.snoozedTodayTextFromClock(now),
    now: now.toISOString(),
    status,
    woken,
    dropped: [],
    ignored: [],
    pending: [],
    next_wake_at: null,
    plan: { count: 1, cap: 10, over: false },
    notified,
    wake_id: null,
    daily_file: "2026/20261117.md",
  };
}

function wakerAt(now, report) {
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  Object.assign(plugin, {
    snoozedCache: {
      date: helpers.snoozedTodayTextFromClock(now),
      nowMinutes: helpers.snoozedNowMinutesFromClock(now),
      nextWakeAt: new Date(now.getTime() - 60_000).toISOString(),
    },
    snoozeWakeLastAttemptMinute: "",
    snoozeWakeInFlight: false,
    snoozeWakeDisabled: false,
    snoozeWakeUnloaded: false,
    snoozeWakeGeneration: 0,
    snoozeWakeNow: () => new Date(now.getTime()),
    snoozeWakeIsDesktop: () => true,
    isSnoozedCacheReady: () => true,
    snoozeWakeSpawn: async () => ({ ok: true, report }),
  });
  return plugin;
}

test("snooze wake report decoder validates the whole public envelope", () => {
  const now = new Date(2026, 10, 17, 15, 31);
  const row = {
    route: "jobs.md",
    block_id: "job",
    title: "Email Dan",
    target: "1530",
    woke_at: "15:31",
    destination: { line: 3, name: "WRITE", created: false },
    over_cap: false,
  };
  assert.deepEqual(helpers.snoozeWakeDecodeReport(JSON.stringify(wakeReport(now, { woken: [row] })), ""), {
    ok: true,
    report: wakeReport(now, { woken: [row] }),
  });
  const skipped = { ...wakeReport(now, { status: "skipped" }), skip_reason: "zone_unconfigured" };
  assert.deepEqual(helpers.snoozeWakeDecodeReport(JSON.stringify(skipped), ""), {
    ok: true,
    report: skipped,
  });
  for (const corrupt of [
    { schema_version: 2 },
    { status: "woke", woken: [null] },
    { notified: "other" },
    { plan: { count: "1", cap: 10, over: false } },
  ]) {
    const bad = { ...wakeReport(now), ...corrupt };
    assert.equal(helpers.snoozeWakeDecodeReport(JSON.stringify(bad), "").ok, false);
  }
  assert.equal(helpers.snoozeWakeDecodeReport("not json", "").code, "bad-json");
});

test("snooze wake accepts unnamed destinations and the CLI's slim deferred envelope", async () => {
  const now = new Date(2026, 10, 17, 15, 31);
  const untypedRow = {
    route: "jobs.md",
    block_id: "job",
    title: "Review the launch plan",
    target: "1100",
    woke_at: "12:00",
    destination: { created: false, line: 4, name: null },
    over_cap: false,
  };
  const woke = wakeReport(now, { woken: [untypedRow] });
  assert.deepEqual(
    helpers.snoozeWakeDecodeReport(JSON.stringify(woke), ""),
    { ok: true, report: woke },
  );
  assert.equal(
    helpers.snoozeWakeNoticeText(woke),
    "⏰ Ready now: Review the launch plan · woke 12:00",
  );

  const deferred = {
    schema_version: 1,
    date: "2026-11-17",
    now: now.toISOString(),
    status: "deferred",
    daily_file: "2026/20261117.md",
    notified: "none",
    wake_id: "18eba710ff76f2a0",
  };
  assert.deepEqual(
    helpers.snoozeWakeDecodeReport(JSON.stringify(deferred), ""),
    { ok: true, report: deferred },
  );
  for (const invalid of [
    { ...deferred, pending: null },
    { ...deferred, plan: { count: "1", cap: 10, over: false } },
  ]) {
    assert.equal(helpers.snoozeWakeDecodeReport(JSON.stringify(invalid), "").ok, false);
  }

  const plugin = wakerAt(now, deferred);
  let attempts = 0;
  let refreshes = 0;
  const notices = [];
  plugin.snoozeWakeSpawn = async () => {
    attempts += 1;
    const report = attempts === 1
      ? deferred
      : { ...deferred, date: "2026-11-17", now: new Date(now.getTime() + 60_000).toISOString() };
    return { ok: true, report };
  };
  plugin.refreshSnoozedCacheFromDaily = async () => { refreshes += 1; };
  plugin.snoozeWakeNotice = (report) => notices.push(report);
  assert.equal(await plugin.snoozeWakeTick(now), true);
  assert.equal(plugin.snoozeWakeDisabled, false);
  assert.equal(refreshes, 0, "deferred does not refresh the cache");
  assert.deepEqual(notices, [], "deferred does not show a Notice");
  const nextMinute = new Date(now.getTime() + 60_000);
  plugin.snoozedCache.nowMinutes = helpers.snoozedNowMinutesFromClock(nextMinute);
  plugin.snoozeWakeNow = () => nextMinute;
  assert.equal(await plugin.snoozeWakeTick(nextMinute), true, "deferred retries next minute");
  assert.equal(attempts, 2);
});

test("minute waker is desktop-only, single-flight, and notices only its own unnotified wake", async () => {
  const now = new Date(2026, 10, 17, 15, 31);
  const row = { route: "jobs.md", block_id: "job", title: "Email Dan", target: "1530", woke_at: "15:31", destination: { line: 3, name: "WRITE", created: false }, over_cap: false };
  const plugin = wakerAt(now, wakeReport(now, { woken: [row] }));
  let spawns = 0;
  let refreshes = 0;
  const notices = [];
  plugin.snoozeWakeSpawn = async () => { spawns += 1; return { ok: true, report: wakeReport(now, { woken: [row] }) }; };
  plugin.refreshSnoozedCacheFromDaily = async () => { refreshes += 1; return true; };
  plugin.snoozeWakeNotice = (report) => notices.push(helpers.snoozeWakeNoticeText(report));
  assert.equal(await plugin.snoozeWakeTick(now), true);
  assert.equal(await plugin.snoozeWakeTick(now), false);
  assert.equal(spawns, 1, "one attempt per local minute");
  assert.equal(refreshes, 1, "refreshes authoritative cache after write");
  assert.deepEqual(notices, ["⏰ Ready now: Email Dan · woke 15:31 · WRITE"]);

  const notified = wakerAt(now, wakeReport(now, { woken: [row], notified: "desktop" }));
  let notifiedNotice = false;
  notified.snoozeWakeSpawn = async () => ({ ok: true, report: wakeReport(now, { woken: [row], notified: "desktop" }) });
  notified.refreshSnoozedCacheFromDaily = async () => true;
  notified.snoozeWakeNotice = () => { notifiedNotice = true; };
  await notified.snoozeWakeTick(now);
  assert.equal(notifiedNotice, false, "Mac Capture or desktop notification suppresses fallback");

  const mobile = wakerAt(now, wakeReport(now));
  mobile.snoozeWakeIsDesktop = () => false;
  let mobileSpawn = false;
  mobile.snoozeWakeSpawn = async () => { mobileSpawn = true; return { ok: true, report: wakeReport(now) }; };
  assert.equal(await mobile.snoozeWakeTick(now), false);
  assert.equal(mobileSpawn, false);
});

test("minute waker retries transient failures, disables only explicit unsupported syntax, and ignores stale unload results", async () => {
  const now = new Date(2026, 10, 17, 15, 31);
  const plugin = wakerAt(now, wakeReport(now));
  let attempts = 0;
  plugin.snoozeWakeSpawn = async () => {
    attempts += 1;
    return attempts === 1 ? { ok: false, exitCode: 1, message: "temporary I/O" } : { ok: true, report: wakeReport(now) };
  };
  assert.equal(await plugin.snoozeWakeTick(now), false);
  assert.equal(plugin.snoozeWakeDisabled, false);
  const nextMinute = new Date(now.getTime() + 60_000);
  plugin.snoozedCache.nowMinutes = helpers.snoozedNowMinutesFromClock(nextMinute);
  plugin.snoozedCache.nextWakeAt = new Date(nextMinute.getTime() - 60_000).toISOString();
  plugin.snoozeWakeNow = () => nextMinute;
  assert.equal(await plugin.snoozeWakeTick(nextMinute), true);
  assert.equal(attempts, 2);
  assert.equal(helpers.snoozeWakeUnsupportedFailure({ exitCode: 2, message: "unknown subcommand 'snooze'" }), true);
  assert.equal(helpers.snoozeWakeUnsupportedFailure({ exitCode: 2, message: "invalid value" }), false);

  const stale = wakerAt(now, wakeReport(now));
  let finish;
  stale.snoozeWakeSpawn = () => new Promise((resolve) => { finish = resolve; });
  const pending = stale.snoozeWakeTick(now);
  stale.disposeSnoozeWaker();
  assert.equal(await stale.snoozeWakeTick(now), false, "unload prevents new spawns");
  finish({ ok: true, report: wakeReport(now) });
  assert.equal(await pending, false);
});

test("minute waker waits for a live due row and cannot overlap a slow spawn", async () => {
  const now = new Date(2026, 10, 17, 15, 31);
  const asleep = wakerAt(now, wakeReport(now));
  asleep.snoozedCache.nextWakeAt = new Date(now.getTime() + 60_000).toISOString();
  let calls = 0;
  asleep.snoozeWakeSpawn = async () => { calls += 1; return { ok: true, report: wakeReport(now) }; };
  assert.equal(await asleep.snoozeWakeTick(now), false);
  assert.equal(calls, 0, "future rows do not spawn");

  const blocked = wakerAt(now, wakeReport(now));
  blocked.snoozedCache.nextWakeAt = null;
  blocked.snoozeWakeSpawn = async () => { calls += 1; return { ok: true, report: wakeReport(now) }; };
  assert.equal(await blocked.snoozeWakeTick(now), false);
  assert.equal(calls, 0, "parked rows do not spawn");

  const slow = wakerAt(now, wakeReport(now));
  let release;
  slow.snoozeWakeSpawn = () => { calls += 1; return new Promise((resolve) => { release = resolve; }); };
  const first = slow.snoozeWakeTick(now);
  assert.equal(await slow.snoozeWakeTick(now), false);
  assert.equal(calls, 1, "an in-flight spawn is not overlapped");
  release({ ok: true, report: wakeReport(now) });
  await first;
});

test("minute waker never launches bob without the open vault's path", async () => {
  const childProcess = require("child_process");
  const originalExecFile = childProcess.execFile;
  const calls = [];
  childProcess.execFile = (...args) => {
    calls.push(args);
    throw new Error("execFile must not run without a vault path");
  };
  try {
    const now = new Date(2026, 10, 17, 15, 31);
    const plugin = wakerAt(now, wakeReport(now));
    delete plugin.snoozeWakeSpawn;
    plugin.app = { vault: {} };
    assert.equal(await plugin.snoozeWakeTick(now), false);
    assert.equal(plugin.snoozeWakeDisabled, false, "no-vault stays transient");
    const spawned = await plugin.snoozeWakeSpawn();
    assert.equal(spawned.ok, false);
    assert.equal(spawned.code, "no-vault");
    assert.equal(calls.length, 0);
  } finally {
    childProcess.execFile = originalExecFile;
  }
});

test("minute waker launches bob with BOB_DIR set to the vault base path", async () => {
  const childProcess = require("child_process");
  const originalExecFile = childProcess.execFile;
  const calls = [];
  const now = new Date(2026, 10, 17, 15, 31);
  const canned = JSON.stringify(wakeReport(now, { status: "nothing_due" }));
  childProcess.execFile = (_file, args, options, callback) => {
    calls.push({ args, env: options.env });
    queueMicrotask(() => callback(null, canned, ""));
    return { stdin: { write() {}, end() {}, on() {} } };
  };
  const basePath = fs.mkdtempSync(path.join(os.tmpdir(), "bob-plugins-waker-vault-"));
  try {
    const plugin = wakerAt(now, wakeReport(now));
    delete plugin.snoozeWakeSpawn;
    plugin.app = { vault: { adapter: { basePath } } };
    assert.equal(await plugin.snoozeWakeTick(now), true);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, ["snooze", "wake", "-q", "-f", "json"]);
    assert.equal(calls[0].env.BOB_DIR, basePath);
  } finally {
    childProcess.execFile = originalExecFile;
    fs.rmSync(basePath, { recursive: true, force: true });
  }
});
