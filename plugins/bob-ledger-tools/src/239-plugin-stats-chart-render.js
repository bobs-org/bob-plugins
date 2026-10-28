// Accessible focus chart renderer and session-only interaction for Stats.
let statsChartSerial = 0;

function statsSvgEl(doc, tag, attrs, text) {
  if (!doc || typeof doc.createElementNS !== "function") {
    return null;
  }
  const node = doc.createElementNS(STATS_SVG_NS, tag);
  if (!node) {
    return null;
  }
  for (const [name, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) {
      continue;
    }
    node.setAttribute(name, String(value));
  }
  if (text !== undefined && text !== null) {
    node.textContent = String(text);
  }
  return node;
}

function statsChartMetricColor(metric) {
  const known = ["orange", "violet", "green", "blue", "gray"];
  return known.includes(metric && metric.color) ? metric.color : "gray";
}

function statsChartDailyPoints(metric, report) {
  const safe = metric && typeof metric === "object" ? metric : {};
  const group = (safe.chart && safe.chart.group) || (report && report.range && report.range.group);
  if (group === "day" || !group) {
    return Array.isArray(safe.points) ? safe.points : [];
  }
  return Array.isArray(safe.daily_points) ? safe.daily_points : [];
}

function statsChartPointKey(point) {
  const safe = point && typeof point === "object" ? point : {};
  return String(safe.date || "") + ":" + String(safe.end || safe.date || "");
}

function statsChartPointForDate(points, date) {
  return (Array.isArray(points) ? points : []).find((point) => point && point.date === date) || null;
}

function statsChartValidDay(date) {
  return statsIsoOrdinal(date) !== null;
}

function statsChartParts(point, report) {
  const safe = point && typeof point === "object" ? point : {};
  const parts = safe.parts && typeof safe.parts === "object" ? safe.parts : {};
  const displays = safe.parts_display && typeof safe.parts_display === "object" ? safe.parts_display : {};
  const result = [];
  for (const [dimension, values] of Object.entries(parts)) {
    if (!values || typeof values !== "object") {
      continue;
    }
    const ranked = Object.entries(values)
      .filter(([, value]) => statsFinite(value))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3);
    for (const [key, value] of ranked) {
      const shown = displays[dimension] && typeof displays[dimension][key] === "string"
        ? displays[dimension][key]
        : String(value);
      const label = ["area", "project"].includes(dimension)
        ? statsPanelHomeLabel(report, dimension, key)
        : key;
      result.push(dimension + ": " + label + " · " + shown);
    }
  }
  return result;
}

function statsChartQualityText(point) {
  const safe = point && typeof point === "object" ? point : {};
  if (safe.quality && safe.quality !== "ok") {
    return String(safe.quality) + (safe.reason ? " — " + safe.reason : "");
  }
  return safe.reason ? String(safe.reason) : "";
}

function statsChartClearChildren(node) {
  if (!node) {
    return;
  }
  if (typeof node.replaceChildren === "function") {
    node.replaceChildren();
  } else if (Array.isArray(node.children)) {
    node.children.length = 0;
    node.textContent = "";
  } else {
    node.textContent = "";
  }
}

function statsChartFindFocus(root, key) {
  if (!root || !key) {
    return null;
  }
  const pending = [root];
  while (pending.length) {
    const node = pending.pop();
    try {
      if (node.getAttribute && node.getAttribute("data-stats-focus-key") === key) {
        return node;
      }
      const children = node.children || node.childNodes || [];
      for (let index = 0; index < children.length; index += 1) {
        pending.push(children[index]);
      }
    } catch (error) {
      // A detached or non-DOM node is skipped.
    }
  }
  return null;
}

function statsChartActiveFocusKey(el) {
  try {
    const doc = statsDocFor(el);
    const active = doc && doc.activeElement;
    return active && active.getAttribute ? active.getAttribute("data-stats-focus-key") : null;
  } catch (error) {
    return null;
  }
}

function statsChartRestoreFocus(el, key) {
  const node = statsChartFindFocus(el, key);
  if (node && typeof node.focus === "function") {
    try {
      node.focus();
    } catch (error) {
      // Focus restoration is best-effort in embedded/fake documents.
    }
  }
}

class BobLedgerToolsStatsChartMixin {
  statsRenderLocally(view, focusKey) {
    if (!view || !view.report) {
      return;
    }
    const key = focusKey || statsChartActiveFocusKey(view.el);
    this.renderStatsResult(view, { report: view.report, stale: false });
    statsChartRestoreFocus(view.el, key);
  }

