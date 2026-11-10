// Render the two period charts and their shared child-period axis. Each
// chart row uses the same CSS grid columns; the axis owns the one focus stop
// for each child period and opens Stats over that whole child span.
const PERIOD_STRIP_CHART_BOTH_HEIGHT = 44;
const PERIOD_STRIP_CHART_SINGLE_HEIGHT = 62;

function periodStripChartLegendTitle(doc, dimension, series, model, handlers) {
  const isRoots = dimension === "roots";
  const heading = isRoots ? "ROOTS" : "TYPES";
  const panel = isRoots ? "homes" : "themes";
  const node = statsEl(doc, "span", {
    class: "bob-period-strip-chart-title bob-period-strip-mix",
    role: "link",
    tabindex: "0",
    title: (isRoots ? "Open Stats roots" : "Open Stats types"),
    "aria-label": "Open Stats " + (isRoots ? "root parents" : "types"),
  });
  if (!node) return null;
  node.appendChild(statsEl(doc, "span", { class: "bob-period-strip-chart-heading" }, heading));
  const legend = statsEl(doc, "span", { class: "bob-period-strip-chart-legend" });
  const symbol = isRoots ? "●" : "■";
  for (const entry of series || []) {
    const item = statsEl(doc, "span", {
      class: "bob-period-strip-legend-item bob-period-strip-chart-legend-item",
      title: periodStripChartLegendTitleText(entry),
      "data-key": entry.key,
      "data-display": entry.display,
      "data-display-short": entry.displayShort,
    });
    const markClass = entry.fill === "hatch"
      ? "bob-period-strip-legend-swatch bob-period-strip-series-hatch"
      : entry.fill === "rest"
        ? "bob-period-strip-legend-dot bob-period-strip-series-rest-mark"
        : isRoots
          ? "bob-period-strip-legend-dot bob-day-strip-hue-" + (entry.hue || "gray")
          : "bob-period-strip-legend-swatch bob-day-strip-theme-hue-" + (entry.hue || "gray");
    const mark = statsEl(doc, "span", { class: markClass, "aria-hidden": "true" });
    if (mark && !isRoots && entry.shade) mark.setAttribute("data-shade", String(entry.shade));
    if (mark && entry.key) mark.setAttribute("data-key", entry.key);
    item.appendChild(mark);
    item.appendChild(statsEl(doc, "span", { class: "bob-period-strip-legend-label" }, entry.label));
    item.appendChild(statsEl(doc, "span", {
      class: "bob-period-strip-legend-value",
      "data-display": entry.display,
      "data-display-short": entry.displayShort,
    }, entry.display));
    const dimKey = entry.key;
    const dimFrame = () => {
      try {
        const frame = node.closest ? node.closest(".bob-period-strip-charts") : null;
        if (!frame || !frame.querySelectorAll) return;
        const pieces = frame.querySelectorAll('.bob-period-strip-column-piece[data-key="' + dimKey + '"]');
        const all = frame.querySelectorAll('[data-chart-row="' + dimension + '"] .bob-period-strip-column-piece');
        for (const piece of all) {
          let match = false;
          for (const candidate of pieces) {
            if (candidate === piece) { match = true; break; }
          }
          if (piece.style) piece.style.opacity = match ? "" : "0.35";
        }
      } catch (error) {}
    };
    const undim = () => {
      try {
        const frame = node.closest ? node.closest(".bob-period-strip-charts") : null;
        if (!frame || !frame.querySelectorAll) return;
        for (const piece of frame.querySelectorAll('[data-chart-row="' + dimension + '"] .bob-period-strip-column-piece')) {
          if (piece.style) piece.style.opacity = "";
        }
      } catch (error) {}
    };
    if (item.addEventListener) {
      item.addEventListener("mouseenter", dimKey ? dimFrame : () => {});
      item.addEventListener("mouseleave", undim);
      item.addEventListener("focus", dimKey ? dimFrame : () => {});
      item.addEventListener("blur", undim);
    }
    legend.appendChild(item);
  }
  node.appendChild(legend);
  const activate = (event) => {
    if (event && event.key && event.key !== "Enter" && event.key !== " ") return;
    if (event && event.preventDefault) event.preventDefault();
    if (handlers && typeof handlers.openStats === "function") handlers.openStats({ metric: "worked", panel });
  };
  node.addEventListener("click", activate);
  node.addEventListener("keydown", activate);
  return node;
}

