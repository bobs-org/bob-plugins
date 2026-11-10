// Pure model for the period strip's Roots and Types charts. Bob supplies the
// period totals and every child stack; this layer only attaches identity
// colors, readable labels, and the selected device view.
const PERIOD_STRIP_CHART_VIEWS = ["both", "roots", "types"];
const PERIOD_STRIP_CHART_VIEW_KEY = "bob-ledger-tools-period-stats-charts";

function periodStripChartViewOf(value) {
  return PERIOD_STRIP_CHART_VIEWS.includes(value) ? value : "both";
}

function periodStripNextChartView(value) {
  const current = periodStripChartViewOf(value);
  return PERIOD_STRIP_CHART_VIEWS[(PERIOD_STRIP_CHART_VIEWS.indexOf(current) + 1) % PERIOD_STRIP_CHART_VIEWS.length];
}

function periodStripChartsDigest(report) {
  try {
    const columns = Array.isArray(report && report.columns) ? report.columns : [];
    const children = Array.isArray(report && report.children) ? report.children : [];
    const charts = report && report.charts && typeof report.charts === "object" ? report.charts : null;
    const source = JSON.stringify({
      version: charts && charts.version,
      roots: charts && charts.roots,
      types: charts && charts.types,
      columns: columns.map((row) => row && ({ stacks: row.stacks, legacy: row.stack })),
      children: children.map((row) => row && ({ stacks: row.stacks, legacy: row.stack })),
    });
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return String(charts && charts.version || 0) + ":" + (hash >>> 0).toString(36);
  } catch (error) {
    return "0:unavailable";
  }
}

function periodStripChartSeries(report, rawSeries, dimension, fallback) {
  const raw = Array.isArray(rawSeries) ? rawSeries : [];
  const rows = raw.filter((entry) => entry && typeof entry.key === "string" && entry.key).map((entry) => ({
    key: entry.key,
    kind: typeof entry.kind === "string" ? entry.kind : (dimension === "roots" ? "root" : "type"),
    label: typeof entry.label === "string" && entry.label ? entry.label : entry.key,
    minutes: Number.isFinite(entry.minutes) ? entry.minutes : (Number(entry.value) || 0),
    display: typeof entry.display === "string" ? entry.display : "",
    displayShort: typeof entry.display_short === "string" ? entry.display_short : (typeof entry.display === "string" ? entry.display : ""),
    members: Array.isArray(entry.members) ? entry.members : [],
  }));

  if (dimension === "roots") {
    const roots = rows.filter((row) => row.kind === "root");
    const hues = typeof statsPanelDistinctHues === "function" ? statsPanelDistinctHues(
      roots.map((row) => ({ key: row.key, label: row.label, value: row.minutes })), report,
    ) : new Map();
    return rows.map((row) => {
      const hue = row.kind === "root" ? (hues.get(row.key) || "gray") : "gray";
      return {
        ...row,
        hue,
        shade: 0,
        fill: row.kind === "root" ? "identity" : row.kind === "unattributed" ? "hatch" : "rest",
        tone: row.kind === "root" ? (hue === "gray" ? "gray" : "hue") : row.kind,
      };
    });
  }

  const themeRows = rows.filter((row) => row.kind === "type").map((row) => {
    const ref = typeof statsThemeRef === "function"
      ? statsThemeRef(report, row.key, fallback)
      : { label: row.label, hue: "gray", gray: true };
    return { ...row, hue: ref.gray ? "gray" : ref.hue, gray: Boolean(ref.gray), hueSource: ref.hue_source || "" };
  });
  const shades = new Map();
  const byHue = new Map();
  for (const row of themeRows) {
    if (row.gray) continue;
    const group = byHue.get(row.hue) || [];
    group.push(row);
    byHue.set(row.hue, group);
  }
  for (const group of byHue.values()) {
    group.sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()) || a.key.localeCompare(b.key));
    group.forEach((row, index) => shades.set(row.key, index === 1 ? 1 : index >= 2 ? 2 : 0));
  }
  const themeByKey = new Map(themeRows.map((row) => [row.key, row]));
  return rows.map((row) => {
    const theme = themeByKey.get(row.key);
    const hue = theme ? theme.hue : "gray";
    return {
      ...row,
      label: theme && theme.label ? theme.label : row.label,
      hue,
      shade: theme ? (shades.get(row.key) || 0) : 0,
      fill: row.kind === "type" ? "identity" : row.kind === "unattributed" ? "hatch" : "rest",
      tone: row.kind === "type" ? (theme && theme.gray ? "gray" : "hue") : row.kind,
    };
  });
}

