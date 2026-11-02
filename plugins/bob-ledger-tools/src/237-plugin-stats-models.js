// --- Daily Stats page models (bob-cli-6l page) ------------------------------
// Pure helpers for the `bob-stats` code block: the injected-document
// element helper, fence parsing, tile models, spark geometry, table rows,
// CSV, overview ids, and labels. Layout math stays here so fake-DOM tests
// and the browser preview share it with Obsidian.

const STATS_RANGE_CHIPS = [
  { id: "7d", label: "7D" },
  { id: "4w", label: "4W" },
  { id: "3m", label: "3M" },
  { id: "1y", label: "1Y" },
  { id: "all", label: "All" },
];
const STATS_FENCE_KEYS = ["range", "metrics", "focus"];
const STATS_DEFAULT_TILE_COUNT = 6;

// Tiny element helper over an injected document.
function statsEl(doc, tag, attrs, text) {
  const scope =
    doc && typeof doc.createElement === "function"
      ? doc
      : typeof document !== "undefined"
        ? document
        : null;
  if (!scope) {
    return null;
  }
  const node = scope.createElement(tag);
  if (!node) {
    return null;
  }
  if (attrs && typeof attrs === "object") {
    for (const [name, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) {
        continue;
      }
      try {
        if (name === "class") {
          node.setAttribute("class", String(value));
        } else if (name.startsWith("aria-") || name === "role") {
          node.setAttribute(name, String(value));
        } else if (name === "tabindex" || name === "title" || name === "type") {
          node.setAttribute(name, String(value));
        } else {
          node.setAttribute(name, String(value));
        }
      } catch (error) {
        // Attribute setting is best-effort.
      }
    }
  }
  if (text !== undefined && text !== null) {
    try {
      node.textContent = String(text);
    } catch (error) {
      // Text setting is best-effort.
    }
  }
  return node;
}

function statsDocFor(el) {
  try {
    if (el && el.ownerDocument && typeof el.ownerDocument.createElement === "function") {
      return el.ownerDocument;
    }
  } catch (error) {
    // Fall through to the global document.
  }
  try {
    if (typeof document !== "undefined" && typeof document.createElement === "function") {
      return document;
    }
  } catch (error) {
    // No document available (pure-model callers pass their own).
  }
  return null;
}

// Parse the optional fence-body YAML (`range`, `metrics`, `focus`). The
// fence sets defaults only; anything absent follows `stats.range` and
// `stats.overview`. Guarded: never throws, unknown keys ignored.
function statsParseFenceOptions(source) {
  const options = {};
  try {
    const text = typeof source === "string" ? source.trim() : "";
    if (!text) {
      return options;
    }
    if (typeof parseYaml !== "function") {
      return options;
    }
    let parsed = null;
    try {
      parsed = parseYaml(text);
    } catch (error) {
      return options;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return options;
    }
    for (const key of Object.keys(parsed)) {
      if (!STATS_FENCE_KEYS.includes(key)) {
        continue;
      }
      options[key] = parsed[key];
    }
    if (options.range !== undefined) {
      const range = statsNormalizeRange(options.range, "");
      if (range) {
        options.range = range;
      } else {
        delete options.range;
      }
    }
    if (options.metrics !== undefined) {
      if (Array.isArray(options.metrics)) {
        const ids = options.metrics
          .filter((id) => typeof id === "string" && id.trim())
          .map((id) => id.trim());
        if (ids.length > 0) {
          options.metrics = ids;
        } else {
          delete options.metrics;
        }
      } else {
        delete options.metrics;
      }
    }
    if (options.focus !== undefined) {
      if (typeof options.focus !== "string" || !options.focus.trim()) {
        delete options.focus;
      } else {
        options.focus = options.focus.trim();
      }
    }
  } catch (error) {
    // Fence parsing never breaks the block.
  }
  return options;
}

function statsDefaultViewState() {
  return {
    range: null,
    offset: 0,
    clock: "worked",
    focus: null,
    compare: false,
    table: false,
    pinnedDay: null,
    homesView: null,
    homeRowsExpanded: {},
    homeSessionsExpanded: {},
    homeSessionsAll: {},
    themeRowsExpanded: false,
  };
}

