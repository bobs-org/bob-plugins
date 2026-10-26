// Pure model for the daily-note Day strip. Bob owns every displayed
// value; this model only selects the requested day's points and arranges
// their supplied labels, parts, and quality information for the painter.
const DAY_STRIP_METRIC_IDS = ["worked", "reviewed", "done", "created", "review_closed"];
const DAY_STRIP_LABELS = {
  worked: "Worked",
  reviewed: "Reviewed",
  done: "Done",
  created: "Created",
  review_closed: "Review closed",
};
// Transparent-text skeleton placeholders, one per fact, so the skeleton
// keeps the loaded strip's line boxes and wrap points.
const DAY_STRIP_SKELETON_DISPLAYS = {
  worked: "0h 00m",
  reviewed: "00",
  done: "00",
  created: "00",
  review_closed: "not yet",
};
const DAY_STRIP_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY_STRIP_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function dayStripDateParts(day) {
  const match = typeof day === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(day) : null;
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const parsed = new Date(0);
  parsed.setHours(12, 0, 0, 0);
  parsed.setFullYear(year, month - 1, date);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== date) return null;
  return { year, month, date, value: parsed };
}

function dayStripShiftDay(day, amount) {
  const parts = dayStripDateParts(day);
  if (!parts || !Number.isInteger(amount)) return "";
  const shifted = new Date(0);
  shifted.setHours(12, 0, 0, 0);
  shifted.setFullYear(parts.year, parts.month - 1, parts.date + amount);
  return String(shifted.getFullYear()).padStart(4, "0") + "-" +
    String(shifted.getMonth() + 1).padStart(2, "0") + "-" +
    String(shifted.getDate()).padStart(2, "0");
}

function dayStripDateWords(day) {
  const parts = dayStripDateParts(day);
  if (!parts) return null;
  return {
    weekday: DAY_STRIP_WEEKDAYS[parts.value.getDay()],
    weekdayShort: DAY_STRIP_WEEKDAYS[parts.value.getDay()].slice(0, 3),
    month: DAY_STRIP_MONTHS[parts.month - 1],
    monthShort: DAY_STRIP_MONTHS[parts.month - 1].slice(0, 3),
    dayNumber: parts.date,
    year: parts.year,
    full: DAY_STRIP_WEEKDAYS[parts.value.getDay()] + ", " + DAY_STRIP_MONTHS[parts.month - 1] + " " + parts.date,
    short: DAY_STRIP_WEEKDAYS[parts.value.getDay()].slice(0, 3) + " " + DAY_STRIP_MONTHS[parts.month - 1].slice(0, 3) + " " + parts.date,
  };
}

function dayStripAsOf(fetchedAt, show) {
  if (!show || fetchedAt === null || fetchedAt === undefined || fetchedAt === "") return "";
  try {
    const value = fetchedAt instanceof Date ? fetchedAt : new Date(fetchedAt);
    if (!Number.isFinite(value.getTime())) return "";
    return String(value.getHours()).padStart(2, "0") + ":" + String(value.getMinutes()).padStart(2, "0");
  } catch (error) {
    return "";
  }
}

function dayStripWarningsFor(report, day, point) {
  const messages = [];
  const pointWarnings = point && Array.isArray(point.warnings) ? point.warnings : [];
  for (const warning of pointWarnings) {
    if (typeof warning === "string" && warning) messages.push(warning);
    else if (warning && typeof warning.message === "string" && warning.message) messages.push(warning.message);
  }
  if (point && typeof point.warning === "string" && point.warning) messages.push(point.warning);
  const reportWarnings = report && Array.isArray(report.warnings) ? report.warnings : [];
  for (const warning of reportWarnings) {
    if (!warning || typeof warning !== "object") continue;
    const warningDay = warning.day || warning.date;
    const inRange = typeof warning.start === "string" && typeof warning.end === "string" && warning.start <= day && day <= warning.end;
    if (warningDay !== day && !inRange) continue;
    if (typeof warning.message === "string" && warning.message) messages.push(warning.message);
  }
  return Array.from(new Set(messages));
}

function dayStripMetricPoints(metric, report) {
  try {
    return statsChartDailyPoints(metric, report);
  } catch (error) {
    const safe = metric && typeof metric === "object" ? metric : {};
    return Array.isArray(safe.points) ? safe.points : [];
  }
}