function periodStripChartLegendTitleText(entry) {
  const lines = [entry.label + " · " + entry.display];
  if (entry.displayShort && entry.displayShort !== entry.display) lines.push("Compact: " + entry.displayShort);
  for (const member of entry.members || []) {
    if (!member || typeof member !== "object") continue;
    const label = typeof member.label === "string" && member.label ? member.label : member.key;
    if (label) lines.push(label + " · " + (member.display || periodStripFormatMinutes(member.minutes)));
  }
  return lines.join("\n");
}

function periodStripChartPieceClass(entry, dimension, isTop) {
  let fill = "";
  if (entry.fill === "hatch") fill = " bob-period-strip-series-hatch";
  else if (entry.fill === "rest") fill = " bob-period-strip-series-rest";
  else if (dimension === "roots") fill = " bob-day-strip-hue-" + (entry.hue || "gray");
  else fill = " bob-day-strip-theme-hue-" + (entry.hue || "gray");
  return "bob-period-strip-column-piece" + (isTop ? " bob-period-strip-column-piece-top" : " bob-period-strip-column-piece-seamed") + fill;
}

function periodStripRenderChartPlot(doc, column, index, dimension, model, tallestOverride) {
  const charts = model.charts || {};
  const entries = dimension === "roots" ? column.roots : column.types;
  const plot = statsEl(doc, "span", {
    class: "bob-period-strip-chart-plot bob-period-strip-chart-plot-" + dimension
      + (column.missing ? " bob-period-strip-column-missing" : "")
      + (column.state === "future" ? " bob-period-strip-column-future" : "")
      + (column.ghost ? " bob-period-strip-column-ghost" : ""),
    "data-column-index": String(index),
    "data-chart-dimension": dimension,
    "data-key": column.ghost ? "__ghost__" : (column.id || ""),
    "aria-hidden": "true",
  });
  const bar = statsEl(doc, "span", { class: "bob-period-strip-column-bar" });
  if (!plot || !bar) return plot;
  const viewHeight = charts.view === "both" ? PERIOD_STRIP_CHART_BOTH_HEIGHT : PERIOD_STRIP_CHART_SINGLE_HEIGHT;
  try { bar.style.height = viewHeight + "px"; } catch (error) {}
  if (column.ghost) {
    const ghost = statsEl(doc, "span", { class: "bob-period-strip-chart-ghost-bar", "aria-hidden": "true" });
    if (ghost && ghost.style) {
      try { ghost.style.height = Math.round(viewHeight * 0.35) + "px"; } catch (error) {}
    }
    if (ghost) bar.appendChild(ghost);
    plot.appendChild(bar);
    return plot;
  }
  const tallest = Number(tallestOverride !== undefined ? tallestOverride : charts.tallest) || 0;
  const visible = (entries || []).map((entry) => ({
    entry,
    height: tallest > 0 ? (Number(entry.minutes) / tallest) * viewHeight : 0,
  })).filter((item) => item.height >= 0.75);
  if (!visible.length && column.missing && column.state !== "future" && !charts.zeroWorked) {
    const ghost = statsEl(doc, "span", { class: "bob-period-strip-chart-ghost-bar", "aria-hidden": "true" });
    if (ghost && ghost.style) {
      try { ghost.style.height = Math.round(viewHeight * 0.35) + "px"; } catch (error) {}
    }
    if (ghost) bar.appendChild(ghost);
    plot.appendChild(bar);
    return plot;
  }
  visible.forEach((item, visibleIndex) => {
    const entry = item.entry;
    const piece = statsEl(doc, "span", {
      class: periodStripChartPieceClass(entry, dimension, visibleIndex === visible.length - 1),
      "data-key": entry.key,
      "data-minutes": String(entry.minutes),
    });
    if (piece && piece.style) piece.style.height = item.height + "px";
    if (piece && entry.shade && dimension === "types") piece.setAttribute("data-shade", String(entry.shade));
    if (piece && typeof bar.appendChild === "function") bar.appendChild(piece);
  });
  if (charts.zeroWorked) bar.appendChild(statsEl(doc, "span", { class: "bob-period-strip-chart-zero-stub" }));
  if (column.state === "future") bar.appendChild(statsEl(doc, "span", { class: "bob-period-strip-chart-future-stub" }));
  plot.appendChild(bar);
  return plot;
}