// Geometry-only split of a supplied clock breakdown. Missing detail is
// absent: Total never invents a zero off-clock tail.
function statsClockBarParts(point, metric, report) {
  try {
    const safe = point && typeof point === "object" ? point : {};
    const clock = statsNormalizeClock(safe.clock, null) || statsMetricEffectiveClock(metric, report);
    const value = typeof safe.value === "number" && Number.isFinite(safe.value) ? safe.value : null;
    const breakdown = statsClockBreakdown(safe.clock_breakdown);
    const result = {
      clock: clock || null,
      value,
      worked: null,
      offClock: null,
      workedShare: 0,
      offShare: 0,
      mode: "solid",
    };
    if (clock === "off-clock") {
      result.mode = "outline";
      if (breakdown) {
        result.worked = breakdown.worked.value;
        result.offClock = breakdown.off_clock.value;
      }
      return result;
    }
    if (clock === "total" && breakdown) {
      result.worked = breakdown.worked.value;
      result.offClock = breakdown.off_clock.value;
      const sum = result.worked + result.offClock;
      if (sum > 0) {
        result.workedShare = result.worked / sum;
        result.offShare = result.offClock / sum;
        if (result.offClock > 0 && result.worked > 0) {
          result.mode = "split";
        } else if (result.offClock > 0) {
          result.mode = "outline";
        }
      }
    }
    return result;
  } catch (error) {
    return { clock: null, value: null, worked: null, offClock: null, workedShare: 0, offShare: 0, mode: "solid" };
  }
}

function statsClockComparisonNeutral(metric, report) {
  try {
    const safe = metric && typeof metric === "object" ? metric : {};
    if (safe.direction === "neutral") {
      return true;
    }
    const clock = statsMetricEffectiveClock(safe, report);
    return clock === "off-clock" || clock === "total";
  } catch (error) {
    return false;
  }
}

function statsClockHeaderSuffix(report, metric) {
  return statsMetricEffectiveClock(metric, report) === "off-clock" ? " · off the clock" : "";
}

function statsClockWindowIsEmpty(metric, report) {
  try {
    if (statsMetricEffectiveClock(metric, report) !== "off-clock") {
      return false;
    }
    const points = Array.isArray(metric && metric.points) ? metric.points : [];
    let tracked = false;
    let positive = false;
    for (const point of points) {
      if (!point || typeof point !== "object") {
        continue;
      }
      if (point.quality === "not_tracked") {
        continue;
      }
      tracked = true;
      if (typeof point.value === "number" && Number.isFinite(point.value) && point.value > 0) {
        positive = true;
      }
    }
    if (!points.length) {
      const total = metric && metric.summary && metric.summary.total;
      return !(total && typeof total.value === "number" && total.value > 0);
    }
    return tracked && !positive;
  } catch (error) {
    return false;
  }
}

// One tile's pure model from a report metric. Covers every unit
// (minutes, count, signed, bool, ratio) and every quality (ok, partial,
// missing, not_tracked). Never throws. The headline is Bob's headline.
function statsTileModel(metric, report) {
  const safe = metric && typeof metric === "object" ? metric : {};
  const id = typeof safe.id === "string" ? safe.id : "unknown";
  const label = typeof safe.label === "string" && safe.label ? safe.label : id;
  const color = typeof safe.color === "string" && safe.color ? safe.color : "gray";
  const unit = typeof safe.unit === "string" ? safe.unit : "count";
  const clock = statsMetricEffectiveClock(safe, report);
  const summary = safe.summary && typeof safe.summary === "object" ? safe.summary : {};
  const headline = summary.headline && typeof summary.headline === "object" ? summary.headline : {};
  const delta = summary.delta && typeof summary.delta === "object" ? summary.delta : {};
  const points = Array.isArray(safe.points) ? safe.points : [];
  const headlineDisplay =
    typeof headline.display === "string" && headline.display ? headline.display : "–";
  let suffix = typeof headline.suffix === "string" ? headline.suffix : "";
  if (!suffix) {
    if (unit === "minutes" || unit === "count" || unit === "signed") {
      suffix = "/day";
    } else if (unit === "bool") {
      suffix = "days";
    }
  }
  const spark = points.map((point) => {
    if (!point || typeof point !== "object") {
      return { value: null, provisional: false, clock, clock_breakdown: null };
    }
    return {
      value: typeof point.value === "number" ? point.value : null,
      provisional: point.provisional === true,
      clock,
      clock_breakdown: statsClockBreakdown(point.clock_breakdown),
    };
  });
  const qualities = points.map((point) =>
    point && typeof point.quality === "string" ? point.quality : "ok",
  );
  const quality = qualities.includes("ok") || qualities.includes("partial")
    ? "ok"
    : qualities.includes("missing")
      ? "missing"
      : "not_tracked";
  const deltaNeutral = statsClockComparisonNeutral(safe, report);
  const deltaDisplay = deltaNeutral && typeof delta.words === "string" && delta.words
    ? delta.words
    : (typeof delta.display === "string" ? delta.display : "");
  return {
    id,
    label,
    color,
    unit,
    clock,
    headline: headlineDisplay,
    suffix,
    delta: deltaDisplay,
    deltaWords: typeof delta.words === "string" ? delta.words : "",
    deltaNeutral,
    spark,
    quality,
    daysWithData:
      typeof summary.days_with_data === "number" ? summary.days_with_data : null,
  };
}

