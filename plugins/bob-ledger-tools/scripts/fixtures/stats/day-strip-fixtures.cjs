// Presentation-only synthetic reports for the Day strip. These values are
// designed to exercise rendering states and are not observations from a vault.
const DAY = "2026-10-24";
const HUES = ["blue", "orange", "aqua", "yellow", "magenta", "green", "violet", "red"];

function shiftDay(day, amount) {
  const [year, month, date] = day.split("-").map(Number);
  const value = new Date(0);
  value.setHours(12, 0, 0, 0);
  value.setFullYear(year, month - 1, date + amount);
  return [value.getFullYear(), String(value.getMonth() + 1).padStart(2, "0"), String(value.getDate()).padStart(2, "0")].join("-");
}

function dailyPoint(date, value, display, extra = {}) {
  return {
    date,
    end: date,
    value,
    display,
    quality: value === null ? "missing" : "ok",
    reason: value === null ? "No synthetic value for this day." : undefined,
    provisional: false,
    parts: {},
    parts_display: {},
    ...extra,
  };
}

function makeReport(options = {}) {
  const day = options.day || DAY;
  const today = options.today || DAY;
  const count = options.count || 8;
  const group = options.group || "day";
  const dates = Array.from({ length: count }, (_, index) => shiftDay(day, index - count + 1));
  const homes = {};
  const areaNames = options.manyAreas
    ? Array.from({ length: 7 }, (_, index) => `area-${index + 1}.md`)
    : ["gtd.md", "dev.md"];
  areaNames.forEach((key, index) => {
    homes[key] = { label: options.longLabels ? `Long ${["Systems Research", "Personal Development", "Writing and Editing"][index % 3]} Area ${index + 1}` : key.replace(/\.md$/, ""), kind: "area", area: key, path: key, hue: HUES[index % HUES.length] };
  });
  homes["@unlinked"] = { label: "unlinked", kind: "bucket", area: "@unlinked", path: null, hue: null };
  homes["@unfiled"] = { label: "unfiled", kind: "bucket", area: "@unfiled", path: null, hue: null };

  const workedPoints = dates.map((date, index) => {
    const value = date === day ? (options.noPomodoros ? 0 : options.allUnlinked ? 105 : options.manyAreas ? 420 : options.redefinedWorked ? 4 : 185) : 30 + index * 15;
    let parts = {};
    let partsDisplay = {};
    if (options.redefinedWorked) {
      parts = {};
      partsDisplay = {};
    } else if (date === day && options.allUnlinked) {
      parts = { area: { "@unlinked": 105 } };
      partsDisplay = { area: { "@unlinked": "1h 45m" } };
    } else if (date === day && options.manyAreas) {
      const entries = areaNames.map((key, areaIndex) => [key, (areaIndex + 1) * 30]);
      entries.push(["@unlinked", 30]);
      parts = { area: Object.fromEntries(entries) };
      partsDisplay = { area: Object.fromEntries(entries.map(([key, amount]) => [key, `${amount}m`])) };
    } else if (date === day && options.noPomodoros) {
      parts = { area: {} };
      partsDisplay = { area: {} };
    } else if (!(date === day && options.redefinedWorked)) {
      parts = { area: { "gtd.md": Math.round(value * 0.55), "dev.md": value - Math.round(value * 0.55) } };
      partsDisplay = { area: { "gtd.md": `${Math.round(value * 0.55)}m`, "dev.md": `${value - Math.round(value * 0.55)}m` } };
    }
    return dailyPoint(date, value, options.redefinedWorked ? String(value) : value === 0 ? "0m" : `${Math.floor(value / 60)}h ${String(value % 60).padStart(2, "0")}m`, {
      provisional: date === day && options.provisional !== false && day === today,
      parts,
      parts_display: partsDisplay,
    });
  });

  const reviewedPoints = dates.map((date, index) => {
    const target = dailyPoint(date, index + 3, String(index + 3), { provisional: date === day && day === today });
    if (options.notTracked && date === day) {
      Object.assign(target, { value: null, display: "–", quality: "not_tracked", reason: "No review answers have been recorded.", provisional: false });
    }
    if (options.missingWarning && date === day) {
      Object.assign(target, { value: null, display: "–", quality: "missing", reason: "The review journal has a gap for this day.", provisional: false });
    }
    return target;
  });
  const numberPoints = (base) => dates.map((date, index) => dailyPoint(date, base + index, String(base + index), { provisional: date === day && day === today }));
  const closedPoints = dates.map((date, index) => {
    const value = date === day && day === today ? 0 : index % 2 === 0 ? 1 : 0;
    return dailyPoint(date, value, value ? "met" : date === day && day === today ? "not yet" : "missed", {
      provisional: date === day && day === today,
    });
  });
  const definitions = {
    worked: "Minutes in completed Pomodoros attributed to this day's areas.",
    reviewed: "GTD review answers completed on this day.",
    done: "Tasks completed on this day.",
    created: "Tasks created on this day.",
    review_closed: "Whether this day's review checklist was closed.",
  };
  const metric = (id, label, unit, kind, points, extra = {}) => ({
    id,
    label: options.longLabels && id === "review_closed" ? "Review Closeout With A Deliberately Long Display Label" : label,
    unit,
    kind,
    definition: definitions[id],
    source: "synthetic presentation fixture",
    since: options.notTracked && id === "reviewed" ? shiftDay(day, 1) : "2026-10-01",
    summary: { headline: null, total: null, days_with_data: 0 },
    chart: { group, p25: null, p75: null },
    points: group === "week" ? [dailyPoint(dates[0], 1, "week total")] : points,
    ...(group === "week" ? { daily_points: points } : {}),
    ...extra,
  });

  let workedUnit = options.redefinedWorked ? "count" : "minutes";
  if (options.redefinedWorked) {
    workedPoints.forEach((point) => { delete point.parts; delete point.parts_display; });
  }
  const metrics = [
    metric("worked", options.longLabels ? "Time in the systems and projects I touched today" : "Worked", workedUnit, "pomodoro", workedPoints),
    metric("reviewed", "Reviewed", "count", "journal", reviewedPoints),
    metric("done", "Done", "count", "tasks", numberPoints(1)),
    metric("created", "Created", "count", "tasks", numberPoints(4)),
    metric("review_closed", "Review closed", "bool", "checklist", closedPoints),
  ];
  const warnings = options.missingWarning ? [{ code: "journal_gap", date: day, message: "The review journal has a gap for this day." }] : [];
  return {
    ok: true,
    schema_version: 1,
    presentation_fixture: true,
    today,
    range: {
      preset: options.preset || null,
      offset: 0,
      start: dates[0],
      end: dates.at(-1),
      days: dates.length,
      includes_today: true,
      group,
      label: `${dates[0]} – ${dates.at(-1)}`,
    },
    metrics,
    warnings,
    homes,
    sessions: [],
  };
}

function fixture(name, options = {}) {
  const day = options.day || DAY;
  return { name, day, localToday: options.localToday || DAY, fetchedAt: "2026-10-24T14:50:00", report: makeReport({ ...options, day }) };
}

const fixtures = {
  today: fixture("today in progress", { provisional: true }),
  past: fixture("complete past day", { day: "2026-10-21", localToday: DAY, today: DAY, provisional: false }),
  noPomodoros: fixture("no Pomodoros", { noPomodoros: true }),
  allUnlinked: fixture("all time unlinked", { allUnlinked: true }),
  notTracked: fixture("not tracked before since", { notTracked: true }),
  missingWarning: fixture("missing journal warning", { missingWarning: true }),
  manyAreas: fixture("seven areas and +N", { manyAreas: true }),
  redefinedWorked: fixture("redefined worked without area parts", { redefinedWorked: true }),
  longLabels: fixture("long metric and area labels", { longLabels: true }),
  weekGrouped: fixture("week grouped report with daily points", { group: "week" }),
  default4w: fixture("canonical-shaped default 4w", { preset: "4w", count: 28 }),
  explicitDay8: fixture("explicit -g day eight-day report", { count: 8 }),
};

module.exports = { ...fixtures, createReport: makeReport };
