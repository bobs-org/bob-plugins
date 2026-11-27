const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { LedgerToolsPlugin, helpers } = require("./ledger-tools-harness.cjs");
const PLUGIN_FIXTURE = path.join(
  __dirname,
  "..",
  "plugins",
  "bob-ledger-tools",
  "scripts",
  "fixtures",
  "snooze",
  "marks.json",
);
const BOB_CLI_DIR =
  process.env.BOB_CLI_DIR || path.resolve(__dirname, "../../../../..");
const CANONICAL_FIXTURE = path.join(
  BOB_CLI_DIR,
  "tests",
  "fixtures",
  "snooze",
  "marks.json",
);

const {
  planBlockModel,
  snoozePlanMeterModel,
} = helpers;

function meterOutput(meter) {
  return {
    chip: meter.chip,
    forecast: meter.forecast,
    lint: meter.lint,
    text: meter.text,
    tone: meter.tone,
    tooltip: meter.tooltip,
  };
}

test("plan-meter fixture copy matches bob-cli marks.json byte for byte", () => {
  assert.deepEqual(
    fs.readFileSync(PLUGIN_FIXTURE),
    fs.readFileSync(CANONICAL_FIXTURE),
  );
});

test("the plan meter runs every canonical SM-P vector verbatim", () => {
  const fixture = JSON.parse(fs.readFileSync(CANONICAL_FIXTURE, "utf8"));
  const vectors = fixture.groups.plan;
  assert.equal(vectors.length, 14);
  const ids = vectors.map((vector) => vector.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const vector of vectors) {
    assert.deepEqual(
      meterOutput(snoozePlanMeterModel(vector.input)),
      vector.expected,
      vector.id,
    );
  }
});

test("planBlockModel keeps snoozed forecast separate from ledger status and TODAY", () => {
  const content = "## Pomodoros\n\n- [ ] () — WRITE\n    - [[job#^live]]\n";
  const queue = [
    { id: "later", state: "asleep", target: "1530", on_clock: true },
  ];
  const model = planBlockModel({
    content,
    tasks: [],
    today: new Date("2026-11-05T13:00:00"),
    sourcePath: "2026/20261105.md",
    snoozedQueue: queue,
    snoozedAvailable: true,
    snoozedTodayCount: 0,
  });
  assert.equal(model.budget.status, "ok");
  assert.equal(model.budget.links.count, 1);
  assert.equal(model.snoozedMeter.text, "⏰ 1 · 15:30");
  assert.deepEqual(model.snoozedMeter.forecast, {
    cap: model.budget.links.cap,
    count: model.budget.links.count + 1,
    over: model.budget.links.count + 1 > model.budget.links.cap,
  });
  assert.equal(model.planText, `TODAY ${model.budget.links.count}/${model.budget.links.cap}`);

  const overCap = planBlockModel({
    content:
      "## Pomodoros\n\n- [ ] () — WRITE\n" +
      Array.from({ length: 9 }, (_, index) => `    - [[job#^live-${index}]]\n`).join(""),
    tasks: [],
    today: new Date("2026-11-05T13:00:00"),
    sourcePath: "2026/20261105.md",
    snoozedQueue: [
      { id: "first", state: "asleep", target: "1530", on_clock: true },
      { id: "second", state: "asleep", target: "1900", on_clock: true },
    ],
    snoozedAvailable: true,
    snoozedTodayCount: 9,
  });
  assert.equal(overCap.budget.status, "ok");
  assert.equal(overCap.snoozedMeter.forecast.over, true);
  assert.equal(overCap.snoozedMeter.lint, "snooze_wake_would_exceed_cap");
  assert.equal(overCap.over, false);
});

test("queue-only plan notes show the meter; unavailable cache stays neutral", () => {
  const queueOnly = planBlockModel({
    content: "## Snoozed\n- **1530** [[job#^later]]\n",
    tasks: [],
    today: new Date("2026-11-05T13:00:00"),
    sourcePath: "2026/20261105.md",
    snoozedQueue: [
      { id: "later", state: "asleep", target: "1530", on_clock: true },
    ],
    snoozedAvailable: true,
    snoozedTodayCount: 0,
  });
  assert.equal(queueOnly.budget.hasSection, false);
  assert.equal(queueOnly.snoozedMeter.chip, true);

  const unavailable = snoozePlanMeterModel({
    available: false,
    queue: [{ id: "later", state: "asleep", target: "1530", on_clock: true }],
    links_count: 1,
    cap: 10,
  });
  assert.equal(unavailable.chip, false);
  assert.deepEqual(unavailable.forecast, { cap: 10, count: 1, over: false });
});