  statsReleaseChartView(view) {
    if (!view) {
      return;
    }
    try {
      if (view.chartObserver && typeof view.chartObserver.disconnect === "function") {
        view.chartObserver.disconnect();
      }
    } catch (error) {
      // Resize observer cleanup is best-effort.
    }
    view.chartObserver = null;
    try {
      const clear = typeof window !== "undefined" && typeof window.clearTimeout === "function"
        ? window.clearTimeout.bind(window)
        : clearTimeout;
      if (view.chartResizeTimer !== null && view.chartResizeTimer !== undefined) {
        clear(view.chartResizeTimer);
      }
    } catch (error) {
      // Timer cleanup is best-effort.
    }
    view.chartResizeTimer = null;
    try {
      if (view.chartKeyboardRoot && view.chartKeyboardHandler && view.chartKeyboardRoot.removeEventListener) {
        view.chartKeyboardRoot.removeEventListener("keydown", view.chartKeyboardHandler);
      }
    } catch (error) {
      // Event cleanup is best-effort.
    }
    view.chartKeyboardRoot = null;
    view.chartKeyboardHandler = null;
    view.chartTooltip = null;
    view.chartDayDetail = null;
    view.chartLive = null;
    view.chartRoot = null;
    view.chartHitNodes = null;
    view.hoverBucket = null;
    try {
      if (view.statsLanesHost && typeof dayStripReleaseFitObserver === "function") {
        dayStripReleaseFitObserver(view.statsLanesHost);
      }
    } catch (error) {
      // Fit observer cleanup is best-effort.
    }
    view.statsLanesHost = null;
  }

  statsRegisterChartResize(view, target) {
    this.statsReleaseChartResize(view);
    if (!view || !target || typeof ResizeObserver !== "function") {
      return;
    }
    try {
      const observer = new ResizeObserver((entries) => {
        const entry = Array.isArray(entries) ? entries[0] : null;
        const width = entry && entry.contentRect ? entry.contentRect.width : 0;
        if (!statsFinite(width) || width <= 0 || Math.abs(width - (view.chartWidth || 0)) < 2) {
          return;
        }
        const set = typeof window !== "undefined" && typeof window.setTimeout === "function"
          ? window.setTimeout.bind(window)
          : setTimeout;
        const clear = typeof window !== "undefined" && typeof window.clearTimeout === "function"
          ? window.clearTimeout.bind(window)
          : clearTimeout;
        if (view.chartResizeTimer !== null && view.chartResizeTimer !== undefined) {
          clear(view.chartResizeTimer);
        }
        view.chartResizeTimer = set(() => {
          view.chartResizeTimer = null;
          view.chartWidth = width;
          this.statsRenderLocally(view);
        }, 100);
      });
      observer.observe(target);
      view.chartObserver = observer;
    } catch (error) {
      view.chartObserver = null;
    }
  }

  statsReleaseChartResize(view) {
    if (!view) {
      return;
    }
    try {
      if (view.chartObserver && typeof view.chartObserver.disconnect === "function") {
        view.chartObserver.disconnect();
      }
    } catch (error) {
      // Resize observer cleanup is best-effort.
    }
    view.chartObserver = null;
    try {
      const clear = typeof window !== "undefined" && typeof window.clearTimeout === "function"
        ? window.clearTimeout.bind(window)
        : clearTimeout;
      if (view.chartResizeTimer !== null && view.chartResizeTimer !== undefined) {
        clear(view.chartResizeTimer);
      }
    } catch (error) {
      // Timer cleanup is best-effort.
    }
    view.chartResizeTimer = null;
  }

  statsChartActivePoint(metric, report, state, bucket) {
    const points = statsChartDailyPoints(metric, report);
    if (state && state.pinnedDay && statsChartPointForDate(points, state.pinnedDay)) {
      return statsChartPointForDate(points, state.pinnedDay);
    }
    if (state && state.hoverDay && statsChartPointForDate(points, state.hoverDay)) {
      return statsChartPointForDate(points, state.hoverDay);
    }
    if (state && state.cursorDay && statsChartPointForDate(points, state.cursorDay)) {
      return statsChartPointForDate(points, state.cursorDay);
    }
    if (bucket && bucket.start && bucket.end) {
      const inBucket = points.filter((point) => point && point.date >= bucket.start && point.date <= bucket.end);
      if (inBucket.length) {
        return inBucket[0];
      }
    }
    return points.length ? points[points.length - 1] : null;
  }

  statsChartFocusKeyForDay(metric, report, date) {
    const points = Array.isArray(metric && metric.points) ? metric.points : [];
    const bucket = points.find((point) => point && point.date <= date && (point.end || point.date) >= date);
    if (bucket) return "chart:" + statsChartPointKey(bucket);
    const daily = statsChartPointForDate(statsChartDailyPoints(metric, report), date);
    return daily ? "chart:" + statsChartPointKey(daily) : "stats-root";
  }

