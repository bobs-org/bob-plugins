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

// One tile's pure model from a report metric. Covers every unit
// (minutes, count, signed, bool, ratio) and every quality (ok, partial,
// missing, not_tracked). Never throws.
function statsTileModel(metric) {
  const safe = metric && typeof metric === "object" ? metric : {};
  const id = typeof safe.id === "string" ? safe.id : "unknown";
  const label = typeof safe.label === "string" && safe.label ? safe.label : id;
  const color = typeof safe.color === "string" && safe.color ? safe.color : "gray";
  const unit = typeof safe.unit === "string" ? safe.unit : "count";
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
      return { value: null, provisional: false };
    }
    return {
      value: typeof point.value === "number" ? point.value : null,
      provisional: point.provisional === true,
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
  return {
    id,
    label,
    color,
    unit,
    headline: headlineDisplay,
    suffix,
    delta: typeof delta.display === "string" ? delta.display : "",
    deltaWords: typeof delta.words === "string" ? delta.words : "",
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
    if (value === null) {
      return { height: 0, empty: true, provisional: false, zero: false };
    }
    if (max <= 0) {
      return { height: 0, empty: false, provisional: bar.provisional === true, zero: true };
    }
    return {
      height: Math.max(value <= 0 ? 0 : Math.round((value / max) * 100) / 100, value > 0 ? 0.08 : 0),
      empty: false,
      provisional: bar.provisional === true,
      zero: value === 0,
    };
  });
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