test("plan chip is an accessible focused link and jumps to Snoozed", () => {
  const attrs = {};
  const listeners = {};
  const chip = {
    children: [],
    text: [],
    createEl(tag, options) {
      const attrs = {};
      const child = {
        tag,
        options,
        attrs,
        setAttribute(name, value) {
          attrs[name] = value;
        },
      };
      this.children.push(child);
      return child;
    },
    appendText(value) {
      this.text.push(String(value));
    },
    setAttribute(name, value) {
      attrs[name] = value;
    },
    addEventListener(name, listener) {
      listeners[name] = listener;
    },
  };
  const container = {
    createEl(tag, options) {
      assert.equal(tag, "a");
      chip.tag = tag;
      chip.options = options;
      return chip;
    },
  };
  const path = "2026/20261105.md";
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  let jumpedTo = null;
  plugin.jumpToSnoozedSection = (dailyPath) => {
    jumpedTo = dailyPath;
  };
  plugin.paintSnoozedPlanChip(
    container,
    snoozePlanMeterModel({
      queue: [{ id: "due", state: "due", target: "1600", on_clock: true }],
      links_count: 9,
      today_count: 9,
      cap: 10,
    }),
    path,
  );
  assert.equal(chip.options.text, undefined);
  assert.equal(chip.children.length, 1);
  assert.equal(chip.children[0].options.cls, "bob-snooze-plan-glyph");
  assert.equal(chip.children[0].attrs["aria-hidden"], "true");
  assert.deepEqual(chip.text, ["1 · 16:00"]);
  assert.match(chip.options.cls, /bob-plan-snoozed-due/);
  assert.doesNotMatch(chip.options.cls, /bob-plan-over|bob-work-tone/);
  assert.equal(attrs.href, "#");
  assert.equal(attrs["aria-label"], "1 snoozed · 1 due · next wakes 16:00 · not counted in TODAY · 9/10 when all wake");
  let prevented = false;
  let stopped = false;
  listeners.click({
    preventDefault() { prevented = true; },
    stopPropagation() { stopped = true; },
  });
  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.equal(jumpedTo, path);
});

test("Snoozed section jump re-scans the real H2 and refuses duplicate headers", async () => {
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  const dailyPath = "2026/20261105.md";
  plugin.currentTodayDailyPath = () => dailyPath;
  plugin.isSnoozedCacheReady = () => true;
  plugin.snoozedCache = { dailyPath };
  plugin.jumpToDailyNoteLine = async (_path, line, _ch, notices) =>
    notices.findLine(
      "```md\n## Snoozed\n```\n# Other\n## Snoozed\n- **1530** [[job#^x]]\n",
    );
  assert.equal(await plugin.jumpToSnoozedSection(dailyPath), 4);
  plugin.jumpToDailyNoteLine = async (_path, line, _ch, notices) =>
    notices.findLine("## Snoozed\n- **1530** [[job#^x]]\n## Snoozed\n");
  assert.equal(await plugin.jumpToSnoozedSection(dailyPath), null);
});

test("render-time snoozed rows reuse the plan effective-clock predicate", () => {
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  const dailyPath = "2026/20261105.md";
  const lookups = [];
  plugin.snoozedCache = {
    dailyPath,
    rows: [
      {
        key: "home.md#blocked-clock",
        state: "asleep",
        hhmm: "1530",
        minutes: 930,
        route: "home.md",
        blockId: "blocked-clock",
      },
      {
        key: "job.md#counted-clock",
        state: "asleep",
        hhmm: "1900",
        minutes: 1140,
        route: "job.md",
        blockId: "counted-clock",
      },
    ],
  };
  plugin.todayCache = { keys: ["job.md#today"] };
  plugin.isSnoozedCacheReady = () => true;
  plugin.isTodayCacheReady = () => true;
  plugin.planBudgetOffClockPredicate = (path, content) => {
    assert.equal(path, dailyPath);
    assert.equal(content, "## Snoozed\n");
    return (route, blockId) => {
      lookups.push([route, blockId]);
      return route === "home.md";
    };
  };
  const data = plugin.snoozedPlanDataForRender(
    [],
    "## Snoozed\n",
    dailyPath,
    new Date("2026-11-05T13:00:00"),
  );
  assert.deepEqual(lookups, [
    ["home.md", "blocked-clock"],
    ["job.md", "counted-clock"],
  ]);
  const meter = snoozePlanMeterModel({
    queue: data.snoozedQueue,
    available: data.snoozedAvailable,
    today_count: data.snoozedTodayCount,
    links_count: 3,
    cap: 10,
  });
  assert.equal(meter.count, 2);
  assert.equal(meter.eligibleWakeCount, 1);
  assert.equal(meter.forecast.count, 4);
});

test("minute and detail-only snoozed cache refreshes rerender plan blocks", () => {
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  const dailyPath = "2026/20261105.md";
  const before = new Date("2026-11-05T13:00:00");
  const after = new Date("2026-11-05T13:01:00");
  let rerenders = 0;
  plugin.app = {
    plugins: { plugins: { "obsidian-tasks-plugin": { getTasks: () => [] } } },
    workspace: { trigger() {} },
    metadataCache: {},
    vault: {},
  };
  plugin.todayCache = { rank: new Map(), keys: [] };
  plugin.todayEnteredAt = new Map();
  plugin.snoozedCache = {
    date: "2026-11-05",
    dailyPath,
    zone: "America/New_York",
    nowMinutes: 13 * 60,
    rows: [],
    byKey: new Map(),
    planned: [],
    blocked: [],
    nextWakeAt: null,
    detailsSignature: "previous row details",
  };
  plugin.snoozedEnteredAt = new Map();
  plugin.snoozedCacheGen = 0;
  plugin.currentTodayDailyPath = () => dailyPath;
  plugin.schedulePlanBlockRerender = () => { rerenders += 1; };
  plugin.scheduleSnoozeMarksRefresh = () => {};
  plugin.scheduleFreshnessStatusBar = () => {};
  plugin.scheduleFreshnessMarksRefresh = () => {};
  plugin.pomodoroThemeCacheTodayLedger = () => {};
  plugin.snoozeWakeTick = () => {};
  plugin.rebuildSnoozedCache("", dailyPath, before);
  assert.equal(rerenders, 1);
  plugin.rebuildSnoozedCache("", dailyPath, after);
  assert.equal(rerenders, 2);
});