// Choose the Day strip boolean mark from bob's point, never from the
// English display word. Mirrors `bool_mark` in bob-cli stats render:
// provisional zero is "not yet", then missing/not_tracked/non-finite
// have no mark, then value > 0 is met and every other finite value is
// missed.
function dayStripMarkState(unit, point) {
  if (unit !== "bool") return null;
  if (!point || typeof point !== "object") return null;
  if (point.provisional === true && point.value === 0) return "pending";
  const quality = typeof point.quality === "string" ? point.quality : "missing";
  if (quality === "missing" || quality === "not_tracked") return null;
  if (typeof point.value !== "number" || !Number.isFinite(point.value)) return null;
  return point.value > 0 ? "met" : "missed";
}

function dayStripBuildFact(metric, report, day, dateWords) {
  const points = dayStripMetricPoints(metric, report);
  const point = points.find((candidate) => candidate && candidate.date === day) || null;
  const unit = metric && typeof metric.unit === "string" ? metric.unit : "";
  const quality = point && typeof point.quality === "string" ? point.quality : "missing";
  const warnings = dayStripWarningsFor(report, day, point);
  const warning = warnings.length
    ? warnings.join("\n")
    : quality === "missing"
      ? (point && typeof point.reason === "string" && point.reason) || "No value was reported for this day."
      : quality === "warning"
        ? (point && typeof point.reason === "string" && point.reason) || "The report warned about this day."
        : "";
  const display = point && typeof point.display === "string" ? point.display : "–";
  const label = metric && typeof metric.label === "string" && metric.label ? metric.label : DAY_STRIP_LABELS[metric && metric.id] || String(metric && metric.id || "Metric");
  const metricId = String(metric && metric.id || "");
  const mark = dayStripMarkState(unit, point);
  const soFar = point && point.provisional && mark !== "pending" ? " so far" : "";
  const tooltip = [
    metric && typeof metric.definition === "string" ? metric.definition : "",
    dateWords.short + ": " + display + soFar,
    quality === "not_tracked" && metric && metric.since ? "Tracking since " + metric.since : "",
    point && typeof point.reason === "string" && point.reason ? point.reason : "",
    ...warnings,
  ].filter(Boolean).join("\n");
  return {
    id: metricId,
    label,
    display,
    quality,
    reason: point && typeof point.reason === "string" ? point.reason : "",
    since: metric && typeof metric.since === "string" ? metric.since : "",
    warning,
    definition: metric && typeof metric.definition === "string" ? metric.definition : "",
    tooltip,
    unit,
    mark,
    value: point && typeof point.value === "number" ? point.value : null,
    provisional: Boolean(point && point.provisional === true),
  };
}

// Strip-specific legend labels. Bob owns every label; the plugin only
// chooses among them. Never touches statsPanelHomeLabel, which the Stats
// dash shares.
function dayStripLegendLabel(report, dimension, row) {
  try {
    const catalog = typeof statsPanelHomeCatalog === "function" ? statsPanelHomeCatalog(report) : {};
    const entry = catalog && row && typeof catalog[row.key] === "object" ? catalog[row.key] : {};
    const short = entry && typeof entry.short_label === "string" ? entry.short_label : "";
    if (short) return short;
    if (dimension === "root_parent" && entry && typeof entry.label === "string" && entry.label) {
      return entry.label;
    }
  } catch (error) {
    // Fall through to the row label.
  }
  return row && typeof row.label === "string" && row.label ? row.label : (row ? row.key : "");
}