function periodStripChartStack(raw, seriesByKey) {
  const list = Array.isArray(raw) ? raw : [];
  return list.filter((entry) => entry && typeof entry.key === "string" && Number.isFinite(entry.minutes) && entry.minutes > 0)
    .map((entry) => {
      const series = seriesByKey.get(entry.key);
      return {
        key: entry.key,
        minutes: entry.minutes,
        label: series ? series.label : entry.key,
        hue: series ? series.hue : "gray",
        shade: series ? series.shade : 0,
        fill: series ? series.fill : "identity",
        kind: series ? series.kind : "unknown",
      };
    });
}

function periodStripChartColumnTooltip(column, roots, types, fallback) {
  const worked = column && column.worked && typeof column.worked === "object" ? column.worked : {};
  const display = typeof worked.display === "string" ? worked.display : "–";
  const soFar = column && column.state === "current" ? " so far" : "";
  const review = typeof periodStripColumnReviewWords === "function"
    ? periodStripColumnReviewWords(column && column.mark, column && column.state)
    : "";
  const lines = [((column && column.label) || (column && column.id) || "Period") + " · Worked " + display + soFar + (review ? " · " + review : "")];
  const append = (title, entries) => {
    for (const entry of entries || []) lines.push(title + " · " + entry.label + " " + periodStripFormatMinutes(entry.minutes));
  };
  append("Roots", roots);
  if (!fallback) append("Types", types);
  if (column && column.missing) lines.push("not tracked");
  return lines.join("\n");
}

function periodStripChartBuildColumns(rawRows, kind, rootSeries, typeSeries, fallback) {
  try {
    const rootsByKey = new Map(rootSeries.map((row) => [row.key, row]));
    const typesByKey = new Map(typeSeries.map((row) => [row.key, row]));
    return rawRows.filter((row) => row && typeof row === "object").map((column) => {
      const state = typeof column.state === "string" ? column.state : "closed";
      const worked = column.worked && typeof column.worked === "object" ? column.worked : null;
      const quality = worked && typeof worked.quality === "string" ? worked.quality : "";
      const missing = state !== "future" && (quality === "missing" || quality === "not_tracked");
      const rawStacks = column.stacks && typeof column.stacks === "object" ? column.stacks : {};
      const rootStack = fallback ? column.stack : rawStacks.roots;
      const roots = periodStripChartStack(rootStack, rootsByKey);
      const types = fallback ? [] : periodStripChartStack(rawStacks.types, typesByKey);
      const rawKind = typeof column.kind === "string" ? column.kind : "";
      const rawLabel = typeof column.label === "string" ? column.label : (typeof column.id === "string" ? column.id : "");
      const rawCaption = typeof column.caption === "string" && column.caption ? column.caption : rawLabel;
      const caption = kind === "year" ? (rawKind === "quarter" ? rawCaption : "") : (typeof column.caption === "string" ? column.caption : "");
      const modelColumn = {
        id: typeof column.id === "string" ? column.id : "",
        kind: typeof column.kind === "string" ? column.kind : "week",
        label: typeof column.label === "string" ? column.label : (typeof column.id === "string" ? column.id : ""),
        caption,
        path: typeof column.path === "string" ? column.path : "",
        start: typeof column.start === "string" ? column.start : "",
        end: typeof column.end === "string" ? column.end : "",
        state,
        partial: typeof periodStripPartialCaption === "function" ? periodStripPartialCaption(column) : null,
        worked: worked ? {
          display: typeof worked.display === "string" ? worked.display : "–",
          displayShort: typeof worked.display_short === "string" ? worked.display_short : (typeof worked.display === "string" ? worked.display : "–"),
          value: typeof worked.value === "number" ? worked.value : null,
          quality,
          soFar: worked.so_far === true || state === "current",
        } : null,
        missing,
        mark: typeof column.mark === "string" ? column.mark : null,
        tick: typeof column.tick === "string" ? column.tick : null,
        group: (() => {
          if (column.group !== null && column.group !== undefined) return String(column.group);
          if (kind === "year" && rawKind === "quarter") {
            const match = /Q([1-4])/.exec(rawLabel || "");
            if (match) return "Q" + match[1];
            return rawLabel || null;
          }
          return null;
        })(),
        roots,
        types,
        tooltip: "",
      };
      modelColumn.tooltip = periodStripChartColumnTooltip(modelColumn, roots, types, fallback);
      return modelColumn;
    });
  } catch (error) {
    return [];
  }
}