  statsUpdateChartDayDetail(doc, view, report, metric, container) {
    const state = this.statsViewStateFor(view.sourcePath);
    const bucket = state.pinnedBucket || view.hoverBucket || null;
    const points = statsChartDailyPoints(metric, report);
    const point = this.statsChartActivePoint(metric, report, state, bucket);
    const grouped = ((metric.chart && metric.chart.group) || (report.range && report.range.group)) !== "day";
    statsChartClearChildren(container);
    container.appendChild(statsEl(doc, "div", { class: "bob-stats-day-title" }, "Day detail"));
    if (!points.length && grouped) {
      container.appendChild(statsEl(doc, "div", { class: "bob-stats-day-empty" },
        "Daily detail is unavailable for this grouped report schema. The chart and table keep the bucket values."));
      const unavailable = statsEl(doc, "button", { class: "bob-stats-chip", type: "button", disabled: true }, "Open daily note");
      container.appendChild(unavailable);
      return;
    }
    if (!point) {
      container.appendChild(statsEl(doc, "div", { class: "bob-stats-day-empty" }, "No day is available in this range."));
      container.appendChild(statsEl(doc, "button", { class: "bob-stats-chip", type: "button", disabled: true }, "Open daily note"));
      return;
    }
    if (grouped && bucket && bucket.start && bucket.end) {
      const options = points.filter((daily) => daily && daily.date >= bucket.start && daily.date <= bucket.end);
      if (options.length) {
        const label = statsEl(doc, "label", { class: "bob-stats-day-select-label" }, "Day in this bucket");
        const select = statsEl(doc, "select", {
          class: "bob-stats-day-select",
          "aria-label": "Day in this bucket",
          "data-stats-focus-key": "day-selector",
        });
        for (const daily of options) {
          const option = statsEl(doc, "option", { value: daily.date }, daily.date);
          if (daily.date === point.date) {
            option.setAttribute("selected", "selected");
          }
          select.appendChild(option);
        }
        select.value = point.date;
        select.addEventListener("change", () => {
          state.pinnedDay = select.value;
          state.cursorDay = select.value;
          state.pinnedBucket = bucket;
          this.statsRenderLocally(view, "day-selector");
        });
        label.appendChild(select);
        container.appendChild(label);
      }
    }
    const pointDisplay = typeof point.display === "string" && point.display ? point.display : "–";
    container.appendChild(statsEl(doc, "div", { class: "bob-stats-day-value" },
      point.date + " · " + metric.label + ": " + pointDisplay));
    const quality = statsChartQualityText(point);
    if (quality) {
      container.appendChild(statsEl(doc, "div", { class: "bob-stats-day-quality" }, quality));
    }
    const parts = statsChartParts(point, report);
    if (parts.length) {
      const list = statsEl(doc, "ul", { class: "bob-stats-day-parts", "aria-label": "Daily metric parts" });
      for (const part of parts.slice(0, 5)) {
        list.appendChild(statsEl(doc, "li", {}, part));
      }
      container.appendChild(list);
    }
    if (metric.id === "worked") {
      const sessions = (report.metrics || []).find((entry) => entry && entry.id === "sessions");
      const sessionPoint = sessions ? statsChartPointForDate(statsChartDailyPoints(sessions, report), point.date) : null;
      container.appendChild(statsEl(doc, "div", { class: "bob-stats-day-sessions" },
        "Sessions: " + (sessionPoint && sessionPoint.display ? sessionPoint.display : "unavailable")));
    }
    const valid = statsChartValidDay(point.date);
    const open = statsEl(doc, "button", {
      class: "bob-stats-chip",
      type: "button",
      disabled: !valid,
      "data-stats-focus-key": "open-daily-note",
    }, "Open daily note");
    open.addEventListener("click", (event) => this.statsOpenDailyNote(view, point.date, event));
    container.appendChild(open);
  }

  statsOpenDailyNote(view, date, event) {
    if (!statsChartValidDay(date)) {
      return false;
    }
    const report = view && view.report;
    const metric = report && (report.metrics || []).find((entry) => entry && entry.id === this.statsViewStateFor(view.sourcePath).focus);
    if (!metric || !statsChartPointForDate(statsChartDailyPoints(metric, report), date)) {
      return false;
    }
    const workspace = this.app && this.app.workspace;
    if (!workspace || typeof workspace.openLinkText !== "function") {
      return false;
    }
    const digits = date.replace(/-/g, "");
    const path = date.slice(0, 4) + "/" + digits + ".md";
    const newLeaf = Boolean(event && (event.ctrlKey || event.metaKey));
    workspace.openLinkText(path, view.sourcePath || "", newLeaf);
    return true;
  }

