// Pure context-panel models for the Stats metric families.
// The focus chart owns the selected metric; these helpers shape the
// per-family context underneath it (theme breakdowns, task flow,
// review counterweights, checklist calendars, and chore grids).
const STATS_PANEL_KEEP_REFERENCE = 9000;
const STATS_PANEL_CHECKLIST_STATES = ["met", "missed", "not_due", "missing", "not_tracked"];
const STATS_PANEL_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const STATS_PANEL_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Dispatch on metric.kind, with the built-in `net` id as the explicit
// formula exception. Every other field/formula metric has only the
// focus chart and table, so this returns null for those.
function statsPanelFamily(metric) {
  const safe = metric && typeof metric === "object" ? metric : {};
  if (safe.id === "net") {
    return "flow";
  }
  const kind = typeof safe.kind === "string" ? safe.kind : "";
  if (kind === "pomodoro") {
    return "pomodoro";
  }
  if (kind === "tasks") {
    return "tasks";
  }
  if (kind === "journal") {
    return safe.id === "keep_rate" ? "keep" : "answers";
  }
  if (kind === "checklist") {
    return "checklist";
  }
  return null;
}

function statsPanelMetricById(report, id) {
  const metrics = report && Array.isArray(report.metrics) ? report.metrics : [];
  return metrics.find((metric) => metric && metric.id === id) || null;
}

function statsPanelGroup(report, metric) {
  const safe = metric && typeof metric === "object" ? metric : {};
  return (safe.chart && safe.chart.group) || (report && report.range && report.range.group) || "day";
}

function statsPanelSummaryEntry(entry) {
  const safe = entry && typeof entry === "object" ? entry : {};
  if (typeof safe.key !== "string" || !safe.key) {
    return null;
  }
  return {
    key: safe.key,
    value: statsFinite(safe.value) ? safe.value : null,
    display: typeof safe.display === "string" && safe.display ? safe.display : "–",
    share: typeof safe.share === "string" ? safe.share : "",
  };
}

// Ranked theme rows for pomodoro metrics plus the supplied period total.
// Rust already keeps top-five-plus-other; this preserves that order for
// ties and sorts strictly by value otherwise.
function statsPanelThemeRows(metric, point) {
  const safe = metric && typeof metric === "object" ? metric : {};
  const summary = safe.parts_summary && typeof safe.parts_summary === "object" ? safe.parts_summary : {};
  const raw = point && point.parts && point.parts.theme && typeof point.parts.theme === "object" && !Array.isArray(point.parts.theme)
    ? Object.entries(point.parts.theme).map(([key, value]) => ({
      key,
      value,
      display: point.parts_display && point.parts_display.theme && point.parts_display.theme[key],
      share: "",
    }))
    : Array.isArray(summary.theme) ? summary.theme : [];
  const rows = raw.map(statsPanelSummaryEntry).filter(Boolean);
  rows.sort((a, b) => (b.value === null ? -1 : a.value === null ? 1 : 0) || ((b.value || 0) - (a.value || 0)));
  const total = point && typeof point.display === "string" && point.display
    ? point.display
    : safe.summary && typeof safe.summary === "object" && safe.summary.total && typeof safe.summary.total.display === "string"
      ? safe.summary.total.display
      : "";
  return {
    total,
    rows,
  };
}

const STATS_PANEL_HOME_HUES = ["blue", "orange", "aqua", "yellow", "magenta", "green", "violet", "red"];

function statsPanelHomeCatalog(report) {
  return report && report.homes && typeof report.homes === "object" ? report.homes : {};
}

function statsPanelHasHomes(metric) {
  const summary = metric && metric.parts_summary && typeof metric.parts_summary === "object"
    ? metric.parts_summary
    : {};
  return Array.isArray(summary.area) || Array.isArray(summary.project);
}