function periodStripChartColumns(report, kind, rootSeries, typeSeries, fallback) {
  try {
    const rawColumns = Array.isArray(report && report.columns)
      ? report.columns
      : (Array.isArray(report && report.children) ? report.children : []);
    return periodStripChartBuildColumns(rawColumns, kind, rootSeries, typeSeries, fallback);
  } catch (error) {
    return [];
  }
}

// Year narrow-width fallback: four quarter columns from bob's children[]
// stacks. The plugin never re-adds minutes; it only reuses the child stacks.
function periodStripChartYearFallbackColumns(report, rootSeries, typeSeries, fallback) {
  try {
    const raw = Array.isArray(report && report.children) ? report.children : [];
    const quarters = raw.filter((row) => row && row.kind === "quarter");
    if (!quarters.length) return [];
    return periodStripChartBuildColumns(quarters, "year", rootSeries, typeSeries, fallback);
  } catch (error) {
    return [];
  }
}

// All-time leading untracked collapse: leading years with no tracked Worked
// collapse into one non-interactive quiet ghost group.
function periodStripChartCollapseLeadingUntracked(columns, groups) {
  try {
    if (!Array.isArray(columns) || !columns.length) return { columns, collapsed: null };
    const groupOrder = Array.isArray(groups) ? groups.map((group) => String(group && group.key || "")) : [];
    const byGroup = new Map();
    for (const column of columns) {
      const key = String(column.group || "");
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key).push(column);
    }
    const orderedKeys = groupOrder.length ? groupOrder.filter((key) => byGroup.has(key)) : Array.from(byGroup.keys());
    const leading = [];
    for (const key of orderedKeys) {
      const members = byGroup.get(key) || [];
      const tracked = members.some((column) => {
        if (column.state === "future") return true;
        const value = column.worked && typeof column.worked.value === "number" ? column.worked.value : 0;
        if (value > 0) return true;
        return column.missing !== true;
      });
      if (tracked) break;
      leading.push(key);
    }
    if (!leading.length) return { columns, collapsed: null };
    if (leading.length >= orderedKeys.length) return { columns, collapsed: null };
    const leadingSet = new Set(leading);
    const collapsedColumns = columns.filter((column) => !leadingSet.has(String(column.group || "")));
    const first = leading[0];
    const last = leading[leading.length - 1];
    const label = first === last ? first + " · not tracked" : first + "–" + last + " · not tracked";
    const ghost = {
      id: "untracked-" + leading.join("-"),
      kind: "ghost",
      label,
      caption: "",
      path: "",
      start: "",
      end: "",
      state: "ghost",
      partial: null,
      worked: null,
      missing: true,
      mark: null,
      tick: null,
      group: "__untracked__",
      roots: [],
      types: [],
      tooltip: label,
      ghost: true,
      ghostSpan: leading.length,
    };
    return { columns: [ghost, ...collapsedColumns], collapsed: { keys: leading, label } };
  } catch (error) {
    return { columns, collapsed: null };
  }
}