function periodStripRenderChartRow(doc, model, dimension, columnsOverride, tallestOverride) {
  const columns = Array.isArray(columnsOverride) ? columnsOverride : (model.charts && Array.isArray(model.charts.columns) ? model.charts.columns : []);
  const fadeList = model.charts && Array.isArray(model.charts.fade) ? model.charts.fade : null;
  const shouldFade = Array.isArray(fadeList) ? fadeList.includes(dimension) : false;
  const row = statsEl(doc, "div", {
    class: "bob-period-strip-chart-row" + (shouldFade ? " bob-period-strip-chart-fade" : ""),
    "data-chart-row": dimension,
    role: "presentation",
  });
  if (row && row.style) row.style.gridTemplateColumns = "repeat(" + Math.max(1, columns.length) + ", minmax(0, 1fr))";
  columns.forEach((column, index) => row.appendChild(periodStripRenderChartPlot(doc, column, index, dimension, model, tallestOverride)));
  return row;
}

function periodStripRenderChartTicks(doc, model, columnsOverride) {
  const columns = Array.isArray(columnsOverride) ? columnsOverride : (model.charts && Array.isArray(model.charts.columns) ? model.charts.columns : []);
  if (!columns.some((column) => column.tick)) return null;
  const row = statsEl(doc, "div", { class: "bob-period-strip-chart-ticks", "aria-hidden": "true" });
  if (row && row.style) row.style.gridTemplateColumns = "repeat(" + Math.max(1, columns.length) + ", minmax(0, 1fr))";
  columns.forEach((column) => {
    const cell = statsEl(doc, "span", { class: "bob-period-strip-chart-tick" });
    if (column.tick) {
      cell.appendChild(statsEl(doc, "span", { class: "bob-period-strip-column-tick-rule" }));
      cell.appendChild(statsEl(doc, "span", {}, column.tick));
    }
    row.appendChild(cell);
  });
  return row;
}

function periodStripChartGroupCaption(group, kind, lookupColumns) {
  if (!group || typeof group !== "object") return "";
  const label = typeof group.label === "string" ? group.label : String(group.key || "");
  if (kind !== "year") return label;
  const key = String(group.key || "");
  let short = "";
  for (const list of (Array.isArray(lookupColumns) ? lookupColumns : [])) {
    for (const column of (Array.isArray(list) ? list : [])) {
      if (!column || typeof column !== "object") continue;
      const columnLabel = typeof column.label === "string" ? column.label : "";
      const columnId = typeof column.id === "string" ? column.id : "";
      const matches = columnLabel === key || columnLabel === label || columnId === key
        || /Q([1-4])/.exec(columnLabel || "")?.[0] === key || /Q([1-4])/.exec(columnId || "")?.[0] === key;
      if (matches && column.worked && typeof column.worked.displayShort === "string" && column.worked.displayShort && column.worked.displayShort !== "–") {
        short = column.worked.displayShort;
        break;
      }
    }
    if (short) break;
  }
  if (short) return label + " · " + short;
  const worked = typeof group.worked_display === "string" ? group.worked_display : "";
  return worked && worked !== "–" ? label + " · " + worked : label;
}

