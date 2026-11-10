// Pure model for the week member of the period stats strip (`bob-stats-strip`).
// Bob owns every value; this model only selects the requested week's points and
// arranges their supplied labels, lanes, and columns for the painter. Built on the
// Day strip's shared lane builders so hues, ordering, and legends stay one family.
const PERIOD_STRIP_METRIC_IDS = ["worked", "reviewed", "done", "created", "review_closed"];
const PERIOD_STRIP_LABELS = {
  worked: "Worked",
  reviewed: "Reviewed",
  done: "Done",
  created: "Created",
  review_closed: "Review closed",
};
const PERIOD_STRIP_SKELETON_DISPLAYS = {
  worked: "0h 00m",
  reviewed: "00",
  done: "00",
  created: "00",
  review_closed: "not yet",
};

// Parse a period id from a fence body (`period: 2026-W45`), a note path
// (`2026/2026-W45.md`, `2026.md`, `all_time.md`), or a bare day line.
// Returns `{ kind, id }` or null. Week-only for the strip phase: quarter, year,
// and all time parse but select the parts-phase fallback. Never throws.
function periodStripParseFencePeriod(source, sourcePath) {
  try {
    let text = "";
    if (typeof source === "string" && source.trim()) {
      let parsed = null;
      try {
        if (typeof parseYaml === "function") parsed = parseYaml(source);
      } catch (error) {
        parsed = null;
      }
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const key of ["period", "Period", "PERIOD"]) {
          if (parsed[key] !== undefined && parsed[key] !== null && String(parsed[key]).trim()) {
            text = String(parsed[key]).trim();
            break;
          }
        }
        if (!text) {
          for (const key of ["day", "Day", "DAY"]) {
            if (parsed[key] !== undefined && parsed[key] !== null && String(parsed[key]).trim()) {
              return { kind: "day", id: String(parsed[key]).trim().replace(/^["']|["']$/g, "") };
            }
          }
        }
      }
      if (!text) {
        const match = /(?:^|\n)\s*period\s*:\s*([^\s#]+)/i.exec(source);
        if (match) text = match[1].trim().replace(/^["']|["']$/g, "");
      }
      if (!text) {
        const dayMatch = /(?:^|\n)\s*day\s*:\s*([^\s#]+)/i.exec(source);
        if (dayMatch) {
          return { kind: "day", id: dayMatch[1].trim().replace(/^["']|["']$/g, "") };
        }
      }
    }
    if (text) return periodStripClassifyId(text);
    const path = typeof sourcePath === "string" ? sourcePath : "";
    if (path) {
      const parsed = periodStripClassifyId(path.replace(/\.md$/, ""));
      if (parsed) return parsed;
    }
    return null;
  } catch (error) {
    return null;
  }
}

// Classify a bare id or vault-relative path into a period kind.
// Accepts `2026-W45`, `2026/2026-W45`, `2026-Q4`, `2026`, `all_time` (and
// `all-time` / `all`), plus a canonical daily path which classifies as a day.
// Returns `{ kind, id }` with canonical `id`, or null. Never throws.
function periodStripClassifyId(raw) {
  try {
    const text = String(raw === undefined || raw === null ? "" : raw).trim();
    if (!text) return null;
    const base = text.split("/").pop().replace(/\.md$/, "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(base)) {
      return dayStripDateParts(base) ? { kind: "day", id: base } : null;
    }
    if (/^\d{8}$/.test(base)) {
      const day = base.slice(0, 4) + "-" + base.slice(4, 6) + "-" + base.slice(6, 8);
      return dayStripDateParts(day) ? { kind: "day", id: day } : null;
    }
    const lowered = base.toLowerCase();
    if (lowered === "all_time" || lowered === "all-time" || lowered === "all") {
      return { kind: "all", id: "all" };
    }
    let match = /^(\d{4})-w(\d{2})$/i.exec(base);
    if (match) {
      const week = Number(match[2]);
      if (week >= 1 && week <= 53) return { kind: "week", id: match[1] + "-W" + String(week).padStart(2, "0") };
      return null;
    }
    match = /^(\d{4})-q([1-4])$/i.exec(base);
    if (match) return { kind: "quarter", id: match[1] + "-Q" + match[2] };
    if (/^\d{4}$/.test(base)) {
      const year = Number(base);
      if (year >= 1970 && year <= 2999) return { kind: "year", id: base };
      return null;
    }
    return null;
  } catch (error) {
    return null;
  }
}

function periodStripBlankTypical() {
  return { state: "blank", mark: null, display: "", words: "", detail: "" };
}

// Typical for a period fact: bob's sentence builders, reused verbatim. The mark
// (▲/▼/=) is set only when bob gives a `relation` on a closed period; open
// periods and short history never mark. Never throws.
function periodStripTypical(fact) {
  try {
    const typical = fact && typeof fact.typical === "object" ? fact.typical : null;
    if (!typical || typeof typical.display !== "string") return periodStripBlankTypical();
    const short = typical.value === null || typical.value === undefined;
    const relation = typical.relation;
    const closed = fact && fact.so_far !== true;
    const mark = (!short && closed && (relation === "above" || relation === "below" || relation === "equal")) ? relation : null;
    return {
      state: short ? "short" : "ready",
      mark,
      display: typical.display,
      words: typeof typical.words === "string" ? typical.words : "",
      detail: typeof typical.detail === "string" ? typical.detail : "",
    };
  } catch (error) {
    return periodStripBlankTypical();
  }
}

function periodStripAsOf(fetchedAt) {
  if (fetchedAt === null || fetchedAt === undefined || fetchedAt === "") return "";
  try {
    const value = fetchedAt instanceof Date ? fetchedAt : new Date(fetchedAt);
    if (!Number.isFinite(value.getTime())) return "";
    return String(value.getHours()).padStart(2, "0") + ":" + String(value.getMinutes()).padStart(2, "0");
  } catch (error) {
    return "";
  }
}

// Meta text for the top lane row: open reads coverage plus fetch time, a closed
// period with gaps reads bob's coverage display, a full closed period reads
// nothing, and all time reads `since <start>`. Never throws.
function periodStripMetaText(report, fetchedAt) {
  try {
    if (!report || typeof report !== "object") return "";
    const period = report.period && typeof report.period === "object" ? report.period : {};
    const kind = typeof period.kind === "string" ? period.kind : "";
    const state = typeof period.state === "string" ? period.state : "";
    const coverage = period.coverage && typeof period.coverage === "object" ? period.coverage : {};
    const display = typeof coverage.display === "string" ? coverage.display.trim() : "";
    if (kind === "all") {
      const start = typeof period.start === "string" ? period.start : "";
      const words = periodStripAllSince(start);
      return words || display;
    }
    if (state === "future") return display;
    if (state === "current") {
      const asOf = periodStripAsOf(fetchedAt);
      if (display && asOf) return display + " · " + asOf;
      return display || (asOf ? "so far · " + asOf : "so far");
    }
    return display;
  } catch (error) {
    return "";
  }
}

function periodStripAllSince(start) {
  try {
    const parts = dayStripDateParts(start);
    if (!parts) return "";
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return "since " + months[parts.month - 1].slice(0, 3) + " " + parts.date + ", " + parts.year;
  } catch (error) {
    return "";
  }
}

function periodStripBuildFact(fact) {
  const metric = typeof fact.metric === "string" ? fact.metric : "";
  const label = (typeof fact.label === "string" && fact.label) || PERIOD_STRIP_LABELS[metric] || metric || "Metric";
  const display = typeof fact.display === "string" ? fact.display : "–";
  const soFar = fact.so_far === true;
  const ref = periodStripTypical(fact);
  const quality = typeof fact.quality === "string" ? fact.quality : "ok";
  const tooltip = [
    (ref.state === "ready" || ref.state === "short") && ref.detail ? ref.detail : "",
    quality === "not_tracked" ? "Not tracked in this period." : "",
  ].filter(Boolean).join("\n");
  const ariaLabel = (ref.state === "ready" || ref.state === "short") && ref.words
    ? label + " " + display + (soFar ? " so far" : "") + ", " + ref.words
    : label + " " + display + (soFar ? " so far" : "");
  return {
    id: metric,
    label,
    display,
    quality,
    soFar,
    ref,
    tooltip,
    ariaLabel,
    value: typeof fact.value === "number" ? fact.value : null,
    offClock: fact && typeof fact.offclock === "object" ? fact.offclock : null,
    unit: typeof fact.unit === "string" ? fact.unit : "",
  };
}

// Lanes from a periods report: roots and types share one hue family. Hue comes
// from the same catalogs as `bob stats` (homes + theme_hues) so a root keeps
// one hue in the lanes and in the parts row. Built through the shared
// time-lane builders. Never throws.
function periodStripLane(report, dimension, context) {
  const empty = (extra) => ({
    segments: [],
    legend: [],
    overflow: [],
    overflowDefault: { count: 0, title: "" },
    empty: false,
    omitted: true,
    dimension,
    title: "",
    ...(extra || {}),
  });
  try {
    const lanes = report && typeof report.lanes === "object" ? report.lanes : null;
    const rows = lanes && Array.isArray(lanes[dimension]) ? lanes[dimension] : null;
    if (!rows) return empty();
    const normalized = rows
      .filter((row) => row && typeof row.key === "string" && row.key)
      .map((row) => ({
        key: row.key,
        label: typeof row.label === "string" && row.label ? row.label : row.key,
        value: typeof row.minutes === "number" ? row.minutes : (typeof row.value === "number" ? row.value : 0),
        display: typeof row.display === "string" ? row.display : "",
        share: typeof row.share === "string" ? row.share : "",
      }))
      .filter((row) => row.value > 0);
    if (!normalized.length) return empty({ omitted: true });
    const fallback = context && typeof context.themeHueFor === "function" ? context.themeHueFor : null;
    let segments = [];
    if (dimension === "theme") {
      const entries = normalized.map((row) => ({ key: row.key, label: row.label, value: row.value, display: row.display, share: row.share }));
      segments = typeof timeLaneThemeSegments === "function" ? timeLaneThemeSegments(report, entries, fallback) : [];
    } else {
      segments = typeof timeLaneRootSegments === "function" ? timeLaneRootSegments(report, dimension, normalized) : [];
    }
    const built = typeof timeLaneLegend === "function" ? timeLaneLegend(report, dimension, segments) : { segments, legend: segments, overflow: [], overflowDefault: { count: 0, title: "" } };
    const sentence = dimension === "theme" ? "Time by type" : "Time by root parent";
    return {
      segments: built.segments,
      legend: built.legend,
      overflow: built.overflow,
      overflowDefault: built.overflowDefault,
      empty: false,
      omitted: false,
      dimension,
      title: [sentence, ...built.segments.map((segment) => segment.label + " " + segment.display)].join("\n"),
    };
  } catch (error) {
    return empty();
  }
}

// Column model for the week parts row: seven day columns bottom-aligned on a
// hairline, each stacking root-parent minutes in lane order. States: future is
// a dashed outline ghost, a missing/workless closed column is a hatched
// not-tracked ghost, the current column is data plus a dashed outline to full
// height with `so far` in its caption, and a 6/7 caption marks partial weeks.
// Never throws.
function periodStripWeekColumns(report) {
  try {
    const raw = Array.isArray(report.columns) ? report.columns : [];
    const periodKind = report && report.period && typeof report.period.kind === "string" ? report.period.kind : "";
    const lanes = report && typeof report.lanes === "object" ? report.lanes : null;
    const roots = lanes && Array.isArray(lanes.root_parent) ? lanes.root_parent : [];
    const order = new Map(roots.map((row, index) => [row.key, index]));
    const hueByKey = new Map();
    try {
      const built = typeof timeLaneRootSegments === "function" ? timeLaneRootSegments(report, "root_parent", roots.map((row) => ({
        key: row.key,
        label: row.label,
        value: typeof row.minutes === "number" ? row.minutes : 0,
        display: row.display,
        share: row.share,
      }))) : [];
      for (const segment of built) hueByKey.set(segment.key, segment.hue);
    } catch (error) {
      // Hue sharing is best-effort; columns still render without it.
    }
    let tallest = 0;
    for (const column of raw) {
      const worked = column && typeof column.worked === "object" ? column.worked : null;
      const value = worked && typeof worked.value === "number" ? worked.value : 0;
      if (value > tallest) tallest = value;
    }
    return raw.map((column) => {
      if (!column || typeof column !== "object") return null;
      const state = typeof column.state === "string" ? column.state : "closed";
      const stackRaw = Array.isArray(column.stack) ? column.stack : [];
      const stack = stackRaw
        .filter((entry) => entry && typeof entry.key === "string" && typeof entry.minutes === "number" && entry.minutes > 0)
        .map((entry) => ({
          key: entry.key,
          minutes: entry.minutes,
          hue: hueByKey.get(entry.key) || "gray",
          rank: order.has(entry.key) ? order.get(entry.key) : 999,
        }))
        .sort((a, b) => a.rank - b.rank);
      const worked = column.worked && typeof column.worked === "object" ? column.worked : null;
      const value = worked && typeof worked.value === "number" ? worked.value : null;
      const quality = worked && typeof worked.quality === "string" ? worked.quality : "";
      const missing = state !== "future" && (quality === "missing" || quality === "not_tracked");
      const height = tallest > 0 && typeof value === "number" ? value / tallest : 0;
      const mark = typeof column.mark === "string" ? column.mark : null;
      let caption = typeof column.caption === "string" ? column.caption : "";
      if (periodKind === "quarter" && typeof column.kind === "string" && column.kind === "week") caption = caption.replace(/^W/i, "");
      if (periodKind === "year" && column.group) caption = "";
      const soFar = state === "current";
      const tooltip = periodStripColumnTooltip(column, missing, report);
      return {
        id: typeof column.id === "string" ? column.id : "",
        kind: typeof column.kind === "string" ? column.kind : "day",
        label: typeof column.label === "string" ? column.label : "",
        caption,
        path: typeof column.path === "string" ? column.path : "",
        start: typeof column.start === "string" ? column.start : "",
        end: typeof column.end === "string" ? column.end : "",
        state,
        partial: periodStripPartialCaption(column),
        worked: worked ? { display: worked.display, value, quality, soFar: worked.so_far === true || soFar } : null,
        missing,
        height,
        stack,
        mark,
        tick: typeof column.tick === "string" ? column.tick : null,
        group: column.group === null || column.group === undefined ? null : column.group,
        tooltip,
      };
    }).filter(Boolean);
  } catch (error) {
    return [];
  }
}

function periodStripPartialCaption(column) {
  if (!column || !column.partial) return null;
  if (typeof column.partial === "string") return column.partial;
  try {
    const start = dayStripDateParts(column.start);
    const end = dayStripDateParts(column.end);
    if (!start || !end) return null;
    const days = Math.round((Date.UTC(end.year, end.month - 1, end.date) - Date.UTC(start.year, start.month - 1, start.date)) / 86400000) + 1;
    return days >= 1 && days < 7 ? days + "/7" : null;
  } catch (error) {
    return null;
  }
}

function periodStripColumnTooltip(column, missing, report) {
  try {
    const label = typeof column.label === "string" ? column.label : "";
    const worked = column.worked && typeof column.worked === "object" ? column.worked : null;
    const display = worked && typeof worked.display === "string" ? worked.display : "–";
    const state = typeof column.state === "string" ? column.state : "";
    const soFar = state === "current" ? " so far" : "";
    const reviewWords = periodStripColumnReviewWords(column.mark, state);
    const lines = [(label ? label + " · " : "") + "Worked " + display + soFar + (reviewWords ? " · " + reviewWords : "")];
    const stack = Array.isArray(column.stack) ? column.stack : [];
    for (const entry of stack) {
      if (!entry || typeof entry.key !== "string") continue;
      lines.push(periodStripRootLabel(report, entry.key) + " " + periodStripFormatMinutes(entry.minutes));
    }
    if (missing) lines.push("not tracked");
    return lines.join("\n");
  } catch (error) {
    return "";
  }
}

function periodStripRootLabel(report, key) {
  const homes = report && report.homes && typeof report.homes === "object" ? report.homes : {};
  const home = homes[key] && typeof homes[key] === "object" ? homes[key] : null;
  if (home && typeof home.label === "string" && home.label.trim()) return home.label.trim();
  const rows = report && report.lanes && Array.isArray(report.lanes.root_parent) ? report.lanes.root_parent : [];
  const row = rows.find((entry) => entry && entry.key === key);
  if (row && typeof row.label === "string" && row.label.trim()) return row.label.trim();
  if (key === "@unlinked") return "unlinked";
  if (key === "@unfiled") return "unfiled";
  return String(key).replace(/^@/, "").replace(/\.md$/i, "").replace(/[_-]+/g, " ");
}

function periodStripColumnReviewWords(mark, state) {
  if (state === "future") return "upcoming";
  if (mark === "reflected") return "reflected";
  if (mark === "drafted") return "drafted";
  if (mark === "edited") return "edited";
  if (mark === "met") return "review closed";
  if (mark === "missed") return "review open";
  if (mark === "open") return "today";
  return "";
}

function periodStripFormatMinutes(minutes) {
  try {
    if (typeof statsPanelFormatMinutes === "function") return statsPanelFormatMinutes(minutes);
  } catch (error) {
    // Fall through to the local fallback.
  }
  const value = Math.round(Number(minutes) || 0);
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  if (hours <= 0) return rest + "m";
  return hours + "h " + String(rest).padStart(2, "0") + "m";
}

function periodStripErrorInfo(error) {
  if (!error || typeof error !== "object") return null;
  if (typeof error.title === "string") {
    return { code: error.code || "failed", title: error.title, hint: typeof error.hint === "string" ? error.hint : "" };
  }
  try {
    const model = statsErrorModel(error);
    return { code: model.code, title: model.title, hint: model.hint };
  } catch (caught) {
    return { code: typeof error.code === "string" ? error.code : "failed", title: typeof error.message === "string" ? error.message : "bob periods failed", hint: "" };
  }
}

// Period member model: ready | skeleton | future | unavailable | hidden.
// The same report feeds the week, quarter, year, and all-time members.
function periodStripModel(report, periodId, context) {
  try {
    const safeContext = context && typeof context === "object" ? context : {};
    const laneView = typeof periodStripChartViewOf === "function" ? periodStripChartViewOf(safeContext.periodView) : "both";
    const classified = periodStripClassifyId(periodId);
    if (!classified || classified.kind === "day") {
      return { state: "hidden", periodId: typeof periodId === "string" ? periodId : "", kind: (classified && classified.kind) || "", lanes: { view: laneView, shown: [], switchable: false } };
    }
    const kind = classified.kind;
    const error = periodStripErrorInfo(safeContext.error);
    if (!report) {
      if (error) {
        const code = String(error.code || "");
        if (code === "bob-not-found" || /older-bob|unknown[\s_-]*subcommand|schema-mismatch/.test(code + " " + String(error.title || ""))) {
          return { state: "older-bob", periodId: classified.id, kind, lanes: { view: laneView, shown: [], switchable: false }, error };
        }
        return { state: "unavailable", periodId: classified.id, kind, lanes: { view: laneView, shown: [], switchable: false }, ariaLabel: "Period stats unavailable — " + error.title + ".", error };
      }
      const facts = PERIOD_STRIP_METRIC_IDS.map((id) => ({
        id,
        label: PERIOD_STRIP_LABELS[id],
        display: PERIOD_STRIP_SKELETON_DISPLAYS[id] || "00",
        quality: "skeleton",
        soFar: false,
        ref: periodStripBlankTypical(),
        tooltip: "",
        ariaLabel: PERIOD_STRIP_LABELS[id] + ", loading",
        value: null,
        offClock: null,
        unit: "",
      }));
      return { state: "skeleton", periodId: classified.id, kind, facts, columns: [], children: [], groups: [], lanes: { view: laneView, shown: ["roots", "themes"], switchable: false }, roots: null, themes: null, metaText: "", stale: false, error: null, ariaLabel: periodStripKindTitle(kind) + " stats for " + classified.id + ". Loading." };
    }
    const period = report.period && typeof report.period === "object" ? report.period : {};
    if (period.state === "future") {
      const charts = typeof periodStripChartsModel === "function" ? periodStripChartsModel(report, kind, laneView, safeContext) : null;
      return { state: "future", periodId: classified.id, kind, period, columns: periodStripWeekColumns(report), charts, children: periodStripTableRows(report), groups: Array.isArray(report.groups) ? report.groups : [], lanes: { view: laneView, shown: [], switchable: false }, metaText: periodStripMetaText(report, safeContext.fetchedAt), stale: false, error: null };
    }
    const facts = (Array.isArray(report.facts) ? report.facts : []).map(periodStripBuildFact);
    const roots = periodStripLane(report, "root_parent", safeContext);
    const themes = periodStripLane(report, "theme", safeContext);
    const charts = typeof periodStripChartsModel === "function" ? periodStripChartsModel(report, kind, laneView, safeContext) : null;
    const columns = periodStripWeekColumns(report);
    const children = periodStripTableRows(report);
    const groups = Array.isArray(report.groups) ? report.groups : [];
    const quarterFallbackColumns = kind === "year" ? periodStripYearQuarterColumns(children) : [];
    const stale = safeContext.stale === true;
    const lanes = {
      view: laneView,
      shown: [ ...(!roots.omitted ? ["roots"] : []), ...(!themes.omitted ? ["themes"] : []) ],
      switchable: false,
    };
    const metaText = periodStripMetaText(report, safeContext.fetchedAt);
    const asOf = periodStripAsOf(safeContext.fetchedAt);
    const staleTitle = stale ? ((error && error.title) || "Refresh failed") + " · showing the " + (asOf || "cached") + " report" : "";
    const title = typeof period.title === "string" ? period.title : classified.id;
    const ariaLabel = periodStripKindTitle(kind) + " stats for " + title + (period.state === "current" ? ", so far" : "") + ": " + facts.map((fact) => fact.label + " " + fact.display).join(", ") + ".";
    return {
      state: "ready",
      periodId: classified.id,
      kind,
      period,
      facts,
      roots,
      themes,
      columns,
      children,
      groups,
      quarterFallbackColumns,
      charts,
      lanes,
      metaText,
      asOf,
      stale,
      staleTitle,
      error,
      ariaLabel,
    };
  } catch (error) {
    return { state: "unavailable", periodId: typeof periodId === "string" ? periodId : "", kind: "", lanes: { view: "both", shown: [], switchable: false }, ariaLabel: "Period stats unavailable — bob periods failed.", error: { code: "model-error", title: "bob periods failed", hint: "" } };
  }
}

function periodStripYearQuarterColumns(children) {
  try {
    return (Array.isArray(children) ? children : []).filter((row) => row && row.kind === "quarter").map((row) => ({
      id: row.id,
      kind: "quarter",
      label: row.label,
      caption: row.label,
      path: row.path,
      start: "",
      end: "",
      state: row.state,
      worked: row.worked,
      missing: Boolean(row.worked && row.worked.quality === "not_tracked"),
      height: 0,
      stack: row.stack,
      mark: null,
      tick: null,
      group: null,
      tooltip: (row.label || row.id) + " · Worked " + ((row.worked && row.worked.display) || "–"),
    }));
  } catch (error) {
    return [];
  }
}

function periodStripKindTitle(kind) {
  return ({ week: "Week", quarter: "Quarter", year: "Year", all: "All-time" })[kind] || "Period";
}

// Narrative children supplied by bob for the live parts table. Keeping this
// as a shallow projection ensures the table never recalculates period values.
function periodStripTableRows(report) {
  try {
    const raw = Array.isArray(report && report.children) ? report.children : [];
    const roots = report && report.lanes && Array.isArray(report.lanes.root_parent) ? report.lanes.root_parent : [];
    const order = new Map(roots.map((row, index) => [row.key, index]));
    const hues = new Map();
    const segments = typeof timeLaneRootSegments === "function"
      ? timeLaneRootSegments(report, "root_parent", roots.map((row) => ({ key: row.key, label: row.label, value: Number(row.minutes) || 0, display: row.display, share: row.share })))
      : [];
    for (const segment of segments) hues.set(segment.key, segment.hue);
    return raw.filter((row) => row && typeof row === "object").map((row) => {
      const worked = row.worked && typeof row.worked === "object" ? row.worked : null;
      const stack = (Array.isArray(row.stack) ? row.stack : []).filter((entry) => entry && typeof entry.key === "string" && typeof entry.minutes === "number" && entry.minutes > 0)
        .map((entry) => ({ key: entry.key, minutes: entry.minutes, hue: hues.get(entry.key) || "gray", rank: order.has(entry.key) ? order.get(entry.key) : 999 }))
        .sort((a, b) => a.rank - b.rank);
      const rawStacks = row.stacks && typeof row.stacks === "object" ? row.stacks : null;
      const stacks = rawStacks ? {
        roots: Array.isArray(rawStacks.roots) ? rawStacks.roots.filter((entry) => entry && typeof entry.key === "string" && typeof entry.minutes === "number" && entry.minutes > 0) : [],
        types: Array.isArray(rawStacks.types) ? rawStacks.types.filter((entry) => entry && typeof entry.key === "string" && typeof entry.minutes === "number" && entry.minutes > 0) : [],
      } : null;
      return {
        id: typeof row.id === "string" ? row.id : "",
        kind: typeof row.kind === "string" ? row.kind : "",
        label: typeof row.label === "string" ? row.label : (typeof row.id === "string" ? row.id : ""),
        rangeLabel: typeof row.range_label === "string" ? row.range_label : "",
        path: typeof row.path === "string" ? row.path : "",
        exists: row.exists === true,
        state: typeof row.state === "string" ? row.state : "closed",
        worked: worked ? { value: typeof worked.value === "number" ? worked.value : null, display: typeof worked.display === "string" ? worked.display : "–", quality: typeof worked.quality === "string" ? worked.quality : "", soFar: worked.so_far === true } : null,
        done: row.done && typeof row.done === "object" ? row.done : null,
        review: row.review && typeof row.review === "object" ? row.review : null,
        closeout: typeof row.closeout === "string" ? row.closeout : null,
        headline: row.review && typeof row.review.headline === "string" ? row.review.headline : "",
        mostly: typeof row.mostly_display === "string" ? row.mostly_display : "",
        stack,
        stacks,
      };
    });
  } catch (error) {
    return [];
  }
}
