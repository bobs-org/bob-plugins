// Internally consistent presentation data shared by the Stats clock tests
// and preview work. Values model three complete days; summary totals exclude
// the provisional third day just like bob stats.
const CLOCKS = ["worked", "off-clock", "total"];

function displayMinutes(value) {
  const minutes = Math.max(0, Math.round(Number(value) || 0));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${String(rest).padStart(2, "0")}m` : `${hours}h 00m`;
}

function clockPair(worked, offClock) {
  return {
    worked: { value: worked, display: displayMinutes(worked) },
    off_clock: { value: offClock, display: displayMinutes(offClock) },
  };
}

const DAYS = [
  { date: "2026-10-09", worked: { WORK: 40, LIFE: 20 }, off_clock: { WORK: 10, LIFE: 20 }, provisional: false },
  { date: "2026-10-10", worked: { WORK: 10, LIFE: 10 }, off_clock: { WORK: 5, LIFE: 5 }, provisional: false },
  { date: "2026-10-11", worked: { WORK: 10, LIFE: 5 }, off_clock: { WORK: 0, LIFE: 0 }, provisional: true },
];

function valueFor(clock, worked, offClock) {
  return clock === "off-clock" ? offClock : clock === "total" ? worked + offClock : worked;
}

function partsFor(day, clock) {
  const parts = {};
  const partsDisplay = {};
  const partsClockBreakdown = {};
  for (const dimension of ["theme", "area", "root_parent", "project"]) {
    const keys = dimension === "theme"
      ? { WORK: "WORK", LIFE: "LIFE" }
      : dimension === "area"
        ? { WORK: "dev.md", LIFE: "life.md" }
        : dimension === "root_parent"
          ? { WORK: "project.md", LIFE: "life.md" }
          : { WORK: "project.md", LIFE: "life_project.md" };
    const values = {};
    const displays = {};
    const splits = {};
    for (const side of ["WORK", "LIFE"]) {
      const key = keys[side];
      const worked = day.worked[side];
      const offClock = day.off_clock[side];
      values[key] = valueFor(clock, worked, offClock);
      displays[key] = displayMinutes(values[key]);
      splits[key] = clockPair(worked, offClock);
    }
    parts[dimension] = values;
    partsDisplay[dimension] = displays;
    partsClockBreakdown[dimension] = splits;
  }
  return {
    parts,
    parts_display: partsDisplay,
    ...(clock === "total" ? { parts_clock_breakdown: partsClockBreakdown } : {}),
  };
}

function pointFor(day, clock) {
  const worked = Object.values(day.worked).reduce((sum, value) => sum + value, 0);
  const offClock = Object.values(day.off_clock).reduce((sum, value) => sum + value, 0);
  const value = valueFor(clock, worked, offClock);
  const includeBreakdown = clock === "total" || (clock === "worked" && offClock > 0);
  return {
    date: day.date,
    end: day.date,
    value,
    display: displayMinutes(value),
    quality: "ok",
    provisional: day.provisional,
    rolling_median: day.provisional ? null : value,
    ...(clock === "total" && offClock > 0 ? { off_clock: offClock } : {}),
    ...(clock === "worked" && offClock > 0 ? { off_clock: offClock } : {}),
    ...(includeBreakdown ? { clock_breakdown: clockPair(worked, offClock) } : {}),
    ...partsFor(day, clock),
  };
}

function summaryParts(clock) {
  const complete = DAYS.filter((day) => !day.provisional);
  const result = {};
  const total = complete.reduce((sum, day) =>
    sum + ["WORK", "LIFE"].reduce((partSum, side) =>
      partSum + valueFor(clock, day.worked[side], day.off_clock[side]), 0), 0);
  for (const dimension of ["theme", "area", "root_parent", "project"]) {
    const keys = dimension === "theme"
      ? { WORK: "WORK", LIFE: "LIFE" }
      : dimension === "area"
        ? { WORK: "dev.md", LIFE: "life.md" }
        : dimension === "root_parent"
          ? { WORK: "project.md", LIFE: "life.md" }
          : { WORK: "project.md", LIFE: "life_project.md" };
    result[dimension] = ["WORK", "LIFE"].map((side) => {
      const worked = complete.reduce((sum, day) => sum + day.worked[side], 0);
      const offClock = complete.reduce((sum, day) => sum + day.off_clock[side], 0);
      const value = valueFor(clock, worked, offClock);
      return {
        key: keys[side],
        value,
        display: displayMinutes(value),
        share: total > 0 ? `${Math.round((value / total) * 100)}%` : "0%",
        label: keys[side].replace(/\.md$/, ""),
        ...(clock === "total" ? { clock_breakdown: clockPair(worked, offClock) } : {}),
      };
    });
  }
  return result;
}

function clockFixtureReport(clock = "worked") {
  const selected = CLOCKS.includes(clock) ? clock : "worked";
  const totals = DAYS.filter((day) => !day.provisional).reduce((sum, day) => {
    sum.worked += Object.values(day.worked).reduce((a, value) => a + value, 0);
    sum.offClock += Object.values(day.off_clock).reduce((a, value) => a + value, 0);
    return sum;
  }, { worked: 0, offClock: 0 });
  const total = valueFor(selected, totals.worked, totals.offClock);
  const optionValues = {
    worked: totals.worked,
    "off-clock": totals.offClock,
    total: totals.worked + totals.offClock,
  };
  const metric = {
    id: "worked",
    label: selected === "worked" ? "Worked" : selected === "off-clock" ? "Off-clock" : "Total",
    kind: "pomodoro",
    unit: "minutes",
    color: "orange",
    definition: "Closed session minutes on the selected clock.",
    source: "daily Pomodoros",
    since: "2026-10-09",
    parameters: { measure: "minutes", clock: selected },
    summary: {
      headline: { value: Math.round(total / 2), display: displayMinutes(Math.round(total / 2)), suffix: "/day", stat: "median" },
      total: { value: total, display: displayMinutes(total) },
      days_with_data: 2,
      ...(selected === "total" ? { total_clock_breakdown: clockPair(totals.worked, totals.offClock) } : {}),
      ...(selected === "worked" && totals.offClock > 0 ? { total_clock_breakdown: clockPair(totals.worked, totals.offClock) } : {}),
    },
    parts_summary: summaryParts(selected),
    points: DAYS.map((day) => pointFor(day, selected)),
    daily_points: DAYS.map((day) => pointFor(day, selected)),
    prior_points: [],
  };
  const options = CLOCKS.map((value) => ({
    value,
    label: value === "worked" ? "Worked" : value === "off-clock" ? "Off-clock" : "Total",
    description: value === "worked"
      ? "Closed Pomodoro minutes on the work clock."
      : value === "off-clock"
        ? "Closed Pomodoro minutes off the clock."
        : "Closed session minutes on both clocks; overlapping sessions count twice.",
    minutes: optionValues[value],
    display: displayMinutes(optionValues[value]),
  }));
  return {
    ok: true,
    schema_version: 1,
    today: "2026-10-11",
    range: { preset: "4w", offset: 0, label: "Oct 9 – Oct 10", includes_today: true },
    clock: {
      value: selected,
      label: options.find((option) => option.value === selected).label,
      since: "2026-10-09",
      options,
    },
    metrics: [
      metric,
      {
        id: "family_time",
        label: "Family time · off-clock",
        kind: "pomodoro",
        unit: "minutes",
        color: "green",
        parameters: { measure: "minutes", clock: "off-clock" },
        summary: { total: { value: totals.offClock, display: displayMinutes(totals.offClock) } },
        points: DAYS.map((day) => pointFor(day, "off-clock")),
      },
      {
        id: "done",
        label: "Done",
        kind: "task",
        unit: "count",
        parameters: { event: "done" },
        summary: { total: { value: 3, display: "3" } },
        points: [],
      },
    ],
  };
}

module.exports = { CLOCKS, clockFixtureReport, displayMinutes };