function periodStripRenderChartGroups(doc, model, columnsOverride) {
  if (model.kind !== "year" && model.kind !== "all") return null;
  const charts = model.charts || {};
  const columns = Array.isArray(columnsOverride) ? columnsOverride : (Array.isArray(charts.columns) ? charts.columns : []);
  const groups = Array.isArray(charts.groups) ? charts.groups : [];
  const row = statsEl(doc, "div", { class: "bob-period-strip-chart-groups", "aria-hidden": "true" });
  if (row && row.style) row.style.gridTemplateColumns = "repeat(" + Math.max(1, columns.length) + ", minmax(0, 1fr))";
  let cursor = 0;
  for (const group of groups) {
    const key = String(group && group.key || "");
    const count = columns.filter((column) => String(column.group || "") === key).length;
    if (!count) continue;
    const caption = statsEl(doc, "span", { class: "bob-period-strip-group-caption", "data-group": key }, periodStripChartGroupCaption(group, model.kind, [charts.fallbackColumns, charts.columns, columns]));
    if (caption && caption.style) caption.style.gridColumn = (cursor + 1) + " / span " + count;
    row.appendChild(caption);
    cursor += count;
  }
  return row;
}

function periodStripChartColumnAria(column, charts) {
  const display = column.worked && column.worked.display ? column.worked.display : "–";
  const lines = [column.label + ": Worked " + display + (column.state === "current" ? " so far" : "")];
  const add = (title, rows) => (rows || []).forEach((row) => lines.push(title + ", " + row.label + " " + periodStripFormatMinutes(row.minutes)));
  add("Roots", column.roots);
  if (!charts.fallback) add("Types", column.types);
  if (column.mark) lines.push(periodStripColumnReviewWords(column.mark, column.state));
  if (column.missing) lines.push("Not tracked");
  return lines.filter(Boolean).join(". ") + ".";
}

function periodStripRenderChartAxisColumn(doc, column, index, model, handlers, axisNodes, plotRows) {
  const state = column.state || "closed";
  if (column.ghost) {
    const ghost = statsEl(doc, "span", {
      class: "bob-period-strip-column bob-period-strip-chart-axis-column bob-period-strip-chart-ghost-column",
      role: "presentation",
      "aria-label": column.label,
      title: column.tooltip || null,
      "data-column-state": "ghost",
    });
    if (ghost) {
      ghost.appendChild(statsEl(doc, "span", { class: "bob-period-strip-column-mark", "aria-hidden": "true" }, ""));
      ghost.appendChild(statsEl(doc, "span", { class: "bob-period-strip-column-caption" }, ""));
      ghost.appendChild(statsEl(doc, "span", { class: "bob-period-strip-column-value bob-period-strip-ghost-label" }, column.label));
    }
    return ghost;
  }
  const node = statsEl(doc, "span", {
    class: "bob-period-strip-column bob-period-strip-chart-axis-column"
      + (column.missing ? " bob-period-strip-column-missing" : "")
      + (state === "future" ? " bob-period-strip-column-future" : "")
      + (state === "current" ? " bob-period-strip-column-current" : ""),
    role: "link",
    tabindex: index === 0 ? "0" : "-1",
    title: column.tooltip || null,
    "aria-label": periodStripChartColumnAria(column, model.charts || {}),
    "data-period-strip-column": column.id || "",
    "data-column-index": String(index),
    "data-column-state": state,
  });
  const markText = state === "future" ? "" : periodStripCloseoutGlyph(column.mark);
  node.appendChild(statsEl(doc, "span", {
    class: "bob-period-strip-column-mark" + ((column.mark === "drafted" || column.mark === "edited") ? " bob-period-strip-column-mark-draft" : ""),
    "data-mark": column.mark || "none",
    "aria-hidden": "true",
  }, markText));
  const isYearWeekly = model.kind === "year" && column.kind !== "quarter";
  const caption = isYearWeekly ? "" : ((column.caption || "") + (state === "current" ? " · so far" : "") + (column.partial ? " · " + column.partial : ""));
  node.appendChild(statsEl(doc, "span", { class: "bob-period-strip-column-caption" }, caption));
  if (!isYearWeekly) {
    const compact = model.kind === "quarter" || model.kind === "all" || (model.kind === "year" && column.kind === "quarter");
    const value = column.worked ? (compact ? column.worked.displayShort : column.worked.display) : (state === "future" ? "" : "–");
    node.appendChild(statsEl(doc, "span", { class: "bob-period-strip-column-value" }, value));
  }
  const activate = (newLeaf, alt) => {
    if (alt) {
      if (handlers && typeof handlers.openStatsForColumn === "function") handlers.openStatsForColumn(column, newLeaf);
      return;
    }
    if (handlers && typeof handlers.openColumn === "function") handlers.openColumn(column, newLeaf);
  };
  periodStripPartsActivate(node, activate);
  const setActive = (active) => {
    for (const row of plotRows) {
      const plot = row[index];
      if (plot && plot.setAttribute) plot.setAttribute("data-active", active ? "true" : "false");
    }
    if (node.setAttribute) node.setAttribute("data-active", active ? "true" : "false");
  };
  node.addEventListener("mouseenter", () => setActive(true));
  node.addEventListener("mouseleave", () => setActive(false));
  node.addEventListener("focus", () => setActive(true));
  node.addEventListener("blur", () => setActive(false));
  axisNodes.push(node);
  return node;
}