  statsChartDrawMetric(doc, view, report, metric) {
    const section = statsEl(doc, "section", {
      class: "bob-stats-chart-section bob-stats-hue-" + statsChartMetricColor(metric),
      "aria-label": metric.label + " focus chart",
    });
    const header = statsEl(doc, "div", { class: "bob-stats-chart-header" });
    header.appendChild(statsEl(doc, "div", { class: "bob-stats-chart-title" }, metric.label));
    const metrics = (report.metrics || []).filter((entry) => entry && typeof entry.id === "string");
    const currentId = this.statsViewStateFor(view.sourcePath).focus;
    const label = statsEl(doc, "label", { class: "bob-stats-focus-label" }, "Focus metric");
    const selector = statsEl(doc, "select", {
      class: "bob-stats-focus-select",
      "aria-label": "Focus metric",
      "data-stats-focus-key": "focus-selector",
    });
    for (const entry of metrics) {
      const option = statsEl(doc, "option", { value: entry.id }, entry.label || entry.id);
      if (entry.id === currentId) {
        option.setAttribute("selected", "selected");
      }
      selector.appendChild(option);
    }
    selector.value = currentId;
    selector.addEventListener("change", () => {
      const state = this.statsViewStateFor(view.sourcePath);
      state.focus = selector.value;
      state.hoverDay = null;
      this.statsRenderLocally(view, "focus-selector");
    });
    label.appendChild(selector);
    header.appendChild(label);
    const definitionButton = statsEl(doc, "button", {
      class: "bob-stats-chip bob-stats-definition-toggle",
      type: "button",
      "aria-expanded": this.statsViewStateFor(view.sourcePath).definitionOpen === true ? "true" : "false",
      "aria-controls": view.chartId + "-definition",
      "data-stats-focus-key": "definition-toggle",
    }, "Definition");
    definitionButton.addEventListener("click", () => {
      const state = this.statsViewStateFor(view.sourcePath);
      state.definitionOpen = !state.definitionOpen;
      this.statsRenderLocally(view, "definition-toggle");
    });
    header.appendChild(definitionButton);
    section.appendChild(header);

    const points = Array.isArray(metric.points) ? metric.points : [];
    const wrap = statsEl(doc, "div", { class: "bob-stats-chart-wrap", "data-stats-chart": "true" });
    if (points.length === 0) {
      wrap.appendChild(statsEl(doc, "div", { class: "bob-stats-chart-empty" }, "No chart points are available for this metric."));
      section.appendChild(wrap);
      this.statsRegisterChartResize(view, wrap);
      return section;
    }
    if (typeof doc.createElementNS !== "function") {
      wrap.appendChild(statsEl(doc, "div", { class: "bob-stats-chart-empty" }, "This document cannot render SVG charts."));
      section.appendChild(wrap);
      return section;
    }

    const width = Math.max(300, statsFinite(view.chartWidth) && view.chartWidth > 0 ? view.chartWidth : (wrap.clientWidth || 720));
    const height = width < 420 ? 228 : 280;
    const margin = { left: width < 420 ? 43 : 58, right: 12, top: 16, bottom: 38 };
    const plotWidth = Math.max(1, width - margin.left - margin.right);
    const plotHeight = Math.max(1, height - margin.top - margin.bottom);
    const values = [];
    for (const point of points) {
      if (point && statsFinite(point.value)) values.push(point.value);
      if (point && statsFinite(point.rolling_median)) values.push(point.rolling_median);
    }
    const band = metric.chart && typeof metric.chart === "object" ? metric.chart : {};
    const chartGroup = band.group || (report.range && report.range.group) || "day";
    const bandP25 = statsFinite(band.p25) ? band.p25 : (chartGroup === "day" && statsFinite(metric.summary && metric.summary.p25) ? metric.summary.p25 : null);
    const bandP75 = statsFinite(band.p75) ? band.p75 : (chartGroup === "day" && statsFinite(metric.summary && metric.summary.p75) ? metric.summary.p75 : null);
    if (statsFinite(bandP25)) values.push(bandP25);
    if (statsFinite(bandP75)) values.push(bandP75);
    const priorPoints = Array.isArray(metric.prior_points) ? metric.prior_points : [];
    for (const point of priorPoints) {
      if (point && statsFinite(point.value)) values.push(point.value);
    }
    const domain = statsChartDomain(values, metric.unit);
    const zeroY = statsChartY(0, domain, margin.top, plotHeight);
    const ticks = statsChartTicks(domain, metric.unit, width < 420 ? 3 : 5);
    const density = statsResponsiveLabelDensity(width, points.length);
    const slots = statsChartPointSlots(points.length, margin.left, plotWidth);
    const currentDaily = statsChartDailyPoints(metric, report);
    const state = this.statsViewStateFor(view.sourcePath);
    if (!state.cursorDay && currentDaily.length) {
      state.cursorDay = currentDaily[currentDaily.length - 1].date;
    }
    const cursorDay = state.pinnedDay || state.cursorDay;
    let cursorPointIndex = points.findIndex((point) => point && (point.date === cursorDay || (point.date <= cursorDay && (point.end || point.date) >= cursorDay)));
    if (cursorPointIndex < 0) cursorPointIndex = points.length - 1;

    const titleId = view.chartId + "-title";
    const descId = view.chartId + "-description";
    const svg = statsSvgEl(doc, "svg", {
      class: "bob-stats-chart-svg",
      width,
      height,
      viewBox: "0 0 " + width + " " + height,
      role: "group",
      "aria-labelledby": titleId + " " + descId,
      focusable: "false",
    });
    svg.appendChild(statsSvgEl(doc, "title", { id: titleId }, metric.label + " over time"));
    svg.appendChild(statsSvgEl(doc, "desc", { id: descId }, "Bars show " + metric.label + " by " + chartGroup + ". Use the chart columns or keyboard controls to inspect dates."));
    const defs = statsSvgEl(doc, "defs", {});
    const patternId = view.chartId + "-missing";
    const pattern = statsSvgEl(doc, "pattern", { id: patternId, width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" });
    pattern.appendChild(statsSvgEl(doc, "line", { x1: 0, y1: 0, x2: 0, y2: 6, stroke: "var(--text-faint)", "stroke-width": 1, opacity: 0.45 }));
    defs.appendChild(pattern);
    svg.appendChild(defs);

    const ticksToDraw = density.compact ? [ticks.values[ticks.values.length - 1]] : ticks.values;
    for (const tick of ticksToDraw) {
      const y = statsChartY(tick, domain, margin.top, plotHeight);
      svg.appendChild(statsSvgEl(doc, "line", {
        x1: margin.left, y1: y, x2: width - margin.right, y2: y,
        class: "bob-stats-chart-gridline",
        "stroke-width": tick === 0 ? 1.4 : 1,
      }));
      svg.appendChild(statsSvgEl(doc, "text", {
        x: margin.left - 7, y: y + 4, "text-anchor": "end", class: "bob-stats-chart-axis",
      }, statsChartFormatTick(tick, metric.unit, ticks.step)));
    }
    if (density.compact && !ticksToDraw.includes(0) && domain[0] <= 0 && domain[1] >= 0) {
      svg.appendChild(statsSvgEl(doc, "line", {
        x1: margin.left, y1: zeroY, x2: width - margin.right, y2: zeroY,
        class: "bob-stats-chart-zero-line", "stroke-width": 1.4,
      }));
    }

    if (statsFinite(bandP25) && statsFinite(bandP75)) {
      const y25 = statsChartY(bandP25, domain, margin.top, plotHeight);
      const y75 = statsChartY(bandP75, domain, margin.top, plotHeight);
      svg.appendChild(statsSvgEl(doc, "rect", {
        x: margin.left,
        y: Math.min(y25, y75),
        width: plotWidth,
        height: Math.max(1, Math.abs(y25 - y75)),
        class: "bob-stats-chart-band",
        "data-band-group": chartGroup,
      }));
    }

    const baseline = Math.max(margin.top, Math.min(margin.top + plotHeight, zeroY));
    const color = statsChartMetricColor(metric);
    const hitNodes = [];
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index] && typeof points[index] === "object" ? points[index] : {};
      const slot = slots[index];
      const date = typeof point.date === "string" ? point.date : "";
      const end = typeof point.end === "string" ? point.end : date;
      const key = "chart:" + statsChartPointKey(point);
      const valueY = statsFinite(point.value) ? statsChartY(point.value, domain, margin.top, plotHeight) : baseline;
      if (!statsFinite(point.value)) {
        if (point.quality === "missing") {
          svg.appendChild(statsSvgEl(doc, "rect", {
            x: slot.slotStart + 1,
            y: margin.top,
            width: Math.max(0.5, plotWidth / points.length - 2),
            height: plotHeight,
            fill: "url(#" + patternId + ")",
            class: "bob-stats-chart-missing",
          }));
        }
        if (point.provisional === true) {
          svg.appendChild(statsSvgEl(doc, "rect", {
            x: slot.slotStart + 1,
            y: margin.top + 1,
            width: Math.max(1, plotWidth / points.length - 2),
            height: Math.max(1, plotHeight - 2),
            class: "bob-stats-chart-today bob-stats-svg-hue-" + color,
          }));
        }
        svg.appendChild(statsSvgEl(doc, "text", {
          x: slot.center, y: baseline - 5, "text-anchor": "middle", class: "bob-stats-chart-null-label",
        }, "–"));
      } else if (point.value === 0) {
        svg.appendChild(statsSvgEl(doc, "line", {
          x1: slot.center - Math.max(1, slot.width / 2),
          x2: slot.center + Math.max(1, slot.width / 2),
          y1: baseline,
          y2: baseline,
          class: "bob-stats-chart-zero bob-stats-svg-hue-" + color + (point.provisional ? " bob-stats-chart-today" : ""),
          "stroke-width": 2,
        }));
      } else {
        const path = statsRoundedTerminalBarPath(slot.x, baseline, valueY, Math.max(1, slot.width), 4);
        svg.appendChild(statsSvgEl(doc, "path", {
          d: path,
          class: "bob-stats-chart-bar bob-stats-svg-hue-" + color + (point.provisional ? " bob-stats-chart-today" : ""),
          "data-partial": point.partial === true ? "true" : null,
        }));
      }
      const hit = statsSvgEl(doc, "rect", {
        x: slot.slotStart,
        y: margin.top,
        width: Math.max(1, plotWidth / points.length),
        height: plotHeight,
        fill: "transparent",
        class: "bob-stats-chart-hit" + (index === cursorPointIndex ? " bob-stats-chart-hit-cursor" : ""),
        role: "button",
        tabindex: index === cursorPointIndex ? 0 : -1,
        "aria-label": statsChartTooltip(metric, point, report).replace(/\n/g, ", "),
        "aria-pressed": state.pinnedDay && state.pinnedDay >= date && state.pinnedDay <= end ? "true" : "false",
        "data-date": date,
        "data-end": end,
        "data-stats-focus-key": key,
      });
      hit.addEventListener("pointerenter", (event) => {
        view.hoverBucket = { start: date, end };
        const daily = statsChartDailyPoints(metric, report).filter((entry) => entry && entry.date >= date && entry.date <= end);
        state.hoverDay = daily.length ? daily[0].date : null;
        this.statsShowChartTooltip(view, statsChartTooltip(metric, point, report), event, slot.center, valueY, margin.top);
        this.statsUpdateChartDayDetail(doc, view, report, metric, view.chartDayDetail);
      });
      hit.addEventListener("pointermove", (event) => {
        this.statsMoveChartTooltip(view, event, slot.center, valueY, margin.top);
      });
      hit.addEventListener("pointerleave", () => {
        view.hoverBucket = null;
        state.hoverDay = null;
        if (view.chartTooltip) {
          view.chartTooltip.setAttribute("hidden", "true");
        }
        this.statsUpdateChartDayDetail(doc, view, report, metric, view.chartDayDetail);
      });
      hit.addEventListener("focus", () => {
        const selectedDay = statsChartActivePoint(metric, report, state, { start: date, end });
        if (!state.pinnedDay && selectedDay) state.cursorDay = selectedDay.date;
        const live = view.chartLive;
        if (live) live.textContent = statsChartTooltip(metric, point, report).replace(/\n/g, ", ");
        view.hoverBucket = { start: date, end };
        this.statsUpdateChartDayDetail(doc, view, report, metric, view.chartDayDetail);
      });
      hit.addEventListener("blur", () => {
        view.hoverBucket = null;
        this.statsUpdateChartDayDetail(doc, view, report, metric, view.chartDayDetail);
      });
      hit.addEventListener("click", (event) => this.statsPinChartPoint(doc, view, report, metric, point, event));
      hit.addEventListener("keydown", (event) => {
        if (event && event.key === "Enter") {
          if (event.preventDefault) event.preventDefault();
          if (event.stopPropagation) event.stopPropagation();
          this.statsPinChartPoint(doc, view, report, metric, point, event);
        }
      });
      hitNodes.push(hit);
      svg.appendChild(hit);
    }

    if (priorPoints.length) {
      const aligned = statsAlignPriorPoints(points, priorPoints);
      const completeCount = points.filter((point) => point && point.provisional !== true).length;
      const completeWidth = plotWidth * completeCount / Math.max(1, points.length);
      for (const prior of aligned) {
        const x = margin.left + prior.ratio * completeWidth;
        const y = statsChartY(prior.point.value, domain, margin.top, plotHeight);
        svg.appendChild(statsSvgEl(doc, "line", {
          x1: x - 4, x2: x + 4, y1: y, y2: y,
          class: "bob-stats-chart-prior" + (prior.partial ? " bob-stats-chart-prior-partial" : "") + (prior.unmatchedEdge ? " bob-stats-chart-prior-unmatched" : ""),
          "stroke-width": 2,
          "aria-label": "Prior period " + statsChartTooltip(metric, prior.point, report).replace(/\n/g, ", "),
        }));
      }
    }

    const medians = points.map((point) => point && point.provisional ? { rolling_median: null } : point);
    const medianPath = statsLinePath(medians, slots.map((slot) => slot.center), (value) => statsChartY(value, domain, margin.top, plotHeight));
    if (medianPath) {
      svg.appendChild(statsSvgEl(doc, "path", { d: medianPath, class: "bob-stats-chart-median", fill: "none" }));
    }

    svg.appendChild(statsSvgEl(doc, "line", {
      x1: margin.left, y1: margin.top + plotHeight, x2: width - margin.right, y2: margin.top + plotHeight,
      class: "bob-stats-chart-axis-line", "stroke-width": 1,
    }));
    for (const index of density.xIndices) {
      const point = points[index];
      const slot = slots[index];
      svg.appendChild(statsSvgEl(doc, "text", {
        x: slot.center,
        y: height - 9,
        "text-anchor": index === 0 ? "start" : index === points.length - 1 ? "end" : "middle",
        class: "bob-stats-chart-axis bob-stats-chart-x-label",
      }, statsChartDateLabel(point)));
    }
    wrap.appendChild(svg);
    section.appendChild(wrap);
    view.chartRoot = section;
    this.statsRegisterChartResize(view, wrap);

    const legend = statsEl(doc, "div", { class: "bob-stats-chart-legend", "aria-label": "Chart legend" });
    legend.appendChild(statsEl(doc, "span", { class: "bob-stats-legend-item" }, "Bars · " + chartGroup + " buckets"));
    if (statsFinite(bandP25) && statsFinite(bandP75)) {
      legend.appendChild(statsEl(doc, "span", { class: "bob-stats-legend-item bob-stats-legend-band" },
        "Typical " + (chartGroup === "day" ? "daily" : chartGroup) + " range (25th–75th percentile)"));
    } else if (chartGroup !== "day") {
      legend.appendChild(statsEl(doc, "span", { class: "bob-stats-legend-item" }, "Grouped range band unavailable in this schema"));
    }
    if (points.some((point) => point && statsFinite(point.rolling_median))) {
      legend.appendChild(statsEl(doc, "span", { class: "bob-stats-legend-item bob-stats-legend-median" }, "Rolling median"));
    }
    if (priorPoints.length) {
      legend.appendChild(statsEl(doc, "span", { class: "bob-stats-legend-item bob-stats-legend-prior" }, "Prior period · aligned by elapsed position"));
    }
    section.appendChild(legend);
    const notes = [];
    if (points.some((point) => point && point.provisional === true)) notes.push("Today is provisional.");
    if (points.some((point) => point && point.partial === true)) notes.push("Partial buckets cover only part of a week or month.");
    if (metric.since) notes.push("Tracking since " + metric.since + ".");
    if (notes.length) section.appendChild(statsEl(doc, "div", { class: "bob-stats-chart-note" }, notes.join(" ")));

    const tooltip = statsEl(doc, "div", { class: "bob-stats-chart-tooltip", role: "tooltip", hidden: true });
    section.appendChild(tooltip);
    view.chartTooltip = tooltip;
    const live = statsEl(doc, "div", { class: "bob-stats-chart-live", role: "status", "aria-live": "polite", "aria-atomic": "true" });
    section.appendChild(live);
    view.chartLive = live;
    const detail = statsEl(doc, "div", {
      class: "bob-stats-day-detail",
      role: "region",
      tabindex: "0",
      "aria-label": "Selected day detail",
      "data-stats-focus-key": "day-detail",
    });
    section.appendChild(detail);
    view.chartDayDetail = detail;
    this.statsUpdateChartDayDetail(doc, view, report, metric, detail);
    section.appendChild(this.statsRenderDefinition(doc, view, metric));
    view.chartHitNodes = hitNodes;
    return section;
  }

