const assert = require("node:assert/strict");
const test = require("node:test");
const { LedgerToolsPlugin } = require("./ledger-tools-harness.cjs");
const {
  clockFixtureReport,
  clockEmptyOffClockReport,
  clockAdoptionGapReport,
  clockCountTotalReport,
  clockPinnedOffClockReport,
} = require("./stats-clock-fixtures.cjs");

const {
  statsClockBarParts,
  statsClockComparisonNeutral,
  statsClockHeaderSuffix,
  statsClockWindowIsEmpty,
  statsSparkBars,
  statsTileModel,
  statsChartSpokenDate,
  statsChartClockSpeech,
  statsChartTooltip,
  statsChartValueMarkSpecs,
  statsMetricEffectiveClock,
} = LedgerToolsPlugin.helpers;

test("clock bar parts split Total, outline Off-clock, and never invent a missing tail", () => {
  const mixed = {
    value: 90,
    clock: "total",
    clock_breakdown: { worked: { value: 60, display: "1h 00m" }, off_clock: { value: 30, display: "30m" } },
  };
  const split = statsClockBarParts(mixed);
  assert.equal(split.mode, "split");
  assert.equal(split.workedShare, 60 / 90);
  assert.equal(split.offShare, 30 / 90);

  const fullOff = statsClockBarParts({
    value: 30, clock: "total",
    clock_breakdown: { worked: { value: 0, display: "0m" }, off_clock: { value: 30, display: "30m" } },
  });
  assert.equal(fullOff.mode, "outline");

  const fullWorked = statsClockBarParts({
    value: 60, clock: "total",
    clock_breakdown: { worked: { value: 60, display: "1h 00m" }, off_clock: { value: 0, display: "0m" } },
  });
  assert.equal(fullWorked.mode, "solid");

  const missing = statsClockBarParts({ value: 90, clock: "total" });
  assert.equal(missing.mode, "solid");
  assert.equal(missing.offShare, 0);

  const off = statsClockBarParts({ value: 30, clock: "off-clock" });
  assert.equal(off.mode, "outline");

  const worked = statsClockBarParts({ value: 60, clock: "worked" });
  assert.equal(worked.mode, "solid");
});

test("spark bars keep clock detail for mixed, zero, null, and provisional cases", () => {
  const bars = statsSparkBars([
    { value: 90, provisional: false, clock: "total", clock_breakdown: { worked: { value: 60, display: "1h" }, off_clock: { value: 30, display: "30m" } } },
    { value: null, provisional: false, clock: "total" },
    { value: 0, provisional: false, clock: "total", clock_breakdown: { worked: { value: 0, display: "0m" }, off_clock: { value: 0, display: "0m" } } },
    { value: 30, provisional: true, clock: "off-clock" },
  ]);
  assert.equal(bars[0].mode, "split");
  assert.equal(bars[0].height, 1);
  assert.equal(bars[1].empty, true);
  assert.equal(bars[2].zero, true);
  assert.equal(bars[3].provisional, true);
  assert.equal(bars[3].mode, "outline");
  assert.ok(bars[3].height > 0 && bars[3].height < 1);
});

test("tile headlines stay Bob's headline and Off-clock/Total comparisons stay neutral", () => {
  const total = clockFixtureReport("total").metrics[0];
  total.direction = "neutral";
  total.summary.delta = { display: "▲ 6%", words: "10m more than the prior period", sign: 1 };
  const model = statsTileModel(total, clockFixtureReport("total"));
  assert.equal(model.headline, total.summary.headline.display);
  assert.equal(model.clock, "total");
  assert.equal(model.deltaNeutral, true);
  assert.equal(model.delta, "10m more than the prior period");

  const task = statsTileModel({
    id: "done", label: "Done", kind: "task", unit: "count",
    summary: { headline: { display: "3" }, delta: { display: "▲ 1", words: "up 1 vs the prior period", sign: 1 } },
    points: [],
  }, clockFixtureReport("total"));
  assert.equal(task.clock, null);
  assert.equal(task.deltaNeutral, false);
  assert.equal(task.delta, "▲ 1");
});