function periodStripRenderChartAxis(doc, model, handlers, plotRows, columnsOverride) {
  const columns = Array.isArray(columnsOverride) ? columnsOverride : (model.charts && Array.isArray(model.charts.columns) ? model.charts.columns : []);
  const row = statsEl(doc, "div", { class: "bob-period-strip-chart-axis", role: "group", "aria-label": "Child periods" });
  if (row && row.style) row.style.gridTemplateColumns = "repeat(" + Math.max(1, columns.length) + ", minmax(0, 1fr))";
  const axisNodes = [];
  columns.forEach((column, index) => {
    const cell = periodStripRenderChartAxisColumn(doc, column, index, model, handlers, axisNodes, plotRows);
    if (cell) row.appendChild(cell);
  });
  if (row && row.addEventListener) {
    row.addEventListener("keydown", (event) => {
      const current = axisNodes.indexOf(event && event.target);
      if (current < 0) return;
      let next = -1;
      if (event.key === "ArrowRight") next = Math.min(axisNodes.length - 1, current + 1);
      else if (event.key === "ArrowLeft") next = Math.max(0, current - 1);
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = axisNodes.length - 1;
      else return;
      if (event.preventDefault) event.preventDefault();
      axisNodes.forEach((node) => node.setAttribute("tabindex", "-1"));
      axisNodes[next].setAttribute("tabindex", "0");
      if (axisNodes[next].focus) axisNodes[next].focus();
    });
  }
  return row;
}

function periodStripRenderChartSwitch(doc, model, handlers) {
  const charts = model.charts || {};
  if (!charts.switchable) return null;
  const next = periodStripNextChartView(charts.view);
  const labels = { both: "Both", roots: "Roots", types: "Types" };
  const node = statsEl(doc, "span", {
    class: "bob-day-strip-lanes bob-period-strip-chart-switch",
    role: "button",
    tabindex: "0",
    "data-view": charts.view,
    "aria-label": "Period stats charts: " + labels[charts.view] + ". Activate for " + labels[next] + ".",
    title: "Showing " + labels[charts.view] + " · click for " + labels[next],
  });
  const roots = statsEl(doc, "span", { class: "bob-day-strip-lanes-mark bob-day-strip-lanes-mark-roots", "aria-hidden": "true" });
  roots.setAttribute("data-on", charts.view === "both" || charts.view === "roots" ? "true" : "false");
  const types = statsEl(doc, "span", { class: "bob-day-strip-lanes-mark bob-day-strip-lanes-mark-themes", "aria-hidden": "true" });
  types.setAttribute("data-on", charts.view === "both" || charts.view === "types" ? "true" : "false");
  node.appendChild(roots);
  node.appendChild(types);
  const activate = (event) => {
    if (event && event.key && event.key !== "Enter" && event.key !== " ") return;
    if (event && event.preventDefault) event.preventDefault();
    if (handlers && typeof handlers.cycleCharts === "function") handlers.cycleCharts({ focused: true });
  };
  node.addEventListener("mousedown", (event) => { if (event && event.preventDefault) event.preventDefault(); });
  node.addEventListener("click", activate);
  node.addEventListener("keydown", activate);
  return node;
}