  statsShowChartTooltip(view, text, event, x, y, top) {
    const node = view && view.chartTooltip;
    if (!node) return;
    node.textContent = text;
    node.removeAttribute("hidden");
    this.statsMoveChartTooltip(view, event, x, y, top);
  }

  statsMoveChartTooltip(view, event, x, y, top) {
    const node = view && view.chartTooltip;
    if (!node) return;
    let left = x;
    let upper = Math.max(0, y - top - 12);
    if (event && statsFinite(event.clientX) && view.chartRoot && view.chartRoot.getBoundingClientRect) {
      const rect = view.chartRoot.getBoundingClientRect();
      left = event.clientX - rect.left;
    } else if (event && statsFinite(event.offsetX)) {
      left = event.offsetX;
    }
    if (event && statsFinite(event.clientY) && view.chartRoot && view.chartRoot.getBoundingClientRect) {
      const rect = view.chartRoot.getBoundingClientRect();
      upper = event.clientY - rect.top - 12;
    } else if (event && statsFinite(event.offsetY)) {
      upper = event.offsetY;
    }
    node.setAttribute("style", "left: " + left + "px; top: " + upper + "px");
  }

  statsPinChartPoint(doc, view, report, metric, point, event) {
    const state = this.statsViewStateFor(view.sourcePath);
    const start = typeof point.date === "string" ? point.date : "";
    const end = typeof point.end === "string" ? point.end : start;
      const daily = statsChartDailyPoints(metric, report).filter((entry) => entry && entry.date >= start && entry.date <= end);
    const selected = daily.find((entry) => entry.date === state.pinnedDay || entry.date === state.cursorDay) || daily[0] || null;
    if (selected) {
      state.pinnedDay = selected.date;
      state.cursorDay = selected.date;
    } else if (((metric.chart && metric.chart.group) || (report.range && report.range.group) || "day") === "day") {
      state.pinnedDay = start;
      state.cursorDay = start;
    } else {
      state.pinnedDay = null;
      state.cursorDay = null;
    }
    state.pinnedBucket = { start, end };
    view.hoverBucket = null;
    if (view.chartLive) view.chartLive.textContent = "Pinned " + statsChartTooltip(metric, point, report).replace(/\n/g, ", ");
    this.statsRenderLocally(view, "chart:" + statsChartPointKey(point));
  }