test("spoken Total points use Bob's displays and grouped buckets keep their span", () => {
  assert.equal(statsChartSpokenDate({ date: "2026-10-29", end: "2026-10-29" }), "Thu 29");
  const metric = {
    id: "worked", kind: "pomodoro", label: "Total",
    parameters: { clock: "total" },
  };
  const point = {
    date: "2026-10-29", end: "2026-10-29", value: 480, display: "8h",
    clock_breakdown: { worked: { value: 390, display: "6h 30m" }, off_clock: { value: 90, display: "1h 30m" } },
  };
  assert.equal(
    statsChartClockSpeech(metric, point, clockFixtureReport("total")).speech,
    "Thu 29 · 8h total · 6h 30m worked · 1h 30m off-clock",
  );
  const grouped = { ...point, date: "2026-10-05", end: "2026-10-10", display: "8h" };
  assert.match(statsChartClockSpeech(metric, grouped, clockFixtureReport("total")).speech, /^10\/05–10\/10 · 8h total/);
  const tooltip = statsChartTooltip(metric, point, clockFixtureReport("total"));
  assert.match(tooltip, /Thu 29 · 8h total · 6h 30m worked · 1h 30m off-clock/);
});

test("empty Off-clock windows are distinct from pre-adoption not_tracked points", () => {
  const empty = clockEmptyOffClockReport();
  assert.equal(statsClockWindowIsEmpty(empty.metrics[0], empty), true);
  assert.equal(statsClockHeaderSuffix(empty, empty.metrics[0]), " · off the clock");
  const gap = clockAdoptionGapReport();
  assert.equal(statsClockWindowIsEmpty(gap.metrics[0], gap), false);
  assert.equal(statsTileModel(gap.metrics[0], gap).quality, "not_tracked");
  const worked = clockFixtureReport("worked");
  assert.equal(statsClockWindowIsEmpty(worked.metrics[0], worked), false);
  assert.equal(statsClockHeaderSuffix(worked, worked.metrics[0]), "");
});

test("value-mark specs draw dashed Off-clock, mixed Total tails, and leave task metrics solid", () => {
  const slot = { x: 10, width: 8, center: 14, slotStart: 8 };
  const domain = [0, 100];
  const margin = { top: 0 };
  const off = statsChartValueMarkSpecs(
    slot,
    { value: 40, display: "40m" },
    { kind: "pomodoro", parameters: { clock: "off-clock" } },
    clockFixtureReport("off-clock"),
    80, domain, margin, 80, "orange",
  );
  assert.equal(off.length, 1);
  assert.match(off[0].attrs.class, /bob-stats-chart-bar-clock-off/);

  const mixed = statsChartValueMarkSpecs(
    slot,
    {
      value: 90,
      clock_breakdown: { worked: { value: 60, display: "1h" }, off_clock: { value: 30, display: "30m" } },
    },
    { kind: "pomodoro", parameters: { clock: "total" } },
    clockFixtureReport("total"),
    80, domain, margin, 80, "orange",
  );
  assert.equal(mixed.length, 2);
  assert.match(mixed[0].attrs.class, /bob-stats-chart-bar-worked/);
  assert.match(mixed[1].attrs.class, /bob-stats-chart-bar-off/);

  const task = statsChartValueMarkSpecs(
    slot,
    { value: 3, display: "3" },
    { kind: "task", id: "done" },
    clockFixtureReport("total"),
    80, domain, margin, 80, "gray",
  );
  assert.equal(task.length, 1);
  assert.doesNotMatch(task[0].attrs.class, /clock-off|bar-off|bar-worked/);

  const count = clockCountTotalReport().metrics[0];
  assert.equal(statsMetricEffectiveClock(count, clockCountTotalReport()), "total");
  const countBars = statsSparkBars(statsTileModel(count, clockCountTotalReport()).spark);
  assert.equal(countBars[0].mode, "split");

  const pinned = clockPinnedOffClockReport().metrics.find((metric) => metric.id === "family_time");
  assert.equal(statsMetricEffectiveClock(pinned, clockPinnedOffClockReport()), "off-clock");
  assert.equal(statsClockComparisonNeutral(pinned, clockPinnedOffClockReport()), true);
});