function periodStripRenderChartFrameInner(doc, model, handlers, columns, tallest, variant) {
  const charts = model.charts || {};
  const shown = Array.isArray(charts.shown) ? charts.shown : [];
  const inner = statsEl(doc, "div", {
    class: "bob-period-strip-charts-inner bob-period-strip-charts-" + (variant || "detailed"),
    "data-variant": variant || "detailed",
  });
  if (!inner) return null;
  if (charts.fallback) inner.appendChild(statsEl(doc, "div", { class: "bob-period-strip-chart-update-note" }, "Update bob for the Types chart."));
  if (charts.zeroWorked) inner.appendChild(statsEl(doc, "div", { class: "bob-period-strip-chart-zero-note" }, "No Worked time in this period."));
  const plotRows = [];
  for (const dimension of shown) {
    if (!charts.zeroWorked) {
      const series = dimension === "roots" ? charts.roots : charts.types;
      const title = periodStripChartLegendTitle(doc, dimension, series, model, handlers || {});
      if (title) inner.appendChild(title);
      if (dimension === shown[0]) {
        const ticks = periodStripRenderChartTicks(doc, model, columns);
        if (ticks) inner.appendChild(ticks);
      }
    }
    const row = periodStripRenderChartRow(doc, model, dimension, columns, tallest);
    plotRows.push(Array.from(row.children || []));
    inner.appendChild(row);
  }
  const groups = periodStripRenderChartGroups(doc, model, columns);
  if (groups) inner.appendChild(groups);
  const axis = periodStripRenderChartAxis(doc, model, handlers || {}, plotRows, columns);
  if (axis) inner.appendChild(axis);
  if (charts.fallback && !charts.roots.length) inner.appendChild(statsEl(doc, "div", { class: "bob-period-strip-chart-zero-note" }, "No root detail is available from this bob."));
  return { inner, plotRows };
}

function periodStripRenderChartFrame(doc, model, handlers) {
  const charts = model.charts || {};
  const frame = statsEl(doc, "div", {
    class: "bob-period-strip-charts" + (charts.fallback ? " bob-period-strip-charts-legacy" : "")
      + (model.kind === "year" && Array.isArray(charts.fallbackColumns) && charts.fallbackColumns.length ? " bob-period-strip-charts-year" : "")
      + (charts.collapsed ? " bob-period-strip-charts-collapsed" : ""),
    "data-view": charts.view || "both",
    "data-charts-version": String(charts.version || 0),
  });
  const columns = Array.isArray(charts.columns) ? charts.columns : [];
  if (model.kind === "year" && Array.isArray(charts.fallbackColumns) && charts.fallbackColumns.length) {
    const detailed = periodStripRenderChartFrameInner(doc, model, handlers || {}, columns, charts.tallest, "detailed");
    if (detailed && detailed.inner) frame.appendChild(detailed.inner);
    const fallbackTallest = Number(charts.fallbackTallest) || 0;
    const fallbackModel = { ...model, charts: { ...charts, columns: charts.fallbackColumns, tallest: fallbackTallest } };
    const fallback = periodStripRenderChartFrameInner(doc, fallbackModel, handlers || {}, charts.fallbackColumns, fallbackTallest, "fallback");
    if (fallback && fallback.inner) frame.appendChild(fallback.inner);
  } else {
    const single = periodStripRenderChartFrameInner(doc, model, handlers || {}, columns, charts.tallest, "detailed");
    if (single && single.inner) {
      const kids = Array.from(single.inner.children || []);
      for (const kid of kids) frame.appendChild(kid);
    }
  }
  return frame;
}