function statsPanelHomeLabel(report, dimension, key, part) {
  const catalog = statsPanelHomeCatalog(report);
  const entry = catalog[key] && typeof catalog[key] === "object" ? catalog[key] : {};
  if (dimension === "project" && entry.kind === "area" && typeof entry.project_label === "string") {
    return entry.project_label;
  }
  if (typeof entry.label === "string" && entry.label) {
    return entry.label;
  }
  if (part && typeof part.label === "string" && part.label) {
    return part.label;
  }
  return key;
}

function statsPanelHomeHue(report, key, bucketGray = true) {
  if (bucketGray && typeof key === "string" && (key === "@unlinked" || key === "@unfiled")) {
    return "gray";
  }
  if (bucketGray && typeof key === "string" && key.startsWith("@") && !key.startsWith("@review:")) {
    return "gray";
  }
  const catalog = statsPanelHomeCatalog(report);
  const entry = catalog[key];
  if (typeof key === "string" && key.startsWith("@review:")) {
    if (entry && STATS_PANEL_HOME_HUES.includes(entry.hue)) {
      return entry.hue;
    }
    const area = entry && typeof entry.area === "string" ? catalog[entry.area] : null;
    if (area && STATS_PANEL_HOME_HUES.includes(area.hue)) {
      return area.hue;
    }
  }
  return entry && STATS_PANEL_HOME_HUES.includes(entry.hue) ? entry.hue : "gray";
}

function statsPanelFormatMinutes(value) {
  if (!statsFinite(value)) return "–";
  const minutes = Math.max(0, Math.round(value));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours && remainder) return hours + "h " + remainder + "m";
  if (hours) return hours + "h";
  return minutes + "m";
}

function statsPanelHomeRows(metric, report, dimension, point) {
  const safe = metric && typeof metric === "object" ? metric : {};
  const summary = safe.parts_summary && typeof safe.parts_summary === "object" ? safe.parts_summary : {};
  const raw = point && point.parts && point.parts[dimension] && typeof point.parts[dimension] === "object"
    ? Object.entries(point.parts[dimension]).map(([key, value]) => ({
      key,
      value,
      display: point.parts_display && point.parts_display[dimension] && point.parts_display[dimension][key],
      apportioned: point.apportioned && point.apportioned[dimension] && point.apportioned[dimension][key],
      label: null,
    }))
    : Array.isArray(summary[dimension]) ? summary[dimension] : [];
  const rows = raw.map((part) => {
    if (!part || typeof part.key !== "string" || !part.key || !statsFinite(part.value)) return null;
    const value = part.value;
    const apportioned = statsFinite(part.apportioned) ? Math.max(0, Math.min(value, part.apportioned)) : 0;
    return {
      key: part.key,
      value,
      display: typeof part.display === "string" && part.display
        ? part.display
        : safe.unit === "minutes" ? statsPanelFormatMinutes(value) : String(value),
      share: typeof part.share === "string" ? part.share : "",
      apportioned,
      apportionedDisplay: typeof part.apportioned_display === "string" && part.apportioned_display
        ? part.apportioned_display
        : apportioned ? statsPanelFormatMinutes(apportioned) : "",
      label: statsPanelHomeLabel(report, dimension, part.key, part),
      hue: statsPanelHomeHue(report, part.key),
      kind: (statsPanelHomeCatalog(report)[part.key] || {}).kind || "bucket",
      area: (statsPanelHomeCatalog(report)[part.key] || {}).area || part.key,
      path: (statsPanelHomeCatalog(report)[part.key] || {}).path || null,
    };
  }).filter(Boolean);
  rows.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  return rows;
}

function statsPanelHomeAreaRows(rows, report) {
  const values = Array.isArray(rows) ? rows.slice() : [];
  const slot = (key) => {
    const index = STATS_PANEL_HOME_HUES.indexOf(statsPanelHomeHue(report, key, false));
    return index < 0 ? STATS_PANEL_HOME_HUES.length : index;
  };
  return values.sort((a, b) => {
    const aBucket = a.key.startsWith("@");
    const bBucket = b.key.startsWith("@");
    if (aBucket !== bBucket) return aBucket ? 1 : -1;
    if (aBucket) return a.label.localeCompare(b.label);
    const aSlot = slot(a.key);
    const bSlot = slot(b.key);
    return aSlot - bSlot || a.label.localeCompare(b.label);
  });
}