  statsRenderDefinition(doc, view, metric) {
    const state = this.statsViewStateFor(view.sourcePath);
    const expanded = state.definitionOpen === true;
    const wrap = statsEl(doc, "div", { class: "bob-stats-definition" });
    if (expanded) {
      const panel = statsEl(doc, "div", {
        class: "bob-stats-definition-panel",
        id: view.chartId + "-definition",
        role: "region",
        "aria-label": metric.label + " definition",
      });
      const fields = [
        ["Label", metric.label],
        ["Definition", metric.definition],
        ["Unit", metric.unit],
        ["Source", metric.source],
        ["Since", metric.since],
      ];
      for (const [name, value] of fields) {
        if (value !== undefined && value !== null && value !== "") {
          const row = statsEl(doc, "div", { class: "bob-stats-definition-row" });
          row.appendChild(statsEl(doc, "strong", {}, name + ": "));
          row.appendChild(statsEl(doc, "span", {}, String(value)));
          panel.appendChild(row);
        }
      }
      const limits = Array.isArray(metric.limits) ? metric.limits : [];
      if (limits.length) {
        const list = statsEl(doc, "ul", { class: "bob-stats-definition-limits", "aria-label": "Metric limits" });
        for (const limit of limits) list.appendChild(statsEl(doc, "li", {}, String(limit)));
        panel.appendChild(list);
      }
      const close = statsEl(doc, "button", { class: "bob-stats-chip", type: "button", "data-stats-focus-key": "definition-close" }, "Close definition");
      close.addEventListener("click", () => {
        state.definitionOpen = false;
        this.statsRenderLocally(view, "definition-toggle");
      });
      panel.appendChild(close);
      panel.addEventListener("keydown", (event) => {
        if (event && event.key === "Escape") {
          if (event.preventDefault) event.preventDefault();
          if (event.stopPropagation) event.stopPropagation();
          state.definitionOpen = false;
          state.pinnedDay = null;
          state.pinnedBucket = null;
          state.hoverDay = null;
          view.hoverBucket = null;
          this.statsRenderLocally(view, "definition-toggle");
        }
      });
      wrap.appendChild(panel);
    }
    return wrap;
  }

