// Pure model for the daily-note Stats receipt. Bob owns every displayed
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

function dayStripMarks(metric, report, day, bool) {
  const points = dayStripMetricPoints(metric, report);
  const dates = Array.from({ length: 8 }, (_, index) => dayStripShiftDay(day, index - 7));
  const byDate = new Map(points.filter((point) => point && typeof point.date === "string").map((point) => [point.date, point]));
  const source = dates.map((date) => {
    const point = byDate.get(date);
    return point && typeof point.value === "number"
      ? { value: point.value, provisional: point.provisional === true && date === day }
      : { value: null, provisional: false };
  });
  const bars = statsSparkBars(source);
  return dates.map((date, index) => {
    const point = byDate.get(date) || null;
    const value = point && typeof point.value === "number" ? point.value : null;
    return {
      date,
      height: bars[index] ? bars[index].height : 0,
      empty: !point || value === null,
      zero: Boolean(point && value === 0),
      provisional: Boolean(point && point.provisional === true && date === day),
      isDay: date === day,
      met: bool ? (value === null ? null : value > 0) : null,
      display: point && typeof point.display === "string" ? point.display : "–",
      title: dayStripDateWords(date)
        ? dayStripDateWords(date).short + ": " + (point && typeof point.display === "string" ? point.display : "–")
        : date,
    };
  });
}

function dayStripBuildTile(metric, report, day, dateWords) {
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
    kind: unit === "bool" ? "dots" : "bars",
    unit,
    value: point && typeof point.value === "number" ? point.value : null,
    provisional: Boolean(point && point.provisional === true),
    point,
    marks: dayStripMarks(metric, report, day, unit === "bool"),
  };
}

function dayStripMix(report, worked, day) {
  const omitted = !worked || worked.unit !== "minutes";
  if (omitted) return { segments: [], legend: [], overflow: [], empty: false, omitted: true };
  const points = dayStripMetricPoints(worked, report);
  const hasAreaParts = points.some((point) => point && point.parts && point.parts.area && typeof point.parts.area === "object" && Object.keys(point.parts.area).length > 0);
  if (!hasAreaParts) return { segments: [], legend: [], overflow: [], empty: false, omitted: true };
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
    overflowTitle: overflow.map((segment) => segment.label + " " + segment.display).join("\n"),
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

function dayStripCollapsedText(tiles) {
  return tiles.map((tile) => ({
    id: tile.id,
    label: tile.label,
    display: tile.display,
    kind: tile.unit === "bool" ? "bool" : "value",
  }));
}

function dayStripAriaLabel(day, dateWords, provisional, tiles, mix) {
  const values = tiles.map((tile) => tile.label + " " + tile.display).join(", ");
  let label = "Day stats for " + dateWords.full + (provisional ? ", so far" : "") + (values ? ": " + values : ".");
  if (mix && !mix.omitted && mix.segments.length) {
    label += ". Time by area: " + mix.segments.map((segment) => segment.label + " " + segment.display).join(", ") + ".";
  } else if (mix && mix.empty) {
    label += ". No Pomodoros.";
  }
  return label;
}

function dayStripModel(report, day, context) {
  try {
    const safeContext = context && typeof context === "object" ? context : {};
    const safeReport = report && typeof report === "object" ? report : null;
    const dateWords = dayStripDateWords(day);
    if (!dateWords) {
      return { state: "hidden", day: typeof day === "string" ? day : "", dateWords: null, provisional: false, asOf: "", tiles: [], mix: { segments: [], legend: [], overflow: [], empty: false, omitted: true }, collapsedText: [], ariaLabel: "", stale: false, error: null, collapsed: false };
    }
    const localToday = typeof safeContext.localToday === "string" ? safeContext.localToday : "";
    if (dayStripDateParts(localToday) && day > localToday) {
      return { state: "future", day, dateWords, provisional: false, asOf: "", tiles: [], mix: { segments: [], legend: [], overflow: [], empty: false, omitted: true }, collapsedText: [], ariaLabel: "", stale: false, error: null, collapsed: false };
    }
    const error = dayStripErrorInfo(safeContext.error);
    if (!safeReport) {
      if (error) {
        return { state: "unavailable", day, dateWords, provisional: false, asOf: "", tiles: [], mix: { segments: [], legend: [], overflow: [], empty: false, omitted: true }, collapsedText: [], ariaLabel: "Day stats unavailable — " + error.title + ".", stale: false, error, collapsed: false };
      }
      const tiles = DAY_STRIP_METRIC_IDS.map((id) => ({
        id,
        label: DAY_STRIP_LABELS[id],
        display: "",
        quality: "skeleton",
        reason: "",
        since: "",
        warning: "",
        definition: "",
        tooltip: "",
        kind: id === "review_closed" ? "dots" : "bars",
        unit: id === "review_closed" ? "bool" : "",
        value: null,
        provisional: false,
        point: null,
        marks: Array.from({ length: 8 }, (_, index) => ({ date: dayStripShiftDay(day, index - 7), height: 0, empty: true, zero: false, provisional: false, isDay: index === 7, met: null, display: "–", title: "" })),
      }));
      const mix = { segments: [], legend: [], overflow: [], empty: false, omitted: false, skeleton: true };
      return { state: "skeleton", day, dateWords, provisional: false, asOf: "", tiles, mix, collapsedText: dayStripCollapsedText(tiles), ariaLabel: "Day stats for " + dateWords.full + ". Loading.", stale: false, error: null, collapsed: safeContext.collapsed === true };
    }

    // A default report from before midnight must never be used to show a
    // provisional point for the new local day (or a day it does not cover).
    if (safeReport.today && localToday && safeReport.today < localToday && day >= safeReport.today) {
      return dayStripModel(null, day, { ...safeContext, error: null });
    }

    const metrics = Array.isArray(safeReport.metrics) ? safeReport.metrics : [];
    const tiles = DAY_STRIP_METRIC_IDS.map((id) => metrics.find((metric) => metric && metric.id === id)).filter(Boolean)
      .map((metric) => dayStripBuildTile(metric, safeReport, day, dateWords));
    const worked = metrics.find((metric) => metric && metric.id === "worked") || null;
    const mix = dayStripMix(safeReport, worked, day);
    const provisional = tiles.some((tile) => tile.provisional);
    const asOf = day === localToday ? dayStripAsOf(safeContext.fetchedAt, true) : "";
    const stale = safeContext.stale === true;
    const ariaLabel = dayStripAriaLabel(day, dateWords, provisional, tiles, mix);
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
      tiles,
      mix,
      collapsedText: dayStripCollapsedText(tiles),
      ariaLabel,
      stale,
      staleTitle,
      error,
      collapsed: safeContext.collapsed === true,
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
      tiles: [],
      mix: { segments: [], legend: [], overflow: [], empty: false, omitted: true },
      collapsedText: [],
      ariaLabel: "Day stats unavailable — bob stats failed.",
      stale: false,
      error: { code: "model-error", title: "bob stats failed", hint: "" },
      collapsed: false,
    };
  }
}