function statsPanelSelectedHomePoint(metric, report, state) {
  const safe = state && typeof state === "object" ? state : {};
  const points = Array.isArray(metric && metric.points) ? metric.points : [];
  if (safe.pinnedBucket && typeof safe.pinnedBucket.start === "string") {
    const selected = points.find((point) => point && point.date === safe.pinnedBucket.start &&
      (point.end || point.date) === (safe.pinnedBucket.end || safe.pinnedBucket.start));
    if (selected) return selected;
  }
  if (typeof safe.pinnedDay === "string") {
    const daily = statsChartDailyPoints(metric, report);
    return daily.find((point) => point && point.date === safe.pinnedDay) || null;
  }
  return null;
}

function statsPanelHomeSpan(point, report) {
  if (!point) return report && report.range && report.range.label || "Selected range";
  const start = typeof point.date === "string" ? point.date : "";
  const end = typeof point.end === "string" ? point.end : start;
  return start && end && start !== end ? start + "–" + end : start || "Selected range";
}

function statsPanelHomeSessions(report, dimension, key, point) {
  const sessions = report && Array.isArray(report.sessions) ? report.sessions : [];
  const start = point && typeof point.date === "string" ? point.date : "";
  const end = point && typeof point.end === "string" ? point.end : start;
  return sessions.filter((session) => {
    if (!session || typeof session !== "object") return false;
    if (start && (session.date < start || session.date > end)) return false;
    const parts = session.homes && Array.isArray(session.homes.parts) ? session.homes.parts : [];
    return parts.some((part) => dimension === "area"
      ? part && (part.area === key || (part.kind === "area" && part.key === key))
      : part && part.key === key);
  }).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) ||
    String(a.path || "").localeCompare(String(b.path || "")) || (b.line || 0) - (a.line || 0));
}

function statsPanelPointByKey(points, key) {
  return (Array.isArray(points) ? points : []).find((point) => point && statsChartPointKey(point) === key) || null;
}

// Align the four task-flow series by bucket so the panel consumes the
// existing report series and never recomputes Net. Missing constituents
// stay null (rendered as missing, never zero); today stays provisional.
function statsPanelFlowRows(report) {
  const created = statsPanelMetricById(report, "created");
  const done = statsPanelMetricById(report, "done");
  const dropped = statsPanelMetricById(report, "dropped");
  const net = statsPanelMetricById(report, "net");
  const series = [created, done, dropped, net].filter(Boolean);
  if (!series.length) {
    return { rows: [], present: { created: false, done: false, dropped: false, net: false } };
  }
  const order = [];
  const seen = new Set();
  for (const metric of series) {
    for (const point of Array.isArray(metric.points) ? metric.points : []) {
      if (!point || typeof point !== "object") {
        continue;
      }
      const key = statsChartPointKey(point);
      if (!seen.has(key)) {
        seen.add(key);
        order.push({ date: point.date || "", end: point.end || point.date || "", key });
      }
    }
  }
  const rows = order.map((slot) => {
    const pick = (metric) => {
      if (!metric) {
        return null;
      }
      const point = statsPanelPointByKey(metric.points, slot.key);
      return point || null;
    };
    const picked = { created: pick(created), done: pick(done), dropped: pick(dropped), net: pick(net) };
    const values = [picked.created, picked.done, picked.dropped, picked.net].filter(
      (point) => point && statsFinite(point.value),
    );
    return {
      date: slot.date,
      end: slot.end,
      created: picked.created,
      done: picked.done,
      dropped: picked.dropped,
      net: picked.net,
      empty: values.length === 0,
      provisional: [picked.created, picked.done, picked.dropped, picked.net].some(
        (point) => point && point.provisional === true,
      ),
      partial: [picked.created, picked.done, picked.dropped, picked.net].some(
        (point) => point && point.partial === true,
      ),
    };
  });
  return {
    rows,
    present: { created: Boolean(created), done: Boolean(done), dropped: Boolean(dropped), net: Boolean(net) },
  };
}