// Normalize one tile sparkline to 0..1 bar heights for div bars. A real
// zero renders as a 2 px baseline tick (height 0 + `stats-zero` class);
// null renders as a faint gap; today renders hollow. Never throws.
function statsSparkBars(spark) {
  const values = (Array.isArray(spark) ? spark : [])
    .map((bar) => (bar && typeof bar.value === "number" ? bar.value : null))
    .filter((value) => value !== null);
  const max = values.length > 0 ? Math.max(...values, 0) : 0;
  return (Array.isArray(spark) ? spark : []).map((bar) => {
    const value = bar && typeof bar.value === "number" ? bar.value : null;
    const parts = statsClockBarParts(bar, null, null);
    const clockFields = {
      clock: parts.clock,
      mode: parts.mode,
      workedShare: parts.workedShare,
      offShare: parts.offShare,
    };
    if (value === null) {
      return { height: 0, empty: true, provisional: false, zero: false, ...clockFields };
    }
    if (max <= 0) {
      return { height: 0, empty: false, provisional: bar.provisional === true, zero: true, ...clockFields };
    }
    return {
      height: Math.max(value <= 0 ? 0 : Math.round((value / max) * 100) / 100, value > 0 ? 0.08 : 0),
      empty: false,
      provisional: bar.provisional === true,
      zero: value === 0,
      ...clockFields,
    };
  });
}

function statsSparkBarNode(doc, bar) {
  const classes = ["bob-stats-bar"];
  if (bar.empty) classes.push("bob-stats-bar-null");
  if (bar.zero) classes.push("bob-stats-bar-zero");
  if (bar.provisional) classes.push("bob-stats-bar-today");
  if (bar.mode === "outline" || bar.clock === "off-clock") classes.push("bob-stats-bar-clock-off");
  if (bar.mode === "split") classes.push("bob-stats-bar-clock-total");
  const node = statsEl(doc, "div", { class: classes.join(" ") });
  if (bar.clock) {
    try {
      node.setAttribute("data-stats-clock", bar.clock);
    } catch (error) {
      // Clock annotation is best-effort.
    }
  }
  if (!bar.empty && !bar.zero) {
    try {
      node.setAttribute("style", `height: ${Math.round(bar.height * 100)}%`);
    } catch (error) {
      // Bar height is best-effort.
    }
    if (bar.mode === "split") {
      const worked = statsEl(doc, "div", { class: "bob-stats-bar-worked" });
      const off = statsEl(doc, "div", { class: "bob-stats-bar-off" });
      try {
        worked.setAttribute("style", `flex: ${Math.max(1, Math.round(bar.workedShare * 100))} 1 0`);
        off.setAttribute("style", `flex: ${Math.max(1, Math.round(bar.offShare * 100))} 1 0`);
      } catch (error) {
        // Split shares are best-effort.
      }
      node.appendChild(worked);
      node.appendChild(off);
    }
  }
  return node;
}

function statsSparkElement(doc, spark) {
  const root = statsEl(doc, "div", { class: "bob-stats-spark", "aria-hidden": "true" });
  for (const bar of statsSparkBars(spark)) {
    root.appendChild(statsSparkBarNode(doc, bar));
  }
  return root;
}