function periodStripChartsModel(report, kind, requestedView, context) {
  try {
    const rawCharts = report && report.charts && typeof report.charts === "object" ? report.charts : null;
    const hasCharts = Boolean(rawCharts && rawCharts.version === 1 && rawCharts.roots && rawCharts.types);
    const fallback = !hasCharts;
    let rootsRaw = [];
    let typesRaw = [];
    if (hasCharts) {
      rootsRaw = Array.isArray(rawCharts.roots.series) ? rawCharts.roots.series : [];
      typesRaw = Array.isArray(rawCharts.types.series) ? rawCharts.types.series : [];
    } else {
      const lane = typeof periodStripLane === "function"
        ? periodStripLane(report, "root_parent", context || {})
        : { legend: [] };
      rootsRaw = (Array.isArray(lane.legend) ? lane.legend : []).map((row) => ({
        ...row,
        kind: row.key && row.key.startsWith("@") ? "unattributed" : "root",
        minutes: row.value,
        display_short: row.display,
      }));
    }
    const roots = periodStripChartSeries(report, rootsRaw, "roots", context && context.themeHueFor);
    const types = periodStripChartSeries(report, typesRaw, "types", context && context.themeHueFor);
    const zeroWorked = Boolean(hasCharts && roots.length === 0 && types.length === 0);
    const view = fallback ? "roots" : periodStripChartViewOf(requestedView);
    const switchable = Boolean(hasCharts && !zeroWorked && roots.length > 0 && types.length > 0);
    const shown = fallback ? ["roots"] : zeroWorked
      ? (view === "both" ? ["roots", "types"] : [view])
      : view === "both"
        ? [ ...(roots.length ? ["roots"] : []), ...(types.length ? ["types"] : []) ]
        : (view === "roots" ? (roots.length ? ["roots"] : []) : (types.length ? ["types"] : []));
    const rootByKey = new Map(roots.map((row) => [row.key, row]));
    const typeByKey = new Map(types.map((row) => [row.key, row]));
    let columns = periodStripChartColumns(report, kind, roots, types, fallback);
    const groups = Array.isArray(report && report.groups) ? report.groups : [];
    let collapsed = null;
    if (kind === "all" && !fallback) {
      const result = periodStripChartCollapseLeadingUntracked(columns, groups);
      columns = result.columns;
      collapsed = result.collapsed;
    }
    let fallbackColumns = [];
    if (kind === "year" && !fallback) {
      fallbackColumns = periodStripChartYearFallbackColumns(report, roots, types, fallback);
    }
    let tallest = 0;
    for (const column of columns) {
      const value = column && column.worked && typeof column.worked.value === "number" ? column.worked.value : 0;
      tallest = Math.max(tallest, value);
    }
    let fallbackTallest = 0;
    for (const column of fallbackColumns) {
      const value = column && column.worked && typeof column.worked.value === "number" ? column.worked.value : 0;
      fallbackTallest = Math.max(fallbackTallest, value);
    }
    const digest = periodStripChartsDigest(report);
    return {
      version: hasCharts ? rawCharts.version : 0,
      view,
      shown,
      switchable,
      fallback,
      zeroWorked,
      roots,
      types,
      columns,
      fallbackColumns,
      fallbackTallest,
      collapsed,
      groups,
      tallest,
      digest,
      policy: rawCharts && rawCharts.types && rawCharts.types.policy || "",
      limit: rawCharts && rawCharts.roots && rawCharts.roots.limit || null,
      ariaLabel: "Roots and types by child period",
      rootByKey,
      typeByKey,
    };
  } catch (error) {
    return { version: 0, view: "roots", shown: [], switchable: false, fallback: true, zeroWorked: false, roots: [], types: [], columns: [], groups: [], fallbackColumns: [], fallbackTallest: 0, collapsed: null, tallest: 0, digest: "0:error", policy: "", limit: null };
  }
}