function statsPanelFlowValues(rows) {
  const values = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row.created && statsFinite(row.created.value)) {
      values.push(row.created.value);
    }
    if (row.done && statsFinite(row.done.value)) {
      values.push(-row.done.value);
    }
    if (row.dropped && statsFinite(row.dropped.value)) {
      values.push(-row.dropped.value);
    }
    if (row.done && row.dropped && statsFinite(row.done.value) && statsFinite(row.dropped.value)) {
      values.push(-(row.done.value + row.dropped.value));
    }
    if (row.net && statsFinite(row.net.value)) {
      values.push(row.net.value);
    }
  }
  return values;
}

// Null-separated polyline over point.value (the focus-chart helper only
// reads rolling_median). Gaps stay visible on missing constituents.
function statsPanelValuePath(points, xPositions, yFor) {
  const values = Array.isArray(points) ? points : [];
  const xs = Array.isArray(xPositions) ? xPositions : [];
  if (typeof yFor !== "function") {
    return "";
  }
  let path = "";
  let drawing = false;
  for (let index = 0; index < values.length; index += 1) {
    const point = values[index] && typeof values[index] === "object" ? values[index] : {};
    const x = xs[index];
    if (!statsFinite(x) || !statsFinite(point.value)) {
      drawing = false;
      continue;
    }
    const y = yFor(point.value);
    if (!statsFinite(y)) {
      drawing = false;
      continue;
    }
    path += (drawing ? " L " : " M ") + x + " " + y;
    drawing = true;
  }
  return path.trim();
}

// Ranked dimension rows (By kind / Top notes / Answers) from the
// supplied parts_summary. Reviewed is never plotted in task flow, but
// its journal parts are welcome here.
function statsPanelRankedDimension(metric, dimension) {
  const safe = metric && typeof metric === "object" ? metric : {};
  const summary = safe.parts_summary && typeof safe.parts_summary === "object" ? safe.parts_summary : {};
  const raw = Array.isArray(summary[dimension]) ? summary[dimension] : [];
  const rows = raw.map(statsPanelSummaryEntry).filter(Boolean);
  rows.sort((a, b) => (b.value === null ? -1 : a.value === null ? 1 : 0) || ((b.value || 0) - (a.value || 0)) || a.key.localeCompare(b.key));
  return rows;
}

function statsPanelTotalDisplay(metric) {
  const safe = metric && typeof metric === "object" ? metric : {};
  const total = safe.summary && typeof safe.summary === "object" ? safe.summary.total : null;
  if (total && typeof total.display === "string" && total.display) {
    return total.display;
  }
  const headline = safe.summary && typeof safe.summary === "object" ? safe.summary.headline : null;
  if (headline && typeof headline.display === "string" && headline.display) {
    return headline.display;
  }
  return "";
}

// One checklist day cell from actual daily data. `state` is empty when
// the schema predates checklist_state; callers omit the calendar then
// with a short explanatory label instead of inventing history.
function statsPanelCalendarCell(point) {
  const safe = point && typeof point === "object" ? point : {};
  const date = typeof safe.date === "string" ? safe.date : "";
  const raw = typeof safe.checklist_state === "string" ? safe.checklist_state : "";
  return {
    date,
    display: typeof safe.display === "string" && safe.display ? safe.display : "–",
    reason: typeof safe.reason === "string" ? safe.reason : "",
    quality: typeof safe.quality === "string" ? safe.quality : "",
    provisional: safe.provisional === true,
    state: STATS_PANEL_CHECKLIST_STATES.includes(raw) ? raw : "",
  };
}

function statsPanelMondayLabel(mondayOrdinal) {
  const date = new Date(mondayOrdinal * 86400000);
  const label = STATS_PANEL_MONTHS[date.getUTCMonth()] + " " + date.getUTCDate();
  return { label, year: date.getUTCFullYear() };
}