// Table rows for the focus metric: date, value, quality/reason, top
// parts. The accessible route and the source of exact numbers.
function statsTableRows(metric, limit, report) {
  const safe = metric && typeof metric === "object" ? metric : {};
  const points = Array.isArray(safe.points) ? safe.points : [];
  const max = typeof limit === "number" && limit > 0 ? limit : points.length;
  return points.slice(0, max).map((point) => {
    const row = point && typeof point === "object" ? point : {};
    const parts = row.parts && typeof row.parts === "object" ? row.parts : {};
    const topParts = [];
    for (const [dimension, entries] of Object.entries(parts)) {
      if (!entries || typeof entries !== "object") {
        continue;
      }
      const ranked = Object.entries(entries)
        .filter(([, value]) => typeof value === "number")
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([key, value]) => ({
          dimension,
          key,
          value,
          label: ["area", "project"].includes(dimension)
            ? statsPanelHomeLabel(report, dimension, key)
            : key,
        }));
      topParts.push(...ranked);
    }
    return {
      date: typeof row.date === "string" ? row.date : "",
      display: typeof row.display === "string" ? row.display : "–",
      quality: typeof row.quality === "string" ? row.quality : "ok",
      reason: typeof row.reason === "string" ? row.reason : "",
      provisional: row.provisional === true,
      num: typeof row.num === "number" ? row.num : null,
      den: typeof row.den === "number" ? row.den : null,
      topParts: topParts.slice(0, 3),
    };
  });
}

// Tidy CSV from the report points (`date,end,metric,value,display,
// quality,provisional` plus `num,den` for ratios). The Copy CSV button
// builds from the same points as the table.
function statsCsv(report) {
  const lines = ["date,end,metric,value,display,quality,provisional,num,den"];
  const metrics =
    report && Array.isArray(report.metrics) ? report.metrics : [];
  const cell = (value) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  for (const metric of metrics) {
    if (!metric || typeof metric !== "object") {
      continue;
    }
    const id = typeof metric.id === "string" ? metric.id : "";
    for (const point of Array.isArray(metric.points) ? metric.points : []) {
      const row = point && typeof point === "object" ? point : {};
      lines.push(
        [
          cell(row.date || ""),
          cell(row.end || row.date || ""),
          cell(id),
          cell(typeof row.value === "number" ? row.value : ""),
          cell(row.display || ""),
          cell(row.quality || ""),
          cell(row.provisional === true ? "true" : "false"),
          cell(typeof row.num === "number" ? row.num : ""),
          cell(typeof row.den === "number" ? row.den : ""),
        ].join(","),
      );
    }
  }
  return lines.join("\n");
}

// Which metric ids fill the tile row: the fence `metrics`, else
// `stats.overview` filtered to ids in the report, else the first tiles.
function statsOverviewIds(report, fenceMetrics) {
  const metrics = report && Array.isArray(report.metrics) ? report.metrics : [];
  const present = new Set(
    metrics.filter((metric) => metric && typeof metric.id === "string").map((metric) => metric.id),
  );
  if (Array.isArray(fenceMetrics) && fenceMetrics.length > 0) {
    const ids = fenceMetrics.filter((id) => present.has(id));
    if (ids.length > 0) {
      return ids;
    }
  }
  try {
    const overview = statsReadConfigValue("overview");
    if (Array.isArray(overview)) {
      const ids = overview
        .filter((id) => typeof id === "string" && present.has(id));
      if (ids.length > 0) {
        return ids;
      }
    }
  } catch (error) {
    // Config overview is best-effort.
  }
  return metrics
    .filter((metric) => metric && typeof metric.id === "string")
    .slice(0, STATS_DEFAULT_TILE_COUNT)
    .map((metric) => metric.id);
}

function statsWindowLabel(report) {
  try {
    const range = report && report.range;
    const label = range && typeof range.label === "string" ? range.label : "";
    const includesToday = range && range.includes_today === true;
    if (!label) {
      return includesToday ? "today in progress" : "";
    }
    return includesToday ? `${label} · today in progress` : label;
  } catch (error) {
    return "";
  }
}

function statsTrackingSince(report) {
  try {
    const metrics = report && Array.isArray(report.metrics) ? report.metrics : [];
    const sinces = metrics
      .filter((metric) => metric && typeof metric.since === "string" && metric.since)
      .map((metric) => metric.since)
      .sort();
    return sinces.length > 0 ? sinces[0] : "";
  } catch (error) {
    return "";
  }
}