// Legend fit ladder: one line with full values, then compact values
// (`display_short`), then wrap to at most two lines. A drawn series never
// hides behind `+N`. Never throws and never hides a series.
function periodStripLegendFitDecision(input) {
  try {
    const safe = input && typeof input === "object" ? input : {};
    const available = Number(safe.available);
    const full = Number(safe.full);
    if (!Number.isFinite(available) || available <= 0) return "full";
    if (!Number.isFinite(full) || full <= 0) return "full";
    if (full <= available + 0.5) return "full";
    return "short";
  } catch (error) {
    return "full";
  }
}

function periodStripChartLegendValueNodes(legend) {
  let values = [];
  try {
    if (legend && typeof legend.querySelectorAll === "function") {
      values = Array.from(legend.querySelectorAll(".bob-period-strip-legend-value"));
    }
  } catch (error) {
    values = [];
  }
  if (!values.length && typeof dayStripFitFindByClass === "function") {
    try {
      values = dayStripFitFindByClass(legend, "bob-period-strip-legend-value");
    } catch (error) {
      values = [];
    }
  }
  return values;
}

function periodStripChartApplyLegendFit(legend) {
  try {
    if (!legend || typeof legend !== "object") return null;
    const values = periodStripChartLegendValueNodes(legend);
    if (!values.length) return null;
    for (const node of values) {
      try {
        const full = node.getAttribute ? node.getAttribute("data-display") : null;
        if (full !== null && full !== undefined) node.textContent = String(full);
      } catch (error) {
        // Best-effort.
      }
    }
    let available = Number(legend.clientWidth) || 0;
    try {
      if (!available && typeof legend.getBoundingClientRect === "function") {
        const rect = legend.getBoundingClientRect();
        if (rect && Number.isFinite(rect.width) && rect.width > 0) available = rect.width;
      }
    } catch (error) {
      // Best-effort.
    }
    let wrapped = false;
    try {
      const scroll = Number(legend.scrollWidth) || 0;
      if (available > 0 && scroll > available + 0.5) wrapped = true;
    } catch (error) {
      // Best-effort.
    }
    if (!wrapped) {
      try {
        const legendRect = typeof legend.getBoundingClientRect === "function" ? legend.getBoundingClientRect() : null;
        const legendHeight = legendRect && Number.isFinite(legendRect.height) ? legendRect.height : 0;
        let itemHeight = 0;
        try {
          const first = typeof legend.querySelector === "function" ? legend.querySelector(".bob-period-strip-chart-legend-item") : null;
          const itemRect = first && typeof first.getBoundingClientRect === "function" ? first.getBoundingClientRect() : null;
          itemHeight = itemRect && Number.isFinite(itemRect.height) ? itemRect.height : 0;
        } catch (error) {
          itemHeight = 0;
        }
        if (legendHeight > 0 && itemHeight > 0 && legendHeight > itemHeight * 1.6) wrapped = true;
      } catch (error) {
        // Best-effort.
      }
    }
    if (!wrapped) return "full";
    const decision = "short";
    if (decision === "short") {
      for (const node of values) {
        try {
          const short = node.getAttribute ? node.getAttribute("data-display-short") : null;
          if (short !== null && short !== undefined) node.textContent = String(short);
        } catch (error) {
          // Best-effort.
        }
      }
    }
    return decision;
  } catch (error) {
    return null;
  }
}

function periodStripChartFitLegends(rootEl) {
  try {
    if (!rootEl || typeof rootEl !== "object") return null;
    let legends = [];
    try {
      if (typeof rootEl.querySelectorAll === "function") {
        legends = Array.from(rootEl.querySelectorAll(".bob-period-strip-chart-legend"));
      }
    } catch (error) {
      legends = [];
    }
    if (!legends.length && typeof dayStripFitFindByClass === "function") {
      try {
        legends = dayStripFitFindByClass(rootEl, "bob-period-strip-chart-legend");
      } catch (error) {
        legends = [];
      }
    }
    let last = null;
    for (const legend of legends) {
      try {
        last = periodStripChartApplyLegendFit(legend);
      } catch (error) {
        // One legend never breaks the others.
      }
    }
    return last;
  } catch (error) {
    return null;
  }
}