  statsInstallChartKeyboard(root, view, report) {
    this.statsReleaseChartKeyboard(view);
    const handler = (event) => {
      if (!event || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const target = event.target || null;
      const tag = target && target.tagName ? String(target.tagName).toLowerCase() : "";
      if (tag === "input" || tag === "select" || tag === "textarea" || tag === "button" || (target && target.isContentEditable)) return;
      const state = this.statsViewStateFor(view.sourcePath);
      const metrics = (report.metrics || []).filter((metric) => metric && typeof metric.id === "string");
      const metricIndex = metrics.findIndex((metric) => metric.id === state.focus);
      const activeMetric = metricIndex >= 0 ? metrics[metricIndex] : metrics[0];
      const local = (key) => {
        if (event.preventDefault) event.preventDefault();
        if (event.stopPropagation) event.stopPropagation();
        this.statsRenderLocally(view, key);
      };
      if (event.key === "Escape") {
        if (state.pinnedDay || state.pinnedBucket || state.definitionOpen || view.hoverBucket) {
          const focusKey = state.definitionOpen ? "definition-toggle" : (statsChartActiveFocusKey(view.el) || "stats-root");
          state.pinnedDay = null;
          state.pinnedBucket = null;
          state.hoverDay = null;
          state.definitionOpen = false;
          view.hoverBucket = null;
          if (view.chartTooltip) view.chartTooltip.setAttribute("hidden", "true");
          local(focusKey);
        }
        return;
      }
      if ((event.key === "Enter") && (target === root || (target && target.getAttribute && target.getAttribute("class") === "bob-stats-day-detail"))) {
        const point = this.statsChartActivePoint(activeMetric, report, state, state.pinnedBucket);
        if (point) {
          if (event.preventDefault) event.preventDefault();
          this.statsOpenDailyNote(view, point.date, event);
        }
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const points = statsChartDailyPoints(activeMetric, report);
        if (!points.length) return;
        const current = points.findIndex((point) => point && point.date === (state.pinnedDay || state.cursorDay));
        const next = Math.max(0, Math.min(points.length - 1, (current < 0 ? points.length - 1 : current) + (event.key === "ArrowRight" ? 1 : -1)));
        state.cursorDay = points[next].date;
        state.pinnedDay = null;
        state.pinnedBucket = null;
        local(this.statsChartFocusKeyForDay(activeMetric, report, points[next].date));
        return;
      }
      if (event.key === "j" || event.key === "k") {
        const next = (metricIndex + (event.key === "j" ? 1 : -1) + metrics.length) % metrics.length;
        state.focus = metrics[next].id;
        local("focus-selector");
        return;
      }
      if (event.key === "h" || event.key === "l") {
        const range = state.range || (view.fence && view.fence.range) || (report.range && report.range.preset) || STATS_DEFAULT_RANGE;
        if (range === "all" || (event.key === "l" && (state.offset || 0) <= 0)) return;
        state.offset = Math.max(0, (state.offset || 0) + (event.key === "h" ? 1 : -1));
        if (event.preventDefault) event.preventDefault();
        if (event.stopPropagation) event.stopPropagation();
        view.pendingStatsFocusKey = event.key === "h" ? "range-previous" : "range-next";
        this.paintStatsBlock(view);
        return;
      }
      if (event.key === "t") {
        state.table = !state.table;
        local("table-toggle");
      }
    };
    root.addEventListener("keydown", handler);
    view.chartKeyboardRoot = root;
    view.chartKeyboardHandler = handler;
  }

  statsReleaseChartKeyboard(view) {
    if (!view) return;
    try {
      if (view.chartKeyboardRoot && view.chartKeyboardHandler && view.chartKeyboardRoot.removeEventListener) {
        view.chartKeyboardRoot.removeEventListener("keydown", view.chartKeyboardHandler);
      }
    } catch (error) {
      // Event cleanup is best-effort.
    }
    view.chartKeyboardRoot = null;
    view.chartKeyboardHandler = null;
  }
}
