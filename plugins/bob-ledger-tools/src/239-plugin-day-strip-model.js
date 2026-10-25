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
  const tooltip = [
    metric && typeof metric.definition === "string" ? metric.definition : "",
    dateWords.short + ": " + display + (point && point.provisional ? " so far" : ""),
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
    value: point && typeof point.value === "number" ? point.value : null,
    provisional: Boolean(point && point.provisional === true),
  };
}

function dayStripMix(report, worked, day) {
  const omitted = !worked || worked.unit !== "minutes";
  if (omitted) return { segments: [], legend: [], overflow: [], empty: false, omitted: true, title: "" };
  const points = dayStripMetricPoints(worked, report);
  const hasAreaParts = points.some((point) => point && point.parts && point.parts.area && typeof point.parts.area === "object" && Object.keys(point.parts.area).length > 0);
  if (!hasAreaParts) return { segments: [], legend: [], overflow: [], empty: false, omitted: true, title: "" };
  const point = points.find((candidate) => candidate && candidate.date === day) || null;
  const rawAreas = point && point.parts && point.parts.area && typeof point.parts.area === "object" ? point.parts.area : null;
  const rows = rawAreas ? statsPanelHomeRows(worked, report, "area", point) : [];
  const ordered = statsPanelHomeAreaRows(rows, report);
  const displays = point && point.parts_display && point.parts_display.area && typeof point.parts_display.area === "object"
    ? point.parts_display.area
    : {};
  const segments = ordered.map((row) => ({
    key: row.key,
    label: row.label,
    value: row.value,
    display: typeof displays[row.key] === "string" ? displays[row.key] : row.display,
    hue: statsPanelHomeHue(report, row.key),
    bucket: row.key.startsWith("@"),
  }));
  const top = segments.slice().sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)).slice(0, 3);
  const selected = new Set(top.map((segment) => segment.key));
  const legend = segments.filter((segment) => selected.has(segment.key));
  const overflow = segments.filter((segment) => !selected.has(segment.key));
  return {
    segments,
    legend,
    overflow,
    empty: Boolean(point && point.value === 0 && point.quality === "ok"),
    omitted: false,
    title: ["Time by area", ...segments.map((segment) => segment.label + " " + segment.display)].join("\n"),
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

function dayStripAriaLabel(day, dateWords, provisional, facts, mix) {
  const values = facts.map((fact) => fact.label + " " + fact.display).join(", ");
  let label = "Day stats for " + dateWords.full + (provisional ? ", so far" : "") + (values ? ": " + values + "." : ".");
  if (mix && !mix.omitted && mix.segments.length) {
    label += " Time by area: " + mix.segments.map((segment) => segment.label + " " + segment.display).join(", ") + ".";
  } else if (mix && mix.empty) {
    label += " No Pomodoros.";
  }
  return label;
}

function dayStripModel(report, day, context) {
  try {
    const safeContext = context && typeof context === "object" ? context : {};
    const safeReport = report && typeof report === "object" ? report : null;
    const dateWords = dayStripDateWords(day);
    if (!dateWords) {
      return { state: "hidden", day: typeof day === "string" ? day : "", dateWords: null, provisional: false, asOf: "", metaText: "", facts: [], mix: { segments: [], legend: [], overflow: [], empty: false, omitted: true, title: "" }, ariaLabel: "", stale: false, error: null };
    }
    const localToday = typeof safeContext.localToday === "string" ? safeContext.localToday : "";
    if (dayStripDateParts(localToday) && day > localToday) {
      return { state: "future", day, dateWords, provisional: false, asOf: "", metaText: "", facts: [], mix: { segments: [], legend: [], overflow: [], empty: false, omitted: true, title: "" }, ariaLabel: "", stale: false, error: null };
    }
    const error = dayStripErrorInfo(safeContext.error);
    if (!safeReport) {
      if (error) {
        return { state: "unavailable", day, dateWords, provisional: false, asOf: "", metaText: "", facts: [], mix: { segments: [], legend: [], overflow: [], empty: false, omitted: true, title: "" }, ariaLabel: "Day stats unavailable — " + error.title + ".", stale: false, error };
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
        value: null,
        provisional: false,
      }));
      const mix = { segments: [], legend: [], overflow: [], empty: false, omitted: false, skeleton: true, title: "" };
      return { state: "skeleton", day, dateWords, provisional: false, asOf: "", metaText: "so far · 00:00", facts, mix, ariaLabel: "Day stats for " + dateWords.full + ". Loading.", stale: false, error: null };
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
    const provisional = facts.some((fact) => fact.provisional);
    const asOf = day === localToday ? dayStripAsOf(safeContext.fetchedAt, true) : "";
    const stale = safeContext.stale === true;
    const ariaLabel = dayStripAriaLabel(day, dateWords, provisional, facts, mix);
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
      mix: { segments: [], legend: [], overflow: [], empty: false, omitted: true, title: "" },
      ariaLabel: "Day stats unavailable — bob stats failed.",
      stale: false,
      error: { code: "model-error", title: "bob stats failed", hint: "" },
    };
  }
}