// Idempotent: one observer per strip element. Reuses the Day strip's observer
// and view helpers rather than adding a second observer pattern.
function periodStripEnsureLegendFitObserver(el) {
  try {
    if (!el || typeof el !== "object") return null;
    if (el.__periodStripLegendFitObserver) return el.__periodStripLegendFitObserver;
    const Observer = typeof dayStripFitObserverOf === "function" ? dayStripFitObserverOf(el) : null;
    if (typeof Observer !== "function") return null;
    const observer = new Observer(() => {
      try {
        if (typeof periodStripChartFitLegends === "function") periodStripChartFitLegends(el);
      } catch (error) {
        // Never throw into the observer lifecycle.
      }
    });
    el.__periodStripLegendFitObserver = observer;
    try {
      if (typeof observer.observe === "function") observer.observe(el);
    } catch (error) {
      // Best-effort.
    }
    return observer;
  } catch (error) {
    return null;
  }
}

// Replaces the retired single-lane painter. Bob remains the only source of
// facts, series values, and stacks; the plugin only paints those values.
function paintPeriodStrip(host, model, handlers) {
  try {
    if (!host || !model) return null;
    const doc = host.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return null;
    while (host.firstChild) host.removeChild(host.firstChild);
    const kind = model.kind || "week";
    const root = statsEl(doc, "div", {
      class: "bob-period-strip bob-period-strip-kind-" + kind + " bob-period-strip-state-" + model.state,
      "aria-label": model.ariaLabel || (periodStripKindTitle(kind) + " stats for " + (model.periodId || "period")),
    });
    host.appendChild(root);
    if (model.state === "hidden") return root;
    if (model.state === "future") {
      root.appendChild(statsEl(doc, "div", { class: "bob-period-strip-future" }, "Starts " + periodStripFutureWords(model)));
      return root;
    }
    if (model.state === "older-bob") {
      root.appendChild(statsEl(doc, "div", { class: "bob-period-strip-note" }, "Period stats need a newer bob (bob periods not found)."));
      return root;
    }
    if (model.state === "unavailable") {
      const error = model.error || {};
      root.appendChild(statsEl(doc, "div", { class: "bob-period-strip-note" }, "Period stats unavailable — " + (error.title || "bob periods failed") + "."));
      const retry = periodStripLink(doc, "bob-period-strip-retry", "Retry period stats", error.hint || "Retry");
      retry.appendChild(statsEl(doc, "span", {}, "Retry"));
      periodStripActivate(retry, () => { if (handlers && typeof handlers.retry === "function") handlers.retry(); });
      root.appendChild(retry);
      return root;
    }
    const facts = statsEl(doc, "div", { class: "bob-period-strip-facts" });
    for (const fact of model.facts || []) facts.appendChild(periodStripRenderFact(doc, fact, model, handlers || {}));
    root.appendChild(facts);
    const rule = statsEl(doc, "div", { class: "bob-period-strip-rule-row" });
    rule.appendChild(statsEl(doc, "span", { class: "bob-period-strip-rule" }, ""));
    if (model.metaText) rule.appendChild(statsEl(doc, "span", { class: "bob-period-strip-meta" }, model.metaText));
    if (model.stale) rule.appendChild(statsEl(doc, "span", { class: "bob-period-strip-stale", title: model.staleTitle || "Refresh failed" }, "refresh failed"));
    const chartSwitch = periodStripRenderChartSwitch(doc, model, handlers || {});
    if (chartSwitch) rule.appendChild(chartSwitch);
    root.appendChild(rule);
    const chartFrame = periodStripRenderChartFrame(doc, model, handlers || {});
    root.appendChild(chartFrame);
    try {
      if (typeof periodStripChartFitLegends === "function") periodStripChartFitLegends(root);
    } catch (error) {
      // Fit is best-effort.
    }
    try {
      if (typeof periodStripEnsureLegendFitObserver === "function") periodStripEnsureLegendFitObserver(host);
    } catch (error) {
      // Observer is best-effort.
    }
    return root;
  } catch (error) {
    return null;
  }
}