function dayStripMix(report, worked, day) {
  const emptyMix = (extra) => ({
    segments: [],
    legend: [],
    overflow: [],
    overflowDefault: { count: 0, title: "" },
    empty: false,
    omitted: true,
    dimension: null,
    title: "",
    ...(extra || {}),
  });
  const omitted = !worked || worked.unit !== "minutes";
  if (omitted) return emptyMix();
  const points = dayStripMetricPoints(worked, report);
  const hasParts = (dimension) => points.some((point) =>
    point && point.parts && point.parts[dimension] &&
    typeof point.parts[dimension] === "object" &&
    Object.keys(point.parts[dimension]).length > 0);
  const hasRootParts = hasParts("root_parent");
  const hasAreaParts = hasParts("area");
  if (!hasRootParts && !hasAreaParts) return emptyMix();
  // Prefer the root_parent dimension; an older bob without it falls
  // back to area and the copy says so honestly.
  const dimension = hasRootParts ? "root_parent" : "area";
  const point = points.find((candidate) => candidate && candidate.date === day) || null;
  const raw = point && point.parts && point.parts[dimension] && typeof point.parts[dimension] === "object" ? point.parts[dimension] : null;
  if (!raw) {
    return emptyMix({
      empty: Boolean(point && point.value === 0 && point.quality === "ok"),
      omitted: false,
      dimension,
      title: dimension === "root_parent" ? "Time by root parent" : "Time by area",
      point,
    });
  }
  const rows = statsPanelHomeRows(worked, report, dimension, point);
  const ordered = statsPanelHomeAreaRows(rows, report);
  const hueMap = statsPanelDistinctHues(ordered, report);
  const displays = point && point.parts_display && point.parts_display[dimension] && typeof point.parts_display[dimension] === "object"
    ? point.parts_display[dimension]
    : {};
  const segments = ordered.map((row) => ({
    key: row.key,
    label: row.label,
    value: row.value,
    display: typeof displays[row.key] === "string" ? displays[row.key] : row.display,
    hue: hueMap.get(row.key) || "gray",
    bucket: row.key.startsWith("@"),
  }));
  // Rank 1 = most minutes; tie-break by label, as before.
  const byValue = segments.slice().sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  const rankOf = new Map(byValue.map((segment, index) => [segment.key, index + 1]));
  // Legend names every segment in bar order; the fitter decides how many fit.
  const initialLabels = new Map(
    segments.map((segment) => {
      const row = ordered.find((candidate) => candidate.key === segment.key) || segment;
      return [segment.key, dayStripLegendLabel(report, dimension, row)];
    }),
  );
  const labelCounts = new Map();
  for (const label of initialLabels.values()) {
    const folded = String(label).toLowerCase();
    labelCounts.set(folded, (labelCounts.get(folded) || 0) + 1);
  }
  const legend = segments.map((segment) => {
    const initial = initialLabels.get(segment.key) || segment.label;
    const folded = String(initial).toLowerCase();
    const collided = (labelCounts.get(folded) || 0) > 1;
    return {
      key: segment.key,
      label: segment.label,
      legendLabel: collided ? segment.label : initial,
      display: segment.display,
      value: segment.value,
      hue: segment.hue,
      bucket: segment.bucket,
      rank: rankOf.get(segment.key) || 0,
    };
  });
  const overflowList = segments.filter((segment) => (rankOf.get(segment.key) || 0) > 3);
  const overflowTitle = (list) => list.map((segment) => segment.label + " " + segment.display).join("\n");
  const sentence = dimension === "root_parent" ? "Time by root parent" : "Time by area";
  return {
    segments,
    legend,
    overflow: overflowList,
    overflowDefault: { count: Math.max(0, segments.length - 3), title: overflowTitle(overflowList) },
    empty: Boolean(point && point.value === 0 && point.quality === "ok"),
    omitted: false,
    dimension,
    title: [sentence, ...segments.map((segment) => segment.label + " " + segment.display)].join("\n"),
    point,
  };
}

function dayStripErrorInfo(error) {
  if (!error || typeof error !== "object") return null;
  if (typeof error.title === "string") {
    return { code: error.code || "failed", title: error.title, hint: typeof error.hint === "string" ? error.hint : "" };
  }
  try {
    const model = statsErrorModel(error);
    return { code: model.code, title: model.title, hint: model.hint };
  } catch (caught) {
    return { code: typeof error.code === "string" ? error.code : "failed", title: typeof error.message === "string" ? error.message : "bob stats failed", hint: "" };
  }
}

// The meta line next to the mix: today reads `so far · HH:MM`, a stale
// today appends `refresh failed`, a stale past day reads `refresh failed`,
// and every other day reads nothing. Never throws.
function dayStripMetaText({ day, localToday, asOf, stale }) {
  try {
    if (day !== localToday) return stale === true ? "refresh failed" : "";
    if (!asOf) return stale === true ? "refresh failed" : "";
    return stale === true ? "so far · " + asOf + " · refresh failed" : "so far · " + asOf;
  } catch (error) {
    return "";
  }
}

function dayStripOmittedLane(dimension) {
  return {
    segments: [],
    legend: [],
    overflow: [],
    overflowDefault: { count: 0, title: "" },
    empty: false,
    omitted: true,
    dimension: dimension || null,
    title: "",
  };
}

function dayStripAriaLabel(day, dateWords, provisional, facts, mix, themes) {
  const values = facts.map((fact) => fact.label + " " + fact.display).join(", ");
  let label = "Day stats for " + dateWords.full + (provisional ? ", so far" : "") + (values ? ": " + values + "." : ".");
  if (mix && !mix.omitted && mix.segments.length) {
    const sentence = mix.dimension === "area" ? "Time by area" : "Time by root parent";
    label += " " + sentence + ": " + mix.segments.map((segment) => segment.label + " " + segment.display).join(", ") + ".";
  } else if (mix && mix.empty) {
    label += " No Pomodoros.";
  }
  if (themes && !themes.omitted && themes.segments.length) {
    label += " Time by theme: " + themes.segments.map((segment) => segment.label + " " + segment.display).join(", ") + ".";
  }
  return label;
}