// Monday-aligned week columns of weekday rows from the selected daily
// data, even when the main chart is grouped. Returns null when no daily
// cell carries checklist_state (old schema-1 reports).
function statsPanelCalendar(metric, report) {
  const daily = statsChartDailyPoints(metric, report);
  const cells = daily
    .map(statsPanelCalendarCell)
    .filter((cell) => cell.date && statsIsoOrdinal(cell.date) !== null);
  if (!cells.length || !cells.some((cell) => cell.state)) {
    return null;
  }
  const weeks = new Map();
  for (const cell of cells) {
    const ordinal = statsIsoOrdinal(cell.date);
    const weekday = new Date(ordinal * 86400000).getUTCDay();
    const monday = ordinal - ((weekday + 6) % 7);
    if (!weeks.has(monday)) {
      weeks.set(monday, { monday, slots: [null, null, null, null, null, null, null] });
    }
    weeks.get(monday).slots[(weekday + 6) % 7] = cell;
  }
  const ordered = Array.from(weeks.values()).sort((a, b) => a.monday - b.monday);
  const years = new Set();
  for (const week of ordered) {
    for (const cell of week.slots) {
      if (cell) {
        years.add(Number(cell.date.slice(0, 4)));
      }
    }
    const monday = statsPanelMondayLabel(week.monday);
    week.label = monday.label;
    week.year = monday.year;
  }
  const showYear = years.size > 1;
  for (const week of ordered) {
    if (showYear) {
      week.label += " ’" + String(week.year).slice(2);
    }
  }
  return { weeks: ordered };
}

// Chore-by-day states from each daily point's existing met/missed
// parts. A chore absent on a known day is not due, while globally
// missing/untracked days stay unknown. Returns null without chores.
function statsPanelChoreGrid(metric, report) {
  const safe = metric && typeof metric === "object" ? metric : {};
  const chores = (Array.isArray(safe.chores) ? safe.chores : [])
    .filter((chore) => chore && typeof chore.key === "string" && chore.key)
    .map((chore) => ({
      key: chore.key,
      met: typeof chore.met === "number" ? chore.met : null,
      due: typeof chore.due === "number" ? chore.due : null,
      display: typeof chore.display === "string" && chore.display ? chore.display : "",
    }));
  if (!chores.length) {
    return null;
  }
  const days = statsChartDailyPoints(metric, report)
    .filter((point) => point && typeof point.date === "string" && statsIsoOrdinal(point.date) !== null)
    .map((point) => {
      const parts = point.parts && typeof point.parts === "object" ? point.parts : {};
      const met = parts.met && typeof parts.met === "object" ? parts.met : {};
      const missed = parts.missed && typeof parts.missed === "object" ? parts.missed : {};
      const unknown = point.checklist_state === "missing" || point.checklist_state === "not_tracked" ||
        point.quality === "missing" || point.quality === "not_tracked";
      const states = {};
      for (const chore of chores) {
        if (unknown) {
          states[chore.key] = "unknown";
        } else if (Object.prototype.hasOwnProperty.call(met, chore.key)) {
          states[chore.key] = "met";
        } else if (Object.prototype.hasOwnProperty.call(missed, chore.key)) {
          states[chore.key] = "missed";
        } else {
          states[chore.key] = "not_due";
        }
      }
      return {
        date: point.date,
        display: typeof point.display === "string" && point.display ? point.display : "–",
        reason: typeof point.reason === "string" ? point.reason : "",
        provisional: point.provisional === true,
        states,
      };
    });
  return { chores, days };
}

function statsPanelCalendarAriaLabel(cell) {
  const parts = [cell.date || "Date unavailable", cell.display];
  if (cell.provisional) {
    parts.push("provisional today");
  }
  if (cell.reason) {
    parts.push(cell.reason);
  }
  parts.push("state: " + (cell.state ? cell.state.replace(/_/g, " ") : "unknown"));
  return parts.filter(Boolean).join(" · ");
}