function dayStripModel(report, day, context) {
  try {
    const safeContext = context && typeof context === "object" ? context : {};
    const safeReport = report && typeof report === "object" ? report : null;
    const dateWords = dayStripDateWords(day);
    if (!dateWords) {
      return { state: "hidden", day: typeof day === "string" ? day : "", dateWords: null, provisional: false, asOf: "", metaText: "", facts: [], mix: dayStripOmittedLane(null), themes: dayStripOmittedLane("theme"), ariaLabel: "", stale: false, error: null };
    }
    const localToday = typeof safeContext.localToday === "string" ? safeContext.localToday : "";
    if (dayStripDateParts(localToday) && day > localToday) {
      return { state: "future", day, dateWords, provisional: false, asOf: "", metaText: "", facts: [], mix: dayStripOmittedLane(null), themes: dayStripOmittedLane("theme"), ariaLabel: "", stale: false, error: null };
    }
    const error = dayStripErrorInfo(safeContext.error);
    if (!safeReport) {
      if (error) {
        return { state: "unavailable", day, dateWords, provisional: false, asOf: "", metaText: "", facts: [], mix: dayStripOmittedLane(null), themes: dayStripOmittedLane("theme"), ariaLabel: "Day stats unavailable — " + error.title + ".", stale: false, error };
      }
      const facts = DAY_STRIP_METRIC_IDS.map((id) => ({
        id,
        label: DAY_STRIP_LABELS[id],
        display: DAY_STRIP_SKELETON_DISPLAYS[id] || "00",
        quality: "skeleton",
        reason: "",
        since: "",
        warning: "",
        definition: "",
        tooltip: "",
        unit: id === "review_closed" ? "bool" : "",
        mark: null,
        value: null,
        provisional: false,
      }));
      const mix = { segments: [], legend: [], overflow: [], overflowDefault: { count: 0, title: "" }, empty: false, omitted: false, skeleton: true, dimension: "root_parent", title: "Time by root parent" };
      const themes = { segments: [], legend: [], overflow: [], overflowDefault: { count: 0, title: "" }, empty: false, omitted: false, skeleton: true, dimension: "theme", title: "Time by theme" };
      return { state: "skeleton", day, dateWords, provisional: false, asOf: "", metaText: "so far · 00:00", facts, mix, themes, ariaLabel: "Day stats for " + dateWords.full + ". Loading.", stale: false, error: null };
    }

    // A default report from before midnight must never be used to show a
    // provisional point for the new local day (or a day it does not cover).
    if (safeReport.today && localToday && safeReport.today < localToday && day >= safeReport.today) {
      return dayStripModel(null, day, { ...safeContext, error: null });
    }

    const metrics = Array.isArray(safeReport.metrics) ? safeReport.metrics : [];
    const facts = DAY_STRIP_METRIC_IDS.map((id) => metrics.find((metric) => metric && metric.id === id)).filter(Boolean)
      .map((metric) => dayStripBuildFact(metric, safeReport, day, dateWords));
    const worked = metrics.find((metric) => metric && metric.id === "worked") || null;
    const mix = dayStripMix(safeReport, worked, day);
    const themes = typeof dayStripThemeMix === "function"
      ? dayStripThemeMix(safeReport, worked, day, safeContext)
      : dayStripOmittedLane("theme");
    const provisional = facts.some((fact) => fact.provisional);
    const asOf = day === localToday ? dayStripAsOf(safeContext.fetchedAt, true) : "";
    const stale = safeContext.stale === true;
    const ariaLabel = dayStripAriaLabel(day, dateWords, provisional, facts, mix, themes);
    const metaText = dayStripMetaText({ day, localToday, asOf, stale });
    const staleTitle = stale
      ? ((error && error.title) || (typeof safeContext.error === "string" ? safeContext.error : "Refresh failed")) +
        " · showing the " + (asOf || "cached") + " report"
      : "";
    return {
      state: "ready",
      day,
      dateWords,
      provisional,
      asOf,
      metaText,
      facts,
      mix,
      themes,
      ariaLabel,
      stale,
      staleTitle,
      error,
    };
  } catch (error) {
    const safeDay = typeof day === "string" ? day : "";
    const dateWords = dayStripDateWords(safeDay);
    return {
      state: "unavailable",
      day: safeDay,
      dateWords,
      provisional: false,
      asOf: "",
      metaText: "",
      facts: [],
      mix: dayStripOmittedLane(null),
      themes: dayStripOmittedLane("theme"),
      ariaLabel: "Day stats unavailable — bob stats failed.",
      stale: false,
      error: { code: "model-error", title: "bob stats failed", hint: "" },
    };
  }
}
